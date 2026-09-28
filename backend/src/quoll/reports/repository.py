"""Факты для отчёта одним снимком БД (reports-design §6).

только чтение бизнес-таблиц: отчёт в них не пишет (IR12)
"""

from datetime import datetime

from sqlalchemy import ColumnElement, exists, or_, select, true
from sqlalchemy.ext.asyncio import AsyncSession

from quoll.auth.models import Manager, User, UserRole
from quoll.catalog.models import CloseReason, ItDirection, ItProgram, Product
from quoll.interactions.access_policy import readable_filter
from quoll.interactions.document_service import replaced_expression
from quoll.interactions.models import (
    Branch,
    DocumentStatus,
    Interaction,
    InteractionAssignment,
    InteractionDocument,
    InteractionStageHistory,
    University,
    Vendor,
)
from quoll.reports.policy import (
    Assignment,
    BranchFact,
    Event,
    Facts,
    InteractionFact,
    Person,
    StageFact,
)
from quoll.workflows.models import Stage


def visible(actor: User) -> ColumnElement[bool]:
    """правило приложения; руководитель видит ещё и всё, что видят его
    текущие КАМы - в том числе заявки, которые они вели раньше (В2)"""
    if actor.role == UserRole.ADMIN:
        return true()
    base = readable_filter(actor)
    if actor.role != UserRole.SUPERVISER:
        return base
    team = select(Manager.id).where(Manager.superviser_id == actor.id)
    seen_by_team = exists().where(
        InteractionAssignment.interaction_id == Interaction.id,
        InteractionAssignment.manager_id.in_(team),
    )
    return or_(base, seen_by_team)


def _assigned_before(moment: datetime | None) -> ColumnElement[bool]:
    """черновик до назначения в отчёт не попадает (В3)"""
    condition = InteractionAssignment.interaction_id == Interaction.id
    if moment is not None:
        condition = condition & (InteractionAssignment.assigned_at < moment)
    return exists().where(condition)


async def load_facts(
    session: AsyncSession, actor: User, params, b_end: datetime
) -> Facts:
    stmt = (
        select(Interaction.id, Interaction.university_id, Interaction.no_return_at)
        .join(University, University.id == Interaction.university_id)
        .where(visible(actor), _assigned_before(b_end))
    )
    if params.university_ids:
        stmt = stmt.where(Interaction.university_id.in_(params.university_ids))
    if params.regions:
        stmt = stmt.where(University.region.in_(params.regions))
    heads = (await session.execute(stmt)).all()
    ids = [h.id for h in heads]
    if not ids:
        return Facts((), {}, {}, {}, {}, {}, {}, {}, {})

    universities = {
        u.id: (u.short_name, u.region)
        for u in await session.execute(
            select(University.id, University.short_name, University.region).where(
                University.id.in_({h.university_id for h in heads})
            )
        )
    }
    branches = (
        await session.execute(
            select(
                Branch.id,
                Branch.interaction_id,
                Branch.program_id,
                Branch.product_id,
                Branch.contract_status,
                Branch.opened_at,
                Branch.created_at,
                Branch.teachers_trained,
                Branch.transfer_status,
                Branch.license_until,
            ).where(Branch.interaction_id.in_(ids))
        )
    ).all()
    programs, directions, products = await _catalog(session, branches)
    # без comment: в комментариях бывают ПДн (IR10)
    history = (
        await session.execute(
            select(
                InteractionStageHistory.id,
                InteractionStageHistory.interaction_id,
                InteractionStageHistory.branch_id,
                InteractionStageHistory.side_pointer_id,
                InteractionStageHistory.kind,
                InteractionStageHistory.from_stage_id,
                InteractionStageHistory.to_stage_id,
                InteractionStageHistory.payload,
                InteractionStageHistory.created_at,
            )
            .where(
                InteractionStageHistory.interaction_id.in_(ids),
                InteractionStageHistory.created_at < b_end,
            )
            .order_by(InteractionStageHistory.id)
        )
    ).all()
    assignments = (
        await session.execute(
            select(
                InteractionAssignment.id,
                InteractionAssignment.interaction_id,
                InteractionAssignment.manager_id,
                InteractionAssignment.assigned_at,
                InteractionAssignment.released_at,
            )
            .where(
                InteractionAssignment.interaction_id.in_(ids),
                InteractionAssignment.assigned_at < b_end,
            )
            .order_by(InteractionAssignment.id)
        )
    ).all()
    stages = {
        s.id: StageFact(s.name, s.is_terminal, s.archived_at is not None)
        for s in await session.execute(
            select(Stage.id, Stage.name, Stage.is_terminal, Stage.archived_at).where(
                Stage.workflow_id.in_(
                    select(Interaction.workflow_id).where(Interaction.id.in_(ids))
                )
            )
        )
    }
    reasons = dict(
        (await session.execute(select(CloseReason.id, CloseReason.outcome))).all()
    )
    people = await _people(session, {a.manager_id for a in assignments} - {None})
    contracts = (
        await _contract_numbers(session, ids)
        if "contract_number" in params.columns
        else {}
    )
    extensions = (
        await _extensions(session, [b.id for b in branches], b_end)
        if "license_until" in params.columns
        else {}
    )

    events_of: dict[int, list[Event]] = {}
    for h in history:
        events_of.setdefault(h.interaction_id, []).append(
            Event(
                h.id,
                h.branch_id,
                h.side_pointer_id,
                h.kind,
                h.from_stage_id,
                h.to_stage_id,
                h.payload or {},
                h.created_at,
            )
        )
    branches_of: dict[int, list[BranchFact]] = {}
    for b in branches:
        branches_of.setdefault(b.interaction_id, []).append(
            BranchFact(
                b.id,
                b.program_id,
                b.product_id,
                b.contract_status,
                b.opened_at,
                b.created_at,
                b.teachers_trained,
                b.transfer_status,
                b.license_until,
            )
        )
    assignments_of: dict[int, list[Assignment]] = {}
    for a in assignments:
        assignments_of.setdefault(a.interaction_id, []).append(
            Assignment(a.id, a.manager_id, a.assigned_at, a.released_at)
        )
    interactions = tuple(
        InteractionFact(
            h.id,
            h.university_id,
            h.no_return_at,
            contracts.get(h.id),
            tuple(branches_of.get(h.id, ())),
            tuple(events_of.get(h.id, ())),
            tuple(assignments_of.get(h.id, ())),
        )
        for h in heads
    )
    return Facts(
        interactions,
        universities,
        programs,
        directions,
        products,
        stages,
        reasons,
        people,
        extensions,
    )


