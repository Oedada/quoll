"""Операции над заявками. Каждая, кроме создания, начинается с захвата
области заявки под блокировкой - см. scope.py"""

from datetime import UTC, datetime

from sqlalchemy import func, update
from sqlalchemy.ext.asyncio import AsyncSession

from quoll.auth.audit import record
from quoll.auth.audit_models import AuditEventType, TargetType
from quoll.auth.keycloak_admin import verify_target
from quoll.auth.models import UserRole
from quoll.core import SystemDefaults
from quoll.core.exceptions import (
    DomainRuleException,
    OperationForbiddenException,
    StaleStateException,
    WorkflowNotPublishedException,
)
from quoll.interactions.access_policy import can_assign, can_pause
from quoll.interactions.capacity_policy import (
    assert_can_keep_working,
    assert_can_take_new_work,
    counts_toward_capacity,
)
from quoll.interactions.models import (
    Interaction,
    InteractionAssignment,
    PauseState,
)
from quoll.interactions.repository import InteractionRepository
from quoll.interactions.schemas import InteractionCreate
from quoll.interactions.scope import InteractionScope, lock_interaction_scope
from quoll.workflows.models import Stage
from quoll.workflows.repository import WorkflowRepository


async def create_interaction(
    session: AsyncSession, schema: InteractionCreate
) -> Interaction:
    """новая заявка рождается без владельца - назначает руководитель"""
    if schema.workflow_id is not None:
        workflow = await WorkflowRepository(session).get(schema.workflow_id)
        if not workflow.is_published:
            raise WorkflowNotPublishedException(workflow.id)
    return await InteractionRepository(session).create(schema)


async def assign(
    session: AsyncSession,
    *,
    interaction_id: int,
    actor_id: str,
    manager_id: str,
    expected_owner_id: str | None,
    reason: str | None,
) -> Interaction:
    """назначить или переназначить заявку менеджеру"""
    # до блокировок: поход в сеть под блокировкой держал бы строки
    await verify_target(manager_id, UserRole.MANAGER)

    scope = await lock_interaction_scope(
        session, interaction_id, actor_id, target_manager_ids=[manager_id]
    )
    interaction = scope.interaction
    if interaction.owner_id != expected_owner_id:
        raise StaleStateException("Interaction owner", interaction.owner_id)

    target = scope.managers.get(manager_id)
    if target is None:
        raise DomainRuleException(400, f"User '{manager_id}' is not a manager")
    if not can_assign(scope.actor, scope.owner, scope.owner_superviser, target):
        raise OperationForbiddenException("assign this interaction")
    if manager_id == interaction.owner_id:
        raise DomainRuleException(
            400, "Interaction is already assigned to this manager"
        )

    stage = await _stage_of(session, interaction)
    if stage is not None and stage.is_terminal:
        raise DomainRuleException(409, "Closed interaction is reopened, not reassigned")
    # G8: у владельца заявки всегда есть руководитель
    if target.superviser_id is None:
        raise DomainRuleException(409, f"Manager '{manager_id}' has no supervisor")

    delta = 1 if counts_toward_capacity(stage, interaction.is_paused) else 0
    await assert_can_take_new_work(session, target, delta)

    previous = interaction.owner_id
    interaction.owner_id = manager_id
    if previous is not None:
        interaction.last_owner_id = previous
    await _hand_over(session, interaction.id, manager_id, reason)
    record(
        session,
        actor_id=actor_id,
        event_type=AuditEventType.PROJECT_REASSIGNED,
        target_type=TargetType.INTERACTION,
        target_id=interaction.id,
        old_value={"owner_id": previous},
        new_value={"owner_id": manager_id, "reason": reason},
    )
    await session.flush()
    # updated_at ставит база - без refresh ответ полез бы за ним вне greenlet
    await session.refresh(interaction)
    return interaction


async def _stage_of(session: AsyncSession, interaction: Interaction) -> Stage | None:
    # связь state viewonly и ленивая - в async её не дёрнуть, читаем явно
    if interaction.state_id is None:
        return None
    return await session.get(Stage, interaction.state_id)


