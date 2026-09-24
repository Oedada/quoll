"""Переход заявки по стадиям воркфлоу - только по активному ребру графа.

досрочное закрытие и переоткрытие идут без ребра, это отдельные операции
"""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from quoll.auth.audit import record
from quoll.auth.audit_models import AuditEventType, TargetType
from quoll.core.exceptions import (
    DomainRuleException,
    OperationForbiddenException,
    StaleStateException,
    WorkflowNotPublishedException,
)
from quoll.interactions.access_policy import can_change
from quoll.interactions.capacity_policy import (
    assert_can_keep_working,
    counts_toward_capacity,
)
from quoll.interactions.models import (
    Interaction,
    InteractionStageHistory,
    PauseState,
    StageChangeKind,
)
from quoll.interactions.scope import lock_interaction_scope
from quoll.workflows.models import Stage, Workflow, WorkflowTransition


async def transition(
    session: AsyncSession,
    *,
    interaction_id: int,
    actor_id: str,
    to_stage_id: int,
    expected_state_id: int | None,
    comment: str | None,
) -> Interaction:
    scope = await lock_interaction_scope(session, interaction_id, actor_id)
    interaction = scope.interaction
    if interaction.state_id != expected_state_id:
        raise StaleStateException("Interaction stage", interaction.state_id)

    if not can_change(scope.actor, scope.ownership):
        raise OperationForbiddenException("move this interaction")

    current = (
        await session.get(Stage, interaction.state_id) if interaction.state_id else None
    )
    if current is not None and current.is_terminal:
        raise DomainRuleException(409, "Closed interaction is reopened, not moved")

    # FOR SHARE: целевую стадию не должны поменять, пока мы на неё переходим
    target = (
        await session.execute(
            select(Stage).where(Stage.id == to_stage_id).with_for_update(read=True)
        )
    ).scalar_one_or_none()
    if target is None:
        raise DomainRuleException(400, f"Stage '{to_stage_id}' does not exist")

    # черновик без воркфлоу получает его первым переходом - иначе остался
    # бы черновиком навсегда: воркфлоу задаётся только при создании
    workflow_id = interaction.workflow_id or target.workflow_id
    if target.workflow_id != workflow_id:
        raise DomainRuleException(400, "Stage belongs to another workflow")
    workflow = await session.get(Workflow, workflow_id)
    if workflow is None or not workflow.is_published:
        raise WorkflowNotPublishedException(workflow_id)

    edge = await _active_edge(session, workflow_id, current, target)
    if edge is None:
        raise DomainRuleException(409, "No active transition between these stages")
    # заявка не едет по нетерминальным стадиям без ответственного
    if not target.is_terminal and interaction.owner_id is None:
        raise DomainRuleException(409, "Assign a manager before moving the interaction")

    if scope.owner is not None:
        # закрытие сбрасывает паузу, поэтому вклад цели считаем без неё
        paused_after = interaction.is_paused and not target.is_terminal
        delta = int(counts_toward_capacity(target, paused_after)) - int(
            counts_toward_capacity(current, interaction.is_paused)
        )
        await assert_can_keep_working(session, scope.owner, delta)

    interaction.workflow_id = workflow_id
    interaction.state_id = target.id
    if target.is_terminal and interaction.is_paused:
        # закрытая заявка на паузе - бессмыслица
        interaction.is_paused = False
        interaction.pause_state = PauseState.ACTIVE
        interaction.paused_until = None
        interaction.pause_comment = None

    session.add(
        InteractionStageHistory(
            interaction_id=interaction.id,
            from_stage_id=current.id if current else None,
            to_stage_id=target.id,
            transition_id=edge.id,
            kind=StageChangeKind.TRANSITION,
            actor_id=actor_id,
            comment=comment,
        )
    )
    record(
        session,
        actor_id=actor_id,
        event_type=AuditEventType.STAGE_TRANSITIONED,
        target_type=TargetType.INTERACTION,
        target_id=interaction.id,
        old_value={"state_id": current.id if current else None},
        new_value={"state_id": target.id, "transition_id": edge.id},
    )
    await session.flush()
    await session.refresh(interaction)
    return interaction


async def _active_edge(
    session: AsyncSession, workflow_id: int, current: Stage | None, target: Stage
) -> WorkflowTransition | None:
    """ребро графа; у черновика - из NULL, то есть в начальную стадию (П3)"""
    stmt = select(WorkflowTransition).where(
        WorkflowTransition.workflow_id == workflow_id,
        WorkflowTransition.from_stage_id == (current.id if current else None),
        WorkflowTransition.to_stage_id == target.id,
        WorkflowTransition.is_active.is_(True),
    )
    return (await session.execute(stmt)).scalars().first()
