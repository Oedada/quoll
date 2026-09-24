"""Операции оргструктуры. Порядок блокировок - Superviser -> Manager -> User,
как в core/locking.py; проверки - под блокировкой, до изменения"""

from dataclasses import dataclass

from sqlalchemy.ext.asyncio import AsyncSession

from quoll.auth.audit import record
from quoll.auth.audit_models import AuditEventType, TargetType
from quoll.auth.identity_policy import identity_denial, is_incapacitated
from quoll.auth.keycloak_admin import verify_target
from quoll.auth.models import Manager, Superviser, User, UserRole
from quoll.core.exceptions import (
    DomainRuleException,
    IdentityDeniedException,
    OperationForbiddenException,
    StaleStateException,
    UserNotFoundException,
)
from quoll.core.locking import lock_row, lock_rows
from quoll.interactions.repository import InteractionRepository
from quoll.org.repository import OrgRepository


@dataclass(frozen=True)
class _Locked:
    actor: Superviser
    manager: Manager
    # второй руководитель операции - принимающий или прежний, если он есть
    other: Superviser | None
    users: dict[str, User]


async def _lock(
    session: AsyncSession,
    actor_id: str,
    manager_id: str,
    other_superviser_id: str | None = None,
) -> _Locked:
    """руководители по возрастанию id - встречные переводы не дадут дедлок"""
    supervisers = await lock_rows(session, Superviser, [actor_id, other_superviser_id])
    manager = await lock_row(session, Manager, manager_id)
    users = await lock_rows(session, User, [actor_id, manager_id, other_superviser_id])
    # актор мог выбыть между входом в запрос и блокировкой
    denial = identity_denial(users.get(actor_id))
    if actor_id not in supervisers or denial is not None:
        raise IdentityDeniedException(*(denial or (403, "Not a supervisor")))
    if manager is None:
        if manager_id not in users:
            raise UserNotFoundException(manager_id)
        raise DomainRuleException(400, f"User '{manager_id}' is not a manager")
    return _Locked(
        actor=supervisers[actor_id],
        manager=manager,
        other=supervisers.get(other_superviser_id),
        users=users,
    )


def _check_capable(user: User) -> None:
    # Keycloak проверен до блокировок, а смена роли сначала коммитится у нас
    if identity_denial(user) is not None:
        raise DomainRuleException(409, f"User '{user.id}' is not available")


async def _check_quota(session: AsyncSession, superviser: Superviser) -> None:
    # строка руководителя заблокирована - параллельный набор ждёт, квота не уплывёт
    size = await OrgRepository(session).team_size(superviser.id)
    if size >= superviser.max_subordinates:
        raise DomainRuleException(
            409, f"Team is full: {size} of {superviser.max_subordinates}"
        )


def _check_expected(manager: Manager, expected_superviser_id: str | None) -> None:
    if manager.superviser_id != expected_superviser_id:
        raise StaleStateException("Manager supervisor", manager.superviser_id)


def _move(
    session: AsyncSession,
    manager: Manager,
    to_superviser_id: str | None,
    *,
    actor_id: str,
    event_type: AuditEventType,
) -> None:
    """единственное место, где меняется руководитель менеджера"""
    previous = manager.superviser_id
    manager.superviser_id = to_superviser_id
    record(
        session,
        actor_id=actor_id,
        event_type=event_type,
        target_type=TargetType.MANAGER,
        target_id=manager.id,
        old_value={"superviser_id": previous},
        new_value={"superviser_id": to_superviser_id},
    )


async def recruit(
    session: AsyncSession,
    *,
    actor_id: str,
    manager_id: str,
    expected_superviser_id: str | None,
) -> Manager:
    """взять свободного менеджера из Пула А в свою команду"""
    await verify_target(manager_id, UserRole.MANAGER)
    locked = await _lock(session, actor_id, manager_id)
    manager = locked.manager
    _check_expected(manager, expected_superviser_id)
    if manager.superviser_id is not None:
        raise DomainRuleException(409, "Manager already has a supervisor")
    _check_capable(manager)
    await _check_quota(session, locked.actor)

    _move(
        session,
        manager,
        actor_id,
        actor_id=actor_id,
        event_type=AuditEventType.SUBORDINATE_ASSIGNED,
    )
    await session.flush()
    return manager


async def release(
    session: AsyncSession,
    *,
    actor_id: str,
    manager_id: str,
    expected_superviser_id: str | None,
) -> None:
    """отпустить менеджера в Пул А. Только с пустым портфелем - у владельца
    заявки всегда есть руководитель (G8)"""
    manager = (await _lock(session, actor_id, manager_id)).manager
    _check_expected(manager, expected_superviser_id)
    if manager.superviser_id != actor_id:
        raise OperationForbiddenException("release someone else's subordinate")
    # строка менеджера заблокирована - назначение заявки ему ждёт
    blocking = await InteractionRepository(
        session
    ).count_owned_nonterminal_interactions(manager.id)
    if blocking:
        raise DomainRuleException(
            409, f"Manager still has {blocking} open interactions or drafts"
        )

    _move(
        session,
        manager,
        None,
        actor_id=actor_id,
        event_type=AuditEventType.SUBORDINATE_RELEASED,
    )
    await session.flush()


async def transfer(
    session: AsyncSession,
    *,
    actor_id: str,
    manager_id: str,
    to_superviser_id: str,
    expected_superviser_id: str | None,
) -> Manager:
    """перевести своего менеджера в другую команду - вместе с проектами:
    команда динамическая, заявки уходят к новому руководителю сами"""
    if to_superviser_id == actor_id:
        raise DomainRuleException(400, "Manager is already in this team")
    await verify_target(to_superviser_id, UserRole.SUPERVISER)
    locked = await _lock(session, actor_id, manager_id, to_superviser_id)
    manager, receiver = locked.manager, locked.other
    _check_expected(manager, expected_superviser_id)
    if manager.superviser_id != actor_id:
        raise OperationForbiddenException("transfer someone else's subordinate")
    if receiver is None:
        raise DomainRuleException(400, f"User '{to_superviser_id}' is not a supervisor")
    _check_capable(receiver)
    _check_capable(manager)
    await _check_quota(session, receiver)

    _move(
        session,
        manager,
        receiver.id,
        actor_id=actor_id,
        event_type=AuditEventType.SUBORDINATE_TRANSFERRED,
    )
    await session.flush()
    return manager


async def adopt(
    session: AsyncSession,
    *,
    actor_id: str,
    manager_id: str,
    expected_superviser_id: str | None,
) -> Manager:
    """забрать менеджера, чей руководитель выбыл, - Пул В. Прежний
    руководитель блокируется: реактивация во время усыновления его не обойдёт"""
    await verify_target(manager_id, UserRole.MANAGER)
    locked = await _lock(session, actor_id, manager_id, expected_superviser_id)
    manager = locked.manager
    _check_expected(manager, expected_superviser_id)
    if manager.superviser_id is None:
        raise DomainRuleException(409, "Manager has no supervisor, recruit instead")
    if manager.superviser_id == actor_id:
        raise DomainRuleException(400, "Manager is already in this team")
    if not is_incapacitated(locked.users.get(manager.superviser_id)):
        raise OperationForbiddenException("adopt a subordinate of an active supervisor")
    _check_capable(manager)
    await _check_quota(session, locked.actor)

    _move(
        session,
        manager,
        actor_id,
        actor_id=actor_id,
        event_type=AuditEventType.SUBORDINATE_ADOPTED,
    )
    await session.flush()
    return manager
