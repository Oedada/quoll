from typing import Annotated

from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession

from quoll.db import get_db_session
from quoll.workflows.repository import (
    AttachmentRepository,
    StageRepository,
    WorkflowRepository,
    WorkflowTransitionRepository,
)

SessionDep = Annotated[AsyncSession, Depends(get_db_session)]


def get_workflow_repo(session: SessionDep) -> WorkflowRepository:
    return WorkflowRepository(session)


def get_stage_repo(session: SessionDep) -> StageRepository:
    return StageRepository(session)


def get_transition_repo(session: SessionDep) -> WorkflowTransitionRepository:
    return WorkflowTransitionRepository(session)


def get_attachment_repo(session: SessionDep) -> AttachmentRepository:
    return AttachmentRepository(session)


WorkflowRepoDep = Annotated[WorkflowRepository, Depends(get_workflow_repo)]
StageRepoDep = Annotated[StageRepository, Depends(get_stage_repo)]
TransitionRepoDep = Annotated[
    WorkflowTransitionRepository, Depends(get_transition_repo)
]
AttachmentRepoDep = Annotated[AttachmentRepository, Depends(get_attachment_repo)]
