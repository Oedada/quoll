from typing import Annotated

from fastapi import Depends, Request

from quoll.attachments.models import Attachment
from quoll.attachments.s3 import S3StorageService
from quoll.attachments.service import AttachmentService
from quoll.core.base_repository import BaseRepository
from quoll.db import SessionDep


def get_attachment_repo(session: SessionDep) -> BaseRepository[Attachment]:
    return BaseRepository(session, Attachment)


def get_s3_service(request: Request) -> S3StorageService | None:
    return getattr(request.app.state, "s3", None)


AttachmentRepoDep = Annotated[BaseRepository[Attachment], Depends(get_attachment_repo)]
S3ServiceDep = Annotated[S3StorageService, Depends(get_s3_service)]


def get_attachment_service(
    repo: AttachmentRepoDep,
    s3: S3ServiceDep,
) -> AttachmentService:
    return AttachmentService(repo=repo, s3=s3)


AttachmentServiceDep = Annotated[AttachmentService, Depends(get_attachment_service)]
