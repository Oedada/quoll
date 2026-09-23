import base64
import json
import logging
import secrets
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx

from quoll.auth.crypto import TokenCipher
from quoll.auth.keycloak_client import keycloak_client
from quoll.auth.models import Session
from quoll.auth.session_store import SessionStore, hash_session_key
from quoll.config import settings

logger = logging.getLogger(__name__)

# не уложились - считаем сетевым сбоем
REVALIDATION_TIMEOUT_SECONDS = 3.0
# запас на расхождение часов с Keycloak
CLOCK_SKEW_LEEWAY = timedelta(seconds=30)


def decode_unverified_claims(token: str) -> dict[str, Any]:
    """claims без проверки подписи"""
    payload = token.split(".")[1]
    padded = payload + "=" * (-len(payload) % 4)
    return json.loads(base64.urlsafe_b64decode(padded))


class SessionRevokedError(Exception):
    """Keycloak больше не признаёт сессию"""


class SessionService:
    def __init__(self, store: SessionStore, cipher: TokenCipher):
        self.store = store
        self.cipher = cipher

    async def create_from_code(self, code: str, redirect_uri: str) -> tuple[str, int]:
        """обменять код на токены и завести сессию.

        возвращает сырой ключ для куки и её срок.
        """
        logger.debug("Exchanging authorization code for tokens")
        response = await keycloak_client.oidc_client.post(
            keycloak_client.token_url,
            data={
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": redirect_uri,
                "client_id": keycloak_client.id,
                "client_secret": keycloak_client.secret,
            },
        )
        response.raise_for_status()
        tokens = response.json()

        user_id = decode_unverified_claims(tokens["access_token"])["sub"]
        raw_key = secrets.token_urlsafe(64)
        lifetime = self._refresh_lifetime(tokens)

        await self.store.create(
            key_hash=hash_session_key(raw_key),
            user_id=user_id,
            refresh_token=self.cipher.encrypt(tokens["refresh_token"]),
            expires_at=datetime.now(UTC) + lifetime,
        )
        logger.info(f"Session established for user_id={user_id}")
        return raw_key, int(lifetime.total_seconds())

    async def resolve(self, raw_key: str) -> Session | None:
        """найти живую сессию, при необходимости сверившись с Keycloak"""
        key_hash = hash_session_key(raw_key)
        session = await self.store.get_active(key_hash)
        if session is None:
            return None

        idle = datetime.now(UTC) - session.last_validated_at
        if idle > timedelta(seconds=settings.session_revalidate_hard_limit_seconds):
            logger.warning(
                f"Session for user_id={session.user_id} unconfirmed for {idle}, closing"
            )
            await self.store.delete(key_hash)
            return None
        if idle <= timedelta(seconds=settings.session_revalidate_seconds):
            return session

        try:
            await self._revalidate(session)
        except SessionRevokedError:
            return None
        return session

    async def revoke(self, raw_key: str) -> None:
        """выйти из Keycloak и убрать свою сессию"""
        key_hash = hash_session_key(raw_key)
        session = await self.store.get_active(key_hash)
        if session is None:
            # срок мог истечь, но явный выход не должен оставлять мусор
            await self.store.delete(key_hash)
            return
        refresh_token = self.cipher.decrypt(session.refresh_token)
        if refresh_token is not None:
            try:
                await keycloak_client.oidc_client.post(
                    keycloak_client.logout_url,
                    data={
                        "client_id": keycloak_client.id,
                        "client_secret": keycloak_client.secret,
                        "refresh_token": refresh_token,
                    },
                )
            except httpx.HTTPError as err:
                # свою сессию закрываем всё равно, иначе он останется залогинен
                logger.warning(f"Keycloak logout call failed: {err}")
        await self.store.delete(key_hash)

    async def _revalidate(self, session: Session) -> None:
        previous = session.last_validated_at
        if not await self.store.claim_validation(session.id, previous):
            logger.debug("Revalidation already claimed by a parallel request")
            return

        refresh_token = self.cipher.decrypt(session.refresh_token)
        if refresh_token is None:
            # ключ потеряли или сменили без ротации - просим перелогиниться
            await self.store.delete(session.id)
            raise SessionRevokedError

        try:
            response = await keycloak_client.oidc_client.post(
                keycloak_client.token_url,
                data={
                    "grant_type": "refresh_token",
                    "refresh_token": refresh_token,
                    "client_id": keycloak_client.id,
                    "client_secret": keycloak_client.secret,
                },
                timeout=REVALIDATION_TIMEOUT_SECONDS,
            )
        except httpx.HTTPError as err:
            # метку на место, иначе отсчёт жёсткого лимита обнулится
            # и сессия переживёт недоступный Keycloak
            await self.store.release_claim(session.id, previous)
            logger.warning(f"Keycloak revalidation unavailable: {err}")
            return

        if response.status_code >= 400:
            logger.info(
                f"Keycloak rejected session for user_id={session.user_id}: "
                f"{response.status_code}"
            )
            await self.store.delete(session.id)
            raise SessionRevokedError

        tokens = response.json()
        await self.store.apply_validation(
            session.id,
            refresh_token=self.cipher.encrypt(
                tokens.get("refresh_token", refresh_token)
            ),
            expires_at=datetime.now(UTC) + self._refresh_lifetime(tokens),
        )
        session.last_validated_at = datetime.now(UTC)

    @staticmethod
    def _refresh_lifetime(tokens: dict[str, Any]) -> timedelta:
        """срок сессии равен сроку refresh-токена"""
        seconds = tokens.get("refresh_expires_in")
        if not seconds:
            seconds = settings.session_revalidate_hard_limit_seconds
            logger.warning(
                "Keycloak did not report refresh_expires_in, falling back to "
                f"{seconds}s session lifetime"
            )
        # max - у совсем короткого срока вычет допуска ушёл бы в минус
        return max(
            timedelta(seconds=int(seconds)) - CLOCK_SKEW_LEEWAY, CLOCK_SKEW_LEEWAY
        )
