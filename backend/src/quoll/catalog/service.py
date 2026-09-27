"""Правка справочников: одна схема на все - запись, журнал, отказ по ссылкам"""

from typing import Any

from pydantic import BaseModel
from sqlalchemy import ColumnElement, insert, select
from sqlalchemy import delete as sa_delete
from sqlalchemy.ext.asyncio import AsyncSession

from quoll.auth.audit import record
from quoll.auth.audit_models import AuditEventType, TargetType
from quoll.core.base_repository import BaseRepository
from quoll.core.exceptions import DomainRuleException, IdNotExistsException
from quoll.db import Base


# поле «*_ids» схемы -> связь модели и модель её элементов
def _links() -> dict[type, dict[str, tuple[str, type]]]:
    from quoll.catalog.models import ItDirection, ItProgram, Product, Specialty

    return {
        Product: {"direction_ids": ("directions", ItDirection)},
        ItProgram: {"product_ids": ("products", Product)},
        Specialty: {"direction_ids": ("directions", ItDirection)},
    }


async def _apply_links(
    session: AsyncSession, item: Base, links: dict[str, list[int]], *, new: bool = False
) -> dict[str, list[int]]:
    """связи многие ко многим; неизвестный id - 400. Вернёт прежние id"""
    old = {}
    for field, ids in links.items():
        attr, target = _links()[type(item)][field]
        found = list(
            await session.scalars(select(target).where(target.id.in_(set(ids))))
        )
        missing = set(ids) - {f.id for f in found}
        if missing:
            raise DomainRuleException(
                400, f"{target.__name__} {sorted(missing)} does not exist"
            )
        # у нового объекта прежних связей нет, а чтение запустило бы загрузку
        if not new:
            old[field] = [x.id for x in getattr(item, attr)]
        setattr(item, attr, found)
    return old


def _split(model: type[Base], data: dict[str, Any]) -> tuple[dict, dict]:
    known = _links().get(model, {})
    links = {k: v for k, v in data.items() if k in known}
    return {k: v for k, v in data.items() if k not in known}, links


async def create(
    session: AsyncSession,
    model: type[Base],
    target: TargetType,
    data: BaseModel,
    actor_id: str,
) -> Base:
    fields, links = _split(model, data.model_dump())
    item = model(**fields)
    await _apply_links(session, item, links, new=True)
    session.add(item)
    await session.flush()
    record(
        session,
        actor_id=actor_id,
        event_type=AuditEventType.CATALOG_ITEM_CREATED,
        target_type=target,
        target_id=item.id,
        new_value=data.model_dump(mode="json"),
    )
    await session.refresh(item)
    return item


async def update(
    session: AsyncSession,
    model: type[Base],
    target: TargetType,
    item_id: int,
    changes: BaseModel | dict[str, Any],
    actor_id: str,
) -> Base:
    new = (
        changes if isinstance(changes, dict) else changes.model_dump(exclude_unset=True)
    )
    item = await BaseRepository(session, model).get(item_id)
    fields, links = _split(model, new)
    old = {k: getattr(item, k) for k in fields}
    for k, v in fields.items():
        setattr(item, k, v)
    old |= await _apply_links(session, item, links)
    await session.flush()
    if new:
        record(
            session,
            actor_id=actor_id,
            event_type=AuditEventType.CATALOG_ITEM_UPDATED,
            target_type=target,
            target_id=item_id,
            old_value=old,
            new_value=new,
        )
    await session.refresh(item)
    return item


async def delete(
    session: AsyncSession,
    model: type[Base],
    target: TargetType,
    item_id: int,
    actor_id: str,
) -> None:
    """на что-то ссылается - 409 от обработчика IntegrityError, не 500"""
    if not await BaseRepository(session, model).delete(item_id):
        raise IdNotExistsException(model.__name__)
    record(
        session,
        actor_id=actor_id,
        event_type=AuditEventType.CATALOG_ITEM_DELETED,
        target_type=target,
        target_id=item_id,
    )


async def listing(
    session: AsyncSession,
    model: type[Base],
    filters: list[ColumnElement[bool]],
    order: list[Any],
    limit: int,
    offset: int,
) -> list[Base]:
    """фильтр до limit - иначе страница врала бы"""
    stmt = select(model).where(*filters).order_by(*order).limit(limit).offset(offset)
    return list(await session.scalars(stmt))


async def set_university_specialties(
    session: AsyncSession, university_id: int, specialty_ids: list[int], actor_id: str
) -> list:
    from quoll.catalog.models import Specialty, university_specialties
    from quoll.interactions.models import University

    if await session.get(University, university_id) is None:
        raise IdNotExistsException(University.__name__)
    found = list(
        await session.scalars(
            select(Specialty).where(Specialty.id.in_(set(specialty_ids)))
        )
    )
    if len(found) != len(set(specialty_ids)):
        raise DomainRuleException(400, "Some specialties do not exist")
    link = university_specialties
    old = list(
        await session.scalars(
            select(link.c.specialty_id).where(link.c.university_id == university_id)
        )
    )
    await session.execute(sa_delete(link).where(link.c.university_id == university_id))
    if found:
        await session.execute(
            insert(link),
            [{"university_id": university_id, "specialty_id": s.id} for s in found],
        )
    record(
        session,
        actor_id=actor_id,
        event_type=AuditEventType.CATALOG_ITEM_UPDATED,
        target_type=TargetType.UNIVERSITY,
        target_id=university_id,
        old_value={"specialty_ids": sorted(old)},
        new_value={"specialty_ids": sorted(s.id for s in found)},
    )
    return sorted(found, key=lambda s: s.code)
