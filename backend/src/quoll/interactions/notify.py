"""Доменные уведомления: строка в той же транзакции, что и событие.

в сокет не толкаем - откат оставил бы пришедшее уведомление о несбывшемся.
Клиент видит новое при следующем чтении списка
"""

from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from quoll.notifications.models import Notify


def notify(
    session: AsyncSession,
    user_id: str | None,
    title: str,
    message: str,
    extra: dict[str, Any] | None = None,
) -> None:
    if user_id is not None:
        session.add(
            Notify(user_id=user_id, title=title, message=message, extra_data=extra)
        )
