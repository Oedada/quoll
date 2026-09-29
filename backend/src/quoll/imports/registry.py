"""Группы реестра: сведение, шаг, менеджер, доп. поля, сравнение с базой
(import-design §16.6-16.10).

Вызывается из `analysis.analyze` после разбора всех листов реестра. Строки
уже прошли `_parse` (простые поля разобраны, ссылочные - как сырой текст:
`_resolve_field` для REGISTRY не вызывается - вуз, продукт, менеджер и шаг
ищутся здесь по своим правилам, не как обычные каталожные ссылки). Результат
на строку - `ctx.status/issues/group_key`, план группы - в
`an.groups[group_key]` (используется `place.py`)
"""

import hashlib
import json
import re
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy.ext.asyncio import AsyncSession

from quoll.auth.models import (
    IdentitySyncStatus,
    Manager,
    ManualWorkloadStatus,
    RoleTransitionStatus,
)
from quoll.imports import analysis, normalize
from quoll.imports.models import RowStatus
from quoll.workflows.graph_policy import EdgeFacts, leads_to

# даты договора и паузы - по календарю заказчика (interactions/bindings.py)
BUSINESS_TZ = ZoneInfo("Europe/Moscow")
MIN_PAUSE_HOURS = 1
MAX_PAUSE_HOURS = 720


@dataclass
class BranchPlan:
    row: Any  # RowCtx строки-источника ветки
    product_ref: Any
    program_ref: Any
    vendor_ref: Any = None
    stage_id: int | None = None
    is_branch_stage: bool = False
    since: date | None = None
    closed: bool = False
    refused: bool = False
    close_reason_id: int | None = None
    license_signed_at: date | None = None
    license_term_years: int | None = None
    transfer_status: str | None = None
    license_extended_until: date | None = None
    license_extended_at: date | None = None
    branch_paused: bool = False
    branch_pause_until: datetime | None = None
    comment: str | None = None
    # id программы/продукта - заполняет place.py после разрешения ссылок
    program_id: int | None = None
    product_id: int | None = None


@dataclass
class GroupPlan:
    key: str
    rows: list[Any] = field(default_factory=list)
    university_ref: Any = None
    university_id: int | None = None
    branches: list[BranchPlan] = field(default_factory=list)
    manager_id: str | None = None
    contract_number: str | None = None
    contract_signed_at: date | None = None
    contract_valid_until: date | None = None
    contract_extended_until: date | None = None
    contract_extended_at: date | None = None
    contacts_text: str | None = None
    comment: str | None = None
    pause_until: datetime | None = None
    agreement_open: bool = False
    agreement_since: date | None = None
    # шаг заявки строк 4-6; None у строки 7 (без шага)
    stage_id: int | None = None
    signed: bool = False
    no_return: bool = False
    close_by_all_branches: bool = False
    # (а)/(б) §16.10
    outcome: str = "NEW"  # NEW | SAME | CONFLICT
    decision: str | None = None
    replace_target: dict | None = None

    @property
    def earliest(self) -> date | None:
        """В25: самая ранняя дата группы из файла"""
        dates = [self.contract_signed_at, self.agreement_since]
        dates += [b.since for b in self.branches]
        dates = [d for d in dates if d is not None]
        return min(dates) if dates else None


def _date(value) -> date | None:
    return date.fromisoformat(value) if value else None


def _first(group: list, key: str):
    return next((r.values.get(key) for r in group if r.values.get(key)), None)


def _stage_by_number(stages: dict, number: str) -> list:
    """номер N/N.M: имя начинается с него, дальше «.»+не цифра, пробел или конец"""
    pattern = re.compile(rf"^{re.escape(number)}(\.(?!\d)|\s|$)")
    return [
        s for s in stages.values() if s.archived_at is None and pattern.match(s.name)
    ]


def _resolve_stage(an, ctx, text: str):
    stages = an.snap.stages
    key = normalize.text_key(text)
    exact = [
        s
        for s in stages.values()
        if s.archived_at is None and normalize.text_key(s.name) == key
    ]
    candidates = exact or _stage_by_number(stages, text.strip())
    if len(candidates) > 1:
        ctx.add("IMP-111", "stage")
        return None
    if not candidates:
        ctx.add("IMP-111", "stage")
        return None
    stage = candidates[0]
    if stage.is_side:
        ctx.add("IMP-155", "stage")
        return None
    return stage


