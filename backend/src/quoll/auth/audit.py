"""Единственный писатель журнала аудита. Напрямую AuditLog нигде не создаём."""

from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from quoll.auth.audit_models import ActorType, AuditEventType, AuditLog, TargetType


def record(
    session: AsyncSession,
    *,
    actor_id: str | None,
    event_type: AuditEventType,
    target_type: TargetType,
    target_id: str | int,
    old_value: dict[str, Any] | None = None,
    new_value: dict[str, Any] | None = None,
) -> None:
    """записать событие в транзакцию вызывающего.

    actor_id=None - действие системы, а не человека. Без значения по умолчанию,
    чтобы системное событие нельзя было записать случайно
    """
    session.add(
        AuditLog(
            actor_type=ActorType.SYSTEM if actor_id is None else ActorType.USER,
            actor_id=actor_id,
            event_type=event_type,
            target_type=target_type,
            target_id=str(target_id),
            old_value=old_value,
            new_value=new_value,
        )
    )
