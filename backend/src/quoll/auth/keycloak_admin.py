"""Admin API Keycloak: то, что спрашиваем у источника правды по учёткам.

UserRepository пока тоже ходит в Admin API за созданием и правкой учёток -
его часть переедет сюда, когда появится сверщик реестра
"""

import logging

import httpx

from quoll.auth.keycloak_client import keycloak_client
from quoll.auth.models import UserRole
from quoll.auth.roles import pick_application_roles
from quoll.core.exceptions import (
    IdentityProviderUnavailableException,
    TargetAccountUnavailableException,
)

logger = logging.getLogger(__name__)

# цель проверяется до блокировок, но дольше ждать нельзя - запрос висит
TARGET_CHECK_TIMEOUT_SECONDS = 3.0


def _admin_url(path: str) -> str:
    return f"/admin/realms/{keycloak_client.realm}{path}"


async def _get(path: str) -> httpx.Response:
    try:
        return await keycloak_client.http_client.get(
            _admin_url(path), timeout=TARGET_CHECK_TIMEOUT_SECONDS
        )
    except httpx.HTTPError as err:
        raise IdentityProviderUnavailableException(str(err)) from err


async def verify_target(user_id: str, expected_role: UserRole) -> None:
    """учётка включена и роль ровно одна, та, что в проекции.

    проекция может отставать от Keycloak - нельзя назначить проект тому, кого
    только что отключили. Роли эффективные, как в токене при входе: выданная
    через группу тоже считается
    """
    user = await _get(f"/users/{user_id}")
    if user.status_code == 404:
        raise TargetAccountUnavailableException(user_id, "not found in Keycloak")
    if user.status_code >= 400:
        raise IdentityProviderUnavailableException(str(user.status_code))
    if not user.json().get("enabled", False):
        raise TargetAccountUnavailableException(user_id, "disabled")

    mappings = await _get(f"/users/{user_id}/role-mappings/realm/composite")
    if mappings.status_code >= 400:
        raise IdentityProviderUnavailableException(str(mappings.status_code))
    roles = pick_application_roles(role["name"] for role in mappings.json())
    if roles != [expected_role.value]:
        raise TargetAccountUnavailableException(user_id, f"roles in Keycloak {roles}")
