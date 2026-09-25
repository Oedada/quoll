"""Правка справочников: одна схема на все - запись, журнал, отказ по ссылкам"""

from typing import Any

from pydantic import BaseModel
from sqlalchemy import ColumnElement, select
from sqlalchemy.ext.asyncio import AsyncSession

from quoll.auth.audit import record
from quoll.auth.audit_models import AuditEventType, TargetType
from quoll.core.base_repository import BaseRepository
from quoll.core.exceptions import IdNotExistsException
from quoll.db import Base


async def create(
    session: AsyncSession,
    model: type[Base],
    target: TargetType,
    data: BaseModel,
    actor_id: str,
) -> Base:
    item = await BaseRepository(session, model).create(data)
    record(
        session,
        actor_id=actor_id,
        event_type=AuditEventType.CATALOG_ITEM_CREATED,
        target_type=target,
        target_id=item.id,
        new_value=data.model_dump(mode="json"),
    )
    return item


async def update(
    session: AsyncSession,
    model: type[Base],
    target: TargetType,
    item_id: int,
    changes: BaseModel | dict[str, Any],
    actor_id: str,
) -> Base:
    repo = BaseRepository(session, model)
    new = (
        changes if isinstance(changes, dict) else changes.model_dump(exclude_unset=True)
    )
    item = await repo.get(item_id)
    old = {k: getattr(item, k) for k in new}
    item = await repo.update(item_id, new)
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