async def _catalog(session: AsyncSession, branches):
    program_ids = {b.program_id for b in branches} - {None}
    product_ids = {b.product_id for b in branches} - {None}
    programs = {
        p.id: (p.name, p.direction_id)
        for p in await session.execute(
            select(ItProgram.id, ItProgram.name, ItProgram.direction_id).where(
                ItProgram.id.in_(program_ids)
            )
        )
    }
    directions = dict(
        (
            await session.execute(
                select(ItDirection.id, ItDirection.name).where(
                    ItDirection.id.in_({d for _, d in programs.values()})
                )
            )
        ).all()
    )
    products = {
        p.id: f"{p.name} ({p.vendor})"
        for p in await session.execute(
            select(Product.id, Product.name, Vendor.name.label("vendor"))
            .join(Vendor, Vendor.id == Product.vendor_id)
            .where(Product.id.in_(product_ids))
        )
    }
    return programs, directions, products


async def _people(session: AsyncSession, user_ids: set[str]) -> dict[str, Person]:
    return {
        u.id: Person(u.last_name, u.first_name, u.patronymic, u.is_active)
        for u in await session.execute(
            select(
                User.id,
                User.last_name,
                User.first_name,
                User.patronymic,
                User.is_active,
            ).where(User.id.in_(user_ids))
        )
    }


async def _contract_numbers(session: AsyncSession, ids: list[int]) -> dict[int, str]:
    """действующий договор каждой заявки - как bindings.current_contract"""
    rows = await session.execute(
        select(InteractionDocument.interaction_id, InteractionDocument.contract_number)
        .where(
            InteractionDocument.interaction_id.in_(ids),
            InteractionDocument.kind == "CONTRACT",
            InteractionDocument.status == DocumentStatus.ACTIVE,
            ~replaced_expression(),
        )
        .order_by(InteractionDocument.interaction_id, InteractionDocument.id.desc())
        .distinct(InteractionDocument.interaction_id)
    )
    return {r.interaction_id: r.contract_number for r in rows}


async def _extensions(
    session: AsyncSession, branch_ids: list[int], b_end: datetime
) -> dict[int, tuple[Event, ...]]:
    """продления лицензии после B - старое значение на B лежит в первом (§7.7)"""
    rows = await session.execute(
        select(InteractionStageHistory)
        .where(
            InteractionStageHistory.branch_id.in_(branch_ids),
            InteractionStageHistory.kind == "LICENSE_EXTENDED",
            InteractionStageHistory.created_at >= b_end,
        )
        .order_by(InteractionStageHistory.id)
    )
    result: dict[int, list[Event]] = {}
    for (h,) in rows:
        result.setdefault(h.branch_id, []).append(
            Event(
                h.id,
                h.branch_id,
                h.side_pointer_id,
                h.kind,
                h.from_stage_id,
                h.to_stage_id,
                h.payload or {},
                h.created_at,
            )
        )
    return {k: tuple(v) for k, v in result.items()}


async def options(session: AsyncSession, actor: User) -> dict:
    """значения фильтров из видимых заявок, без периода (§8.3)"""
    visible_ids = select(Interaction.id).where(visible(actor), _assigned_before(None))
    universities = (
        await session.execute(
            select(University.id, University.short_name, University.region)
            .where(
                University.id.in_(
                    select(Interaction.university_id).where(
                        Interaction.id.in_(visible_ids)
                    )
                )
            )
            .order_by(University.short_name)
        )
    ).all()
    branches = (
        await session.execute(
            select(Branch.program_id, Branch.product_id).where(
                Branch.interaction_id.in_(visible_ids)
            )
        )
    ).all()
    programs, directions, products = await _catalog(session, branches)
    manager_ids = set(
        await session.scalars(
            select(InteractionAssignment.manager_id)
            .where(InteractionAssignment.interaction_id.in_(visible_ids))
            .distinct()
        )
    ) - {None}
    stages = (
        await session.execute(
            select(Stage.id, Stage.name, Stage.archived_at)
            .where(
                Stage.is_terminal.is_(False),
                Stage.workflow_id.in_(
                    select(Interaction.workflow_id).where(
                        Interaction.id.in_(visible_ids)
                    )
                ),
            )
            .order_by(Stage.workflow_id, Stage.position, Stage.id)
        )
    ).all()
    return {
        "universities": universities,
        "programs": programs,
        "directions": directions,
        "products": products,
        "people": await _people(session, manager_ids),
        "stages": stages,
    }
