from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response, status

from quoll.auth.dependencies import (
    SessionDep,
    SupervisorUser,
    get_current_user,
    require_roles,
)
from quoll.auth.models import Manager, User, UserRole
from quoll.core import SystemDefaults
from quoll.org import service
from quoll.org.dependencies import Limit, Offset, OrgRepoDep
from quoll.org.repository import OrgRepository
from quoll.org.schemas import (
    ManagerLoadRead,
    RecruitRequest,
    SupervisorCapacityRead,
    SupervisorQuotaRead,
    TeamRead,
    TransferRequest,
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


async def _read(repo: OrgRepository, manager_id: str) -> ManagerLoadRead:
    """менеджер после операции - в том же виде, что в витринах"""
    [row] = await repo.managers_where(Manager.id == manager_id)
    return row


@org_router.post("/subordinates/{manager_id}", response_model=ManagerLoadRead)
async def recruit(
    manager_id: str,
    body: RecruitRequest,
    user: SupervisorUser,
    session: SessionDep,
    repo: OrgRepoDep,
):
    await service.recruit(
        session,
        actor_id=user.id,
        manager_id=manager_id,
        expected_superviser_id=body.expected_superviser_id,
    )
    return await _read(repo, manager_id)


@org_router.post("/subordinates/{manager_id}/transfer", response_model=ManagerLoadRead)
async def transfer(
    manager_id: str,
    body: TransferRequest,
    user: SupervisorUser,
    session: SessionDep,
    repo: OrgRepoDep,
):
    await service.transfer(
        session,
        actor_id=user.id,
        manager_id=manager_id,
        to_superviser_id=body.to_superviser_id,
        expected_superviser_id=body.expected_superviser_id,
    )
    return await _read(repo, manager_id)


@org_router.post("/subordinates/{manager_id}/adopt", response_model=ManagerLoadRead)
async def adopt(
    manager_id: str,
    body: RecruitRequest,
    user: SupervisorUser,
    session: SessionDep,
    repo: OrgRepoDep,
):
    await service.adopt(
        session,
        actor_id=user.id,
        manager_id=manager_id,
        expected_superviser_id=body.expected_superviser_id,
    )
    return await _read(repo, manager_id)


@org_router.delete("/subordinates/{manager_id}", status_code=status.HTTP_204_NO_CONTENT)
async def release(
    manager_id: str,
    user: SupervisorUser,
    session: SessionDep,
    # у DELETE нет тела - ожидаемый руководитель в запросе
    expected_superviser_id: str = Query(),
):
    await service.release(
        session,
        actor_id=user.id,
        manager_id=manager_id,
        expected_superviser_id=expected_superviser_id,
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)
