import logging

from sqlalchemy import ColumnElement, func, or_, select
from sqlalchemy.orm import selectinload

from quoll.auth.models import Manager
from quoll.core.base_repository import BaseRepository
from quoll.core.exceptions import IdNotExistsException
from quoll.interactions.access_policy import Ownership
from quoll.interactions.capacity_policy import (
    capacity_count_stmt,
    open_projects_filter_expression,
)
from quoll.interactions.models import (
    Interaction,
    InteractionAssignment,
    InteractionStageHistory,
    University,
    Vendor,
)
from quoll.workflows.models import Stage

logger = logging.getLogger(__name__)


class UniversityRepository(BaseRepository[University]):
    model = University

    async def get_by_name(self, name: str) -> University | None:
        logger.debug(f"Getting University by name={name}")
        stmt = select(University).where(University.name == name)
        res = await self.session.execute(stmt)
        return res.scalar_one_or_none()


class VendorRepository(BaseRepository[Vendor]):
    model = Vendor

    async def get_by_name(self, name: str) -> Vendor | None:
        logger.debug(f"Getting Vendor by name={name}")
        stmt = select(Vendor).where(Vendor.name == name)
        res = await self.session.execute(stmt)
        return res.scalar_one_or_none()


class InteractionRepository(BaseRepository[Interaction]):
    model = Interaction

    async def get_with_details(self, interaction_id: int) -> Interaction:
        logger.debug(f"Getting Interaction with details, id={interaction_id}")
        stmt = (
            select(Interaction)
            .where(Interaction.id == interaction_id)
            .options(
                selectinload(Interaction.university),
                selectinload(Interaction.vendor),
                selectinload(Interaction.workflow),
                selectinload(Interaction.state),
            )
        )
        res = await self.session.execute(stmt)
        interaction = res.scalar_one_or_none()
        if interaction is None:
            logger.warning(f"Interaction with id={interaction_id} not found")
            raise IdNotExistsException(Interaction.__name__)
        logger.debug(f"Interaction with id={interaction_id} and details found")
        return interaction

    async def list_visible(
        self,
        visibility: ColumnElement[bool],
        *,
        university_id: int | None,
        vendor_id: int | None,
        limit: int,
        offset: int,
    ) -> list[Interaction]:
        """одним запросом - фильтры и видимость до пагинации, иначе страница
        приходит неполной"""
        stmt = select(Interaction).where(visibility)
        if university_id is not None:
            stmt = stmt.where(Interaction.university_id == university_id)
        if vendor_id is not None:
            stmt = stmt.where(Interaction.vendor_id == vendor_id)
        # id вторым ключом - при равном времени порядок страниц не плывёт
        stmt = (
            stmt.order_by(Interaction.created_at.desc(), Interaction.id.desc())
            .limit(limit)
            .offset(offset)
        )
        return list((await self.session.execute(stmt)).scalars().all())

    async def ownership(self, interaction: Interaction) -> Ownership:
        superviser_id = None
        if interaction.owner_id is not None:
            superviser_id = await self.session.scalar(
                select(Manager.superviser_id).where(Manager.id == interaction.owner_id)
            )
        former = await self.session.scalars(
            select(InteractionAssignment.manager_id).where(
                InteractionAssignment.interaction_id == interaction.id,
                InteractionAssignment.manager_id.is_not(None),
            )
        )
        return Ownership(interaction.owner_id, superviser_id, frozenset(former))

    async def stage_history(self, interaction_id: int) -> list[InteractionStageHistory]:
        stmt = (
            select(InteractionStageHistory)
            .where(InteractionStageHistory.interaction_id == interaction_id)
            .order_by(InteractionStageHistory.created_at, InteractionStageHistory.id)
        )
        return list((await self.session.execute(stmt)).scalars().all())

    async def assignments(self, interaction_id: int) -> list[InteractionAssignment]:
        stmt = (
            select(InteractionAssignment)
            .where(InteractionAssignment.interaction_id == interaction_id)
            .order_by(InteractionAssignment.assigned_at, InteractionAssignment.id)
        )
        return list((await self.session.execute(stmt)).scalars().all())

    async def count_capacity_projects(self, manager_id: str) -> int:
        """сколько слотов занято прямо сейчас"""
        return await self.session.scalar(capacity_count_stmt(manager_id)) or 0

    async def count_open_projects(self, manager_id: str) -> int:
        """незакрытые заявки, включая поставленные на паузу"""
        stmt = (
            select(func.count())
            .select_from(Interaction)
            .join(Stage, Interaction.state_id == Stage.id)
            .where(
                Interaction.owner_id == manager_id, open_projects_filter_expression()
            )
        )
        return await self.session.scalar(stmt) or 0

    async def count_owned_nonterminal_interactions(self, manager_id: str) -> int:
        """всё, что мешает отпустить менеджера: незакрытые заявки и черновики.

        пока не ноль - нельзя ни открепить от руководителя, ни сменить роль
        """
        stmt = (
            select(func.count())
            .select_from(Interaction)
            .outerjoin(Stage, Interaction.state_id == Stage.id)
            .where(
                Interaction.owner_id == manager_id,
                or_(Interaction.state_id.is_(None), Stage.is_terminal.is_(False)),
            )
        )
        return await self.session.scalar(stmt) or 0
