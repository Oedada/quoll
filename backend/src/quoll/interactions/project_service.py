"""Операции над заявками. Каждая, кроме создания, начинается с захвата
области заявки под блокировкой - см. scope.py"""

from datetime import UTC, datetime

from sqlalchemy import func, select, update
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
from quoll.interactions.access_policy import can_assign, can_delete, can_pause
from quoll.interactions.capacity_policy import (
    assert_can_keep_working,
    assert_can_take_new_work,
    counts_toward_capacity,
)
from quoll.interactions.models import (
    Interaction,
    InteractionAssignment,
    PauseState,
    StageChangeKind,
)
from quoll.interactions.notify import notify
from quoll.interactions.repository import InteractionRepository
from quoll.interactions.requests import cancel_pending_requests
from quoll.interactions.schemas import InteractionCreate, InteractionUpdate
from quoll.interactions.scope import InteractionScope, lock_interaction_scope
from quoll.interactions.transition_service import (
    lock_target_stage,
    place,
    reached_since_no_return,
)
from quoll.workflows.graph_policy import EdgeFacts, reachable_from_start
from quoll.workflows.models import Stage, WorkflowTransition
from quoll.workflows.repository import WorkflowRepository


async def create_interaction(
    session: AsyncSession, schema: InteractionCreate, author_id: str
) -> Interaction:
    """новая заявка рождается без владельца, черновиком автора - пока он
    её не назначит, другим руководителям она не видна"""
    if schema.workflow_id is not None:
        workflow = await WorkflowRepository(session).get(schema.workflow_id)
        if not workflow.is_published:
            raise WorkflowNotPublishedException(workflow.id)
    return await InteractionRepository(session).create(
        schema.model_dump() | {"created_by": author_id}
    )


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
    return await assign_locked(
        session,
        scope,
        manager_id=manager_id,
        expected_owner_id=expected_owner_id,
        reason=reason,
    )


async def assign_locked(
    session: AsyncSession,
    scope: InteractionScope,
    *,
    manager_id: str,
    expected_owner_id: str | None,
    reason: str | None,
    by_import: bool = False,
) -> Interaction:
    """назначение под уже захваченной областью - его зовёт и одобрение
    просьбы о передаче. Цель в Keycloak проверена до блокировок.

    by_import - перенос реестра админом: право руководителя не проверяется,
    остальные правила те же"""
    interaction = scope.interaction
    actor_id = scope.actor.id
    if interaction.owner_id != expected_owner_id:
        raise StaleStateException("Interaction owner", interaction.owner_id)

    target = scope.managers.get(manager_id)
    if target is None:
        raise DomainRuleException(400, f"User '{manager_id}' is not a manager")
    if not by_import and not can_assign(scope.actor, scope.ownership, target):
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
    # у нового владельца свои просьбы - старые устарели
    await cancel_pending_requests(
        session, interaction.id, actor_id, "interaction owner changed"
    )
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


async def _release(session: AsyncSession, interaction_id: int) -> None:
    await session.execute(
        update(InteractionAssignment)
        .where(
            InteractionAssignment.interaction_id == interaction_id,
            InteractionAssignment.released_at.is_(None),
        )
        .values(released_at=func.now())
    )


async def _hand_over(
    session: AsyncSession, interaction_id: int, manager_id: str, reason: str | None
) -> None:
    """единственное место, где пишется история назначений: закрыть открытую
    запись и открыть новую. Открытая запись всегда совпадает с владельцем"""
    await _release(session, interaction_id)
    session.add(
        InteractionAssignment(
            interaction_id=interaction_id, manager_id=manager_id, reason=reason
        )
    )


async def decline(
    session: AsyncSession, *, interaction_id: int, actor_id: str, comment: str
) -> Interaction:
    """менеджер отказывается от ещё не принятой заявки - она возвращается
    черновиком к автору. От принятой отказываются просьбой о передаче"""
    scope = await lock_interaction_scope(session, interaction_id, actor_id)
    interaction = scope.interaction
    if interaction.owner_id != actor_id:
        raise OperationForbiddenException("decline this interaction")
    if interaction.state_id is not None:
        raise DomainRuleException(
            409, "Accepted interaction is not declined, ask for a transfer"
        )
    interaction.owner_id = None
    interaction.last_owner_id = actor_id
    await _release(session, interaction.id)
    await cancel_pending_requests(
        session, interaction.id, actor_id, "interaction declined"
    )
    # причину видит автор: журнал читает только админ
    notify(
        session,
        interaction.created_by,
        "Менеджер отказался от заявки",
        f"Взаимодействие {interaction.id}: {comment}",
        {"interaction_id": interaction.id},
    )
    record(
        session,
        actor_id=actor_id,
        event_type=AuditEventType.PROJECT_DECLINED,
        target_type=TargetType.INTERACTION,
        target_id=interaction.id,
        old_value={"owner_id": actor_id},
        new_value={"owner_id": None, "comment": comment},
    )
    await session.flush()
    await session.refresh(interaction)
    return interaction


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
    resume(session, interaction, actor_id)
    await session.flush()
    await session.refresh(interaction)
    return interaction


def resume(
    session: AsyncSession, interaction: Interaction, actor_id: str | None
) -> None:
    """снять паузу - руками или воркером по истечении срока. Ёмкость проверяет
    вызывающий, у него заблокирована строка менеджера"""
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


