import logging

from sqlalchemy import select
from sqlalchemy.orm import selectinload

from quoll.core.base_repository import BaseRepository
from quoll.core.exceptions import IdNotExistsException
from quoll.workflows.models import Attachment, Stage, Workflow, WorkflowTransition

logger = logging.getLogger(__name__)


class WorkflowRepository(BaseRepository[Workflow]):
    model = Workflow

    async def get_with_details(self, workflow_id: int) -> Workflow:
        logger.debug(f"Getting {self.model.__name__} with details, id={workflow_id}")
        stmt = (
            select(Workflow)
            .where(Workflow.id == workflow_id)
            .options(
                selectinload(Workflow.stages),
                selectinload(Workflow.transitions).selectinload(
                    WorkflowTransition.attachments
                ),
            )
        )
        res = await self.session.execute(stmt)
        workflow = res.scalar_one_or_none()
        if workflow is None:
            logger.warning(f"{self.model.__name__} with id={workflow_id} not found")
            raise IdNotExistsException(Workflow.__name__)
        logger.debug(f"{self.model.__name__} with id={workflow_id} and details found")
        return workflow


class StageRepository(BaseRepository[Stage]):
    model = Stage

    async def get_by_workflow_id(self, workflow_id: int) -> list[Stage]:
        logger.debug(f"Getting stages for workflow_id={workflow_id}")
        stmt = (
            select(Stage)
            .where(Stage.workflow_id == workflow_id)
            .order_by(Stage.position)
        )
        res = await self.session.execute(stmt)
        return list(res.scalars().all())


class WorkflowTransitionRepository(BaseRepository[WorkflowTransition]):
    model = WorkflowTransition

    async def get_available_transitions(
        self, workflow_id: int, from_stage_id: int | None
    ) -> list[WorkflowTransition]:
        logger.debug(
            f"Getting transitions for workflow_id={workflow_id}, from_stage_id={from_stage_id}"
        )
        stmt = (
            select(WorkflowTransition)
            .where(
                WorkflowTransition.workflow_id == workflow_id,
                WorkflowTransition.from_stage_id == from_stage_id,
                WorkflowTransition.is_active.is_(True),
            )
            .options(selectinload(WorkflowTransition.attachments))
        )
        res = await self.session.execute(stmt)
        return list(res.scalars().all())


class AttachmentRepository(BaseRepository[Attachment]):
    model = Attachment

    async def get_by_transition_id(self, transition_id: int) -> list[Attachment]:
        logger.debug(f"Getting attachments for transition_id={transition_id}")
        stmt = select(Attachment).where(Attachment.transition_id == transition_id)
        res = await self.session.execute(stmt)
        return list(res.scalars().all())
