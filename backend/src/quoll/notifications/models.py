from typing import Any

from sqlalchemy import JSON, Text
from sqlalchemy.orm import Mapped, mapped_column

from quoll.core.mixins import IdMixin, TimestampMixin
from quoll.db import Base, str_255


class Notify(Base, IdMixin, TimestampMixin):
    user_id: Mapped[str_255] = mapped_column(index=True)
    title: Mapped[str_255]
    message: Mapped[str] = mapped_column(Text)
    is_read: Mapped[bool] = mapped_column(default=False)
    extra_data: Mapped[dict[str, Any] | None] = mapped_column(JSON, default=None)
