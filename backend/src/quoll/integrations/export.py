"""Заявки наружу: И1 для LMS (К §2.3) и выгрузка Э (К §2.5) - Э это И1
плюс поля. Всё грузится пачкой на набор заявок, без запросов на строку"""

from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from quoll.attachments.models import Attachment
from quoll.auth.audit import record as audit
from quoll.auth.audit_models import AuditEventType, TargetType
from quoll.auth.models import User
from quoll.catalog.models import (
    CloseReason,
    DocumentKind,
    ItDirection,
    ItProgram,
    Product,
)
from quoll.core.people import person
from quoll.integrations.models import (
    IntegrationRun,
    LmsStats,
    RunFlow,
    RunStatus,
    RunTrigger,
)
from quoll.interactions.models import (
    AgreementAction,
    Branch,
    ContractStatus,
    DocumentStatus,
    Interaction,
    InteractionDocument,
    SupplementaryAgreement,
    University,
    Vendor,
)
from quoll.reports import labels
from quoll.workflows.models import Stage, Workflow


def _iso(value: date | datetime | None) -> str | None:
    return value.isoformat() if value else None


@dataclass
class _Refs:
    """справочники целиком - они маленькие"""

    stages: dict[int, Stage]
    programs: dict[int, ItProgram]
    directions: dict[int, str]
    products: dict[int, Product]
    vendors: dict[int, str]
    reasons: dict[int, CloseReason]
    doc_kinds: dict[str, str]
    workflows: dict[int, Workflow] = field(default_factory=dict)


async def _refs(session: AsyncSession) -> _Refs:
    async def by_id(model):
        return {r.id: r for r in await session.scalars(select(model))}

    return _Refs(
        stages=await by_id(Stage),
        programs=await by_id(ItProgram),
        directions={d.id: d.name for d in await session.scalars(select(ItDirection))},
        products=await by_id(Product),
        vendors={v.id: v.name for v in await session.scalars(select(Vendor))},
        reasons=await by_id(CloseReason),
        doc_kinds={
            k.code: k.label for k in await session.scalars(select(DocumentKind))
        },
        workflows=await by_id(Workflow),
    )


def _step(refs: _Refs, stage_id: int | None) -> dict | None:
    stage = refs.stages.get(stage_id)
    return {"id": stage.id, "name": stage.name} if stage else None


def _reason(refs: _Refs, reason_id: int | None) -> dict | None:
    reason = refs.reasons.get(reason_id)
    return {"code": reason.code, "label": reason.label} if reason else None


def _product(refs: _Refs, product_id: int | None) -> dict | None:
    product = refs.products.get(product_id)
    if product is None:
        return None
    return {
        "id": product.id,
        "name": product.name,
        "vendor": {
            "id": product.vendor_id,
            "name": refs.vendors.get(product.vendor_id),
        },
    }


def _document(refs: _Refs, doc: InteractionDocument, key: str | None) -> dict:
    return {
        "id": doc.id,
        "title": doc.title,
        "kind": doc.kind,
        "kind_label": refs.doc_kinds.get(doc.kind, doc.kind),
        "description": doc.description,
        "status": doc.status,
        # null - договор без скана
        "storage_key": key,
        "replaces": doc.replaces_document_id,
    }


def _branch_i1(refs: _Refs, b: Branch) -> dict[str, Any]:
    program = refs.programs[b.program_id]
    return {
        "id": b.id,
        "program": {"id": program.id, "site_course_id": program.site_course_id},
        "product": _product(refs, b.product_id),
        "step": _step(refs, b.state_id),
        "paused": b.pause_state != "ACTIVE",
        "paused_until": _iso(b.paused_until),
        "license_until": _iso(b.license_until),
        "transfer_status": b.transfer_status,
    }


def _university(u: University, full: bool) -> dict[str, Any]:
    out = {
        "id": u.id,
        "full_name": u.full_name,
        "short_name": u.short_name,
        "inn": u.inn,
        "kpp": u.kpp,
    }
    if full:
        out |= {"region": u.region, "city": u.city}
    return out


def _current_contract(docs: list[InteractionDocument]) -> InteractionDocument | None:
    """последняя действующая версия без действующей преемницы"""
    active = [d for d in docs if d.status == DocumentStatus.ACTIVE]
    replaced = {d.replaces_document_id for d in active}
    current = [d for d in active if d.kind == "CONTRACT" and d.id not in replaced]
    return max(current, key=lambda d: d.id, default=None)


