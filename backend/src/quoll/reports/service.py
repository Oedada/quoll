"""Отчёты: предпросмотр, значения фильтров, задания выгрузки (reports-design §8, §9)"""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import date, datetime

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from quoll.attachments.s3 import S3StorageService
from quoll.auth.audit import record
from quoll.auth.audit_models import AuditEventType, TargetType
from quoll.auth.models import User
from quoll.core.exceptions import IdNotExistsException, StorageException
from quoll.core.people import person
from quoll.core.system_defaults import SystemDefaults
from quoll.interactions.bindings import BUSINESS_TZ
from quoll.reports import labels, policy, repository
from quoll.reports.models import ExportStatus, ReportExport
from quoll.reports.schemas import (
    ExportCreate,
    MoveRead,
    PreviewRequest,
    ReportParams,
    ResponsibleRead,
    RowRead,
    StatusRead,
    TransitionsRead,
)

# один снимок на построение (IR3); тесты подменяют - их соединение уже в транзакции
SNAPSHOT_OPTIONS = {"isolation_level": "REPEATABLE READ", "postgresql_readonly": True}


@asynccontextmanager
async def snapshot(session_maker: async_sessionmaker):
    """своя сессия: у SessionDep запроса транзакция уже начата, уровень
    изоляции ей не сменить. Закрывается до сборки строк и рендера"""
    async with session_maker() as session:
        await session.connection(execution_options=SNAPSHOT_OPTIONS)
        yield session


def today() -> date:
    return datetime.now(BUSINESS_TZ).date()


async def load(
    session: AsyncSession, actor_id: str, params: ReportParams, b_end: datetime
) -> tuple[User | None, policy.Facts | None]:
    actor = await session.get(User, actor_id)
    if actor is None:
        return None, None
    return actor, await repository.load_facts(session, actor, params, b_end)


async def build(
    session_maker: async_sessionmaker, actor_id: str, params: ReportParams
) -> list[policy.Row]:
    a_start, b_end = policy.period(params.date_from, params.date_to, today())
    async with snapshot(session_maker) as session:
        _, facts = await load(session, actor_id, params, b_end)
    return policy.build_rows(facts, params, a_start, b_end) if facts else []


async def preview(
    session_maker: async_sessionmaker, actor_id: str, body: PreviewRequest
) -> dict:
    rows = await build(session_maker, actor_id, body)
    page = rows[body.offset : body.offset + body.limit]
    return {
        "total": len(rows),
        "columns": body.columns,
        "rows": [view(row, body.columns) for row in page],
    }


def view(row: policy.Row, columns: list[str]) -> RowRead:
    """только выбранные колонки; подписи - те же, что в файле"""
    values = {
        "university": row.university,
        "direction": row.direction or labels.NOT_SET["direction"],
        "program": row.program or labels.NOT_SET["program"],
        "product": row.product or labels.NOT_SET["product"],
        "status": StatusRead(
            kind=row.status.kind.value,
            stage_id=row.status.stage_id,
            stage_name=row.status.stage_name,
            archived=row.status.archived,
            paused=row.status.paused,
            agreement=row.status.agreement,
            label=row.status.label,
        ),
        "responsible": ResponsibleRead(
            id=row.responsible_id,
            name=row.responsible_name,
            earlier_id=row.earlier_id,
            earlier_name=row.earlier_name,
            label=labels.responsible(row.responsible_name, row.earlier_name),
        ),
        # LMS по паре "вуз x программа" ветки, "-" у строки без ветки (план §6)
        "students": row.students,
        "streams": row.streams,
        "teachers_kam": row.teachers_kam,
        "teachers_lms": row.teachers_lms,
        "transitions": TransitionsRead(
            count=len(row.moves),
            items=[
                MoveRead(
                    at=m.at,
                    kind=m.kind,
                    from_stage_id=m.from_stage_id,
                    to_stage_id=m.to_stage_id,
                    label=m.label,
                )
                for m in row.moves
            ],
        ),
        "contract_number": row.contract_number,
        "license_until": row.license_until,
        "transfer_status": labels.TRANSFER.get(row.transfer_status),
        "region": row.region,
    }
    return RowRead(
        interaction_id=row.interaction_id,
        branch_id=row.branch_id,
        university_id=row.university_id,
        **{key: values[key] for key in columns},
    )


