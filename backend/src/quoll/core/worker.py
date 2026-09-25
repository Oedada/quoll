"""Фоновые процессы в lifespan приложения.

каждый - цикл со своим тактом. Упавший такт пишется в лог и не останавливает
цикл: одна плохая итерация не должна гасить сверщик до перезапуска
"""

import asyncio
import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class Periodic:
    name: str
    interval_seconds: float
    tick: Callable[[], Awaitable[None]]


async def _run(job: Periodic, stop: asyncio.Event) -> None:
    while not stop.is_set():
        try:
            await job.tick()
        except Exception:
            logger.exception(f"Background job '{job.name}' failed, will retry")
        try:
            await asyncio.wait_for(stop.wait(), timeout=job.interval_seconds)
        except TimeoutError:
            pass


class Workers:
    """запустить циклы при старте приложения и дождаться их при остановке"""

    def __init__(self, jobs: list[Periodic]):
        self._jobs = jobs
        self._stop = asyncio.Event()
        self._tasks: list[asyncio.Task] = []

    def start(self) -> None:
        self._tasks = [
            asyncio.create_task(_run(job, self._stop), name=job.name)
            for job in self._jobs
        ]
        logger.info(f"Started background jobs: {[job.name for job in self._jobs]}")

    async def stop(self, timeout: float = 10) -> None:
        self._stop.set()
        # такт, который сейчас идёт, доделается - прерывать транзакцию посреди незачем
        _, pending = await asyncio.wait(self._tasks, timeout=timeout)
        for task in pending:
            task.cancel()
        await asyncio.gather(*pending, return_exceptions=True)
