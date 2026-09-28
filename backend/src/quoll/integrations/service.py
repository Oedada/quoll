"""Статистика LMS для карточки ветки (план §6)"""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from quoll.integrations.models import LmsStats


async def by_program(session: AsyncSession, university_id: int) -> dict[int, LmsStats]:
    """статистика вуза по программам: у веток одной программы она общая"""
    rows = await session.scalars(
        select(LmsStats).where(LmsStats.university_id == university_id)
    )
    return {row.program_id: row for row in rows}
