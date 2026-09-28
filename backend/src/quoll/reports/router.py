from fastapi import APIRouter, Depends, Request

from quoll.auth.dependencies import CurrentUser, get_current_user
from quoll.reports import service
from quoll.reports.schemas import OptionsRead, PreviewRead, PreviewRequest

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
