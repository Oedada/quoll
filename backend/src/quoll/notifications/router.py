import logging

from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    Query,
    Request,
    WebSocket,
    WebSocketDisconnect,
    status,
)
from sqlalchemy.ext.asyncio import AsyncSession

from quoll.auth.dependencies import CurrentUser, build_session_service
from quoll.auth.models import User, UserRole
from quoll.db import get_db_session
from quoll.notifications.connection_storage import ConnectionStorage
from quoll.notifications.dependencies import NotifyRepoDep
from quoll.notifications.schemas import NotifyRead
from quoll.notifications.service import NotifyService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/notifications", tags=["notifications"])
ws_router = APIRouter(prefix="/ws", tags=["notifications-ws"])


@router.get("", response_model=list[NotifyRead])
async def list_notifications(
    user: CurrentUser,
    repo: NotifyRepoDep,
    limit: int = 100,
    offset: int = 0,
) -> list[NotifyRead]:
    logger.info(f"list_notifications: user={user.id}, role={user.role}")
    if user.role == UserRole.ADMIN:
        notifications = await repo.get_all(limit=limit, offset=offset)
    else:
        notifications = await repo.get_by_user(user.id, limit=limit, offset=offset)
    logger.info(f"list_notifications: returning {len(notifications)} notifications")
    return [NotifyRead.model_validate(n) for n in notifications]


@router.get("/me", response_model=list[NotifyRead])
async def get_my_notifications(
    user: CurrentUser,
    repo: NotifyRepoDep,
    limit: int = 100,
    offset: int = 0,
) -> list[NotifyRead]:
    logger.info(f"get_my_notifications: user={user.id}")
    notifications = await repo.get_by_user(user.id, limit=limit, offset=offset)
    logger.info(f"get_my_notifications: returning {len(notifications)} notifications")
    return [NotifyRead.model_validate(n) for n in notifications]


@router.get("/{user_id}", status_code=201)
async def send_test_notification(
    request: Request,
    repo: NotifyRepoDep,
    user_id: str,
    title: str = Query(...),
    message: str = Query(...),
) -> dict:
    logger.info(f"send_test_notification: user_id={user_id}, title={title}")
    connections: ConnectionStorage = request.app.state.connection_storage
    logger.debug(f"ConnectionStorage: {connections}")
    service = NotifyService(repo, connections)
    await service.send_notification(user_id, title, message)
    logger.info(f"send_test_notification: done for user {user_id}")
    return {"ok": True}


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
async def websocket_endpoint(
    websocket: WebSocket,
    session: AsyncSession = Depends(get_db_session),  # noqa: B008
) -> None:
    raw_key = websocket.cookies.get("session")
    if not raw_key:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    session_service = build_session_service(websocket.app.state.db_session_maker)
    user_session = await session_service.resolve(raw_key)
    if user_session is None:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    user = await session.get(User, user_session.user_id)
    if user is None or not user.is_active:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

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
