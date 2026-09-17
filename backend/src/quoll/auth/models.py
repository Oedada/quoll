from enum import Enum

from pydantic import BaseModel
from sqlalchemy.orm import Mapped, mapped_column

from quoll.db import Base


class Role(Enum):
    USER = "common"
    SUPERVISER = "superviser"
    ADMIN = "admin"


# В этой таблице все данные пользователя кроме авторизации
class Session(Base):
    id: Mapped[str] = mapped_column(primary_key=True)
    user_id: Mapped[str]
    session_key: Mapped[str]
    access_token: Mapped[str]
    refresh_token: Mapped[str]


class User(BaseModel):
    id: str
    role: Role
    username: str
    email: str
    first_name: str
    last_name: str
