"""Правка графа воркфлоу. Пока одно правило - остальные приедут в блоке C"""

from sqlalchemy.ext.asyncio import AsyncSession

from quoll.core.exceptions import PublishedGraphChangeException
from quoll.workflows.models import WorkflowTransition
from quoll.workflows.repository import (
    WorkflowRepository,
    WorkflowTransitionRepository,
)
from quoll.workflows.schemas import WorkflowTransitionUpdate

# концы ребра - то, на что ссылается история переходов заявок
_EDGE_ENDS = frozenset({"from_stage_id", "to_stage_id"})


async def update_transition(
    session: AsyncSession, transition_id: int, changes: WorkflowTransitionUpdate
) -> WorkflowTransition:
    """у опубликованного воркфлоу концы ребра не перевешиваются: история
    ссылается на ребро, и оно стало бы значить другое. Деактивировать и
    создать новое"""
    transitions = WorkflowTransitionRepository(session)
    transition = await transitions.get(transition_id)
    moved = _EDGE_ENDS & changes.model_dump(exclude_unset=True).keys()
    if moved:
        workflow = await WorkflowRepository(session).get(transition.workflow_id)
        if workflow.is_published:
            raise PublishedGraphChangeException(sorted(moved))
    return await transitions.update(transition_id, changes)
