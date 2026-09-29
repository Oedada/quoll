from fastapi import APIRouter, Depends, Path, Request, status
from fastapi.responses import StreamingResponse

from quoll.auth.dependencies import CurrentUser, get_current_user
from quoll.db import SessionDep
from quoll.reports import service
from quoll.reports.schemas import (
    ExportCreate,
    ExportRead,
    OptionsRead,
    PreviewRead,
    PreviewRequest,
)

reports_router = APIRouter(
    prefix="/api/v1/reports",
    tags=["Reports"],
    dependencies=[Depends(get_current_user)],
)


@reports_router.get(
    "/options",
    response_model=OptionsRead,
    summary="Filter values visible to the current user",
)
async def report_options(request: Request, user: CurrentUser):
    return await service.options(request.app.state.db_session_maker, user.id)


@reports_router.post(
    "/preview",
    response_model=PreviewRead,
    response_model_exclude_unset=True,
    summary="Report rows for a period with the chosen columns and filters",
)
async def report_preview(body: PreviewRequest, request: Request, user: CurrentUser):
    return await service.preview(request.app.state.db_session_maker, user.id, body)


@reports_router.post(
    "/exports",
    response_model=ExportRead,
    status_code=status.HTTP_202_ACCEPTED,
    summary="Queue a report file; poll its status, then download it",
)
async def create_export(
    body: ExportCreate, request: Request, user: CurrentUser, session: SessionDep
):
    return await service.create_export(
        session, request.app.state.db_session_maker, user, body
    )


@reports_router.get(
    "/exports/{id}",
    response_model=ExportRead,
    summary="Status of the author's report export and its place in the queue",
)
async def get_export(
    request: Request,
    user: CurrentUser,
    session: SessionDep,
    id: int = Path(..., ge=1, description="Export ID"),
):
    job = await service.own_export(
        session, request.app.state.db_session_maker, user, id, "status"
    )
    return await service.export_view(session, job)


@reports_router.get(
    "/exports/{id}/file",
    summary="Download the built report file",
    response_class=StreamingResponse,
)
async def download_export(
    request: Request,
    user: CurrentUser,
    session: SessionDep,
    id: int = Path(..., ge=1, description="Export ID"),
):
    job = await service.own_export(
        session, request.app.state.db_session_maker, user, id, "file"
    )
    stream, content_type = await service.export_file(session, request.app.state.s3, job)
    return StreamingResponse(
        stream,
        media_type=content_type,
        headers={
            "Content-Disposition": f'attachment; filename="{service.file_name(job)}"'
        },
    )
