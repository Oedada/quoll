from fastapi import APIRouter, Depends, Path, Query, Response, status

from quoll.auth.dependencies import AdminOnly, get_current_user
from quoll.core import SystemDefaults
from quoll.workflows.dependencies import (
    StageRepoDep,
    TransitionRepoDep,
    WorkflowRepoDep,
)
from quoll.workflows.schemas import (
    StageCreate,
    StageRead,
    StageUpdate,
    WorkflowCreate,
    WorkflowDetailRead,
    WorkflowRead,
    WorkflowTransitionCreate,
    WorkflowTransitionRead,
    WorkflowTransitionUpdate,
    WorkflowUpdate,
)

workflows_router = APIRouter(
    prefix="/api/v1/workflows",
    tags=["Workflows"],
    dependencies=[Depends(get_current_user)],
)
stages_router = APIRouter(
    prefix="/api/v1/stages",
    tags=["Workflow Stages"],
    dependencies=[Depends(get_current_user)],
)
transitions_router = APIRouter(
    prefix="/api/v1/transitions",
    tags=["Workflow Transitions"],
    dependencies=[Depends(get_current_user)],
)


# Workflows Endpoints


@workflows_router.post(
    "/",
    response_model=WorkflowRead,
    status_code=status.HTTP_201_CREATED,
    summary="Create a new workflow",
    dependencies=[AdminOnly],
)
async def create_workflow(
    schema: WorkflowCreate,
    repo: WorkflowRepoDep,
):
    return await repo.create(schema)


@workflows_router.get(
    "/",
    response_model=list[WorkflowRead],
    summary="List workflows with pagination",
)
async def list_workflows(
    repo: WorkflowRepoDep,
    limit: int = Query(
        default=SystemDefaults.DEFAULT_PAGE_SIZE,
        ge=1,
        le=SystemDefaults.MAX_PAGE_SIZE,
    ),
    offset: int = Query(default=0, ge=0),
):
    return await repo.get_all(limit=limit, offset=offset)


@workflows_router.get(
    "/{id}",
    response_model=WorkflowDetailRead,
    summary="Get workflow details with stages and transitions",
)
async def get_workflow(
    repo: WorkflowRepoDep,
    id: int = Path(..., ge=1, description="Workflow ID"),
):
    return await repo.get_with_details(id)


@workflows_router.patch(
    "/{id}",
    response_model=WorkflowRead,
    summary="Partially update a workflow",
    dependencies=[AdminOnly],
)
async def update_workflow(
    schema: WorkflowUpdate,
    repo: WorkflowRepoDep,
    id: int = Path(..., ge=1, description="Workflow ID"),
):
    return await repo.update(id, schema)


@workflows_router.delete(
    "/{id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a workflow",
    dependencies=[AdminOnly],
)
async def delete_workflow(
    repo: WorkflowRepoDep,
    id: int = Path(..., ge=1, description="Workflow ID"),
):
    await repo.delete(id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# Stages Endpoints


@stages_router.post(
    "/",
    response_model=StageRead,
    status_code=status.HTTP_201_CREATED,
    summary="Add a new stage to a workflow",
    dependencies=[AdminOnly],
)
async def create_stage(
    schema: StageCreate,
    repo: StageRepoDep,
):
    return await repo.create(schema)


@stages_router.get(
    "/by-workflow/{workflow_id}",
    response_model=list[StageRead],
    summary="Get stages for a workflow ordered by position",
)
async def get_stages_by_workflow(
    repo: StageRepoDep,
    workflow_id: int = Path(..., ge=1, description="Workflow ID"),
):
    return await repo.get_by_workflow_id(workflow_id)


@stages_router.get(
    "/{id}",
    response_model=StageRead,
    summary="Get stage by ID",
)
async def get_stage(
    repo: StageRepoDep,
    id: int = Path(..., ge=1, description="Stage ID"),
):
    return await repo.get(id)


@stages_router.patch(
    "/{id}",
    response_model=StageRead,
    summary="Partially update a stage",
    dependencies=[AdminOnly],
)
async def update_stage(
    schema: StageUpdate,
    repo: StageRepoDep,
    id: int = Path(..., ge=1, description="Stage ID"),
):
    return await repo.update(id, schema)


@stages_router.delete(
    "/{id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a stage",
    dependencies=[AdminOnly],
)
async def delete_stage(
    repo: StageRepoDep,
    id: int = Path(..., ge=1, description="Stage ID"),
):
    await repo.delete(id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# Transitions Endpoints


@transitions_router.post(
    "/",
    response_model=WorkflowTransitionRead,
    status_code=status.HTTP_201_CREATED,
    summary="Create a transition between stages",
    dependencies=[AdminOnly],
)
async def create_transition(
    schema: WorkflowTransitionCreate,
    repo: TransitionRepoDep,
):
    return await repo.create(schema)


@transitions_router.get(
    "/available",
    response_model=list[WorkflowTransitionRead],
    summary="Get available active transitions from a given stage",
)
async def get_available_transitions(
    repo: TransitionRepoDep,
    workflow_id: int = Query(..., ge=1, description="Workflow ID"),
    from_stage_id: int | None = Query(
        default=None, ge=1, description="Current stage ID (None for initial entry)"
    ),
):
    return await repo.get_available_transitions(
        workflow_id=workflow_id, from_stage_id=from_stage_id
    )


@transitions_router.get(
    "/{id}",
    response_model=WorkflowTransitionRead,
    summary="Get a transition by ID with its attachments",
)
async def get_transition(
    repo: TransitionRepoDep,
    id: int = Path(..., ge=1, description="Transition ID"),
):
    return await repo.get(id)


@transitions_router.patch(
    "/{id}",
    response_model=WorkflowTransitionRead,
    summary="Partially update a transition",
    dependencies=[AdminOnly],
)
async def update_transition(
    schema: WorkflowTransitionUpdate,
    repo: TransitionRepoDep,
    id: int = Path(..., ge=1, description="Transition ID"),
):
    return await repo.update(id, schema)


@transitions_router.post(
    "/{id}/attachments/{attachment_id}",
    status_code=status.HTTP_201_CREATED,
    summary="Link an attachment to a transition",
    dependencies=[AdminOnly],
)
async def link_attachment(
    repo: TransitionRepoDep,
    id: int = Path(..., ge=1, description="Transition ID"),
    attachment_id: int = Path(..., ge=1, description="Attachment ID"),
):
    await repo.get(id)
    await repo.link_attachment(id, attachment_id)
    return Response(status_code=status.HTTP_201_CREATED)


@transitions_router.delete(
    "/{id}/attachments/{attachment_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Unlink an attachment from a transition",
    dependencies=[AdminOnly],
)
async def unlink_attachment(
    repo: TransitionRepoDep,
    id: int = Path(..., ge=1, description="Transition ID"),
    attachment_id: int = Path(..., ge=1, description="Attachment ID"),
):
    await repo.get(id)
    await repo.unlink_attachment(id, attachment_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@transitions_router.delete(
    "/{id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a transition",
    dependencies=[AdminOnly],
)
async def delete_transition(
    repo: TransitionRepoDep,
    id: int = Path(..., ge=1, description="Transition ID"),
):
    await repo.delete(id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
