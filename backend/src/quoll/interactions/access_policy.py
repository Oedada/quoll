"""Кто что может делать с заявкой. Чистые правила, в БД не ходят.

руководитель видит и меняет заявки своих менеджеров - состав команды
динамический, усыновил менеджера - видит его заявки. Заявка без владельца -
черновик создавшего её руководителя, видит и назначает только он. Черновики
выбывшего автора и заявки осиротевших команд видят все руководители: это
общий пул работы, которую надо кому-то отдать. Админ только читает
"""

from dataclasses import dataclass

from sqlalchemy import ColumnElement, and_, exists, or_, select, true
from sqlalchemy.orm import aliased

from quoll.auth.identity_policy import incapacitated_expression, is_incapacitated
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
    author_id: str | None = None
    author_gone: bool = False


def author_gone(author: User | None) -> bool:
    """черновик выбывшего автора иначе не увидел бы никто: удаления
    пользователей нет, а разжалованный руководитель чужие заявки не видит"""
    return (
        author is None or is_incapacitated(author) or author.role != UserRole.SUPERVISER
    )


def _unassigned_for(user: User, ownership: Ownership) -> bool:
    """заявка без владельца, и она этого руководителя - его или ничья"""
    return ownership.owner_id is None and (
        ownership.author_gone or ownership.author_id == user.id
    )


def can_read(user: User, ownership: Ownership) -> bool:
    if user.role == UserRole.MANAGER:
        # и бывшие свои - документы проекта нужны и после передачи
        return ownership.owner_id == user.id or user.id in ownership.former_owner_ids
    if user.role == UserRole.SUPERVISER:
        return (
            _unassigned_for(user, ownership)
            or ownership.owner_orphaned
            or ownership.owner_superviser_id == user.id
        )
    return True


def can_change(user: User, ownership: Ownership) -> bool:
    if user.role == UserRole.MANAGER:
        return ownership.owner_id == user.id
    if user.role == UserRole.SUPERVISER:
        return (
            _unassigned_for(user, ownership) or ownership.owner_superviser_id == user.id
        )
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
    Руководитель цели - свой черновик, черновик выбывшего автора или заявку
    осиротевшей команды
    """
    if actor.role != UserRole.SUPERVISER:
        return False
    if ownership.owner_id is not None and ownership.owner_superviser_id == actor.id:
        return True
    return target.superviser_id == actor.id and (
        _unassigned_for(actor, ownership) or ownership.owner_orphaned
    )


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
        author = aliased(User)
        gone_authors = select(author.id).where(
            or_(
                incapacitated_expression(author),
                author.role != UserRole.SUPERVISER,
            )
        )
        unassigned = and_(
            Interaction.owner_id.is_(None),
            or_(
                Interaction.created_by == user.id,
                Interaction.created_by.is_(None),
                Interaction.created_by.in_(gone_authors),
            ),
        )
        return or_(
            unassigned,
            Interaction.owner_id.in_(team),
            Interaction.owner_id.in_(orphaned),
        )
    return true()
