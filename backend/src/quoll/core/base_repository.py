import logging
from typing import Generic, TypeVar

from sqlalchemy import delete as sa_delete
from sqlalchemy.ext.asyncio import AsyncSession

from quoll.core import IdNotExistsException

logger = logging.getLogger(__name__)

ModelType = TypeVar("ModelType")


class BaseRepository(Generic[ModelType]):
    model: type[ModelType]

    def __init__(self, session: AsyncSession):
        self.session = session

    async def get(self, id_: int) -> ModelType:
        logger.debug(f"Getting {self.model.__name__} with id={id_}")
        obj: ModelType | None = await self.session.get(self.model, id_)
        if obj is None:
            logger.warn(f"{self.model.__name__} with id={id_} not found")
            raise IdNotExistsException(self.model.__name__)
        logger.debug(f"{self.model.__name__} with id={id_} found")
        return obj

    async def create(self, obj: ModelType) -> ModelType:
        logger.debug(f"Creating {self.model.__name__}")
        self.session.add(obj)
        await self.session.flush()
        logger.debug(f"{self.model.__name__} created")
        return obj

    async def update(self, id_: int, **kwargs) -> ModelType:
        logger.debug(f"Updating {self.model.__name__} with id={id_}, kwargs={kwargs}")
        existing = await self.get(id_)
        for k, v in kwargs.items():
            setattr(existing, k, v)
        await self.session.flush()
        logger.debug(f"{self.model.__name__} with id={id_} updated")
        return await self.get(id_)

    async def delete(self, id_: int) -> bool:
        logger.debug(f"Deleting {self.model.__name__} with id={id_}")
        deleted_row_count: int = (
            await self.session.execute(
                sa_delete(self.model).where(self.model.id == id_)
            )
        ).rowcount
        await self.session.flush()
        deleted = deleted_row_count > 0
        logger.debug(f"{self.model.__name__} with id={id_} deleted={deleted}")
        return deleted