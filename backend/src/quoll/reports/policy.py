"""Строки отчёта и их значения на дату B (reports-design §7).

чистые функции над фактами - в БД не ходят, факты собирает repository.
Порядок событий - по id, а не по created_at: created_at - начало транзакции,
а id выдаётся под блокировкой заявки (IR14). created_at - только для границ периода
"""

from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from enum import StrEnum
from typing import Any

from quoll.core.exceptions import AppException
from quoll.interactions.bindings import BUSINESS_TZ
from quoll.reports import labels


class ReportError(AppException):
    def __init__(
        self, status_code: int, code: str, message: str, params: dict | None = None
    ):
        super().__init__(status_code, message, code, params)


class RowKind(StrEnum):
    ON_STEPS = "ON_STEPS"  # ветка открыта к B - свои шаги
    COMPOSITION = "COMPOSITION"  # ветка состава - статус заявки
    INTERACTION = "INTERACTION"  # заявка без веток


class StatusKind(StrEnum):
    AWAITING = "AWAITING"
    STEP = "STEP"
    DONE = "DONE"
    REFUSED = "REFUSED"


NO_PRODUCT = "none"
_CLOSE_KINDS = frozenset({"CLOSE", "CANCEL"})
_REOPEN_KINDS = frozenset({"REOPEN", "RESTART"})
_PAUSE_KINDS = frozenset({"PAUSE", "UNPAUSE"})
# движения шага; остальные события (ДС, лицензии, слоты) шаг не меняют
_MOVE_KINDS = frozenset(
    {"TRANSITION", "REJECTION", "ROLLBACK", "RELOCATION", "BRANCH_ADDED"}
)
_SA_OPEN, _SA_DONE = "SA_OPENED", frozenset({"SA_APPROVED", "SA_CANCELLED"})


# --- факты


@dataclass(frozen=True)
class Event:
    id: int
    branch_id: int | None
    side_pointer_id: int | None
    kind: str
    from_stage_id: int | None
    to_stage_id: int | None
    payload: dict[str, Any]
    created_at: datetime


@dataclass(frozen=True)
class Assignment:
    id: int
    manager_id: str | None
    assigned_at: datetime
    released_at: datetime | None


@dataclass(frozen=True)
class BranchFact:
    id: int
    program_id: int | None
    product_id: int | None
    contract_status: str
    opened_at: datetime | None
    created_at: datetime
    teachers_trained: int | None
    transfer_status: str
    license_until: date | None


@dataclass(frozen=True)
class InteractionFact:
    id: int
    university_id: int
    no_return_at: datetime | None
    contract_number: str | None
    branches: tuple[BranchFact, ...]
    # все события заявки до b_end, по id
    events: tuple[Event, ...]
    assignments: tuple[Assignment, ...]


@dataclass(frozen=True)
class StageFact:
    name: str
    is_terminal: bool
    archived: bool


@dataclass(frozen=True)
class Person:
    last_name: str
    first_name: str
    patronymic: str | None
    is_active: bool


@dataclass(frozen=True)
class Facts:
    interactions: tuple[InteractionFact, ...]
    universities: dict[int, tuple[str, str]]  # id -> (краткое название, регион)
    programs: dict[int, tuple[str, int]]  # id -> (название, направление)
    directions: dict[int, str]
    products: dict[int, str]  # id -> "название (вендор)"
    stages: dict[int, StageFact]
    reasons: dict[int, str]  # id -> DONE | REFUSED
    people: dict[str, Person]
    # продления лицензии после B - для "Лицензия до" на B
    extensions: dict[int, tuple[Event, ...]]


# --- строки


@dataclass(frozen=True)
class Status:
    kind: StatusKind
    stage_id: int | None = None
    stage_name: str | None = None
    archived: bool = False
    paused: bool = False
    agreement: bool = False

    @property
    def key(self) -> int | str:
        """значение фильтра "Статус": шаг или особый статус"""
        return self.stage_id if self.kind == StatusKind.STEP else self.kind.value

    @property
    def label(self) -> str:
        return labels.status(self)


@dataclass(frozen=True)
class Move:
    at: date
    kind: str  # MOVE | PAUSE | UNPAUSE | CLOSE | REOPEN
    from_stage_id: int | None
    to_stage_id: int | None
    from_name: str | None
    to_name: str | None
    restart: bool = False

    @property
    def label(self) -> str:
        return labels.move(self)


