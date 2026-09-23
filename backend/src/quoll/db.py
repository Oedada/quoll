import logging
import re
from collections.abc import AsyncGenerator
from datetime import datetime
from typing import Annotated

from fastapi import Request
from sqlalchemy import DateTime, MetaData, String, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import DeclarativeBase, declared_attr, mapped_column

# Без конвенции ограничения получают имена от СУБД, и автогенерация миграций
# выдаёт безымянные drop_constraint. CHECK-и именуем руками, поэтому для них
# конвенция просто берёт заданное имя как есть
NAMING_CONVENTION = {
    "ix": "ix_%(table_name)s_%(column_0_N_name)s",
    "uq": "uq_%(table_name)s_%(column_0_N_name)s",
    "ck": "%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_N_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}

# удобненькие псевдонимы, пример использования см. в mixins
int_pk = Annotated[int, mapped_column(primary_key=True, autoincrement=True)]
str_255 = Annotated[str, mapped_column(String(255))]
created_at_dt = Annotated[
    datetime,
    mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False),
]
updated_at_dt = Annotated[
    datetime,
    mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    ),
]

logger = logging.getLogger(__name__)


async def get_db_session(req: Request) -> AsyncGenerator[AsyncSession]:
    logger.debug("Creating database session")
    async with req.app.state.db_session_maker() as session:
        try:
            yield session
            logger.debug("Committing session")
            await session.commit()
        except Exception as e:
            logger.error(f"Error during session, rolling back: {e}")
            await session.rollback()
            raise


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING_CONVENTION)

    # спасибо добрым людям со SO за сей прекрасный переименоватор
    @declared_attr.directive
    def __tablename__(cls) -> str:
        name = re.sub(r"(?<!^)(?=[A-Z])", "_", cls.__name__).lower()
        if name.endswith("y") and not name.endswith(("ay", "ey", "oy", "uy")):
            return f"{name[:-1]}ies"
        if name.endswith(("s", "x", "z", "ch", "sh")):
            return f"{name}es"
        return f"{name}s"

    # красоты ради
    def __repr__(self) -> str:
        cols = [
            f"{col}={self.__dict__.get(col, '...')!r}"
            for col in self.__table__.columns.keys()[:4]
        ]
        return f"<{self.__class__.__name__}({', '.join(cols)})>"


class RawBase(DeclarativeBase):
    pass
