from typing import Annotated
from urllib.parse import quote

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    File,
    Form,
    Path,
    Query,
    Response,
    UploadFile,
    status,
)
from fastapi.responses import StreamingResponse

from quoll.attachments.dependencies import (
    AttachmentRepoDep,
    AttachmentServiceDep,
)
from quoll.attachments.schemas import AttachmentRead, PresignedUrlResponse
from quoll.auth.audit import record
from quoll.auth.audit_models import AuditEventType, TargetType
from quoll.auth.dependencies import AdminOnly, AdminUser, CurrentUser, get_current_user
from quoll.core.exceptions import DomainRuleException
from quoll.db import SessionDep
from quoll.interactions import document_service

attachments_router = APIRouter(
    prefix="/api/v1/attachments",
    tags=["Attachments"],
    dependencies=[Depends(get_current_user)],
)


async def _readable(
    user: CurrentUser,
    session: SessionDep,
    id: int = Path(..., ge=1, description="Attachment ID"),
) -> int:
    # id последовательные: без проверки документ заявки скачали бы перебором
    await document_service.check_attachment_readable(session, user, id)
    return id


ReadableAttachmentId = Annotated[int, Depends(_readable)]


def _journal(session, actor_id: str, event: AuditEventType, attachment) -> None:
    record(
        session,
        actor_id=actor_id,
        event_type=event,
        target_type=TargetType.ATTACHMENT,
        target_id=attachment.id,
        new_value={"filename": attachment.filename},
    )


@attachments_router.post(
    "/",
    response_model=AttachmentRead,
    status_code=status.HTTP_201_CREATED,
    summary="Upload an attachment file to S3 and record metadata",
    dependencies=[AdminOnly],
)
async def upload_attachment(
    service: AttachmentServiceDep,
    admin: AdminUser,
    session: SessionDep,
    file: Annotated[UploadFile, File(description="Binary file to upload")],
    preview: Annotated[
        str | None, Form(description="Optional short preview or thumbnail")
    ] = None,
):
    attachment = await service.upload_attachment(file=file, preview=preview)
    _journal(session, admin.id, AuditEventType.ATTACHMENT_UPLOADED, attachment)
    return attachment


@attachments_router.get(
    "/{id}",
    response_model=AttachmentRead,
    summary="Get attachment metadata",
)
async def get_attachment(repo: AttachmentRepoDep, id: ReadableAttachmentId):
    return await repo.get(id)


@attachments_router.get(
    "/{id}/download",
    summary="Download attachment binary stream from S3",
)
async def download_attachment(service: AttachmentServiceDep, id: ReadableAttachmentId):
    attachment, stream, content_type, length = await service.get_attachment_stream(id)
    ascii_filename = (
        attachment.filename.encode("ascii", "ignore").decode("ascii") or "attachment"
    )
    encoded_filename = quote(attachment.filename)
    headers = {
        "Content-Disposition": f"attachment; filename=\"{ascii_filename}\"; filename*=UTF-8''{encoded_filename}",
        "Content-Type": content_type,
    }
    if length > 0:
        headers["Content-Length"] = str(length)

    return StreamingResponse(
        stream,
        media_type=content_type,
        headers=headers,
    )


@attachments_router.get(
    "/{id}/presigned-url",
    response_model=PresignedUrlResponse,
    summary="Generate a short-lived presigned download URL for S3",
)
async def get_attachment_presigned_url(
    service: AttachmentServiceDep,
    id: ReadableAttachmentId,
    expires_in: int = Query(
        default=3600, ge=60, le=86400, description="Expiration time in seconds"
    ),
):
    url = await service.get_presigned_url(id, expires_in=expires_in)
    return PresignedUrlResponse(url=url, expires_in=expires_in)


@attachments_router.delete(
    "/{id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete an attachment from DB and S3",
    dependencies=[AdminOnly],
)
async def delete_attachment(
    service: AttachmentServiceDep,
    admin: AdminUser,
    session: SessionDep,
    background: BackgroundTasks,
    id: int = Path(..., ge=1, description="Attachment ID"),
):
    # иначе каскад удалил бы документ заявки мимо журнала
    if await document_service.is_interaction_document(session, id):
        raise DomainRuleException(409, "Interaction document is deleted via /documents")
    attachment = await service.repo.get(id)
    _journal(session, admin.id, AuditEventType.ATTACHMENT_DELETED, attachment)
    storage_key = await service.delete_attachment(id)
    # после коммита: строка без файла хуже, чем файл без строки
    background.add_task(service.s3.delete, storage_key)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
