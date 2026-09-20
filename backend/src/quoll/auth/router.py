from dataclasses import dataclass

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.responses import RedirectResponse

from quoll.auth.dependencies import (
    AdminUser,
    CurrentUser,
    get_session_repo,
    get_user_repo,
)
from quoll.auth.keycloak_client import keycloak_client
from quoll.auth.models import Session, User
from quoll.auth.repositories import SessionRepository, UserRepository
from quoll.auth.schemas import UserCreate, UserListRead, UserRead, UserUpdate
from quoll.config import settings

router = APIRouter()


@dataclass
class Tokens:
    access: str
    refresh: str


sessions: dict[str, Tokens] = {}


@router.get("/")
def root(req: Request, user: CurrentUser):
    return user.__dict__


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(
    req: Request,
    response: Response,
    session_repo: SessionRepository = Depends(get_session_repo),  # noqa: B008
) -> None:
    session_id = req.cookies.get("session")
    if not session_id is None:
        print("logout")
        await keycloak_client.http_client.post(
            f"{settings.keycloak_root_url}/realms/{keycloak_client.realm}/protocol/openid-connect/logout",
            data={
                "client_id": keycloak_client.id,
                "client_secret": keycloak_client.secret,
                "refresh_token": (await session_repo.get(session_id)).refresh_token,
            },
        )
        await session_repo.delete(session_id)
    response.delete_cookie("session", path="/")


@router.get("/auth")
def auth():
    url = (
        f"{settings.keycloak_root_url}/realms/{keycloak_client.realm}/protocol/openid-connect/auth"
        f"?client_id={settings.keycloak_client_id}"
        f"&redirect_uri={settings.keycloak_redirect_uri}"
        f"&client_secret={keycloak_client.secret}"
        f"&response_type=code"
        f"&scope=openid"
    )
    return RedirectResponse(url)


@router.get("/callback")
async def callback(
    code: str,
    session_repo: SessionRepository = Depends(get_session_repo),  # noqa: B008
):
    session = await session_repo.create(
        schema_or_data=await Session.get_session_for_code(
            code, settings.keycloak_redirect_uri
        )
    )
    response = RedirectResponse("http://localhost:3000")
    response.set_cookie("session", session.id, httponly=True)
    return response


@router.get("/me", response_model=UserRead)
async def get_me(user: CurrentUser) -> UserRead:
    return UserRead(
        id=user.id,
        username=user.username,
        email=user.email,
        first_name=user.first_name,
        last_name=user.last_name,
        role=user.role,
    )


@router.get("/users", response_model=UserListRead)
async def list_users(
    admin_user: AdminUser,
    user_repo: UserRepository = Depends(get_user_repo),  # noqa: B008
    limit: int = 100,
    offset: int = 0,
) -> UserListRead:
    users = await user_repo.get_all(limit=limit, offset=offset)
    return UserListRead(
        users=[
            UserRead(
                id=u.id,
                username=u.username,
                email=u.email,
                first_name=u.first_name,
                last_name=u.last_name,
                role=u.role,
            )
            for u in users
        ],
        limit=limit,
        offset=offset,
    )


@router.get("/users/{user_id}", response_model=UserRead)
async def get_user(
    user_id: str,
    admin_user: AdminUser,
    user_repo: UserRepository = Depends(get_user_repo),  # noqa: B008
) -> UserRead:
    user = await user_repo.get(user_id)
    return UserRead(
        id=user.id,
        username=user.username,
        email=user.email,
        first_name=user.first_name,
        last_name=user.last_name,
        role=user.role,
    )


@router.post("/users", response_model=UserRead, status_code=201)
async def create_user(
    user_data: UserCreate,
    admin_user: AdminUser,
    user_repo: UserRepository = Depends(get_user_repo),  # noqa: B008
) -> UserRead:
    user = User(
        id="",
        username=user_data.username,
        email=user_data.email,
        first_name=user_data.first_name,
        last_name=user_data.last_name,
        role=user_data.role,
    )
    user_id = await user_repo.create(user, user_data.password)
    created_user = await user_repo.get(user_id)
    return UserRead(
        id=created_user.id,
        username=created_user.username,
        email=created_user.email,
        first_name=created_user.first_name,
        last_name=created_user.last_name,
        role=created_user.role,
    )


@router.patch("/users/{user_id}", response_model=UserRead)
async def update_user(
    user_id: str,
    user_data: UserUpdate,
    admin_user: AdminUser,
    user_repo: UserRepository = Depends(get_user_repo),  # noqa: B008
) -> UserRead:
    current_user = await user_repo.get(user_id)
    updated_user = await user_repo.update(
        user_id,
        User(
            id=current_user.id,
            username=current_user.username,
            email=user_data.email
            if user_data.email is not None
            else current_user.email,
            first_name=user_data.first_name
            if user_data.first_name is not None
            else current_user.first_name,
            last_name=user_data.last_name
            if user_data.last_name is not None
            else current_user.last_name,
            role=current_user.role,
        ),
    )
    return UserRead(
        id=updated_user.id,
        username=updated_user.username,
        email=updated_user.email,
        first_name=updated_user.first_name,
        last_name=updated_user.last_name,
        role=updated_user.role,
    )


@router.delete("/users/{user_id}", status_code=204)
async def delete_user(
    user_id: str,
    admin_user: AdminUser,
    user: CurrentUser,
    user_repo: UserRepository = Depends(get_user_repo),  # noqa: B008
) -> None:
    if user.id == user_id:
        raise HTTPException(
            status_code=418,
            detail="The server refuses to delete the admin. It is a teapot."
        )
    await user_repo.delete(user_id)