@dataclass(frozen=True)
class Row:
    interaction_id: int
    branch_id: int | None
    kind: RowKind
    university_id: int
    university: str
    region: str
    direction_id: int | None
    direction: str | None
    program_id: int | None
    program: str | None
    product_id: int | None
    product: str | None
    status: Status
    responsible_id: str | None
    responsible_name: str
    earlier_id: str | None
    earlier_name: str | None
    teachers_kam: int | None
    transfer_status: str | None
    license_until: date | None
    contract_number: str | None
    moves: tuple[Move, ...]


# --- период


def _day_start(day: date) -> datetime:
    return datetime.combine(day, time.min, BUSINESS_TZ)


def period(date_from: date, date_to: date, today: date) -> tuple[datetime, datetime]:
    """начало дня A и начало дня после B по Москве: границы включительно"""
    if date_from > date_to:
        raise ReportError(
            422,
            "REP-400",
            "Invalid report period",
            {"field": "date_from", "reason": "after_to"},
        )
    if date_to > today:
        raise ReportError(
            422,
            "REP-400",
            "Invalid report period",
            {"field": "date_to", "reason": "future"},
        )
    return _day_start(date_from), _day_start(date_to + timedelta(days=1))


# --- события


def _closing(e: Event, terminal: frozenset[int]) -> bool:
    return e.kind in _CLOSE_KINDS or (
        e.kind == "TRANSITION" and e.to_stage_id in terminal
    )


def last_closure(events: tuple[Event, ...] | list[Event], terminal) -> Event | None:
    """действующее закрытие: последнее закрытие без возобновления после него"""
    closure = None
    for e in events:
        if _closing(e, terminal):
            closure = e
        elif e.kind in _REOPEN_KINDS:
            closure = None
    return closure


def outcome(e: Event, reasons: dict[int, str]) -> StatusKind:
    """итог закрытия: ребро в конечный шаг - завершение; иначе по причине.
    CLOSE/CANCEL без причины записаны до её хранения - считаем отказом (§4.2)"""
    if e.kind == "TRANSITION":
        return StatusKind.DONE
    reason_id = e.payload.get("close_reason_id")
    if reason_id is None:
        return StatusKind.REFUSED
    return StatusKind(reasons.get(reason_id, "REFUSED"))


def entered(events) -> bool:
    """заявка вошла в маршрут - принятие КАМом"""
    return any(e.from_stage_id is None and e.to_stage_id is not None for e in events)


def paused(events, terminal) -> bool:
    """закрытие и переоткрытие снимают паузу без события UNPAUSE"""
    state = False
    for e in events:
        if e.kind == "PAUSE":
            state = True
        elif e.kind == "UNPAUSE" or e.kind in _REOPEN_KINDS or _closing(e, terminal):
            state = False
    return state


def agreement_open(events) -> bool:
    """на B открыто допсоглашение - любого прохождения; открытое одно (I6)"""
    opened: set = set()
    for e in events:
        if e.kind == _SA_OPEN:
            opened.add(e.payload.get("sa_id"))
        elif e.kind in _SA_DONE:
            opened.discard(e.payload.get("sa_id"))
    return bool(opened)


def _last_stage(events) -> int | None:
    stage = None
    for e in events:
        if e.to_stage_id is not None:
            stage = e.to_stage_id
    return stage


# --- ответственный


def holder_at(assignments, moment: datetime) -> Assignment | None:
    for a in assignments:
        if a.assigned_at < moment and (
            a.released_at is None or a.released_at >= moment
        ):
            return a
    return None


def held_in(assignments, manager_id: str, a_start: datetime, b_end: datetime) -> bool:
    return any(
        a.manager_id == manager_id
        and a.assigned_at < b_end
        and (a.released_at is None or a.released_at >= a_start)
        for a in assignments
    )


def responsible(assignments, a_start, b_end) -> tuple[str | None, str | None]:
    """КАМ на конец B и, если на начало A был другой, прежний"""
    current = holder_at(assignments, b_end)
    if current is None:
        # закрытая без владельца: последний, кто её вёл
        before = [a for a in assignments if a.assigned_at < b_end]
        current = max(before, key=lambda a: (a.assigned_at, a.id), default=None)
    earlier = holder_at(assignments, a_start)
    current_id = current.manager_id if current else None
    if earlier is None or earlier.manager_id == current_id:
        return current_id, None
    return current_id, earlier.manager_id


# --- попадание и строки


