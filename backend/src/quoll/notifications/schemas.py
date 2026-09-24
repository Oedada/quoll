from datetime import datetime

from quoll.core.schemas import AppBaseModel


class NotifyBase(AppBaseModel):
    user_id: str
    title: str
    message: str


class NotifyCreate(NotifyBase):
    pass


class NotifyUpdate(AppBaseModel):
    is_read: bool | None = None


class NotifyRead(NotifyBase):
    id: int
    is_read: bool
    created_at: datetime
    updated_at: datetime
