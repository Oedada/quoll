"""Кто что может делать с заявкой. Чистые правила, в БД не ходят.

читать и менять - разные права: руководитель читает всё, а меняет только
заявки своей команды. Админу доменные операции запрещены
"""

from sqlalchemy import ColumnElement, true

from quoll.auth.models import User, UserRole
from quoll.interactions.models import Interaction


def can_read(user: User, owner_id: str | None) -> bool:
    # бывшие свои заявки менеджер увидит, когда появится история назначений
    if user.role == UserRole.MANAGER:
        return owner_id == user.id
    return True


def can_change(
    user: User, owner_id: str | None, owner_superviser_id: str | None
) -> bool:
    if user.role == UserRole.MANAGER:
        return owner_id == user.id
    if user.role == UserRole.SUPERVISER:
        # бесхозную может взять в работу любой руководитель
        return owner_id is None or owner_superviser_id == user.id
    return False


def can_delete(
    user: User, owner_id: str | None, owner_superviser_id: str | None
) -> bool:
    # проект удаляет руководитель, менеджеру нельзя даже свой
    return user.role == UserRole.SUPERVISER and can_change(
        user, owner_id, owner_superviser_id
    )


def readable_filter(user: User) -> ColumnElement[bool]:
    """то же, что can_read, но для SQL - чтобы пагинация не врала"""
    if user.role == UserRole.MANAGER:
        return Interaction.owner_id == user.id
    return true()
