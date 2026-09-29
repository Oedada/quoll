from datetime import datetime

from pydantic import ConfigDict

from quoll.attachments.schemas import AttachmentRead
from quoll.core.schemas import AppBaseModel


class AuthorRead(AppBaseModel):
    id: str | None
    name: str


class ReplyPreview(AppBaseModel):
    id: int
    author_name: str
    text_preview: str | None
    deleted: bool


class CommentRead(AppBaseModel):
    id: int
    interaction_id: int
    stage_id: int
    branch_id: int | None
    side_pointer_id: int | None
    author: AuthorRead
    text: str | None
    reply_to: ReplyPreview | None
    attachments: list[AttachmentRead]
    edited_at: datetime | None
    deleted_at: datetime | None
    created_at: datetime
    deleted: bool


class CommentListRead(AppBaseModel):
    total: int
    items: list[CommentRead]


class CommentUpdate(AppBaseModel):
    model_config = ConfigDict(extra="forbid")

    text: str
