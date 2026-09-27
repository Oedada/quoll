from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy import select

from quoll.auth.audit_models import TargetType
from quoll.auth.dependencies import (
    AdminOnly,
    AdminUser,
    get_current_user,
    require_roles,
)
from quoll.auth.models import User, UserRole
from quoll.catalog import service
from quoll.catalog.models import (
    ItDirection,
    ItProgram,
    Product,
    Specialty,
    UniversityContact,
    university_specialties,
)
from quoll.catalog.schemas import (
    ContactPatch,
    ContactRead,
    ContactWrite,
    DirectionPatch,
    DirectionRead,
    DirectionWrite,
    PriorityWrite,
    ProductPatch,
    ProductRead,
    ProductWrite,
    ProgramPatch,
    ProgramRead,
    ProgramWrite,
    SpecialtyPatch,
    SpecialtyRead,
    SpecialtyWrite,
    UniversitySpecialtiesWrite,
)
from quoll.core import SystemDefaults
from quoll.core.base_repository import BaseRepository
from quoll.db import SessionDep

catalog_router = APIRouter(
    prefix="/api/v1/catalog",
    tags=["Catalog"],
    dependencies=[Depends(get_current_user)],
)

Limit = Annotated[int, Query(ge=1, le=SystemDefaults.MAX_PAGE_SIZE)]
Offset = Annotated[int, Query(ge=0)]
Search = Annotated[str | None, Query(max_length=255, description="part of the name")]
# приоритеты курсов расставляют менеджеры и админ (Q19), руководитель - нет
Prioritizer = Annotated[User, Depends(require_roles(UserRole.MANAGER, UserRole.ADMIN))]


def _like(column, q: str | None) -> list:
    return [column.ilike(f"%{q}%")] if q else []


def _crud(path: str, model, target: TargetType, write, patch, read) -> None:
    """создание, чтение, правка и удаление - одинаковые для всех справочников"""

    @catalog_router.post(
        path,
        response_model=read,
        status_code=status.HTTP_201_CREATED,
        name=f"create_{path}",
    )
    async def create(body: write, admin: AdminUser, session: SessionDep):  # type: ignore[valid-type]
        return await service.create(session, model, target, body, admin.id)

    @catalog_router.get(f"{path}/{{item_id}}", response_model=read, name=f"get_{path}")
    async def get(item_id: int, session: SessionDep):
        return await BaseRepository(session, model).get(item_id)

    @catalog_router.patch(
        f"{path}/{{item_id}}", response_model=read, name=f"patch_{path}"
    )
    async def patch(item_id: int, body: patch, admin: AdminUser, session: SessionDep):  # type: ignore[valid-type]
        return await service.update(session, model, target, item_id, body, admin.id)

    @catalog_router.delete(
        f"{path}/{{item_id}}",
        status_code=status.HTTP_204_NO_CONTENT,
        dependencies=[AdminOnly],
        name=f"delete_{path}",
    )
    async def delete(item_id: int, admin: AdminUser, session: SessionDep):
        await service.delete(session, model, target, item_id, admin.id)
        return Response(status_code=status.HTTP_204_NO_CONTENT)


@catalog_router.get("/directions", response_model=list[DirectionRead])
async def list_directions(
    session: SessionDep, q: Search = None, limit: Limit = 50, offset: Offset = 0
):
    return await service.listing(
        session,
        ItDirection,
        _like(ItDirection.name, q),
        [ItDirection.name],
        limit,
        offset,
    )


@catalog_router.get("/products", response_model=list[ProductRead])
async def list_products(
    session: SessionDep,
    q: Search = None,
    vendor_id: int | None = None,
    direction_id: int | None = None,
    is_active: bool | None = None,
    limit: Limit = 50,
    offset: Offset = 0,
):
    filters = _like(Product.name, q)
    if vendor_id is not None:
        filters.append(Product.vendor_id == vendor_id)
    if direction_id is not None:
        filters.append(Product.directions.any(ItDirection.id == direction_id))
    if is_active is not None:
        filters.append(Product.is_active.is_(is_active))
    order = [Product.name, Product.id]
    return await service.listing(session, Product, filters, order, limit, offset)


