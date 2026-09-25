"""Перенос реестра взаимодействий из xls/xlsx.

строка заводит взаимодействие и назначает его менеджеру теми же сервисами,
что и ручная работа: блокировки, история назначений и журнал те же. Заявку
потом принимает сам менеджер - слот займётся тогда же. Уже заведённое не
трогается: переназначать импортом нельзя
"""

from io import BytesIO
from typing import Any

import pandas as pd
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from quoll.auth.models import Manager
from quoll.core.exceptions import AppException, WorkflowNotPublishedException
from quoll.interactions import project_service
from quoll.interactions.models import Interaction
from quoll.interactions.repository import UniversityRepository, VendorRepository
from quoll.interactions.schemas import (
    InteractionCreate,
    InteractionImport,
    InteractionImportAction,
    InteractionImportError,
    InteractionImportResult,
    InteractionImportValidationError,
)
from quoll.interactions.scope import lock_interaction_scope
from quoll.workflows.repository import WorkflowRepository


class RowError(Exception):
    def __init__(self, column: str, message: str):
        self.error = InteractionImportValidationError(
            errors=[InteractionImportError(column=column, message=message)]
        )


def read_rows(content: bytes, filename: str | None) -> list[dict[str, Any]]:
    """строки таблицы; движок по расширению: .xlsx - openpyxl, .xls - xlrd"""
    name = (filename or "").lower()
    if name.endswith(".xlsx"):
        engine = "openpyxl"
    elif name.endswith(".xls"):
        engine = "xlrd"
    else:
        raise ValueError("Unsupported format, expected .xls or .xlsx")
    df = pd.read_excel(BytesIO(content), engine=engine)
    return df.where(pd.notnull(df), "").to_dict(orient="records")


async def import_rows(
    session: AsyncSession,
    rows: list[dict[str, Any]],
    *,
    workflow_id: int,
    actor_id: str,
    dry_run: bool,
) -> InteractionImportResult:
    workflow = await WorkflowRepository(session).get(workflow_id)
    if not workflow.is_published:
        raise WorkflowNotPublishedException(workflow_id)

    errors: dict[int, InteractionImportValidationError] = {}
    imported: dict[int, InteractionImportAction] = {}
    for number, raw in enumerate(rows, start=1):
        try:
            data = InteractionImport.model_validate(raw)
        except ValidationError as e:
            errors[number] = InteractionImportValidationError.from_validation_error(e)
            continue
        # строка - своя точка сохранения: упавшая не оставляет следов
        attempt = await session.begin_nested()
        try:
            action = await _import_one(session, data, workflow_id, actor_id, dry_run)
        except RowError as e:
            await attempt.rollback()
            errors[number] = e.error
        except AppException as e:
            await attempt.rollback()
            errors[number] = RowError("row", e.message).error
        else:
            if dry_run:
                await attempt.rollback()
            else:
                await attempt.commit()
            imported[number] = InteractionImportAction(
                interaction_import=data, action=action
            )
    return InteractionImportResult(errors=errors, imported=imported)


async def _import_one(
    session: AsyncSession,
    data: InteractionImport,
    workflow_id: int,
    actor_id: str,
    dry_run: bool,
) -> str:
    university = await UniversityRepository(session).get_by_name(data.university_name)
    if university is None:
        raise RowError("university_name", "university not found")
    vendor = await VendorRepository(session).get_by_name(data.vendor_name)
    if vendor is None:
        raise RowError("vendor_name", "vendor not found")
    manager_id = await _find_manager(session, data.manager_full_name)

    existing = await session.scalar(
        select(Interaction.id).where(
            Interaction.university_id == university.id,
            Interaction.vendor_id == vendor.id,
            Interaction.it_program == data.it_program,
            Interaction.it_product == data.it_product,
        )
    )
    if existing is not None:
        return "skipped"
    if dry_run:
        return "created"

    interaction = await project_service.create_interaction(
        session,
        InteractionCreate(
            university_id=university.id,
            vendor_id=vendor.id,
            it_program=data.it_program,
            it_product=data.it_product,
            workflow_id=workflow_id,
        ),
        author_id=actor_id,
    )
    scope = await lock_interaction_scope(
        session, interaction.id, actor_id, target_manager_ids=[manager_id]
    )
    await project_service.assign_locked(
        session,
        scope,
        manager_id=manager_id,
        expected_owner_id=None,
        reason="import",
        by_import=True,
    )
    return "created"


async def _find_manager(session: AsyncSession, full_name: str) -> str:
    """«Фамилия Имя [Отчество]»; однофамильцев не угадываем"""
    parts = full_name.split()
    if len(parts) not in (2, 3):
        raise RowError(
            "manager_full_name", "expected 'Last First' or 'Last First Patronymic'"
        )
    stmt = select(Manager.id).where(
        Manager.last_name == parts[0],
        Manager.first_name == parts[1],
        Manager.patronymic == (parts[2] if len(parts) == 3 else ""),
    )
    found = list(await session.scalars(stmt.limit(2)))
    if not found:
        raise RowError("manager_full_name", "manager not found")
    if len(found) > 1:
        raise RowError("manager_full_name", "several managers have this name")
    return found[0]
