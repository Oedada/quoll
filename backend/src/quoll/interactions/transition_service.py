"""Переход заявки по стадиям воркфлоу - только по активному ребру графа.

досрочное закрытие и переоткрытие идут без ребра, это отдельные операции
"""

from typing import Any

from sqlalchemy import exists, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from quoll.auth.audit import record
from quoll.auth.audit_models import AuditEventType, TargetType
from quoll.core.exceptions import (
    DomainRuleException,
    OperationForbiddenException,
    StaleStateException,
    WorkflowNotPublishedException,
)
from quoll.interactions.access_policy import can_change, can_close
from quoll.interactions.capacity_policy import (
    assert_can_keep_working,
    assert_can_take_new_work,
    counts_toward_capacity,
)
from quoll.interactions.document_service import replaced_expression
from quoll.interactions.models import (
    DocumentStatus,
    Interaction,
    InteractionDocument,
    InteractionStageHistory,
    InteractionStageValues,
    PauseState,
    StageChangeKind,
)
from quoll.interactions.notify import notify
from quoll.interactions.requests import cancel_pending_requests
from quoll.interactions.scope import InteractionScope, lock_interaction_scope
from quoll.interactions.step_policy import transition_problems
from quoll.workflows.graph_policy import EdgeFacts, leads_to
from quoll.workflows.models import Stage, Workflow, WorkflowTransition


async def transition(
    session: AsyncSession,
    *,
    interaction_id: int,
    actor_id: str,
    to_stage_id: int,
    expected_state_id: int | None,
    comment: str | None,
    accepting: bool = False,
) -> Interaction:
    scope = await lock_interaction_scope(session, interaction_id, actor_id)
    interaction = scope.interaction
    if interaction.state_id != expected_state_id:
        raise StaleStateException("Interaction stage", interaction.state_id)

    if not can_change(scope.actor, scope.ownership):
        raise OperationForbiddenException("move this interaction")
    # в начальную стадию ставит только принятие заявки её владельцем
    if interaction.state_id is None and not accepting:
        raise DomainRuleException(
            409, "The owner starts the interaction by accepting it"
        )
    if accepting and interaction.owner_id != actor_id:
        raise OperationForbiddenException("accept this interaction")
    return await move_locked(
        session,
        scope,
        to_stage_id=to_stage_id,
        comment=comment,
        approved=False,
        new_work=accepting,
    )


async def move_locked(
    session: AsyncSession,
    scope: InteractionScope,
    *,
    to_stage_id: int,
    comment: str | None,
    approved: bool,
    new_work: bool = False,
) -> Interaction:
    """переход по ребру под уже захваченной областью - его зовёт и одобрение
    просьбы об аппруве. approved - ребро с аппрувом разрешено"""
    interaction = scope.interaction
    actor_id = scope.actor.id
    current = (
        await session.get(Stage, interaction.state_id) if interaction.state_id else None
    )
    if current is not None and current.is_terminal:
        raise DomainRuleException(409, "Closed interaction is reopened, not moved")
    # до блокировки: иначе мы держали бы заявку на S и ждали S, а архивация S
    # - наоборот. Петли запрещены, так что такой переход всё равно отказ
    if to_stage_id == interaction.state_id:
        raise DomainRuleException(409, "Interaction is already on this stage")

    target = await lock_target_stage(session, to_stage_id)

    # черновик без воркфлоу получает его первым переходом - иначе остался
    # бы черновиком навсегда: воркфлоу задаётся только при создании
    workflow_id = interaction.workflow_id or target.workflow_id
    if target.workflow_id != workflow_id:
        raise DomainRuleException(400, "Stage belongs to another workflow")
    workflow = await session.get(Workflow, workflow_id)
    if workflow is None or not workflow.is_published:
        raise WorkflowNotPublishedException(workflow_id)

    edge = await _active_edge(session, workflow_id, current, target)
    if edge is None:
        raise DomainRuleException(409, "No active transition between these stages")
    # заявка не едет по нетерминальным стадиям без ответственного
    if not target.is_terminal and interaction.owner_id is None:
        raise DomainRuleException(409, "Assign a manager before moving the interaction")
    if edge.is_backward and not comment:
        raise DomainRuleException(422, "Backward transition needs a comment")
    await check_step(session, interaction, current, edge, approved=approved)

    if scope.owner is not None:
        # закрытие сбрасывает паузу, поэтому вклад цели считаем без неё
        paused_after = interaction.is_paused and not target.is_terminal
        delta = int(counts_toward_capacity(target, paused_after)) - int(
            counts_toward_capacity(current, interaction.is_paused)
        )
        # принятие - новая работа: «не давать новых» его тоже закрывает
        check = assert_can_take_new_work if new_work else assert_can_keep_working
        await check(session, scope.owner, delta)

    interaction.workflow_id = workflow_id
    place(
        session,
        interaction,
        current,
        target,
        kind=StageChangeKind.TRANSITION,
        transition_id=edge.id,
        actor_id=actor_id,
        comment=comment,
    )
    if target.is_terminal:
        await cancel_pending_requests(
            session, interaction.id, actor_id, "interaction closed"
        )
    if edge.is_backward and scope.owner is not None:
        # любой возврат - руководитель узнаёт и смотрит, что пошло не так
        notify(
            session,
            scope.owner.superviser_id,
            "Возврат на шаг назад",
            f"Взаимодействие {interaction.id}: {current.name} → {target.name}. {comment}",
            {"interaction_id": interaction.id},
        )
    record(
        session,
        actor_id=actor_id,
        event_type=AuditEventType.STAGE_TRANSITIONED,
        target_type=TargetType.INTERACTION,
        target_id=interaction.id,
        old_value={"state_id": current.id if current else None},
        new_value={"state_id": target.id, "transition_id": edge.id},
    )
    await session.flush()
    await session.refresh(interaction)
    return interaction


