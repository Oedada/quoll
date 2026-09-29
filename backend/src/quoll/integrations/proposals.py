"""Предложения по итогам В2: завести заявку вузу или добавить программу
в открытую (К §4, план §5). Решает руководитель, но своя форма - у
CREATE_INTERACTION заявки ещё нет"""

from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from quoll.auth.audit import record
from quoll.auth.audit_models import AuditEventType, TargetType
from quoll.auth.models import Manager, User, UserRole
from quoll.catalog.models import ItProgram
from quoll.core.exceptions import (
    DomainRuleException,
    IdNotExistsException,
    OperationForbiddenException,
)
from quoll.core.locking import lock_row
from quoll.integrations.models import IntegrationProposal, ProposalKind, ProposalStatus
from quoll.interactions import contract_service, project_service
from quoll.interactions.access_policy import can_change
from quoll.interactions.models import (
    Branch,
    ContractStatus,
    Interaction,
    University,
)
from quoll.interactions.schemas import BranchWrite, InteractionCreate
from quoll.interactions.scope import lock_interaction_scope
from quoll.notifications import kinds
from quoll.notifications.emit import Audience, emit
from quoll.notifications.kinds import Subject


async def open_interaction_id(session: AsyncSession, university_id: int) -> int | None:
    return await session.scalar(
        select(Interaction.id).where(
            Interaction.university_id == university_id, Interaction.closed_at.is_(None)
        )
    )


async def _has_program(
    session: AsyncSession, interaction_id: int, program_id: int
) -> bool:
    """незакрытая ветка программы в составе или на шагах; убранная из
    состава не считается"""
    found = await session.scalar(
        select(Branch.id).where(
            Branch.interaction_id == interaction_id,
            Branch.program_id == program_id,
            Branch.closed_at.is_(None),
            Branch.contract_status != ContractStatus.REJECTED,
        )
    )
    return found is not None


async def offer(session: AsyncSession, university_id: int, program_id: int) -> bool:
    """итог В2 по паре (К §4): вузу без заявки - завести заявку, заявке без
    программы - добавить её. True - предложение создано"""
    interaction_id = await open_interaction_id(session, university_id)
    if interaction_id is None:
        kind, reason = ProposalKind.CREATE_INTERACTION, "LMS: у вуза нет заявки"
    elif not await _has_program(session, interaction_id, program_id):
        kind, reason = ProposalKind.ADD_PROGRAM, "LMS: программы нет в заявке"
    else:
        return False
    created = await _create(
        session,
        kind=kind,
        university_id=university_id,
        program_id=program_id,
        reason=reason,
        interaction_id=interaction_id,
    )
    return created is not None


async def _responsible_supervisor(
    session: AsyncSession, university_id: int
) -> str | None:
    interaction_id = await open_interaction_id(session, university_id)
    if interaction_id is None:
        return None
    interaction = await session.get(Interaction, interaction_id)
    if interaction.owner_id:
        return await session.scalar(
            select(Manager.superviser_id).where(Manager.id == interaction.owner_id)
        )
    return interaction.created_by


async def _labels(session: AsyncSession, proposal: IntegrationProposal) -> dict:
    university = await session.get(University, proposal.university_id)
    program = await session.get(ItProgram, proposal.program_id)
    return {"university": university.short_name, "program": program.name}


async def _create(
    session: AsyncSession,
    *,
    kind: ProposalKind,
    university_id: int,
    program_id: int,
    reason: str,
    interaction_id: int | None,
) -> IntegrationProposal | None:
    """не дублировать: ждущее одно (уникальный индекс); отклонённое по паре
    не создаётся снова никогда (К §4); одобренное ADD_PROGRAM ждёт ДС КАМа -
    по той же заявке не повторяется"""
    existing = await session.scalar(
        select(IntegrationProposal.id).where(
            IntegrationProposal.kind == kind,
            IntegrationProposal.university_id == university_id,
            IntegrationProposal.program_id == program_id,
            or_(
                IntegrationProposal.status.in_(
                    [ProposalStatus.PENDING, ProposalStatus.REJECTED]
                ),
                and_(
                    IntegrationProposal.status == ProposalStatus.APPROVED,
                    IntegrationProposal.result_interaction_id == interaction_id,
                ),
            ),
        )
    )
    if existing is not None:
        return None
    proposal = IntegrationProposal(
        kind=kind, university_id=university_id, program_id=program_id, reason=reason
    )
    session.add(proposal)
    await session.flush()
    record(
        session,
        actor_id=None,
        event_type=AuditEventType.INTEGRATION_PROPOSAL_CREATED,
        target_type=TargetType.INTEGRATION_PROPOSAL,
        target_id=proposal.id,
        new_value={
            "kind": kind,
            "university_id": university_id,
            "program_id": program_id,
        },
    )
    labels = await _labels(session, proposal)
    if kind == ProposalKind.CREATE_INTERACTION:
        await emit(
            session,
            kinds.INTEGRATION_PROPOSAL_CREATE,
            subject=Subject.INTEGRATION_PROPOSAL,
            subject_id=proposal.id,
            audience=Audience(),
            context={**labels, "reason": reason},
            actor_id=None,
            payload={"proposal_id": proposal.id},
        )
    else:
        supervisor_id = await _responsible_supervisor(session, university_id)
        if supervisor_id:
            await emit(
                session,
                kinds.INTEGRATION_PROPOSAL_ADD,
                subject=Subject.INTEGRATION_PROPOSAL,
                subject_id=proposal.id,
                audience=Audience(users=(supervisor_id,)),
                context={**labels, "reason": reason},
                actor_id=None,
                payload={"proposal_id": proposal.id},
            )
    return proposal


