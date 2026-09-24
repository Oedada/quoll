from typing import Any

from quoll.auth.models import UserRole

APP_ROLES = frozenset(role.value for role in UserRole)


def application_roles(claims: dict[str, Any]) -> list[str]:
    """прикладные роли из claims токена, технические отсеиваются.

    роли бывают и в realm_access.roles, и в корневом roles - берём оба
    """
    realm_roles = claims.get("realm_access", {}).get("roles", [])
    top_level_roles = claims.get("roles", [])
    return sorted((set(realm_roles) | set(top_level_roles)) & APP_ROLES)
