"""Отмена открытых просьб - общая у назначения, закрытия и перехода в конец.

отдельным модулем: его зовут и project_service, и transition_service, а
сервис просьб сам зовёт их - иначе вышел бы круговой импорт
"""

from sqlalchemy import func, update
from sqlalchemy.ext.asyncio import AsyncSession

from quoll.auth.audit import record
from quoll.auth.audit_models import AuditEventType, TargetType
from quoll.interactions.models import (
    Interaction,
    InteractionRequest,
    InteractionStageValues,
    RequestStatus,
    SupplementaryAgreement,
)
from quoll.interactions.sa_lifecycle import return_to_draft


async def cancel_pending_requests(
    session: AsyncSession, interaction_id: int, actor_id: str | None, reason: str
) -> None:
    """просьбы по заявке устарели. Строки одной заявки уже сериализованы её
    блокировкой, поэтому один UPDATE без захвата по id"""
    cancelled = await session.execute(
        update(InteractionRequest)
        .where(
            InteractionRequest.interaction_id == interaction_id,
            InteractionRequest.status == RequestStatus.PENDING,
        )
        .values(
            status=RequestStatus.CANCELLED,
            decided_at=func.now(),
            decision_comment=reason,
        )
        .returning(InteractionRequest.id, InteractionRequest.supplementary_agreement_id)
    )
    # ждущие правки пройденных шагов устаревают вместе с просьбами
    await session.execute(
        update(InteractionStageValues)
        .where(
            InteractionStageValues.interaction_id == interaction_id,
            InteractionStageValues.pending_values.is_not(None),
        )
        .values(pending_values=None, pending_by=None)
    )
    rows = cancelled.all()
    # отменённая просьба об одобрении возвращает ДС в черновик (П7)
    agreements = [sa_id for _, sa_id in rows if sa_id is not None]
    if agreements:
        interaction = await session.get(Interaction, interaction_id)
        for sa_id in agreements:
            sa = await session.get(
                SupplementaryAgreement, sa_id, populate_existing=True
            )
            return_to_draft(session, interaction, sa, reason, actor_id)
    for request_id, _ in rows:
        record(
            session,
            actor_id=actor_id,
            event_type=AuditEventType.REQUEST_CANCELLED,
            target_type=TargetType.REQUEST,
            target_id=request_id,
            new_value={"reason": reason},
        )
