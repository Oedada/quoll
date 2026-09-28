"""Причина закрытия: из справочника, своего уровня, у «другое» - с комментарием"""

from sqlalchemy.ext.asyncio import AsyncSession

from quoll.catalog.models import CloseLevel, CloseReason
from quoll.core.exceptions import DomainRuleException
from quoll.interactions.models import Interaction


def interaction_level(interaction: Interaction) -> CloseLevel:
    return (
        CloseLevel.INTERACTION_AFTER_SIGNING
        if interaction.no_return_at is not None
        else CloseLevel.INTERACTION_BEFORE_SIGNING
    )


async def check_reason(
    session: AsyncSession,
    reason_id: int,
    level: CloseLevel,
    comment: str | None,
    *,
    allow_system: bool = False,
) -> CloseReason:
    reason = await session.get(CloseReason, reason_id)
    if reason is None or reason.level != level:
        raise DomainRuleException(400, f"Close reason '{reason_id}' is not for {level}")
    # «исключена допсоглашением» ставит только одобрение ДС (О 10)
    if reason.is_system and not allow_system:
        raise DomainRuleException(400, f"Reason '{reason.code}' is set by the system")
    if reason.needs_comment and not comment:
        raise DomainRuleException(422, f"Reason '{reason.code}' needs a comment")
    return reason


async def id_by_code(session: AsyncSession, code: str) -> int:
    from sqlalchemy import select

    return await session.scalar(select(CloseReason.id).where(CloseReason.code == code))
