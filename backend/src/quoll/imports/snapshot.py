"""Снимок базы для анализа партии (import-design §16.2).

Фиксированное число запросов на справочник; контакты (ПДн, SQL-ом не
ищутся) - лениво по владельцу. Объекты только читаются (M1).

Состояние вуза в реестре (§16.10) - тоже лениво по владельцу: заранее
неизвестно, какие вузы встретятся на листе реестра (M1, отклонение от
буквы §16.2, где это описано частью общего снимка)
"""

from dataclasses import dataclass, field

from sqlalchemy import exists, select
from sqlalchemy.ext.asyncio import AsyncSession

from quoll.auth.models import Manager
from quoll.catalog.models import (
    CloseReason,
    Contact,
    DocumentKind,
    ItDirection,
    ItProgram,
    Product,
    Specialty,
    university_specialties,
)
from quoll.imports.models import ImportBatch
from quoll.imports.normalize import text_key
from quoll.interactions.models import (
    Branch,
    Interaction,
    InteractionStageHistory,
    StageChangeKind,
    University,
    Vendor,
)
from quoll.workflows.models import Stage, WorkflowTransition


def _by(items, key) -> dict:
    out: dict = {}
    for item in items:
        out.setdefault(key(item), []).append(item)
    return out


@dataclass(frozen=True)
class StageAnchors:
    """опорные стадии маршрута партии (import-design §16.7)"""

    s0: int | None = None
    seal: int | None = None
    nr: int | None = None
    b0: int | None = None
    b1: int | None = None
    done: int | None = None
    agr: int | None = None


def _min_position(stages: dict[int, Stage], ids: set[int]) -> int | None:
    candidates = [stages[i] for i in ids if i in stages]
    if not candidates:
        return None
    return min(candidates, key=lambda s: s.position).id


def _anchors(stages: dict[int, Stage], edges: list[WorkflowTransition]) -> StageAnchors:
    live = {i: s for i, s in stages.items() if s.archived_at is None}
    starts = {e.to_stage_id for e in edges if e.from_stage_id is None}
    s0 = _min_position(live, starts)
    b0_candidates = {i for i, s in live.items() if s.is_branch_start}
    b0 = next(iter(b0_candidates)) if len(b0_candidates) == 1 else None
    seal = nr = None
    irreversible = [e for e in edges if e.is_irreversible]
    if b0 is not None:
        seal = _min_position(
            live, {e.from_stage_id for e in irreversible if e.to_stage_id == b0}
        )
    else:
        nr = _min_position(live, {e.to_stage_id for e in irreversible})
    b1 = None
    if b0 is not None:
        forward = {
            e.to_stage_id
            for e in edges
            if e.from_stage_id == b0 and not e.is_backward and e.to_stage_id in live
        }
        non_terminal = {i for i in forward if not live[i].is_terminal}
        b1 = next(iter(non_terminal)) if len(non_terminal) == 1 else None
    done = None
    if seal is not None:
        forward = {
            e.to_stage_id
            for e in edges
            if e.from_stage_id == seal
            and not e.is_backward
            and e.to_stage_id in live
            and live[e.to_stage_id].is_terminal
            and not live[e.to_stage_id].is_branch_stage
        }
        done = next(iter(forward)) if len(forward) == 1 else None
    agr = None
    if seal is not None:
        agr_candidates = {
            e.to_stage_id
            for e in edges
            if e.from_stage_id == seal
            and e.to_stage_id in live
            and live[e.to_stage_id].is_side
            and live[e.to_stage_id].handler == "SUPPLEMENTARY_AGREEMENT"
        }
        agr = next(iter(agr_candidates)) if len(agr_candidates) == 1 else None
    return StageAnchors(s0=s0, seal=seal, nr=nr, b0=b0, b1=b1, done=done, agr=agr)


@dataclass(frozen=True)
class UniversityState:
    """заявка вуза для сравнения (§16.10): открытая, иначе последняя
    закрытая с событием IMPORT (б)"""

    interaction: Interaction | None
    branches: list[Branch]
    is_open: bool


