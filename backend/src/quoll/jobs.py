"""Какие фоновые процессы поднимает приложение и с каким тактом.

отдельным модулем: процессы из разных модулей, а main.py про HTTP
"""

import logging

from sqlalchemy.ext.asyncio import async_sessionmaker

from quoll.auth.session_store import SessionStore
from quoll.config import settings
from quoll.core.worker import Periodic

logger = logging.getLogger(__name__)


def background_jobs(session_maker: async_sessionmaker) -> list[Periodic]:
    sessions = SessionStore(session_maker)

    async def clean_sessions() -> None:
        removed = await sessions.delete_expired()
        if removed:
            logger.info(f"Removed {removed} expired sessions")

    return [
        Periodic(
            "session-cleanup", settings.session_cleanup_interval_seconds, clean_sessions
        ),
    ]
