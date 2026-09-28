"""Допсоглашение (шаг 4.1, М 3.13, 6.1): черновик, отправка, применение.

своих блокировок у ДС и действий нет - их прикрывает взаимодействие. Что и
в каком порядке делается - технический дизайн блока 3
"""

from datetime import date
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from quoll.auth.audit_models import AuditEventType
from quoll.core.exceptions import (
    DomainRuleException,
    IdNotExistsException,
    OperationForbiddenException,
)
from quoll.interactions import sa_lifecycle
from quoll.interactions.access_policy import can_change
from quoll.interactions.bindings import check_signed_date, current_contract
from quoll.interactions.contract_service import check_pair
from quoll.interactions.document_service import current_scan
from quoll.interactions.models import (
    ActionType,
    AgreementAction,
    AgreementStatus,
    Branch,
    Interaction,
    InteractionRequest,
    RequestStatus,
    StageChangeKind,
    SupplementaryAgreement,
)
from quoll.interactions.scope import InteractionScope, lock_interaction_scope
from quoll.interactions.transition_service import share_stage
from quoll.workflows.models import Stage

OPEN = (AgreementStatus.DRAFT, AgreementStatus.PENDING)
WITH_BRANCH = (ActionType.EXTEND_LICENSE, ActionType.RESUME, ActionType.EXCLUDE)


# --- общее


async def stage41(session: AsyncSession, workflow_id: int | None) -> Stage | None:
    return await session.scalar(
        select(Stage)
        .where(
            Stage.workflow_id == workflow_id,
            Stage.is_parallel.is_(True),
            Stage.archived_at.is_(None),
        )
        .execution_options(populate_existing=True)
    )


async def branch_start(session: AsyncSession, workflow_id: int | None) -> Stage | None:
    return await session.scalar(
        select(Stage)
        .where(
            Stage.workflow_id == workflow_id,
            Stage.is_branch_start.is_(True),
            Stage.archived_at.is_(None),
        )
        .execution_options(populate_existing=True)
    )


async def load(
    session: AsyncSession, interaction: Interaction, sa_id: int
) -> SupplementaryAgreement:
    sa = await session.get(SupplementaryAgreement, sa_id, populate_existing=True)
    if sa is None or sa.interaction_id != interaction.id:
        raise DomainRuleException(
            404, "Supplementary agreement is not in this interaction"
        )
    return sa


def require_draft(sa: SupplementaryAgreement) -> None:
    if sa.status != AgreementStatus.DRAFT:
        raise DomainRuleException(
            409, f"Supplementary agreement is {sa.status}, only a draft is changed"
        )


def require_owner(scope: InteractionScope) -> None:
    if scope.interaction.owner_id != scope.actor.id:
        raise OperationForbiddenException("manage agreements of this interaction")


def require_change(scope: InteractionScope) -> None:
    if not can_change(scope.actor, scope.ownership):
        raise OperationForbiddenException("change agreements of this interaction")


async def actions_of(session: AsyncSession, sa_id: int) -> list[AgreementAction]:
    return list(
        await session.scalars(
            select(AgreementAction)
            .where(AgreementAction.sa_id == sa_id)
            .order_by(AgreementAction.id)
        )
    )


async def _live_of_pair(
    session: AsyncSession, interaction_id: int, program_id, product_id
) -> Branch | None:
    return await session.scalar(
        select(Branch).where(
            Branch.interaction_id == interaction_id,
            Branch.program_id.is_not_distinct_from(program_id),
            Branch.product_id.is_not_distinct_from(product_id),
            Branch.closed_at.is_(None),
        )
    )


# --- проверка действия (одна на добавление, отправку и одобрение)


async def action_problem(
    session: AsyncSession,
    interaction: Interaction,
    action: AgreementAction,
    others: list[AgreementAction],
) -> str | None:
    """что мешает действию; others - остальные действия этого ДС"""
    branch = None
    if action.type in WITH_BRANCH:
        branch = await session.get(Branch, action.branch_id, populate_existing=True)
        if branch is None or branch.interaction_id != interaction.id:
            return f"branch {action.branch_id} is not in this interaction"
        if branch.state_id is None:
            return f"branch {branch.id} is a draft, it is not changed by an agreement"
        same = [o for o in others if o.branch_id == branch.id]
        if any(o.type == ActionType.EXCLUDE for o in same):
            return f"branch {branch.id} is excluded by this agreement"
        if action.type == ActionType.EXCLUDE and same:
            return f"exclusion is the only action for branch {branch.id}"
    handler = {
        ActionType.NEW_BRANCH: _new_branch_problem,
        ActionType.EXTEND_LICENSE: _extend_license_problem,
        ActionType.RESUME: _resume_problem,
        ActionType.EXCLUDE: _exclude_problem,
        ActionType.EXTEND_CONTRACT: _extend_contract_problem,
    }[ActionType(action.type)]
    return await handler(session, interaction, action, others, branch)


