from fastapi import APIRouter, Depends, Path, Query, Response, status

from quoll.auth.dependencies import AdminOnly, get_current_user
from quoll.core import SystemDefaults
from quoll.interactions.dependencies import (
    InteractionRepoDep,
    UniversityRepoDep,
    VendorRepoDep,
)
from quoll.interactions.schemas import (
    InteractionCreate,
    InteractionDetailRead,
    InteractionRead,
    InteractionUpdate,
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
    summary="Create a new interaction",
)
async def create_interaction(
    schema: InteractionCreate,
    repo: InteractionRepoDep,
):
    return await repo.create(schema)


@interactions_router.get(
    "/",
    response_model=list[InteractionRead],
    summary="List interactions with optional filtering by university or vendor",
)
async def list_interactions(
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
    if university_id is not None:
        return await repo.get_by_university(university_id)
    if vendor_id is not None:
        return await repo.get_by_vendor(vendor_id)
    return await repo.get_all(limit=limit, offset=offset)


@interactions_router.get(
    "/{id}",
    response_model=InteractionDetailRead,
    summary="Get interaction details with fully hydrated relations",
)
async def get_interaction(
    repo: InteractionRepoDep,
    id: int = Path(..., ge=1, description="Interaction ID"),
):
    return await repo.get_with_details(id)


@interactions_router.patch(
    "/{id}",
    response_model=InteractionRead,
    summary="Partially update an interaction (status, history, etc.)",
)
async def update_interaction(
    schema: InteractionUpdate,
    repo: InteractionRepoDep,
    id: int = Path(..., ge=1, description="Interaction ID"),
):
    return await repo.update(id, schema)


@interactions_router.delete(
    "/{id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete an interaction",
)
async def delete_interaction(
    repo: InteractionRepoDep,
    id: int = Path(..., ge=1, description="Interaction ID"),
):
    await repo.delete(id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
