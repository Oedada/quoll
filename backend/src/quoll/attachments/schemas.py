from datetime import datetime

from quoll.core.schemas import AppBaseModel


class AttachmentBase(AppBaseModel):
    filename: str
    mime_type: str
    preview: str | None = None


class AttachmentCreate(AttachmentBase):
    storage_key: str
    size_bytes: int = 0


class AttachmentRead(AttachmentBase):
    id: int
    storage_key: str
    size_bytes: int
    created_at: datetime
    updated_at: datetime


class PresignedUrlResponse(AppBaseModel):
    url: str
    expires_in: int
