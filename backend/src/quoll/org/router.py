from typing import Annotated

from fastapi import APIRouter, Depends

from quoll.auth.dependencies import SupervisorUser, get_current_user, require_roles
from quoll.auth.models import User, UserRole
from quoll.core import SystemDefaults
from quoll.org.dependencies import Limit, Offset, OrgRepoDep
from quoll.org.schemas import (
    ManagerLoadRead,
    SupervisorCapacityRead,
    SupervisorQuotaRead,
    TeamRead,
)

org_router = APIRouter(
    prefix="/api/v1/org",
    tags=["Org structure"],
    dependencies=[Depends(get_current_user)],
)

# витрины для разбора осиротевших и балансировки - руководителям и админу
Observer = Annotated[User, Depends(require_roles(UserRole.SUPERVISER, UserRole.ADMIN))]


def _except_self(user: User) -> str | None:
    # руководителю свою команду в чужих витринах не показываем
    return user.id if user.role == UserRole.SUPERVISER else None


@org_router.get("/subordinates", response_model=TeamRead)
async def my_team(user: SupervisorUser, repo: OrgRepoDep) -> TeamRead:
    # SupervisorUser пропускает только руководителя, а загружен он подтипом
    return TeamRead(
        max_subordinates=user.max_subordinates,  # pyright: ignore[reportAttributeAccessIssue]
        members=await repo.team(user.id),
    )


@org_router.get("/subordinates/assignment-pool", response_model=list[ManagerLoadRead])
async def assignment_pool(
    user: SupervisorUser,
    repo: OrgRepoDep,
    limit: Limit = SystemDefaults.DEFAULT_PAGE_SIZE,
    offset: Offset = 0,
):
    return await repo.assignment_pool(user.id, limit, offset)


@org_router.get("/managers/recruitment-pool", response_model=list[ManagerLoadRead])
async def recruitment_pool(
    _: SupervisorUser,
    repo: OrgRepoDep,
    limit: Limit = SystemDefaults.DEFAULT_PAGE_SIZE,
    offset: Offset = 0,
):
    return await repo.recruitment_pool(limit, offset)


@org_router.get("/managers/orphaned", response_model=list[ManagerLoadRead])
async def orphaned_pool(
    _: Observer,
    repo: OrgRepoDep,
    limit: Limit = SystemDefaults.DEFAULT_PAGE_SIZE,
    offset: Offset = 0,
):
    return await repo.orphaned_pool(limit, offset)


@org_router.get(
    "/supervisors/available-project-capacity",
    response_model=list[SupervisorCapacityRead],
)
async def available_project_capacity(user: Observer, repo: OrgRepoDep):
    return await repo.free_project_capacity(_except_self(user))


@org_router.get(
    "/supervisors/available-team-quota", response_model=list[SupervisorQuotaRead]
)
async def available_team_quota(user: Observer, repo: OrgRepoDep):
    return await repo.free_team_quota(_except_self(user))
