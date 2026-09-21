from typing import Annotated

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from quoll.auth.models import User, UserRole
from quoll.auth.repositories import SessionRepository, UserRepository
from quoll.core import UserNotFoundException
from quoll.db import get_db_session


async def get_session_repo(
    db_session: AsyncSession = Depends(get_db_session),  # noqa: B008
) -> SessionRepository:
    return SessionRepository(db_session)


async def get_user_repo(
    req: Request, session: AsyncSession = Depends(get_db_session)  # noqa: B008
) -> UserRepository:
    return UserRepository(session)


async def get_current_user(
    req: Request,
    session_repo: SessionRepository = Depends(get_session_repo),  # noqa: B008
    user_repo: UserRepository = Depends(get_user_repo),  # noqa: B008
) -> User:
    session_id = req.cookies.get("session")
    if session_id is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated"
        )
    try:
        session = await session_repo.get(session_id)
        return await user_repo.get(session.user_id)
    except UserNotFoundException:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated"
        )


def require_admin(user: User = Depends(get_current_user)) -> User:  # noqa: B008
    if user.role != UserRole.ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required"
        )
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]
AdminUser = Annotated[User, Depends(require_admin)]
