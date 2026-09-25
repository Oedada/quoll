"""Admin API Keycloak: то, что спрашиваем у источника правды по учёткам и что
в нём меняем. Создание и правку профиля пока делает UserRepository
"""

import logging
from dataclasses import dataclass

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


@dataclass(frozen=True)
class Account:
    enabled: bool
    # эффективные прикладные роли, как в токене: выданная через группу тоже
    roles: list[str]


async def get_account(user_id: str) -> Account | None:
    """None - учётки в Keycloak нет"""
    user = await _get(f"/users/{user_id}")
    if user.status_code == 404:
        return None
    if user.status_code >= 400:
        raise IdentityProviderUnavailableException(str(user.status_code))
    mappings = await _get(f"/users/{user_id}/role-mappings/realm/composite")
    if mappings.status_code >= 400:
        raise IdentityProviderUnavailableException(str(mappings.status_code))
    return Account(
        enabled=user.json().get("enabled", False),
        roles=pick_application_roles(role["name"] for role in mappings.json()),
    )


async def _call(method: str, path: str, **kwargs) -> httpx.Response:
    try:
        response = await keycloak_client.http_client.request(
            method, _admin_url(path), timeout=TARGET_CHECK_TIMEOUT_SECONDS, **kwargs
        )
    except httpx.HTTPError as err:
        raise IdentityProviderUnavailableException(str(err)) from err
    if response.status_code >= 400:
        raise IdentityProviderUnavailableException(
            f"{method} {path}: {response.status_code}"
        )
    return response


async def set_enabled(user_id: str, enabled: bool) -> None:
    await _call("PUT", f"/users/{user_id}", json={"enabled": enabled})


async def set_role(user_id: str, new: UserRole, old: UserRole) -> None:
    """сначала добавить новую, потом снять старую: при сбое посередине у
    учётки две роли - это конфликт, он блокирует вход, а не даёт лишних прав"""
    for role, method in ((new, "POST"), (old, "DELETE")):
        representation = (await _call("GET", f"/roles/{role.value}")).json()
        await _call(
            method,
            f"/users/{user_id}/role-mappings/realm",
            json=[{"id": representation["id"], "name": representation["name"]}],
        )


@dataclass
class Entry:
    enabled: bool
    username: str | None
    email: str | None
    first_name: str | None
    last_name: str | None
    # прямое членство в прикладных ролях - только найти кандидатов;
    # решения принимаются по эффективным ролям точечным чтением
    roles: set[str]


SNAPSHOT_PAGE = 100


async def snapshot() -> dict[str, Entry]:
    """весь реестр учёток. Любой сбой любой страницы - исключение: неполный
    снимок превратился бы в массовую деактивацию"""
    entries: dict[str, Entry] = {}
    first = 0
    while True:
        page = (
            await _call("GET", "/users", params={"first": first, "max": SNAPSHOT_PAGE})
        ).json()
        for user in page:
            entries[user["id"]] = Entry(
                enabled=user.get("enabled", False),
                username=user.get("username"),
                email=user.get("email"),
                first_name=user.get("firstName"),
                last_name=user.get("lastName"),
                roles=set(),
            )
        if len(page) < SNAPSHOT_PAGE:
            break
        first += SNAPSHOT_PAGE
    if not entries:
        raise IdentityProviderUnavailableException("empty user snapshot")
    for role in UserRole:
        first = 0
        while True:
            members = (
                await _call(
                    "GET",
                    f"/roles/{role.value}/users",
                    params={"first": first, "max": SNAPSHOT_PAGE},
                )
            ).json()
            for member in members:
                if member["id"] in entries:
                    entries[member["id"]].roles.add(role.value)
            if len(members) < SNAPSHOT_PAGE:
                break
            first += SNAPSHOT_PAGE
    return entries