async def applications(
    session: AsyncSession,
    *,
    full: bool,
    university_ids: list[int] | None = None,
    program_ids: list[int] | None = None,
    include_closed: bool = False,
) -> list[dict[str, Any]]:
    """И1 (full=False): подписанные незакрытые заявки с открытыми ветками на
    шагах. Э (full=True): заявки по фильтрам со всеми ветками"""
    stmt = select(Interaction).order_by(Interaction.id)
    if not full:
        stmt = stmt.where(
            Interaction.no_return_at.is_not(None), Interaction.closed_at.is_(None)
        )
    elif not include_closed:
        stmt = stmt.where(Interaction.closed_at.is_(None))
    if university_ids:
        stmt = stmt.where(Interaction.university_id.in_(university_ids))
    interactions = list(await session.scalars(stmt))
    ids = [i.id for i in interactions]

    branch_stmt = select(Branch).where(
        Branch.interaction_id.in_(ids), Branch.program_id.is_not(None)
    )
    if not full:
        branch_stmt = branch_stmt.where(
            Branch.closed_at.is_(None),
            Branch.state_id.is_not(None),
            Branch.contract_status == ContractStatus.APPROVED,
        )
    if program_ids:
        branch_stmt = branch_stmt.where(Branch.program_id.in_(program_ids))
    branches = defaultdict(list)
    for b in await session.scalars(branch_stmt.order_by(Branch.id)):
        branches[b.interaction_id].append(b)
    if not full or program_ids:
        interactions = [i for i in interactions if branches[i.id]]
    if not interactions:
        return []

    refs = await _refs(session)
    universities = {
        u.id: u
        for u in await session.scalars(
            select(University).where(
                University.id.in_({i.university_id for i in interactions})
            )
        )
    }
    if not full:
        return [
            {
                "application_id": i.id,
                "university": _university(universities[i.university_id], False),
                "branches": [_branch_i1(refs, b) for b in branches[i.id]],
            }
            for i in interactions
        ]
    extra = await _extra(session, interactions)
    return [_full(refs, i, universities, branches[i.id], extra) for i in interactions]


@dataclass
class _Extra:
    people: dict[str, User]
    docs: dict[int, list[InteractionDocument]]
    keys: dict[int, str]
    agreements: dict[int, list[SupplementaryAgreement]]
    actions: dict[int, list[AgreementAction]]
    stats: dict[tuple[int, int], LmsStats]


async def _extra(session: AsyncSession, interactions: list[Interaction]) -> _Extra:
    ids = [i.id for i in interactions]
    owners = {i.owner_id for i in interactions if i.owner_id}
    docs = defaultdict(list)
    keys = {}
    rows = await session.execute(
        select(InteractionDocument, Attachment.storage_key)
        .outerjoin(Attachment, Attachment.id == InteractionDocument.attachment_id)
        .where(InteractionDocument.interaction_id.in_(ids))
        .order_by(InteractionDocument.id)
    )
    for doc, key in rows:
        docs[doc.interaction_id].append(doc)
        keys[doc.id] = key
    agreements = defaultdict(list)
    for sa in await session.scalars(
        select(SupplementaryAgreement)
        .where(SupplementaryAgreement.interaction_id.in_(ids))
        .order_by(SupplementaryAgreement.id)
    ):
        agreements[sa.interaction_id].append(sa)
    sa_ids = [sa.id for group in agreements.values() for sa in group]
    actions = defaultdict(list)
    for a in await session.scalars(
        select(AgreementAction)
        .where(AgreementAction.sa_id.in_(sa_ids))
        .order_by(AgreementAction.id)
    ):
        actions[a.sa_id].append(a)
    stats = {
        (s.university_id, s.program_id): s
        for s in await session.scalars(
            select(LmsStats).where(
                LmsStats.university_id.in_({i.university_id for i in interactions})
            )
        )
    }
    people = {
        u.id: u for u in await session.scalars(select(User).where(User.id.in_(owners)))
    }
    return _Extra(people, docs, keys, agreements, actions, stats)


def _pause(state: str, until: datetime | None) -> dict:
    return {"state": state, "until": _iso(until)}


