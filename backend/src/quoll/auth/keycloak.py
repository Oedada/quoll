from __future__ import annotations

import asyncio
import logging
import time
import typing

import httpx
from httpx import AsyncClient, Request, Response
from pydantic import BaseModel

from quoll.config import settings
from quoll.core import Storage

logger = logging.getLogger(__name__)


class AccessToken(BaseModel):
    access_token: str


class ClientSecret(BaseModel):
    value: str


class Client(BaseModel):
    id: str


class User(BaseModel):
    id: str


class Role(BaseModel):
    id: str
    name: str


async def check_client(secret: str, http_client: AsyncClient) -> bool:
    logger.debug(
        f"Checking client credentials for client_id={settings.keycloak_client_id}"
    )
    resp = await http_client.post(
        url=f"{settings.keycloak_root_url}/realms/{settings.keycloak_realm_name}/protocol/openid-connect/token",
        data={
            "grant_type": "client_credentials",
            "client_id": settings.keycloak_client_id,
            "client_secret": secret,
        },
    )
    logger.debug(f"check_client response status: {resp.status_code}")
    if resp.status_code == 200 and resp.json().get("access_token") is not None:
        logger.debug("Client credentials valid")
        return True
    logger.debug("Client credentials invalid")
    return False


class TokenManager:
    def __init__(self, client_id: str, client_secret: str):
        self.token_url = f"{settings.keycloak_root_url}/realms/{settings.keycloak_realm_name}/protocol/openid-connect/token"
        self.client_id = client_id
        self.client_secret = client_secret
        self._token: str | None = None
        self._expires_at: float = 0
        self._lock = asyncio.Lock()

    def _is_expired(self) -> bool:
        return self._token is None or time.time() >= self._expires_at - 5

    async def get_token(self) -> str:
        if not self._is_expired():
            return self._token
        async with self._lock:
            if (
                self._is_expired()
            ):  # double-check: пока ждали лок, кто-то мог уже обновить
                await self._refresh()
        return self._token

    async def refresh(self) -> str:
        async with self._lock:
            await self._refresh()
        return self._token

    async def _refresh(self):
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(
                self.token_url,
                data={
                    "grant_type": "client_credentials",
                    "client_id": self.client_id,
                    "client_secret": self.client_secret,
                },
            )
            resp.raise_for_status()
            data = resp.json()
        self._token = data["access_token"]
        self._expires_at = time.time() + data["expires_in"]


class RefreshableAuth(httpx.Auth):
    def __init__(self, token_manager: TokenManager):
        self.token_manager = token_manager

    async def async_auth_flow(
        self, request: httpx.Request
    ) -> typing.AsyncGenerator[Request, Response]:
        token = await self.token_manager.get_token()
        request.headers["Authorization"] = f"Bearer {token}"
        response = yield request

        if response.status_code == 401:
            token = await self.token_manager.refresh()
            request.headers["Authorization"] = f"Bearer {token}"
            yield request


class KeyCloakData:
    def __init__(self, client_secret: str):
        self.realm: str = settings.keycloak_realm_name
        self.client_id: str = settings.keycloak_client_id
        self.client_secret: str = client_secret
        self.token_manager = TokenManager(self.client_id, client_secret)
        self.http_client: AsyncClient = AsyncClient(
            base_url=settings.keycloak_root_url, timeout=10, auth=RefreshableAuth(self.token_manager)
        )

    @classmethod
    async def from_storage(cls, storage: Storage) -> KeyCloakData:
        http_client: AsyncClient = AsyncClient(
            base_url=settings.keycloak_root_url, timeout=10
        )
        logger.debug("Loading KeyCloakData from storage")
        secret = storage.keycloak_client_secret
        if secret is None or not await check_client(secret, http_client):
            logger.debug("Keycloak secret missing or invalid, initializing new client")
            secret = await init_keycloak_client(http_client)
        storage.keycloak_client_secret = secret
        return KeyCloakData(secret)

    def write_to_storage(self, storage: Storage) -> None:
        storage.keycloak_client_secret = self.client_secret


def _headers(token: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {token}",
        "content-type": "application/json",
    }


async def get_admin_token(http_client: AsyncClient) -> AccessToken:
    url = f"{settings.keycloak_root_url}/realms/master/protocol/openid-connect/token"
    logger.debug(f"Getting admin token from {url}")
    resp = await http_client.post(
        url=url,
        data={
            "grant_type": "password",
            "client_id": "admin-cli",
            "username": "admin",
            "password": settings.keycloak_admin_password,
        },
        headers={"content-type": "application/x-www-form-urlencoded"},
    )
    if resp.status_code == 409:
        logger.warning(f"Conflict getting admin token: {resp.text}")
        resp.raise_for_status()
    try:
        resp.raise_for_status()
    except Exception:
        logger.error(f"Failed to get admin token: {resp.status_code} - {resp.text}")
        raise
    logger.debug("Admin token obtained successfully")
    return AccessToken.model_validate(resp.json())


async def create_realm(http_client: AsyncClient, token: str) -> None:
    url = f"{settings.keycloak_root_url}/admin/realms"
    logger.debug(f"Creating realm: {settings.keycloak_realm_name}")
    resp = await http_client.post(
        url=url,
        json={"realm": settings.keycloak_realm_name, "enabled": True},
        headers=_headers(token),
    )
    if resp.status_code == 409:
        logger.warning(f"Realm {settings.keycloak_realm_name} already exists")
    try:
        resp.raise_for_status()
    except Exception:
        logger.error(f"Failed to create realm: {resp.status_code} - {resp.text}")
        raise
    logger.debug(f"Realm {settings.keycloak_realm_name} created successfully")


