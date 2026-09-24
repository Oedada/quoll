import secrets

from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    Query,
    Request,
    Response,
    status,
)
from fastapi.responses import JSONResponse, RedirectResponse

from quoll.auth import login_service, oidc
from quoll.auth.dependencies import (
    SESSION_COOKIE,
    AdminUser,
    CurrentUser,
    SessionDep,
    SessionServiceDep,
    get_current_user,
    get_user_repo,
    token_cipher,
)
from quoll.auth.login_service import LoginDenied
from quoll.auth.models import User, user_class_for_role
from quoll.auth.repositories import UserRepository
from quoll.auth.schemas import UserCreate, UserListRead, UserRead, UserUpdate
from quoll.config import settings
from quoll.core import LoginFlowException, SystemDefaults

router = APIRouter(tags=["Auth"])
users_router = APIRouter(
    prefix="/api/v1/users",
    tags=["Users"],
    dependencies=[Depends(get_current_user)],
)


@router.get("/")
def login() -> RedirectResponse:
    flow = oidc.new_flow()
    response = RedirectResponse(oidc.authorization_url(flow))
    response.set_cookie(
        oidc.FLOW_COOKIE,
        oidc.seal(flow, token_cipher),
        max_age=oidc.FLOW_TTL_SECONDS,
        # нужна только колбэку
        path="/auth",
        httponly=True,
        secure=settings.session_cookie_secure,
        # lax, а не strict - иначе кука не доедет при возврате из Keycloak
        samesite="lax",
    )
    return response


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
async def callback(
    code: str,
    state: str,
    req: Request,
    db: SessionDep,
    session_service: SessionServiceDep,
) -> Response:
    flow = oidc.unseal(req.cookies.get(oidc.FLOW_COOKIE), token_cipher)
    # байты, а не строки: на не-ASCII строках compare_digest падает с TypeError
    if flow is None or not secrets.compare_digest(flow.state.encode(), state.encode()):
        raise LoginFlowException("state does not match or login flow expired")

    result = await login_service.complete_login(db, session_service, code, flow)
    if isinstance(result, LoginDenied):
        response: Response = JSONResponse(
            {"detail": result.detail}, status_code=result.status_code
        )
    else:
        response = RedirectResponse(settings.post_login_redirect_url)
        response.set_cookie(
            SESSION_COOKIE,
            result.raw_key,
            max_age=result.max_age,
            path="/",
            httponly=True,
            secure=settings.session_cookie_secure,
            samesite="lax",
        )
    # кука потока больше не нужна. Повтор колбэка всё равно упрётся в Keycloak -
    # код авторизации одноразовый
    response.delete_cookie(oidc.FLOW_COOKIE, path="/auth")
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