async def _new_branch_problem(session, interaction, action, others, _branch):
    try:
        await check_pair(session, action.program_id, action.product_id)
    except DomainRuleException as err:
        return err.message
    live = await _live_of_pair(
        session, interaction.id, action.program_id, action.product_id
    )
    if live is not None and live.state_id is not None:
        return f"branch {live.id} of this program and product is open"
    for other in others:
        if other.type == ActionType.RESUME:
            resumed = await session.get(Branch, other.branch_id)
            if (resumed.program_id, resumed.product_id) == (
                action.program_id,
                action.product_id,
            ):
                return "resume or a new iteration, not both"
    if await branch_start(session, interaction.workflow_id) is None:
        return "workflow has no branch start"
    return None


async def _extend_license_problem(session, interaction, action, others, branch):
    resumed = any(
        o.type == ActionType.RESUME and o.branch_id == branch.id for o in others
    )
    if branch.closed_at is not None and not resumed:
        return f"branch {branch.id} is closed"
    if branch.license_until is None:
        return f"branch {branch.id} has no license yet, fill it on step 5"
    if action.license_until <= branch.license_until:
        return f"new term must be later than {branch.license_until.isoformat()}"
    signed = branch.license_signed_at
    if signed is not None and action.license_until <= signed:
        return "term must be after signing"
    return None


async def _resume_problem(session, interaction, action, others, branch):
    if branch.closed_at is None:
        return f"branch {branch.id} is open"
    if branch.closed_with_interaction:
        return f"branch {branch.id} returns with the interaction"
    live = await _live_of_pair(
        session, interaction.id, branch.program_id, branch.product_id
    )
    if live is not None:
        return f"branch {live.id} of this pair is live"
    if any(
        o.type == ActionType.NEW_BRANCH
        and (o.program_id, o.product_id) == (branch.program_id, branch.product_id)
        for o in others
    ):
        return "resume or a new iteration, not both"
    stage = await session.get(Stage, branch.state_id, populate_existing=True)
    if stage.archived_at is not None:
        return f"branch {branch.id} step is archived"
    if (
        stage.is_terminal
        and await branch_start(session, interaction.workflow_id) is None
    ):
        return "workflow has no branch start"
    return None


async def _exclude_problem(session, interaction, action, others, branch):
    if branch.closed_at is not None:
        return f"branch {branch.id} is closed"
    return None


async def _extend_contract_problem(session, interaction, action, others, _branch):
    contract = await current_contract(session, interaction.id)
    if contract is None:
        return "no current contract document"
    new = action.contract_valid_until
    if contract.contract_signed_at is not None and new <= contract.contract_signed_at:
        return "term must be after signing"
    if (
        contract.contract_valid_until is not None
        and new <= contract.contract_valid_until
    ):
        return (
            f"new term must be later than {contract.contract_valid_until.isoformat()}"
        )
    return None


# --- черновик


async def open_agreement(
    session: AsyncSession, *, interaction_id: int, actor_id: str
) -> SupplementaryAgreement:
    snapshot = await session.get(Interaction, interaction_id)
    if snapshot is None:
        raise IdNotExistsException(Interaction.__name__)
    step = await stage41(session, snapshot.workflow_id)
    if step is None:
        raise DomainRuleException(409, "Workflow has no supplementary agreement step")
    # шаг 4.1 раньше заявки: его архивация ждёт нас, а не наоборот
    await share_stage(session, step.id)
    scope = await lock_interaction_scope(session, interaction_id, actor_id)
    require_owner(scope)
    interaction = scope.interaction
    if interaction.no_return_at is None:
        raise DomainRuleException(409, "Contract is not signed yet")
    step = await session.get(Stage, step.id, populate_existing=True)
    if step.archived_at is not None:
        raise DomainRuleException(409, "Supplementary agreement step is archived")
    unfinished = await session.scalar(
        select(SupplementaryAgreement.id).where(
            SupplementaryAgreement.interaction_id == interaction.id,
            SupplementaryAgreement.status.in_(OPEN),
        )
    )
    if unfinished is not None:
        raise DomainRuleException(409, f"Agreement {unfinished} is not finished yet")
    sa = SupplementaryAgreement(
        interaction_id=interaction.id,
        status=AgreementStatus.DRAFT,
        created_by=actor_id,
        stall_since=func.now(),
    )
    session.add(sa)
    await session.flush()
    sa_lifecycle.history(
        session,
        interaction,
        StageChangeKind.SA_OPENED,
        actor_id,
        payload={"sa_id": sa.id},
    )
    sa_lifecycle.journal(session, actor_id, AuditEventType.SA_OPENED, sa)
    await session.refresh(sa)
    return sa


async def update(
    session: AsyncSession,
    *,
    interaction_id: int,
    sa_id: int,
    actor_id: str,
    changes: dict[str, Any],
) -> SupplementaryAgreement:
    scope = await lock_interaction_scope(session, interaction_id, actor_id)
    require_change(scope)
    sa = await load(session, scope.interaction, sa_id)
    require_draft(sa)
    if changes.get("signed_at") is not None:
        check_signed_date(changes["signed_at"])
    old = {k: _plain(getattr(sa, k)) for k in changes}
    for key, value in changes.items():
        setattr(sa, key, value)
    sa_lifecycle.journal(
        session,
        actor_id,
        AuditEventType.SA_UPDATED,
        sa,
        old,
        {k: _plain(v) for k, v in changes.items()},
    )
    await session.flush()
    await session.refresh(sa)
    return sa


