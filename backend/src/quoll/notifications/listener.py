"""Живая доставка: слушатель pg_notify в каждом процессе приложения.

emit() зовёт pg_notify в транзакции события, а Postgres отдаёт его только
после коммита - поэтому в сокет не уходит уведомление об откаченном. Сокеты
живут в памяти процесса; слушают все процессы, и каждый шлёт своим.
Соединение слушателя проверяется SELECT 1: полуоткрытое TCP asyncpg сам не
заметит. После обрыва - переподключение и resync всем сокетам: клиент
догружает пропущенное по REST
"""

import asyncio
import logging

import asyncpg
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker

from quoll.notifications.connection_storage import ConnectionStorage
from quoll.notifications.emit import CHANNEL
from quoll.notifications.models import NotificationRecipient
from quoll.notifications.queries import flat
from quoll.notifications.schemas import NotificationRead

logger = logging.getLogger(__name__)

PROBE_SECONDS = 30
MAX_BACKOFF_SECONDS = 30


class NotificationListener:
    def __init__(
        self,
        connect_kwargs: dict,
        session_maker: async_sessionmaker,
        connections: ConnectionStorage,
    ) -> None:
        self._connect_kwargs = connect_kwargs
        self._session_maker = session_maker
        self._connections = connections
        self._stop = asyncio.Event()
        self._task: asyncio.Task | None = None
        self._pending: set[asyncio.Task] = set()
        # подписка активна - для проверок и тестов
        self.ready = asyncio.Event()

    def start(self) -> None:
        self._task = asyncio.create_task(self._run(), name="notification-listener")

    async def stop(self) -> None:
        self._stop.set()
        if self._task is not None:
            await self._task

    async def _run(self) -> None:
        backoff = 1
        first = True
        while not self._stop.is_set():
            lost = asyncio.Event()
            try:
                conn = await asyncpg.connect(**self._connect_kwargs)
            except (OSError, asyncpg.PostgresError) as err:
                logger.warning(f"Notification listener cannot connect: {err}")
                await self._sleep(backoff)
                backoff = min(backoff * 2, MAX_BACKOFF_SECONDS)
                continue
            backoff = 1
            try:
                conn.add_termination_listener(lambda _, lost=lost: lost.set())
                await conn.add_listener(CHANNEL, self._on_notify)
                if not first:
                    # пока слушателя не было, уведомления могли прийти мимо
                    await self._connections.broadcast({"type": "resync"})
                first = False
                self.ready.set()
                await self._probe(conn, lost)
            except Exception as err:  # noqa: BLE001 - любой сбой = переподключение
                logger.warning(f"Notification listener lost connection: {err!r}")
            finally:
                self.ready.clear()
                if not conn.is_closed():
                    await conn.close()

    async def _probe(self, conn: asyncpg.Connection, lost: asyncio.Event) -> None:
        while not self._stop.is_set() and not lost.is_set():
            await self._sleep(PROBE_SECONDS)
            await asyncio.wait_for(conn.fetchval("SELECT 1"), timeout=PROBE_SECONDS)

    async def _sleep(self, seconds: float) -> None:
        try:
            await asyncio.wait_for(self._stop.wait(), timeout=seconds)
        except TimeoutError:
            pass

    def _on_notify(self, _conn, _pid, _channel, payload: str) -> None:
        task = asyncio.create_task(self.deliver(int(payload)))
        self._pending.add(task)
        task.add_done_callback(self._pending.discard)

    async def deliver(self, notification_id: int) -> int:
        """отправить открытым сокетам этого процесса; сколько ушло"""
        online = await self._connections.online_users()
        if not online:
            return 0
        async with self._session_maker() as session:
            rows = await session.scalars(
                select(NotificationRecipient).where(
                    NotificationRecipient.notification_id == notification_id,
                    NotificationRecipient.user_id.in_(online),
                )
            )
            items = [(row.user_id, flat(row)) for row in rows]
        sent = 0
        for user_id, item in items:
            sent += await self._connections.send_to_user(
                user_id,
                {
                    "type": "notification",
                    "item": NotificationRead.model_validate(item).model_dump(
                        mode="json"
                    ),
                },
            )
        return sent
