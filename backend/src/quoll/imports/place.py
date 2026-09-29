"""Применение группы реестра: заявка, ветки, документы, доп. поля
(import-design §19). Единица применения - группа целиком, в одной
транзакции воркера (§17.3); блокировки - по порядку §17.4

Не реализовано (упрощения, см. docs/handoff/imports-status.md):
- динамические поля шага ("step:*", §19.2/§19.9 STEP:<stage>:<key>) - в
  mapping.py/spec.py их источника нет, значения шагов импорт не пишет;
  контакты группы применяются только вариантом CATALOG (§19.9);
- файл строки -> документ: стадия по умолчанию берётся проще, чем в
  таблице §19.8 (без поиска ближайшего required_document_kinds по рёбрам).
"""

from datetime import date, datetime
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from quoll.attachments.models import Attachment
from quoll.auth.audit import record
from quoll.auth.audit_models import AuditEventType, TargetType
from quoll.catalog import service as catalog_service
from quoll.catalog.models import CloseLevel, Contact
from quoll.catalog.schemas import ContactPatch, ContactWrite
from quoll.imports import apply, normalize
from quoll.imports.analysis import Analysis
from quoll.imports.errors import import_error
from quoll.imports.models import ImportFile
from quoll.imports.registry import BranchPlan, GroupPlan
from quoll.interactions import (
    branch_service,
    contract_service,
    project_service,
    side_pointer_service,
    transition_service,
)
from quoll.interactions.close_reasons import id_by_code, interaction_level
from quoll.interactions.models import (
    Branch,
    InteractionDocument,
    InteractionStageHistory,
    StageChangeKind,
)
from quoll.interactions.schemas import BranchWrite, InteractionCreate
from quoll.interactions.scope import lock_interaction_scope

BUSINESS_TZ = ZoneInfo("Europe/Moscow")


def _midnight(d: date | None) -> datetime | None:
    return datetime(d.year, d.month, d.day, tzinfo=BUSINESS_TZ) if d else None


async def apply_group(
    session: AsyncSession, batch, an: Analysis, plan: GroupPlan
) -> dict[str, Any]:
    """§19.2 - вызывающий (worker) уже держит lock_row(ImportBatch) (§17.4 п.1)"""
    await _share_stages(session, batch, an, plan)
    replaced_id = None
    if plan.decision == "REPLACE":
        replaced_id = await _replace_old(session, batch, plan)

    university_id = await apply.resolve_ref(session, plan.university_ref)
    writes = []
    for b in plan.branches:
        program_id = await apply.resolve_ref(session, b.program_ref)
        product_id = (
            await apply.resolve_ref(session, b.product_ref)
            if b.product_ref is not None
            else None
        )
        b.program_id, b.product_id = program_id, product_id
        writes.append(BranchWrite(program_id=program_id, product_id=product_id))

    interaction = await project_service.create_interaction(
        session,
        InteractionCreate(
            university_id=university_id, workflow_id=batch.workflow_id, branches=writes
        ),
        author_id=None,
    )
    earliest_at = _midnight(plan.earliest)
    scope = await lock_interaction_scope(
        session,
        interaction.id,
        None,
        target_manager_ids=[plan.manager_id] if plan.manager_id else [],
    )
    await session.execute(
        update(Branch)
        .where(Branch.interaction_id == interaction.id)
        .values(created_at=earliest_at or datetime.now(BUSINESS_TZ))
    )

    if plan.manager_id:
        await project_service.assign_locked(
            session,
            scope,
            manager_id=plan.manager_id,
            expected_owner_id=None,
            reason=f"import #{batch.id}",
            by_import=True,
            announce=False,
            assigned_at=earliest_at,
        )
        scope = await lock_interaction_scope(
            session, interaction.id, None, target_manager_ids=[plan.manager_id]
        )

    signed_at = None
    if plan.signed:
        signed_at = (
            _midnight(plan.contract_signed_at)
            or earliest_at
            or datetime.now(BUSINESS_TZ)
        )
    if plan.stage_id is not None:
        since = signed_at if plan.signed else earliest_at
        await transition_service.place_imported(
            session,
            scope,
            plan.stage_id,
            since,
            batch_id=batch.id,
            sealed=plan.no_return,
        )
    if plan.signed:
        rows = [_seal_row(b) for b in plan.branches]
        await contract_service.seal_imported(
            session,
            scope,
            rows,
            signed_at,
            batch_id=batch.id,
            branch_start_id=an.snap.anchors.b0,
        )

    document_ids: list[int] = []
    if plan.contract_number or plan.contract_signed_at:
        doc_id = await _attach_contract(
            session, batch, an, interaction.id, plan, signed_at or earliest_at
        )
        if doc_id is not None:
            document_ids.append(doc_id)
    if plan.contract_extended_until:
        await _extend_contract(session, batch, interaction, plan, signed_at)

    for b in plan.branches:
        if b.branch_paused and not b.closed and not b.refused:
            branch_row = await _branch_row(session, interaction.id, b)
            await branch_service.pause_locked(
                session, scope, branch_row, until=None, comment=f"import #{batch.id}"
            )

    await _apply_comments(session, batch, interaction.id, plan)
    document_ids += await _apply_files(session, batch, an, interaction.id, plan)
    await _apply_contacts(session, an, university_id, plan)

    if plan.agreement_open:
        await _open_agreement(session, batch, scope, an, plan)
    if plan.pause_until:
        await project_service.pause_locked(
            session, scope, until=plan.pause_until, comment=f"import #{batch.id}"
        )
    if plan.close_by_all_branches:
        await transition_service.close_locked(
            session,
            scope,
            to_stage_id=an.snap.anchors.done,
            close_reason_id=await id_by_code(session, "ALL_BRANCHES_CLOSED"),
            comment=f"import #{batch.id}",
            by_import=True,
        )

    interaction.slot_changed_at = datetime.now(BUSINESS_TZ)
    record(
        session,
        actor_id=None,
        event_type=AuditEventType.INTERACTION_IMPORTED,
        target_type=TargetType.INTERACTION,
        target_id=interaction.id,
        new_value={
            "batch_id": batch.id,
            "interaction_id": interaction.id,
            "replaced_id": replaced_id,
        },
    )
    branches = list(
        await session.scalars(
            select(Branch).where(Branch.interaction_id == interaction.id)
        )
    )
    return {
        "interaction_id": interaction.id,
        "manager_id": plan.manager_id,
        "closed": plan.close_by_all_branches,
        "replaced_interaction_id": replaced_id,
        "branch_ids": [b.id for b in branches],
        "document_ids": document_ids,
    }


