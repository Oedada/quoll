import json
from typing import Annotated

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    File,
    Form,
    HTTPException,
    Path,
    Query,
    Response,
    UploadFile,
    status,
)
from fastapi.responses import JSONResponse

from quoll.attachments.dependencies import AttachmentServiceDep
from quoll.attachments.schemas import AttachmentRead
from quoll.auth.dependencies import (
    AdminOnly,
    AdminUser,
    CurrentUser,
    ManagerUser,
    SupervisorUser,
    get_current_user,
)
from quoll.core import SystemDefaults
from quoll.core.exceptions import DomainRuleException
from quoll.interactions import (
    document_service,
    import_service,
    project_service,
    request_service,
    step_service,
    transition_service,
)
from quoll.interactions.access_policy import readable_filter
from quoll.interactions.dependencies import (
    ChangeableInteraction,
    DeletableInteraction,
    InteractionId,
    InteractionRepoDep,
    ReadableInteraction,
    SessionDep,
    UniversityRepoDep,
    VendorRepoDep,
)
from quoll.interactions.models import RequestKind, RequestStatus
from quoll.interactions.schemas import (
    AcceptRequest,
    AssignRequest,
    CloseRequest,
    DeclineRequest,
    DocumentDecision,
    DocumentRead,
    InteractionCreate,
    InteractionDetailRead,
    InteractionHistoryRead,
    InteractionImportResult,
    InteractionRead,
    InteractionUpdate,
    PauseRequest,
    ReopenRequest,
    RequestApprove,
    RequestCreate,
    RequestRead,
    RequestReject,
    RollbackRequest,
    StageValuesRead,
    StageValuesWrite,
    TransitionRequest,
    UniversityCreate,
    UniversityRead,
    UniversityUpdate,
    VendorCreate,
    VendorRead,
    VendorUpdate,
)

universities_router = APIRouter(
    prefix="/api/v1/universities",
    tags=["Universities"],
    dependencies=[Depends(get_current_user)],
)
vendors_router = APIRouter(
    prefix="/api/v1/vendors",
    tags=["Vendors"],
    dependencies=[Depends(get_current_user)],
)
interactions_router = APIRouter(
    prefix="/api/v1/interactions",
    tags=["Interactions"],
    dependencies=[Depends(get_current_user)],
)


# Universities Endpoints


@universities_router.post(
    "/",
    response_model=UniversityRead,
    status_code=status.HTTP_201_CREATED,
    summary="Register a new university",
    dependencies=[AdminOnly],
)
async def create_university(
    schema: UniversityCreate,
    repo: UniversityRepoDep,
):
    return await repo.create(schema)


@universities_router.get(
    "/",
    response_model=list[UniversityRead],
    summary="List universities with pagination",
)
async def list_universities(
    repo: UniversityRepoDep,
    limit: int = Query(
        default=SystemDefaults.DEFAULT_PAGE_SIZE,
        ge=1,
        le=SystemDefaults.MAX_PAGE_SIZE,
    ),
    offset: int = Query(default=0, ge=0),
):
    return await repo.get_all(limit=limit, offset=offset)


@universities_router.get(
    "/{id}",
    response_model=UniversityRead,
    summary="Get university details",
)
async def get_university(
    repo: UniversityRepoDep,
    id: int = Path(..., ge=1, description="University ID"),
):
    return await repo.get(id)


@universities_router.patch(
    "/{id}",
    response_model=UniversityRead,
    summary="Partially update a university",
    dependencies=[AdminOnly],
)
async def update_university(
    schema: UniversityUpdate,
    repo: UniversityRepoDep,
    id: int = Path(..., ge=1, description="University ID"),
):
    return await repo.update(id, schema)


