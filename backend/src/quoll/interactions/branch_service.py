"""Ход ветки продукта: те же рёбра, правила шага и аппрувы, что у договора,
но поля, файлы и история - свои у каждой ветки. Возврат в шагах ветки
затрагивает только её продукт.

своих блокировок нет: всё под блокировкой взаимодействия
"""

from datetime import datetime

from sqlalchemy import exists, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from quoll.auth.audit import record
from quoll.auth.audit_models import AuditEventType, TargetType
from quoll.catalog.models import CloseLevel
from quoll.core.exceptions import (
    DomainRuleException,
    OperationForbiddenException,
    StaleStateException,
)
from quoll.interactions.access_policy import can_change, can_close, can_pause
from quoll.interactions.close_reasons import check_reason
from quoll.interactions.contract_service import open_branch_count, unpause_branch
from quoll.interactions.models import (
    Branch,
    InteractionStageHistory,
    PauseState,
    StageChangeKind,
)
from quoll.interactions.notify import notify
from quoll.interactions.pause_policy import check_pause_term
from quoll.interactions.scope import InteractionScope, lock_interaction_scope
from quoll.interactions.transition_service import (
    active_edge,
    check_step,
    lock_target_stage,
    share_stage,
)
from quoll.notifications import kinds
from quoll.notifications.kinds import Subject
from quoll.workflows.graph_policy import EdgeFacts, leads_to
from quoll.workflows.models import Stage, WorkflowTransition


async def open_branch(
    session: AsyncSession, scope: InteractionScope, branch_id: int
) -> Branch:
    branch = await session.get(Branch, branch_id, populate_existing=True)
    if branch is None or branch.interaction_id != scope.interaction.id:
        raise DomainRuleException(404, "Branch is not in this interaction")
    if branch.state_id is None:
        raise DomainRuleException(409, "Branch is a draft until the contract is signed")
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
) -> Branch:
    await share_stage(session, to_stage_id)
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
    branch: Branch,
    *,
    to_stage_id: int,
    comment: str | None,
    approved: bool,
) -> Branch:
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
    if edge.is_backward:
        await notify(
            session,
            kinds.BACKWARD_MOVE,
            scope,
            context={
                "branch": f", ветка {branch.id}",
                "from_stage": current.name,
                "to_stage": target.name,
                "comment": comment,
            },
            subject=Subject.BRANCH,
            subject_id=branch.id,
            payload={"branch_id": branch.id},
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
    branch: Branch,
    *,
    to_stage_id: int,
    kind: StageChangeKind,
    comment: str,
) -> Branch:
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
) -> Branch:
    """руководитель возвращает ветку на несколько шагов - только назад и
    только туда, где она уже была"""
    await share_stage(session, to_stage_id)
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


async def close(
    session: AsyncSession,
    *,
    interaction_id: int,
    branch_id: int,
    actor_id: str,
    close_reason_id: int,
    comment: str | None,
) -> Branch:
    """руководитель владельца закрывает ветку сам; менеджер - просьбой"""
    scope = await lock_interaction_scope(session, interaction_id, actor_id)
    if not can_close(scope.actor, scope.ownership):
        raise OperationForbiddenException("close this branch")
    branch = await open_branch(session, scope, branch_id)
    return await close_locked(
        session, scope, branch, close_reason_id=close_reason_id, comment=comment
    )


async def close_locked(
    session: AsyncSession,
    scope: InteractionScope,
    branch: Branch,
    *,
    close_reason_id: int,
    comment: str | None,
    allow_system_reason: bool = False,
    offer: bool = True,
    closed_at: datetime | None = None,
) -> Branch:
    """досрочно: ветка остаётся на своём шаге, закрыта причиной (П6).

    closed_at - момент закрытия и записи истории для импорта (§19.4);
    offer=False - импорт не предлагает руководителю закрыть заявку"""
    reason = await check_reason(
        session,
        close_reason_id,
        CloseLevel.BRANCH,
        comment,
        allow_system=allow_system_reason,
    )
    actor_id = scope.actor.id if scope.actor else None
    branch.closed_at = closed_at or func.now()
    unpause_branch(branch)
    branch.close_reason_id = reason.id
    history = InteractionStageHistory(
        interaction_id=branch.interaction_id,
        branch_id=branch.id,
        from_stage_id=branch.state_id,
        to_stage_id=branch.state_id,
        kind=StageChangeKind.CLOSE,
        actor_id=actor_id,
        comment=comment,
        payload={"close_reason_id": reason.id},
    )
    if closed_at is not None:
        history.created_at = closed_at
    session.add(history)
    record(
        session,
        actor_id=actor_id,
        event_type=AuditEventType.BRANCH_CLOSED,
        target_type=TargetType.INTERACTION,
        target_id=scope.interaction.id,
        new_value={"branch_id": branch.id, "reason": reason.code, "comment": comment},
    )
    await session.flush()
    if offer:
        await _offer_to_close(session, scope)
    await session.refresh(branch)
    return branch


