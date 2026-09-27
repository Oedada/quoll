"""Чтение и отметка уведомлений"""

from typing import Any

from sqlalchemy import func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from quoll.notifications.models import Notification, NotificationRecipient


def flat(row: NotificationRecipient) -> dict[str, Any]:
    n = row.notification
    return {
        "id": row.id,
        "notification_id": n.id,
        "type": n.type,
        "severity": n.severity,
        "subject_type": n.subject_type,
        "subject_id": n.subject_id,
        "interaction_id": n.interaction_id,
        "actor_id": n.actor_id,
        "title": n.title,
        "body": n.body,
        "payload": n.payload,
        "role": row.role,
        "read_at": row.read_at,
        "created_at": n.created_at,
    }


async def deliveries(
    session: AsyncSession,
    *,
    user_id: str | None,
    unread: bool | None = None,
    type: str | None = None,
    severity: str | None = None,
    interaction_id: int | None = None,
    before_id: int | None = None,
    after_id: int | None = None,
    limit: int = 50,
) -> list[dict[str, Any]]:
    """свои (user_id) или все (админ, user_id=None); новые сверху, курсор - id"""
    stmt = select(NotificationRecipient).join(NotificationRecipient.notification)
    if user_id is not None:
        stmt = stmt.where(NotificationRecipient.user_id == user_id)
    if unread is not None:
        stmt = stmt.where(
            NotificationRecipient.read_at.is_(None)
            if unread
            else NotificationRecipient.read_at.is_not(None)
        )
    if type is not None:
        stmt = stmt.where(Notification.type == type)
    if severity is not None:
        stmt = stmt.where(Notification.severity == severity)
    if interaction_id is not None:
        stmt = stmt.where(Notification.interaction_id == interaction_id)
    if before_id is not None:
        stmt = stmt.where(NotificationRecipient.id < before_id)
    if after_id is not None:
        stmt = stmt.where(NotificationRecipient.id > after_id)
    rows = await session.scalars(
        stmt.order_by(NotificationRecipient.id.desc()).limit(limit)
    )
    return [flat(r) for r in rows]


async def sync_items(
    session: AsyncSession, user_id: str, after_id: int, limit: int
) -> list[dict[str, Any]]:
    """после переподключения: всё непрочитанное и всё новее курсора. Одного
    курсора мало - id выдаются при вставке, а коммитятся транзакции в другом
    порядке, и более раннее уведомление могло прийти позже"""
    rows = await session.scalars(
        select(NotificationRecipient)
        .join(NotificationRecipient.notification)
        .where(
            NotificationRecipient.user_id == user_id,
            or_(
                NotificationRecipient.read_at.is_(None),
                NotificationRecipient.id > after_id,
            ),
        )
        .order_by(NotificationRecipient.id)
        .limit(limit)
    )
    return [flat(r) for r in rows]


async def last_id(session: AsyncSession, user_id: str) -> int:
    return (
        await session.scalar(
            select(func.max(NotificationRecipient.id)).where(
                NotificationRecipient.user_id == user_id
            )
        )
        or 0
    )


async def unread_count(session: AsyncSession, user_id: str) -> dict[str, Any]:
    rows = await session.execute(
        select(Notification.severity, func.count())
        .select_from(NotificationRecipient)
        .join(NotificationRecipient.notification)
        .where(
            NotificationRecipient.user_id == user_id,
            NotificationRecipient.read_at.is_(None),
        )
        .group_by(Notification.severity)
    )
    by_severity = dict(rows.all())
    return {"total": sum(by_severity.values()), "by_severity": by_severity}


async def mark_read(
    session: AsyncSession,
    user_id: str,
    *,
    ids: list[int] | None,
    interaction_id: int | None,
) -> int:
    """только свои: чужой id молча не отмечается"""
    stmt = update(NotificationRecipient).where(
        NotificationRecipient.user_id == user_id,
        NotificationRecipient.read_at.is_(None),
    )
    if ids is not None:
        stmt = stmt.where(NotificationRecipient.id.in_(ids))
    if interaction_id is not None:
        stmt = stmt.where(
            NotificationRecipient.notification_id.in_(
                select(Notification.id).where(
                    Notification.interaction_id == interaction_id
                )
            )
        )
    result = await session.execute(stmt.values(read_at=func.now()))
    return result.rowcount


async def history(
    session: AsyncSession,
    *,
    interaction_id: int | None = None,
    notification_id: int | None = None,
    only_user: str | None = None,
) -> list[dict[str, Any]]:
    """что ушло, кому и прочитано ли; only_user - видит лишь свои доставки"""
    stmt = (
        select(NotificationRecipient)
        .join(NotificationRecipient.notification)
        .order_by(Notification.id.desc(), NotificationRecipient.id)
    )
    if interaction_id is not None:
        stmt = stmt.where(Notification.interaction_id == interaction_id)
    if notification_id is not None:
        stmt = stmt.where(Notification.id == notification_id)
    if only_user is not None:
        stmt = stmt.where(NotificationRecipient.user_id == only_user)
    history: dict[int, dict[str, Any]] = {}
    for row in await session.scalars(stmt):
        n = row.notification
        item = history.setdefault(
            n.id,
            {
                "id": n.id,
                "type": n.type,
                "severity": n.severity,
                "subject_type": n.subject_type,
                "subject_id": n.subject_id,
                "actor_id": n.actor_id,
                "title": n.title,
                "body": n.body,
                "payload": n.payload,
                "created_at": n.created_at,
                "recipients": [],
            },
        )
        item["recipients"].append(
            {"user_id": row.user_id, "role": row.role, "read_at": row.read_at}
        )
    return list(history.values())
