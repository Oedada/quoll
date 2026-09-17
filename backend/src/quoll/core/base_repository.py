import logging
from typing import Any

from pydantic import BaseModel
from sqlalchemy import delete as sa_delete
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from quoll.core.exceptions import IdNotExistsException
from quoll.db import Base

logger = logging.getLogger(__name__)


class BaseRepository[ModelType: Base]:
    model: type[ModelType]

    def __init__(self, session: AsyncSession):
        self.session = session

    async def get(self, id_: str) -> ModelType:
        logger.debug(f"Getting {self.model.__name__} with id={id_}")
        obj = await self.session.get(self.model, id_)
        if obj is None:
            raise IdNotExistsException(self.model.__name__)
        logger.debug(f"{self.model.__name__} with id={id_} found")
        return obj

    async def get_all(self, limit: int = 100, offset: int = 0) -> list[ModelType]:
        logger.debug(f"Getting all {self.model.__name__} with limit={limit}, offset={offset}")
        stmt = select(self.model).limit(limit).offset(offset)
        result = await self.session.execute(stmt)
        items = list(result.scalars().all())
        logger.debug(f"Found {len(items)} {self.model.__name__}")
        return items

    async def create(
        self, schema_or_data: BaseModel | dict[str, Any] | ModelType
    ) -> ModelType:
        if isinstance(schema_or_data, self.model):
            instance = schema_or_data
        elif isinstance(schema_or_data, BaseModel):
            instance = self.model(**schema_or_data.model_dump())
        else:
            instance = self.model(**schema_or_data)

        logger.debug(f"Creating {self.model.__name__}")
        self.session.add(instance)
        await self.session.flush()
        logger.info(f"{self.model.__name__} created")
        await self.session.refresh(instance)
        return instance

    async def update(
        self, id_: str, schema_or_data: BaseModel | dict[str, Any]
    ) -> ModelType:
        logger.debug(f"Updating {self.model.__name__} with id={id_}")
        existing = await self.get(id_)
        if isinstance(schema_or_data, BaseModel):
            update_data = schema_or_data.model_dump(exclude_unset=True)
        else:
            update_data = schema_or_data

        for k, v in update_data.items():
            setattr(existing, k, v)
        await self.session.flush()
        logger.info(f"{self.model.__name__} with id={id_} updated")
        await self.session.refresh(existing)
        return existing

    async def delete(self, id_: str) -> bool:
        logger.debug(f"Deleting {self.model.__name__} with id={id_}")
        stmt = sa_delete(self.model).where(self.model.id == id_)
        result = await self.session.execute(stmt)
        await self.session.flush()
        deleted = (result.rowcount or 0) > 0
        if deleted:
            logger.info(f"{self.model.__name__} with id={id_} deleted")
        return deleted