async def _guard_actor(session: AsyncSession, actor_id: str) -> User:
    actor = await session.get(User, actor_id)
    if actor is None or actor.role != UserRole.SUPERVISER:
        raise OperationForbiddenException("decide on integration proposals")
    return actor


async def approve(
    session: AsyncSession,
    *,
    proposal_id: int,
    actor_id: str,
    workflow_id: int | None = None,
    comment: str | None = None,
) -> IntegrationProposal:
    found = await session.get(IntegrationProposal, proposal_id)
    if found is None:
        raise IdNotExistsException(IntegrationProposal.__name__)
    if found.status != ProposalStatus.PENDING:
        raise DomainRuleException(409, f"Proposal is already {found.status}")
    await _guard_actor(session, actor_id)
    proposal = await lock_row(session, IntegrationProposal, proposal_id)
    if proposal.status != ProposalStatus.PENDING:
        raise DomainRuleException(409, f"Proposal is already {proposal.status}")

    sign_needed = False
    if proposal.kind == ProposalKind.CREATE_INTERACTION:
        # решает любой руководитель (Р4) - воркфлоу выбирает в теле одобрения
        if workflow_id is None:
            raise DomainRuleException(422, "Approval needs workflow_id (Р4)")
        if await open_interaction_id(session, proposal.university_id) is not None:
            raise DomainRuleException(409, "University already has an open interaction")
        interaction = await project_service.create_interaction(
            session,
            InteractionCreate(
                university_id=proposal.university_id,
                branches=[BranchWrite(program_id=proposal.program_id, product_id=None)],
                workflow_id=workflow_id,
            ),
            actor_id,
        )
        proposal.result_interaction_id = interaction.id
        proposal.workflow_id = workflow_id
    else:
        interaction_id = await open_interaction_id(session, proposal.university_id)
        if interaction_id is None:
            raise DomainRuleException(
                409, "University no longer has an open interaction"
            )
        # подписание, закрытие и чужая ветка идут под той же блокировкой -
        # иначе черновик мог бы попасть в уже подписанную заявку
        scope = await lock_interaction_scope(session, interaction_id, actor_id)
        if not can_change(scope.actor, scope.ownership):
            raise OperationForbiddenException("decide on someone else's interaction")
        interaction = scope.interaction
        if not await _has_program(session, interaction_id, proposal.program_id):
            if interaction.no_return_at is None:
                await contract_service.draft_branch(
                    session, interaction_id, proposal.program_id, None, actor_id
                )
            else:
                # шаг 4 необратим (Р5): запрос ветку не создаёт, только уведомляет КАМа
                sign_needed = True
        proposal.result_interaction_id = interaction_id

    proposal.status = ProposalStatus.APPROVED
    proposal.decided_by = actor_id
    proposal.decided_at = func.now()
    proposal.decision_comment = comment
    await session.flush()
    record(
        session,
        actor_id=actor_id,
        event_type=AuditEventType.INTEGRATION_PROPOSAL_APPROVED,
        target_type=TargetType.INTEGRATION_PROPOSAL,
        target_id=proposal.id,
        new_value={
            "comment": comment,
            "result_interaction_id": proposal.result_interaction_id,
        },
    )
    labels = await _labels(session, proposal)
    if sign_needed and interaction.owner_id:
        await emit(
            session,
            kinds.INTEGRATION_PROPOSAL_SIGN_NEEDED,
            subject=Subject.INTEGRATION_PROPOSAL,
            subject_id=proposal.id,
            audience=Audience(users=(interaction.owner_id,)),
            context=labels,
            actor_id=actor_id,
            payload={"proposal_id": proposal.id, "interaction_id": interaction.id},
        )
    await session.refresh(proposal)
    return proposal


async def reject(
    session: AsyncSession, *, proposal_id: int, actor_id: str, comment: str
) -> IntegrationProposal:
    found = await session.get(IntegrationProposal, proposal_id)
    if found is None:
        raise IdNotExistsException(IntegrationProposal.__name__)
    await _guard_actor(session, actor_id)
    proposal = await lock_row(session, IntegrationProposal, proposal_id)
    if proposal.status != ProposalStatus.PENDING:
        raise DomainRuleException(409, f"Proposal is already {proposal.status}")
    proposal.status = ProposalStatus.REJECTED
    proposal.decided_by = actor_id
    proposal.decided_at = func.now()
    proposal.decision_comment = comment
    await session.flush()
    record(
        session,
        actor_id=actor_id,
        event_type=AuditEventType.INTEGRATION_PROPOSAL_REJECTED,
        target_type=TargetType.INTEGRATION_PROPOSAL,
        target_id=proposal.id,
        new_value={"comment": comment},
    )
    await session.refresh(proposal)
    return proposal


async def visible(
    session: AsyncSession,
    viewer: User,
    status: ProposalStatus | None,
    limit: int,
    offset: int,
) -> list[IntegrationProposal]:
    if viewer.role not in (UserRole.SUPERVISER, UserRole.ADMIN):
        raise OperationForbiddenException("view integration proposals")
    stmt = select(IntegrationProposal)
    if status is not None:
        stmt = stmt.where(IntegrationProposal.status == status)
    stmt = (
        stmt.order_by(
            IntegrationProposal.created_at.desc(), IntegrationProposal.id.desc()
        )
        .limit(limit)
        .offset(offset)
    )
    return list((await session.scalars(stmt)).all())
