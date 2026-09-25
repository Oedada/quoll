# ОБРАЗЕЦ из тестов основной команды (они живут в отдельной ветке, которой у тебя нет).
# Скопируй в backend/tests_catalog/conftest.py (factories.py) и поправь импорты
# tests_stage1 -> tests_catalog. Каталог backend/tests/ занят .gitignore - не используй его.
# Запуск из backend/: uv run pytest tests_catalog -q  (нужен docker compose up -d)

"""Минимальные фабрики доменных объектов для тестов"""

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from quoll.auth.models import Admin, Manager, Superviser
from quoll.interactions.models import Interaction, University, Vendor
from quoll.workflows.models import Stage, Workflow, WorkflowTransition


def _uid() -> str:
    return str(uuid.uuid4())


async def make_superviser(session: AsyncSession, **kwargs) -> Superviser:
    superviser = Superviser(
        id=kwargs.pop("id", _uid()),
        first_name=kwargs.pop("first_name", "Sup"),
        last_name=kwargs.pop("last_name", "Ervisor"),
        is_active=kwargs.pop("is_active", True),
        **kwargs,
    )
    session.add(superviser)
    await session.flush()
    return superviser


async def make_manager(session: AsyncSession, **kwargs) -> Manager:
    manager = Manager(
        id=kwargs.pop("id", _uid()),
        first_name=kwargs.pop("first_name", "Man"),
        last_name=kwargs.pop("last_name", "Ager"),
        is_active=kwargs.pop("is_active", True),
        **kwargs,
    )
    session.add(manager)
    await session.flush()
    return manager


async def make_admin(session: AsyncSession, **kwargs) -> Admin:
    admin = Admin(
        id=kwargs.pop("id", _uid()),
        first_name=kwargs.pop("first_name", "Ad"),
        last_name=kwargs.pop("last_name", "Min"),
        is_active=kwargs.pop("is_active", True),
        **kwargs,
    )
    session.add(admin)
    await session.flush()
    return admin


async def make_workflow(session: AsyncSession, **kwargs) -> Workflow:
    workflow = Workflow(name=kwargs.pop("name", f"wf-{_uid()}"), **kwargs)
    session.add(workflow)
    await session.flush()
    return workflow


async def make_stage(
    session: AsyncSession,
    workflow: Workflow,
    *,
    is_terminal: bool = False,
    consumes_capacity: bool = True,
    **kwargs,
) -> Stage:
    stage = Stage(
        workflow_id=workflow.id,
        name=kwargs.pop("name", "stage"),
        is_terminal=is_terminal,
        consumes_capacity=consumes_capacity,
        **kwargs,
    )
    session.add(stage)
    await session.flush()
    return stage


async def make_interaction(
    session: AsyncSession, *, stage: Stage | None = None, **kwargs
) -> Interaction:
    """stage задаёт сразу и стадию, и воркфлоу: схема требует, чтобы они
    были согласованы. Отдельные state_id/workflow_id можно передать явно,
    чтобы проверить как раз рассогласованные случаи."""
    # вуз и вендора можно передать общие - иначе у каждой заявки свои
    university_id = kwargs.pop("university_id", None)
    vendor_id = kwargs.pop("vendor_id", None)
    if university_id is None:
        university = University(name=f"uni-{_uid()}")
        session.add(university)
        await session.flush()
        university_id = university.id
    if vendor_id is None:
        vendor = Vendor(name=f"vendor-{_uid()}")
        session.add(vendor)
        await session.flush()
        vendor_id = vendor.id

    if stage is not None:
        kwargs.setdefault("state_id", stage.id)
        kwargs.setdefault("workflow_id", stage.workflow_id)

    interaction = Interaction(university_id=university_id, vendor_id=vendor_id, **kwargs)
    session.add(interaction)
    await session.flush()
    return interaction


async def make_edge(
    session: AsyncSession,
    workflow: Workflow,
    from_stage: Stage | None,
    to_stage: Stage,
    **kwargs,
) -> WorkflowTransition:
    """ребро графа; from_stage=None - вход в начальную стадию"""
    edge = WorkflowTransition(
        workflow_id=workflow.id,
        from_stage_id=from_stage.id if from_stage else None,
        to_stage_id=to_stage.id,
        name=kwargs.pop("name", "переход"),
        **kwargs,
    )
    session.add(edge)
    await session.flush()
    return edge
