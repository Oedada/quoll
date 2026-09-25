"""Ход ветки продукта: те же рёбра, правила шага и аппрувы, что у договора,
но поля, файлы и история - свои у каждой ветки. Возврат в шагах ветки
затрагивает только её продукт.

своих блокировок нет: всё под блокировкой взаимодействия
"""

from sqlalchemy import exists, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from quoll.auth.audit import record
from quoll.auth.audit_models import AuditEventType, TargetType
from quoll.core.exceptions import (
    DomainRuleException,
    OperationForbiddenException,
    StaleStateException,
)
from quoll.interactions.access_policy import can_change, can_close
from quoll.interactions.models import (
    InteractionBranch,
    InteractionStageHistory,
    StageChangeKind,
)
from quoll.interactions.notify import notify
from quoll.interactions.scope import InteractionScope, lock_interaction_scope
from quoll.interactions.transition_service import (
    active_edge,
    check_step,
    lock_target_stage,
)
from quoll.workflows.graph_policy import EdgeFacts, leads_to
from quoll.workflows.models import Stage, WorkflowTransition


async def open_branch(
    session: AsyncSession, scope: InteractionScope, branch_id: int
) -> InteractionBranch:
    branch = await session.get(InteractionBranch, branch_id, populate_existing=True)
    if branch is None or branch.interaction_id != scope.interaction.id:
        raise DomainRuleException(404, "Branch is not in this interaction")
    if branch.closed_at is not None:
        raise DomainRuleException(409, "Branch is closed")
    return branch


async def move(
    session: AsyncSession,
    *,
    interaction_id: int,
    branch_id: int,
    actor_id: str,
    to_stage_id: int,
    expected_state_id: int,
    comment: str | None,
) -> InteractionBranch:
    scope = await lock_interaction_scope(session, interaction_id, actor_id)
    if not can_change(scope.actor, scope.ownership):
        raise OperationForbiddenException("move this interaction")
    branch = await open_branch(session, scope, branch_id)
    if branch.state_id != expected_state_id:
        raise StaleStateException("Branch stage", branch.state_id)
    return await move_locked(
        session, scope, branch, to_stage_id=to_stage_id, comment=comment, approved=False
    )


async def move_locked(
    session: AsyncSession,
    scope: InteractionScope,
    branch: InteractionBranch,
    *,
    to_stage_id: int,
    comment: str | None,
    approved: bool,
) -> InteractionBranch:
    """ход ветки по ребру; его зовёт и одобрение аппрува"""
    interaction = scope.interaction
    if to_stage_id == branch.state_id:
        raise DomainRuleException(409, "Branch is already on this stage")
    current = await session.get(Stage, branch.state_id)
    target = await lock_target_stage(session, to_stage_id)
    if target.workflow_id != interaction.workflow_id or not target.is_branch_stage:
        raise DomainRuleException(400, "Branch moves along branch stages")
    edge = await active_edge(session, interaction.workflow_id, current, target)
    if edge is None:
        raise DomainRuleException(409, "No active transition between these stages")
    if edge.is_backward and not comment:
        raise DomainRuleException(422, "Backward transition needs a comment")
    await check_step(
        session, interaction, current, edge, approved=approved, branch_id=branch.id
    )
    if edge.is_backward and scope.owner is not None:
        notify(
            session,
            scope.owner.superviser_id,
            "Возврат на шаг назад",
            f"Взаимодействие {interaction.id}, ветка {branch.id}: "
            f"{current.name} → {target.name}. {comment}",
            {"interaction_id": interaction.id, "branch_id": branch.id},
        )
    return await _place(
        session,
        scope,
        branch,
        current,
        target,
        kind=StageChangeKind.TRANSITION,
        transition_id=edge.id,
        comment=comment,
    )


async def return_locked(
    session: AsyncSession,
    scope: InteractionScope,
    branch: InteractionBranch,
    *,
    to_stage_id: int,
    kind: StageChangeKind,
    comment: str,
) -> InteractionBranch:
    """без ребра: отказ в аппруве шага ветки, откат руководителем"""
    current = await session.get(Stage, branch.state_id)
    target = await lock_target_stage(session, to_stage_id)
    if (
        target.workflow_id != scope.interaction.workflow_id
        or not target.is_branch_stage
        or target.is_terminal
    ):
        raise DomainRuleException(400, "Return goes to a working branch stage")
    return await _place(
        session,
        scope,
        branch,
        current,
        target,
        kind=kind,
        transition_id=None,
        comment=comment,
    )


async def rollback(
    session: AsyncSession,
    *,
    interaction_id: int,
    branch_id: int,
    actor_id: str,
    to_stage_id: int,
    expected_state_id: int,
    comment: str,
) -> InteractionBranch:
    """руководитель возвращает ветку на несколько шагов - только назад и
    только туда, где она уже была"""
    scope = await lock_interaction_scope(session, interaction_id, actor_id)
    if not can_close(scope.actor, scope.ownership):
        raise OperationForbiddenException("roll back this interaction")
    branch = await open_branch(session, scope, branch_id)
    if branch.state_id != expected_state_id:
        raise StaleStateException("Branch stage", branch.state_id)
    if to_stage_id == branch.state_id:
        raise DomainRuleException(409, "Branch is already on this stage")
    visited = await session.scalar(
        select(
            exists().where(
                InteractionStageHistory.branch_id == branch.id,
                InteractionStageHistory.to_stage_id == to_stage_id,
            )
        )
    )
    edges = await session.scalars(
        select(WorkflowTransition).where(
            WorkflowTransition.workflow_id == scope.interaction.workflow_id,
            WorkflowTransition.is_active.is_(True),
            WorkflowTransition.is_backward.is_(False),
        )
    )
    facts = [EdgeFacts(e.from_stage_id, e.to_stage_id) for e in edges]
    if not visited or not leads_to(facts, to_stage_id, branch.state_id):
        raise DomainRuleException(
            409, "Rollback goes back to a stage the branch passed"
        )
    return await return_locked(
        session,
        scope,
        branch,
        to_stage_id=to_stage_id,
        kind=StageChangeKind.ROLLBACK,
        comment=comment,
    )


async def _place(
    session: AsyncSession,
    scope: InteractionScope,
    branch: InteractionBranch,
    current: Stage,
    target: Stage,
    *,
    kind: StageChangeKind,
    transition_id: int | None,
    comment: str | None,
) -> InteractionBranch:
    branch.state_id = target.id
    if target.is_terminal:
        branch.closed_at = func.now()
    session.add(
        InteractionStageHistory(
            interaction_id=scope.interaction.id,
            branch_id=branch.id,
            from_stage_id=current.id,
            to_stage_id=target.id,
            transition_id=transition_id,
            kind=kind,
            actor_id=scope.actor.id,
            comment=comment,
        )
    )
    record(
        session,
        actor_id=scope.actor.id,
        event_type=AuditEventType.BRANCH_TRANSITIONED,
        target_type=TargetType.INTERACTION,
        target_id=scope.interaction.id,
        old_value={"branch_id": branch.id, "state_id": current.id},
        new_value={"state_id": target.id, "kind": kind},
    )
    await session.flush()
    await session.refresh(branch)
    return branch