async def _share_stages(
    session: AsyncSession, batch, an: Analysis, plan: GroupPlan
) -> None:
    """§17.4 п.2 - все стадии группы FOR SHARE раньше взаимодействия
    (как ход ветки: стадия при нескольких стадиях сразу раньше строки)"""
    ids = {s for s in (plan.stage_id, *(b.stage_id for b in plan.branches)) if s}
    if plan.agreement_open and an.snap.anchors.agr:
        ids.add(an.snap.anchors.agr)
    if plan.close_by_all_branches and an.snap.anchors.done:
        ids.add(an.snap.anchors.done)
    if plan.decision == "REPLACE":
        ids.update(batch.replace_stages.values())
    for stage_id in sorted(ids):
        await transition_service.share_stage(session, stage_id)


def _seal_row(b: BranchPlan) -> contract_service.SealRow:
    return contract_service.SealRow(
        program_id=b.program_id,
        product_id=b.product_id,
        stage_id=b.stage_id,
        terminal=b.closed,
        refused=b.refused,
        close_reason_id=b.close_reason_id,
        since=_midnight(b.since),
        license_signed_at=b.license_signed_at,
        license_term_years=b.license_term_years,
        transfer_status=b.transfer_status,
        license_extended_until=b.license_extended_until,
        license_extended_at=_midnight(b.license_extended_at),
    )


async def _branch_row(
    session: AsyncSession, interaction_id: int, b: BranchPlan
) -> Branch:
    return await session.scalar(
        select(Branch).where(
            Branch.interaction_id == interaction_id,
            Branch.program_id == b.program_id,
            Branch.product_id.is_not_distinct_from(b.product_id),
        )
    )


# --- REPLACE (§19.6) ---------------------------------------------------------