def _plain(value):
    return value.isoformat() if isinstance(value, date) else value


async def add_action(
    session: AsyncSession,
    *,
    interaction_id: int,
    sa_id: int,
    actor_id: str,
    fields: dict[str, Any],
) -> AgreementAction:
    scope = await lock_interaction_scope(session, interaction_id, actor_id)
    require_change(scope)
    sa = await load(session, scope.interaction, sa_id)
    require_draft(sa)
    action = AgreementAction(sa_id=sa.id, **fields)
    others = await actions_of(session, sa.id)
    if problem := await action_problem(session, scope.interaction, action, others):
        raise DomainRuleException(409, problem)
    session.add(action)
    await session.flush()
    sa_lifecycle.journal(
        session,
        actor_id,
        AuditEventType.SA_ACTION_ADDED,
        sa,
        new={"action_id": action.id, **{k: _plain(v) for k, v in fields.items()}},
    )
    await session.refresh(action)
    return action


async def remove_action(
    session: AsyncSession,
    *,
    interaction_id: int,
    sa_id: int,
    action_id: int,
    actor_id: str,
) -> None:
    scope = await lock_interaction_scope(session, interaction_id, actor_id)
    require_change(scope)
    sa = await load(session, scope.interaction, sa_id)
    require_draft(sa)
    action = await session.get(AgreementAction, action_id)
    if action is None or action.sa_id != sa.id:
        raise DomainRuleException(404, "Action is not in this agreement")
    await session.delete(action)
    await session.flush()
    sa_lifecycle.journal(
        session,
        actor_id,
        AuditEventType.SA_ACTION_REMOVED,
        sa,
        old={"action_id": action_id},
    )


async def cancel(
    session: AsyncSession,
    *,
    interaction_id: int,
    sa_id: int,
    actor_id: str,
    comment: str | None,
) -> SupplementaryAgreement:
    scope = await lock_interaction_scope(session, interaction_id, actor_id)
    require_owner(scope)
    sa = await load(session, scope.interaction, sa_id)
    require_draft(sa)
    sa.status = AgreementStatus.CANCELLED
    sa.decided_by = actor_id
    sa.decided_at = func.now()
    sa.decision_comment = comment
    sa.stall_since = None
    sa_lifecycle.history(
        session,
        scope.interaction,
        StageChangeKind.SA_CANCELLED,
        actor_id,
        payload={"sa_id": sa.id},
        comment=comment,
    )
    sa_lifecycle.journal(session, actor_id, AuditEventType.SA_CANCELLED, sa)
    await session.flush()
    await session.refresh(sa)
    return sa


# --- чтение


async def view(session: AsyncSession, sa: SupplementaryAgreement) -> dict[str, Any]:
    scan = await current_scan(session, sa.id)
    pending = await session.scalar(
        select(InteractionRequest.id).where(
            InteractionRequest.supplementary_agreement_id == sa.id,
            InteractionRequest.status == RequestStatus.PENDING,
        )
    )
    return {
        "id": sa.id,
        "interaction_id": sa.interaction_id,
        "number": sa.number,
        "signed_at": sa.signed_at,
        "status": sa.status,
        "created_by": sa.created_by,
        "created_at": sa.created_at,
        "decided_by": sa.decided_by,
        "decided_at": sa.decided_at,
        "decision_comment": sa.decision_comment,
        "stall_since": sa.stall_since,
        "scan_document_id": scan.id if scan else None,
        "pending_request_id": pending,
        "actions": await actions_of(session, sa.id),
    }


async def listing(session: AsyncSession, interaction_id: int) -> list[dict[str, Any]]:
    agreements = await session.scalars(
        select(SupplementaryAgreement)
        .where(SupplementaryAgreement.interaction_id == interaction_id)
        .order_by(SupplementaryAgreement.id.desc())
    )
    return [await view(session, sa) for sa in agreements]


async def upload_scan(
    session: AsyncSession,
    attachments,
    *,
    interaction_id: int,
    sa_id: int,
    actor,
    file,
    replaces_document_id: int | None,
):
    """скан - своей кнопкой: вид и шаг ставятся сами (М 3.14)"""
    from quoll.interactions.document_service import DocumentFields, upload

    interaction = await session.get(Interaction, interaction_id)
    if interaction is None:
        raise IdNotExistsException(Interaction.__name__)
    step = await stage41(session, interaction.workflow_id)
    if step is None:
        raise DomainRuleException(409, "Workflow has no supplementary agreement step")
    return await upload(
        session,
        attachments,
        interaction_id=interaction_id,
        actor=actor,
        file=file,
        stage_id=step.id,
        replaces_document_id=replaces_document_id,
        fields=DocumentFields(kind="SUPPLEMENTARY_AGREEMENT"),
        supplementary_agreement_id=sa_id,
    )
