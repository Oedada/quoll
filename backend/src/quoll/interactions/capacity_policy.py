"""Сколько заявок тянет менеджер."""

import logging

from sqlalchemy import ColumnElement, Select, and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from quoll.auth.models import Manager, ManualWorkloadStatus
from quoll.core.exceptions import (
    CapacityExceededException,
    ManagerNotActiveException,
    ManagerUnavailableException,
)
from quoll.interactions.models import Interaction
from quoll.workflows.models import Stage

logger = logging.getLogger(__name__)


def counts_toward_capacity(stage: Stage | None, is_paused: bool) -> bool:
    """занимает ли заявка слот менеджера.

    черновик без стадии, закрытая заявка и заявка на паузе слот не занимают
    """
    return (
        stage is not None
        and not stage.is_terminal
        and stage.consumes_capacity
        and not is_paused
    )


def is_open_project(stage: Stage | None) -> bool:
    """открыта ли заявка. пауза не закрывает - т.е. всё ещё мешает
    открепить менеджера"""
    return stage is not None and not stage.is_terminal


# те же правила, но для SQL


def capacity_filter_expression() -> ColumnElement[bool]:
    return and_(
        Stage.is_terminal.is_(False),
        Stage.consumes_capacity.is_(True),
        Interaction.is_paused.is_(False),
    )


def open_projects_filter_expression() -> ColumnElement[bool]:
    return Stage.is_terminal.is_(False)


def capacity_count_stmt(manager_id: str) -> Select[tuple[int]]:
    return (
        select(func.count())
        .select_from(Interaction)
        .join(Stage, Interaction.state_id == Stage.id)
        .where(Interaction.owner_id == manager_id, capacity_filter_expression())
    )


async def validate_capacity_transition(
    session: AsyncSession, manager: Manager, delta_slots: int
) -> None:
    """проверка перед тем, как повесить на менеджера ещё заявку.

    строка менеджера к этому моменту должна быть уже залокана, иначе
    между подсчётом и записью влезет кто-то ещё
    """
    if delta_slots <= 0:
        return
    if not manager.is_active:
        raise ManagerNotActiveException(manager.id)
    if manager.manual_workload_status != ManualWorkloadStatus.AVAILABLE:
        raise ManagerUnavailableException(manager.id)

    current = await session.scalar(capacity_count_stmt(manager.id)) or 0
    if current + delta_slots > manager.max_active_projects:
        raise CapacityExceededException(
            manager.id, current, delta_slots, manager.max_active_projects
        )
    logger.debug(
        f"Capacity check passed for manager={manager.id}: "
        f"{current}+{delta_slots}<={manager.max_active_projects}"
    )