async def check_step(
    session: AsyncSession,
    interaction: Interaction,
    current: Stage | None,
    edge: WorkflowTransition,
    *,
    approved: bool,
) -> None:
    """правила шага по фактам; нарушено - 409 со всеми причинами сразу"""
    values, kinds = {}, set()
    if current is not None:
        values = await stage_values(session, interaction.id, current.id)
        kinds = await current_document_kinds(session, interaction.id, current.id)
    problems = transition_problems(
        requires_approval=edge.requires_approval,
        approved=approved,
        forward=not edge.is_backward,
        fields=current.fields if current is not None else [],
        values=values,
        required_kinds=edge.required_document_kinds,
        present_kinds=kinds,
    )
    if problems:
        raise DomainRuleException(409, "Step is not done: " + "; ".join(problems))


async def stage_values(
    session: AsyncSession, interaction_id: int, stage_id: int
) -> dict[str, Any]:
    found = await session.scalar(
        select(InteractionStageValues.values).where(
            InteractionStageValues.interaction_id == interaction_id,
            InteractionStageValues.stage_id == stage_id,
        )
    )
    return found or {}


async def current_document_kinds(
    session: AsyncSession, interaction_id: int, stage_id: int
) -> set[str]:
    """типы актуальных документов стадии - заменённая версия не считается"""
    rows = await session.scalars(
        select(InteractionDocument.kind).where(
            InteractionDocument.interaction_id == interaction_id,
            InteractionDocument.stage_id == stage_id,
            InteractionDocument.kind.is_not(None),
            InteractionDocument.status == DocumentStatus.ACTIVE,
            ~replaced_expression(),
        )
    )
    return set(rows)


async def accept(
    session: AsyncSession,
    *,
    interaction_id: int,
    actor_id: str,
    to_stage_id: int,
    comment: str | None,
) -> Interaction:
    """менеджер принимает назначенную заявку: она встаёт в начальную стадию
    и только теперь занимает слот - мест нет, и принять нельзя"""
    return await transition(
        session,
        interaction_id=interaction_id,
        actor_id=actor_id,
        to_stage_id=to_stage_id,
        expected_state_id=None,
        comment=comment,
        accepting=True,
    )


