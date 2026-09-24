"""Кто что может делать с заявкой. Чистые правила, в БД не ходят.

руководитель видит и меняет заявки своих менеджеров - состав команды
динамический, усыновил менеджера - видит его заявки. Бесхозные видят все
руководители: это общий пул нераспределённой работы. Админ только читает
"""

from sqlalchemy import ColumnElement, or_, select, true

from quoll.auth.models import Manager, User, UserRole
from quoll.interactions.models import Interaction


def can_read(user: User, owner_id: str | None, owner_superviser_id: str | None) -> bool:
    # бывшие свои заявки менеджер увидит, когда появится история назначений
    if user.role == UserRole.MANAGER:
        return owner_id == user.id
    if user.role == UserRole.SUPERVISER:
        return owner_id is None or owner_superviser_id == user.id
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
    if user.role == UserRole.SUPERVISER:
        team = select(Manager.id).where(Manager.superviser_id == user.id)
        return or_(Interaction.owner_id.is_(None), Interaction.owner_id.in_(team))
    return true()
