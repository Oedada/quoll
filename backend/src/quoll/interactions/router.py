from fastapi import APIRouter, Depends, Path, Query, Response, status

from quoll.auth.dependencies import (
    AdminOnly,
    CurrentUser,
    SupervisorUser,
    get_current_user,
)
from quoll.core import SystemDefaults
from quoll.interactions import project_service, transition_service
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
from quoll.interactions.schemas import (
    AssignRequest,
    CloseRequest,
    InteractionCreate,
    InteractionDetailRead,
    InteractionHistoryRead,
    InteractionRead,
    InteractionUpdate,
    PauseRequest,
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
    repo: InteractionRepoDep,
):
    return await repo.update(interaction.id, schema)


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


@interactions_router.delete(
    "/{id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a draft that never entered a stage",
)
async def delete_interaction(interaction: DeletableInteraction, session: SessionDep):
    await project_service.delete_draft(session, interaction)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