async def rollback(
    session: AsyncSession,
    *,
    interaction_id: int,
    actor_id: str,
    to_stage_id: int,
    expected_state_id: int,
    comment: str,
) -> Interaction:
    """руководитель владельца возвращает на несколько шагов - туда, где
    заявка уже была, но не раньше последней точки невозврата"""
    scope = await lock_interaction_scope(session, interaction_id, actor_id)
    interaction = scope.interaction
    if interaction.state_id != expected_state_id:
        raise StaleStateException("Interaction stage", interaction.state_id)
    if not can_close(scope.actor, scope.ownership):
        raise OperationForbiddenException("roll back this interaction")
    current = (
        await session.get(Stage, interaction.state_id) if interaction.state_id else None
    )
    if current is None or current.is_terminal:
        raise DomainRuleException(409, "Only an interaction in work is rolled back")
    if to_stage_id == current.id:
        raise DomainRuleException(409, "Interaction is already on this stage")
    if not await reached_since_no_return(session, interaction.id, to_stage_id):
        raise DomainRuleException(
            409, "Rollback goes only to a stage passed after the point of no return"
        )
    # откат - только назад: вперёд шаг проходят по ребру, с его проверками
    edges = await session.scalars(
        select(WorkflowTransition).where(
            WorkflowTransition.workflow_id == interaction.workflow_id,
            WorkflowTransition.is_active.is_(True),
            WorkflowTransition.is_backward.is_(False),
        )
    )
    if not leads_to(
        [EdgeFacts(e.from_stage_id, e.to_stage_id) for e in edges],
        to_stage_id,
        current.id,
    ):
        raise DomainRuleException(409, "Rollback goes back, not forward")
    return await return_locked(
        session,
        scope,
        to_stage_id=to_stage_id,
        kind=StageChangeKind.ROLLBACK,
        comment=comment,
    )


async def reached_since_no_return(
    session: AsyncSession, interaction_id: int, stage_id: int
) -> bool:
    history = InteractionStageHistory
    sealed_at = await session.scalar(
        select(func.max(history.id))
        .join(WorkflowTransition, WorkflowTransition.id == history.transition_id)
        .where(
            history.interaction_id == interaction_id,
            WorkflowTransition.is_irreversible.is_(True),
        )
    )
    reached = select(history.id).where(
        history.interaction_id == interaction_id, history.to_stage_id == stage_id
    )
    if sealed_at is not None:
        # по id, а не по времени: в одной транзакции now() у записей общий
        reached = reached.where(history.id >= sealed_at)
    return await session.scalar(select(exists(reached))) or False


async def return_locked(
    session: AsyncSession,
    scope: InteractionScope,
    *,
    to_stage_id: int,
    kind: StageChangeKind,
    comment: str,
) -> Interaction:
    """вернуть на стадию без ребра: отказ в аппруве, откат руководителем.
    Данные шагов не стираются - таймер застоя обнулит новая запись истории"""
    interaction = scope.interaction
    current = await session.get(Stage, interaction.state_id)
    target = await lock_target_stage(session, to_stage_id)
    if target.workflow_id != interaction.workflow_id or target.is_terminal:
        raise DomainRuleException(400, "Return goes to a working stage of the workflow")
    if scope.owner is not None:
        delta = int(counts_toward_capacity(target, interaction.is_paused)) - int(
            counts_toward_capacity(current, interaction.is_paused)
        )
        await assert_can_keep_working(session, scope.owner, delta)
    place(
        session,
        interaction,
        current,
        target,
        kind=kind,
        transition_id=None,
        actor_id=scope.actor.id,
        comment=comment,
    )
    record(
        session,
        actor_id=scope.actor.id,
        event_type=AuditEventType.STAGE_TRANSITIONED,
        target_type=TargetType.INTERACTION,
        target_id=interaction.id,
        old_value={"state_id": current.id},
        new_value={"state_id": target.id, "kind": kind},
    )
    await session.flush()
    await session.refresh(interaction)
    return interaction


def place(
    session: AsyncSession,
    interaction: Interaction,
    current: Stage | None,
    target: Stage,
    *,
    kind: StageChangeKind,
    transition_id: int | None,
    actor_id: str,
    comment: str | None,
) -> None:
    """поставить заявку на стадию и записать это в историю - общее у перехода,
    закрытия и переоткрытия"""
    interaction.state_id = target.id
    if target.is_terminal and interaction.is_paused:
        # закрытая заявка на паузе - бессмыслица
        interaction.is_paused = False
        interaction.pause_state = PauseState.ACTIVE
        interaction.paused_until = None
        interaction.pause_comment = None
    session.add(
        InteractionStageHistory(
            interaction_id=interaction.id,
            from_stage_id=current.id if current else None,
            to_stage_id=target.id,
            transition_id=transition_id,
            kind=kind,
            actor_id=actor_id,
            comment=comment,
        )
    )


