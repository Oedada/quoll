"""Договор: состав веток и их открытие при подписании.

ветка - ИТ-программа и не больше одного её продукта. До точки невозврата
(подписания) ветки - черновик состава без стадии; при подписании одобренные
встают на начало шагов веток, и шаги 5-8 идут по ним независимо. Ветки своих
блокировок не имеют: всё - под блокировкой взаимодействия
"""

from sqlalchemy import and_, exists, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from quoll.auth.audit import record
from quoll.auth.audit_models import AuditEventType, TargetType
from quoll.catalog.models import ItProgram
from quoll.core.exceptions import DomainRuleException, OperationForbiddenException
from quoll.interactions.access_policy import can_change
from quoll.interactions.models import (
    Branch,
    ContractStatus,
    Interaction,
    InteractionStageHistory,
    StageChangeKind,
)
from quoll.interactions.scope import InteractionScope, lock_interaction_scope
from quoll.workflows.models import Stage, WorkflowTransition


async def is_signed(session: AsyncSession, interaction_id: int) -> bool:
    """прошла ли точка невозврата - после неё состав не меняется"""
    return bool(
        await session.scalar(
            select(
                exists()
                .where(InteractionStageHistory.interaction_id == interaction_id)
                .where(InteractionStageHistory.transition_id == WorkflowTransition.id)
                .where(WorkflowTransition.is_irreversible.is_(True))
            )
        )
    )


async def _draft_scope(
    session: AsyncSession, interaction_id: int, actor_id: str
) -> InteractionScope:
    scope = await lock_interaction_scope(session, interaction_id, actor_id)
    if not can_change(scope.actor, scope.ownership):
        raise OperationForbiddenException("change branches of this interaction")
    if await is_signed(session, interaction_id):
        raise DomainRuleException(
            409, "Contract is signed, branches change by a supplementary agreement"
        )
    return scope


async def check_pair(
    session: AsyncSession, program_id: int, product_id: int | None
) -> None:
    """программа из каталога, продукт - один из её продуктов"""
    program = await session.get(ItProgram, program_id)
    if program is None or not program.is_active:
        raise DomainRuleException(400, f"Program '{program_id}' is not in the catalog")
    if product_id is not None and product_id not in {
        p.id for p in program.products if p.is_active
    }:
        raise DomainRuleException(
            400, f"Product '{product_id}' is not a product of program '{program_id}'"
        )


async def draft_branch(
    session: AsyncSession,
    interaction_id: int,
    program_id: int,
    product_id: int | None,
    actor_id: str,
) -> Branch:
    """ветка-черновик состава; вызывающий уже держит заявку"""
    await check_pair(session, program_id, product_id)
    taken = await session.scalar(
        select(
            exists().where(
                Branch.interaction_id == interaction_id,
                Branch.program_id == program_id,
                Branch.product_id.is_not_distinct_from(product_id),
            )
        )
    )
    if taken:
        raise DomainRuleException(409, "This program and product are already here")
    branch = Branch(
        interaction_id=interaction_id,
        program_id=program_id,
        product_id=product_id,
        added_by=actor_id,
    )
    session.add(branch)
    await session.flush()
    _journal(
        session,
        actor_id,
        interaction_id,
        {"added": {"program_id": program_id, "product_id": product_id}},
    )
    await session.refresh(branch)
    return branch


async def add_branch(
    session: AsyncSession,
    *,
    interaction_id: int,
    program_id: int,
    product_id: int | None,
    actor_id: str,
) -> Branch:
    await _draft_scope(session, interaction_id, actor_id)
    return await draft_branch(session, interaction_id, program_id, product_id, actor_id)


async def set_status(
    session: AsyncSession,
    *,
    interaction_id: int,
    branch_id: int,
    status: ContractStatus,
    actor_id: str,
) -> Branch:
    await _draft_scope(session, interaction_id, actor_id)
    branch = await _draft(session, interaction_id, branch_id)
    old = branch.contract_status
    branch.contract_status = status
    await session.flush()
    _journal(
        session,
        actor_id,
        interaction_id,
        {"branch_id": branch.id, "contract_status": status},
        {"contract_status": old},
    )
    await session.refresh(branch)
    return branch


async def remove_branch(
    session: AsyncSession, *, interaction_id: int, branch_id: int, actor_id: str
) -> None:
    await _draft_scope(session, interaction_id, actor_id)
    branch = await _draft(session, interaction_id, branch_id)
    await session.delete(branch)
    await session.flush()
    _journal(
        session,
        actor_id,
        interaction_id,
        {"removed": {"program_id": branch.program_id, "product_id": branch.product_id}},
    )


