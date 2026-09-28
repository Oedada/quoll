"""Сопоставление внешних ключей В1/В2 с записями CRM (К §3). Сохранённое
сопоставление админа проверяется до поиска по названию: админ разрешает
именно те случаи, где автоматика не справилась"""

import re
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from quoll.catalog.models import ItProgram
from quoll.integrations.models import IntegrationMapping, MappingKind
from quoll.interactions.models import University

_WS = re.compile(r"\s+")
_QUOTES = re.compile(r"[«»\"'`„“”]")


def normalize(value: str) -> str:
    """регистр, кавычки, пробелы (К §3)"""
    return _WS.sub(" ", _QUOTES.sub("", value)).strip().casefold()


@dataclass(frozen=True)
class Match:
    """найдено ровно одно - target_id; иначе kind и key - что сопоставить админу"""

    target_id: int | None
    kind: MappingKind
    key: str
    candidates: tuple[int, ...] = ()

    @property
    def ambiguous(self) -> bool:
        return len(self.candidates) > 1


async def _mapped(session: AsyncSession, kind: MappingKind, key: str) -> int | None:
    return await session.scalar(
        select(IntegrationMapping.target_id).where(
            IntegrationMapping.kind == kind, IntegrationMapping.external_key == key
        )
    )


def _one(ids: list[int], kind: MappingKind, key: str) -> Match:
    if len(ids) == 1:
        return Match(ids[0], kind, key)
    return Match(None, kind, key, tuple(sorted(ids)))


async def course(
    session: AsyncSession, program_id: int | None, name: str | None
) -> Match:
    """В1: program_id главнее названия курса"""
    kind = MappingKind.COURSE
    key = f"id:{program_id}" if program_id is not None else normalize(name or "")
    if program_id is not None and await session.get(ItProgram, program_id):
        return Match(program_id, kind, key)
    if (mapped := await _mapped(session, kind, key)) is not None:
        return Match(mapped, kind, key)
    if program_id is not None:
        return Match(None, kind, key)
    # каталог невелик, а нормализацию в SQL не повторить
    programs = await session.execute(select(ItProgram.id, ItProgram.name))
    return _one([p.id for p in programs if normalize(p.name) == key], kind, key)


async def program(
    session: AsyncSession, program_id: int | None, site_course_id: str | None
) -> Match:
    """В2: наш id, иначе ID курса"""
    kind = MappingKind.PROGRAM
    key = f"id:{program_id}" if program_id is not None else f"course:{site_course_id}"
    if program_id is not None and await session.get(ItProgram, program_id):
        return Match(program_id, kind, key)
    if (mapped := await _mapped(session, kind, key)) is not None:
        return Match(mapped, kind, key)
    if program_id is not None:
        return Match(None, kind, key)
    ids = await session.scalars(
        select(ItProgram.id).where(ItProgram.site_course_id == site_course_id)
    )
    return _one(list(ids), kind, key)


async def university(
    session: AsyncSession, university_id: int | None, inn: str | None, kpp: str | None
) -> Match:
    """В2: id, иначе ИНН + КПП, иначе единственный вуз с этим ИНН. id и ИНН
    на разные вузы - неоднозначно (INT-409)"""
    kind = MappingKind.UNIVERSITY
    if university_id is not None:
        key = f"id:{university_id}"
    else:
        key = f"inn:{inn}" + (f"/kpp:{kpp}" if kpp else "")
    by_inn: list[int] = []
    if inn:
        stmt = select(University.id).where(University.inn == inn)
        if kpp:
            stmt = stmt.where(University.kpp == kpp)
        by_inn = list(await session.scalars(stmt))
    # решение админа главнее: им же разрешают и спор id с ИНН
    if (mapped := await _mapped(session, kind, key)) is not None:
        return Match(mapped, kind, key)
    if university_id is not None and await session.get(University, university_id):
        if by_inn and university_id not in by_inn:
            return Match(None, kind, key, tuple(sorted({university_id, *by_inn})))
        return Match(university_id, kind, key)
    return _one(by_inn, kind, key)
