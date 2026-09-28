"""Потоки обмена с заглушками (К §1-§6, план §4). Обмен потока идёт под
advisory-блокировкой, каждая принятая запись - в своём savepoint, итог -
строка integration_runs со счётчиками по кодам К §6"""

import hashlib
import hmac
import logging
from collections import Counter
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import asdict, dataclass
from datetime import datetime, time
from typing import Any

from sqlalchemy import func, select, text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from quoll.auth.audit import record as audit
from quoll.auth.audit_models import AuditEventType, TargetType
from quoll.catalog.models import ItDirection, ItProgram
from quoll.config import settings
from quoll.core.exceptions import DomainRuleException
from quoll.integrations import mapping, proposals
from quoll.integrations.export import applications
from quoll.integrations.mapping import Match
from quoll.integrations.models import (
    EnrollmentSource,
    IntegrationRun,
    IntegrationUnmatched,
    LmsStats,
    RunFlow,
    RunStatus,
    RunTrigger,
    SiteEnrollment,
    StatsSource,
    UnmatchedFlow,
)
from quoll.integrations.stubs import LmsStub, SiteStub, StubUnavailable
from quoll.interactions.bindings import BUSINESS_TZ

logger = logging.getLogger(__name__)

# коды итога (К §6); OK - принято, ERROR - сбой разбора одной записи
OK = "OK"
UNCHANGED = "INT-208"
PROPOSED = "INT-202"
NOT_FOUND = "INT-404"
AMBIGUOUS = "INT-409"
INVALID = "INT-422"
UNAVAILABLE = "INT-503"
ERROR = "ERROR"

# ключи advisory-блокировки обмена: "INT" + номер потока
_FLOW_LOCKS = {
    flow: 0x494E5400 + n
    for n, flow in enumerate((RunFlow.I2, RunFlow.I1, RunFlow.B1, RunFlow.B2))
}


def fingerprint(email: str) -> str:
    """HMAC от email без пробелов в нижнем регистре; ключ вне БД (Q17)"""
    return hmac.new(
        settings.integration_email_key.encode(),
        email.strip().casefold().encode(),
        hashlib.sha256,
    ).hexdigest()


# --- каркас


async def _hold(session: AsyncSession, flow: RunFlow) -> None:
    """один обмен потока за раз во всех процессах. Блокировка живёт до конца
    транзакции: упавший процесс отпускает её сам, зависших запусков нет"""
    free = await session.scalar(
        select(func.pg_try_advisory_xact_lock(_FLOW_LOCKS[flow]))
    )
    if not free:
        raise DomainRuleException(409, f"Flow '{flow}' is already running")


async def _each(
    session: AsyncSession,
    items: Sequence[Any],
    handle: Callable[[Any], Awaitable[str]],
) -> dict[str, int]:
    counters: Counter[str] = Counter()
    for item in items:
        try:
            async with session.begin_nested():
                counters[await handle(item)] += 1
        except Exception:
            logger.exception("Integration record failed")
            counters[ERROR] += 1
    return dict(counters)


async def run(
    session: AsyncSession,
    flow: RunFlow,
    trigger: RunTrigger,
    actor_id: str | None,
    records: list | None = None,
) -> IntegrationRun:
    """запуск потока; records - ручная загрузка файла В1/В2. Отказ заглушки
    или сбой обмена - FAILED без изменений данных, но с записью о запуске"""
    if flow == RunFlow.B1 and not settings.integration_enrollments_enabled:
        raise DomainRuleException(409, "Enrollments flow is disabled")
    await _hold(session, flow)
    started = datetime.now(BUSINESS_TZ)
    counters, payload, error = {}, None, None
    try:
        async with session.begin_nested():
            counters, payload = await _EXCHANGES[flow](session, records)
    except StubUnavailable as e:
        counters, error = {UNAVAILABLE: 1}, e.message
    except Exception as e:
        logger.exception(f"Integration flow {flow} failed")
        counters, error = {ERROR: 1}, type(e).__name__
    result = IntegrationRun(
        flow=flow,
        trigger=trigger,
        status=RunStatus.FAILED if error else RunStatus.DONE,
        actor_id=actor_id,
        started_at=started,
        finished_at=func.now(),
        counters=counters,
        error=error,
        payload=payload,
    )
    session.add(result)
    await session.flush()
    audit(
        session,
        actor_id=actor_id,
        event_type=AuditEventType.INTEGRATION_RUN,
        target_type=TargetType.INTEGRATION_RUN,
        target_id=result.id,
        new_value={"flow": flow, "status": result.status, "counters": counters},
    )
    await session.refresh(result)
    return result


# --- И2, И1: полный снимок, получатель заменяет им прежний (К §3)


