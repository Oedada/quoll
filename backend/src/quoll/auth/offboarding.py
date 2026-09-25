"""Увольнение ждёт человека: портфель менеджера и команду руководителя
разбирает руководитель вручную (П8). Обработчик не раздаёт - он ждёт"""

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from quoll.auth import keycloak_admin
from quoll.auth.audit import record
from quoll.auth.audit_models import AuditEventType, TargetType
from quoll.auth.models import Manager, User
from quoll.auth.pending_actions import PendingOrgAction
from quoll.auth.task_queue import Outcome, Result
from quoll.core.locking import lock_row
from quoll.interactions.repository import InteractionRepository


async def _still_gone(db: AsyncSession, task: PendingOrgAction) -> Result | None:
    """вернули в строй - задача не нужна. В Keycloak ещё включён - ждём:
    иначе увольнение завершилось бы в окне, пока его откатывают"""
    user = await db.get(User, task.target_id)
    if user is None or user.is_active:
        return Result(Outcome.CANCEL, "user is active again")
    account = await keycloak_admin.get_account(task.target_id)
    if account is not None and account.enabled:
        return Result(Outcome.WAIT, "still enabled in Keycloak")
    return None


async def offboard_manager(db: AsyncSession, task: PendingOrgAction) -> Result:
    if (early := await _still_gone(db, task)) is not None:
        return early
    manager = await lock_row(db, Manager, task.target_id)
    left = await InteractionRepository(db).count_owned_nonterminal_interactions(
        manager.id
    )
    if left:
        return Result(Outcome.WAIT, f"{left} open interactions or drafts to hand over")
    if manager.superviser_id is not None:
        # иначе уволенный навсегда занимал бы место в команде
        record(
            db,
            actor_id=None,
            event_type=AuditEventType.SUBORDINATE_RELEASED,
            target_type=TargetType.MANAGER,
            target_id=manager.id,
            old_value={"superviser_id": manager.superviser_id},
            new_value={"superviser_id": None},
        )
        manager.superviser_id = None
        await db.flush()
    return Result(Outcome.DONE)


async def offboard_superviser(db: AsyncSession, task: PendingOrgAction) -> Result:
    if (early := await _still_gone(db, task)) is not None:
        return early
    team = await db.scalar(
        select(func.count()).where(Manager.superviser_id == task.target_id)
    )
    if team:
        return Result(Outcome.WAIT, f"{team} subordinates to transfer or adopt")
    record(
        db,
        actor_id=None,
        event_type=AuditEventType.SUPERVISOR_OFFBOARDED,
        target_type=TargetType.SUPERVISER,
        target_id=task.target_id,
    )
    return Result(Outcome.DONE)