def interaction_allowed(i: InteractionFact, own, a_start, b_end, terminal) -> bool:
    """own - события самой заявки до b_end (§7.2)"""
    if not any(a.assigned_at < b_end for a in i.assignments):
        return False
    if holder_at(i.assignments, b_end) is None and not entered(own):
        # КАМ отказался до B - на B это снова черновик
        return False
    return _alive(own, a_start, terminal)


def _alive(events, a_start, terminal) -> bool:
    """жила в периоде: на начало A не закрыта или возобновлена внутри"""
    closed_on_a = last_closure([e for e in events if e.created_at < a_start], terminal)
    reopened_in = any(
        e.kind in _REOPEN_KINDS and e.created_at >= a_start for e in events
    )
    return closed_on_a is None or reopened_in


def row_kinds(i: InteractionFact, by_branch, a_start, b_end, terminal):
    """строки заявки: вид - по ветке на B, а не по текущему шагу (§7.3, IR15)"""
    sealed = i.no_return_at is not None and i.no_return_at < b_end
    rows = []
    for b in i.branches:
        if b.created_at >= b_end:
            continue
        if b.opened_at is not None and b.opened_at < b_end:
            if _alive(by_branch.get(b.id, ()), a_start, terminal):
                rows.append((b, RowKind.ON_STEPS))
        elif b.contract_status == "APPROVED" or (
            b.contract_status == "PROPOSED" and not sealed
        ):
            rows.append((b, RowKind.COMPOSITION))
    return rows or [(None, RowKind.INTERACTION)]


@dataclass(frozen=True)
class OwnState:
    """состояние самой заявки на B - одно на все её строки"""

    closure: Event | None
    entered: bool
    stage_id: int | None
    paused: bool
    agreement: bool
    # её переходы за период: (id события, переход)
    moves: tuple[tuple[int, Move], ...]


def own_state(own, sa_events, sealed_at, a_start, facts, terminal) -> OwnState:
    """ход заявки - только до подписания; пауза, закрытие и переоткрытие
    заявки - в любое время: они касаются всех её веток (§7.8, О4)"""
    chosen = [
        e
        for e in own
        if e.created_at >= a_start
        and (
            e.created_at < sealed_at
            or e.kind in _PAUSE_KINDS
            or e.kind in _REOPEN_KINDS
            or _closing(e, terminal)
        )
    ]
    return OwnState(
        closure=last_closure(own, terminal),
        entered=entered(own),
        stage_id=_last_stage(own),
        paused=paused(own, terminal),
        agreement=agreement_open(sa_events),
        moves=_moves(chosen, facts, terminal),
    )


def status(kind, state: OwnState, branch_events, facts: Facts, terminal) -> Status:
    on_steps = kind == RowKind.ON_STEPS
    closure = last_closure(branch_events, terminal) if on_steps else None
    if closure is None:
        closure = state.closure
    if closure is not None:
        return Status(outcome(closure, facts.reasons))
    if not state.entered:
        return Status(StatusKind.AWAITING)
    stage_id = _last_stage(branch_events) if on_steps else None
    if stage_id is None:
        stage_id = state.stage_id
    stage = facts.stages.get(stage_id)
    return Status(
        StatusKind.STEP,
        stage_id=stage_id,
        stage_name=stage.name if stage else None,
        archived=bool(stage and stage.archived),
        paused=state.paused or (on_steps and paused(branch_events, terminal)),
        agreement=state.agreement,
    )


def _move(e: Event, facts: Facts, terminal) -> Move | None:
    if _closing(e, terminal):
        kind = "CLOSE"
    elif e.kind in _REOPEN_KINDS:
        kind = "REOPEN"
    elif e.kind in _PAUSE_KINDS:
        kind = e.kind
    elif e.kind in _MOVE_KINDS and e.to_stage_id != e.from_stage_id:
        kind = "MOVE"
    else:
        return None
    names = facts.stages
    return Move(
        at=e.created_at.astimezone(BUSINESS_TZ).date(),
        kind=kind,
        from_stage_id=e.from_stage_id,
        to_stage_id=e.to_stage_id,
        from_name=names[e.from_stage_id].name if e.from_stage_id in names else None,
        to_name=names[e.to_stage_id].name if e.to_stage_id in names else None,
        restart=e.kind == "RESTART",
    )


def _moves(events, facts, terminal) -> tuple[tuple[int, Move], ...]:
    found = ((e.id, _move(e, facts, terminal)) for e in events)
    return tuple((i, m) for i, m in found if m is not None)