async def catalog(session: AsyncSession) -> list[dict[str, Any]]:
    """заданный приоритет по возрастанию (1 - первая), затем название (К §2.4)"""
    rows = await session.execute(
        select(ItProgram, ItDirection.name)
        .join(ItDirection, ItDirection.id == ItProgram.direction_id)
        .order_by(ItProgram.priority.asc().nulls_last(), ItProgram.name, ItProgram.id)
    )
    return [
        {
            "id": p.id,
            "name": p.name,
            "site_course_id": p.site_course_id,
            "direction": {"id": p.direction_id, "name": direction},
            "priority": p.priority,
        }
        for p, direction in rows
    ]


async def _send_catalog(session: AsyncSession, _records) -> tuple[dict, list]:
    snapshot = await catalog(session)
    SiteStub.push_i2(snapshot)
    return {OK: len(snapshot)}, snapshot


async def _send_applications(session: AsyncSession, _records) -> tuple[dict, list]:
    snapshot = await applications(session, full=False)
    LmsStub.push_i1(snapshot)
    return {OK: len(snapshot)}, snapshot


# --- очередь несопоставленных


async def _queue(
    session: AsyncSession,
    flow: UnmatchedFlow,
    record_key: str,
    match: Match,
    data: dict[str, Any],
) -> str:
    """ждущая запись с тем же ключом обновляется свежими данными"""
    values = {
        "code": AMBIGUOUS if match.ambiguous else NOT_FOUND,
        "mapping_kind": match.kind,
        "external_key": match.key,
        "record": data,
        "candidates": list(match.candidates),
    }
    await session.execute(
        pg_insert(IntegrationUnmatched)
        .values(flow=flow, record_key=record_key, **values)
        .on_conflict_do_update(
            index_elements=["flow", "record_key"],
            index_where=text("status = 'PENDING'"),
            set_=values,
        )
    )
    return values["code"]


# --- В1: сайт -> CRM, записи на обучение (Р1)


@dataclass(frozen=True)
class Enrollment:
    """запись В1 без ПДн: ФИО и телефон отброшены, email - отпечатком (К §7)"""

    order_number: str
    stream: int
    program_id: int | None
    course: str | None
    email_fingerprint: str
    source: str


def _int(value: Any) -> int | None:
    return value if isinstance(value, int) and not isinstance(value, bool) else None


def parse_enrollment(raw: Any, source: str) -> Enrollment | None:
    if not isinstance(raw, dict):
        return None
    order, stream, email = (
        raw.get("Номер заявки"),
        raw.get("Номер потока"),
        raw.get("Email"),
    )
    program_id, course = _int(raw.get("program_id")), raw.get("Курс")
    if not order or _int(stream) is None or stream < 0 or not email:
        return None
    if program_id is None and not course:
        return None
    return Enrollment(
        str(order), stream, program_id, course, fingerprint(str(email)), source
    )


async def take_enrollment(session: AsyncSession, item: Enrollment) -> str:
    match = await mapping.course(session, item.program_id, item.course)
    if match.target_id is None:
        return await _queue(
            session, UnmatchedFlow.B1, item.order_number, match, asdict(item)
        )
    found = await session.scalar(
        select(SiteEnrollment).where(SiteEnrollment.order_number == item.order_number)
    )
    if found is None:
        session.add(
            SiteEnrollment(
                order_number=item.order_number,
                program_id=match.target_id,
                stream=item.stream,
                enrolled_on=datetime.now(BUSINESS_TZ).date(),
                source=item.source,
                email_fingerprint=item.email_fingerprint,
            )
        )
        return OK
    same = (found.program_id, found.stream, found.email_fingerprint) == (
        match.target_id,
        item.stream,
        item.email_fingerprint,
    )
    if same:
        return UNCHANGED
    found.program_id = match.target_id
    found.stream = item.stream
    found.email_fingerprint = item.email_fingerprint
    found.source = item.source
    return OK


async def _receive_enrollments(session: AsyncSession, records) -> tuple[dict, None]:
    source = EnrollmentSource.SITE if records is None else EnrollmentSource.FILE
    if records is None:
        records = await SiteStub.fetch_b1(session)

    async def handle(raw) -> str:
        item = parse_enrollment(raw, source)
        return INVALID if item is None else await take_enrollment(session, item)

    return await _each(session, records, handle), None


# --- В2: LMS -> CRM, статистика пары вуз x программа


@dataclass(frozen=True)
class Stats:
    university_id: int | None
    inn: str | None
    kpp: str | None
    program_id: int | None
    site_course_id: str | None
    students: int
    streams: int
    # None - поля не было, прежнее значение не меняется (К §2.2)
    teachers_trained: int | None
    source: str

    @property
    def key(self) -> str:
        university = self.university_id or f"{self.inn}/{self.kpp}"
        return f"{university}|{self.program_id or self.site_course_id}"