async def options(session_maker: async_sessionmaker, actor_id: str) -> dict:
    async with snapshot(session_maker) as session:
        actor = await session.get(User, actor_id)
        found = await repository.options(session, actor)
    return {
        "universities": [
            {"id": u.id, "name": u.short_name} for u in found["universities"]
        ],
        "regions": sorted({u.region for u in found["universities"]}),
        "directions": _named(found["directions"]),
        "programs": _named({k: name for k, (name, _) in found["programs"].items()}),
        "products": [
            *_named(found["products"]),
            {"id": policy.NO_PRODUCT, "name": labels.NO_PRODUCT},
        ],
        "responsible": sorted(
            (
                {"id": k, "name": person(p), "is_active": p.is_active}
                for k, p in found["people"].items()
            ),
            key=lambda o: o["name"],
        ),
        "statuses": [
            *(
                {"id": s.id, "name": s.name, "archived": s.archived_at is not None}
                for s in found["stages"]
            ),
            *({"id": k, "name": v} for k, v in labels.SPECIAL_STATUSES.items()),
        ],
    }


def _named(items: dict) -> list[dict]:
    return sorted(
        ({"id": k, "name": v} for k, v in items.items()), key=lambda o: o["name"]
    )


# --- выгрузки (§9)

LIMITS = {
    "xls": SystemDefaults.REPORT_XLS_MAX_ROWS,
    "pdf": SystemDefaults.REPORT_PDF_MAX_ROWS,
}


async def create_export(
    session: AsyncSession,
    session_maker: async_sessionmaker,
    actor: User,
    body: ExportCreate,
) -> dict:
    """объём проверяется сразу; строится файл потом, воркером"""
    rows = await build(session_maker, actor.id, body.params)
    if not rows:
        raise policy.ReportError(409, "REP-204", "Report has no rows")
    limit = LIMITS.get(body.format)
    if limit is not None and len(rows) > limit:
        raise policy.ReportError(
            413,
            "REP-413",
            "Too many rows for format",
            {"format": body.format, "rows": len(rows)},
        )
    job = ReportExport(
        requested_by=actor.id,
        format=body.format,
        params=body.params.model_dump(mode="json"),
        status=ExportStatus.QUEUED,
        row_count=len(rows),
    )
    session.add(job)
    await session.flush()
    record(
        session,
        actor_id=actor.id,
        event_type=AuditEventType.REPORT_EXPORT_REQUESTED,
        target_type=TargetType.REPORT_EXPORT,
        target_id=job.id,
        new_value={
            "format": body.format,
            "date_from": body.params.date_from.isoformat(),
            "date_to": body.params.date_to.isoformat(),
            "row_count": len(rows),
        },
    )
    await session.refresh(job)
    return await export_view(session, job)


async def export_view(session: AsyncSession, job: ReportExport) -> dict:
    code = None
    if job.status == ExportStatus.QUEUED:
        code = "REP-429"
    elif job.status in (ExportStatus.FAILED, ExportStatus.TIMED_OUT):
        code = job.error_code
    return {
        "id": job.id,
        "status": job.status,
        "format": job.format,
        "row_count": job.row_count,
        "created_at": job.created_at,
        "finished_at": job.finished_at,
        "file_name": file_name(job),
        "code": code,
        "position": await repository.position(session, job),
    }


def file_name(job: ReportExport) -> str:
    made = job.created_at.astimezone(BUSINESS_TZ)
    start = date.fromisoformat(job.params["date_from"])
    end = date.fromisoformat(job.params["date_to"])
    return f"report_{start:%Y%m%d}-{end:%Y%m%d}_{made:%Y%m%d-%H%M}.{job.format}"


async def own_export(
    session: AsyncSession,
    session_maker: async_sessionmaker,
    actor: User,
    export_id: int,
    endpoint: str,
) -> ReportExport:
    job = await session.get(ReportExport, export_id)
    if job is None:
        raise IdNotExistsException(ReportExport.__name__)
    if job.requested_by != actor.id:
        # ответ 403 откатит транзакцию запроса - журнал пишем отдельной
        async with session_maker() as detached, detached.begin():
            record(
                detached,
                actor_id=actor.id,
                event_type=AuditEventType.REPORT_ACCESS_DENIED,
                target_type=TargetType.REPORT_EXPORT,
                target_id=export_id,
                new_value={"error_code": "REP-403", "endpoint": endpoint},
            )
        raise policy.ReportError(
            403, "REP-403", "Report export belongs to another user"
        )
    return job


async def export_file(
    session: AsyncSession, s3: S3StorageService, job: ReportExport
) -> tuple[AsyncIterator[bytes], str]:
    if job.status == ExportStatus.EXPIRED:
        raise policy.ReportError(410, "REP-410", "Report file has expired")
    if job.status != ExportStatus.DONE:
        raise policy.ReportError(409, "REP-409", "Report file is not available")
    try:
        stream, content_type, _ = await s3.download_stream(job.storage_key)
    except StorageException:
        # очистка успела между чтением статуса и S3 - это истечение, а не сбой
        await session.refresh(job)
        if job.status == ExportStatus.EXPIRED:
            raise policy.ReportError(
                410, "REP-410", "Report file has expired"
            ) from None
        raise
    return stream, content_type