@universities_router.delete(
    "/{id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a university",
    dependencies=[AdminOnly],
)
async def delete_university(
    repo: UniversityRepoDep,
    id: int = Path(..., ge=1, description="University ID"),
):
    await repo.delete(id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# Vendors Endpoints


@vendors_router.post(
    "/",
    response_model=VendorRead,
    status_code=status.HTTP_201_CREATED,
    summary="Register a new vendor",
    dependencies=[AdminOnly],
)
async def create_vendor(
    schema: VendorCreate,
    repo: VendorRepoDep,
):
    return await repo.create(schema)


@vendors_router.get(
    "/",
    response_model=list[VendorRead],
    summary="List vendors with pagination",
)
async def list_vendors(
    repo: VendorRepoDep,
    limit: int = Query(
        default=SystemDefaults.DEFAULT_PAGE_SIZE,
        ge=1,
        le=SystemDefaults.MAX_PAGE_SIZE,
    ),
    offset: int = Query(default=0, ge=0),
):
    return await repo.get_all(limit=limit, offset=offset)


@vendors_router.get(
    "/{id}",
    response_model=VendorRead,
    summary="Get vendor details",
)
async def get_vendor(
    repo: VendorRepoDep,
    id: int = Path(..., ge=1, description="Vendor ID"),
):
    return await repo.get(id)


@vendors_router.patch(
    "/{id}",
    response_model=VendorRead,
    summary="Partially update a vendor",
    dependencies=[AdminOnly],
)
async def update_vendor(
    schema: VendorUpdate,
    repo: VendorRepoDep,
    id: int = Path(..., ge=1, description="Vendor ID"),
):
    return await repo.update(id, schema)


@vendors_router.delete(
    "/{id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a vendor",
    dependencies=[AdminOnly],
)
async def delete_vendor(
    repo: VendorRepoDep,
    id: int = Path(..., ge=1, description="Vendor ID"),
):
    await repo.delete(id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# Interactions Endpoints


@interactions_router.post(
    "/import",
    response_model=InteractionImportResult,
    summary="Import interactions from an xls/xlsx registry, each offered to its manager",
)
async def import_interactions(
    admin: AdminUser,
    session: SessionDep,
    file: Annotated[UploadFile, File()],
    workflow_id: Annotated[int, Form()],
    dry_run: bool = False,
):
    try:
        rows = import_service.read_rows(await file.read(), file.filename)
    except Exception as e:
        raise HTTPException(400, detail=f"Invalid excel file: {e}") from e
    return await import_service.import_rows(
        session, rows, workflow_id=workflow_id, actor_id=admin.id, dry_run=dry_run
    )


@interactions_router.post(
    "/",
    response_model=InteractionRead,
    status_code=status.HTTP_201_CREATED,
    summary="Create a draft interaction, visible to its author until assigned",
)
async def create_interaction(
    schema: InteractionCreate, user: SupervisorUser, session: SessionDep
):
    return await project_service.create_interaction(session, schema, user.id)


@interactions_router.get(
    "/",
    response_model=list[InteractionRead],
    summary="List interactions visible to the current user",
)
async def list_interactions(
    user: CurrentUser,
    repo: InteractionRepoDep,
    university_id: int | None = Query(
        default=None, ge=1, description="Filter by University ID"
    ),
    vendor_id: int | None = Query(
        default=None, ge=1, description="Filter by Vendor ID"
    ),
    limit: int = Query(
        default=SystemDefaults.DEFAULT_PAGE_SIZE,
        ge=1,
        le=SystemDefaults.MAX_PAGE_SIZE,
    ),
    offset: int = Query(default=0, ge=0),
):
    return await repo.list_visible(
        readable_filter(user),
        university_id=university_id,
        vendor_id=vendor_id,
        limit=limit,
        offset=offset,
    )


@interactions_router.post(
    "/{id}/assign",
    response_model=InteractionRead,
    summary="Assign or reassign an interaction to a manager",
)
async def assign_interaction(
    id: InteractionId,
    body: AssignRequest,
    user: SupervisorUser,
    session: SessionDep,
):
    return await project_service.assign(
        session,
        interaction_id=id,
        actor_id=user.id,
        manager_id=body.manager_id,
        expected_owner_id=body.expected_owner_id,
        reason=body.reason,
    )


@interactions_router.post(
    "/{id}/transition",
    response_model=InteractionRead,
    summary="Move an interaction along an active workflow edge",
)
async def move_interaction(
    id: InteractionId,
    body: TransitionRequest,
    user: CurrentUser,
    session: SessionDep,
):
    return await transition_service.transition(
        session,
        interaction_id=id,
        actor_id=user.id,
        to_stage_id=body.to_stage_id,
        expected_state_id=body.expected_state_id,
        comment=body.comment,
    )


@interactions_router.post(
    "/{id}/accept",
    response_model=InteractionRead,
    summary="Owner accepts an assigned interaction and puts it on the start stage",
)
async def accept_interaction(
    id: InteractionId, body: AcceptRequest, user: CurrentUser, session: SessionDep
):
    return await transition_service.accept(
        session,
        interaction_id=id,
        actor_id=user.id,
        to_stage_id=body.to_stage_id,
        comment=body.comment,
    )


@interactions_router.post(
    "/{id}/rollback",
    response_model=InteractionRead,
    summary="Owner's supervisor returns the interaction several steps back",
)
async def rollback_interaction(
    id: InteractionId, body: RollbackRequest, user: CurrentUser, session: SessionDep
):
    return await transition_service.rollback(
        session,
        interaction_id=id,
        actor_id=user.id,
        to_stage_id=body.to_stage_id,
        expected_state_id=body.expected_state_id,
        comment=body.comment,
    )


@interactions_router.post(
    "/{id}/decline",
    response_model=InteractionRead,
    summary="Owner declines an interaction not accepted yet, it returns to the author",
)
async def decline_interaction(
    id: InteractionId, body: DeclineRequest, user: CurrentUser, session: SessionDep
):
    return await project_service.decline(
        session, interaction_id=id, actor_id=user.id, comment=body.comment
    )


@interactions_router.post(
    "/{id}/close",
    response_model=InteractionRead,
    summary="Close an interaction early into a terminal stage",
)
async def close_interaction(
    id: InteractionId,
    body: CloseRequest,
    user: CurrentUser,
    session: SessionDep,
):
    return await transition_service.close(
        session,
        interaction_id=id,
        actor_id=user.id,
        to_stage_id=body.to_stage_id,
        expected_state_id=body.expected_state_id,
        comment=body.comment,
    )


@interactions_router.post(
    "/{id}/reopen",
    response_model=InteractionRead,
    summary="Return a closed interaction to work with a chosen manager and stage",
)
async def reopen_interaction(
    id: InteractionId,
    body: ReopenRequest,
    user: CurrentUser,
    session: SessionDep,
):
    return await project_service.reopen(
        session,
        interaction_id=id,
        actor_id=user.id,
        manager_id=body.manager_id,
        to_stage_id=body.to_stage_id,
        expected_owner_id=body.expected_owner_id,
        comment=body.comment,
    )


@interactions_router.post(
    "/{id}/requests",
    response_model=RequestRead,
    status_code=status.HTTP_201_CREATED,
    summary="Ask the supervisor to transfer or close the interaction",
)
async def create_request(
    id: InteractionId,
    body: RequestCreate,
    user: ManagerUser,
    session: SessionDep,
):
    return await request_service.create(
        session,
        interaction_id=id,
        actor_id=user.id,
        kind=RequestKind(body.kind),
        target_stage_id=body.target_stage_id,
        target_manager_id=body.target_manager_id,
        reason=body.reason,
    )


def _json_object(raw: str | None) -> dict:
    if raw is None:
        return {}
    try:
        value = json.loads(raw)
    except json.JSONDecodeError as err:
        raise DomainRuleException(422, "metadata must be a JSON object") from err
    if not isinstance(value, dict):
        raise DomainRuleException(422, "metadata must be a JSON object")
    return value


def _document(view) -> DocumentRead:
    doc = view.document
    return DocumentRead(
        id=doc.id,
        interaction_id=doc.interaction_id,
        stage_id=doc.stage_id,
        uploaded_by=doc.uploaded_by,
        replaces_document_id=doc.replaces_document_id,
        title=doc.title,
        kind=doc.kind,
        metadata=doc.meta,
        is_current=view.is_current,
        status=doc.status,
        created_at=doc.created_at,
        attachment=AttachmentRead.model_validate(view.attachment),
    )


@interactions_router.get("/{id}/documents", response_model=list[DocumentRead])
async def list_documents(interaction: ReadableInteraction, session: SessionDep):
    return [
        _document(v) for v in await document_service.documents(session, interaction.id)
    ]


@interactions_router.post(
    "/{id}/documents",
    response_model=DocumentRead,
    status_code=status.HTTP_201_CREATED,
    summary="Attach a project file to a chosen stage, optionally as a new version",
)
async def attach_document(
    id: InteractionId,
    user: CurrentUser,
    session: SessionDep,
    attachments: AttachmentServiceDep,
    file: Annotated[UploadFile, File()],
    # стадия - снаружи: приложить можно к любой стадии воркфлоу
    stage_id: Annotated[int, Form()],
    replaces_document_id: Annotated[int | None, Form()] = None,
    title: Annotated[str | None, Form(max_length=255)] = None,
    kind: Annotated[str | None, Form(max_length=100)] = None,
    # multipart не несёт вложенных объектов - JSON строкой
    metadata: Annotated[str | None, Form()] = None,
):
    view = await document_service.upload(
        session,
        attachments,
        interaction_id=id,
        actor=user,
        file=file,
        stage_id=stage_id,
        replaces_document_id=replaces_document_id,
        title=title,
        kind=kind,
        meta=_json_object(metadata),
    )
    return _document(view)


@interactions_router.post(
    "/{id}/pause",
    response_model=InteractionRead,
    summary="Pause an interaction or replace its pause",
)
async def pause_interaction(
    id: InteractionId, body: PauseRequest, user: CurrentUser, session: SessionDep
):
    return await project_service.pause(
        session,
        interaction_id=id,
        actor_id=user.id,
        until=body.until,
        comment=body.comment,
    )


@interactions_router.post(
    "/{id}/unpause",
    response_model=InteractionRead,
    summary="Resume a paused interaction",
)
async def unpause_interaction(
    id: InteractionId, user: CurrentUser, session: SessionDep
):
    return await project_service.unpause(session, interaction_id=id, actor_id=user.id)


@interactions_router.get(
    "/{id}",
    response_model=InteractionDetailRead,
    summary="Get interaction details with fully hydrated relations",
)
async def get_interaction(interaction: ReadableInteraction):
    return interaction


@interactions_router.patch(
    "/{id}",
    response_model=InteractionRead,
    summary="Update descriptive fields of an interaction",
)
async def update_interaction(
    schema: InteractionUpdate,
    interaction: ChangeableInteraction,
    user: CurrentUser,
    session: SessionDep,
):
    return await project_service.update_fields(session, interaction, schema, user.id)


@interactions_router.get(
    "/{id}/history",
    response_model=InteractionHistoryRead,
    summary="Stage moves and assignments of an interaction",
)
async def interaction_history(
    interaction: ReadableInteraction, repo: InteractionRepoDep
) -> InteractionHistoryRead:
    return InteractionHistoryRead(
        stages=await repo.stage_history(interaction.id),
        assignments=await repo.assignments(interaction.id),
    )


@interactions_router.get(
    "/{id}/stage-values",
    response_model=list[StageValuesRead],
    summary="Filled fields of every stage of an interaction",
)
async def list_stage_values(interaction: ReadableInteraction, session: SessionDep):
    return await step_service.all_values(session, interaction.id)


@interactions_router.put(
    "/{id}/stage-values/{stage_id}",
    response_model=StageValuesRead,
    summary="Replace field values of the current or a passed stage",
)
async def put_stage_values(
    id: InteractionId,
    stage_id: int,
    body: StageValuesWrite,
    user: CurrentUser,
    session: SessionDep,
):
    return await step_service.set_values(
        session,
        interaction_id=id,
        stage_id=stage_id,
        values=body.values,
        actor_id=user.id,
    )


@interactions_router.post(
    "/{id}/stage-values/{stage_id}/approve",
    response_model=StageValuesRead,
    summary="Supervisor applies a pending edit of a passed step",
)
async def approve_stage_values(
    id: InteractionId, stage_id: int, user: CurrentUser, session: SessionDep
):
    return await step_service.decide(
        session, interaction_id=id, stage_id=stage_id, actor_id=user.id, approve=True
    )


@interactions_router.post(
    "/{id}/stage-values/{stage_id}/reject",
    response_model=StageValuesRead,
    summary="Supervisor drops a pending edit of a passed step",
)
async def reject_stage_values(
    id: InteractionId, stage_id: int, user: CurrentUser, session: SessionDep
):
    return await step_service.decide(
        session, interaction_id=id, stage_id=stage_id, actor_id=user.id, approve=False
    )


@interactions_router.delete(
    "/{id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a draft that never entered a stage",
)
async def delete_interaction(
    interaction: DeletableInteraction, user: CurrentUser, session: SessionDep
):
    await project_service.delete_draft(
        session, interaction_id=interaction.id, actor_id=user.id
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


requests_router = APIRouter(
    prefix="/api/v1/requests",
    tags=["Interaction requests"],
    dependencies=[Depends(get_current_user)],
)


@requests_router.get("/", response_model=list[RequestRead])
async def list_requests(
    user: CurrentUser,
    session: SessionDep,
    status_filter: Annotated[RequestStatus | None, Query(alias="status")] = None,
    limit: int = Query(
        default=SystemDefaults.DEFAULT_PAGE_SIZE, ge=1, le=SystemDefaults.MAX_PAGE_SIZE
    ),
    offset: int = Query(default=0, ge=0),
):
    return await request_service.visible(session, user, status_filter, limit, offset)


@requests_router.post("/{id}/approve", response_model=RequestRead)
async def approve_request(
    id: int, body: RequestApprove, user: SupervisorUser, session: SessionDep
):
    decision = await request_service.approve(
        session,
        request_id=id,
        actor_id=user.id,
        target_manager_id=body.target_manager_id,
        comment=body.comment,
    )
    if decision.refused is not None:
        # без исключения: сессия закоммитит отмену устаревшей просьбы
        return JSONResponse(status_code=409, content={"detail": decision.refused})
    return decision.request


@requests_router.post("/{id}/reject", response_model=RequestRead)
async def reject_request(
    id: int, body: RequestReject, user: SupervisorUser, session: SessionDep
):
    return await request_service.reject(
        session, request_id=id, actor_id=user.id, comment=body.comment
    )


@requests_router.delete("/{id}", status_code=status.HTTP_204_NO_CONTENT)
async def withdraw_request(id: int, user: ManagerUser, session: SessionDep):
    await request_service.withdraw(session, request_id=id, actor_id=user.id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


documents_router = APIRouter(
    prefix="/api/v1/documents",
    tags=["Interaction documents"],
    dependencies=[Depends(get_current_user)],
)


@documents_router.post("/{id}/approve", response_model=DocumentRead)
async def approve_document(
    id: int, body: DocumentDecision, user: CurrentUser, session: SessionDep
):
    return _document(
        await document_service.decide(
            session,
            document_id=id,
            actor_id=user.id,
            approve=True,
            comment=body.comment,
        )
    )


@documents_router.post("/{id}/reject", response_model=DocumentRead)
async def reject_document(
    id: int, body: DocumentDecision, user: CurrentUser, session: SessionDep
):
    return _document(
        await document_service.decide(
            session,
            document_id=id,
            actor_id=user.id,
            approve=False,
            comment=body.comment,
        )
    )


@documents_router.delete(
    "/{id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[AdminOnly]
)
async def delete_document(
    id: int,
    admin: AdminUser,
    session: SessionDep,
    attachments: AttachmentServiceDep,
    background: BackgroundTasks,
):
    storage_key = await document_service.delete_document(
        session, document_id=id, actor_id=admin.id
    )
    # после коммита: фоновые задачи идут уже после ответа
    background.add_task(attachments.s3.delete, storage_key)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
