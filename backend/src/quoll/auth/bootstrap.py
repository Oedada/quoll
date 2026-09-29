"""Сюда вынесена заведение админа при старте. Потом может сюда добавим что-то ещё."""

import logging

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from quoll.auth.models import Admin, Manager, Superviser, User, UserRole
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
        first_name="Андрей",
        last_name="Соколов",
        patronymic="Викторович",
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


# демо-учётки ролей для жюри (О 30): логины и пароли публичны, в README
# (логин, роль, (фамилия, имя, отчество), пароль)
DEMO_ACCOUNTS = (
    (
        "miniboss",
        UserRole.SUPERVISER,
        ("Крылов", "Алексей", "Владимирович"),
        "kurkuma2017",
    ),
    ("microbro1", UserRole.MANAGER, ("Смирнова", "Екатерина", "Олеговна"), "bananchik"),
    ("microbro2", UserRole.MANAGER, ("Орлов", "Дмитрий", "Игоревич"), "bananchik"),
)


def _demo(
    username: str, role: UserRole, name: tuple[str, str, str], user_id: str
) -> User:
    model = Superviser if role == UserRole.SUPERVISER else Manager
    last, first, patronymic = name
    return model(
        id=user_id,
        role=role,
        username=username,
        email=f"{username}@demo.quoll",
        first_name=first,
        last_name=last,
        patronymic=patronymic,
        is_active=True,
    )


async def _ensure(
    session: AsyncSession, repo: UserRepository, user: User, password: str
) -> str | None:
    """как у админа: в Keycloak и в проекции, повторный запуск ничего не делает"""
    try:
        return await repo.create(user, password=password)
    except UserAlreadyExistsAuthError:
        user_id = await repo.find_id_by_username(user.username)
        if user_id is not None and await session.get(User, user_id) is None:
            user.id = user_id
            session.add(user)
            await session.flush()
        return user_id


async def ensure_demo_accounts(session: AsyncSession, repo: UserRepository) -> None:
    """руководитель и два КАМа в его команде - сразу можно работать"""
    from quoll.org import service as org_service

    try:
        ids = {
            username: await _ensure(
                session, repo, _demo(username, role, name, ""), password
            )
            for username, role, name, password in DEMO_ACCOUNTS
        }
    except (httpx.HTTPError, UnknowAuthError) as err:
        logger.error(f"Demo accounts skipped, Keycloak unavailable: {err}")
        return
    lead = ids["miniboss"]
    for username in ("microbro1", "microbro2"):
        manager = await session.get(Manager, ids[username])
        if lead and manager is not None and manager.superviser_id is None:
            await org_service.recruit(
                session,
                actor_id=lead,
                manager_id=manager.id,
                expected_superviser_id=None,
            )