def _resolve_vendor(an, ctx):
    text = ctx.values.get("vendor")
    if not text:
        return None
    key = normalize.text_key(text)
    found = an.snap.vendors.get(key, [])
    new = analysis._new_ref(an, "vendor", key)
    if len(found) + (new is not None) > 1:
        ctx.add("IMP-111", "vendor")
        return None
    if found:
        return {"id": found[0].id}
    if new:
        return new
    part = analysis._add_part(
        an, ctx, "vendor", key, None, {"name": text}, [("vendor", key)]
    )
    analysis._check(ctx, analysis.PARTS["vendor"], part, analysis.PARTS["vendor"].attrs)
    ctx.add("IMP-153", "vendor")
    return {"new_of_row": ctx.row.id, "part": "vendor"}


def _existing_product(an, key: str, vendor_ref):
    vendor_id = vendor_ref.get("id") if isinstance(vendor_ref, dict) else None
    candidates = an.snap.products.get(key, [])
    return [p for p in candidates if vendor_id is None or p.vendor_id == vendor_id]


def _program_direction(an, program_ref):
    """направление для нового продукта - направление его программы (В14):
    у существующей программы - сразу, у новой (та же партия) - из её строки"""
    if program_ref is None:
        return None
    if "id" in program_ref:
        program = an.snap.programs_by_id.get(program_ref["id"])
        return [{"id": program.direction_id}] if program else None
    source = next((r for r in an.rows if r.row.id == program_ref["new_of_row"]), None)
    direction = source.values.get("direction") if source else None
    return [direction] if direction else None


def _resolve_program(an, ctx, product_id: int | None):
    text = ctx.values.get("program")
    if text:
        key = normalize.text_key(text)
        found = an.snap.programs.get(key, [])
        new = analysis._new_ref(an, "program", key)
        if len(found) + (new is not None) > 1:
            ctx.add("IMP-111", "program")
            return None
        if found:
            return {"id": found[0].id}
        if new:
            return new
        ctx.add("IMP-110", "program")
        return None
    if product_id is None:
        ctx.add("IMP-151", "program")
        return None
    matches = [
        p
        for p in an.snap.programs_by_id.values()
        if p.is_active and product_id in {x.id for x in p.products}
    ]
    if len(matches) != 1:
        ctx.add("IMP-151", "program")
        return None
    return {"id": matches[0].id}


def _check_pair(ctx, an, program_ref, product_id: int | None) -> None:
    """В15: contract_service.check_pair - программа активна, продукт в её
    составе. Новый продукт ещё не в программе - IMP-152, как и задумано"""
    program_id = program_ref.get("id") if isinstance(program_ref, dict) else None
    if program_id is None:
        return
    program = an.snap.programs_by_id.get(program_id)
    if program is None or not program.is_active:
        ctx.add("IMP-152", "program")
        return
    if product_id is None or product_id not in {p.id for p in program.products}:
        ctx.add("IMP-152", "product")


def _resolve_branch_refs(an, ctx) -> tuple[Any, Any, Any] | None:
    """(vendor_ref, product_ref, program_ref) строки с продуктом; None -
    строки без продукта (не ветка)"""
    text = ctx.values.get("product")
    if not text:
        return None
    vendor_ref = _resolve_vendor(an, ctx)
    key = normalize.text_key(text)
    found = _existing_product(an, key, vendor_ref)
    new = analysis._new_ref(an, "product", key)
    if len(found) + (new is not None) > 1:
        ctx.add("IMP-111", "product")
        return None
    if found:
        product_ref = {"id": found[0].id}
    elif new:
        product_ref = new
    else:
        product_ref = None  # создаётся ниже, когда известна программа
    product_id = found[0].id if found else None
    program_ref = _resolve_program(an, ctx, product_id)
    if product_ref is None:
        directions = _program_direction(an, program_ref)
        if directions is None:
            # программа не разрешена или без направления - продукт не создать,
            # замечание уже поставлено _resolve_program/_program_direction
            return None
        part_key = analysis._key(key, vendor_ref)
        values = {"name": text, "vendor": vendor_ref, "directions": directions}
        part = analysis._add_part(an, ctx, "product", part_key, None, values)
        analysis._check(
            ctx, analysis.PARTS["product"], part, analysis.PARTS["product"].attrs
        )
        ctx.add("IMP-153", "product")
        product_ref = {"new_of_row": ctx.row.id, "part": "product"}
    if program_ref is not None:
        _check_pair(ctx, an, program_ref, product_id)
    return vendor_ref, product_ref, program_ref


