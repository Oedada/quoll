from datetime import datetime
from typing import Any

from pydantic import ConfigDict, Field

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


# Interaction
class InteractionCreate(AppBaseModel):
    # лишнее поле - 422, а не молчаливый игнор: иначе PATCH с owner_id
    # ответит 200 и ничего не сделает
    model_config = ConfigDict(extra="forbid")

    university_id: int
    vendor_id: int
    it_program: str | None = None
    it_product: str | None = None
    # только опубликованный - по черновику графа заявке ехать нельзя
    workflow_id: int | None = None


class InteractionUpdate(AppBaseModel):
    """владелец, стадия и воркфлоу меняются только операциями над заявкой"""

    model_config = ConfigDict(extra="forbid")

    university_id: int | None = None
    vendor_id: int | None = None
    it_program: str | None = None
    it_product: str | None = None


class AssignRequest(AppBaseModel):
    model_config = ConfigDict(extra="forbid")

    manager_id: str
    # обязательно, но может быть null - «ожидаю, что владельца нет».
    # Отсутствие поля - 422, чтобы «забыл передать» не стало «владельца нет»
    expected_owner_id: str | None
    reason: str | None = None


class InteractionRead(AppBaseModel):
    id: int
    university_id: int
    vendor_id: int
    it_program: str | None
    it_product: str | None
    workflow_id: int | None
    state_id: int | None
    owner_id: str | None
    pause_state: str
    paused_until: datetime | None
    pause_comment: str | None
    created_at: datetime
    updated_at: datetime


class InteractionDetailRead(InteractionRead):
    university: UniversityRead
    vendor: VendorRead
    workflow: WorkflowRead | None = None
    state: StageRead | None = None
