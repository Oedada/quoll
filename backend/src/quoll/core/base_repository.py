from typing import Generic, TypeVar, Type
from sqlalchemy import select, delete as sa_delete
from sqlalchemy.ext.asyncio import AsyncSession
from quoll.core import IdNotExistsException

ModelType = TypeVar("ModelType")

class BaseRepository(Generic[ModelType]):
    model: Type[ModelType]  # переопределяется в наследнике

    def __init__(self, session: AsyncSession):
        self.session = session

    async def get(self, id_: int) -> ModelType:
        obj: ModelType = await self.session.get(self.model, id_)
        if obj is None:
            raise IdNotExistsException(self.model.__name__)
        return obj

    async def create(self, obj: ModelType) -> ModelType:
        self.session.add(obj)
        await self.session.flush()
        return obj

    async def update(self, id_: int, **kwargs) -> ModelType:
        existing = await self.get(id_)
        for k, v in kwargs.items():
            setattr(existing, k, v)
        await self.session.flush()
        return await self.get(id_)

    async def delete(self, id_: int) -> bool:
        deleted_row_count: int = (await self.session.execute(sa_delete(self.model).where(self.model.id == id_))).rowcount
        await self.session.flush()
        return deleted_row_count > 0
