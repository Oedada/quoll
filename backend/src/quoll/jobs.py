"""Какие фоновые процессы поднимает приложение и с каким тактом.

отдельным модулем: процессы из разных модулей, а main.py про HTTP
"""

import logging

from sqlalchemy.ext.asyncio import async_sessionmaker

from quoll.auth import role_transition
from quoll.auth.offboarding import offboard_manager, offboard_superviser
from quoll.auth.pending_actions import PendingActionType
from quoll.auth.reconciler import reconcile
from quoll.auth.session_store import SessionStore
from quoll.auth.task_queue import run_queue
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

    handlers = {
        PendingActionType.OFFBOARDING_MANAGER: offboard_manager,
        PendingActionType.OFFBOARDING_SUPERVISER: offboard_superviser,
        PendingActionType.ROLE_TRANSITION: role_transition.handle,
    }
    on_failed = {PendingActionType.ROLE_TRANSITION: role_transition.on_failed}

    async def run_org_queue() -> None:
        processed = await run_queue(session_maker, handlers, on_failed)
        if processed:
            logger.info(f"Processed {processed} org tasks")

    async def reconcile_tick() -> None:
        await reconcile(session_maker)

    return [
        Periodic("reconciler", settings.reconciler_interval_seconds, reconcile_tick),
        Periodic("org-queue", settings.org_queue_interval_seconds, run_org_queue),
        Periodic(
            "session-cleanup", settings.session_cleanup_interval_seconds, clean_sessions
        ),
        Periodic(
            "pause-expiry", settings.pause_expiry_interval_seconds, expire_pauses_tick
        ),
    ]
