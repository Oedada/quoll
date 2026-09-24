from typing import Annotated

from fastapi import Depends

from quoll.db import SessionDep
from quoll.workflows.repository import (
    StageRepository,
    WorkflowRepository,
    WorkflowTransitionRepository,
)


def get_workflow_repo(session: SessionDep) -> WorkflowRepository:
    return WorkflowRepository(session)


def get_stage_repo(session: SessionDep) -> StageRepository:
    return StageRepository(session)


def get_transition_repo(session: SessionDep) -> WorkflowTransitionRepository:
    return WorkflowTransitionRepository(session)


WorkflowRepoDep = Annotated[WorkflowRepository, Depends(get_workflow_repo)]
StageRepoDep = Annotated[StageRepository, Depends(get_stage_repo)]
TransitionRepoDep = Annotated[
    WorkflowTransitionRepository, Depends(get_transition_repo)
]