async def _pausable(
    session: AsyncSession, interaction_id: int, actor_id: str
) -> tuple[InteractionScope, Stage]:
    """общее у паузы и снятия: права и стадия, на которой пауза имеет смысл"""
    scope = await lock_interaction_scope(session, interaction_id, actor_id)
    interaction = scope.interaction
    if not can_pause(scope.actor, scope.ownership):
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


async def update_fields(
    session: AsyncSession,
    interaction: Interaction,
    changes: InteractionUpdate,
    actor_id: str,
) -> Interaction:
    """описательные поля: права проверил роутер, блокировка не нужна -
    на них не опирается ни одно правило"""
    fields = changes.model_dump(exclude_unset=True)
    old = {name: getattr(interaction, name) for name in fields}
    updated = await InteractionRepository(session).update(interaction.id, changes)
    if fields:
        record(
            session,
            actor_id=actor_id,
            event_type=AuditEventType.INTERACTION_UPDATED,
            target_type=TargetType.INTERACTION,
            target_id=str(interaction.id),
            old_value=old,
            new_value=fields,
        )
    return updated


async def delete_draft(
    session: AsyncSession, *, interaction_id: int, actor_id: str
) -> None:
    """удалить можно только черновик, ни разу не встававший на стадию - у него
    нет истории. Остальное закрывают: каскад стёр бы историю и назначения.
    Проверки - под блокировкой: черновик могли успеть поставить на стадию"""
    scope = await lock_interaction_scope(session, interaction_id, actor_id)
    if not can_delete(scope.actor, scope.ownership):
        raise OperationForbiddenException("delete this interaction")
    if scope.interaction.state_id is not None:
        raise DomainRuleException(409, "Only a draft can be deleted, close the rest")
    record(
        session,
        actor_id=actor_id,
        event_type=AuditEventType.INTERACTION_DELETED,
        target_type=TargetType.INTERACTION,
        target_id=str(interaction_id),
        old_value={"owner_id": scope.interaction.owner_id},
    )
    await InteractionRepository(session).delete(interaction_id)


async def reopen(
    session: AsyncSession,
    *,
    interaction_id: int,
    actor_id: str,
    manager_id: str,
    to_stage_id: int,
    expected_owner_id: str | None,
    comment: str,
) -> Interaction:
    """вернуть закрытую заявку в работу: владелец и стадия выбираются явно -
    за время простоя прежний мог уволиться или заполниться. Ребро не нужно,
    но стадия должна быть достижима из начальной - иначе тупик"""
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
    # права те же, что у назначения: иначе чужую закрытую забирали бы перебором id
    if not can_assign(scope.actor, scope.ownership, target):
        raise OperationForbiddenException("reopen this interaction")

    current = await _stage_of(session, interaction)
    if current is None or not current.is_terminal:
        raise DomainRuleException(409, "Only a closed interaction is reopened")
    # флаги стадии неизменны (Р15) - проверяем до блокировки. Иначе запрос в
    # текущую закрытую стадию держал бы заявку на ней и ждал бы её саму, а
    # архивация этой стадии - наоборот
    requested = await session.get(Stage, to_stage_id)
    if requested is not None and (requested.is_terminal or requested.is_branch_stage):
        raise DomainRuleException(400, "Interaction is reopened into a working stage")
    stage = await lock_target_stage(session, to_stage_id)
    if stage.workflow_id != interaction.workflow_id:
        raise DomainRuleException(400, "Stage belongs to another workflow")
    edges = await session.scalars(
        select(WorkflowTransition).where(
            WorkflowTransition.workflow_id == stage.workflow_id,
            WorkflowTransition.is_active.is_(True),
        )
    )
    reachable = reachable_from_start(
        [EdgeFacts(e.from_stage_id, e.to_stage_id) for e in edges]
    )
    if stage.id not in reachable:
        raise DomainRuleException(409, "Stage is not reachable from the start")
    # только туда, где заявка уже была: иначе переоткрытие перескочило бы
    # аппрувы и обязательные файлы, а после подписания - вернуло бы в первую часть
    if not await reached_since_no_return(session, interaction.id, stage.id):
        raise DomainRuleException(
            409, "Reopen goes only to a stage passed after the point of no return"
        )
    if target.superviser_id is None:
        raise DomainRuleException(409, f"Manager '{manager_id}' has no supervisor")
    await assert_can_take_new_work(
        session, target, int(counts_toward_capacity(stage, False))
    )

    previous_owner = interaction.owner_id
    if manager_id != previous_owner:
        # на прежнего - без новой записи: открытая запись и так его
        interaction.owner_id = manager_id
        if previous_owner is not None:
            interaction.last_owner_id = previous_owner
        await _hand_over(session, interaction.id, manager_id, comment)
    place(
        session,
        interaction,
        current,
        stage,
        kind=StageChangeKind.REOPEN,
        transition_id=None,
        actor_id=actor_id,
        comment=comment,
    )
    record(
        session,
        actor_id=actor_id,
        event_type=AuditEventType.PROJECT_REOPENED,
        target_type=TargetType.INTERACTION,
        target_id=interaction.id,
        old_value={"state_id": current.id, "owner_id": previous_owner},
        new_value={"state_id": stage.id, "owner_id": manager_id, "comment": comment},
    )
    await session.flush()
    await session.refresh(interaction)
    return interaction
