from quoll.attachments.dependencies import (
    AttachmentRepoDep,
    AttachmentServiceDep,
    get_attachment_repo,
    get_attachment_service,
)
from quoll.attachments.models import Attachment
from quoll.attachments.router import attachments_router
from quoll.attachments.s3 import S3StorageService
from quoll.attachments.schemas import (
    AttachmentBase,
    AttachmentCreate,
    AttachmentRead,
    PresignedUrlResponse,
)
from quoll.attachments.service import AttachmentService
from quoll.core.base_repository import BaseRepository

AttachmentRepository = BaseRepository[Attachment]

__all__ = [
    "Attachment",
    "AttachmentBase",
    "AttachmentCreate",
    "AttachmentRead",
    "AttachmentRepoDep",
    "AttachmentRepository",
    "AttachmentService",
    "AttachmentServiceDep",
    "PresignedUrlResponse",
    "S3StorageService",
    "attachments_router",
    "get_attachment_repo",
    "get_attachment_service",
]
