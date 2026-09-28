"""Заглушки внешних систем: имитация LMS и сайта внутри процесса (план §3).
Числа детерминированные - от хэша ключа записи, а не случайные: повтор
теста даёт тот же результат. Источник данных - последний принятый запуск
И1/И2 (integration_runs.payload)
"""

import hashlib
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from quoll.config import settings
from quoll.core.exceptions import AppException
from quoll.integrations.models import IntegrationRun, RunFlow, RunStatus


class StubUnavailable(AppException):
    """заглушка выключена настройкой - имитация INT-503"""

    def __init__(self, flow: str):
        super().__init__(503, f"Stub for flow '{flow}' is unavailable", "INT-503")


def _check_available(flow: str) -> None:
    if not settings.integration_stub_available:
        raise StubUnavailable(flow)


def _hash_int(key: str, mod: int, salt: str) -> int:
    digest = hashlib.sha256(f"{salt}:{key}".encode()).hexdigest()
    return int(digest, 16) % mod


async def _last_done_payload(
    session: AsyncSession, flow: RunFlow
) -> list[dict[str, Any]]:
    run = await session.scalar(
        select(IntegrationRun)
        .where(IntegrationRun.flow == flow, IntegrationRun.status == RunStatus.DONE)
        .order_by(IntegrationRun.id.desc())
        .limit(1)
    )
    return list(run.payload or []) if run else []


class LmsStub:
    """заглушка LMS: получает И1, отдаёт В2"""

    @staticmethod
    def push_i1(snapshot: list[dict[str, Any]]) -> list[dict[str, Any]]:
        _check_available(RunFlow.I1)
        return snapshot

    @staticmethod
    async def fetch_b2(session: AsyncSession) -> list[dict[str, Any]]:
        _check_available(RunFlow.B2)
        applications = await _last_done_payload(session, RunFlow.I1)
        pairs: set[tuple[int, int]] = set()
        for app in applications:
            university_id = app["university"]["id"]
            for branch in app.get("branches", ()):
                pairs.add((university_id, branch["program"]["id"]))
        records = []
        for university_id, program_id in sorted(pairs):
            key = f"{university_id}:{program_id}"
            record = {
                "university": {"id": university_id},
                "program": {"id": program_id},
                "students": 5 + _hash_int(key, 60, "students"),
                "streams": 1 + _hash_int(key, 4, "streams"),
            }
            if _hash_int(key, 3, "has_teachers") != 0:
                record["teachers_trained"] = 1 + _hash_int(key, 20, "teachers")
            records.append(record)
        return records


class SiteStub:
    """заглушка сайта: получает И2, отдаёт В1"""

    @staticmethod
    def push_i2(catalog: list[dict[str, Any]]) -> list[dict[str, Any]]:
        _check_available(RunFlow.I2)
        return catalog

    @staticmethod
    async def fetch_b1(session: AsyncSession) -> list[dict[str, Any]]:
        _check_available(RunFlow.B1)
        catalog = await _last_done_payload(session, RunFlow.I2)
        records = []
        for entry in catalog:
            program_id = entry["id"]
            count = 1 + _hash_int(str(program_id), 3, "count")
            for n in range(count):
                key = f"{program_id}:{n}"
                order_number = (
                    f"ORD-{_hash_int(key, 900_000_000, 'order') + 100_000_000}"
                )
                records.append(
                    {
                        "Номер заявки": order_number,
                        "program_id": program_id,
                        "Номер потока": 1 + _hash_int(key, 3, "stream"),
                        "Email": f"stub.enrollee.{_hash_int(key, 10**6, 'email')}@example.invalid",
                        "Фамилия": "Тестов",
                        "Имя": "Тест",
                        "Отчество": None,
                        "Телефон": f"+7900{_hash_int(key, 10**7, 'phone'):07d}",
                    }
                )
        return records