@dataclass
class Snapshot:
    directions: dict[str, list[ItDirection]] = field(default_factory=dict)
    vendors: dict[str, list[Vendor]] = field(default_factory=dict)
    vendors_by_id: dict[int, Vendor] = field(default_factory=dict)
    # название -> продукты всех вендоров
    products: dict[str, list[Product]] = field(default_factory=dict)
    products_by_id: dict[int, Product] = field(default_factory=dict)
    programs: dict[str, list[ItProgram]] = field(default_factory=dict)
    programs_by_id: dict[int, ItProgram] = field(default_factory=dict)
    specialties: dict[str, Specialty] = field(default_factory=dict)
    universities: list[University] = field(default_factory=list)
    universities_by_id: dict[int, University] = field(default_factory=dict)
    university_specialties: set[tuple[int, int]] = field(default_factory=set)
    close_reasons: dict[str, CloseReason] = field(default_factory=dict)
    document_kinds: set[str] = field(default_factory=set)
    # менеджеры маршрута партии (роль MANAGER), для реестра
    managers: list[Manager] = field(default_factory=list)
    managers_by_id: dict[str, Manager] = field(default_factory=dict)
    # занято по снимку - для лимита В3 (16.9), пополняется анализом группы
    manager_load: dict[str, int] = field(default_factory=dict)
    stages: dict[int, Stage] = field(default_factory=dict)
    edges: list[WorkflowTransition] = field(default_factory=list)
    anchors: StageAnchors = field(default_factory=StageAnchors)
    _contacts: dict[tuple[str, int], list[Contact]] = field(default_factory=dict)
    _university_state: dict[int, UniversityState] = field(default_factory=dict)
    session: AsyncSession | None = None

    @classmethod
    async def load(
        cls, session: AsyncSession, batch: ImportBatch | None = None
    ) -> "Snapshot":
        snap = cls(session=session)
        directions = list(await session.scalars(select(ItDirection)))
        snap.directions = _by(directions, lambda d: text_key(d.name))
        vendors = list(await session.scalars(select(Vendor)))
        snap.vendors = _by(vendors, lambda v: text_key(v.name))
        snap.vendors_by_id = {v.id: v for v in vendors}
        products = list(await session.scalars(select(Product)))
        snap.products = _by(products, lambda p: text_key(p.name))
        snap.products_by_id = {p.id: p for p in products}
        programs = list(await session.scalars(select(ItProgram)))
        snap.programs = _by(programs, lambda p: text_key(p.name))
        snap.programs_by_id = {p.id: p for p in programs}
        snap.specialties = {s.code: s for s in await session.scalars(select(Specialty))}
        snap.universities = list(await session.scalars(select(University)))
        snap.universities_by_id = {u.id: u for u in snap.universities}
        link = university_specialties
        snap.university_specialties = {
            (r.university_id, r.specialty_id)
            for r in await session.execute(
                select(link.c.university_id, link.c.specialty_id)
            )
        }
        snap.close_reasons = {
            r.code: r for r in await session.scalars(select(CloseReason))
        }
        snap.document_kinds = set(await session.scalars(select(DocumentKind.code)))
        managers = list(await session.scalars(select(Manager)))
        snap.managers = managers
        snap.managers_by_id = {m.id: m for m in managers}
        if batch is not None and batch.workflow_id is not None:
            stages = list(
                await session.scalars(
                    select(Stage).where(Stage.workflow_id == batch.workflow_id)
                )
            )
            snap.stages = {s.id: s for s in stages}
            snap.edges = list(
                await session.scalars(
                    select(WorkflowTransition).where(
                        WorkflowTransition.workflow_id == batch.workflow_id,
                        WorkflowTransition.is_active.is_(True),
                    )
                )
            )
            snap.anchors = _anchors(snap.stages, snap.edges)
        return snap

    async def contacts(self, owner: str, owner_id: int) -> list[Contact]:
        """контакты вуза или вендора; сравниваются в Python по ФИО"""
        key = (owner, owner_id)
        if key not in self._contacts:
            column = (
                Contact.university_id if owner == "university" else Contact.vendor_id
            )
            self._contacts[key] = list(
                await self.session.scalars(select(Contact).where(column == owner_id))
            )
        return self._contacts[key]

    async def university_state(self, university_id: int) -> UniversityState:
        """заявка вуза для сравнения с файлом (§16.10) - лениво, по вузам
        реестра, а не по всем вузам базы"""
        if university_id not in self._university_state:
            open_interaction = await self.session.scalar(
                select(Interaction).where(
                    Interaction.university_id == university_id,
                    Interaction.closed_at.is_(None),
                )
            )
            interaction, is_open = open_interaction, True
            if interaction is None:
                is_open = False
                has_import_event = exists().where(
                    InteractionStageHistory.interaction_id == Interaction.id,
                    InteractionStageHistory.kind == StageChangeKind.IMPORT,
                )
                interaction = await self.session.scalar(
                    select(Interaction)
                    .where(
                        Interaction.university_id == university_id,
                        Interaction.closed_at.is_not(None),
                        has_import_event,
                    )
                    .order_by(Interaction.closed_at.desc())
                    .limit(1)
                )
            branches = []
            if interaction is not None:
                branches = list(
                    await self.session.scalars(
                        select(Branch)
                        .where(Branch.interaction_id == interaction.id)
                        .order_by(Branch.id)
                    )
                )
            self._university_state[university_id] = UniversityState(
                interaction, branches, is_open
            )
        return self._university_state[university_id]
