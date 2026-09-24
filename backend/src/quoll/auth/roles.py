from collections.abc import Iterable
from typing import Any

from quoll.auth.models import UserRole

APP_ROLES = frozenset(role.value for role in UserRole)


def pick_application_roles(names: Iterable[str]) -> list[str]:
    """прикладные роли из любого набора имён, технические отсеиваются"""
    return sorted(set(names) & APP_ROLES)


def application_roles(claims: dict[str, Any]) -> list[str]:
    """прикладные роли из claims токена.

    роли бывают и в realm_access.roles, и в корневом roles - берём оба
    """
    realm_roles = claims.get("realm_access", {}).get("roles", [])
    top_level_roles = claims.get("roles", [])
    return pick_application_roles([*realm_roles, *top_level_roles])