_NAME_TOKEN = re.compile(r"[A-Za-zА-Яа-яЁё\-]+\.?$")


def _token_matches(token: str, full: str | None) -> bool:
    """полное слово - целиком, «И.» - по первой букве (§4.4, P1-10)"""
    if not full:
        return False
    if token.endswith("."):
        initial = normalize.text_key(token[:-1])
        return len(initial) == 1 and normalize.text_key(full)[:1] == initial
    return normalize.text_key(full) == normalize.text_key(token)


def _resolve_manager(an, text: str) -> tuple[str | None, list[dict], str | None]:
    """§16.9: формат, поиск без регистра и «ё». Возвращает (id, кандидаты, ошибка).

    Ищет среди всех пользователей (не только менеджеров), чтобы отличить
    «не найден» (IMP-004) от «найден, но не менеджер» (IMP-167, P1-10)"""
    text = text.strip()
    if "@" in text:
        matched = [
            u for u in an.snap.users if (u.email or "").lower() == text.lower()
        ]
    else:
        tokens = [p for p in text.replace(".", ". ").split() if p]
        if (
            not tokens
            or tokens[0].endswith(".")
            or any(not _NAME_TOKEN.fullmatch(t) for t in tokens)
        ):
            return None, [], "IMP-003"
        last = normalize.text_key(tokens[0])
        rest = tokens[1:]
        matched = [
            u
            for u in an.snap.users
            if normalize.text_key(u.last_name) == last
            and (
                not rest
                or _token_matches(rest[0], u.first_name)
                and (len(rest) == 1 or _token_matches(rest[1], u.patronymic))
            )
        ]
    if not matched:
        return None, [], "IMP-004"
    managers = [u for u in matched if isinstance(u, Manager)]
    if not managers:
        return None, [], "IMP-167"
    if len(managers) > 1:
        return (
            None,
            [{"id": m.id, "name": _manager_name(m)} for m in managers],
            "IMP-005",
        )
    return managers[0].id, [], None


def _manager_name(m) -> str:
    return " ".join(p for p in (m.last_name, m.first_name, m.patronymic) if p)


def _manager_fit(an, manager_id: str) -> bool:
    m = an.snap.managers_by_id.get(manager_id)
    if m is None or m.role.value != "manager":
        return False
    return not (
        not m.is_active
        or m.identity_sync_status != IdentitySyncStatus.OK
        or m.role_transition_status != RoleTransitionStatus.NONE
        or m.manual_workload_status != ManualWorkloadStatus.AVAILABLE
        or m.superviser_id is None
    )


def _check_field_consistency(group: list, key: str) -> None:
    """непустые значения group=True полей совпадают (§16.6)"""
    values = [
        (r, r.values.get(key)) for r in group if r.values.get(key) not in (None, "", [])
    ]
    if not values:
        return
    first_row, first_value = values[0]
    for row, value in values[1:]:
        if value != first_value:
            row.add("IMP-150", key, ref_row=first_row.row.number)
            first_row.add("IMP-150", key, ref_row=row.row.number)


def _pause_deadline(value: str) -> datetime:
    d = date.fromisoformat(value)
    start = datetime(d.year, d.month, d.day, tzinfo=BUSINESS_TZ)
    return start + timedelta(days=1)


def _within_pause_term(until: datetime) -> bool:
    hours = (until - datetime.now(UTC)).total_seconds() / 3600
    return MIN_PAUSE_HOURS <= hours <= MAX_PAUSE_HOURS


def _license_term(ctx, raw: str, signed: date | None) -> int | None:
    raw = raw.strip()
    if raw.isdigit() and len(raw) == 4:
        if signed is None:
            ctx.add("IMP-176", "license_term")
            return None
        years = int(raw) - signed.year
        if years <= 0:
            ctx.add("IMP-176", "license_term")
            return None
        return years
    if raw.isdigit() and 1 <= int(raw) <= 50:
        return int(raw)
    ctx.add("IMP-110", "license_term")
    return None


def _leads(an, source: int | None, dest: int | None) -> bool:
    if source is None or dest is None:
        return False
    facts = [
        EdgeFacts(e.from_stage_id, e.to_stage_id, e.is_irreversible, e.is_backward)
        for e in an.snap.edges
        if not e.is_backward
    ]
    return source == dest or leads_to(facts, source, dest)