async def _offer_to_close(session: AsyncSession, scope: InteractionScope) -> None:
    """последняя ветка закрыта - заявка сама не закрывается: вуз может ещё
    взять продукт допсоглашением. Руководителю - предложение (О 4)"""
    if scope.owner is None or await open_branch_count(session, scope.interaction.id):
        return
    await notify(session, kinds.ALL_BRANCHES_CLOSED, scope)


async def _place(
    session: AsyncSession,
    scope: InteractionScope,
    branch: Branch,
    current: Stage,
    target: Stage,
    *,
    kind: StageChangeKind,
    transition_id: int | None,
    comment: str | None,
) -> Branch:
    branch.state_id = target.id
    branch.stall_since = func.now()
    if target.is_terminal:
        branch.closed_at = func.now()
        unpause_branch(branch)
        branch.close_reason_id = None
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
    if target.is_terminal:
        await _offer_to_close(session, scope)
    await session.refresh(branch)
    return branch


async def pause(
    session: AsyncSession,
    *,
    interaction_id: int,
    branch_id: int,
    actor_id: str,
    until: datetime | None,
    comment: str,
) -> Branch:
    """пауза одной ветки (10.2/16): слот КАМа не трогает - он у заявки"""
    scope = await lock_interaction_scope(session, interaction_id, actor_id)
    if not can_pause(scope.actor, scope.ownership):
        raise OperationForbiddenException("pause this branch")
    branch = await open_branch(session, scope, branch_id)
    return await pause_locked(session, scope, branch, until=until, comment=comment)


async def pause_locked(
    session: AsyncSession,
    scope: InteractionScope,
    branch: Branch,
    *,
    until: datetime | None,
    comment: str,
) -> Branch:
    """пауза под уже захваченной областью; права и открытость ветки - у
    вызывающего (у импорта - свои проверки, §19.2)"""
    actor_id = scope.actor.id if scope.actor else None
    if until is None and branch.pause_state == PauseState.PAUSED_MANUAL:
        raise DomainRuleException(409, "Branch is already paused without a term")
    if until is not None:
        check_pause_term(until)
    old = branch.pause_state
    branch.pause_state = (
        PauseState.PAUSED_TIMED if until is not None else PauseState.PAUSED_MANUAL
    )
    branch.paused_until = until
    branch.pause_comment = comment
    _branch_event(session, branch, StageChangeKind.PAUSE, actor_id, comment)
    record(
        session,
        actor_id=actor_id,
        event_type=AuditEventType.BRANCH_PAUSED,
        target_type=TargetType.INTERACTION,
        target_id=scope.interaction.id,
        old_value={"branch_id": branch.id, "pause_state": old},
        new_value={
            "pause_state": branch.pause_state,
            "until": until.isoformat() if until else None,
            "comment": comment,
        },
    )
    await session.flush()
    await session.refresh(branch)
    return branch


async def unpause(
    session: AsyncSession, *, interaction_id: int, branch_id: int, actor_id: str
) -> Branch:
    scope = await lock_interaction_scope(session, interaction_id, actor_id)
    if not can_pause(scope.actor, scope.ownership):
        raise OperationForbiddenException("resume this branch")
    branch = await open_branch(session, scope, branch_id)
    if branch.pause_state == PauseState.ACTIVE:
        raise DomainRuleException(409, "Branch is not paused")
    resume_branch(session, branch, actor_id)
    await session.flush()
    await session.refresh(branch)
    return branch


def resume_branch(session: AsyncSession, branch: Branch, actor_id: str | None) -> None:
    """снять паузу ветки - руками или воркером; застой считается заново"""
    unpause_branch(branch)
    branch.stall_since = func.now()
    _branch_event(session, branch, StageChangeKind.UNPAUSE, actor_id, None)
    record(
        session,
        actor_id=actor_id,
        event_type=AuditEventType.BRANCH_UNPAUSED,
        target_type=TargetType.INTERACTION,
        target_id=branch.interaction_id,
        new_value={"branch_id": branch.id},
    )


def _branch_event(session, branch: Branch, kind, actor_id, comment) -> None:
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
