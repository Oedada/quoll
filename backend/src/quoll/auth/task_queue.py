"""Очередь задач оргструктуры: увольнение и смена роли, которые ждут человека.

захват - своя короткая транзакция с арендой и новой версией. Работа - своя
транзакция, итог пишется CAS по версии и статусу последним оператором: воркер,
потерявший аренду, не закоммитит ни изменение, ни итог
"""

import logging
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import timedelta
from enum import StrEnum
from typing import Any

from sqlalchemy import case, func, or_, select, text, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from quoll.auth.pending_actions import (
    _ACTIVE_STATUS_SQL,
    ACTIVE_ACTION_STATUSES,
    LEASE_DURATION_SECONDS,
    PendingActionStatus,
    PendingOrgAction,
)
from quoll.core.exceptions import IdentityProviderUnavailableException

logger = logging.getLogger(__name__)

WORKER_ID = f"worker-{uuid.uuid4().hex[:8]}"
# ждём человека - раз в 5 минут, ждём Keycloak - раз в минуту
WAIT_HUMAN = timedelta(minutes=5)
WAIT_KEYCLOAK = timedelta(minutes=1)


class Outcome(StrEnum):
    DONE = "DONE"
    WAIT = "WAIT"  # не готово - это не отказ, попытки не тратятся
    CANCEL = "CANCEL"


@dataclass(frozen=True)
class Result:
    outcome: Outcome
    reason: str | None = None


Handler = Callable[[AsyncSession, PendingOrgAction], Awaitable[Result]]
# при FAILED - вернуть пользователя в строй, в той же транзакции
OnFailed = Callable[[AsyncSession, PendingOrgAction], Awaitable[None]]


class LeaseLost(Exception):
    """аренду перехватили, пока мы работали - наша работа откатывается"""


def _due():
    return or_(
        (PendingOrgAction.status == PendingActionStatus.PENDING)
        & (
            func.coalesce(PendingOrgAction.next_retry_at, PendingOrgAction.created_at)
            <= func.now()
        ),
        (PendingOrgAction.status == PendingActionStatus.IN_PROGRESS)
        & (PendingOrgAction.lease_until < func.now()),
    )


async def claim(session_maker: async_sessionmaker) -> tuple[str, int] | None:
    """одна задача: id и версия, по которой потом CAS"""
    async with session_maker() as db, db.begin():
        task_id = await db.scalar(
            select(PendingOrgAction.id)
            .where(_due())
            .order_by(
                func.coalesce(
                    PendingOrgAction.next_retry_at, PendingOrgAction.created_at
                ),
                PendingOrgAction.id,
            )
            .limit(1)
            .with_for_update(key_share=True, skip_locked=True)
        )
        if task_id is None:
            return None
        row = (
            await db.execute(
                update(PendingOrgAction)
                .where(PendingOrgAction.id == task_id)
                .values(
                    # перехват просроченной аренды - это попытка: иначе задача,
                    # роняющая процесс, никогда не станет FAILED
                    retry_count=PendingOrgAction.retry_count
                    + case(
                        (PendingOrgAction.status == PendingActionStatus.IN_PROGRESS, 1),
                        else_=0,
                    ),
                    status=PendingActionStatus.IN_PROGRESS,
                    worker_id=WORKER_ID,
                    lease_until=func.now() + timedelta(seconds=LEASE_DURATION_SECONDS),
                    lease_version=PendingOrgAction.lease_version + 1,
                )
                .returning(PendingOrgAction.lease_version)
            )
        ).scalar_one()
    return task_id, row


def _cas(task_id: str, version: int):
    return update(PendingOrgAction).where(
        PendingOrgAction.id == task_id,
        PendingOrgAction.lease_version == version,
        PendingOrgAction.status == PendingActionStatus.IN_PROGRESS,
    )


async def _settle(db: AsyncSession, task_id: str, version: int, **values: Any) -> None:
    done = await db.execute(_cas(task_id, version).values(**values))
    if done.rowcount == 0:
        raise LeaseLost(task_id)


def _values(result: Result) -> dict[str, Any]:
    if result.outcome == Outcome.DONE:
        return {"status": PendingActionStatus.COMPLETED, "completed_at": func.now()}
    if result.outcome == Outcome.CANCEL:
        return {
            "status": PendingActionStatus.CANCELLED,
            "completed_at": func.now(),
            "last_error": result.reason,
        }
    return {
        "status": PendingActionStatus.PENDING,
        "next_retry_at": func.now() + WAIT_HUMAN,
        "last_error": result.reason,
    }


