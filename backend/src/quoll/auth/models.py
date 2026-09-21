from __future__ import annotations

import json
import logging
import secrets
from enum import Enum

from sqlalchemy import ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship

from quoll.auth.keycloak_client import keycloak_client
from quoll.config import settings
from quoll.db import Base, RawBase

logger = logging.getLogger(__name__)


class UserRole(Enum):
    MANAGER = "manager"
    SUPERVISER = "superviser"
    ADMIN = "admin"


def _decode_jwt_sub(token: str) -> str:
    """Extracts user_id (sub claim) from JWT token."""
    import base64

    payload = token.split(".")[1]
    padded = payload + "=" * (4 - len(payload) % 4)
    decoded = base64.urlsafe_b64decode(padded)
    return json.loads(decoded)["sub"]


# В этой таблице все данные пользователя кроме авторизации
class Session(Base):
    id: Mapped[str] = mapped_column(primary_key=True)
    user_id: Mapped[str]
    access_token: Mapped[str]
    refresh_token: Mapped[str]

    @classmethod
    async def get_session_for_code(cls, code: str, redirect_uri: str) -> Session:
        logger.debug("Exchanging authorization code for tokens")
        auth_resp = await keycloak_client.http_client.post(
            f"{settings.keycloak_root_url}/realms/{keycloak_client.realm}/protocol/openid-connect/token",
            headers={"content-type": "application/x-www-form-urlencoded"},
            data={
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": redirect_uri,
                "client_id": keycloak_client.id,
                "client_secret": keycloak_client.secret,
            },
        )
        auth_resp.raise_for_status()
        auth_data = auth_resp.json()

        access_token = auth_data["access_token"]
        refresh_token = auth_data["refresh_token"]
        user_id = _decode_jwt_sub(access_token)

        session_key = secrets.token_urlsafe(64)
        logger.debug(f"Tokens obtained for user_id={user_id}")
        return Session(
            id=session_key,
            user_id=user_id,
            access_token=access_token,
            refresh_token=refresh_token,
        )


class User(RawBase):
    __tablename__ = "users"
    __allow_unmapped__ = True

    id: Mapped[str] = mapped_column(primary_key=True)
    role: Mapped[UserRole]
    username: str
    email: str
    first_name: Mapped[str]
    last_name: Mapped[str]

    __mapper_args__ = {"polymorphic_on": "role"}  # noqa: RUF012

    def __init__(self, *, username: str, email: str, **kwargs):
        super().__init__(**kwargs)
        self.username = username
        self.email = email


class Superviser(User):
    __tablename__ = "supervisers"

    id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )

    __mapper_args__ = {  # noqa: RUF012
        "polymorphic_identity": UserRole.SUPERVISER,
        "polymorphic_load": "selectin",
    }

    managers: Mapped[list[Manager]] = relationship(
        back_populates="superviser",
        foreign_keys="Manager.superviser_id",
        passive_deletes=True
    )


class Manager(User):
    __tablename__ = "managers"

    id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    superviser_id: Mapped[str | None] = mapped_column(ForeignKey("supervisers.id", ondelete="SET NULL"))

    __mapper_args__ = {  # noqa: RUF012
        "polymorphic_identity": UserRole.MANAGER,
        "polymorphic_load": "selectin",
    }

    superviser: Mapped[Superviser] = relationship(
        back_populates="managers",
        foreign_keys=[superviser_id],
    )


class Admin(User):
    __tablename__ = "admins"

    id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )

    __mapper_args__ = {  # noqa: RUF012
        "polymorphic_identity": UserRole.ADMIN,
        "polymorphic_load": "selectin",
    }
