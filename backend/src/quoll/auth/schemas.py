from pydantic import ConfigDict

from quoll.auth.models import UserRole
from quoll.core.schemas import AppBaseModel


class UserBase(AppBaseModel):
    username: str
    email: str
    first_name: str = ""
    last_name: str = ""
    patronymic: str


class UserCreate(UserBase):
    password: str
    role: UserRole = UserRole.MANAGER


class UserUpdate(AppBaseModel):
    """профиль. Отключение учётки придёт с увольнением в 1.3, не через патч"""

    model_config = ConfigDict(extra="forbid")

    email: str | None = None
    first_name: str | None = None
    last_name: str | None = None
    patronymic: str | None = None


class UserRead(AppBaseModel):
    id: str
    # в Keycloak логин и почта не у всех, колонки nullable
    username: str | None
    email: str | None
    first_name: str
    last_name: str
    patronymic: str
    role: UserRole
    is_active: bool
    # есть только у менеджера, у остальных - значение по умолчанию
    superviser_id: str | None = None


class UserListRead(AppBaseModel):
    users: list[UserRead]
    limit: int
    offset: int


class RoleChange(AppBaseModel):
    model_config = ConfigDict(extra="forbid")

    role: UserRole
