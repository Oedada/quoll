from quoll.core.schemas import AppBaseModel
from quoll.interactions.capacity_policy import EffectiveStatus


class ManagerLoadRead(AppBaseModel):
    id: str
    username: str | None
    first_name: str
    last_name: str
    superviser_id: str | None
    manual_workload_status: str
    max_active_projects: int
    capacity_used: int
    open_projects: int
    blocking_projects: int
    effective_status: EffectiveStatus


class TeamRead(AppBaseModel):
    max_subordinates: int
    members: list[ManagerLoadRead]


class SupervisorCapacityRead(AppBaseModel):
    """сколько свободных слотов у готовых менеджеров чужой команды"""

    id: str
    first_name: str
    last_name: str
    free_project_slots: int


class SupervisorQuotaRead(AppBaseModel):
    """сколько вакантных мест в штате чужой команды"""

    id: str
    first_name: str
    last_name: str
    free_places: int
