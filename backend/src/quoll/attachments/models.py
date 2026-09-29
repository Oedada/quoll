from sqlalchemy import BigInteger, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from quoll.core.mixins import IdMixin, TimestampMixin
from quoll.db import Base, str_255


class Attachment(Base, IdMixin, TimestampMixin):
    filename: Mapped[str_255]
    storage_key: Mapped[str_255] = mapped_column(String(255), unique=True, index=True)
    mime_type: Mapped[str] = mapped_column(String(100))
    size_bytes: Mapped[int] = mapped_column(BigInteger, default=0)
    preview: Mapped[str | None] = mapped_column(Text, nullable=True)
    # заполняются у шаблонов для переходов - у файлов заявок и комментариев пусто
    title: Mapped[str | None] = mapped_column(String(255), nullable=True)
    category: Mapped[str | None] = mapped_column(String(100), nullable=True, index=True)
