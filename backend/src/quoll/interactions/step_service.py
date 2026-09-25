"""Значения полей шага: номер договора, срок лицензии, число обученных.

правят владелец и его руководитель - на текущем и на пройденных шагах: поле
«число обученных» дописывают со временем. Под захватом области: переход
проверяет обязательные поля под той же блокировкой
"""

from typing import Any

from sqlalchemy import exists, func, or_, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from quoll.auth.audit import record
from quoll.auth.audit_models import AuditEventType, TargetType
from quoll.auth.models import UserRole
from quoll.core.exceptions import DomainRuleException, OperationForbiddenException
from quoll.interactions.access_policy import can_change, can_close
from quoll.interactions.models import (
    InteractionBranch,
    InteractionStageHistory,
    InteractionStageValues,
)
from quoll.interactions.notify import notify
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
    branch_id: int | None = None,
) -> InteractionStageValues:
    scope = await lock_interaction_scope(session, interaction_id, actor_id)
    interaction = scope.interaction
    if not can_change(scope.actor, scope.ownership):
        raise OperationForbiddenException("fill steps of this interaction")
    stage = await session.get(Stage, stage_id)
    if stage is None or stage.workflow_id != interaction.workflow_id:
        raise DomainRuleException(400, "Stage belongs to another workflow")
    # у шага ветки - значения своей ветки, у шага договора - общие
    current = interaction.state_id
    if branch_id is not None:
        branch = await session.get(InteractionBranch, branch_id)
        if branch is None or branch.interaction_id != interaction_id:
            raise DomainRuleException(404, "Branch is not in this interaction")
        current = branch.state_id
    if stage.is_branch_stage != (branch_id is not None):
        raise DomainRuleException(400, "Branch stages are filled per branch")
    visited = await session.scalar(
        select(
            exists().where(
                InteractionStageHistory.interaction_id == interaction_id,
                InteractionStageHistory.branch_id.is_not_distinct_from(branch_id),
                # пройдена - и та, куда пришли, и та, с которой ушли
                or_(
                    InteractionStageHistory.to_stage_id == stage_id,
                    InteractionStageHistory.from_stage_id == stage_id,
                ),
            )
        )
    )
    if stage_id != current and not visited:
        raise DomainRuleException(409, "Stage is not reached yet")
    if problems := value_problems(stage.fields, values):
        raise DomainRuleException(422, "; ".join(problems))

    old = await stage_values(session, interaction_id, stage_id, branch_id)
    gated = {f["key"] for f in stage.fields if f.get("approval_after_pass")}
    changed = {k for k in old.keys() | values.keys() if old.get(k) != values.get(k)}
    if scope.actor.role == UserRole.MANAGER and stage_id != current and changed & gated:
        # правку пройденного шага с такими полями одобряет руководитель
        row = await _upsert(session, interaction_id, stage_id, branch_id, old, actor_id)
        row.pending_values = values
        row.pending_by = actor_id
        await session.flush()
        # updated_at ставит база - без refresh ответ полез бы за ним вне greenlet
        await session.refresh(row)
        if scope.owner is not None:
            notify(
                session,
                scope.owner.superviser_id,
                "Правка шага ждёт одобрения",
                f"Взаимодействие {interaction_id}, шаг «{stage.name}»: "
                + ", ".join(sorted(changed & gated)),
                {"interaction_id": interaction_id, "stage_id": stage_id},
            )
        return row

    row = await _upsert(session, interaction_id, stage_id, branch_id, values, actor_id)
    _journal(session, actor_id, interaction_id, stage_id, old, values)
    return row


async def decide(
    session: AsyncSession,
    *,
    interaction_id: int,
    stage_id: int,
    actor_id: str,
    approve: bool,
    branch_id: int | None = None,
) -> InteractionStageValues:
    """руководитель владельца решает по ждущей правке пройденного шага"""
    scope = await lock_interaction_scope(session, interaction_id, actor_id)
    if not can_close(scope.actor, scope.ownership):
        raise OperationForbiddenException("decide on step values")
    row = await session.scalar(
        select(InteractionStageValues)
        .where(
            InteractionStageValues.interaction_id == interaction_id,
            InteractionStageValues.stage_id == stage_id,
            InteractionStageValues.branch_id.is_not_distinct_from(branch_id),
        )
        .execution_options(populate_existing=True)
    )
    if row is None or row.pending_values is None:
        raise DomainRuleException(409, "No step values wait for a decision")
    author, pending = row.pending_by, row.pending_values
    row.pending_values = None
    row.pending_by = None
    if approve:
        _journal(session, actor_id, interaction_id, stage_id, row.values, pending)
        row.values = pending
        row.updated_by = author
    await session.flush()
    notify(
        session,
        author,
        "Правка шага одобрена" if approve else "Правка шага отклонена",
        f"Взаимодействие {interaction_id}",
        {"interaction_id": interaction_id, "stage_id": stage_id},
    )
    await session.refresh(row)
    return row


async def _upsert(
    session: AsyncSession,
    interaction_id: int,
    stage_id: int,
    branch_id: int | None,
    values: dict[str, Any],
    actor_id: str,
) -> InteractionStageValues:
    table = InteractionStageValues.__table__
    row_id = await session.scalar(
        pg_insert(table)
        .values(
            interaction_id=interaction_id,
            stage_id=stage_id,
            branch_id=branch_id,
            values=values,
            updated_by=actor_id,
        )
        .on_conflict_do_update(
            index_elements=["interaction_id", "stage_id", "branch_id"],
            set_={"values": values, "updated_by": actor_id, "updated_at": func.now()},
        )
        .returning(table.c.id)
    )
    return await session.get(InteractionStageValues, row_id, populate_existing=True)


def _journal(session, actor_id, interaction_id, stage_id, old, new) -> None:
    record(
        session,
        actor_id=actor_id,
        event_type=AuditEventType.STAGE_VALUES_CHANGED,
        target_type=TargetType.INTERACTION,
        target_id=interaction_id,
        old_value={"stage_id": stage_id, "values": old},
        new_value={"stage_id": stage_id, "values": new},
    )


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
