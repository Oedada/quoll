from datetime import datetime

from pydantic import Field

from quoll.core.schemas import AppBaseModel


# Attachment
class AttachmentBase(AppBaseModel):
    filename: str
    mime_type: str
    preview: str | None = None
    transition_id: int | None = None


class AttachmentCreate(AttachmentBase):
    pass


class AttachmentRead(AttachmentBase):
    id: int
    created_at: datetime
    updated_at: datetime


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


class WorkflowTransitionDetailRead(WorkflowTransitionRead):
    attachments: list[AttachmentRead] = Field(default_factory=list)


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
    transitions: list[WorkflowTransitionDetailRead] = Field(default_factory=list)
