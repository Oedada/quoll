from datetime import datetime
from typing import Annotated, Literal

from pydantic import AfterValidator, ConfigDict, Field, model_validator

from quoll.attachments.schemas import AttachmentRead
from quoll.core.schemas import AppBaseModel


# Stage
class StageField(AppBaseModel):
    """поле шага: номер договора, срок лицензии, число обученных"""

    model_config = ConfigDict(extra="forbid")

    key: str = Field(pattern=r"^[a-z][a-z0-9_]{0,49}$")
    label: str = Field(min_length=1)
    type: Literal["string", "text", "date", "number", "bool"]
    required: bool = False
    # правку на пройденном шаге менеджером одобряет руководитель
    approval_after_pass: bool = False


def _unique_keys(fields: list[StageField] | None) -> list[StageField] | None:
    keys = [f.key for f in fields or []]
    if len(keys) != len(set(keys)):
        raise ValueError("Stage field keys must be unique")
    return fields


class StageBase(AppBaseModel):
    name: str
    description: str | None = None
    position: int = 0
    workflow_id: int
    # без дефолтов: иначе черновая стадия случайно начнёт занимать слот
    is_terminal: bool
    consumes_capacity: bool
    fields: Annotated[list[StageField], AfterValidator(_unique_keys)] = Field(
        default_factory=list
    )

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
    # поля шага меняются: правило «флаги не меняются» про слоты и закрытие
    fields: Annotated[list[StageField] | None, AfterValidator(_unique_keys)] = None

    @model_validator(mode="after")
    def _fields_not_null(self):
        if "fields" in self.model_fields_set and self.fields is None:
            raise ValueError("fields cannot be null, send [] to clear")
        return self


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
    requires_approval: bool = False
    reject_to_stage_id: int | None = None
    is_backward: bool = False
    is_irreversible: bool = False
    required_document_kinds: list[str] = Field(default_factory=list)


class WorkflowTransitionCreate(WorkflowTransitionBase):
    pass


class WorkflowTransitionUpdate(AppBaseModel):
    name: str | None = None
    from_stage_id: int | None = None
    to_stage_id: int | None = None
    is_active: bool | None = None

    @model_validator(mode="after")
    def _no_nulls_for_required(self):
        # явный null ушёл бы в NOT NULL и вернулся 409 вместо 422
        for field in (
            "name",
            "to_stage_id",
            "is_active",
            "requires_approval",
            "is_backward",
            "is_irreversible",
            "required_document_kinds",
        ):
            if field in self.model_fields_set and getattr(self, field) is None:
                raise ValueError(f"{field} cannot be null")
        return self

    comments: str | None = None
    requires_approval: bool | None = None
    reject_to_stage_id: int | None = None
    is_backward: bool | None = None
    is_irreversible: bool | None = None
    required_document_kinds: list[str] | None = None


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


class WorkflowChangeCreate(AppBaseModel):
    model_config = ConfigDict(extra="forbid")

    workflow_id: int
    text: str = Field(min_length=1)


class WorkflowChangeDecision(AppBaseModel):
    model_config = ConfigDict(extra="forbid")

    comment: str | None = None


class WorkflowChangeRead(AppBaseModel):
    id: int
    workflow_id: int
    requested_by: str | None
    text: str
    status: str
    decided_by: str | None
    decided_at: datetime | None
    decision_comment: str | None
    created_at: datetime