def _full(refs, i: Interaction, universities, branches, extra: _Extra) -> dict:
    workflow = refs.workflows.get(i.workflow_id)
    owner = extra.people.get(i.owner_id)
    docs = extra.docs[i.id]
    contract = _current_contract(docs)
    scans = {
        d.supplementary_agreement_id: d.id
        for d in docs
        if d.kind == "SUPPLEMENTARY_AGREEMENT" and d.status == DocumentStatus.ACTIVE
    }
    return {
        "application_id": i.id,
        "workflow": {
            "id": i.workflow_id,
            "name": workflow.name if workflow else None,
            # B2C - потом (К прил. А)
            "client_type": "B2B",
        },
        "university": _university(universities[i.university_id], True),
        "responsible": (
            {"id": owner.id, "name": person(owner)} if owner else None
        ),
        "step": _step(refs, i.state_id),
        "pause": _pause(i.pause_state, i.paused_until),
        "created_at": _iso(i.created_at),
        "closed_at": _iso(i.closed_at),
        "close_reason": _reason(refs, i.close_reason_id),
        "contract": (
            {
                "document_id": contract.id,
                "number": contract.contract_number,
                "signed_at": _iso(contract.contract_signed_at),
                "valid_until": _iso(contract.contract_valid_until),
            }
            if contract
            else None
        ),
        "supplementary_agreements": [
            {
                "id": sa.id,
                "number": sa.number,
                "signed_at": _iso(sa.signed_at),
                "status": sa.status,
                "document_id": scans.get(sa.id),
                "actions": [
                    {
                        "type": a.type,
                        "branch_id": a.branch_id or a.result_branch_id,
                        "program_id": a.program_id,
                        "product_id": a.product_id,
                        "license_until": _iso(a.license_until),
                        "contract_valid_until": _iso(a.contract_valid_until),
                    }
                    for a in extra.actions[sa.id]
                ],
            }
            for sa in extra.agreements[i.id]
        ],
        "documents": [
            _document(refs, d, extra.keys[d.id]) for d in docs if d.branch_id is None
        ],
        "branches": [_branch_full(refs, i, b, docs, extra) for b in branches],
    }


def _branch_full(refs, i: Interaction, b: Branch, docs, extra: _Extra) -> dict:
    program = refs.programs[b.program_id]
    stats = extra.stats.get((i.university_id, b.program_id))
    out = _branch_i1(refs, b)
    del out["paused"], out["paused_until"], out["license_until"]
    return out | {
        "origin": {
            "kind": b.origin,
            "supplementary_agreement_id": b.supplementary_agreement_id,
        },
        "program": out["program"]
        | {
            "name": program.name,
            "direction": {
                "id": program.direction_id,
                "name": refs.directions.get(program.direction_id),
            },
        },
        "contract_status": b.contract_status,
        "pause": _pause(b.pause_state, b.paused_until),
        "closed_at": _iso(b.closed_at),
        "close_reason": _reason(refs, b.close_reason_id),
        "license": (
            {
                "signed_at": _iso(b.license_signed_at),
                "term_years": b.license_term_years,
                "until": _iso(b.license_until),
            }
            if b.license_signed_at
            else None
        ),
        "transfer_status_label": labels.TRANSFER.get(b.transfer_status),
        # значение КАМа с шага 7; LMS - отдельно, в lms_stats (Отв. 2)
        "teachers_trained": b.teachers_trained,
        "lms_stats": (
            {
                "students": stats.students,
                "streams": stats.streams,
                "teachers_trained": stats.teachers_trained,
                "updated_at": _iso(stats.updated_at),
            }
            if stats
            else None
        ),
        "documents": [
            _document(refs, d, extra.keys[d.id]) for d in docs if d.branch_id == b.id
        ],
    }


async def export(
    session: AsyncSession,
    actor_id: str,
    *,
    university_ids: list[int] | None,
    program_ids: list[int] | None,
    include_closed: bool,
) -> list[dict[str, Any]]:
    """Э с записью в журнал запусков: сама выгрузка идёт сразу, в ответе"""
    data = await applications(
        session,
        full=True,
        university_ids=university_ids,
        program_ids=program_ids,
        include_closed=include_closed,
    )
    run = IntegrationRun(
        flow=RunFlow.EXPORT,
        trigger=RunTrigger.MANUAL,
        status=RunStatus.DONE,
        actor_id=actor_id,
        finished_at=func.now(),
        counters={"OK": len(data)},
    )
    session.add(run)
    await session.flush()
    audit(
        session,
        actor_id=actor_id,
        event_type=AuditEventType.INTEGRATION_RUN,
        target_type=TargetType.INTEGRATION_RUN,
        target_id=run.id,
        new_value={
            "flow": RunFlow.EXPORT,
            "university_ids": university_ids,
            "program_ids": program_ids,
            "include_closed": include_closed,
            "applications": len(data),
        },
    )
    return data
