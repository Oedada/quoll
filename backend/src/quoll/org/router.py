from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response, status

from quoll.auth.dependencies import (
    AdminUser,
    CurrentUser,
    ManagerUser,
    SessionDep,
    SupervisorUser,
    get_current_user,
    require_roles,
)
from quoll.auth.models import Manager, Superviser, User, UserRole
from quoll.core import SystemDefaults
from quoll.core.exceptions import OperationForbiddenException, UserNotFoundException
from quoll.org import service
from quoll.org.dependencies import Limit, Offset, OrgRepoDep
from quoll.org.repository import OrgRepository
from quoll.org.schemas import (
    LimitsUpdate,
    ManagerLoadRead,
    PendingActionRead,
    PersonRead,
    ProfileRead,
    RecruitRequest,
    SupervisorCapacityRead,
    SupervisorQuotaRead,
    TeamRead,
    TransferRequest,
    WorkloadUpdate,
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


# --- профили и пределы


@org_router.get("/people", response_model=list[PersonRead])
async def people(
    repo: OrgRepoDep,
    ids: Annotated[list[str], Query(max_length=SystemDefaults.MAX_PAGE_SIZE)],
) -> list[User]:
    """имена для истории, просьб и авторов - любому вошедшему: иначе
    руководитель видит в чужой истории только идентификаторы"""
    return await repo.people(ids)


@org_router.get("/profiles/{user_id}", response_model=ProfileRead)
async def get_profile(
    user_id: str, viewer: CurrentUser, session: SessionDep, repo: OrgRepoDep
) -> ProfileRead:
    """менеджер - себя, руководитель - себя и своих, админ - любого"""
    user = await session.get(User, user_id)
    if user is None:
        raise UserNotFoundException(user_id)
    own_subordinate = isinstance(user, Manager) and user.superviser_id == viewer.id
    if viewer.id != user_id and viewer.role != UserRole.ADMIN and not own_subordinate:
        raise OperationForbiddenException("read this profile")

    profile = ProfileRead.model_validate(user)
    if isinstance(user, Manager):
        profile.load = await _read(repo, user.id)
    if isinstance(user, Superviser):
        profile.max_subordinates = user.max_subordinates
        profile.team_size = await repo.team_size(user.id)
    return profile


@org_router.patch("/profiles/{user_id}/limits", status_code=status.HTTP_204_NO_CONTENT)
async def set_limits(
    user_id: str, body: LimitsUpdate, admin: AdminUser, session: SessionDep
):
    await service.set_limits(
        session,
        actor_id=admin.id,
        user_id=user_id,
        max_active_projects=body.max_active_projects,
        max_subordinates=body.max_subordinates,
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@org_router.patch("/profiles/me/workload", response_model=ManagerLoadRead)
async def set_my_workload(
    body: WorkloadUpdate, user: ManagerUser, session: SessionDep, repo: OrgRepoDep
):
    await service.set_workload_status(
        session, manager_id=user.id, status=body.manual_workload_status
    )
    return await _read(repo, user.id)


@org_router.get("/pending-actions", response_model=list[PendingActionRead])
async def pending_actions(
    user: Observer,
    repo: OrgRepoDep,
    limit: Limit = SystemDefaults.DEFAULT_PAGE_SIZE,
    offset: Offset = 0,
):
    return await repo.pending_actions(user, limit, offset)