async def _draft(session: AsyncSession, interaction_id: int, branch_id: int) -> Branch:
    branch = await session.get(Branch, branch_id)
    if branch is None or branch.interaction_id != interaction_id:
        raise DomainRuleException(404, "Branch is not in this interaction")
    return branch


def _journal(session, actor_id, interaction_id, new, old=None) -> None:
    record(
        session,
        actor_id=actor_id,
        event_type=AuditEventType.CONTRACT_PRODUCTS_CHANGED,
        target_type=TargetType.INTERACTION,
        target_id=interaction_id,
        old_value=old,
        new_value=new,
    )


async def open_branches(
    session: AsyncSession, interaction: Interaction, actor_id: str
) -> None:
    """подписание: одобренные ветки состава встают на начало шагов веток.
    Воркфлоу без веток - ничего не делаем"""
    start = await session.scalar(
        select(Stage).where(
            Stage.workflow_id == interaction.workflow_id,
            Stage.is_branch_start.is_(True),
            Stage.archived_at.is_(None),
        )
    )
    if start is None:
        return
    # ветки открываются один раз - повторный проход точки невозврата их не множит
    if await session.scalar(
        select(
            exists().where(
                Branch.interaction_id == interaction.id, Branch.state_id.is_not(None)
            )
        )
    ):
        return
    approved = list(
        await session.scalars(
            select(Branch)
            .where(
                Branch.interaction_id == interaction.id,
                Branch.contract_status == ContractStatus.APPROVED,
            )
            .order_by(Branch.id)
        )
    )
    if not approved:
        raise DomainRuleException(409, "Approve at least one branch before signing")
    for branch in approved:
        branch.state_id = start.id
        branch.opened_at = func.now()
        session.add(
            InteractionStageHistory(
                interaction_id=interaction.id,
                branch_id=branch.id,
                from_stage_id=None,
                to_stage_id=start.id,
                kind=StageChangeKind.TRANSITION,
                actor_id=actor_id,
                comment="contract signed",
            )
        )
    record(
        session,
        actor_id=actor_id,
        event_type=AuditEventType.BRANCHES_OPENED,
        target_type=TargetType.INTERACTION,
        target_id=interaction.id,
        new_value={"branches": [b.id for b in approved]},
    )


def is_open_branch():
    """ветка идёт по шагам: стоит на стадии и не закрыта. Без стадии - черновик"""
    return and_(Branch.state_id.is_not(None), Branch.closed_at.is_(None))


async def open_branch_count(session: AsyncSession, interaction_id: int) -> int:
    return (
        await session.scalar(
            select(func.count()).where(
                Branch.interaction_id == interaction_id, is_open_branch()
            )
        )
        or 0
    )


async def close_all_branches(
    session: AsyncSession, interaction_id: int, actor_id: str, comment: str
) -> None:
    """досрочное закрытие договора закрывает и ветки - с записью в историю
    каждой: переоткрытие вернёт именно эти"""
    for branch in await _branches(session, interaction_id, closed=False):
        branch.closed_at = func.now()
        _history(session, branch, StageChangeKind.CLOSE, actor_id, comment)


async def reopen_branches(
    session: AsyncSession, interaction_id: int, actor_id: str, comment: str
) -> None:
    """переоткрытие подписанного договора возвращает ветки, закрытые досрочно,
    - не дошедшие до своего конца"""
    for branch in await _branches(session, interaction_id, closed=True):
        stage = await session.get(Stage, branch.state_id)
        if not stage.is_terminal:
            branch.closed_at = None
            _history(session, branch, StageChangeKind.REOPEN, actor_id, comment)


async def _branches(
    session: AsyncSession, interaction_id: int, *, closed: bool
) -> list[Branch]:
    # черновики состава не закрываются и не переоткрываются
    condition = (
        and_(Branch.state_id.is_not(None), Branch.closed_at.is_not(None))
        if closed
        else is_open_branch()
    )
    return list(
        await session.scalars(
            select(Branch)
            .where(Branch.interaction_id == interaction_id, condition)
            .order_by(Branch.id)
        )
    )


def _history(session, branch, kind, actor_id, comment) -> None:
    session.add(
        InteractionStageHistory(
            interaction_id=branch.interaction_id,
            branch_id=branch.id,
            from_stage_id=branch.state_id,
            to_stage_id=branch.state_id,
            kind=kind,
            actor_id=actor_id,
            comment=comment,
        )
    )


async def branches(session: AsyncSession, interaction_id: int) -> list[Branch]:
    return list(
        await session.scalars(
            select(Branch)
            .where(Branch.interaction_id == interaction_id)
            .order_by(Branch.id)
        )
    )
