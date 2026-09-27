"""Привязка поля шага к явной колонке (10.2/3): отчёты, импорт и интеграции
читают колонку, а подпись поля админ может менять как угодно.

колонка - истина: значение пишется в неё и читается из неё, в значениях
шага остаётся копия для формы. Договорные поля живут в текущей версии
документа-договора (П10), поля ветки - в самой ветке
"""

from datetime import date, datetime
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from quoll.core.exceptions import DomainRuleException
from quoll.interactions.models import (
    Branch,
    DocumentStatus,
    InteractionDocument,
    TransferStatus,
)
from quoll.workflows.models import Stage

# привязка -> (чья колонка, колонка, тип поля)
BINDINGS: dict[str, tuple[str, str, str]] = {
    "contract.number": ("contract", "contract_number", "string"),
    "contract.signed_at": ("contract", "contract_signed_at", "date"),
    "contract.valid_until": ("contract", "contract_valid_until", "date"),
    "branch.license_signed_at": ("branch", "license_signed_at", "date"),
    "branch.license_term_years": ("branch", "license_term_years", "number"),
    "branch.transfer_status": ("branch", "transfer_status", "string"),
    "branch.teachers_trained": ("branch", "teachers_trained", "number"),
}


async def current_contract(
    session: AsyncSession, interaction_id: int
) -> InteractionDocument | None:
    """последняя действующая версия договора без действующей преемницы"""
    from quoll.interactions.document_service import replaced_expression

    return await session.scalar(
        select(InteractionDocument)
        .where(
            InteractionDocument.interaction_id == interaction_id,
            InteractionDocument.kind == "CONTRACT",
            InteractionDocument.status == DocumentStatus.ACTIVE,
            ~replaced_expression(),
        )
        .order_by(InteractionDocument.id.desc())
        .limit(1)
    )


def _bound(stage: Stage) -> dict[str, str]:
    return {f["key"]: f["bind"] for f in stage.fields if f.get("bind")}


async def _owner(
    session: AsyncSession, level: str, interaction_id: int, branch_id: int | None
):
    if level == "branch":
        return await session.get(Branch, branch_id)
    return await current_contract(session, interaction_id)


async def read_bound(
    session: AsyncSession, stage: Stage, interaction_id: int, branch_id: int | None
) -> dict[str, Any]:
    """значения привязанных полей из колонок; без договора - ничего"""
    result = {}
    for key, bind in _bound(stage).items():
        level, column, _ = BINDINGS[bind]
        owner = await _owner(session, level, interaction_id, branch_id)
        if owner is not None:
            value = getattr(owner, column)
            result[key] = value.isoformat() if isinstance(value, date) else value
    return result


async def write_bound(
    session: AsyncSession,
    stage: Stage,
    interaction_id: int,
    branch_id: int | None,
    values: dict[str, Any],
) -> None:
    """действующие значения шага - в колонки"""
    touched = set()
    for key, bind in _bound(stage).items():
        if key not in values:
            continue
        level, column, kind = BINDINGS[bind]
        owner = await _owner(session, level, interaction_id, branch_id)
        if owner is None:
            raise DomainRuleException(409, "Upload the contract before its details")
        value = values[key]
        if kind == "date" and value is not None:
            value = date.fromisoformat(value)
        if column == "contract_number" and not value:
            raise DomainRuleException(422, "Contract needs a number")
        if column == "transfer_status" and value not in set(TransferStatus):
            raise DomainRuleException(422, f"Unknown transfer status '{value}'")
        setattr(owner, column, value)
        touched.add(owner)
    for owner in touched:
        if isinstance(owner, Branch):
            _derive_license(owner)
        else:
            check_contract_dates(owner.contract_signed_at, owner.contract_valid_until)


def _derive_license(branch: Branch) -> None:
    """действует до = подписание + срок (10.2/3)"""
    signed, years = branch.license_signed_at, branch.license_term_years
    check_signed_date(signed)
    if years is not None and years <= 0:
        raise DomainRuleException(422, "License term is a positive number of years")
    if signed is not None and years is not None:
        branch.license_until = _add_years(signed, int(years))


def _add_years(start: date, years: int) -> date:
    try:
        return start.replace(year=start.year + years)
    except ValueError:  # 29 февраля в невисокосный год
        return start.replace(year=start.year + years, day=28)


# даты договоров - по календарю заказчика
BUSINESS_TZ = ZoneInfo("Europe/Moscow")


def check_signed_date(signed: date | None) -> None:
    if signed is not None and signed > datetime.now(BUSINESS_TZ).date():
        raise DomainRuleException(422, "Signing date cannot be in the future")


def check_contract_dates(signed: date | None, valid_until: date | None) -> None:
    """системные проверки дат (О 6)"""
    check_signed_date(signed)
    if signed is not None and valid_until is not None and valid_until <= signed:
        raise DomainRuleException(422, "Contract must be valid after its signing")
