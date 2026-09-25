"""Смена роли (§8.3). Пока у человека есть работа старой роли, учётка
заблокирована (П8), а задача ждёт, пока руководитель её разберёт.

запускает админ (эндпоинт) или сверщик, увидевший другую роль в Keycloak
"""

import logging

from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from quoll.auth import keycloak_admin
from quoll.auth.audit import record
from quoll.auth.audit_models import AuditEventType, TargetType
from quoll.auth.identity_policy import identity_denial
from quoll.auth.identity_service import guard_last_capable
from quoll.auth.models import (
    Manager,
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
from quoll.auth.task_queue import Outcome, Result, enqueue
from quoll.core.exceptions import DomainRuleException, UserNotFoundException
from quoll.core.locking import lock_row
from quoll.interactions.models import Interaction, InteractionAssignment
from quoll.interactions.repository import InteractionRepository

logger = logging.getLogger(__name__)


async def request(
    db: AsyncSession, user_id: str, target: UserRole, actor_id: str | None
) -> bool:
    """True - роль сменилась сразу, False - ждёт разбора работы.

    Keycloak - внутри транзакции: отказал, и ни блокировка, ни задача не
    останутся. Сверщик зовёт с actor_id=None: там роль уже сменили
    """
    found = await db.get(User, user_id)
    if found is None:
        raise UserNotFoundException(user_id)
    current = found.role
    if target == current:
        raise DomainRuleException(409, f"User already has role {target.value}")
    if actor_id is not None:
        # уровень раньше пользователя - порядок из core/locking.py
        await guard_last_capable(db, current, user_id)
    # подтип раньше users: apply удаляет строку подтипа, а назначения и набор
    # держат её и ждут users
    await lock_row(db, user_class_for_role(current), user_id)
    user = await lock_row(db, User, user_id)
    if user.role != current:
        raise DomainRuleException(409, "User role changed concurrently")
    if (denial := identity_denial(user)) is not None:
        raise DomainRuleException(409, f"User cannot change role now: {denial[1]}")

    user.role_transition_status = RoleTransitionStatus.PENDING
    await db.execute(delete(Session).where(Session.user_id == user_id))
    await enqueue(
        db,
        action_type=PendingActionType.ROLE_TRANSITION,
        target_id=user_id,
        payload={"target_role": target.value},
    )
    await db.flush()
    if actor_id is not None:
        await keycloak_admin.set_role(user_id, target, current)

    result = await apply(db, user_id, target, actor_id)
    if result.outcome == Outcome.DONE:
        # задача ещё не закоммичена, воркер её не видел - закрываем сами
        await db.execute(
            update(PendingOrgAction)
            .where(
                PendingOrgAction.action_type == PendingActionType.ROLE_TRANSITION,
                PendingOrgAction.target_id == user_id,
                PendingOrgAction.status == PendingActionStatus.PENDING,
            )
            .values(status=PendingActionStatus.COMPLETED, completed_at=func.now())
        )
        return True
    record(
        db,
        actor_id=actor_id,
        event_type=AuditEventType.ROLE_TRANSITION_BLOCKED,
        target_type=TargetType.USER,
        target_id=user_id,
        new_value={"target_role": target.value, "reason": result.reason},
    )
    return False


async def _blocker(db: AsyncSession, user: User) -> str | None:
    if user.role == UserRole.MANAGER:
        left = await InteractionRepository(db).count_owned_nonterminal_interactions(
            user.id
        )
        return f"{left} open interactions or drafts" if left else None
    if user.role == UserRole.SUPERVISER:
        team = await db.scalar(
            select(func.count()).where(Manager.superviser_id == user.id)
        )
        return f"{team} subordinates" if team else None
    return None


async def apply(
    db: AsyncSession, user_id: str, target: UserRole, actor_id: str | None
) -> Result:
    """применить, если работы старой роли не осталось. Руководитель менеджера
    не блокирует: снимается здесь же, как при увольнении (решение Тимура)"""
    role = await db.scalar(select(User.role).where(User.id == user_id))
    if role is None:
        return Result(Outcome.CANCEL, "user is gone")
    await lock_row(db, user_class_for_role(role), user_id)
    user = await lock_row(db, User, user_id)
    if user is None or not user.is_active:
        return Result(Outcome.CANCEL, "user is not active")
    if user.role != role:
        return Result(Outcome.WAIT, "role changed concurrently")
    old = user.role
    if (reason := await _blocker(db, user)) is not None:
        return Result(Outcome.WAIT, reason)

    if old == UserRole.MANAGER:
        await _release_manager(db, user_id, actor_id)
    # подтип меняется явным SQL: ORM не умеет менять класс строки
    db.expunge(user)
    old_table = user_class_for_role(old).__table__
    await db.execute(delete(old_table).where(old_table.c.id == user_id))
    await db.execute(user_class_for_role(target).__table__.insert().values(id=user_id))
    await db.execute(
        update(User.__table__)
        .where(User.__table__.c.id == user_id)
        .values(role=target, role_transition_status=RoleTransitionStatus.NONE)
    )
    await db.execute(delete(Session).where(Session.user_id == user_id))
    record(
        db,
        actor_id=actor_id,
        event_type=AuditEventType.ROLE_TRANSITIONED,
        target_type=TargetType.USER,
        target_id=user_id,
        old_value={"role": old.value},
        new_value={"role": target.value},
    )
    await db.flush()
    return Result(Outcome.DONE)


async def _release_manager(
    db: AsyncSession, user_id: str, actor_id: str | None
) -> None:
    """закрытые взаимодействия остаются без владельца - их видят все
    руководители (В9); из команды снимается, освобождая место"""
    closed = list(
        await db.scalars(
            select(Interaction.id)
            .where(Interaction.owner_id == user_id)
            .order_by(Interaction.id)
            .with_for_update(of=Interaction.__table__, key_share=True)
        )
    )
    if closed:
        await db.execute(
            update(Interaction)
            .where(Interaction.id.in_(closed))
            .values(owner_id=None, last_owner_id=user_id)
        )
        await db.execute(
            update(InteractionAssignment)
            .where(
                InteractionAssignment.interaction_id.in_(closed),
                InteractionAssignment.released_at.is_(None),
            )
            .values(released_at=func.now(), reason="role_transition")
        )
    # саму связь уберёт удаление строки managers - здесь только след в журнале
    superviser_id = await db.scalar(
        select(Manager.superviser_id).where(Manager.id == user_id)
    )
    if superviser_id is not None:
        record(
            db,
            actor_id=actor_id,
            event_type=AuditEventType.SUBORDINATE_RELEASED,
            target_type=TargetType.MANAGER,
            target_id=user_id,
            old_value={"superviser_id": superviser_id},
            new_value={"superviser_id": None},
        )


async def handle(db: AsyncSession, task: PendingOrgAction) -> Result:
    """обработчик очереди. Роль берётся из Keycloak, а не из payload: если
    её за время ожидания поменяли ещё раз, применяется последняя"""
    account = await keycloak_admin.get_account(task.target_id)
    user = await db.get(User, task.target_id)
    if account is None or user is None:
        return await _cancel(db, task.target_id, "user is gone from Keycloak")
    if len(account.roles) != 1:
        # конфликт отметит сверщик, смену тут не применяем
        return await _cancel(db, task.target_id, f"roles in Keycloak {account.roles}")
    target = UserRole(account.roles[0])
    if target == user.role:
        return await _cancel(db, task.target_id, "role in Keycloak is unchanged")
    return await apply(db, task.target_id, target, actor_id=None)


async def _cancel(db: AsyncSession, user_id: str, reason: str) -> Result:
    await release(db, user_id)
    record(
        db,
        actor_id=None,
        event_type=AuditEventType.ROLE_TRANSITION_CANCELLED,
        target_type=TargetType.USER,
        target_id=user_id,
        new_value={"reason": reason},
    )
    return Result(Outcome.CANCEL, reason)


async def release(db: AsyncSession, user_id: str) -> None:
    """вернуть в строй: отмена или FAILED задачи - иначе учётка заблокирована
    навсегда"""
    await db.execute(
        update(User.__table__)
        .where(User.__table__.c.id == user_id)
        .values(role_transition_status=RoleTransitionStatus.NONE)
    )


async def on_failed(db: AsyncSession, task: PendingOrgAction) -> None:
    await release(db, task.target_id)
