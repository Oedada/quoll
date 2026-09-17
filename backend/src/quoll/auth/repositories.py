import logging

from quoll.auth.keycloak import KeyCloakData
from quoll.auth.models import Session, User
from quoll.config import settings
from quoll.core import (
    BaseRepository,
    UnknowAuthError,
    UserAlreadyExistsAuthError,
    UserNotFoundException,
)

logger = logging.getLogger(__name__)


class SessionRepository(BaseRepository[Session]):
    pass


class UserRepository:
    def __init__(self, kcdata: KeyCloakData):
        self.client = kcdata.http_client
        self.base_url = f"{settings.keycloak_root_url}/admin/realms/{kcdata.realm}"

    async def create(self, user: User, password: str) -> str:
        logger.debug(f"Creating user with username={user.username}")
        resp = await self.client.post(
            url=f"{self.base_url}/users",
            json={
                "username": user.username,
                "email": user.email,
                "enabled": True,
                "emailVerified": False,
                "firstName": user.first_name,
                "lastName": user.last_name,
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
        logger.info(f"User {user.username} created with id={user_id}")
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
        return User(
            id=data["id"],
            username=data["username"],
            email=data["email"],
            first_name=data.get("firstName", ""),
            last_name=data.get("lastName", ""),
            role=data.get("role", "common"),
        )

    async def get_all(self, limit: int = 100, offset: int = 0) -> list[User]:
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
            users.append(
                User(
                    id=data["id"],
                    username=data["username"],
                    email=data["email"],
                    first_name=data.get("firstName", ""),
                    last_name=data.get("lastName", ""),
                    role=data.get("role", "common"),
                )
            )
        logger.debug(f"Found {len(users)} users")
        return users

    async def update(self, user_id: str, user: User) -> User:
        logger.debug(f"Updating user with id={user_id}")
        resp = await self.client.put(
            url=f"{self.base_url}/users/{user_id}",
            json={
                "username": user.username,
                "email": user.email,
                "firstName": user.first_name,
                "lastName": user.last_name,
            },
        )
        if resp.status_code == 404:
            raise UserNotFoundException(user_id)
        if resp.status_code >= 400:
            raise UnknowAuthError(f"{resp.status_code} - {resp.text}")
        resp.raise_for_status()
        logger.info(f"User with id={user_id} updated")
        return await self.get(user_id)

    async def delete(self, user_id: str) -> bool:
        logger.debug(f"Deleting user with id={user_id}")
        resp = await self.client.delete(url=f"{self.base_url}/users/{user_id}")
        if resp.status_code == 404:
            raise UserNotFoundException(user_id)
        if resp.status_code >= 400:
            raise UnknowAuthError(f"{resp.status_code} - {resp.text}")
        resp.raise_for_status()
        logger.info(f"User with id={user_id} deleted")
        return True
