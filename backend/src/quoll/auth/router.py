from dataclasses import dataclass

from fastapi import APIRouter, Depends, Request
from fastapi.responses import RedirectResponse
from sqlalchemy.ext.asyncio import AsyncSession

from quoll.auth.keycloak import KeyCloakData, get_session_for_code
from quoll.auth.models import Session, User
from quoll.auth.repositories import SessionRepository, UserRepository
from quoll.config import settings
from quoll.core import UserNotFoundException
from quoll.db import get_db_session

router = APIRouter()


@dataclass
class Tokens:
    access: str
    refresh: str


sessions: dict[str, Tokens] = {}


async def get_session_repo(
    db_session: AsyncSession = Depends(get_db_session),
) -> SessionRepository:
    return SessionRepository(db_session)


async def get_user_repo(req: Request) -> UserRepository:
    return UserRepository(req.app.state.keycloak)


async def get_kcdata(req: Request) -> KeyCloakData:
    return req.app.state.keycloak


async def get_user(
    req: Request,
    session_repo: SessionRepository = Depends(get_session_repo),
    user_repo: UserRepository = Depends(get_user_repo),
) -> User | None:
    session_id = req.cookies.get("session")
    if session_id is None:
        return None
    try:
        session: Session = await session_repo.get(session_id)
        return await user_repo.get(session.user_id)
    except UserNotFoundException:
        return None


@router.get("/")
def root(req: Request, user: User | None = Depends(get_user)):
    if user is None:
        return RedirectResponse("/auth/auth")
    return "Main page"


# скорее высего проблема в том, что тут сервисный клиент айди, а нужен публичный
@router.get("/auth")
def auth():
    url = (
        f"{settings.keycloak_root_url}/auth"
        f"?client_id={settings.keycloak_client_id}"
        f"&redirect_uri={settings.keycloak_redirect_uri}"
        f"&response_type=code"
        f"&scope=openid"
    )
    return RedirectResponse(url)


@router.get("/callback")
async def callback(
    code: str,
    kcdata: KeyCloakData = Depends(get_kcdata),
    session_repo: SessionRepository = Depends(get_session_repo),
):
    session = await session_repo.create(
        await get_session_for_code(code, settings.keycloak_redirect_uri, kcdata)
    )
    response = RedirectResponse("/")
    response.set_cookie("session", session.id, httponly=True)
    return response
