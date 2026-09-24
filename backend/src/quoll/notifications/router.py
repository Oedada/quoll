import logging
from typing import Annotated

from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    Query,
    WebSocket,
    WebSocketDisconnect,
    status,
)

from quoll.auth.dependencies import (
    AdminOnly,
    CurrentUser,
    WebSocketUser,
    get_current_user,
    get_websocket_user,
)
from quoll.auth.models import UserRole
from quoll.core import SystemDefaults
from quoll.notifications.connection_storage import ConnectionStorage
from quoll.notifications.dependencies import NotifyRepoDep, NotifyServiceDep
from quoll.notifications.schemas import NotifyCreate, NotifyRead

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/api/v1/notifications",
    tags=["notifications"],
    dependencies=[Depends(get_current_user)],
)
ws_router = APIRouter(
    prefix="/api/v1/ws",
    tags=["notifications-ws"],
    dependencies=[Depends(get_websocket_user)],
)

PageLimit = Annotated[int, Query(ge=1, le=SystemDefaults.MAX_PAGE_SIZE)]
PageOffset = Annotated[int, Query(ge=0)]


@router.get("/", response_model=list[NotifyRead], dependencies=[AdminOnly])
async def list_all_notifications(
    repo: NotifyRepoDep,
    limit: PageLimit = SystemDefaults.DEFAULT_PAGE_SIZE,
    offset: PageOffset = 0,
) -> list[NotifyRead]:
    """все уведомления системы - единственное место, где читают чужие"""
    notifications = await repo.get_all(limit=limit, offset=offset)
    return [NotifyRead.model_validate(n) for n in notifications]


@router.get("/me", response_model=list[NotifyRead])
async def get_my_notifications(
    user: CurrentUser,
    repo: NotifyRepoDep,
    limit: PageLimit = SystemDefaults.DEFAULT_PAGE_SIZE,
    offset: PageOffset = 0,
) -> list[NotifyRead]:
    notifications = await repo.get_by_user(user.id, limit=limit, offset=offset)
    return [NotifyRead.model_validate(n) for n in notifications]


@router.post(
    "/",
    response_model=NotifyRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[AdminOnly],
)
async def send_notification(
    schema: NotifyCreate, service: NotifyServiceDep
) -> NotifyRead:
    """ручная отправка. Изнутри системы уведомления шлёт NotifyService, не HTTP"""
    notify = await service.create_and_send(
        user_id=schema.user_id,
        title=schema.title,
        message=schema.message,
        extra_data=schema.extra_data,
    )
    return NotifyRead.model_validate(notify)


@router.patch("/{notify_id}/read", response_model=NotifyRead)
async def mark_as_read(
    notify_id: int,
    user: CurrentUser,
    repo: NotifyRepoDep,
) -> NotifyRead:
    logger.info(f"mark_as_read: notify_id={notify_id}, user={user.id}")
    notify = await repo.get(notify_id)
    if notify.user_id != user.id and user.role != UserRole.ADMIN:
        logger.warning(
            f"mark_as_read: forbidden for user {user.id} on notify {notify_id}"
        )
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")
    await repo.update(notify_id, {"is_read": True})
    notify.is_read = True
    logger.info(f"mark_as_read: done for notify {notify_id}")
    return NotifyRead.model_validate(notify)


@ws_router.websocket("/notifications")
async def websocket_endpoint(websocket: WebSocket, user: WebSocketUser) -> None:
    connections: ConnectionStorage = websocket.app.state.connection_storage
    logger.debug(f"WS: adding connection for user {user.id}")
    await websocket.accept()
    await connections.add(user.id, websocket)
    logger.info(f"WS: connected for user {user.id}")

    try:
        while True:
            data = await websocket.receive_text()
            logger.debug(f"WS: received from {user.id}: {data}")
            if data == "ping":
                await websocket.send_text("pong")
    except WebSocketDisconnect:
        logger.info(f"WS: disconnected for user {user.id}")
    finally:
        logger.info(f"WS: cleaning up for user {user.id}")
        await connections.remove(user.id, websocket)
