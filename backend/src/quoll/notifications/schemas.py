from datetime import datetime
from typing import Any, Literal

from pydantic import ConfigDict, Field, model_validator

from quoll.core.schemas import AppBaseModel


class NotificationRead(AppBaseModel):
    """уведомление глазами получателя; id - курсор (строка доставки)"""

    id: int
    notification_id: int
    type: str
    severity: str
    subject_type: str
    subject_id: str | None
    interaction_id: int | None
    actor_id: str | None
    title: str
    body: str
    payload: dict[str, Any]
    role: str
    read_at: datetime | None
    created_at: datetime


class UnreadCount(AppBaseModel):
    total: int
    by_severity: dict[str, int]


class MarkRead(AppBaseModel):
    """ровно один способ: список, всё или всё по заявке"""

    model_config = ConfigDict(extra="forbid")

    ids: list[int] | None = None
    all: bool = False
    interaction_id: int | None = None

    @model_validator(mode="after")
    def _one_way(self):
        ways = [self.ids is not None, self.all, self.interaction_id is not None]
        if sum(ways) != 1:
            raise ValueError("Give exactly one of ids, all, interaction_id")
        return self


class MarkedRead(AppBaseModel):
    updated: int


class ManualNotification(AppBaseModel):
    """ручное уведомление админа: конкретным людям или всем с ролью"""

    model_config = ConfigDict(extra="forbid")

    title: str = Field(min_length=1, max_length=255)
    body: str = Field(min_length=1)
    user_ids: list[str] | None = Field(default=None, min_length=1)
    role: Literal["manager", "superviser", "admin"] | None = None

    @model_validator(mode="after")
    def _one_audience(self):
        if (self.user_ids is None) == (self.role is None):
            raise ValueError("Give either user_ids or role")
        return self


class Delivery(AppBaseModel):
    user_id: str
    role: str
    read_at: datetime | None


class NotificationHistoryRead(AppBaseModel):
    """уведомление по заявке: что, когда и кому ушло, прочитано ли"""

    id: int
    type: str
    severity: str
    subject_type: str
    subject_id: str | None
    actor_id: str | None
    title: str
    body: str
    payload: dict[str, Any]
    created_at: datetime
    recipients: list[Delivery]
