from typing import Annotated

from fastapi import Depends, Query

from quoll.auth.dependencies import SessionDep
from quoll.core import SystemDefaults
from quoll.org.repository import OrgRepository


def get_org_repo(session: SessionDep) -> OrgRepository:
    return OrgRepository(session)


OrgRepoDep = Annotated[OrgRepository, Depends(get_org_repo)]
Limit = Annotated[
    int,
    Query(ge=1, le=SystemDefaults.MAX_PAGE_SIZE),
]
Offset = Annotated[int, Query(ge=0)]
