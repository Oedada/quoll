from quoll.auth.models import UserRole
from quoll.core.schemas import AppBaseModel


class UserBase(AppBaseModel):
    username: str
    email: str
    first_name: str = ""
    last_name: str = ""


class UserCreate(UserBase):
    password: str
    role: UserRole = UserRole.MANAGER


class UserUpdate(AppBaseModel):
    email: str | None = None
    first_name: str | None = None
    last_name: str | None = None
    enabled: bool | None = None


class UserRead(UserBase):
    id: str
    role: UserRole
    superviser_id: str | None = None


class UserListRead(AppBaseModel):
    users: list[UserRead]
    limit: int
    offset: int
