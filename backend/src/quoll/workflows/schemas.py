from datetime import datetime

from pydantic import Field

from quoll.attachments.schemas import AttachmentRead
from quoll.core.schemas import AppBaseModel


# Stage
class StageBase(AppBaseModel):
    name: str
    description: str | None = None
    position: int = 0
    workflow_id: int


class StageCreate(StageBase):
    pass


class StageUpdate(AppBaseModel):
    name: str | None = None
    description: str | None = None
    position: int | None = None


class StageRead(StageBase):
    id: int
    created_at: datetime
    updated_at: datetime


# WorkflowTransition
class WorkflowTransitionBase(AppBaseModel):
    name: str
    workflow_id: int
    from_stage_id: int | None = None
    to_stage_id: int
    is_active: bool = True
    comments: str | None = None
    required_actions: list[str] = Field(default_factory=list)


class WorkflowTransitionCreate(WorkflowTransitionBase):
    pass


class WorkflowTransitionUpdate(AppBaseModel):
    name: str | None = None
    from_stage_id: int | None = None
    to_stage_id: int | None = None
    is_active: bool | None = None
    comments: str | None = None
    required_actions: list[str] | None = None


class WorkflowTransitionRead(WorkflowTransitionBase):
    id: int
    created_at: datetime
    updated_at: datetime
    attachments: list[AttachmentRead] = Field(default_factory=list)


WorkflowTransitionDetailRead = WorkflowTransitionRead


# Workflow
class WorkflowBase(AppBaseModel):
    name: str
    description: str | None = None


class WorkflowCreate(WorkflowBase):
    pass


class WorkflowUpdate(AppBaseModel):
    name: str | None = None
    description: str | None = None


class WorkflowRead(WorkflowBase):
    id: int
    created_at: datetime
    updated_at: datetime


class WorkflowDetailRead(WorkflowRead):
    stages: list[StageRead] = Field(default_factory=list)
    transitions: list[WorkflowTransitionRead] = Field(default_factory=list)
