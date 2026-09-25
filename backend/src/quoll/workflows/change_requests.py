"""Просьбы руководителей изменить воркфлоу: руководитель пишет, админ решает"""

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from quoll.auth.audit import record
from quoll.auth.audit_models import AuditEventType, TargetType
from quoll.auth.models import User, UserRole
from quoll.core.exceptions import DomainRuleException, IdNotExistsException
from quoll.core.locking import lock_row
from quoll.interactions.notify import notify
from quoll.workflows.models import Workflow, WorkflowChangeRequest


async def create(
    session: AsyncSession, *, workflow_id: int, text: str, actor_id: str
) -> WorkflowChangeRequest:
    if await session.get(Workflow, workflow_id) is None:
        raise IdNotExistsException(Workflow.__name__)
    request = WorkflowChangeRequest(
        workflow_id=workflow_id, requested_by=actor_id, text=text
    )
    session.add(request)
    await session.flush()
    record(
        session,
        actor_id=actor_id,
        event_type=AuditEventType.WORKFLOW_CHANGE_REQUESTED,
        target_type=TargetType.WORKFLOW,
        target_id=workflow_id,
        new_value={"request_id": request.id, "text": text},
    )
    await session.refresh(request)
    return request


async def decide(
    session: AsyncSession,
    *,
    request_id: int,
    actor_id: str,
    approve: bool,
    comment: str | None,
) -> WorkflowChangeRequest:
    request = await lock_row(session, WorkflowChangeRequest, request_id)
    if request is None:
        raise IdNotExistsException(WorkflowChangeRequest.__name__)
    if request.status != "PENDING":
        raise DomainRuleException(409, f"Request is already {request.status}")
    request.status = "APPROVED" if approve else "REJECTED"
    request.decided_by = actor_id
    request.decided_at = func.now()
    request.decision_comment = comment
    await session.flush()
    record(
        session,
        actor_id=actor_id,
        event_type=AuditEventType.WORKFLOW_CHANGE_DECIDED,
        target_type=TargetType.WORKFLOW,
        target_id=request.workflow_id,
        new_value={
            "request_id": request.id,
            "status": request.status,
            "comment": comment,
        },
    )
    notify(
        session,
        request.requested_by,
        "Изменение воркфлоу одобрено" if approve else "Изменение воркфлоу отклонено",
        comment or request.text,
        {"workflow_change_request_id": request.id},
    )
    await session.refresh(request)
    return request


async def visible(
    session: AsyncSession, viewer: User, status: str | None, limit: int, offset: int
) -> list[WorkflowChangeRequest]:
    """админ видит все, руководитель - свои"""
    stmt = select(WorkflowChangeRequest)
    if viewer.role != UserRole.ADMIN:
        stmt = stmt.where(WorkflowChangeRequest.requested_by == viewer.id)
    if status is not None:
        stmt = stmt.where(WorkflowChangeRequest.status == status)
    stmt = stmt.order_by(WorkflowChangeRequest.id.desc()).limit(limit).offset(offset)
    return list(await session.scalars(stmt))
