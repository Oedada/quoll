"""Сверщик реестра (§8.5): Keycloak - источник правды по учёткам, проекция
его догоняет, даже если человек не заходит.

один процесс на такт - под advisory lock. Каждый пользователь в своей
транзакции: сбой на одном не останавливает сверку
"""

import logging
from datetime import datetime, timedelta

from sqlalchemy import delete, func, not_, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from quoll.auth import identity_service, keycloak_admin, role_transition
from quoll.auth.audit import record
from quoll.auth.audit_models import AuditEventType, TargetType
from quoll.auth.identity_policy import incapacitated_expression
from quoll.auth.keycloak_admin import Entry
from quoll.auth.models import (
    IdentitySyncStatus,
    RoleTransitionStatus,
    Session,
    User,
    UserRole,
    user_class_for_role,
)
from quoll.auth.pending_actions import (
    PendingActionStatus,
    PendingActionType,
    PendingOrgAction,
)
from quoll.auth.repositories import UserRepository
from quoll.core.locking import lock_row

logger = logging.getLogger(__name__)

LOCK_KEY = 810_001
# не трогать тех, кого меняли недавно: снимок мог быть снят до их правки
FRESH = timedelta(minutes=5)
_PROFILE = ("username", "email", "first_name", "last_name")


async def reconcile(session_maker: async_sessionmaker) -> None:
    engine = session_maker.kw["bind"]
    async with engine.connect() as lock:
        if not await lock.scalar(select(func.pg_try_advisory_lock(LOCK_KEY))):
            return
        try:
            await _tick(session_maker)
        finally:
            # сессионная блокировка - снять явно, иначе уедет в пул с соединением
            await lock.scalar(select(func.pg_advisory_unlock(LOCK_KEY)))
            await lock.commit()


async def _tick(session_maker: async_sessionmaker) -> None:
    async with session_maker() as db:
        started = await db.scalar(select(func.now()))
        known = set(await db.scalars(select(User.id)))
    # сбой снимка - выход без единой мутации
    snap = await keycloak_admin.snapshot()
    for user_id in known | snap.keys():
        try:
            async with session_maker() as db, db.begin():
                await reconcile_user(db, user_id, snap.get(user_id), started)
        except Exception:
            logger.exception(f"Reconciliation failed for user {user_id}")
    await _alert_if_nobody_left(session_maker)


async def reconcile_user(
    db: AsyncSession, user_id: str, entry: Entry | None, started: datetime
) -> None:
    # подтип раньше users - смена роли ниже удаляет его строку
    role = await db.scalar(select(User.role).where(User.id == user_id))
    if role is not None:
        await lock_row(db, user_class_for_role(role), user_id)
    user = await lock_row(db, User, user_id)
    if user is None:
        if entry is not None and entry.enabled and len(entry.roles) == 1:
            await UserRepository(db).ensure_projection(
                user_id,
                UserRole(next(iter(entry.roles))),
                # имя и фамилия в Keycloak необязательны, у нас - обязательны
                {
                    "username": entry.username,
                    "email": entry.email,
                    "first_name": entry.first_name or "",
                    "last_name": entry.last_name or "",
                },
            )
        return
    if user.updated_at >= started - FRESH:
        return

    if entry is None:
        # пагинация по смещению теряет строку, если кого-то удалили во время
        # обхода: «нет в снимке» ещё не «нет в Keycloak»
        if user.is_active and await keycloak_admin.get_account(user_id) is None:
            await identity_service.deactivate(db, user_id, None, keycloak=False)
        return
    if not entry.enabled:
        if user.is_active:
            await identity_service.deactivate(db, user_id, None, keycloak=False)
        return
    if not user.is_active:
        await identity_service.reactivate(db, user_id, None, keycloak=False)

    roles = entry.roles
    if roles != {user.role.value}:
        # решения - по эффективным ролям, как в токене: роль может прийти группой
        account = await keycloak_admin.get_account(user_id)
        roles = set(account.roles) if account else set()
    if len(roles) != 1:
        _flag_conflict(db, user, sorted(roles))
        await db.execute(delete(Session).where(Session.user_id == user_id))
        return
    if user.identity_sync_status != IdentitySyncStatus.OK:
        user.identity_sync_status = IdentitySyncStatus.OK
        record(
            db,
            actor_id=None,
            event_type=AuditEventType.ROLE_MAPPING_CONFLICT_RESOLVED,
            target_type=TargetType.USER,
            target_id=user_id,
        )

    for field in _PROFILE:
        value = getattr(entry, field)
        # только реальные отличия: иначе updated_at сдвигал бы окно впустую
        if value is not None and getattr(user, field) != value:
            setattr(user, field, value)
    await db.flush()

    role = UserRole(next(iter(roles)))
    if (
        role != user.role
        and user.role_transition_status == RoleTransitionStatus.NONE
        and not await _failed_recently(db, user_id)
    ):
        await role_transition.request(db, user_id, role, actor_id=None)


def _flag_conflict(db: AsyncSession, user: User, roles: list[str]) -> None:
    if user.identity_sync_status == IdentitySyncStatus.ROLE_MAPPING_CONFLICT:
        return
    user.identity_sync_status = IdentitySyncStatus.ROLE_MAPPING_CONFLICT
    record(
        db,
        actor_id=None,
        event_type=AuditEventType.ROLE_MAPPING_CONFLICT_DETECTED,
        target_type=TargetType.USER,
        target_id=user.id,
        new_value={"roles": roles},
    )


async def _failed_recently(db: AsyncSession, user_id: str) -> bool:
    """FAILED моложе суток - не ставить заново, иначе сверщик и FAILED
    крутились бы бесконечно"""
    return bool(
        await db.scalar(
            select(PendingOrgAction.id).where(
                PendingOrgAction.action_type == PendingActionType.ROLE_TRANSITION,
                PendingOrgAction.target_id == user_id,
                PendingOrgAction.status == PendingActionStatus.FAILED,
                PendingOrgAction.completed_at > func.now() - timedelta(days=1),
            )
        )
    )


async def _alert_if_nobody_left(session_maker: async_sessionmaker) -> None:
    """Keycloak мог отключить последнего руководителя или админа - запретить
    мы это не можем, только поднять тревогу"""
    async with session_maker() as db:
        for role in (UserRole.SUPERVISER, UserRole.ADMIN):
            capable = await db.scalar(
                select(func.count())
                .select_from(User)
                .where(User.role == role, not_(incapacitated_expression(User)))
            )
            if not capable:
                logger.error(
                    f"LOG_ALERT no capable {role.value} left after reconciliation"
                )