async def run(session: AsyncSession, an, rows: list) -> None:
    if not rows:
        return
    groups: dict[str, list] = {}
    for ctx in rows:
        if ctx.row.excluded:
            continue
        text = ctx.values.get("university")
        if not text:
            continue
        try:
            ref, label = analysis._university_ref(an, text)
        except normalize.NotValid as err:
            ctx.add(err.code, "university")
            continue
        ctx.labels["university"] = label
        key = f"u:{ref['id']}" if "id" in ref else f"r:{ref['new_of_row']}"
        ctx.group_key = key
        groups.setdefault(key, []).append(ctx)

    for key, group in groups.items():
        plan = await _build_group(session, an, key, group)
        an.groups[key] = plan
        _finalize_status(group, plan)


async def _build_group(session: AsyncSession, an, key: str, group: list) -> GroupPlan:
    plan = GroupPlan(key=key, rows=list(group))
    first = group[0]
    ref, _ = analysis._university_ref(an, first.values.get("university"))
    plan.university_ref = ref
    plan.university_id = ref.get("id")

    for field_key in (
        "contract_number", "manager", "contacts", "status", "pause_until",
        "agreement_open", "agreement_since", "contract_extended_until",
        "contract_extended_at",
    ):  # fmt: skip
        _check_field_consistency(group, field_key)

    plan.contract_number = _first(group, "contract_number")
    plan.contract_signed_at = _date(_first(group, "contract_signed_at"))
    plan.contract_valid_until = _date(_first(group, "contract_valid_until"))
    plan.contract_extended_until = _date(_first(group, "contract_extended_until"))
    plan.contract_extended_at = _date(_first(group, "contract_extended_at"))
    plan.contacts_text = _first(group, "contacts")
    plan.comment = _first(group, "comment")
    plan.agreement_open = bool(_first(group, "agreement_open"))
    plan.agreement_since = _date(_first(group, "agreement_since"))
    pause_raw = _first(group, "pause_until")

    # менеджер (§16.9)
    manager_text = _first(group, "manager")
    manager_choice = next(
        (r.row.manager_choice for r in group if r.row.manager_choice), None
    )
    if manager_choice:
        plan.manager_id = manager_choice
    elif manager_text:
        manager_id, candidates, error = _resolve_manager(an, manager_text)
        if error:
            for r in group:
                r.add(error, "manager", candidates=candidates)
        else:
            plan.manager_id = manager_id

    # ветки: строки с продуктом
    for ctx in group:
        refs = _resolve_branch_refs(an, ctx)
        if refs is None:
            continue
        vendor_ref, product_ref, program_ref = refs
        b = BranchPlan(
            row=ctx,
            product_ref=product_ref,
            program_ref=program_ref,
            vendor_ref=vendor_ref,
        )
        b.since = _date(ctx.values.get("stage_since"))
        b.license_signed_at = _date(ctx.values.get("license_signed_at"))
        b.transfer_status = ctx.values.get("transfer_status")
        b.license_extended_until = _date(ctx.values.get("license_extended_until"))
        b.license_extended_at = _date(ctx.values.get("license_extended_at"))
        b.branch_paused = bool(ctx.values.get("branch_paused"))
        b.comment = ctx.values.get("comment")
        term_raw = ctx.values.get("license_term")
        if term_raw:
            b.license_term_years = _license_term(ctx, term_raw, b.license_signed_at)
        stage_text = ctx.values.get("stage")
        if stage_text:
            stage = _resolve_stage(an, ctx, stage_text)
            if stage is not None:
                b.stage_id = stage.id
                b.is_branch_stage = stage.is_branch_stage
        close_reason_text = ctx.values.get("close_reason")
        if close_reason_text:
            reason = an.snap.close_reasons.get(
                normalize.text_key(close_reason_text).upper()
            )
            b.refused = reason is not None
            b.close_reason_id = reason.id if reason else None
            if reason is None:
                ctx.add("IMP-110", "close_reason")
        pair = (
            program_ref.get("id")
            if isinstance(program_ref, dict)
            else json.dumps(program_ref, default=str),
            product_ref.get("id")
            if isinstance(product_ref, dict)
            else json.dumps(product_ref, default=str),
        )
        seen = {
            (
                x.program_ref.get("id")
                if isinstance(x.program_ref, dict)
                else json.dumps(x.program_ref, default=str),
                x.product_ref.get("id")
                if isinstance(x.product_ref, dict)
                else json.dumps(x.product_ref, default=str),
            )
            for x in plan.branches
        }
        if pair in seen:
            ctx.add("IMP-154", "product")
        plan.branches.append(b)

    _step_table(an, group, plan)
    _check_close(group, plan)
    _check_extra_fields(an, group, plan, pause_raw)

    if plan.manager_id:
        if not _manager_fit(an, plan.manager_id):
            first.add("IMP-168", "manager")
    elif plan.stage_id is not None or plan.contract_number:
        first.add("IMP-169", "manager")
    elif not manager_text:
        first.add("IMP-162", "manager")

    if plan.manager_id and plan.outcome != "SAME":
        used = an.snap.manager_load.get(plan.manager_id, 0)
        limit = an.snap.managers_by_id.get(plan.manager_id)
        limit = limit.max_active_projects if limit else 0
        if used >= limit:
            first.add("IMP-175", "manager", used=used, max=limit)
        an.snap.manager_load[plan.manager_id] = used + 1

    await _compare_with_db(session, an, plan)
    return plan


