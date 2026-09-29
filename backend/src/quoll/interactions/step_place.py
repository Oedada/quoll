"""Место на карте заявки: шаг, опционально ветка или доп. прохождение.

вынесено из step_service.set_values - тем же местом пользуются комментарии.
Проверка идёт под lock_interaction_scope вызывающего; текстов ошибок не
меняем, чтобы старые тесты значений шагов остались зелёными
"""

from dataclasses import dataclass

from sqlalchemy import exists, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from quoll.core.exceptions import DomainRuleException
from quoll.interactions import contract_service
from quoll.interactions.models import (
    Branch,
    Interaction,
    InteractionStageHistory,
    SidePointer,
)
from quoll.workflows.models import Stage


@dataclass(frozen=True)
class Place:
    stage: Stage
    branch: Branch | None
    pointer: SidePointer | None
    # текущий шаг этого места (ветки, прохождения или заявки)
    current: int | None


async def resolve(
    session: AsyncSession,
    interaction: Interaction,
    *,
    stage_id: int,
    branch_id: int | None,
    side_pointer_id: int | None,
) -> Place:
    """стадия, ветка/прохождение места и проверка «текущий или пройденный»"""
    stage = await session.get(Stage, stage_id)
    if stage is None or stage.workflow_id != interaction.workflow_id:
        raise DomainRuleException(
            400, "Stage belongs to another workflow", code="APP-033"
        )
    current = interaction.state_id
    pointer = branch = None
    if side_pointer_id is not None:
        pointer = await contract_service.active_pass(
            session, interaction.id, side_pointer_id
        )
        contract_service.check_side_target(stage, branch_id)
        current = pointer.stage_id
    if branch_id is not None:
        branch = await session.get(Branch, branch_id)
        if branch is None or branch.interaction_id != interaction.id:
            raise DomainRuleException(
                404, "Branch is not in this interaction", code="BR-006"
            )
        if branch.state_id is None:
            raise DomainRuleException(
                409, "Branch is a draft until the contract is signed", code="BR-013"
            )
        current = branch.state_id
    if stage.is_branch_stage != (branch_id is not None):
        raise DomainRuleException(
            400, "Branch stages are filled per branch", code="BR-008"
        )
    if stage_id != current and not await _visited(
        session, interaction.id, stage_id, branch_id, side_pointer_id
    ):
        raise DomainRuleException(409, "Stage is not reached yet", code="STEP-006")
    return Place(stage, branch, pointer, current)


async def _visited(
    session: AsyncSession,
    interaction_id: int,
    stage_id: int,
    branch_id: int | None,
    side_pointer_id: int | None,
) -> bool:
    return bool(
        await session.scalar(
            select(
                exists().where(
                    InteractionStageHistory.interaction_id == interaction_id,
                    InteractionStageHistory.branch_id.is_not_distinct_from(branch_id),
                    InteractionStageHistory.side_pointer_id.is_not_distinct_from(
                        side_pointer_id
                    ),
                    # пройдена - и та, куда пришли, и та, с которой ушли
                    or_(
                        InteractionStageHistory.to_stage_id == stage_id,
                        InteractionStageHistory.from_stage_id == stage_id,
                    ),
                )
            )
        )
    )
