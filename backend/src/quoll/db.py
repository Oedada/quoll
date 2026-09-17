import logging
from collections.abc import AsyncGenerator

from fastapi import Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import DeclarativeBase

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