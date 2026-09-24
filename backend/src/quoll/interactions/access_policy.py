"""Кто что может делать с заявкой. Чистые правила, в БД не ходят.

руководитель видит и меняет заявки своих менеджеров - состав команды
динамический, усыновил менеджера - видит его заявки. Бесхозные и заявки
осиротевших команд видят все руководители: это общий пул работы, которую
надо кому-то отдать. Админ только читает
"""

from dataclasses import dataclass

from sqlalchemy import ColumnElement, exists, or_, select, true
from sqlalchemy.orm import aliased

from quoll.auth.identity_policy import incapacitated_expression
from quoll.auth.models import Manager, User, UserRole
from quoll.interactions.models import Interaction, InteractionAssignment


@dataclass(frozen=True)
class Ownership:
    """факты о владении заявкой, которые нужны правилам. Собирает их
    репозиторий или захват области - правила в базу не ходят"""

    owner_id: str | None
    owner_superviser_id: str | None
    # руководитель владельца не в строю - команда осиротела
    owner_orphaned: bool = False
    former_owner_ids: frozenset[str] = frozenset()


def _in_common_pool(ownership: Ownership) -> bool:
    return ownership.owner_id is None or ownership.owner_orphaned


def can_read(user: User, ownership: Ownership) -> bool:
    if user.role == UserRole.MANAGER:
        # и бывшие свои - документы проекта нужны и после передачи
        return ownership.owner_id == user.id or user.id in ownership.former_owner_ids
    if user.role == UserRole.SUPERVISER:
        return _in_common_pool(ownership) or ownership.owner_superviser_id == user.id
    return True


def can_change(user: User, ownership: Ownership) -> bool:
    if user.role == UserRole.MANAGER:
        return ownership.owner_id == user.id
    if user.role == UserRole.SUPERVISER:
        # бесхозную может взять в работу любой руководитель
        return ownership.owner_id is None or ownership.owner_superviser_id == user.id
    return False


def can_delete(user: User, ownership: Ownership) -> bool:
    # проект удаляет руководитель, менеджеру нельзя даже свой
    return user.role == UserRole.SUPERVISER and can_change(user, ownership)


def can_pause(user: User, ownership: Ownership) -> bool:
    """П11: пока и владелец, и его руководитель. Отдельным именем - если
    аналитики сузят до руководителя, правка будет здесь одной строкой"""
    return can_change(user, ownership)


def can_assign(actor: User, ownership: Ownership, target: Manager) -> bool:
    """назначить или переназначить заявку.

    руководитель владельца - всегда, в своей команде и в другой отдел.
    Руководитель цели - только бесхозную или из осиротевшей команды
    """
    if actor.role != UserRole.SUPERVISER:
        return False
    if ownership.owner_id is not None and ownership.owner_superviser_id == actor.id:
        return True
    return target.superviser_id == actor.id and _in_common_pool(ownership)


def readable_filter(user: User) -> ColumnElement[bool]:
    """то же, что can_read, но для SQL - чтобы пагинация не врала"""
    if user.role == UserRole.MANAGER:
        was_owner = exists().where(
            InteractionAssignment.interaction_id == Interaction.id,
            InteractionAssignment.manager_id == user.id,
        )
        return or_(Interaction.owner_id == user.id, was_owner)
    if user.role == UserRole.SUPERVISER:
        team = select(Manager.id).where(Manager.superviser_id == user.id)
        boss = aliased(User)
        orphaned = (
            select(Manager.id)
            .outerjoin(boss, Manager.superviser_id == boss.id)
            .where(or_(boss.id.is_(None), incapacitated_expression(boss)))
        )
        return or_(
            Interaction.owner_id.is_(None),
            Interaction.owner_id.in_(team),
            Interaction.owner_id.in_(orphaned),
        )
    return true()
