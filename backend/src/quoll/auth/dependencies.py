from collections.abc import Callable
from typing import Annotated

from fastapi import (
    Depends,
    HTTPException,
    Request,
    WebSocket,
    WebSocketException,
    status,
)
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from quoll.auth.crypto import TokenCipher
from quoll.auth.models import (
    IdentitySyncStatus,
    RoleTransitionStatus,
    User,
    UserRole,
)
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

SESSION_COOKIE = "session"


async def _load_user(
    raw_key: str | None, session_service: SessionService, db: AsyncSession
) -> User | None:
    if raw_key is None:
        return None
    session = await session_service.resolve(raw_key)
    if session is None:
        return None
    # проекции может не быть, если её ещё никто не завёл
    return await db.get(User, session.user_id)


def _identity_denial(user: User | None) -> tuple[int, str] | None:
    """почему пользователя нельзя пускать, или None, если можно"""
    if user is None or not user.is_active:
        return status.HTTP_401_UNAUTHORIZED, "Not authenticated"
    if user.identity_sync_status != IdentitySyncStatus.OK:
        return status.HTTP_403_FORBIDDEN, "Account role mapping is inconsistent"
    # П8 - на время смены роли учётка блокируется полностью, чтение тоже
    if user.role_transition_status != RoleTransitionStatus.NONE:
        return status.HTTP_409_CONFLICT, "Role transition in progress"
    return None


async def get_current_user(
    req: Request,
    db: SessionDep,
    session_service: SessionServiceDep,
) -> User:
    """текущий пользователь из локальной проекции.

    в Keycloak на чтении не ходим, сессию он подтверждает внутри resolve и не
    чаще раза в интервал сверки
    """
    user = await _load_user(req.cookies.get(SESSION_COOKIE), session_service, db)
    denial = _identity_denial(user)
    if denial is not None:
        raise HTTPException(*denial)
    return user


async def get_websocket_user(websocket: WebSocket) -> User:
    """то же для сокета - зависимости с Request на нём не заполняются,
    поэтому и сессию БД открываем сами"""
    maker = websocket.app.state.db_session_maker
    async with maker() as db:
        user = await _load_user(
            websocket.cookies.get(SESSION_COOKIE), build_session_service(maker), db
        )
    denial = _identity_denial(user)
    if denial is not None:
        raise WebSocketException(code=status.WS_1008_POLICY_VIOLATION, reason=denial[1])
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]
WebSocketUser = Annotated[User, Depends(get_websocket_user)]


def require_roles(*roles: UserRole) -> Callable[[User], User]:
    """зависимость, пропускающая только перечисленные роли"""
    allowed = frozenset(roles)
    detail = f"Requires role: {', '.join(sorted(role.value for role in allowed))}"

    def dependency(user: CurrentUser) -> User:
        if user.role not in allowed:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=detail)
        return user

    return dependency


_require_admin = require_roles(UserRole.ADMIN)

_require_supervisor = require_roles(UserRole.SUPERVISER)

AdminUser = Annotated[User, Depends(_require_admin)]
SupervisorUser = Annotated[User, Depends(_require_supervisor)]
# для эндпоинтов, которым нужна только проверка, а сам пользователь - нет
AdminOnly = Depends(_require_admin)
SupervisorOnly = Depends(_require_supervisor)
ManagerUser = Annotated[User, Depends(require_roles(UserRole.MANAGER))]
StaffUser = Annotated[
    User, Depends(require_roles(UserRole.MANAGER, UserRole.SUPERVISER))
]
