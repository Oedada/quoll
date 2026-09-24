"""Сценарий входа: от кода авторизации до серверной сессии"""

import hmac
import logging
from dataclasses import dataclass
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from quoll.auth.audit import record
from quoll.auth.audit_models import AuditEventType, TargetType
from quoll.auth.identity_policy import identity_denial
from quoll.auth.models import UserRole
from quoll.auth.oidc import LoginFlow
from quoll.auth.repositories import UserRepository
from quoll.auth.roles import application_roles
from quoll.auth.session_service import SessionService, decode_unverified_claims
from quoll.config import settings
from quoll.core.exceptions import LoginFlowException

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class LoginSession:
    raw_key: str
    max_age: int


@dataclass(frozen=True)
class LoginDenied:
    status_code: int
    detail: str


async def complete_login(
    db: AsyncSession, session_service: SessionService, code: str, flow: LoginFlow
) -> LoginSession | LoginDenied:
    """отказ возвращается, а не бросается: запись о нём в журнале должна
    закоммититься вместе с запросом, а исключение её откатило бы"""
    tokens = await session_service.exchange_code(
        code, settings.keycloak_redirect_uri, flow.code_verifier
    )
    _check_nonce(tokens, flow)

    claims = decode_unverified_claims(tokens["access_token"])
    user_id = claims["sub"]
    roles = application_roles(claims)
    if len(roles) != 1:
        # П9: сессию не создаём, иначе человек логинится по кругу. Флаг
        # в проекции не ставим - авторитетно это делает сверщик реестра
        record(
            db,
            actor_id=None,
            event_type=AuditEventType.ROLE_MAPPING_CONFLICT_DETECTED,
            target_type=TargetType.USER,
            target_id=user_id,
            new_value={"roles": roles},
        )
        return LoginDenied(403, "Account must have exactly one application role")

    role = UserRole(roles[0])
    user = await UserRepository(db).ensure_projection(user_id, role, _profile(claims))
    if user.role != role:
        # проекция отстаёт от Keycloak. Решения всё равно по проекции,
        # догонит сверщик реестра
        logger.warning(
            f"User {user_id} logs in as {role.value}, projection says {user.role.value}"
        )

    denial = identity_denial(user)
    if denial is not None:
        return LoginDenied(*denial)

    raw_key, max_age = await session_service.start_session(user_id, tokens)
    return LoginSession(raw_key, max_age)


def _check_nonce(tokens: dict[str, Any], flow: LoginFlow) -> None:
    id_token = tokens.get("id_token")
    nonce = decode_unverified_claims(id_token).get("nonce") if id_token else None
    if not isinstance(nonce, str) or not hmac.compare_digest(
        nonce.encode(), flow.nonce.encode()
    ):
        raise LoginFlowException("id token nonce does not match")


def _profile(claims: dict[str, Any]) -> dict[str, str | None]:
    return {
        "username": claims.get("preferred_username"),
        "email": claims.get("email"),
        # колонки имени NOT NULL, а в Keycloak имя не обязательно
        "first_name": claims.get("given_name") or "",
        "last_name": claims.get("family_name") or "",
    }
