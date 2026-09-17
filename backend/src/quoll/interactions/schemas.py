from datetime import datetime
from typing import Any

from pydantic import Field

from quoll.core.schemas import AppBaseModel
from quoll.workflows.schemas import StageRead, WorkflowRead


# University
class UniversityBase(AppBaseModel):
    name: str
    contacts: dict[str, Any] = Field(default_factory=dict)


class UniversityCreate(UniversityBase):
    pass


class UniversityUpdate(AppBaseModel):
    name: str | None = None
    contacts: dict[str, Any] | None = None


class UniversityRead(UniversityBase):
    id: int
    created_at: datetime
    updated_at: datetime


# Vendor 
class VendorBase(AppBaseModel):
    name: str
    contacts: dict[str, Any] = Field(default_factory=dict)


class VendorCreate(VendorBase):
    pass


class VendorUpdate(AppBaseModel):
    name: str | None = None
    contacts: dict[str, Any] | None = None


class VendorRead(VendorBase):
    id: int
    created_at: datetime
    updated_at: datetime


#Interaction 
class InteractionBase(AppBaseModel):
    university_id: int
    vendor_id: int
    it_program: str | None = None
    it_product: str | None = None
    workflow_id: int | None = None
    state_id: int | None = None
    history: list[dict[str, Any]] = Field(default_factory=list)
    owner_id: str | None = None


class InteractionCreate(InteractionBase):
    pass


class InteractionUpdate(AppBaseModel):
    university_id: int | None = None
    vendor_id: int | None = None
    it_program: str | None = None
    it_product: str | None = None
    workflow_id: int | None = None
    state_id: int | None = None
    history: list[dict[str, Any]] | None = None
    owner_id: str | None = None


class InteractionRead(InteractionBase):
    id: int
    created_at: datetime
    updated_at: datetime


class InteractionDetailRead(InteractionRead):
    university: UniversityRead
    vendor: VendorRead
    workflow: WorkflowRead | None = None
    state: StageRead | None = None
