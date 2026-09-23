import logging

from sqlalchemy.ext.asyncio import AsyncSession

from quoll.auth.keycloak_client import keycloak_client
from quoll.auth.models import Admin, Manager, Superviser, User, UserRole
from quoll.config import settings
from quoll.core import (
    InvalidUserRoleException,
    SystemDefaults,
    UnknowAuthError,
    UserAlreadyExistsAuthError,
    UserNotFoundException,
)

logger = logging.getLogger(__name__)


class UserRepository:
    def __init__(self, session: AsyncSession):
        self.s = session
        self.client = keycloak_client.http_client
        self.base_url = (
            f"{settings.keycloak_root_url}/admin/realms/{keycloak_client.realm}"
        )

    async def set_superviser(self, manager_id: str, superviser_id: str) -> None:
        manager = await self.get(manager_id)
        superviser = await self.get(superviser_id)
        if isinstance(manager, Manager):
            if isinstance(superviser, Superviser):
                manager.superviser_id = superviser_id
                await self.s.flush()
            else:
                raise InvalidUserRoleException(manager_id)
        else:
            raise InvalidUserRoleException(manager_id)

    async def find_id_by_username(self, username: str) -> str | None:
        """Идентификатор выдаёт Keycloak, поэтому найти уже созданную учётку
        можно только по логину"""
        resp = await self.client.get(
            url=f"{self.base_url}/users",
            params={"username": username, "exact": True},
        )
        if resp.status_code >= 400:
            raise UnknowAuthError(f"{resp.status_code} - {resp.text}")
        found = resp.json()
        return found[0]["id"] if found else None

    async def assign_role(self, user_id: str, role: UserRole):
        role_resp = (
            await self.client.get(f"{self.base_url}/roles/{role.value}")
        ).json()
        (
            await self.client.post(
                f"{self.base_url}/users/{user_id}/role-mappings/realm",
                json=[{"id": role_resp["id"], "name": role_resp["name"]}],
            )
        ).raise_for_status()

    async def create(self, user: User, password: str) -> str:
        logger.debug(f"Creating user with username={user.username}")
        role_to_model = {
            UserRole.MANAGER: Manager,
            UserRole.SUPERVISER: Superviser,
            UserRole.ADMIN: Admin,
        }
        expected_model = role_to_model.get(user.role)
        if expected_model and not isinstance(user, expected_model):
            raise ValueError(
                f"Role {user.role} requires {expected_model.__name__} instance, "
                f"got {type(user).__name__}"
            )
        resp = await self.client.post(
            url=f"{self.base_url}/users",
            json={
                "username": user.username,
                "email": user.email,
                "enabled": True,
                "emailVerified": False,
                "credentials": [
                    {"type": "password", "value": password, "temporary": False}
                ],
            },
        )
        if resp.status_code == 409:
            raise UserAlreadyExistsAuthError()
        if resp.status_code >= 400:
            raise UnknowAuthError(f"{resp.status_code} - {resp.text}")
        resp.raise_for_status()
        location = resp.headers.get("Location")
        if location is None:
            raise UnknowAuthError("no Location header in response")
        user_id = location.rstrip("/").rsplit("/", 1)[1]
        user.id = user_id
        self.s.add(user)
        await self.s.flush()
        logger.info(f"User {user.username} created with id={user_id}")
        await self.assign_role(user_id, user.role)
        logger.debug(f"Role {user.role.value} assigned to user {user_id}")
        return user_id

    async def get(self, user_id: str) -> User:
        logger.debug(f"Getting user with id={user_id}")
        resp = await self.client.get(url=f"{self.base_url}/users/{user_id}")
        if resp.status_code == 404:
            raise UserNotFoundException(user_id)
        if resp.status_code >= 400:
            raise UnknowAuthError(f"{resp.status_code} - {resp.text}")
        resp.raise_for_status()
        data = resp.json()
        logger.debug(f"User with id={user_id} found")
        user = await self.s.get(User, user_id)
        if user is None:
            raise UserNotFoundException(user_id)
        user.username = data["username"]
        user.email = data["email"]
        return user

    async def get_all(
        self, limit: int = SystemDefaults.DEFAULT_PAGE_SIZE, offset: int = 0
    ) -> list[User]:
        logger.debug(f"Getting all users with limit={limit}, offset={offset}")
        resp = await self.client.get(
            url=f"{self.base_url}/users",
            params={"max": limit, "first": offset},
        )
        if resp.status_code >= 400:
            raise UnknowAuthError(f"{resp.status_code} - {resp.text}")
        resp.raise_for_status()

        users: list[User] = []
        for data in resp.json():
            user_id = data["id"]
            user = await self.s.get(User, user_id)
            if user is None:
                raise UserNotFoundException(user_id)
            user.email = data["email"]
            user.username = data["username"]

            users.append(user)
        logger.debug(f"Found {len(users)} users")
        return users

    async def update(self, updated_user: User) -> User:
        logger.debug(f"Updating user with id={updated_user.id}")
        resp = await self.client.put(
            url=f"{self.base_url}/users/{updated_user.id}",
            json={
                "username": updated_user.username,
                "email": updated_user.email,
            },
        )
        if resp.status_code == 404:
            raise UserNotFoundException(updated_user.id)
        if resp.status_code >= 400:
            raise UnknowAuthError(f"{resp.status_code} - {resp.text}")
        user = await self.s.get(User, updated_user.id)
        if user is None:
            raise UserNotFoundException(updated_user.id)
        user.first_name = updated_user.first_name
        user.last_name = updated_user.last_name
        await self.s.flush()
        resp.raise_for_status()
        logger.info(f"User with id={updated_user.id} updated")
        return await self.get(updated_user.id)

    async def delete(self, user_id: str) -> None:
        logger.debug(f"Deleting user with id={user_id}")
        user = await self.s.get(User, user_id)
        if user is None:
            raise UserNotFoundException(user_id)
        # Сначала БД: если удаление упрётся в RESTRICT, транзакция откатится
        # строку подтипа нужно снять раньше строки users
        await self.s.delete(user)
        await self.s.flush()
        resp = await self.client.delete(url=f"{self.base_url}/users/{user_id}")
        # 404 - в Keycloak учётки уже нет:
        if resp.status_code >= 400 and resp.status_code != 404:
            raise UnknowAuthError(f"{resp.status_code} - {resp.text}")
        logger.info(f"User with id={user_id} deleted")
