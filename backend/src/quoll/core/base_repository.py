from typing import Any

from pydantic import BaseModel
from sqlalchemy import delete as sa_delete
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from quoll.core.exceptions import IdNotExistsException
from quoll.db import Base

# с python 3.12 синтаксис теперь такой, всё можно указывать напрямую
# по мнению ruff, использовать typing.Type тут - deprecated 
class BaseRepository[ModelType: Base]:
    model: type[ModelType]  # переопределяется в наследнике

    def __init__(self, session: AsyncSession):
        self.session = session

    async def get(self, id_: int) -> ModelType:
        obj = await self.session.get(self.model, id_)
        if obj is None:
            raise IdNotExistsException(self.model.__name__)
        return obj

    # по-идее должно выводить списки
    async def get_all(self, limit: int = 100, offset: int = 0) -> list[ModelType]:
        stmt = select(self.model).limit(limit).offset(offset)
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def create(
        self, schema_or_data: BaseModel | dict[str, Any] | ModelType
    ) -> ModelType:
        # я не хочу разбирать pydantic ручками каждый раз, поэтому пусть оно будет здесь
        if isinstance(schema_or_data, self.model):
            instance = schema_or_data
        elif isinstance(schema_or_data, BaseModel):
            instance = self.model(**schema_or_data.model_dump())
        else:
            instance = self.model(**schema_or_data)

        self.session.add(instance)
        await self.session.flush()
        return instance

    async def update(
        self, id_: int, schema_or_data: BaseModel | dict[str, Any]
    ) -> ModelType:
        # Юзать kwargs тут оказалось bad practice
        existing = await self.get(id_)
        if isinstance(schema_or_data, BaseModel):
            # exclude_unset=True - чтоб не затирал неуказанные поля, ибо иначе из pydantic у них будет none по дефолту
            update_data = schema_or_data.model_dump(exclude_unset=True)
        else:
            update_data = schema_or_data

        for k, v in update_data.items():
            setattr(existing, k, v)
        await self.session.flush() # после изменения и flush, данные в existing обновляются сами, повторный get можно не надо
        return existing

    async def delete(self, id_: int) -> bool:
        stmt = sa_delete(self.model).where(self.model.id == id_)  # type: ignore[attr-defined]
        result = await self.session.execute(stmt)
        await self.session.flush()
        return (result.rowcount or 0) > 0
