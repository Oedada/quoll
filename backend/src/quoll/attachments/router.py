from typing import Annotated
from urllib.parse import quote

from fastapi import (
    APIRouter,
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

attachments_router = APIRouter(prefix="/api/v1/attachments", tags=["Attachments"])


@attachments_router.post(
    "/",
    response_model=AttachmentRead,
    status_code=status.HTTP_201_CREATED,
    summary="Upload an attachment file to S3 and record metadata",
)
async def upload_attachment(
    service: AttachmentServiceDep,
    file: Annotated[UploadFile, File(description="Binary file to upload")],
    preview: Annotated[
        str | None, Form(description="Optional short preview or thumbnail")
    ] = None,
):
    return await service.upload_attachment(file=file, preview=preview)


@attachments_router.get(
    "/{id}",
    response_model=AttachmentRead,
    summary="Get attachment metadata",
)
async def get_attachment(
    repo: AttachmentRepoDep,
    id: int = Path(..., ge=1, description="Attachment ID"),
):
    return await repo.get(id)


@attachments_router.get(
    "/{id}/download",
    summary="Download attachment binary stream from S3",
)
async def download_attachment(
    service: AttachmentServiceDep,
    id: int = Path(..., ge=1, description="Attachment ID"),
):
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
    id: int = Path(..., ge=1, description="Attachment ID"),
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
)
async def delete_attachment(
    service: AttachmentServiceDep,
    id: int = Path(..., ge=1, description="Attachment ID"),
):
    await service.delete_attachment(id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
