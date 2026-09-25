"""Договор: состав продуктов и ветки по ним после подписания.

один вуз - один договор, продукты внутри него. До точки невозврата
(подписания) состав - черновик; при подписании каждый одобренный продукт
получает свою ветку, и шаги 5-8 идут по продуктам независимо. Ветки своих
блокировок не имеют: всё - под блокировкой взаимодействия
"""

from sqlalchemy import exists, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from quoll.auth.audit import record
from quoll.auth.audit_models import AuditEventType, TargetType
from quoll.catalog.models import Product
from quoll.core.exceptions import DomainRuleException, OperationForbiddenException
from quoll.interactions.access_policy import can_change
from quoll.interactions.models import (
    ContractProductStatus,
    Interaction,
    InteractionBranch,
    InteractionProduct,
    InteractionStageHistory,
    StageChangeKind,
)
from quoll.interactions.scope import InteractionScope, lock_interaction_scope
from quoll.workflows.models import Stage, WorkflowTransition


async def is_signed(session: AsyncSession, interaction_id: int) -> bool:
    """прошла ли точка невозврата - после неё состав не меняется"""
    return bool(
        await session.scalar(
            select(
                exists()
                .where(InteractionStageHistory.interaction_id == interaction_id)
                .where(InteractionStageHistory.transition_id == WorkflowTransition.id)
                .where(WorkflowTransition.is_irreversible.is_(True))
            )
        )
    )


async def _draft_scope(
    session: AsyncSession, interaction_id: int, actor_id: str
) -> InteractionScope:
    scope = await lock_interaction_scope(session, interaction_id, actor_id)
    if not can_change(scope.actor, scope.ownership):
        raise OperationForbiddenException("change products of this interaction")
    if await is_signed(session, interaction_id):
        raise DomainRuleException(
            409, "Contract is signed, products change by a supplementary agreement"
        )
    return scope


async def add_product(
    session: AsyncSession, *, interaction_id: int, product_id: int, actor_id: str
) -> InteractionProduct:
    await _draft_scope(session, interaction_id, actor_id)
    product = await session.get(Product, product_id)
    if product is None or not product.is_active:
        raise DomainRuleException(400, f"Product '{product_id}' is not in the catalog")
    item = InteractionProduct(
        interaction_id=interaction_id, product_id=product_id, added_by=actor_id
    )
    session.add(item)
    await session.flush()
    _journal(session, actor_id, interaction_id, {"added": product_id})
    await session.refresh(item)
    return item


async def set_status(
    session: AsyncSession,
    *,
    interaction_id: int,
    item_id: int,
    status: ContractProductStatus,
    actor_id: str,
) -> InteractionProduct:
    await _draft_scope(session, interaction_id, actor_id)
    item = await _item(session, interaction_id, item_id)
    old = item.status
    item.status = status
    await session.flush()
    _journal(
        session,
        actor_id,
        interaction_id,
        {"product_id": item.product_id, "status": status},
        {"status": old},
    )
    await session.refresh(item)
    return item


async def remove_product(
    session: AsyncSession, *, interaction_id: int, item_id: int, actor_id: str
) -> None:
    await _draft_scope(session, interaction_id, actor_id)
    item = await _item(session, interaction_id, item_id)
    await session.delete(item)
    await session.flush()
    _journal(session, actor_id, interaction_id, {"removed": item.product_id})


async def _item(
    session: AsyncSession, interaction_id: int, item_id: int
) -> InteractionProduct:
    item = await session.get(InteractionProduct, item_id)
    if item is None or item.interaction_id != interaction_id:
        raise DomainRuleException(404, "Product is not in this contract")
    return item


def _journal(session, actor_id, interaction_id, new, old=None) -> None:
    record(
        session,
        actor_id=actor_id,
        event_type=AuditEventType.CONTRACT_PRODUCTS_CHANGED,
        target_type=TargetType.INTERACTION,
        target_id=interaction_id,
        old_value=old,
        new_value=new,
    )


async def open_branches(
    session: AsyncSession, interaction: Interaction, actor_id: str
) -> None:
    """подписание: по ветке на каждый одобренный продукт, в начальной
    стадии веток. Воркфлоу без веток - ничего не делаем"""
    start = await session.scalar(
        select(Stage).where(
            Stage.workflow_id == interaction.workflow_id,
            Stage.is_branch_start.is_(True),
            Stage.archived_at.is_(None),
        )
    )
    if start is None:
        return
    approved = list(
        await session.scalars(
            select(InteractionProduct).where(
                InteractionProduct.interaction_id == interaction.id,
                InteractionProduct.status == ContractProductStatus.APPROVED,
            )
        )
    )
    if not approved:
        raise DomainRuleException(409, "Approve at least one product before signing")
    for item in approved:
        branch = InteractionBranch(
            interaction_id=interaction.id,
            interaction_product_id=item.id,
            state_id=start.id,
        )
        session.add(branch)
        await session.flush()
        session.add(
            InteractionStageHistory(
                interaction_id=interaction.id,
                branch_id=branch.id,
                from_stage_id=None,
                to_stage_id=start.id,
                kind=StageChangeKind.TRANSITION,
                actor_id=actor_id,
                comment="contract signed",
            )
        )
    record(
        session,
        actor_id=actor_id,
        event_type=AuditEventType.BRANCHES_OPENED,
        target_type=TargetType.INTERACTION,
        target_id=interaction.id,
        new_value={"products": [i.product_id for i in approved]},
    )


async def open_branch_count(session: AsyncSession, interaction_id: int) -> int:
    return (
        await session.scalar(
            select(func.count()).where(
                InteractionBranch.interaction_id == interaction_id,
                InteractionBranch.closed_at.is_(None),
            )
        )
        or 0
    )


async def close_all_branches(session: AsyncSession, interaction_id: int) -> None:
    """досрочное закрытие договора закрывает и ветки"""
    await session.execute(
        update(InteractionBranch)
        .where(
            InteractionBranch.interaction_id == interaction_id,
            InteractionBranch.closed_at.is_(None),
        )
        .values(closed_at=func.now())
    )


async def products(
    session: AsyncSession, interaction_id: int
) -> list[InteractionProduct]:
    return list(
        await session.scalars(
            select(InteractionProduct)
            .where(InteractionProduct.interaction_id == interaction_id)
            .order_by(InteractionProduct.id)
        )
    )


async def branches(
    session: AsyncSession, interaction_id: int
) -> list[InteractionBranch]:
    return list(
        await session.scalars(
            select(InteractionBranch)
            .where(InteractionBranch.interaction_id == interaction_id)
            .order_by(InteractionBranch.id)
        )
    )
