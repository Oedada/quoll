import logging

from sqlalchemy import ColumnElement, exists, func, select
from sqlalchemy.orm import selectinload

from quoll.auth.identity_policy import is_incapacitated
from quoll.auth.models import Manager, User
from quoll.core.base_repository import BaseRepository
from quoll.core.exceptions import IdNotExistsException
from quoll.interactions.access_policy import Ownership, author_gone
from quoll.interactions.capacity_policy import (
    blocking_filter_expression,
    capacity_count_stmt,
    open_projects_filter_expression,
)
from quoll.interactions.models import (
    Branch,
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
        # импорт знает только название: краткое или полное, неоднозначно - нет
        stmt = select(University).where(
            (University.short_name == name) | (University.full_name == name)
        )
        found = list(await self.session.scalars(stmt.limit(2)))
        return found[0] if len(found) == 1 else None


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
        program_id: int | None,
        status: list[str] | None = None,
        slot: str | None = None,
        outcome: list[str] | None = None,
        responsible_id: str | None = None,
        stage_id: int | None = None,
        q: str | None = None,
        limit: int,
        offset: int,
    ) -> tuple[list[Interaction], int]:
        """фильтры и видимость до пагинации, иначе страница приходит неполной.
        total - отдельным count по тем же условиям, без лишнего джойна"""
        stmt = select(Interaction).where(visibility)
        if university_id is not None:
            stmt = stmt.where(Interaction.university_id == university_id)
        if program_id is not None:
            stmt = stmt.where(
                exists().where(
                    Branch.interaction_id == Interaction.id,
                    Branch.program_id == program_id,
                )
            )
        if status:
            stmt = stmt.where(Interaction.status.in_(status))
        if slot is not None:
            stmt = stmt.where(Interaction.slot == slot)
        if outcome:
            stmt = stmt.where(Interaction.outcome.in_(outcome))
        if responsible_id is not None:
            stmt = stmt.where(Interaction.owner_id == responsible_id)
        if stage_id is not None:
            stmt = stmt.where(Interaction.state_id == stage_id)
        if q:
            pattern = f"%{q}%"
            stmt = stmt.where(
                exists().where(
                    University.id == Interaction.university_id,
                    University.short_name.ilike(pattern)
                    | University.full_name.ilike(pattern),
                )
            )
        total = await self.session.scalar(
            select(func.count()).select_from(stmt.subquery())
        )
        # id вторым ключом - при равном времени порядок страниц не плывёт
        page = (
            stmt.order_by(Interaction.created_at.desc(), Interaction.id.desc())
            .limit(limit)
            .offset(offset)
        )
        rows = list((await self.session.execute(page)).scalars().all())
        return rows, total or 0

    async def branches_by_interaction(
        self, interaction_ids: list[int]
    ) -> dict[int, list[Branch]]:
        """ветки состава пачкой на несколько заявок - для обогащения списка"""
        branches: dict[int, list[Branch]] = {i: [] for i in interaction_ids}
        for b in await self.session.scalars(
            select(Branch)
            .where(
                Branch.interaction_id.in_(interaction_ids),
                Branch.program_id.is_not(None),
            )
            .order_by(Branch.id)
        ):
            branches[b.interaction_id].append(b)
        return branches

    async def ownership(self, interaction: Interaction) -> Ownership:
        superviser_id, orphaned = None, False
        if interaction.owner_id is not None:
            superviser_id = await self.session.scalar(
                select(Manager.superviser_id).where(Manager.id == interaction.owner_id)
            )
            boss = (
                await self.session.get(User, superviser_id) if superviser_id else None
            )
            orphaned = is_incapacitated(boss)
        former = await self.session.scalars(
            select(InteractionAssignment.manager_id).where(
                InteractionAssignment.interaction_id == interaction.id,
                InteractionAssignment.manager_id.is_not(None),
            )
        )
        author = (
            await self.session.get(User, interaction.created_by)
            if interaction.created_by
            else None
        )
        return Ownership(
            interaction.owner_id,
            superviser_id,
            orphaned,
            frozenset(former),
            author_id=interaction.created_by,
            author_gone=author_gone(author),
            on_stage=interaction.state_id is not None,
            closed=interaction.closed_at is not None,
        )

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
            .where(Interaction.owner_id == manager_id, blocking_filter_expression())
        )
        return await self.session.scalar(stmt) or 0

    async def stats(
        self, visibility: ColumnElement[bool]
    ) -> tuple[dict[str, int], list[tuple[int, str, int]]]:
        """счётчики по статусам и по стадиям для дашбордов (п.5) - две
        группировки вместо вытягивания всех видимых заявок"""
        # group by по самому выражению status дал бы в Postgre "column must
        # appear in GROUP BY" - CASE считается дважды и не распознаётся как
        # одно и то же; подзапрос считает его один раз и отдаёт как колонку
        visible_status = (
            select(Interaction.status.label("status")).where(visibility).subquery()
        )
        by_status = dict(
            (
                await self.session.execute(
                    select(visible_status.c.status, func.count()).group_by(
                        visible_status.c.status
                    )
                )
            ).all()
        )
        by_stage = list(
            (
                await self.session.execute(
                    select(Interaction.state_id, Stage.name, func.count())
                    .join(Stage, Interaction.state_id == Stage.id)
                    .where(visibility)
                    .group_by(Interaction.state_id, Stage.name)
                )
            ).all()
        )
        return by_status, by_stage
