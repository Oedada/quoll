"""Сколько заявок тянет менеджер."""

import logging

from sqlalchemy import ColumnElement, Select, and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from quoll.auth.models import (
    IdentitySyncStatus,
    Manager,
    ManualWorkloadStatus,
    RoleTransitionStatus,
)
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


def _assert_can_work(manager: Manager) -> None:
    """в строю: активен, без конфликта ролей, не в смене роли"""
    if not manager.is_active:
        raise ManagerNotActiveException(manager.id)
    if manager.identity_sync_status != IdentitySyncStatus.OK:
        raise ManagerNotActiveException(manager.id, "role mapping conflict")
    if manager.role_transition_status != RoleTransitionStatus.NONE:
        raise ManagerNotActiveException(manager.id, "role transition in progress")


async def _assert_has_capacity(
    session: AsyncSession, manager: Manager, delta_slots: int
) -> None:
    if delta_slots <= 0:
        return
    current = await session.scalar(capacity_count_stmt(manager.id)) or 0
    if current + delta_slots > manager.max_active_projects:
        raise CapacityExceededException(
            manager.id, current, delta_slots, manager.max_active_projects
        )


async def assert_can_take_new_work(
    session: AsyncSession, manager: Manager, delta_slots: int
) -> None:
    """менеджеру дают работу: назначение, переоткрытие, передача.

    available проверяется при любой дельте - паузную заявку тоже не отдают
    тому, кто просил не давать новых. Строка менеджера уже должна быть
    заблокирована, иначе между подсчётом и записью влезет кто-то ещё
    """
    _assert_can_work(manager)
    if manager.manual_workload_status != ManualWorkloadStatus.AVAILABLE:
        raise ManagerUnavailableException(manager.id)
    await _assert_has_capacity(session, manager, delta_slots)


async def assert_can_keep_working(
    session: AsyncSession, manager: Manager, delta_slots: int
) -> None:
    """менеджер двигает свою заявку: переход, снятие с паузы.

    unavailable тут не мешает - это «не давайте новых», а не «не трогайте
    мои». Строка менеджера уже должна быть заблокирована
    """
    _assert_can_work(manager)
    await _assert_has_capacity(session, manager, delta_slots)
