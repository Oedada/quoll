"""Уведомления: одно событие-повод и доставка каждому получателю.

строка в базе - источник истины: закрыта у человека платформа или нет,
при входе он увидит всё непрочитанное. Сокет только ускоряет доставку
"""

from datetime import datetime
from typing import Any

from sqlalchemy import (
    BigInteger,
    DateTime,
    ForeignKey,
    Index,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from quoll.db import Base, created_at_dt


class Notification(Base):
    __tablename__ = "notifications"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    type: Mapped[str] = mapped_column(String(50), index=True)
    severity: Mapped[str] = mapped_column(String(10))
    # о чём: заявка, ветка, просьба, документ, изменение воркфлоу
    subject_type: Mapped[str] = mapped_column(String(30))
    subject_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # история заявки одним запросом - и для веток, просьб, документов
    interaction_id: Mapped[int | None] = mapped_column(
        ForeignKey("interactions.id", ondelete="CASCADE"), nullable=True, index=True
    )
    # NULL - система
    actor_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    # отрисованы при отправке: история не меняется от переименований
    title: Mapped[str] = mapped_column(Text)
    body: Mapped[str] = mapped_column(Text)
    # только id - для ссылки в интерфейсе
    payload: Mapped[dict[str, Any]] = mapped_column(
        JSONB, default=dict, server_default=text("'{}'::jsonb")
    )
    # повод-однодневка: второй раз то же уведомление не создаётся
    dedup_key: Mapped[str | None] = mapped_column(
        String(200), nullable=True, unique=True
    )
    created_at: Mapped[created_at_dt]

    recipients: Mapped[list["NotificationRecipient"]] = relationship(
        back_populates="notification", lazy="noload"
    )


class NotificationRecipient(Base):
    """доставка человеку; id - курсор клиента"""

    __tablename__ = "notification_recipients"
    __table_args__ = (
        UniqueConstraint("notification_id", "user_id", name="uq_notification_user"),
        Index("ix_notification_recipients_user", "user_id", "id"),
        # счётчик непрочитанного
        Index(
            "ix_notification_recipients_unread",
            "user_id",
            postgresql_where=text("read_at IS NULL"),
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    notification_id: Mapped[int] = mapped_column(
        ForeignKey("notifications.id", ondelete="CASCADE")
    )
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    # в какой роли получил: «вам как руководителю КАМа»
    role: Mapped[str] = mapped_column(String(30))
    read_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    notification: Mapped[Notification] = relationship(
        back_populates="recipients", lazy="joined"
    )
