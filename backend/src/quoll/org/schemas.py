from datetime import datetime
from typing import Literal

from pydantic import ConfigDict, Field, model_validator

from quoll.auth.models import UserRole
from quoll.core import SystemDefaults
from quoll.core.schemas import AppBaseModel
from quoll.interactions.capacity_policy import EffectiveStatus


class ManagerLoadRead(AppBaseModel):
    id: str
    username: str | None
    first_name: str
    last_name: str
    patronymic: str
    superviser_id: str | None
    manual_workload_status: str
    max_active_projects: int
    capacity_used: int
    open_projects: int
    blocking_projects: int
    effective_status: EffectiveStatus


class RecruitRequest(AppBaseModel):
    model_config = ConfigDict(extra="forbid")

    # обязательно, для Пула А - null: «ожидаю, что руководителя нет»
    expected_superviser_id: str | None


class TransferRequest(RecruitRequest):
    to_superviser_id: str


class TeamRead(AppBaseModel):
    max_subordinates: int
    members: list[ManagerLoadRead]


class SupervisorCapacityRead(AppBaseModel):
    """сколько свободных слотов у готовых менеджеров чужой команды"""

    id: str
    first_name: str
    last_name: str
    patronymic: str
    free_project_slots: int


class SupervisorQuotaRead(AppBaseModel):
    """сколько вакантных мест в штате чужой команды"""

    id: str
    first_name: str
    last_name: str
    patronymic: str
    free_places: int


_Limit = Field(
    default=None,
    ge=SystemDefaults.MIN_CAPACITY_LIMIT,
    le=SystemDefaults.MAX_CAPACITY_LIMIT,
)


class LimitsUpdate(AppBaseModel):
    model_config = ConfigDict(extra="forbid")

    max_active_projects: int | None = _Limit
    max_subordinates: int | None = _Limit

    @model_validator(mode="after")
    def _not_empty(self):
        if self.max_active_projects is None and self.max_subordinates is None:
            raise ValueError("Nothing to change")
        return self


class WorkloadUpdate(AppBaseModel):
    model_config = ConfigDict(extra="forbid")

    manual_workload_status: Literal["available", "unavailable"]


class ProfileRead(AppBaseModel):
    """профиль для оргструктуры: у менеджера - загрузка, у руководителя - штат"""

    id: str
    username: str | None
    email: str | None
    first_name: str
    last_name: str
    patronymic: str
    role: UserRole
    is_active: bool
    identity_sync_status: str
    role_transition_status: str
    load: ManagerLoadRead | None = None
    max_subordinates: int | None = None
    team_size: int | None = None


class PendingActionRead(AppBaseModel):
    """задача очереди без служебных полей аренды - они для воркера"""

    id: str
    action_type: str
    target_id: str
    origin_supervisor_id: str | None
    status: str
    retry_count: int
    next_retry_at: datetime | None
    last_error: str | None
    created_at: datetime
    completed_at: datetime | None
