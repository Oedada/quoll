import asyncio
import pytest
import httpx
import websockets

BASE_URL = "http://127.0.0.1:8000"
WS_URL = "ws://127.0.0.1:8000/ws/notifications"


@pytest.fixture
def settings():
    from quoll.config import settings
    return settings


@pytest.mark.asyncio
async def test_send_notification(client: httpx.AsyncClient, settings):
    """1. Отправляет запрос на уведомление анонимно."""
    user_id = settings.app_admin_id
    response = await client.get(
        f"/notifications/{user_id}",
        params={"title": "Test Notification", "message": "Hello from test"},
    )
    assert response.status_code == 201
    assert response.json() == {"ok": True}


@pytest.mark.asyncio
async def test_get_my_notifications(admin_client: httpx.AsyncClient):
    """3. Пробует прочитать свои уведомления, которые сохранились."""
    response = await admin_client.get("/notifications/me")
    assert response.status_code == 200
    notifications = response.json()
    assert isinstance(notifications, list)
    assert len(notifications) > 0
    assert notifications[0]["title"] == "Test Notification"


@pytest.mark.asyncio
async def test_websocket_connect(admin_cookie: str):
    """2. Подключается по WS и проверяет ping/pong."""
    async with websockets.connect(WS_URL, cookie=f"session={admin_cookie}") as ws:
        await ws.send("ping")
        pong = await ws.recv()
        assert pong == "pong"


@pytest.mark.asyncio
async def test_websocket_push(admin_cookie: str, client: httpx.AsyncClient, settings):
    """4. Полный флоу - отправляет уведомление и ловит push в реальном времени."""
    received_event = asyncio.Event()
    received_data = None

    async def listener():
        nonlocal received_data
        cookie_value = admin_cookie
        async with websockets.connect(WS_URL, cookie=f"session={cookie_value}") as ws:
            await ws.send("ping")
            pong = await ws.recv()
            assert pong == "pong"
            data = await asyncio.wait_for(ws.recv(), timeout=5)
            received_data = data
            received_event.set()

    async def sender():
        await asyncio.sleep(0.5)
        user_id = settings.app_admin_id
        await client.get(
            f"/notifications/{user_id}",
            params={"title": "WS Test", "message": "Push via WS"},
        )

    await asyncio.gather(listener(), sender())
    assert received_data is not None
    import json
    msg = json.loads(received_data)
    assert msg["title"] == "WS Test"
    assert msg["message"] == "Push via WS"