async def close(
    session: AsyncSession,
    *,
    interaction_id: int,
    actor_id: str,
    to_stage_id: int,
    expected_state_id: int | None,
    comment: str,
) -> Interaction:
    """досрочное закрытие: с любого шага в терминальную стадию, без ребра.
    Дееспособность владельца не проверяется - иначе офбординг не дождался бы
    нуля незакрытых"""
    scope = await lock_interaction_scope(session, interaction_id, actor_id)
    if scope.interaction.state_id != expected_state_id:
        raise StaleStateException("Interaction stage", scope.interaction.state_id)
    return await close_locked(session, scope, to_stage_id=to_stage_id, comment=comment)


async def close_locked(
    session: AsyncSession, scope: InteractionScope, *, to_stage_id: int, comment: str
) -> Interaction:
    """закрытие под уже захваченной областью - его зовёт и одобрение просьбы"""
    interaction = scope.interaction
    actor_id = scope.actor.id
    if not can_close(scope.actor, scope.ownership):
        raise OperationForbiddenException("close this interaction")

    current = (
        await session.get(Stage, interaction.state_id) if interaction.state_id else None
    )
    if current is None:
        raise DomainRuleException(409, "Draft is deleted, not closed")
    if current.is_terminal:
        raise DomainRuleException(409, "Interaction is already closed")
    target = await lock_target_stage(session, to_stage_id)
    if target.workflow_id != interaction.workflow_id:
        raise DomainRuleException(400, "Stage belongs to another workflow")
    if not target.is_terminal:
        raise DomainRuleException(400, "Interaction is closed into a terminal stage")

    place(
        session,
        interaction,
        current,
        target,
        kind=StageChangeKind.CLOSE,
        transition_id=None,
        actor_id=actor_id,
        comment=comment,
    )
    await cancel_pending_requests(
        session, interaction.id, actor_id, "interaction closed"
    )
    record(
        session,
        actor_id=actor_id,
        event_type=AuditEventType.PROJECT_CLOSED,
        target_type=TargetType.INTERACTION,
        target_id=interaction.id,
        old_value={"state_id": current.id},
        new_value={"state_id": target.id, "comment": comment},
    )
    await session.flush()
    await session.refresh(interaction)
    return interaction


async def _active_edge(
    session: AsyncSession, workflow_id: int, current: Stage | None, target: Stage
) -> WorkflowTransition | None:
    """ребро графа; у черновика - из NULL, то есть в начальную стадию (П3)"""
    # FOR SHARE после стадии: деактивация ребра подождёт перехода или он её
    stmt = (
        select(WorkflowTransition)
        .where(
            WorkflowTransition.workflow_id == workflow_id,
            WorkflowTransition.from_stage_id == (current.id if current else None),
            WorkflowTransition.to_stage_id == target.id,
            WorkflowTransition.is_active.is_(True),
        )
        .with_for_update(read=True)
        .execution_options(populate_existing=True)
    )
    return (await session.execute(stmt)).scalar_one_or_none()


async def lock_target_stage(session: AsyncSession, stage_id: int) -> Stage:
    """стадия, на которую ставят заявку: переход, закрытие, переоткрытие.

    FOR SHARE - архивация её не пройдёт, пока мы не закоммитим, а начатая
    раньше заставит нас дождаться и увидеть архив
    """
    target = (
        await session.execute(
            select(Stage)
            .where(Stage.id == stage_id)
            .with_for_update(read=True)
            .execution_options(populate_existing=True)
        )
    ).scalar_one_or_none()
    if target is None:
        raise DomainRuleException(400, f"Stage '{stage_id}' does not exist")
    if target.archived_at is not None:
        raise DomainRuleException(409, f"Stage '{stage_id}' is archived")
    return target