async def _replace_old(session: AsyncSession, batch, plan: GroupPlan) -> int:
    target = plan.replace_target
    old_id = target["interaction_id"]
    scope_old = await lock_interaction_scope(
        session,
        old_id,
        None,
        target_manager_ids=[plan.manager_id] if plan.manager_id else [],
        allow_closed=True,
    )
    old = scope_old.interaction
    if old.state_id is None:
        await project_service.cancel_draft_locked(
            session,
            scope_old,
            close_reason_id=await id_by_code(session, "REPLACED_BY_IMPORT_BEFORE"),
            comment=f"import #{batch.id}",
            allow_system=True,
        )
    else:
        level = interaction_level(old)
        code = (
            "REPLACED_BY_IMPORT_AFTER"
            if level == CloseLevel.INTERACTION_AFTER_SIGNING
            else "REPLACED_BY_IMPORT_BEFORE"
        )
        to_stage_id = batch.replace_stages.get(str(old.workflow_id))
        if to_stage_id is None:
            raise import_error(
                409, "IMP-187", "No closing stage for the replaced route"
            )
        await transition_service.close_locked(
            session,
            scope_old,
            to_stage_id=to_stage_id,
            close_reason_id=await id_by_code(session, code),
            branch_close_reason_id=await id_by_code(session, "REPLACED_BY_IMPORT"),
            comment=f"import #{batch.id}",
            by_import=True,
        )
    return old_id


# --- договор (§19.7) ----------------------------------------------------------


async def _attach_contract(
    session: AsyncSession,
    batch,
    an: Analysis,
    interaction_id: int,
    plan: GroupPlan,
    at: datetime | None,
) -> int | None:
    file_row = None
    for ctx in plan.rows:
        found = await session.scalar(
            select(ImportFile).where(
                ImportFile.row_id == ctx.row.id, ImportFile.kind == "CONTRACT"
            )
        )
        if found is not None:
            file_row = found
            break
    stage_id = plan.stage_id or an.snap.anchors.seal or an.snap.anchors.s0
    number = plan.contract_number
    if file_row is not None:
        doc = InteractionDocument(
            interaction_id=interaction_id,
            attachment_id=file_row.attachment_id,
            stage_id=file_row.stage_id or stage_id,
            uploaded_by=None,
            title=file_row.title or f"Договор №{number}" if number else "Договор",
            kind="CONTRACT",
            description=file_row.description,
            contract_number=number or file_row.contract_number,
            contract_signed_at=plan.contract_signed_at or file_row.contract_signed_at,
            contract_valid_until=plan.contract_valid_until
            or file_row.contract_valid_until,
            status="ACTIVE",
        )
        session.add(doc)
        await session.flush()
        file_row.document_id = doc.id
        file_row.attachment_id = None
    elif number:
        doc = InteractionDocument(
            interaction_id=interaction_id,
            attachment_id=None,
            stage_id=stage_id,
            uploaded_by=None,
            title=f"Договор №{number}",
            kind="CONTRACT",
            contract_number=number,
            contract_signed_at=plan.contract_signed_at,
            contract_valid_until=plan.contract_valid_until,
            status="ACTIVE",
        )
        session.add(doc)
        await session.flush()
    else:
        return None
    record(
        session,
        actor_id=None,
        event_type=AuditEventType.DOCUMENT_ATTACHED,
        target_type=TargetType.INTERACTION,
        target_id=interaction_id,
        new_value={"document_id": doc.id, "kind": "CONTRACT"},
    )
    return doc.id


async def _extend_contract(
    session, batch, interaction, plan: GroupPlan, signed_at
) -> None:
    from quoll.interactions.bindings import current_contract

    doc = await current_contract(session, interaction.id)
    old = doc.contract_valid_until if doc else None
    if doc is not None:
        doc.contract_valid_until = plan.contract_extended_until
    at = signed_at
    ext_at = _midnight(plan.contract_extended_at) or at or datetime.now(BUSINESS_TZ)
    if at is not None and ext_at < at:
        ext_at = at
    session.add(
        InteractionStageHistory(
            interaction_id=interaction.id,
            from_stage_id=interaction.state_id,
            to_stage_id=interaction.state_id,
            kind=StageChangeKind.CONTRACT_EXTENDED,
            actor_id=None,
            payload={
                "old": old.isoformat() if old else None,
                "new": plan.contract_extended_until.isoformat(),
                "batch_id": batch.id,
            },
            created_at=ext_at,
        )
    )
    record(
        session,
        actor_id=None,
        event_type=AuditEventType.CONTRACT_EXTENDED,
        target_type=TargetType.INTERACTION,
        target_id=interaction.id,
        new_value={"until": plan.contract_extended_until.isoformat()},
    )


# --- комментарии, файлы, контакты --------------------------------------------