def _check_close(group: list, plan: GroupPlan) -> None:
    """В8: все ветки группы закрыты (завершена/отказ) -> заявка закрывается"""
    if not plan.branches or plan.stage_id is None:
        return
    if all(b.closed or b.refused for b in plan.branches):
        plan.close_by_all_branches = True


def _check_extra_fields(an, group: list, plan: GroupPlan, pause_raw) -> None:
    """§16.8"""
    if pause_raw:
        until = _pause_deadline(pause_raw)
        if (
            plan.stage_id is None
            or plan.close_by_all_branches
            or not _within_pause_term(until)
        ):
            group[0].add("IMP-170", "pause_until")
        else:
            plan.pause_until = until
    today = datetime.now(BUSINESS_TZ).date()
    if plan.agreement_open:
        if not plan.signed or plan.close_by_all_branches or an.snap.anchors.agr is None:
            group[0].add("IMP-172", "agreement_open")
        elif plan.agreement_since is not None and (
            plan.agreement_since > today
            or (
                plan.contract_signed_at
                and plan.agreement_since < plan.contract_signed_at
            )
        ):
            group[0].add("IMP-172", "agreement_since")
    if plan.contract_extended_until and (
        (not plan.contract_number and not plan.contract_valid_until)
        or (
            plan.contract_valid_until
            and plan.contract_extended_until <= plan.contract_valid_until
        )
    ):
        group[0].add("IMP-173", "contract_extended_until")
    for b in plan.branches:
        if b.branch_paused and (b.stage_id is None or b.closed or b.refused):
            b.row.add("IMP-171", "branch_paused")
        if b.license_extended_until and b.license_signed_at is None:
            b.row.add("IMP-174", "license_extended_until")
        if (
            b.license_extended_at
            and b.license_signed_at
            and b.license_extended_at < b.license_signed_at
        ):
            b.row.add("IMP-174", "license_extended_at")


def _step_table(an, group: list, plan: GroupPlan) -> None:
    """таблица §16.7"""
    anchors = an.snap.anchors
    ms = {
        b.stage_id
        for b in plan.branches
        if b.stage_id is not None and not b.is_branch_stage
    }
    bs_branches = [
        b for b in plan.branches if b.stage_id is not None and b.is_branch_stage
    ]
    bs = {b.stage_id for b in bs_branches}
    has_contract = bool(plan.contract_number) or bool(plan.contract_signed_at)

    for b in plan.branches:
        if (
            b.stage_id is not None
            and b.is_branch_stage
            and an.snap.stages[b.stage_id].is_terminal
        ):
            edges_in = [
                e
                for e in an.snap.edges
                if e.to_stage_id == b.stage_id
                and not e.is_backward
                and an.snap.stages.get(e.from_stage_id)
                and not an.snap.stages[e.from_stage_id].is_terminal
            ]
            if edges_in:
                b.closed = True
            elif b.close_reason_id is not None:
                b.refused = True
            else:
                b.row.add("IMP-163", "close_reason")

    if ms and bs:
        for r in group:
            r.add("IMP-156", "stage")
        return
    if len(ms) > 1:
        for r in group:
            r.add("IMP-157", "stage")
        return
    main_stage_id = next(iter(ms), None)
    if main_stage_id is not None and an.snap.stages[main_stage_id].is_terminal:
        for r in group:
            r.add("IMP-158", "stage")
        return

    no_branches = anchors.b0 is None
    if (has_contract or bs) and no_branches:
        plan.stage_id = main_stage_id or anchors.s0
        plan.signed = True
        plan.no_return = anchors.nr is not None and _leads(
            an, anchors.nr, plan.stage_id
        )
        return
    if (has_contract or bs) and not no_branches:
        if main_stage_id is not None and main_stage_id != anchors.seal:
            for r in group:
                r.add("IMP-159", "stage")
            return
        plan.stage_id = anchors.seal
        plan.signed = True
        plan.no_return = True
        for b in plan.branches:
            if b.stage_id is not None and b.is_branch_stage:
                continue
            if b.transfer_status == "TRANSFERRED":
                if anchors.b1 is None:
                    b.row.add("IMP-160", "transfer_status")
                else:
                    b.stage_id = anchors.b1
            else:
                b.stage_id = anchors.b0
        return
    if not bs and len(ms) == 1:
        plan.stage_id = main_stage_id
        return
    if not bs and not ms:
        plan.stage_id = None
        if not plan.manager_id and not _first(group, "manager"):
            pass  # IMP-162 - уже ставится в _build_group


