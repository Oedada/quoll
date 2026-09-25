import logging

from sqlalchemy import ColumnElement, func, select
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
    Interaction,
    InteractionAssignment,
    InteractionStageHistory,
    University,
    Vendor,
)
from quoll.interactions.schemas import (
    InteractionImport,
    InteractionImportAction,
    InteractionImportError,
    InteractionImportRow,
    InteractionImportValidationError,
)
from quoll.workflows.models import Stage, Workflow

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

    async def import_interactions(
        self,
        rows: dict[int, InteractionImport],
        dry_run: bool = False,
        workflow_id: int | None = None,
    ) -> dict[int, InteractionImportAction]:
        results: dict[int, InteractionImportAction] = {}
        for index, data in rows.items():
            results[index] = await self._import_one(data, dry_run, workflow_id)
        return results

    async def _import_one(
        self,
        data: InteractionImport,
        dry_run: bool = False,
        workflow_id: int | None = None,
    ) -> InteractionImportAction:
        workflow = await self.session.get(Workflow, workflow_id)
        if workflow is None:
            return self._row_error("workflow_id", "workflow not found", data)
        if not workflow.is_published:
            return self._row_error("workflow_id", "workflow is not published", data)

        university = await UniversityRepository(self.session).get_by_name(
            data.university_name
        )
        if university is None:
            return self._row_error("university_name", "university not found", data)

        vendor = await VendorRepository(self.session).get_by_name(data.vendor_name)
        if vendor is None:
            return self._row_error("vendor_name", "vendor not found", data)

        try:
            manager = await self._find_manager(data.manager_full_name)
        except ValueError:
            return self._row_error(
                "manager_full_name",
                "manager_full_name must be 'Last First Patronymic'",
                data,
            )
        if manager is None:
            return self._row_error("manager_full_name", "manager not found", data)

        stmt = select(Interaction).where(
            Interaction.university_id == university.id,
            Interaction.vendor_id == vendor.id,
            Interaction.it_program == data.it_program,
            Interaction.it_product == data.it_product,
        )
        existing = (await self.session.execute(stmt)).scalar_one_or_none()

        if existing is None or existing.workflow_id != workflow_id:
            action = "created"
            if not dry_run:
                await self.create(
                    {
                        "university_id": university.id,
                        "vendor_id": vendor.id,
                        "it_program": data.it_program,
                        "it_product": data.it_product,
                        "owner_id": manager.id,
                        "workflow_id": workflow_id,
                    }
                )
        else:
            action = "updated"
            if not dry_run:
                await self.update(
                    existing.id,
                    {
                        "it_program": data.it_program,
                        "it_product": data.it_product,
                        "owner_id": manager.id,
                    },
                )

        return InteractionImportAction(
            error=None, interaction_import=data, action=action
        )

    @staticmethod
    def _row_error(
        column: str, message: str, data: InteractionImport
    ) -> InteractionImportAction:
        return InteractionImportAction(
            error=InteractionImportValidationError(
                errors=[InteractionImportError(column=column, message=message)]
            ),
            interaction_import=data,
            action=None,
        )

    async def _find_manager(self, full_name: str) -> Manager | None:
        parts = full_name.split()
        if len(parts) != 3:
            raise ValueError(
                f"manager_full_name must be 'Last First Patronymic', got '{full_name}'"
            )
        last_name, first_name, patronymic = parts
        stmt = select(Manager).where(
            Manager.last_name == last_name,
            Manager.first_name == first_name,
            Manager.patronymic == patronymic,
        )
        return (await self.session.execute(stmt)).scalar_one_or_none()

