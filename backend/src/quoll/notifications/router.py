import json
import logging
from typing import Annotated

from fastapi import (
    APIRouter,
    Depends,
    Query,
    WebSocket,
    WebSocketDisconnect,
    WebSocketException,
    status,
)
from sqlalchemy import select

from quoll.auth.dependencies import (
    AdminOnly,
    AdminUser,
    CurrentUser,
    WebSocketUser,
    get_current_user,
    get_websocket_user,
)
from quoll.auth.models import User, UserRole
from quoll.core import SystemDefaults
from quoll.core.exceptions import DomainRuleException
from quoll.db import SessionDep
from quoll.notifications import kinds, queries
from quoll.notifications.connection_storage import ConnectionStorage
from quoll.notifications.emit import Audience, emit
from quoll.notifications.kinds import Severity, Subject
from quoll.notifications.schemas import (
    ManualNotification,
    MarkedRead,
    MarkRead,
    NotificationHistoryRead,
    NotificationRead,
    UnreadCount,
)

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

Limit = Annotated[int, Query(ge=1, le=SystemDefaults.MAX_PAGE_SIZE)]


@router.get("/me", response_model=list[NotificationRead])
async def my_notifications(
    user: CurrentUser,
    session: SessionDep,
    unread: bool | None = None,
    type: str | None = None,
    severity: Severity | None = None,
    interaction_id: int | None = None,
    before_id: int | None = Query(default=None, description="cursor: older than id"),
    limit: Limit = SystemDefaults.DEFAULT_PAGE_SIZE,
):
    """свои уведомления, новые сверху; всё непрочитанное лежит здесь, даже
    если в момент отправки платформа была закрыта"""
    return await queries.deliveries(
        session,
        user_id=user.id,
        unread=unread,
        type=type,
        severity=severity,
        interaction_id=interaction_id,
        before_id=before_id,
        limit=limit,
    )


@router.get("/me/unread-count", response_model=UnreadCount)
async def my_unread_count(user: CurrentUser, session: SessionDep):
    return await queries.unread_count(session, user.id)


@router.post("/me/read", response_model=MarkedRead)
async def mark_read(body: MarkRead, user: CurrentUser, session: SessionDep):
    updated = await queries.mark_read(
        session,
        user.id,
        ids=body.ids,
        interaction_id=body.interaction_id,
    )
    return {"updated": updated}


@router.get("/", response_model=list[NotificationRead], dependencies=[AdminOnly])
async def all_notifications(
    session: SessionDep,
    user_id: str | None = None,
    type: str | None = None,
    interaction_id: int | None = None,
    before_id: int | None = None,
    limit: Limit = SystemDefaults.DEFAULT_PAGE_SIZE,
):
    """все доставки - разобрать «почему не пришло»"""
    return await queries.deliveries(
        session,
        user_id=user_id,
        type=type,
        interaction_id=interaction_id,
        before_id=before_id,
        limit=limit,
    )


@router.post(
    "/",
    response_model=NotificationHistoryRead,
    status_code=status.HTTP_201_CREATED,
)
async def send_manual(body: ManualNotification, admin: AdminUser, session: SessionDep):
    """ручное уведомление админа людям или всем с ролью"""
    if body.user_ids is not None:
        known = set(
            await session.scalars(select(User.id).where(User.id.in_(body.user_ids)))
        )
        if unknown := set(body.user_ids) - known:
            raise DomainRuleException(409, f"Unknown users: {sorted(unknown)}")
    notification = await emit(
        session,
        kinds.MANUAL,
        subject=Subject.SYSTEM,
        audience=Audience(
            users=tuple(body.user_ids or ()),
            system_role=UserRole(body.role) if body.role else None,
        ),
        context={"title": body.title, "body": body.body},
        actor_id=admin.id,
    )
    if notification is None:
        raise DomainRuleException(409, "Nobody to notify")
    [item] = await queries.history(session, notification_id=notification.id)
    return item


SYNC_PAGE = 100


def _items(rows: list[dict]) -> list[dict]:
    return [NotificationRead.model_validate(r).model_dump(mode="json") for r in rows]


@ws_router.websocket("/notifications")
async def websocket_endpoint(websocket: WebSocket, user: WebSocketUser) -> None:
    """hello - счётчик и последний id; {"type": "sync", "after_id": K} -
    догрузка; ping - заодно проверка, что сессия ещё жива. Сюда же приходят
    {"type": "notification"} и {"type": "resync"} от слушателя"""
    connections: ConnectionStorage = websocket.app.state.connection_storage
    maker = websocket.app.state.db_session_maker
    await websocket.accept()
    async with maker() as session:
        hello = {
            "type": "hello",
            "unread": (await queries.unread_count(session, user.id))["total"],
            "last_id": await queries.last_id(session, user.id),
        }
    await websocket.send_json(hello)
    await connections.add(user.id, websocket)
    try:
        while True:
            data = await websocket.receive_text()
            if data == "ping":
                # сессию могли отозвать или человека уволить, пока сокет открыт
                try:
                    await get_websocket_user(websocket)
                except WebSocketException as denied:
                    await websocket.close(code=denied.code, reason=denied.reason)
                    return
                await websocket.send_text("pong")
                continue
            try:
                message = json.loads(data)
                after_id = (
                    int(message["after_id"]) if message.get("type") == "sync" else None
                )
            except (ValueError, KeyError, TypeError):
                after_id = None
            if after_id is None:
                await websocket.send_json(
                    {"type": "error", "detail": "Unknown message"}
                )
                continue
            async with maker() as session:
                rows = await queries.sync_items(session, user.id, after_id, SYNC_PAGE)
            await websocket.send_json({"type": "sync", "items": _items(rows)})
    except WebSocketDisconnect:
        logger.info(f"WS: disconnected for user {user.id}")
    finally:
        await connections.remove(user.id, websocket)
