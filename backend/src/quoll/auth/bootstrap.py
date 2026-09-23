"""Сюда вынесена заведение админа при старте. Потом может сюда добавим что-то ещё."""

import logging

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from quoll.auth.models import Admin, User, UserRole
from quoll.auth.repositories import UserRepository
from quoll.config import settings
from quoll.core import UnknowAuthError, UserAlreadyExistsAuthError

logger = logging.getLogger(__name__)


def _admin(user_id: str) -> Admin:
    return Admin(
        id=user_id,
        role=UserRole.ADMIN,
        username=settings.app_admin_username,
        email=settings.app_admin_email,
        first_name="admin",
        last_name="admin",
        is_active=True,
    )


async def ensure_admin_account(
    session: AsyncSession, user_repo: UserRepository
) -> None:
    """
    Создать админа в Keycloak и у нас. Проверяет что есть и там и тут.
    """
    try:
        await user_repo.create(_admin(""), password=settings.app_admin_password)
        logger.info("Admin account created in Keycloak")
    except UserAlreadyExistsAuthError:
        # Идентификатор отдает Keycloak, узнать его можно только по логину
        admin_id = await user_repo.find_id_by_username(settings.app_admin_username)
        if admin_id is None:
            logger.error("Admin exists in Keycloak but cannot be found by username")
            return
        if await session.get(User, admin_id) is None:
            logger.info("Restoring local projection of the admin account")
            session.add(_admin(admin_id))
    except (httpx.HTTPError, UnknowAuthError) as err:
        logger.error(f"Admin bootstrap skipped, Keycloak unavailable: {err}")