def parse_stats(raw: Any, source: str) -> Stats | None:
    if not isinstance(raw, dict):
        return None
    university, program = raw.get("university"), raw.get("program")
    if not isinstance(university, dict) or not isinstance(program, dict):
        return None
    counts = [_int(raw.get(k)) for k in ("students", "streams")]
    teachers = raw.get("teachers_trained")
    if any(c is None or c < 0 for c in counts):
        return None
    if teachers is not None and (_int(teachers) is None or teachers < 0):
        return None
    keys = [university.get("inn"), university.get("kpp"), program.get("site_course_id")]
    if any(k is not None and not isinstance(k, str) for k in keys):
        return None
    item = Stats(
        _int(university.get("id")),
        keys[0] or None,
        keys[1] or None,
        _int(program.get("id")),
        keys[2] or None,
        counts[0],
        counts[1],
        teachers,
        source,
    )
    if item.university_id is None and item.inn is None:
        return None
    if item.program_id is None and item.site_course_id is None:
        return None
    return item


async def _pair(session: AsyncSession, item: Stats) -> tuple[Match, Match]:
    return (
        await mapping.university(session, item.university_id, item.inn, item.kpp),
        await mapping.program(session, item.program_id, item.site_course_id),
    )


async def take_stats(
    session: AsyncSession, item: Stats, pair: tuple[Match, Match] | None = None
) -> str:
    university, program = pair or await _pair(session, item)
    for side in (university, program):
        if side.target_id is None:
            return await _queue(session, UnmatchedFlow.B2, item.key, side, asdict(item))
    found = await session.scalar(
        select(LmsStats).where(
            LmsStats.university_id == university.target_id,
            LmsStats.program_id == program.target_id,
        )
    )
    old = (
        None
        if found is None
        else {
            "students": found.students,
            "streams": found.streams,
            "teachers_trained": found.teachers_trained,
        }
    )
    new = {
        "students": item.students,
        "streams": item.streams,
        "teachers_trained": item.teachers_trained
        if item.teachers_trained is not None
        else (old or {}).get("teachers_trained"),
    }
    code = UNCHANGED
    if new != old:
        if found is None:
            found = LmsStats(
                university_id=university.target_id, program_id=program.target_id
            )
            session.add(found)
        found.students, found.streams = new["students"], new["streams"]
        found.teachers_trained = new["teachers_trained"]
        found.source = item.source
        await session.flush()
        audit(
            session,
            actor_id=None,
            event_type=AuditEventType.TRAINING_STATS_CHANGED,
            target_type=TargetType.LMS_STATS,
            target_id=found.id,
            old_value=old,
            new_value=new,
        )
        code = OK
    if await proposals.offer(session, university.target_id, program.target_id):
        return PROPOSED
    return code


async def _receive_stats(session: AsyncSession, records) -> tuple[dict, None]:
    source = StatsSource.LMS if records is None else StatsSource.FILE
    if records is None:
        records = await LmsStub.fetch_b2(session)
    items = [parse_stats(raw, source) for raw in records]
    pairs = [None if i is None else await _pair(session, i) for i in items]
    # две записи одной пары в файле - обе INT-409 (К §3)
    seen = Counter(
        (u.target_id, p.target_id)
        for u, p in filter(None, pairs)
        if u.target_id and p.target_id
    )

    async def handle(n: int) -> str:
        item, pair = items[n], pairs[n]
        if item is None:
            return INVALID
        if seen[(pair[0].target_id, pair[1].target_id)] > 1:
            return AMBIGUOUS
        return await take_stats(session, item, pair)

    return await _each(session, range(len(items)), handle), None


_EXCHANGES = {
    RunFlow.I2: _send_catalog,
    RunFlow.I1: _send_applications,
    RunFlow.B1: _receive_enrollments,
    RunFlow.B2: _receive_stats,
}


# --- ночной обмен (К §5)


NIGHTLY_ORDER = (RunFlow.I2, RunFlow.I1, RunFlow.B1, RunFlow.B2)


async def run_nightly(session_maker: async_sessionmaker) -> int:
    """в integration_hour: сначала отдаём наши ID, потом принимаем данные с
    ними. Поток - своя транзакция; уже прошедший сегодня ночной поток не
    повторяется - проверка под блокировкой потока, два процесса его не задвоят"""
    now = datetime.now(BUSINESS_TZ)
    if now.hour != settings.integration_hour:
        return 0
    today = datetime.combine(now.date(), time.min, BUSINESS_TZ)
    ran = 0
    for flow in NIGHTLY_ORDER:
        if flow == RunFlow.B1 and not settings.integration_enrollments_enabled:
            continue
        async with session_maker() as session, session.begin():
            try:
                await _hold(session, flow)
            except DomainRuleException:
                continue
            done = await session.scalar(
                select(IntegrationRun.id).where(
                    IntegrationRun.flow == flow,
                    IntegrationRun.trigger == RunTrigger.SCHEDULE,
                    IntegrationRun.started_at >= today,
                )
            )
            if done is None:
                await run(session, flow, RunTrigger.SCHEDULE, None)
                ran += 1
    return ran