async def _compare_with_db(session: AsyncSession, an, plan: GroupPlan) -> None:
    """§16.10 - открытая заявка вуза, иначе последняя закрытая с событием
    IMPORT (при закрытии группы по В8)"""
    if plan.university_id is None:
        plan.outcome = "NEW"
        return
    state = await an.snap.university_state(plan.university_id)
    if state.interaction is None:
        plan.outcome = "NEW"
        return
    if not state.is_open and not plan.close_by_all_branches:
        plan.outcome = "NEW"
        return
    interaction = state.interaction
    same_owner = interaction.owner_id == plan.manager_id
    same_stage = interaction.state_id == plan.stage_id
    existing_pairs = {(br.program_id, br.product_id) for br in state.branches}
    new_pairs = {
        (
            b.program_ref.get("id") if isinstance(b.program_ref, dict) else None,
            b.product_ref.get("id") if isinstance(b.product_ref, dict) else None,
        )
        for b in plan.branches
    }
    same_composition = new_pairs <= existing_pairs
    if same_owner and same_stage and same_composition:
        plan.outcome = "SAME"
        for r in plan.rows:
            r.status = RowStatus.SAME
        return
    if not state.is_open:
        plan.outcome = "NEW"
        return
    plan.outcome = "CONFLICT"
    code = (
        "IMP-180"
        if not same_owner
        else ("IMP-181" if not same_composition else "IMP-182")
    )
    for r in plan.rows:
        r.add(code, None)
    decision = next((r.row.decision for r in plan.rows if r.row.decision), None)
    if decision == "SKIP":
        plan.decision = "SKIP"
    elif decision == "REPLACE":
        fingerprint = _fingerprint(interaction, state.branches)
        stored = next(
            (r.row.replace_target for r in plan.rows if r.row.replace_target), None
        )
        if (
            stored
            and stored.get("interaction_id") == interaction.id
            and stored.get("fingerprint") == fingerprint
        ):
            plan.decision = "REPLACE"
            plan.replace_target = stored
        else:
            for r in plan.rows:
                r.add("IMP-186", None)


def _fingerprint(interaction, branches: list) -> str:
    payload = [
        interaction.state_id,
        interaction.owner_id,
        interaction.closed_at.isoformat() if interaction.closed_at else None,
        interaction.no_return_at.isoformat() if interaction.no_return_at else None,
        interaction.pause_state,
        sorted(
            (b.id, b.state_id, b.closed_at.isoformat() if b.closed_at else None)
            for b in branches
        ),
    ]
    raw = json.dumps(payload, ensure_ascii=False, sort_keys=True, default=str)
    return hashlib.sha256(raw.encode()).hexdigest()


def _finalize_status(group: list, plan: GroupPlan) -> None:
    """группа применяется целиком: одна E - все E (§16.6)"""
    errored = [r for r in group if r.failed]
    if errored:
        for r in group:
            r.status = RowStatus.ERROR
            if r not in errored:
                r.add("IMP-189", None, ref_row=errored[0].row.number)
        return
    conflicted = any("C" in {i["level"] for i in r.issues} for r in group)
    if conflicted and plan.decision is None:
        for r in group:
            r.status = RowStatus.CONFLICT
        return
    if plan.decision == "SKIP":
        # решённый конфликт - в применении не участвует, как SAME (M2)
        for r in group:
            r.status = RowStatus.SAME
        return
    for r in group:
        if plan.outcome == "SAME":
            r.status = RowStatus.SAME
        elif any(p.action == "NEW" for p in r.parts) or plan.outcome == "NEW":
            r.status = RowStatus.NEW
        else:
            r.status = RowStatus.UPDATE
