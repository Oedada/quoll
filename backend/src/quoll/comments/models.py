from sqlalchemy import ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship

from quoll.attachments.models import Attachment
from quoll.core import IdMixin
from quoll.core.mixins import TimestampMixin
from quoll.db import Base, str_255


class CommentAttachment(Base):
    comment_id: Mapped[int] = mapped_column(
        ForeignKey("comment.id", ondelete="CASCADE"), primary_key=True
    )
    attachment_id: Mapped[int] = mapped_column(
        ForeignKey("comment.id", ondelete="CASCADE"), primary_key=True
    )


class Comment(Base, IdMixin, TimestampMixin):
    text: Mapped[str_255]
    attachments: Mapped[list[CommentAttachment]] = relationship(
        Attachment, secondary="comment_attachment", lazy="selectin"
    )