async def _apply_comments(session, batch, interaction_id: int, plan: GroupPlan) -> None:
    branches_by_row = {b.row.row.id: b for b in plan.branches}
    for ctx in plan.rows:
        text = ctx.values.get("comment")
        if not text:
            continue
        b = branches_by_row.get(ctx.row.id)
        branch_id = None
        if b is not None:
            branch = await _branch_row(session, interaction_id, b)
            branch_id = branch.id if branch else None
        session.add(
            InteractionStageHistory(
                interaction_id=interaction_id,
                branch_id=branch_id,
                from_stage_id=None,
                to_stage_id=None,
                kind=StageChangeKind.COMMENT,
                actor_id=None,
                comment=text,
                payload={"batch_id": batch.id},
            )
        )


async def _apply_files(
    session, batch, an: Analysis, interaction_id: int, plan: GroupPlan
) -> list[int]:
    branches_by_row = {b.row.row.id: b for b in plan.branches}
    ids: list[int] = []
    for ctx in plan.rows:
        files = list(
            await session.scalars(
                select(ImportFile).where(
                    ImportFile.row_id == ctx.row.id,
                    ImportFile.document_id.is_(None),
                    ImportFile.kind != "CONTRACT",
                )
            )
        )
        if not files:
            continue
        b = branches_by_row.get(ctx.row.id)
        branch_id = None
        default_stage = plan.stage_id or an.snap.anchors.seal
        if b is not None:
            branch = await _branch_row(session, interaction_id, b)
            branch_id = branch.id if branch else None
            default_stage = b.stage_id or default_stage
        for f in files:
            stage_id = f.stage_id or default_stage
            if stage_id is None:
                raise import_error(422, "IMP-184", "No stage for the row file")
            filename = None
            if f.attachment_id is not None:
                filename = await session.scalar(
                    select(Attachment.filename).where(Attachment.id == f.attachment_id)
                )
            doc = InteractionDocument(
                interaction_id=interaction_id,
                attachment_id=f.attachment_id,
                stage_id=stage_id,
                branch_id=branch_id,
                uploaded_by=None,
                title=f.title or filename or f.kind,
                kind=f.kind,
                description=f.description,
                status="ACTIVE",
            )
            session.add(doc)
            await session.flush()
            f.document_id = doc.id
            f.attachment_id = None
            record(
                session,
                actor_id=None,
                event_type=AuditEventType.DOCUMENT_ATTACHED,
                target_type=TargetType.INTERACTION,
                target_id=interaction_id,
                new_value={"document_id": doc.id, "kind": f.kind},
            )
            ids.append(doc.id)
    return ids


def _split_contacts(text: str) -> list[tuple[str, str | None, str | None]]:
    """«ФИО, телефон, email» через «;» (§19.9)"""
    out = []
    for chunk in text.split(";"):
        parts = [p.strip() for p in chunk.split(",")]
        parts = [p for p in parts if p]
        if not parts:
            continue
        name = parts[0]
        phone = parts[1] if len(parts) > 1 else None
        email = parts[2] if len(parts) > 2 else None
        out.append((name, phone, email))
    return out


async def _apply_contacts(
    session, an: Analysis, university_id: int, plan: GroupPlan
) -> None:
    """§19.9 - только вариант CATALOG: ссылка в поле шага не пишется,
    динамических полей шага импорт не знает (см. докстринг модуля)"""
    if not plan.contacts_text:
        return
    known = await an.snap.contacts("university", university_id)
    for name, phone, email in _split_contacts(plan.contacts_text):
        key = normalize.text_key(name)
        existing = next(
            (c for c in known if normalize.text_key(c.full_name) == key), None
        )
        phone_value = normalize.phone(phone)[0] if phone else None
        data = {"full_name": name}
        if phone_value:
            data["phone"] = phone_value
        if email:
            data["email"] = email
        if existing is not None:
            await catalog_service.update(
                session,
                Contact,
                TargetType.CONTACT,
                existing.id,
                ContactPatch(**data),
                None,
            )
        else:
            await catalog_service.create(
                session,
                Contact,
                TargetType.CONTACT,
                ContactWrite(university_id=university_id, **data),
                None,
            )


# --- допсоглашение (§19.5) ---------------------------------------------------


async def _open_agreement(session, batch, scope, an: Analysis, plan: GroupPlan) -> None:
    agr_stage = an.snap.stages[an.snap.anchors.agr]
    pointer = await side_pointer_service.start_locked(
        session, scope, agr_stage, comment=f"import #{batch.id}"
    )
    at = _midnight(plan.agreement_since)
    if at is not None:
        await session.execute(
            update(InteractionStageHistory)
            .where(InteractionStageHistory.side_pointer_id == pointer.id)
            .values(created_at=at)
        )
