from __future__ import annotations

import json
import logging
import secrets
from enum import Enum

from pydantic import BaseModel
from sqlalchemy.orm import Mapped, mapped_column

from quoll.auth.keycloak_client import keycloak_client
from quoll.config import settings
from quoll.db import Base

logger = logging.getLogger(__name__)


class UserRole(Enum):
    USER = "common"
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


class User(BaseModel):
    id: str
    role: UserRole
    username: str
    email: str
    first_name: str
    last_name: str