def moves(kind, state: OwnState, branch_events, a_start, facts, terminal):
    """переходы строки за период по порядку id: заявки и, у ветки на шагах, свои"""
    merged = list(state.moves)
    if kind == RowKind.ON_STEPS:
        mine = [e for e in branch_events if e.created_at >= a_start]
        merged += _moves(mine, facts, terminal)
    return tuple(m for _, m in sorted(merged, key=lambda pair: pair[0]))


def license_at(branch: BranchFact, extensions: tuple[Event, ...]) -> date | None:
    """лицензия до на B: значение до первого продления после B (О5)"""
    if extensions:
        old = extensions[0].payload.get("old")
        return date.fromisoformat(old) if old else None
    return branch.license_until


# --- сборка


def build_rows(facts: Facts, params, a_start: datetime, b_end: datetime) -> list[Row]:
    terminal = frozenset(i for i, s in facts.stages.items() if s.is_terminal)
    rows = []
    for i in facts.interactions:
        # репозиторий уже отсёк события после B; здесь - чтобы политика от этого не зависела
        events = [e for e in i.events if e.created_at < b_end]
        own = [e for e in events if e.branch_id is None and e.side_pointer_id is None]
        if not interaction_allowed(i, own, a_start, b_end, terminal):
            continue
        by_branch: dict[int, list[Event]] = {}
        for e in events:
            if e.branch_id is not None:
                by_branch.setdefault(e.branch_id, []).append(e)
        sa_events = [e for e in events if e.kind.startswith("SA_")]
        who, earlier = responsible(i.assignments, a_start, b_end)
        sealed_at = i.no_return_at or datetime.max.replace(tzinfo=BUSINESS_TZ)
        state = own_state(own, sa_events, sealed_at, a_start, facts, terminal)
        for branch, kind in row_kinds(i, by_branch, a_start, b_end, terminal):
            branch_events = by_branch.get(branch.id, []) if branch else []
            row = _assemble(
                facts,
                i,
                branch,
                kind,
                status(kind, state, branch_events, facts, terminal),
                (who, earlier),
                moves(kind, state, branch_events, a_start, facts, terminal),
            )
            if _keep(row, i, params, a_start, b_end):
                rows.append(row)
    rows.sort(key=sort_key)
    return rows


def _assemble(facts, i, branch, kind, row_status, people, row_moves) -> Row:
    university, region = facts.universities[i.university_id]
    program_id = branch.program_id if branch else None
    program, direction_id = facts.programs.get(program_id, (None, None))
    product_id = branch.product_id if branch else None
    who, earlier = people
    return Row(
        interaction_id=i.id,
        branch_id=branch.id if branch else None,
        kind=kind,
        university_id=i.university_id,
        university=university,
        region=region,
        direction_id=direction_id,
        direction=facts.directions.get(direction_id),
        program_id=program_id,
        program=program,
        product_id=product_id,
        product=facts.products.get(product_id),
        status=row_status,
        responsible_id=who,
        responsible_name=labels.person(facts.people.get(who)),
        earlier_id=earlier,
        earlier_name=labels.person(facts.people.get(earlier)) if earlier else None,
        teachers_kam=branch.teachers_trained if branch else None,
        transfer_status=branch.transfer_status if branch else None,
        license_until=(
            license_at(branch, facts.extensions.get(branch.id, ())) if branch else None
        ),
        contract_number=i.contract_number,
        moves=row_moves,
    )


def _keep(row: Row, i: InteractionFact, params, a_start, b_end) -> bool:
    """внутри фильтра - ИЛИ, между фильтрами - И; пустой - без ограничения"""
    if params.direction_ids and row.direction_id not in params.direction_ids:
        return False
    if params.program_ids and row.program_id not in params.program_ids:
        return False
    if params.product_ids and not (
        row.product_id in params.product_ids
        or (row.product_id is None and NO_PRODUCT in params.product_ids)
    ):
        return False
    if params.responsible_ids and not any(
        held_in(i.assignments, m, a_start, b_end) for m in params.responsible_ids
    ):
        return False
    return not params.statuses or row.status.key in params.statuses


def _norm(value: str | None) -> str:
    return (value or "").casefold().replace("ё", "е")


def sort_key(row: Row):
    """вуз -> программа -> продукт, "без продукта" последним; ключ строки
    в конце - порядок детерминирован (IR9)"""
    return (
        _norm(row.university),
        _norm(row.program) if row.program else "￿",
        row.product is None,
        _norm(row.product),
        row.branch_id if row.branch_id is not None else -row.interaction_id,
    )
