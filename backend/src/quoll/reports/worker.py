"""Построение выгрузок в фоне (reports-design §9.3, §9.5).

рендер - в пуле процессов: openpyxl и reportlab грузят CPU и в потоке делили бы
GIL с API. Слот пула занят от захвата задания до конца его рендера, даже если
задание уже снято по таймауту - сверх пула процесс не берёт (IR4)
"""

import asyncio
import logging
import multiprocessing
import os
import socket
from concurrent.futures import Future, ProcessPoolExecutor
from datetime import datetime

from sqlalchemy.ext.asyncio import async_sessionmaker

from quoll.attachments.s3 import S3StorageService
from quoll.auth.identity_policy import is_incapacitated
from quoll.core.system_defaults import SystemDefaults
from quoll.interactions.bindings import BUSINESS_TZ
from quoll.reports import labels, policy, render, repository
from quoll.reports.models import ExportStatus, ReportExport
from quoll.reports.schemas import ReportParams
from quoll.reports.service import LIMITS, load, snapshot, today

logger = logging.getLogger(__name__)


class Refused(Exception):
    """задание не строится по причине с кодом - автор, объём, данные"""

    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


class ReportRunner:
    def __init__(
        self, session_maker: async_sessionmaker, s3: S3StorageService, processes: int
    ):
        self._maker = session_maker
        self._s3 = s3
        self._size = processes
        self._pool: ProcessPoolExecutor | None = None
        self._tasks: set[asyncio.Task] = set()
        self.busy = 0
        self.worker_id = f"{socket.gethostname()}:{os.getpid()}"

    def _executor(self) -> ProcessPoolExecutor:
        if self._pool is None:
            # spawn: fork процесса с потоками и циклом событий ненадёжен
            self._pool = ProcessPoolExecutor(
                self._size, mp_context=multiprocessing.get_context("spawn")
            )
        return self._pool

    async def tick(self) -> int:
        claimed = await repository.claim(
            self._maker, self.worker_id, self._size - self.busy
        )
        for job_id, version in claimed:
            self.busy += 1
            task = asyncio.create_task(self.execute(job_id, version))
            self._tasks.add(task)
            task.add_done_callback(self._tasks.discard)
        return len(claimed)

    def _release(self) -> None:
        self.busy -= 1

    async def execute(self, job_id: int, version: int) -> None:
        """ловит всё: исход задания пишется в строку, задача не бросает"""
        loop = asyncio.get_running_loop()
        rendering: list[Future] = []
        try:
            try:
                data, rows, fmt = await asyncio.wait_for(
                    self._build(job_id, rendering),
                    timeout=SystemDefaults.REPORT_TIMEOUT_SECONDS,
                )
            except TimeoutError:
                await repository.finish(
                    self._maker, job_id, version, ExportStatus.TIMED_OUT, "REP-504"
                )
                return
            except Refused as refusal:
                await repository.finish(
                    self._maker, job_id, version, ExportStatus.FAILED, refusal.code
                )
                return
            key = f"reports/{job_id}.{fmt}"
            try:
                await asyncio.wait_for(
                    self._s3.upload_bytes(data, key, render.CONTENT_TYPES[fmt]),
                    timeout=SystemDefaults.REPORT_UPLOAD_TIMEOUT_SECONDS,
                )
                completed = await repository.complete(
                    self._maker, job_id, version, key, rows
                )
            except Exception:
                logger.exception(f"Report export {job_id}: upload failed")
                await self._delete(key)
                await repository.finish(
                    self._maker, job_id, version, ExportStatus.FAILED, "REP-500"
                )
                return
            if not completed:
                # аренду уже сняли - файл никому не принадлежит (IR5, IR7)
                await self._delete(key)
        except Exception:
            logger.exception(f"Report export {job_id} failed")
            try:
                await repository.finish(
                    self._maker, job_id, version, ExportStatus.FAILED, "REP-500"
                )
            except Exception:
                logger.exception(f"Report export {job_id}: cannot mark failed")
        finally:
            if rendering and not rendering[0].done():
                # рендер пережил таймаут - слот освободится, когда он закончит
                rendering[0].add_done_callback(
                    lambda _: loop.call_soon_threadsafe(self._release)
                )
            else:
                self._release()

    async def _build(self, job_id: int, rendering: list[Future]):
        async with snapshot(self._maker) as session:
            job = await session.get(ReportExport, job_id)
            params = ReportParams.model_validate(job.params)
            a_start, b_end = policy.period(params.date_from, params.date_to, today())
            actor, facts = await load(session, job.requested_by, params, b_end)
            # смена роли меняет и видимость - автор формирует отчёт заново
            if actor is None or is_incapacitated(actor):
                raise Refused("REP-403")
            names = await repository.filter_names(session, params)
            fmt = job.format
        rows = policy.build_rows(facts, params, a_start, b_end)
        if not rows:
            raise Refused("REP-204")
        if len(rows) > LIMITS.get(fmt, len(rows)):
            raise Refused("REP-413")
        header = render.Header(
            period=f"с {params.date_from:%d.%m.%Y} по {params.date_to:%d.%m.%Y}",
            filters=tuple(
                (title, ", ".join(names.get(key, [])) or labels.ALL)
                for key, title in labels.FILTERS.items()
            ),
            author=f"{labels.person(actor)}, {labels.ROLES[actor.role.value]}",
            formed_at=datetime.now(BUSINESS_TZ).strftime("%d.%m.%Y %H:%M"),
            row_count=len(rows),
        )
        future = self._executor().submit(
            render.RENDERERS[fmt], header, rows, params.columns
        )
        rendering.append(future)
        return await asyncio.wrap_future(future), len(rows), fmt

    async def _delete(self, key: str) -> None:
        try:
            await self._s3.delete(key)
        except Exception:
            logger.exception(f"Cannot delete report file '{key}'")

    async def cleanup(self) -> int:
        """сначала EXPIRED и коммит, потом файлы (§9.5)"""
        keys = await repository.expire(self._maker)
        for key in keys:
            await self._delete(key)
        return len(keys)

    async def close(self) -> None:
        """при остановке: задания остаются RUNNING, их снимет жнец (§9.3)"""
        for task in list(self._tasks):
            task.cancel()
        await asyncio.gather(*self._tasks, return_exceptions=True)
        if self._pool is not None:
            self._pool.shutdown(wait=False, cancel_futures=True)