async def _hand_over(
    session: AsyncSession, interaction_id: int, manager_id: str, reason: str | None
) -> None:
    """единственное место, где пишется история назначений: закрыть открытую
    запись и открыть новую. Открытая запись всегда совпадает с владельцем"""
    await session.execute(
        update(InteractionAssignment)
        .where(
            InteractionAssignment.interaction_id == interaction_id,
            InteractionAssignment.released_at.is_(None),
        )
        .values(released_at=func.now())
    )
    session.add(
        InteractionAssignment(
            interaction_id=interaction_id, manager_id=manager_id, reason=reason
        )
    )


async def pause(
    session: AsyncSession,
    *,
    interaction_id: int,
    actor_id: str,
    until: datetime | None,
    comment: str,
) -> Interaction:
    """поставить на паузу или заменить паузу - продление и смена режима"""
    scope, _ = await _pausable(session, interaction_id, actor_id)
    interaction = scope.interaction
    if until is None and interaction.pause_state == PauseState.PAUSED_MANUAL:
        raise DomainRuleException(409, "Interaction is already paused without a term")
    if until is not None:
        _check_pause_term(until)

    old_state = interaction.pause_state
    interaction.is_paused = True
    interaction.pause_state = (
        PauseState.PAUSED_TIMED if until is not None else PauseState.PAUSED_MANUAL
    )
    interaction.paused_until = until
    interaction.pause_comment = comment
    record(
        session,
        actor_id=actor_id,
        event_type=AuditEventType.INTERACTION_PAUSED,
        target_type=TargetType.INTERACTION,
        target_id=interaction.id,
        old_value={"pause_state": old_state},
        new_value={
            "pause_state": interaction.pause_state,
            "until": until.isoformat() if until else None,
            "comment": comment,
        },
    )
    await session.flush()
    await session.refresh(interaction)
    return interaction


async def unpause(
    session: AsyncSession, *, interaction_id: int, actor_id: str
) -> Interaction:
    scope, stage = await _pausable(session, interaction_id, actor_id)
    interaction = scope.interaction
    if not interaction.is_paused:
        raise DomainRuleException(409, "Interaction is not paused")
    if scope.owner is None:
        raise DomainRuleException(409, "Assign a manager before resuming")
    # слот возвращается, только если стадия его занимает
    delta = int(counts_toward_capacity(stage, False)) - int(
        counts_toward_capacity(stage, True)
    )
    await assert_can_keep_working(session, scope.owner, delta)

    old_state = interaction.pause_state
    interaction.is_paused = False
    interaction.pause_state = PauseState.ACTIVE
    interaction.paused_until = None
    interaction.pause_comment = None
    record(
        session,
        actor_id=actor_id,
        event_type=AuditEventType.INTERACTION_UNPAUSED,
        target_type=TargetType.INTERACTION,
        target_id=interaction.id,
        old_value={"pause_state": old_state},
        new_value={"pause_state": PauseState.ACTIVE},
    )
    await session.flush()
    await session.refresh(interaction)
    return interaction


async def _pausable(
    session: AsyncSession, interaction_id: int, actor_id: str
) -> tuple[InteractionScope, Stage]:
    """общее у паузы и снятия: права и стадия, на которой пауза имеет смысл"""
    scope = await lock_interaction_scope(session, interaction_id, actor_id)
    interaction = scope.interaction
    owner_superviser_id = scope.owner.superviser_id if scope.owner else None
    if not can_pause(scope.actor, interaction.owner_id, owner_superviser_id):
        raise OperationForbiddenException("pause this interaction")
    stage = await _stage_of(session, interaction)
    # пауза управляет слотом, а у черновика его нет
    if stage is None:
        raise DomainRuleException(409, "Draft without a stage cannot be paused")
    if stage.is_terminal:
        raise DomainRuleException(409, "Closed interaction cannot be paused")
    return scope, stage


def _check_pause_term(until: datetime) -> None:
    if until.tzinfo is None:
        raise DomainRuleException(400, "Pause term must include a timezone")
    hours = (until - datetime.now(UTC)).total_seconds() / 3600
    if not SystemDefaults.MIN_PAUSE_HOURS <= hours <= SystemDefaults.MAX_PAUSE_HOURS:
        raise DomainRuleException(
            400,
            f"Pause term must be {SystemDefaults.MIN_PAUSE_HOURS}-"
            f"{SystemDefaults.MAX_PAUSE_HOURS} hours ahead",
        )
