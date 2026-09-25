"""Какие фоновые процессы поднимает приложение и с каким тактом.

отдельным модулем: процессы из разных модулей, а main.py про HTTP
"""

import logging

from sqlalchemy.ext.asyncio import async_sessionmaker

from quoll.auth.session_store import SessionStore
from quoll.config import settings
from quoll.core.worker import Periodic
from quoll.interactions.pause_worker import expire_pauses

logger = logging.getLogger(__name__)


def background_jobs(session_maker: async_sessionmaker) -> list[Periodic]:
    sessions = SessionStore(session_maker)

    async def clean_sessions() -> None:
        removed = await sessions.delete_expired()
        if removed:
            logger.info(f"Removed {removed} expired sessions")

    async def expire_pauses_tick() -> None:
        resumed = await expire_pauses(session_maker)
        if resumed:
            logger.info(f"Resumed {resumed} interactions after their pause")

    return [
        Periodic(
            "session-cleanup", settings.session_cleanup_interval_seconds, clean_sessions
        ),
        Periodic(
            "pause-expiry", settings.pause_expiry_interval_seconds, expire_pauses_tick
        ),
    ]
