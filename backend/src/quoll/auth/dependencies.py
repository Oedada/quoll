from collections.abc import Callable
from typing import Annotated

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from quoll.auth.crypto import TokenCipher
from quoll.auth.models import User, UserRole
from quoll.auth.repositories import UserRepository
from quoll.auth.session_service import SessionService
from quoll.auth.session_store import SessionStore
from quoll.config import settings
from quoll.db import get_db_session

SessionDep = Annotated[AsyncSession, Depends(get_db_session)]

_cipher = TokenCipher(settings.session_secret_key)


def build_session_service(session_maker: async_sessionmaker) -> SessionService:
    """отдельно от Depends - websocket-у Request не отдают"""
    return SessionService(SessionStore(session_maker), _cipher)


def get_session_service(req: Request) -> SessionService:
    return build_session_service(req.app.state.db_session_maker)


def get_user_repo(session: SessionDep) -> UserRepository:
    return UserRepository(session)


SessionServiceDep = Annotated[SessionService, Depends(get_session_service)]
UserRepoDep = Annotated[UserRepository, Depends(get_user_repo)]

_NOT_AUTHENTICATED = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated"
)


async def get_current_user(
    req: Request,
    db: SessionDep,
    session_service: SessionServiceDep,
) -> User:
    """текущий пользователь из локальной проекции.

    в Keycloak на чтении не ходим, сессию он подтверждает внутри resolve и не
    чаще раза в интервал сверки
    """
    raw_key = req.cookies.get("session")
    if raw_key is None:
        raise _NOT_AUTHENTICATED

    session = await session_service.resolve(raw_key)
    if session is None:
        raise _NOT_AUTHENTICATED

    user = await db.get(User, session.user_id)
    # проекции может не быть, если сверка ещё не завела пользователя
    if user is None or not user.is_active:
        raise _NOT_AUTHENTICATED
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


def require_roles(*roles: UserRole) -> Callable[[User], User]:
    """зависимость, пропускающая только перечисленные роли"""
    allowed = frozenset(roles)
    detail = f"Requires role: {', '.join(sorted(role.value for role in allowed))}"

    def dependency(user: CurrentUser) -> User:
        if user.role not in allowed:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=detail)
        return user

    return dependency


AdminUser = Annotated[User, Depends(require_roles(UserRole.ADMIN))]
SupervisorUser = Annotated[User, Depends(require_roles(UserRole.SUPERVISER))]
ManagerUser = Annotated[User, Depends(require_roles(UserRole.MANAGER))]
StaffUser = Annotated[
    User, Depends(require_roles(UserRole.MANAGER, UserRole.SUPERVISER))
]