async def process_one(
    session_maker: async_sessionmaker,
    handlers: dict[str, Handler],
    on_failed: dict[str, OnFailed],
) -> bool:
    """взять и отработать одну задачу; False - брать нечего"""
    claimed = await claim(session_maker)
    if claimed is None:
        return False
    task_id, version = claimed
    try:
        async with session_maker() as db, db.begin():
            task = await db.get(PendingOrgAction, task_id)
            result = await handlers[task.action_type](db, task)
            # CAS последним: бизнес-изменения и итог коммитятся вместе или никак
            await _settle(db, task_id, version, **_values(result))
    except LeaseLost:
        logger.warning(f"Task {task_id} lost its lease, work rolled back")
    except IdentityProviderUnavailableException as err:
        # Keycloak лежит - ждём, попытки не тратим
        async with session_maker() as db, db.begin():
            await db.execute(
                _cas(task_id, version).values(
                    status=PendingActionStatus.PENDING,
                    next_retry_at=func.now() + WAIT_KEYCLOAK,
                    last_error=str(err),
                )
            )
    except Exception as err:
        logger.exception(f"Task {task_id} failed")
        await _retry_or_fail(session_maker, task_id, version, on_failed, err)
    return True


async def _retry_or_fail(session_maker, task_id, version, on_failed, err) -> None:
    async with session_maker() as db, db.begin():
        task = await db.get(PendingOrgAction, task_id)
        attempts = task.retry_count + 1
        if attempts < task.max_attempts:
            await db.execute(
                _cas(task_id, version).values(
                    status=PendingActionStatus.PENDING,
                    retry_count=attempts,
                    next_retry_at=func.now() + timedelta(minutes=2 ** (attempts - 1)),
                    last_error=str(err),
                )
            )
            return
        # пользователь раньше задачи - порядок из core/locking.py
        if task.action_type in on_failed:
            await on_failed[task.action_type](db, task)
        try:
            # проверяющий CAS: аренду перехватили - откатится и возврат в строй
            await _settle(
                db,
                task_id,
                version,
                status=PendingActionStatus.FAILED,
                retry_count=attempts,
                completed_at=func.now(),
                last_error=str(err),
            )
        except LeaseLost:
            await db.rollback()
            return
        logger.error(f"LOG_ALERT task {task_id} {task.action_type} FAILED: {err}")


async def run_queue(
    session_maker: async_sessionmaker,
    handlers: dict[str, Handler],
    on_failed: dict[str, OnFailed],
    limit: int = 50,
) -> int:
    """один такт: пока есть что брать, но не больше limit"""
    processed = 0
    while processed < limit and await process_one(session_maker, handlers, on_failed):
        processed += 1
    return processed


async def enqueue(
    db: AsyncSession,
    *,
    action_type: str,
    target_id: str,
    payload: dict[str, Any] | None = None,
    origin_supervisor_id: str | None = None,
    delay: timedelta = timedelta(0),
) -> None:
    """поставить задачу; активная уже есть - слить payload и поднять версию,
    чтобы воркер со старым решением не прошёл CAS"""
    table = PendingOrgAction.__table__
    stmt = pg_insert(table).values(
        id=str(uuid.uuid4()),
        action_type=action_type,
        target_id=target_id,
        payload=payload or {},
        origin_supervisor_id=origin_supervisor_id,
        next_retry_at=func.now() + delay,
    )
    await db.execute(
        stmt.on_conflict_do_update(
            index_elements=[table.c.action_type, table.c.target_id],
            # условие частичного индекса - тем же текстом, иначе Postgres его не узнает
            index_where=text(_ACTIVE_STATUS_SQL),
            set_={
                "payload": table.c.payload.op("||")(stmt.excluded.payload),
                "lease_version": table.c.lease_version + 1,
            },
        )
    )


async def cancel_active(
    db: AsyncSession, *, action_type: str, target_id: str, reason: str
) -> bool:
    """отмена снаружи - реактивация, деактивация. Версия растёт: воркер,
    держащий задачу, не перетрёт отмену своим итогом"""
    cancelled = await db.execute(
        update(PendingOrgAction)
        .where(
            PendingOrgAction.action_type == action_type,
            PendingOrgAction.target_id == target_id,
            PendingOrgAction.status.in_(ACTIVE_ACTION_STATUSES),
        )
        .values(
            status=PendingActionStatus.CANCELLED,
            completed_at=func.now(),
            last_error=reason,
            lease_version=PendingOrgAction.lease_version + 1,
        )
    )
    return cancelled.rowcount > 0
