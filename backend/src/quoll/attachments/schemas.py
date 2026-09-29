from datetime import datetime

from quoll.core.schemas import AppBaseModel


class AttachmentBase(AppBaseModel):
    filename: str
    mime_type: str
    preview: str | None = None
    # заполняются у шаблонов для переходов; у файлов заявок и комментариев пусто
    title: str | None = None
    category: str | None = None


class AttachmentCreate(AttachmentBase):
    storage_key: str
    size_bytes: int = 0


class AttachmentRead(AttachmentBase):
    id: int
    storage_key: str
    size_bytes: int
    created_at: datetime
    updated_at: datetime


class TransitionRef(AppBaseModel):
    id: int
    name: str


class AttachmentListRead(AttachmentRead):
    """для раздела «шаблоны» - к каким переходам файл уже привязан"""

    used_by: list[TransitionRef]


class PresignedUrlResponse(AppBaseModel):
    url: str
    expires_in: int
