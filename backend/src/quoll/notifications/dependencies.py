from typing import Annotated

from fastapi import Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from quoll.db import get_db_session
from quoll.notifications.connection_storage import ConnectionStorage
from quoll.notifications.repository import NotifyRepository
from quoll.notifications.service import NotifyService

SessionDep = Annotated[AsyncSession, Depends(get_db_session)]


def get_notify_repo(session: SessionDep) -> NotifyRepository:
    return NotifyRepository(session)


def get_connection_storage(request: Request) -> ConnectionStorage:
    return request.app.state.connection_storage


NotifyRepoDep = Annotated[NotifyRepository, Depends(get_notify_repo)]
ConnectionStorageDep = Annotated[ConnectionStorage, Depends(get_connection_storage)]


def get_notify_service(
    repo: NotifyRepoDep, connections: ConnectionStorageDep
) -> NotifyService:
    return NotifyService(repo, connections)


NotifyServiceDep = Annotated[NotifyService, Depends(get_notify_service)]
