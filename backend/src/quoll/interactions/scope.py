"""Захват области заявки под блокировкой - общий вход всех операций над ней.

владелец читается до блокировки, а под блокировкой может оказаться другим:
заявку успели переназначить. Тогда попытка откатывается к савпойнту - это
отпускает взятые в ней блокировки - и повторяется
"""

from collections.abc import Iterable
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from quoll.auth.identity_policy import identity_denial, is_incapacitated
from quoll.auth.models import Manager, User
from quoll.core.exceptions import (
    DomainRuleException,
    IdentityDeniedException,
    IdNotExistsException,
    InteractionChangedConcurrentlyException,
)
from quoll.core.locking import lock_row, lock_rows
from quoll.interactions.access_policy import Ownership, author_gone
from quoll.interactions.models import Interaction

MAX_ATTEMPTS = 3


@dataclass(frozen=True)
class InteractionScope:
    interaction: Interaction
    # None - система (воркер, сторож)
    actor: User | None
    owner: Manager | None
    # руководитель владельца - на уровне User: все признаки недееспособности
    # лежат в users
    owner_superviser: User | None
    # автор важен, пока владельца нет: чей это черновик
    author: User | None
    managers: dict[str, Manager]

    @property
    def ownership(self) -> Ownership:
        """факты для правил - из заблокированных строк, а не прочитанных раньше.

        бывших владельцев здесь нет: они нужны только чтению, а область берут
        для изменений. can_read по этим фактам бывшему владельцу откажет
        """
        return Ownership(
            self.interaction.owner_id,
            self.owner.superviser_id if self.owner else None,
            owner_orphaned=self.owner is not None
            and is_incapacitated(self.owner_superviser),
            author_id=self.interaction.created_by,
            author_gone=author_gone(self.author),
            on_stage=self.interaction.state_id is not None,
            closed=self.interaction.closed_at is not None,
        )


async def _read_owner(
    session: AsyncSession, interaction_id: int
) -> tuple[str | None, str | None]:
    """владелец и автор, без блокировки. Автор не меняется, владелец -
    может, поэтому его сверяют под блокировкой"""
    row = (
        await session.execute(
            select(Interaction.owner_id, Interaction.created_by).where(
                Interaction.id == interaction_id
            )
        )
    ).one_or_none()
    if row is None:
        raise IdNotExistsException(Interaction.__name__)
    return row.owner_id, row.created_by


async def lock_interaction_scope(
    session: AsyncSession,
    interaction_id: int,
    actor_id: str,
    target_manager_ids: Iterable[str] = (),
    *,
    allow_closed: bool = False,
) -> InteractionScope:
    """Manager -> User -> Interaction, как велит общий порядок блокировок.

    закрытую заявку меняет только переоткрытие (allow_closed) - всем
    остальным 409
    """
    targets = list(target_manager_ids)
    for _ in range(MAX_ATTEMPTS):
        seen_owner, author_id = await _read_owner(session, interaction_id)
        if seen_owner is not None:
            author_id = None
        attempt = await session.begin_nested()
        managers = await lock_rows(session, Manager, [seen_owner, *targets])
        owner = managers.get(seen_owner)
        superviser_id = owner.superviser_id if owner else None
        users = await lock_rows(
            session, User, [seen_owner, *targets, actor_id, superviser_id, author_id]
        )
        interaction = await lock_row(session, Interaction, interaction_id)
        if interaction is not None and interaction.owner_id == seen_owner:
            await attempt.commit()
            # actor_id=None - система: дееспособность проверять не у кого
            actor = users[actor_id] if actor_id is not None else None
            denial = identity_denial(actor) if actor is not None else None
            if denial is not None:
                denial_status, denial_detail = denial
                denial_code = {401: "AUTH-001", 403: "AUTH-002", 409: "AUTH-003"}[
                    denial_status
                ]
                raise IdentityDeniedException(
                    denial_status, denial_detail, code=denial_code
                )
            if interaction.closed_at is not None and not allow_closed:
                raise DomainRuleException(409, "Interaction is closed", code="APP-010")
            return InteractionScope(
                interaction=interaction,
                actor=actor,
                owner=owner,
                owner_superviser=users.get(superviser_id),
                author=users.get(author_id),
                managers=managers,
            )
        await attempt.rollback()
    raise InteractionChangedConcurrentlyException(interaction_id)
