"""Блокировки строк в едином порядке.

Порядок: Superviser -> Manager -> User -> Interaction -> PendingOrgAction ->
Workflow -> Stage, внутри уровня по возрастанию id. Иначе дедлок.

select(Manager).with_for_update() не годится - Manager наследует User, и запрос
блокирует ещё и строку users, причём раньше. Поэтому везде FOR UPDATE OF.
"""

import logging
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from quoll.db import Base

logger = logging.getLogger(__name__)


async def lock_row[ModelType: Base](
    session: AsyncSession, model: type[ModelType], ident: Any
) -> ModelType | None:
    """заблокировать одну строку нужного уровня"""
    logger.debug(f"Locking {model.__name__} id={ident}")
    stmt = (
        select(model).where(model.id == ident).with_for_update(of=model.__table__)  # pyright: ignore [reportAttributeAccessIssue]
    )
    return (await session.execute(stmt)).scalar_one_or_none()


async def lock_rows[ModelType: Base](
    session: AsyncSession, model: type[ModelType], idents: list[Any]
) -> dict[Any, ModelType]:
    """заблокировать несколько строк одного уровня по возрастанию id.

    по одному запросу на строку - иначе порядок захвата решает планировщик
    """
    locked: dict[Any, ModelType] = {}
    for ident in sorted({i for i in idents if i is not None}):
        row = await lock_row(session, model, ident)
        if row is not None:
            locked[ident] = row
    return locked
