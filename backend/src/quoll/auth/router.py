from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    Query,
    Request,
    Response,
    status,
)
from fastapi.responses import RedirectResponse

from quoll.auth.dependencies import (
    AdminUser,
    CurrentUser,
    SessionServiceDep,
    get_user_repo,
)
from quoll.auth.keycloak_client import keycloak_client
from quoll.auth.models import User, user_class_for_role
from quoll.auth.repositories import UserRepository
from quoll.auth.schemas import UserCreate, UserListRead, UserRead, UserUpdate
from quoll.config import settings
from quoll.core import SystemDefaults

router = APIRouter(tags=["Auth"])
users_router = APIRouter(prefix="/api/v1/users", tags=["Users"])

SESSION_COOKIE = "session"


@router.get("/")
def login():
    url = (
        f"{settings.keycloak_root_url}/realms/{keycloak_client.realm}/protocol/openid-connect/auth"
        f"?client_id={settings.keycloak_client_id}"
        f"&redirect_uri={settings.keycloak_redirect_uri}"
        f"&client_secret={keycloak_client.secret}"
        f"&response_type=code"
        f"&scope=openid"
    )
    return RedirectResponse(url)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(
    req: Request,
    response: Response,
    session_service: SessionServiceDep,
) -> None:
    raw_key = req.cookies.get(SESSION_COOKIE)
    if raw_key is not None:
        await session_service.revoke(raw_key)
    response.delete_cookie(SESSION_COOKIE, path="/")


@router.get("/callback")
async def callback(code: str, session_service: SessionServiceDep):
    raw_key, max_age = await session_service.create_from_code(
        code, settings.keycloak_redirect_uri
    )
    response = RedirectResponse("http://127.0.0.1:8000/front")
    response.set_cookie(
        SESSION_COOKIE,
        raw_key,
        max_age=max_age,
        path="/",
        httponly=True,
        secure=settings.session_cookie_secure,
        samesite="lax",
    )
    return response


@users_router.get("/me", response_model=UserRead)
async def get_me(user: CurrentUser) -> UserRead:
    return UserRead(
        id=user.id,
        username=user.username,
        email=user.email,
        first_name=user.first_name,
        last_name=user.last_name,
        role=user.role,
        superviser_id=getattr(user, "superviser_id", None),
    )


@users_router.get("/", response_model=UserListRead)
async def list_users(
    admin_user: AdminUser,
    user_repo: UserRepository = Depends(get_user_repo),  # noqa: B008
    limit: int = Query(
        default=SystemDefaults.DEFAULT_PAGE_SIZE,
        ge=1,
        le=SystemDefaults.MAX_PAGE_SIZE,
    ),
    offset: int = Query(default=0, ge=0),
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


@users_router.get("/{user_id}", response_model=UserRead)
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
        superviser_id=getattr(user, "superviser_id", None),
    )


@users_router.post("/", response_model=UserRead, status_code=201)
async def create_user(
    user_data: UserCreate,
    admin_user: AdminUser,
    user_repo: UserRepository = Depends(get_user_repo),  # noqa: B008
) -> UserRead:
    user = user_class_for_role(user_data.role)(
        id="",
        username=user_data.username,
        email=user_data.email,
        first_name=user_data.first_name,
        last_name=user_data.last_name,
        role=user_data.role,
        is_active=True,
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
        superviser_id=getattr(created_user, "superviser_id", None),
    )


@users_router.post(
    "/connections/{superviser_id}", status_code=status.HTTP_204_NO_CONTENT
)
async def set_connection(
    superviser_id: str,
    manager_id: str,
    admin_user: AdminUser,
    user_repo: UserRepository = Depends(get_user_repo),  # noqa: B008
):
    await user_repo.set_superviser(manager_id, superviser_id)


@users_router.patch("/{user_id}", response_model=UserRead)
async def update_user(
    user_id: str,
    user_data: UserUpdate,
    admin_user: AdminUser,
    user_repo: UserRepository = Depends(get_user_repo),  # noqa: B008
) -> UserRead:
    current_user = await user_repo.get(user_id)
    updated_user = await user_repo.update(
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
        superviser_id=getattr(updated_user, "superviser_id", None),
    )


@users_router.delete("/{user_id}", status_code=204)
async def delete_user(
    user_id: str,
    admin_user: AdminUser,
    user: CurrentUser,
    user_repo: UserRepository = Depends(get_user_repo),  # noqa: B008
) -> None:
    if user.id == user_id:
        raise HTTPException(
            status_code=418,
            detail="The server refuses to delete the admin. It is a teapot.",
        )
    await user_repo.delete(user_id)
