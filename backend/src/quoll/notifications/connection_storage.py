import asyncio
from logging import getLogger
from typing import Any

from fastapi import WebSocket

logger = getLogger(__name__)


class ConnectionStorage:
    def __init__(self) -> None:
        self._connections: dict[str, list[WebSocket]] = {}
        self._lock = asyncio.Lock()

    async def add(self, user_id: str, websocket: WebSocket) -> None:
        async with self._lock:
            if user_id not in self._connections:
                self._connections[user_id] = []
            if websocket not in self._connections[user_id]:
                self._connections[user_id].append(websocket)

    async def remove(self, user_id: str, websocket: WebSocket) -> None:
        async with self._lock:
            if user_id in self._connections:
                if websocket in self._connections[user_id]:
                    self._connections[user_id].remove(websocket)
                if not self._connections[user_id]:
                    del self._connections[user_id]

    async def send_to_user(self, user_id: str, data: dict[str, Any]) -> int:
        sent = 0
        async with self._lock:
            connections = self._connections.get(user_id, []).copy()
        for ws in connections:
            try:
                await ws.send_json(data)
                sent += 1
            except Exception as e:  # noqa: BLE001
                logger.warning(e)
        return sent

    async def broadcast(self, data: dict[str, Any]) -> int:
        sent = 0
        async with self._lock:
            all_connections = {
                uid: conns.copy() for uid, conns in self._connections.items()
            }
        for connections in all_connections.values():
            for ws in connections:
                try:
                    await ws.send_json(data)
                    sent += 1
                except Exception as e:  # noqa: BLE001
                    logger.warning(e)
        return sent

    async def is_user_online(self, user_id: str) -> bool:
        async with self._lock:
            return bool(self._connections.get(user_id))
