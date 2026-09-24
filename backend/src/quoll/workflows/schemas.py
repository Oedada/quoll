from datetime import datetime

from pydantic import ConfigDict, Field, model_validator

from quoll.attachments.schemas import AttachmentRead
from quoll.core.schemas import AppBaseModel


# Stage
class StageBase(AppBaseModel):
    name: str
    description: str | None = None
    position: int = 0
    workflow_id: int
    # без дефолтов: иначе черновая стадия случайно начнёт занимать слот
    is_terminal: bool
    consumes_capacity: bool

    @model_validator(mode="after")
    def check_terminal_semantics(self):
        if self.is_terminal and self.consumes_capacity:
            raise ValueError(
                "Terminal stage cannot consume capacity: "
                "consumes_capacity must be False when is_terminal is True"
            )
        return self


class StageCreate(StageBase):
    pass


class StageUpdate(AppBaseModel):
    # флаги стадии после создания не меняются, поэтому их тут нет вовсе
    model_config = ConfigDict(extra="forbid")

    name: str | None = None
    description: str | None = None
    position: int | None = None


class StageRead(StageBase):
    id: int
    archived_at: datetime | None = None
    created_at: datetime
    updated_at: datetime


class StageArchiveRequest(AppBaseModel):
    model_config = ConfigDict(extra="forbid")

    # куда переехать заявкам; по умолчанию - предыдущая действующая стадия
    relocate_to_stage_id: int | None = None


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
    is_published: bool
    created_at: datetime
    updated_at: datetime


class WorkflowDetailRead(WorkflowRead):
    stages: list[StageRead] = Field(default_factory=list)
    transitions: list[WorkflowTransitionRead] = Field(default_factory=list)


class StartStageRequest(AppBaseModel):
    model_config = ConfigDict(extra="forbid")

    stage_id: int
