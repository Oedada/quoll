"""Поток входа OIDC: state, nonce и PKCE.

state отсекает чужой код авторизации, nonce - подмену id-токена, PKCE - перехват
кода по дороге. Все три живут в короткой зашифрованной куке между /auth/ и
/auth/callback - отдельная таблица ради десяти минут не нужна
"""

import base64
import hashlib
import json
import secrets
from dataclasses import asdict, dataclass
from urllib.parse import urlencode

from quoll.auth.crypto import TokenCipher
from quoll.auth.keycloak_client import keycloak_client
from quoll.config import settings

FLOW_COOKIE = "oidc_flow"
FLOW_TTL_SECONDS = 600


@dataclass(frozen=True)
class LoginFlow:
    state: str
    nonce: str
    code_verifier: str


def new_flow() -> LoginFlow:
    return LoginFlow(
        state=secrets.token_urlsafe(32),
        nonce=secrets.token_urlsafe(32),
        # RFC 7636: от 43 до 128 символов
        code_verifier=secrets.token_urlsafe(64),
    )


def code_challenge(code_verifier: str) -> str:
    digest = hashlib.sha256(code_verifier.encode()).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode()


def authorization_url(flow: LoginFlow) -> str:
    # client_secret сюда не кладём - адрес уходит в браузер
    params = {
        "client_id": settings.keycloak_client_id,
        "redirect_uri": settings.keycloak_redirect_uri,
        "response_type": "code",
        "scope": "openid",
        "state": flow.state,
        "nonce": flow.nonce,
        "code_challenge": code_challenge(flow.code_verifier),
        "code_challenge_method": "S256",
    }
    return (
        f"{settings.keycloak_root_url}/realms/{keycloak_client.realm}"
        f"/protocol/openid-connect/auth?{urlencode(params)}"
    )


def seal(flow: LoginFlow, cipher: TokenCipher) -> str:
    return cipher.encrypt(json.dumps(asdict(flow)))


def unseal(sealed: str | None, cipher: TokenCipher) -> LoginFlow | None:
    """None, если куки нет, её подделали или она старше срока"""
    if sealed is None:
        return None
    plain = cipher.decrypt(sealed, ttl=FLOW_TTL_SECONDS)
    if plain is None:
        return None
    try:
        return LoginFlow(**json.loads(plain))
    except (ValueError, TypeError):
        return None