async def create_client(http_client: AsyncClient, token: str) -> str:
    url = f"{settings.keycloak_root_url}/admin/realms/{settings.keycloak_realm_name}/clients"
    logger.debug(f"Creating client: {settings.keycloak_client_id}")
    resp = await http_client.post(
        url=url,
        json={
            "clientId": settings.keycloak_client_id,
            "protocol": "openid-connect",
            "publicClient": False,
            "serviceAccountsEnabled": True,
            "standardFlowEnabled": False,
            "directAccessGrantsEnabled": False,
            "authorizationServicesEnabled": False,
        },
        headers=_headers(token),
    )
    if resp.status_code == 409:
        logger.warning(f"Client {settings.keycloak_client_id} already exists")
    try:
        resp.raise_for_status()
    except Exception:
        logger.error(f"Failed to create client: {resp.status_code} - {resp.text}")
        raise
    location = resp.headers["Location"]
    client_id = location.rstrip("/").rsplit("/", 1)[1]
    logger.debug(f"Client created with id: {client_id}")
    return client_id


async def get_client_secret(
    http_client: AsyncClient, token: str, client_id: str
) -> str:
    url = f"{settings.keycloak_root_url}/admin/realms/{settings.keycloak_realm_name}/clients/{client_id}/client-secret"
    logger.debug(f"Getting client secret for client_id: {client_id}")
    resp = await http_client.get(
        url=url,
        headers=_headers(token),
    )
    try:
        resp.raise_for_status()
    except Exception:
        logger.error(f"Failed to get client secret: {resp.status_code} - {resp.text}")
        raise
    secret = ClientSecret.model_validate(resp.json()).value
    logger.debug(f"Client secret obtained for client_id: {client_id}")
    return secret


async def get_realm_management_client_id(http_client: AsyncClient, token: str) -> str:
    url = f"{settings.keycloak_root_url}/admin/realms/{settings.keycloak_realm_name}/clients?clientId=realm-management"
    logger.debug("Getting realm-management client id")
    resp = await http_client.get(
        url=url,
        headers=_headers(token),
    )
    try:
        resp.raise_for_status()
    except Exception:
        logger.error(
            f"Failed to get realm-management client: {resp.status_code} - {resp.text}"
        )
        raise
    clients = [Client.model_validate(c) for c in resp.json()]
    client_id = clients[0].id
    logger.debug(f"Realm-management client id: {client_id}")
    return client_id


async def get_service_account_user_id(
    http_client: AsyncClient, token: str, client_id: str
) -> str:
    url = f"{settings.keycloak_root_url}/admin/realms/{settings.keycloak_realm_name}/clients/{client_id}/service-account-user"
    logger.debug(f"Getting service account user id for client_id: {client_id}")
    resp = await http_client.get(
        url=url,
        headers=_headers(token),
    )
    try:
        resp.raise_for_status()
    except Exception:
        logger.error(
            f"Failed to get service account user: {resp.status_code} - {resp.text}"
        )
        raise
    user_id = User.model_validate(resp.json()).id
    logger.debug(f"Service account user id: {user_id}")
    return user_id


async def get_manage_users_role(
    http_client: AsyncClient, token: str, realm_management_client_id: str
) -> Role:
    url = f"{settings.keycloak_root_url}/admin/realms/{settings.keycloak_realm_name}/clients/{realm_management_client_id}/roles/manage-users"
    logger.debug(
        f"Getting manage-users role for realm_management_client_id: {realm_management_client_id}"
    )
    resp = await http_client.get(
        url=url,
        headers=_headers(token),
    )
    try:
        resp.raise_for_status()
    except Exception:
        logger.error(
            f"Failed to get manage-users role: {resp.status_code} - {resp.text}"
        )
        raise
    role = Role.model_validate(resp.json())
    logger.debug(f"Manage-users role obtained: {role.name}")
    return role


async def assign_role(
    http_client: AsyncClient,
    token: str,
    user_id: str,
    realm_management_client_id: str,
    role: Role,
) -> None:
    url = f"{settings.keycloak_root_url}/admin/realms/{settings.keycloak_realm_name}/users/{user_id}/role-mappings/clients/{realm_management_client_id}"
    logger.debug(f"Assigning role {role.name} to user_id: {user_id}")
    resp = await http_client.post(
        url=url,
        json=[role.model_dump()],
        headers=_headers(token),
    )
    try:
        resp.raise_for_status()
    except Exception:
        logger.error(f"Failed to assign role: {resp.status_code} - {resp.text}")
        raise
    logger.debug(f"Role {role.name} assigned successfully")


async def init_keycloak_client(http_client: AsyncClient) -> str:
    logger.info("Initializing Keycloak client")
    token = (await get_admin_token(http_client)).access_token
    logger.debug("Admin token obtained")

    await create_realm(http_client, token)
    logger.debug("Realm created/verified")

    client_id = await create_client(http_client, token)
    logger.debug(f"Client created: {client_id}")
    client_secret = await get_client_secret(http_client, token, client_id)
    logger.debug("Client secret obtained")

    realm_management_client_id = await get_realm_management_client_id(
        http_client, token
    )
    logger.debug(f"Realm management client id: {realm_management_client_id}")

    user_id = await get_service_account_user_id(http_client, token, client_id)
    logger.debug(f"Service account user id: {user_id}")

    role = await get_manage_users_role(http_client, token, realm_management_client_id)
    logger.debug(f"Manage-users role: {role.name}")

    await assign_role(http_client, token, user_id, realm_management_client_id, role)
    logger.debug("Role assigned")

    logger.info(
        f"Keycloak client initialized successfully, client_secret length: {len(client_secret)}"
    )
    return client_secret
