"""Очередь несопоставленных записей В1/В2 (К §4, план §5). Бизнес-данные
админ не правит: он сопоставляет ключ, и все ждущие записи с этим ключом
разбираются заново тем же кодом, что и при обмене"""

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from quoll.auth.audit import record as audit
from quoll.auth.audit_models import AuditEventType, TargetType
from quoll.catalog.models import ItProgram
from quoll.core.exceptions import DomainRuleException, IdNotExistsException
from quoll.core.locking import lock_row, lock_rows
from quoll.integrations import flows
from quoll.integrations.models import (
    IntegrationMapping,
    IntegrationUnmatched,
    MappingKind,
    UnmatchedFlow,
    UnmatchedStatus,
)
from quoll.interactions.models import University

_TARGETS = {
    MappingKind.COURSE: ItProgram,
    MappingKind.PROGRAM: ItProgram,
    MappingKind.UNIVERSITY: University,
}


async def queue(
    session: AsyncSession, status: UnmatchedStatus | None, limit: int, offset: int
) -> list[IntegrationUnmatched]:
    stmt = select(IntegrationUnmatched)
    if status is not None:
        stmt = stmt.where(IntegrationUnmatched.status == status)
    return list(
        await session.scalars(
            stmt.order_by(IntegrationUnmatched.id.desc()).limit(limit).offset(offset)
        )
    )


async def _pending(session: AsyncSession, unmatched_id: int) -> IntegrationUnmatched:
    if await session.get(IntegrationUnmatched, unmatched_id) is None:
        raise IdNotExistsException(IntegrationUnmatched.__name__)
    row = await lock_row(session, IntegrationUnmatched, unmatched_id)
    if row.status != UnmatchedStatus.PENDING:
        raise DomainRuleException(409, f"Record is already {row.status}")
    return row


def _decide(row: IntegrationUnmatched, status: UnmatchedStatus, actor_id: str) -> None:
    row.status = status
    row.decided_by = actor_id
    row.decided_at = func.now()


async def _replay(session: AsyncSession, row: IntegrationUnmatched) -> str:
    if row.flow == UnmatchedFlow.B1:
        return await flows.take_enrollment(session, flows.Enrollment(**row.record))
    return await flows.take_stats(session, flows.Stats(**row.record))


async def resolve(
    session: AsyncSession, *, unmatched_id: int, target_id: int, actor_id: str
) -> list[IntegrationUnmatched]:
    """запомнить сопоставление и разобрать заново все ждущие записи с этим
    ключом. Не нашлась вторая сторона пары - запись снова встаёт в очередь
    уже по ней"""
    row = await session.get(IntegrationUnmatched, unmatched_id)
    if row is None:
        raise IdNotExistsException(IntegrationUnmatched.__name__)
    if await session.get(_TARGETS[MappingKind(row.mapping_kind)], target_id) is None:
        raise DomainRuleException(404, "Mapping target does not exist")
    same = await session.scalars(
        select(IntegrationUnmatched.id).where(
            IntegrationUnmatched.mapping_kind == row.mapping_kind,
            IntegrationUnmatched.external_key == row.external_key,
            IntegrationUnmatched.status == UnmatchedStatus.PENDING,
        )
    )
    # все строки ключа - по возрастанию id, иначе два решения по одному
    # ключу взяли бы их встречно
    kind, key = row.mapping_kind, row.external_key
    locked = await lock_rows(session, IntegrationUnmatched, [unmatched_id, *same])
    if locked[unmatched_id].status != UnmatchedStatus.PENDING:
        raise DomainRuleException(409, f"Record is already {row.status}")
    # параллельный обмен мог переставить запись на другую сторону пары -
    # target_id проверяли для прежней
    if (row.mapping_kind, row.external_key) != (kind, key):
        raise DomainRuleException(409, "Record changed, reload the queue")
    rows = [
        r
        for r in locked.values()
        if r.status == UnmatchedStatus.PENDING
        and (r.mapping_kind, r.external_key) == (kind, key)
    ]
    session.add(
        IntegrationMapping(
            kind=row.mapping_kind,
            external_key=row.external_key,
            target_id=target_id,
            created_by=actor_id,
        )
    )
    for found in rows:
        _decide(found, UnmatchedStatus.APPROVED, actor_id)
    # решённые снимаются с ждущих до разбора - иначе повторная постановка
    # в очередь упёрлась бы в них же
    await session.flush()
    results = {found.id: await _replay(session, found) for found in rows}
    audit(
        session,
        actor_id=actor_id,
        event_type=AuditEventType.INTEGRATION_MAPPING_RESOLVED,
        target_type=TargetType.INTEGRATION_MAPPING,
        target_id=row.id,
        new_value={
            "kind": row.mapping_kind,
            "external_key": row.external_key,
            "target_id": target_id,
            "results": results,
        },
    )
    return rows


async def reject(
    session: AsyncSession, *, unmatched_id: int, actor_id: str
) -> IntegrationUnmatched:
    row = await _pending(session, unmatched_id)
    _decide(row, UnmatchedStatus.REJECTED, actor_id)
    await session.flush()
    audit(
        session,
        actor_id=actor_id,
        event_type=AuditEventType.INTEGRATION_UNMATCHED_REJECTED,
        target_type=TargetType.INTEGRATION_MAPPING,
        target_id=row.id,
        new_value={"flow": row.flow, "external_key": row.external_key},
    )
    return row
