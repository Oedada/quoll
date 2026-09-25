"""Сводка для админа: что застряло и требует внимания человека.

любое ненулевое число, кроме счётчиков дееспособных, - повод разобраться.
Метрик и хранилища тактов нет сознательно: хватает счётчиков из базы
"""

from datetime import timedelta

from fastapi import APIRouter, Depends
from sqlalchemy import func, not_, select

from quoll.auth.dependencies import AdminOnly, get_current_user
from quoll.auth.identity_policy import incapacitated_expression
from quoll.auth.models import Manager, User, UserRole
from quoll.auth.pending_actions import PendingActionStatus, PendingOrgAction
from quoll.core.schemas import AppBaseModel
from quoll.db import SessionDep
from quoll.interactions.capacity_policy import blocking_filter_expression
from quoll.interactions.models import Interaction, PauseState
from quoll.workflows.models import Stage

admin_router = APIRouter(
    prefix="/api/v1/admin",
    tags=["Admin"],
    dependencies=[Depends(get_current_user), AdminOnly],
)


class HealthRead(AppBaseModel):
    failed_tasks: int
    tasks_waiting_over_3_days: int
    interactions_waiting_capacity_over_a_day: int
    managers_without_supervisor_with_work: int
    capable_supervisers: int
    capable_admins: int


@admin_router.get("/health-checks", response_model=HealthRead)
async def health_checks(session: SessionDep) -> HealthRead:
    def count(stmt):
        return session.scalar(select(func.count()).select_from(stmt.subquery()))

    def capable(role: UserRole):
        return count(
            select(User.id).where(
                User.role == role, not_(incapacitated_expression(User))
            )
        )

    return HealthRead(
        failed_tasks=await count(
            select(PendingOrgAction.id).where(
                PendingOrgAction.status == PendingActionStatus.FAILED
            )
        ),
        tasks_waiting_over_3_days=await count(
            select(PendingOrgAction.id).where(
                PendingOrgAction.status == PendingActionStatus.PENDING,
                PendingOrgAction.created_at < func.now() - timedelta(days=3),
            )
        ),
        interactions_waiting_capacity_over_a_day=await count(
            select(Interaction.id).where(
                Interaction.pause_state == PauseState.EXPIRED_WAITING_CAPACITY,
                Interaction.updated_at < func.now() - timedelta(days=1),
            )
        ),
        managers_without_supervisor_with_work=await count(
            select(Manager.id)
            .join(Interaction, Interaction.owner_id == Manager.id)
            .outerjoin(Stage, Interaction.state_id == Stage.id)
            .where(Manager.superviser_id.is_(None), blocking_filter_expression())
            .distinct()
        ),
        capable_supervisers=await capable(UserRole.SUPERVISER),
        capable_admins=await capable(UserRole.ADMIN),
    )
