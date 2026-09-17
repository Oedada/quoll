from sqlalchemy.orm import Mapped

from quoll.db import created_at_dt, int_pk, updated_at_dt


class IdMixin:
    id: Mapped[int_pk]


class TimestampMixin:
    created_at: Mapped[created_at_dt]
    updated_at: Mapped[updated_at_dt]
