"""Единственная точка отправки уведомлений.

пишет в текущую транзакцию: откатилось событие - нет и уведомления. Живую
доставку будит pg_notify, а его Postgres отдаёт слушателям только при
коммите. Сам emit ни коммитов, ни сокетов не трогает
"""

from dataclasses import dataclass, field
from typing import Any

from sqlalchemy import func, not_, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from quoll.auth.identity_policy import incapacitated_expression
from quoll.auth.models import User, UserRole
from quoll.notifications.kinds import Kind, Role, Subject
from quoll.notifications.models import Notification, NotificationRecipient

CHANNEL = "quoll_notifications"


@dataclass(frozen=True)
class Audience:
    """кто есть кто по отношению к предмету - id, известные вызывающему.
    Роли вида разрешаются по ним, в базу за ними не ходим"""

    owner_id: str | None = None
    owner_superviser_id: str | None = None
    previous_owner_id: str | None = None
    author_id: str | None = None
    requester_id: str | None = None
    editor_id: str | None = None
    users: tuple[str, ...] = field(default_factory=tuple)
    # у MANUAL: всем с этой ролью в системе
    system_role: UserRole | None = None


def _direct(role: Role, audience: Audience) -> list[str | None]:
    return {
        Role.OWNER: [audience.owner_id],
        Role.PREVIOUS_OWNER: [audience.previous_owner_id],
        # у заявки без КАМа за неё отвечает автор-руководитель
        Role.OWNER_SUPERVISOR: [
            audience.owner_superviser_id
            if audience.owner_id is not None
            else audience.author_id
        ],
        Role.AUTHOR: [audience.author_id],
        Role.REQUESTER: [audience.requester_id],
        Role.EDITOR: [audience.editor_id],
        Role.USER: list(audience.users),
    }.get(role, [])


async def _capable(session: AsyncSession, ids: set[str]) -> set[str]:
    if not ids:
        return set()
    return set(
        await session.scalars(
            select(User.id).where(
                User.id.in_(ids), not_(incapacitated_expression(User))
            )
        )
    )


async def _everyone(session: AsyncSession, role: UserRole) -> set[str]:
    return set(
        await session.scalars(
            select(User.id).where(
                User.role == role, not_(incapacitated_expression(User))
            )
        )
    )


async def resolve(
    session: AsyncSession,
    roles: tuple[Role, ...],
    audience: Audience,
    skip: str | None,
) -> dict[str, Role]:
    """получатель -> роль, в которой он получает. Выбывшие не получают; автор
    события сам себе не пишет; человек в двух ролях - одна строка по первой"""
    result: dict[str, Role] = {}
    for role in roles:
        if role == Role.ADMINS:
            found = await _everyone(session, UserRole.ADMIN)
        elif role == Role.ALL_SUPERVISORS:
            found = await _everyone(session, UserRole.SUPERVISER)
        elif role == Role.USER and audience.system_role is not None:
            found = await _everyone(session, audience.system_role)
        else:
            found = await _capable(
                session, {uid for uid in _direct(role, audience) if uid}
            )
            # руководитель выбыл - осиротевшую заявку может взять любой
            if role == Role.OWNER_SUPERVISOR and not found:
                found = await _everyone(session, UserRole.SUPERVISER)
        for user_id in sorted(found):
            if user_id != skip:
                result.setdefault(user_id, role)
    return result


async def emit(
    session: AsyncSession,
    kind: Kind,
    *,
    subject: Subject,
    subject_id: Any = None,
    interaction_id: int | None = None,
    audience: Audience,
    context: dict[str, Any],
    actor_id: str | None,
    payload: dict[str, Any] | None = None,
    extra_roles: tuple[Role, ...] = (),
    dedup_key: str | None = None,
) -> Notification | None:
    """None - повод уже был (dedup_key) или получателей нет"""
    recipients = await resolve(
        session,
        kind.audience + extra_roles,
        audience,
        None if kind.include_actor else actor_id,
    )
    if not recipients:
        return None
    notification_id = await session.scalar(
        pg_insert(Notification)
        .values(
            type=kind.code,
            severity=kind.severity,
            subject_type=subject,
            subject_id=str(subject_id) if subject_id is not None else None,
            interaction_id=interaction_id,
            actor_id=actor_id,
            title=kind.title.format(**context),
            body=kind.body.format(**context),
            payload=payload or {},
            dedup_key=dedup_key,
        )
        .on_conflict_do_nothing(index_elements=["dedup_key"])
        .returning(Notification.id)
    )
    if notification_id is None:
        return None
    await session.execute(
        pg_insert(NotificationRecipient).values(
            [
                {"notification_id": notification_id, "user_id": uid, "role": role}
                for uid, role in recipients.items()
            ]
        )
    )
    await session.execute(select(func.pg_notify(CHANNEL, str(notification_id))))
    return await session.get(Notification, notification_id)
