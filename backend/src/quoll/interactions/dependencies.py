from collections.abc import Callable
from typing import Annotated

from fastapi import Depends, HTTPException, Path, status
from sqlalchemy.ext.asyncio import AsyncSession

from quoll.auth.dependencies import CurrentUser
from quoll.auth.models import User
from quoll.db import get_db_session
from quoll.interactions.access_policy import (
    Ownership,
    can_change,
    can_delete,
    can_read,
)
from quoll.interactions.models import Interaction
from quoll.interactions.repository import (
    InteractionRepository,
    UniversityRepository,
    VendorRepository,
)

SessionDep = Annotated[AsyncSession, Depends(get_db_session)]


def get_university_repo(session: SessionDep) -> UniversityRepository:
    return UniversityRepository(session)


def get_vendor_repo(session: SessionDep) -> VendorRepository:
    return VendorRepository(session)


def get_interaction_repo(session: SessionDep) -> InteractionRepository:
    return InteractionRepository(session)


UniversityRepoDep = Annotated[UniversityRepository, Depends(get_university_repo)]
VendorRepoDep = Annotated[VendorRepository, Depends(get_vendor_repo)]
InteractionRepoDep = Annotated[InteractionRepository, Depends(get_interaction_repo)]


InteractionId = Annotated[int, Path(ge=1, description="Interaction ID")]


def _forbidden(action: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail=f"Not allowed to {action} this interaction",
    )


Predicate = Callable[[User, Ownership], bool]


def _guarded(predicate: Predicate, action: str, *, details: bool = False):
    """зависимость: загрузить заявку и пустить, только если predicate разрешает"""

    async def dependency(
        id: InteractionId, user: CurrentUser, repo: InteractionRepoDep
    ) -> Interaction:
        interaction = await (repo.get_with_details(id) if details else repo.get(id))
        if not predicate(user, await repo.ownership(interaction)):
            raise _forbidden(action)
        return interaction

    return dependency


ReadableInteraction = Annotated[
    Interaction, Depends(_guarded(can_read, "view", details=True))
]
ChangeableInteraction = Annotated[Interaction, Depends(_guarded(can_change, "change"))]
DeletableInteraction = Annotated[Interaction, Depends(_guarded(can_delete, "delete"))]
