"""Значения полей шага: номер договора, срок лицензии, число обученных.

правят владелец и его руководитель - на текущем и на пройденных шагах: поле
«число обученных» дописывают со временем. Под захватом области: переход
проверяет обязательные поля под той же блокировкой
"""

from typing import Any

from sqlalchemy import exists, func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from quoll.auth.audit import record
from quoll.auth.audit_models import AuditEventType, TargetType
from quoll.core.exceptions import DomainRuleException, OperationForbiddenException
from quoll.interactions.access_policy import can_change
from quoll.interactions.models import InteractionStageHistory, InteractionStageValues
from quoll.interactions.scope import lock_interaction_scope
from quoll.interactions.step_policy import value_problems
from quoll.interactions.transition_service import stage_values
from quoll.workflows.models import Stage


async def set_values(
    session: AsyncSession,
    *,
    interaction_id: int,
    stage_id: int,
    values: dict[str, Any],
    actor_id: str,
) -> InteractionStageValues:
    scope = await lock_interaction_scope(session, interaction_id, actor_id)
    interaction = scope.interaction
    if not can_change(scope.actor, scope.ownership):
        raise OperationForbiddenException("fill steps of this interaction")
    stage = await session.get(Stage, stage_id)
    if stage is None or stage.workflow_id != interaction.workflow_id:
        raise DomainRuleException(400, "Stage belongs to another workflow")
    visited = await session.scalar(
        select(
            exists().where(
                InteractionStageHistory.interaction_id == interaction_id,
                InteractionStageHistory.to_stage_id == stage_id,
            )
        )
    )
    if stage_id != interaction.state_id and not visited:
        raise DomainRuleException(409, "Stage is not reached yet")
    if problems := value_problems(stage.fields, values):
        raise DomainRuleException(422, "; ".join(problems))

    old = await stage_values(session, interaction_id, stage_id)
    table = InteractionStageValues.__table__
    row_id = await session.scalar(
        pg_insert(table)
        .values(
            interaction_id=interaction_id,
            stage_id=stage_id,
            values=values,
            updated_by=actor_id,
        )
        .on_conflict_do_update(
            constraint="uq_stage_values_interaction_stage",
            set_={"values": values, "updated_by": actor_id, "updated_at": func.now()},
        )
        .returning(table.c.id)
    )
    record(
        session,
        actor_id=actor_id,
        event_type=AuditEventType.STAGE_VALUES_CHANGED,
        target_type=TargetType.INTERACTION,
        target_id=interaction_id,
        old_value={"stage_id": stage_id, "values": old},
        new_value={"stage_id": stage_id, "values": values},
    )
    return await session.get(InteractionStageValues, row_id, populate_existing=True)


async def all_values(
    session: AsyncSession, interaction_id: int
) -> list[InteractionStageValues]:
    return list(
        await session.scalars(
            select(InteractionStageValues)
            .where(InteractionStageValues.interaction_id == interaction_id)
            .order_by(InteractionStageValues.stage_id)
        )
    )
