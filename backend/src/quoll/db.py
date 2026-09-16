from collections.abc import AsyncGenerator

from fastapi import Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import DeclarativeBase


async def get_db_session(req: Request) -> AsyncGenerator[AsyncSession]:
    async with req.app.state.db_session_maker() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise



class Base(DeclarativeBase):
    pass
