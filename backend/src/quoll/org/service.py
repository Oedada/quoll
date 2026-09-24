"""Операции оргструктуры. Порядок блокировок - Superviser -> Manager -> User,
как в core/locking.py; проверки - под блокировкой, до изменения"""

from sqlalchemy.ext.asyncio import AsyncSession

from quoll.auth.audit import record
from quoll.auth.audit_models import AuditEventType, TargetType
from quoll.auth.identity_policy import identity_denial
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


async def _lock_actor_and_manager(
    session: AsyncSession, actor_id: str, manager_id: str
) -> tuple[Superviser, Manager]:
    superviser = await lock_row(session, Superviser, actor_id)
    manager = await lock_row(session, Manager, manager_id)
    users = await lock_rows(session, User, [actor_id, manager_id])
    # актор мог выбыть между входом в запрос и блокировкой
    denial = identity_denial(users.get(actor_id))
    if superviser is None or denial is not None:
        raise IdentityDeniedException(*(denial or (403, "Not a supervisor")))
    if manager is None:
        if manager_id not in users:
            raise UserNotFoundException(manager_id)
        raise DomainRuleException(400, f"User '{manager_id}' is not a manager")
    return superviser, manager


def _check_capable(manager: Manager) -> None:
    # Keycloak проверен до блокировок, а смена роли сначала коммитится у нас
    if identity_denial(manager) is not None:
        raise DomainRuleException(409, f"Manager '{manager.id}' is not available")


async def recruit(
    session: AsyncSession,
    *,
    actor_id: str,
    manager_id: str,
    expected_superviser_id: str | None,
) -> Manager:
    """взять свободного менеджера из Пула А в свою команду"""
    await verify_target(manager_id, UserRole.MANAGER)
    superviser, manager = await _lock_actor_and_manager(session, actor_id, manager_id)
    if manager.superviser_id != expected_superviser_id:
        raise StaleStateException("Manager supervisor", manager.superviser_id)
    if manager.superviser_id is not None:
        raise DomainRuleException(409, "Manager already has a supervisor")
    _check_capable(manager)
    # строка руководителя заблокирована - параллельный набор ждёт, квота не уплывёт
    team_size = await OrgRepository(session).team_size(superviser.id)
    if team_size >= superviser.max_subordinates:
        raise DomainRuleException(
            409, f"Team is full: {team_size} of {superviser.max_subordinates}"
        )

    manager.superviser_id = superviser.id
    record(
        session,
        actor_id=actor_id,
        event_type=AuditEventType.SUBORDINATE_ASSIGNED,
        target_type=TargetType.MANAGER,
        target_id=manager.id,
        old_value={"superviser_id": None},
        new_value={"superviser_id": superviser.id},
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
    _, manager = await _lock_actor_and_manager(session, actor_id, manager_id)
    if manager.superviser_id != expected_superviser_id:
        raise StaleStateException("Manager supervisor", manager.superviser_id)
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

    manager.superviser_id = None
    record(
        session,
        actor_id=actor_id,
        event_type=AuditEventType.SUBORDINATE_RELEASED,
        target_type=TargetType.MANAGER,
        target_id=manager.id,
        old_value={"superviser_id": actor_id},
        new_value={"superviser_id": None},
    )
    await session.flush()
