"""Деактивация и реактивация учёток - одни процедуры для эндпоинтов и сверщика.

Keycloak вызывается внутри транзакции, после локальных изменений и до
коммита: отказал - откатывается всё, компенсировать нечего. Успел, а коммит
упал - Keycloak источник правды, сверщик догонит проекцию
"""

from sqlalchemy import delete, func, not_, select
from sqlalchemy.ext.asyncio import AsyncSession

from quoll.auth import keycloak_admin
from quoll.auth.audit import record
from quoll.auth.audit_models import AuditEventType, TargetType
from quoll.auth.identity_policy import incapacitated_expression
from quoll.auth.models import (
    Admin,
    Manager,
    RoleTransitionStatus,
    Session,
    Superviser,
    User,
    UserRole,
)
from quoll.auth.pending_actions import PendingActionType
from quoll.auth.task_queue import cancel_active, enqueue
from quoll.core.exceptions import DomainRuleException, UserNotFoundException
from quoll.core.locking import lock_row, lock_rows

# Р3: последнего дееспособного руководителя или админа убрать нельзя
_LEVELS = {UserRole.SUPERVISER: Superviser, UserRole.ADMIN: Admin}
_OFFBOARDING = {
    UserRole.MANAGER: PendingActionType.OFFBOARDING_MANAGER,
    UserRole.SUPERVISER: PendingActionType.OFFBOARDING_SUPERVISER,
}


async def guard_last_capable(db: AsyncSession, role: UserRole, leaving: str) -> None:
    """все строки уровня под блокировкой, потом счёт отдельным запросом: флаги
    лежат в users, а блокируем подтип - по объектам ждавший увидел бы старые"""
    level = _LEVELS.get(role)
    if level is None:
        return
    await lock_rows(db, level, list(await db.scalars(select(level.id))))
    capable = await db.scalar(
        select(func.count())
        .select_from(User)
        .where(
            User.role == role,
            User.id != leaving,
            not_(incapacitated_expression(User)),
        )
    )
    if not capable:
        raise DomainRuleException(409, f"Last capable {role.value} cannot leave")


async def _user(db: AsyncSession, user_id: str) -> User:
    user = await lock_row(db, User, user_id)
    if user is None:
        raise UserNotFoundException(user_id)
    return user


async def deactivate(
    db: AsyncSession, user_id: str, actor_id: str | None, *, keycloak: bool = True
) -> bool:
    """False - уже неактивен. Сверщик зовёт с keycloak=False: там учётку
    отключили, и Р3 он не проверяет - это решение Keycloak, не наше"""
    found = await db.get(User, user_id)
    if found is None:
        raise UserNotFoundException(user_id)
    if actor_id is not None:
        # уровень раньше пользователя - порядок из core/locking.py
        await guard_last_capable(db, found.role, user_id)
    user = await _user(db, user_id)
    if not user.is_active:
        return False

    user.is_active = False
    # деактивация важнее смены роли: учётка всё равно выключена
    if await cancel_active(
        db,
        action_type=PendingActionType.ROLE_TRANSITION,
        target_id=user_id,
        reason="user deactivated",
    ):
        user.role_transition_status = RoleTransitionStatus.NONE
    await db.execute(delete(Session).where(Session.user_id == user_id))
    if user.role in _OFFBOARDING:
        # явным запросом: поля подтипа у объекта после блокировки users истекли
        superviser_id = await db.scalar(
            select(Manager.superviser_id).where(Manager.id == user_id)
        )
        await enqueue(
            db,
            action_type=_OFFBOARDING[user.role],
            target_id=user_id,
            origin_supervisor_id=superviser_id,
        )
    record(
        db,
        actor_id=actor_id,
        event_type=AuditEventType.USER_DEACTIVATED,
        target_type=TargetType.USER,
        target_id=user_id,
        old_value={"is_active": True},
        new_value={"is_active": False},
    )
    await db.flush()
    if keycloak:
        await keycloak_admin.set_enabled(user_id, False)
    return True


async def reactivate(
    db: AsyncSession, user_id: str, actor_id: str | None, *, keycloak: bool = True
) -> bool:
    """конфликт ролей не трогаем: снять его может только сверщик по Keycloak"""
    user = await _user(db, user_id)
    if user.is_active:
        return False
    user.is_active = True
    for action_type in _OFFBOARDING.values():
        await cancel_active(
            db, action_type=action_type, target_id=user_id, reason="user reactivated"
        )
    record(
        db,
        actor_id=actor_id,
        event_type=AuditEventType.USER_REACTIVATED,
        target_type=TargetType.USER,
        target_id=user_id,
        old_value={"is_active": False},
        new_value={"is_active": True},
    )
    await db.flush()
    if keycloak:
        await keycloak_admin.set_enabled(user_id, True)
    return True


async def push_disabled(user_id: str) -> None:
    """повтор деактивации: у нас уже выключен, а Keycloak мог не успеть -
    иначе сверщик вернул бы учётку"""
    await keycloak_admin.set_enabled(user_id, False)
