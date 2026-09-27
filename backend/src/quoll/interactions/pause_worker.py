"""Истечение пауз со сроком (§8.6).

срок вышел и место есть - пауза снимается. Места нет или владелец выбыл -
взаимодействие ждёт места и снимается, как только оно появится. Кто ждёт
дольше, получает место первым
"""

import logging

from sqlalchemy import case, func, not_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from quoll.auth.audit import record
from quoll.auth.audit_models import AuditEventType, TargetType
from quoll.auth.identity_policy import incapacitated_expression
from quoll.auth.models import Manager, User
from quoll.core.exceptions import CapacityExceededException, ManagerNotActiveException
from quoll.core.locking import lock_rows
from quoll.interactions.capacity_policy import (
    assert_can_keep_working,
    counts_toward_capacity,
)
from quoll.interactions.models import Branch, Interaction, PauseState
from quoll.interactions.notify import notify_system
from quoll.interactions.project_service import resume
from quoll.notifications import kinds
from quoll.notifications.kinds import Subject
from quoll.workflows.models import Stage

logger = logging.getLogger(__name__)


def _due():
    """два множества: у ждущих срока нет вовсе, NULL < now() не выбрал бы их.
    Ждущих у выбывших владельцев не берём: снять их нельзя, пока их не
    передали, а в выборке они вытесняли бы тех, кого снять можно"""
    capable = select(Manager.id).where(not_(incapacitated_expression(Manager)))
    return or_(
        (Interaction.pause_state == PauseState.PAUSED_TIMED)
        & (Interaction.paused_until <= func.now()),
        (Interaction.pause_state == PauseState.EXPIRED_WAITING_CAPACITY)
        & Interaction.owner_id.in_(capable),
    )


async def expire_pauses(session_maker: async_sessionmaker) -> int:
    """один такт; возвращает, сколько пауз снято. Берёт всех, без предела:
    с пределом полные у одних владельцев навсегда занимали бы выборку"""
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
        await _wait(db, interaction, "no owner")
        return 0
    stage = await db.get(Stage, interaction.state_id)
    delta = int(counts_toward_capacity(stage, False, interaction.slot)) - int(
        counts_toward_capacity(stage, True, interaction.slot)
    )
    try:
        await assert_can_keep_working(db, owner, delta)
    except (CapacityExceededException, ManagerNotActiveException) as refusal:
        await _wait(db, interaction, refusal.message)
        return 0
    await resume(db, interaction, actor_id=None)
    await notify_system(db, kinds.PAUSE_ENDED, interaction, context={"branch": ""})
    return 1


async def _wait(db: AsyncSession, interaction: Interaction, reason: str) -> None:
    """в журнал - только при первом переходе, а не на каждом такте"""
    if interaction.pause_state == PauseState.EXPIRED_WAITING_CAPACITY:
        return
    interaction.pause_state = PauseState.EXPIRED_WAITING_CAPACITY
    interaction.paused_until = None
    await notify_system(db, kinds.PAUSE_WAITING_CAPACITY, interaction)
    record(
        db,
        actor_id=None,
        event_type=AuditEventType.PAUSE_EXPIRED_SATURATED,
        target_type=TargetType.INTERACTION,
        target_id=interaction.id,
        new_value={"reason": reason},
    )


async def expire_branch_pauses(session_maker: async_sessionmaker) -> int:
    """срок паузы ветки вышел - снимаем. Слот КАМа ветка не держит, поэтому
    ждать места не нужно. Своя транзакция на каждую заявку: иначе блокировки
    копились бы весь проход и встречались бы с живыми операциями"""
    from quoll.interactions.branch_service import resume_branch
    from quoll.interactions.scope import lock_interaction_scope

    async with session_maker() as db:
        due = (
            (
                await db.execute(
                    select(Branch.interaction_id)
                    .where(
                        Branch.pause_state == PauseState.PAUSED_TIMED,
                        Branch.paused_until <= func.now(),
                    )
                    .distinct()
                )
            )
            .scalars()
            .all()
        )
    resumed = 0
    for interaction_id in due:
        async with session_maker() as db:
            await lock_interaction_scope(db, interaction_id, None, allow_closed=True)
            branches = await db.scalars(
                select(Branch).where(
                    Branch.interaction_id == interaction_id,
                    Branch.pause_state == PauseState.PAUSED_TIMED,
                    Branch.paused_until <= func.now(),
                )
            )
            interaction = await db.get(Interaction, interaction_id)
            for branch in branches:
                resume_branch(db, branch, None)
                await notify_system(
                    db,
                    kinds.PAUSE_ENDED,
                    interaction,
                    context={"branch": f", ветка {branch.id}"},
                    subject=Subject.BRANCH,
                    subject_id=branch.id,
                    payload={"branch_id": branch.id},
                )
                resumed += 1
            await db.commit()
    return resumed
