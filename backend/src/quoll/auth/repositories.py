import logging

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from quoll.auth.keycloak_client import keycloak_client
from quoll.auth.models import (
    Admin,
    Manager,
    Superviser,
    User,
    UserRole,
    user_class_for_role,
)
from quoll.auth.schemas import UserUpdate
from quoll.config import settings
from quoll.core import (
    SystemDefaults,
    UnknowAuthError,
    UserAlreadyExistsAuthError,
    UserNotFoundException,
)

logger = logging.getLogger(__name__)

# имена полей профиля у нас и в Keycloak
_KEYCLOAK_PROFILE_FIELDS = {
    "email": "email",
    "first_name": "firstName",
    "last_name": "lastName",
}


class UserRepository:
    def __init__(self, session: AsyncSession):
        self.s = session
        self.client = keycloak_client.http_client
        self.base_url = (
            f"{settings.keycloak_root_url}/admin/realms/{keycloak_client.realm}"
        )

    async def ensure_projection(
        self, user_id: str, role: UserRole, profile: dict[str, str | None]
    ) -> User:
        """завести проекцию при первом входе, если её ещё нет.

        идемпотентно: заводят двое - вход и сверщик реестра, и двойной колбэк
        или гонка с ним иначе дали бы IntegrityError
        """
        users = User.__table__
        inserted = await self.s.scalar(
            pg_insert(users)
            .values(id=user_id, role=role, is_active=True, **profile)
            .on_conflict_do_nothing(index_elements=[users.c.id])
            .returning(users.c.id)
        )
        if inserted is not None:
            # строку подтипа только если users вставили мы - иначе она уже есть
            subtype = user_class_for_role(role).__table__
            await self.s.execute(pg_insert(subtype).values(id=user_id))
            logger.info(f"Projection created on first login for user_id={user_id}")
        return await self.s.get(User, user_id)

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
        """из проекции - в Keycloak на чтении не ходим"""
        user = await self.s.get(User, user_id)
        if user is None:
            raise UserNotFoundException(user_id)
        return user

    async def get_all(
        self, limit: int = SystemDefaults.DEFAULT_PAGE_SIZE, offset: int = 0
    ) -> list[User]:
        stmt = (
            select(User).order_by(User.created_at, User.id).limit(limit).offset(offset)
        )
        return list((await self.s.execute(stmt)).scalars().all())

    async def update_profile(self, user_id: str, changes: UserUpdate) -> User:
        """сначала Keycloak, потом проекция: профиль там главный, и сверщик
        реестра откатил бы правку, сделанную только у нас"""
        user = await self.get(user_id)
        fields = changes.model_dump(exclude_unset=True)
        if not fields:
            return user

        kc_fields = {
            _KEYCLOAK_PROFILE_FIELDS[name]: value
            for name, value in fields.items()
            if name in _KEYCLOAK_PROFILE_FIELDS
        }
        if kc_fields:
            resp = await self.client.put(
                url=f"{self.base_url}/users/{user_id}",
                json=kc_fields,
            )
            if resp.status_code == 404:
                raise UserNotFoundException(user_id)
            if resp.status_code >= 400:
                raise UnknowAuthError(f"{resp.status_code} - {resp.text}")

        for name, value in fields.items():
            setattr(user, name, value)
        await self.s.flush()
        logger.info(f"User with id={user_id} updated")
        return user

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
