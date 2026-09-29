"""Уведомления о заявке: получатели - из захваченной области, подпись - вуз
и номер. Отправка - общий emit(), см. notifications/emit.py"""

from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from quoll.auth.models import Manager
from quoll.interactions.models import University
from quoll.interactions.scope import InteractionScope
from quoll.notifications.emit import Audience, emit
from quoll.notifications.kinds import Kind, Subject
from quoll.notifications.models import Notification


def audience(scope: InteractionScope, **extra: Any) -> Audience:
    interaction = scope.interaction
    return Audience(
        owner_id=interaction.owner_id,
        owner_superviser_id=scope.owner.superviser_id if scope.owner else None,
        author_id=interaction.created_by,
        **extra,
    )


async def label(session: AsyncSession, interaction) -> str:
    university = await session.get(University, interaction.university_id)
    return f"{university.short_name}, заявка {interaction.id}"


async def notify_system(
    session: AsyncSession,
    kind: Kind,
    interaction,
    *,
    context: dict[str, Any] | None = None,
    subject: Subject = Subject.INTERACTION,
    subject_id: Any = None,
    payload: dict[str, Any] | None = None,
) -> None:
    """от системы, когда области заявки под рукой нет (воркеры)"""
    superviser = (
        await session.scalar(
            select(Manager.superviser_id).where(Manager.id == interaction.owner_id)
        )
        if interaction.owner_id
        else None
    )
    await emit(
        session,
        kind,
        subject=subject,
        subject_id=interaction.id if subject_id is None else subject_id,
        interaction_id=interaction.id,
        audience=Audience(
            owner_id=interaction.owner_id,
            owner_superviser_id=superviser,
            author_id=interaction.created_by,
        ),
        context={"interaction": await label(session, interaction), **(context or {})},
        actor_id=None,
        payload={"interaction_id": interaction.id, **(payload or {})},
    )


async def notify(
    session: AsyncSession,
    kind: Kind,
    scope: InteractionScope,
    *,
    context: dict[str, Any] | None = None,
    subject: Subject = Subject.INTERACTION,
    subject_id: Any = None,
    payload: dict[str, Any] | None = None,
    dedup_key: str | None = None,
    **who: Any,
) -> Notification | None:
    interaction = scope.interaction
    return await emit(
        session,
        kind,
        subject=subject,
        subject_id=interaction.id if subject_id is None else subject_id,
        interaction_id=interaction.id,
        audience=audience(scope, **who),
        context={"interaction": await label(session, interaction), **(context or {})},
        actor_id=scope.actor.id if scope.actor else None,
        payload={"interaction_id": interaction.id, **(payload or {})},
        dedup_key=dedup_key,
    )
