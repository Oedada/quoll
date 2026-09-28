"""API интеграций (план §7). Раздел «Интеграции» - только админ (К §5);
предложения LMS решает руководитель - отдельный роутер"""

import json
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response, UploadFile
from sqlalchemy import select

from quoll.auth.dependencies import AdminOnly, CurrentUser, get_current_user
from quoll.core.exceptions import AppException
from quoll.db import SessionDep
from quoll.integrations import export as export_service
from quoll.integrations import flows, proposals, unmatched_service
from quoll.integrations.models import (
    IntegrationRun,
    LmsStats,
    ProposalStatus,
    RunFlow,
    RunStatus,
    RunTrigger,
    UnmatchedStatus,
)
from quoll.integrations.schemas import (
    LmsStatsRead,
    ProposalApprove,
    ProposalRead,
    ProposalReject,
    RunnableFlow,
    RunRead,
    StubFlow,
    StubRead,
    UnmatchedRead,
    UnmatchedResolve,
    UploadFlow,
)
from quoll.interactions.bindings import BUSINESS_TZ

integrations_router = APIRouter(
    prefix="/api/v1/integrations",
    tags=["Integrations"],
    dependencies=[Depends(get_current_user), AdminOnly],
)

integration_proposals_router = APIRouter(
    prefix="/api/v1/integrations/proposals",
    tags=["Integrations"],
    dependencies=[Depends(get_current_user)],
)


@integrations_router.get("/runs", response_model=list[RunRead])
async def list_runs(
    session: SessionDep,
    flow: RunnableFlow | None = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
):
    stmt = select(IntegrationRun).order_by(IntegrationRun.id.desc()).limit(limit)
    if flow is not None:
        stmt = stmt.where(IntegrationRun.flow == flow)
    return list(await session.scalars(stmt))


@integrations_router.post("/runs/{flow}", response_model=RunRead)
async def start_run(flow: RunnableFlow, session: SessionDep, admin: CurrentUser):
    """недоступная заглушка - запуск FAILED с INT-503, данные не менялись"""
    return await flows.run(session, RunFlow(flow), RunTrigger.MANUAL, admin.id)


@integrations_router.post("/upload/{flow}", response_model=RunRead)
async def upload(
    flow: UploadFlow, file: UploadFile, session: SessionDep, admin: CurrentUser
):
    """JSON-массив в формате заглушки; файл после разбора не хранится (К §7)"""
    try:
        records = json.loads(await file.read())
    except (UnicodeDecodeError, json.JSONDecodeError) as e:
        line = getattr(e, "lineno", None)
        raise AppException(400, "File is not JSON", "INT-400", {"line": line}) from e
    if not isinstance(records, list):
        raise AppException(400, "File is not a JSON array", "INT-400")
    return await flows.run(session, RunFlow(flow), RunTrigger.FILE, admin.id, records)


@integrations_router.get("/stub/{flow}", response_model=StubRead)
async def stub_received(flow: StubFlow, session: SessionDep):
    """что приняла заглушка при последнем успешном И1/И2"""
    run = await session.scalar(
        select(IntegrationRun)
        .where(IntegrationRun.flow == flow, IntegrationRun.status == RunStatus.DONE)
        .order_by(IntegrationRun.id.desc())
        .limit(1)
    )
    return StubRead(
        flow=flow,
        received_at=run.finished_at if run else None,
        payload=run.payload if run else None,
    )


@integrations_router.get("/unmatched", response_model=list[UnmatchedRead])
async def unmatched_queue(
    session: SessionDep,
    status: UnmatchedStatus | None = UnmatchedStatus.PENDING,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
):
    return await unmatched_service.queue(session, status, limit, offset)


@integrations_router.post(
    "/unmatched/{unmatched_id}/resolve", response_model=list[UnmatchedRead]
)
async def resolve_unmatched(
    unmatched_id: int, body: UnmatchedResolve, session: SessionDep, admin: CurrentUser
):
    """вернёт все решённые записи с тем же ключом"""
    return await unmatched_service.resolve(
        session, unmatched_id=unmatched_id, target_id=body.target_id, actor_id=admin.id
    )


@integrations_router.post(
    "/unmatched/{unmatched_id}/reject", response_model=UnmatchedRead
)
async def reject_unmatched(unmatched_id: int, session: SessionDep, admin: CurrentUser):
    return await unmatched_service.reject(
        session, unmatched_id=unmatched_id, actor_id=admin.id
    )


@integrations_router.get("/export")
async def export(
    session: SessionDep,
    admin: CurrentUser,
    university_ids: Annotated[list[int] | None, Query()] = None,
    program_ids: Annotated[list[int] | None, Query()] = None,
    include_closed: bool = False,
):
    """выгрузка Э (К §2.5) файлом JSON; запуск - в журнал"""
    data = await export_service.export(
        session,
        admin.id,
        university_ids=university_ids,
        program_ids=program_ids,
        include_closed=include_closed,
    )
    stamp = datetime.now(BUSINESS_TZ).strftime("%Y%m%d-%H%M")
    return Response(
        json.dumps(data, ensure_ascii=False, indent=2),
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="export_{stamp}.json"'},
    )


@integrations_router.get("/lms-stats", response_model=list[LmsStatsRead])
async def lms_stats(
    session: SessionDep, university_id: int | None = None, program_id: int | None = None
):
    stmt = select(LmsStats).order_by(LmsStats.university_id, LmsStats.program_id)
    if university_id is not None:
        stmt = stmt.where(LmsStats.university_id == university_id)
    if program_id is not None:
        stmt = stmt.where(LmsStats.program_id == program_id)
    return list(await session.scalars(stmt))


# --- предложения LMS: решает руководитель


@integration_proposals_router.get("", response_model=list[ProposalRead])
async def list_proposals(
    session: SessionDep,
    user: CurrentUser,
    status: ProposalStatus | None = ProposalStatus.PENDING,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
):
    return await proposals.visible(session, user, status, limit, offset)


@integration_proposals_router.post(
    "/{proposal_id}/approve", response_model=ProposalRead
)
async def approve_proposal(
    proposal_id: int, body: ProposalApprove, session: SessionDep, user: CurrentUser
):
    return await proposals.approve(
        session,
        proposal_id=proposal_id,
        actor_id=user.id,
        workflow_id=body.workflow_id,
        comment=body.comment,
    )


@integration_proposals_router.post("/{proposal_id}/reject", response_model=ProposalRead)
async def reject_proposal(
    proposal_id: int, body: ProposalReject, session: SessionDep, user: CurrentUser
):
    return await proposals.reject(
        session, proposal_id=proposal_id, actor_id=user.id, comment=body.comment
    )
