"""Операции над заявками. Пока только создание - владелец, стадия и пауза
приедут сюда же в 1.4"""

from sqlalchemy.ext.asyncio import AsyncSession

from quoll.core.exceptions import WorkflowNotPublishedException
from quoll.interactions.models import Interaction
from quoll.interactions.repository import InteractionRepository
from quoll.interactions.schemas import InteractionCreate
from quoll.workflows.repository import WorkflowRepository


async def create_interaction(
    session: AsyncSession, schema: InteractionCreate
) -> Interaction:
    """новая заявка рождается без владельца - назначает руководитель"""
    if schema.workflow_id is not None:
        workflow = await WorkflowRepository(session).get(schema.workflow_id)
        if not workflow.is_published:
            raise WorkflowNotPublishedException(workflow.id)
    return await InteractionRepository(session).create(schema)
