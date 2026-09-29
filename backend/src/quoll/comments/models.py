"""Комментарии к шагам заявки - плоская лента, привязанная к месту (§1 design).

своих блокировок нет - все изменения идут под lock_interaction_scope заявки.
Строка не удаляется физически (на неё могут ссылаться ответы) - только
помечается deleted_at/deleted_by
"""

from datetime import datetime

from sqlalchemy import BigInteger, CheckConstraint, DateTime, ForeignKey, Index, Text
from sqlalchemy.orm import Mapped, mapped_column

from quoll.db import Base, created_at_dt, str_255


class Comment(Base):
    __table_args__ = (
        CheckConstraint(
            "length(btrim(text)) BETWEEN 1 AND 4000", name="chk_comment_text"
        ),
        CheckConstraint(
            "branch_id IS NULL OR side_pointer_id IS NULL", name="chk_comment_place"
        ),
        CheckConstraint(
            "deleted_by IS NULL OR deleted_at IS NOT NULL",
            name="chk_comment_deleted_by",
        ),
        Index("ix_comments_interaction", "interaction_id", "id"),
        Index("ix_comments_reply_to", "reply_to_id"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    interaction_id: Mapped[int] = mapped_column(
        ForeignKey("interactions.id", ondelete="CASCADE")
    )
    stage_id: Mapped[int] = mapped_column(ForeignKey("stages.id", ondelete="RESTRICT"))
    branch_id: Mapped[int | None] = mapped_column(
        ForeignKey("branches.id", ondelete="CASCADE"), nullable=True
    )
    side_pointer_id: Mapped[int | None] = mapped_column(
        ForeignKey("side_pointers.id", ondelete="CASCADE"), nullable=True
    )
    # NULL - импорт или удалённая учётка; подпись хранится отдельно
    author_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    author_name: Mapped[str_255]
    reply_to_id: Mapped[int | None] = mapped_column(
        ForeignKey("comments.id", ondelete="NO ACTION"), nullable=True
    )
    text: Mapped[str] = mapped_column(Text)
    edited_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    deleted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    deleted_by: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[created_at_dt]


class CommentAttachment(Base):
    comment_id: Mapped[int] = mapped_column(
        ForeignKey("comments.id", ondelete="CASCADE"), primary_key=True
    )
    attachment_id: Mapped[int] = mapped_column(
        ForeignKey("attachments.id", ondelete="CASCADE"),
        unique=True,
        primary_key=True,
    )
