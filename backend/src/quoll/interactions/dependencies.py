from typing import Annotated

from fastapi import Depends, HTTPException, Path, status
from sqlalchemy.ext.asyncio import AsyncSession

from quoll.auth.dependencies import CurrentUser
from quoll.db import get_db_session
from quoll.interactions.access_policy import can_change, can_delete, can_read
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


async def readable_interaction(
    id: InteractionId, user: CurrentUser, repo: InteractionRepoDep
) -> Interaction:
    interaction = await repo.get_with_details(id)
    if not can_read(user, interaction.owner_id):
        raise _forbidden("view")
    return interaction


async def changeable_interaction(
    id: InteractionId, user: CurrentUser, repo: InteractionRepoDep
) -> Interaction:
    interaction = await repo.get(id)
    owner_superviser_id = await repo.owner_superviser_id(interaction.owner_id)
    if not can_change(user, interaction.owner_id, owner_superviser_id):
        raise _forbidden("change")
    return interaction


async def deletable_interaction(
    id: InteractionId, user: CurrentUser, repo: InteractionRepoDep
) -> Interaction:
    interaction = await repo.get(id)
    owner_superviser_id = await repo.owner_superviser_id(interaction.owner_id)
    if not can_delete(user, interaction.owner_id, owner_superviser_id):
        raise _forbidden("delete")
    return interaction


ReadableInteraction = Annotated[Interaction, Depends(readable_interaction)]
ChangeableInteraction = Annotated[Interaction, Depends(changeable_interaction)]
DeletableInteraction = Annotated[Interaction, Depends(deletable_interaction)]
