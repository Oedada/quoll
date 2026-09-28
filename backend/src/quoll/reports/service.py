"""Отчёты: предпросмотр и значения фильтров (reports-design §8)"""

from contextlib import asynccontextmanager
from datetime import date, datetime

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from quoll.auth.models import User
from quoll.interactions.bindings import BUSINESS_TZ
from quoll.reports import labels, policy, repository
from quoll.reports.schemas import (
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
        # LMS - прочерки, пока нет интеграций (В1)
        "students": None,
        "streams": None,
        "teachers_kam": row.teachers_kam,
        "teachers_lms": None,
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
                {"id": k, "name": labels.person(p), "is_active": p.is_active}
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