@catalog_router.get("/programs", response_model=list[ProgramRead])
async def list_programs(
    session: SessionDep,
    q: Search = None,
    direction_id: int | None = None,
    product_id: int | None = None,
    is_active: bool | None = None,
    limit: Limit = 50,
    offset: Offset = 0,
):
    filters = _like(ItProgram.name, q)
    if direction_id is not None:
        filters.append(ItProgram.direction_id == direction_id)
    if product_id is not None:
        filters.append(ItProgram.products.any(Product.id == product_id))
    if is_active is not None:
        filters.append(ItProgram.is_active.is_(is_active))
    # 1 - самая востребованная, без приоритета - в конце (К 2.4)
    order = [ItProgram.priority.asc().nulls_last(), ItProgram.name, ItProgram.id]
    return await service.listing(session, ItProgram, filters, order, limit, offset)


@catalog_router.patch("/programs/{item_id}/priority", response_model=ProgramRead)
async def set_priority(
    item_id: int, body: PriorityWrite, user: Prioritizer, session: SessionDep
):
    return await service.update(
        session,
        ItProgram,
        TargetType.PROGRAM,
        item_id,
        {"priority": body.priority},
        user.id,
    )


@catalog_router.get("/specialties", response_model=list[SpecialtyRead])
async def list_specialties(
    session: SessionDep,
    q: Search = None,
    direction_id: int | None = None,
    university_id: int | None = None,
    limit: Limit = 50,
    offset: Offset = 0,
):
    filters = _like(Specialty.name, q)
    if direction_id is not None:
        filters.append(Specialty.directions.any(ItDirection.id == direction_id))
    if university_id is not None:
        filters.append(
            Specialty.id.in_(
                select(university_specialties.c.specialty_id).where(
                    university_specialties.c.university_id == university_id
                )
            )
        )
    order = [Specialty.code, Specialty.id]
    return await service.listing(session, Specialty, filters, order, limit, offset)


@catalog_router.put(
    "/universities/{university_id}/specialties",
    response_model=list[SpecialtyRead],
    dependencies=[AdminOnly],
)
async def set_university_specialties(
    university_id: int,
    body: UniversitySpecialtiesWrite,
    admin: AdminUser,
    session: SessionDep,
):
    """состав специальностей вуза целиком"""
    return await service.set_university_specialties(
        session, university_id, body.specialty_ids, admin.id
    )


@catalog_router.get("/contacts", response_model=list[ContactRead])
async def list_contacts(
    session: SessionDep,
    q: Search = None,
    university_id: int | None = None,
    is_actual: bool | None = None,
    limit: Limit = 50,
    offset: Offset = 0,
):
    filters = _like(UniversityContact.full_name, q)
    if university_id is not None:
        filters.append(UniversityContact.university_id == university_id)
    if is_actual is not None:
        filters.append(UniversityContact.is_actual.is_(is_actual))
    # основной контакт первым
    order = [UniversityContact.is_primary.desc(), UniversityContact.full_name]
    return await service.listing(
        session, UniversityContact, filters, order, limit, offset
    )


_crud(
    "/directions",
    ItDirection,
    TargetType.DIRECTION,
    DirectionWrite,
    DirectionPatch,
    DirectionRead,
)
_crud("/products", Product, TargetType.PRODUCT, ProductWrite, ProductPatch, ProductRead)
_crud(
    "/programs", ItProgram, TargetType.PROGRAM, ProgramWrite, ProgramPatch, ProgramRead
)
_crud(
    "/specialties",
    Specialty,
    TargetType.SPECIALTY,
    SpecialtyWrite,
    SpecialtyPatch,
    SpecialtyRead,
)
_crud(
    "/contacts",
    UniversityContact,
    TargetType.CONTACT,
    ContactWrite,
    ContactPatch,
    ContactRead,
)
