"""Истечение пауз со сроком (§8.6).

срок вышел и место есть - пауза снимается. Места нет или владелец выбыл -
взаимодействие ждёт места и снимается, как только оно появится. Кто ждёт
дольше, получает место первым
"""

import logging

from sqlalchemy import case, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from quoll.auth.audit import record
from quoll.auth.audit_models import AuditEventType, TargetType
from quoll.auth.models import Manager, User
from quoll.core.exceptions import CapacityExceededException, ManagerNotActiveException
from quoll.core.locking import lock_rows
from quoll.interactions.capacity_policy import (
    assert_can_keep_working,
    counts_toward_capacity,
)
from quoll.interactions.models import Interaction, PauseState
from quoll.interactions.project_service import resume
from quoll.workflows.models import Stage

logger = logging.getLogger(__name__)

BATCH = 100


def _due():
    # два множества: у ждущих срока нет вовсе, NULL < now() не выбрал бы их
    return or_(
        (Interaction.pause_state == PauseState.PAUSED_TIMED)
        & (Interaction.paused_until <= func.now()),
        Interaction.pause_state == PauseState.EXPIRED_WAITING_CAPACITY,
    )


async def expire_pauses(session_maker: async_sessionmaker) -> int:
    """один такт; возвращает, сколько пауз снято"""
    async with session_maker() as db:
        candidates = (
            await db.execute(
                select(Interaction.id, Interaction.owner_id)
                .where(_due())
                # сначала истёкшие сроки, потом давние ожидающие
                .order_by(
                    case(
                        (Interaction.pause_state == PauseState.PAUSED_TIMED, 0), else_=1
                    ),
                    Interaction.updated_at,
                    Interaction.id,
                )
                .limit(BATCH)
            )
        ).all()

    resumed = 0
    for interaction_id, owner_id in candidates:
        # своя транзакция на каждое: сбой одного не держит остальных
        try:
            async with session_maker() as db, db.begin():
                resumed += await _expire_one(db, interaction_id, owner_id)
        except Exception:
            logger.exception(f"Pause expiry failed for interaction id={interaction_id}")
    return resumed


async def _expire_one(
    db: AsyncSession, interaction_id: int, owner_id: str | None
) -> int:
    managers = await lock_rows(db, Manager, [owner_id])
    await lock_rows(db, User, [owner_id])
    # занятое взаимодействие пропускаем - оно дождётся следующего такта
    interaction = (
        await db.execute(
            select(Interaction)
            .where(Interaction.id == interaction_id, _due())
            .with_for_update(of=Interaction.__table__, key_share=True, skip_locked=True)
            .execution_options(populate_existing=True)
        )
    ).scalar_one_or_none()
    if interaction is None or interaction.owner_id != owner_id:
        return 0

    owner = managers.get(owner_id)
    if owner is None:
        _wait(db, interaction, "no owner")
        return 0
    stage = await db.get(Stage, interaction.state_id)
    delta = int(counts_toward_capacity(stage, False)) - int(
        counts_toward_capacity(stage, True)
    )
    try:
        await assert_can_keep_working(db, owner, delta)
    except (CapacityExceededException, ManagerNotActiveException) as refusal:
        _wait(db, interaction, refusal.message)
        return 0
    resume(db, interaction, actor_id=None)
    return 1


def _wait(db: AsyncSession, interaction: Interaction, reason: str) -> None:
    """в журнал - только при первом переходе, а не на каждом такте"""
    if interaction.pause_state == PauseState.EXPIRED_WAITING_CAPACITY:
        return
    interaction.pause_state = PauseState.EXPIRED_WAITING_CAPACITY
    interaction.paused_until = None
    record(
        db,
        actor_id=None,
        event_type=AuditEventType.PAUSE_EXPIRED_SATURATED,
        target_type=TargetType.INTERACTION,
        target_id=interaction.id,
        new_value={"reason": reason},
    )
