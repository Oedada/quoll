"""Жизненный цикл допсоглашения, который трогают чужие модули: возврат в
черновик при отмене просьбы и отмена при закрытии заявки (П7).

листовой модуль - только модели и журнал: его зовут requests и
transition_service, а они не должны зависеть от sa_service
"""

from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from quoll.auth.audit import record
from quoll.auth.audit_models import AuditEventType, TargetType
from quoll.interactions.models import (
    AgreementStatus,
    Interaction,
    InteractionStageHistory,
    StageChangeKind,
    SupplementaryAgreement,
)


def label(sa: SupplementaryAgreement) -> str:
    return f"ДС №{sa.number}" if sa.number else f"ДС #{sa.id}"


def history(
    session: AsyncSession,
    interaction: Interaction,
    kind: StageChangeKind,
    actor_id: str | None,
    *,
    payload: dict[str, Any],
    branch_id: int | None = None,
    from_stage_id: int | None = None,
    to_stage_id: int | None = None,
    comment: str | None = None,
) -> None:
    """событие истории; у событий заявки без движения - её шаг с обеих сторон"""
    if branch_id is None and from_stage_id is None and to_stage_id is None:
        from_stage_id = to_stage_id = interaction.state_id
    session.add(
        InteractionStageHistory(
            interaction_id=interaction.id,
            branch_id=branch_id,
            from_stage_id=from_stage_id,
            to_stage_id=to_stage_id,
            kind=kind,
            actor_id=actor_id,
            comment=comment,
            payload=payload,
        )
    )


def journal(
    session: AsyncSession,
    actor_id: str | None,
    event: AuditEventType,
    sa: SupplementaryAgreement,
    old: dict | None = None,
    new: dict | None = None,
) -> None:
    record(
        session,
        actor_id=actor_id,
        event_type=event,
        target_type=TargetType.SUPPLEMENTARY_AGREEMENT,
        target_id=sa.id,
        old_value=old,
        new_value=new,
    )


def return_to_draft(
    session: AsyncSession,
    interaction: Interaction,
    sa: SupplementaryAgreement,
    reason: str,
    actor_id: str | None,
) -> None:
    """просьба об одобрении отменена - ДС снова черновик у КАМа, отсчёт
    застоя заново: теперь снова его ход"""
    if sa.status != AgreementStatus.PENDING:
        return
    sa.status = AgreementStatus.DRAFT
    sa.stall_since = func.now()
    history(
        session,
        interaction,
        StageChangeKind.SA_RETURNED,
        actor_id,
        payload={"sa_id": sa.id, "reason": reason},
        comment=reason,
    )
    journal(session, actor_id, AuditEventType.SA_RETURNED, sa, new={"reason": reason})


async def cancel_open(
    session: AsyncSession, interaction: Interaction, actor_id: str | None, reason: str
) -> None:
    """заявка закрывается - незавершённое ДС отменяется. Зовут до отмены
    просьб: тогда ДС не успевает побывать в черновике"""
    open_agreements = await session.scalars(
        select(SupplementaryAgreement)
        .where(
            SupplementaryAgreement.interaction_id == interaction.id,
            SupplementaryAgreement.status.in_(
                [AgreementStatus.DRAFT, AgreementStatus.PENDING]
            ),
        )
        .execution_options(populate_existing=True)
    )
    for sa in open_agreements:
        sa.status = AgreementStatus.CANCELLED
        sa.decided_by = actor_id
        sa.decided_at = func.now()
        sa.decision_comment = reason
        sa.stall_since = None
        history(
            session,
            interaction,
            StageChangeKind.SA_CANCELLED,
            actor_id,
            payload={"sa_id": sa.id, "reason": reason},
            comment=reason,
        )
        journal(
            session, actor_id, AuditEventType.SA_CANCELLED, sa, new={"reason": reason}
        )
