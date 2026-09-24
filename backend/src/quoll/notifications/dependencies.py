from typing import Annotated

from fastapi import Depends, Request

from quoll.db import SessionDep
from quoll.notifications.connection_storage import ConnectionStorage
from quoll.notifications.repository import NotifyRepository
from quoll.notifications.service import NotifyService


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
