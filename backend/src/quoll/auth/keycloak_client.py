from __future__ import annotations

import asyncio
import logging
import time
import typing

import httpx
from httpx import AsyncClient, Request, Response

from quoll.config import Settings, settings

logger = logging.getLogger(__name__)


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


class KeycloakClient:
    def __init__(self, settings: Settings):
        self.realm: str = settings.keycloak_realm_name
        self.id: str = settings.keycloak_client_id
        self.secret: str = settings.keycloak_client_secret
        self.token_manager = TokenManager(self.id, self.secret)
        self.http_client: AsyncClient = AsyncClient(
            base_url=settings.keycloak_root_url,
            timeout=10,
            auth=RefreshableAuth(self.token_manager),
        )

keycloak_client = KeycloakClient(settings=settings)
