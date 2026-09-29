import asyncio
from logging import getLogger
from typing import Any

from fastapi import WebSocket

logger = getLogger(__name__)

# таймаут отправки в один сокет: мёртвое TCP не должно блокировать остальных
_SEND_TIMEOUT = 5.0


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

    async def _purge(self, dead: list[tuple[str, WebSocket]]) -> None:
        """Удалить мёртвые сокеты из реестра."""
        if not dead:
            return
        async with self._lock:
            for user_id, ws in dead:
                conns = self._connections.get(user_id)
                if conns is None:
                    continue
                try:
                    conns.remove(ws)
                except ValueError:
                    pass
                if not conns:
                    del self._connections[user_id]

    async def send_to_user(self, user_id: str, data: dict[str, Any]) -> int:
        async with self._lock:
            connections = self._connections.get(user_id, []).copy()
        if not connections:
            return 0

        async def _send(ws: WebSocket) -> bool:
            try:
                await asyncio.wait_for(ws.send_json(data), timeout=_SEND_TIMEOUT)
                return True
            except Exception:  # noqa: BLE001
                return False

        results = await asyncio.gather(*(_send(ws) for ws in connections))
        dead = [
            (user_id, ws)
            for ws, ok in zip(connections, results, strict=True)
            if not ok
        ]
        if dead:
            logger.warning(
                f"Removing {len(dead)} dead WebSocket(s) for user {user_id}"
            )
            await self._purge(dead)
        return sum(results)

    async def broadcast(self, data: dict[str, Any]) -> int:
        async with self._lock:
            all_pairs: list[tuple[str, WebSocket]] = [
                (uid, ws)
                for uid, conns in self._connections.items()
                for ws in conns
            ]
        if not all_pairs:
            return 0

        async def _send(uid: str, ws: WebSocket) -> tuple[str, WebSocket, bool]:
            try:
                await asyncio.wait_for(ws.send_json(data), timeout=_SEND_TIMEOUT)
                return uid, ws, True
            except Exception:  # noqa: BLE001
                return uid, ws, False

        results = await asyncio.gather(*(_send(uid, ws) for uid, ws in all_pairs))
        dead = [(uid, ws) for uid, ws, ok in results if not ok]
        if dead:
            logger.warning(f"Broadcast: removing {len(dead)} dead WebSocket(s)")
            await self._purge(dead)
        return sum(1 for _, _, ok in results if ok)

    async def online_users(self) -> set[str]:
        async with self._lock:
            return set(self._connections)

    async def is_user_online(self, user_id: str) -> bool:
        async with self._lock:
            return bool(self._connections.get(user_id))
