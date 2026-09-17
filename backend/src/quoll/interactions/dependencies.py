from typing import Annotated

from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession

from quoll.db import get_db_session
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
