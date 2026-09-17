import logging

from sqlalchemy import select
from sqlalchemy.orm import selectinload

from quoll.core.base_repository import BaseRepository
from quoll.core.exceptions import IdNotExistsException
from quoll.interactions.models import Interaction, University, Vendor

logger = logging.getLogger(__name__)


class UniversityRepository(BaseRepository[University]):
    model = University

    async def get_by_name(self, name: str) -> University | None:
        logger.debug(f"Getting University by name={name}")
        stmt = select(University).where(University.name == name)
        res = await self.session.execute(stmt)
        return res.scalar_one_or_none()


class VendorRepository(BaseRepository[Vendor]):
    model = Vendor

    async def get_by_name(self, name: str) -> Vendor | None:
        logger.debug(f"Getting Vendor by name={name}")
        stmt = select(Vendor).where(Vendor.name == name)
        res = await self.session.execute(stmt)
        return res.scalar_one_or_none()


class InteractionRepository(BaseRepository[Interaction]):
    model = Interaction

    async def get_with_details(self, interaction_id: int) -> Interaction:
        logger.debug(f"Getting Interaction with details, id={interaction_id}")
        stmt = (
            select(Interaction)
            .where(Interaction.id == interaction_id)
            .options(
                selectinload(Interaction.university),
                selectinload(Interaction.vendor),
                selectinload(Interaction.workflow),
                selectinload(Interaction.state),
            )
        )
        res = await self.session.execute(stmt)
        interaction = res.scalar_one_or_none()
        if interaction is None:
            logger.warning(f"Interaction with id={interaction_id} not found")
            raise IdNotExistsException(Interaction.__name__)
        logger.debug(f"Interaction with id={interaction_id} and details found")
        return interaction

    async def get_by_university(self, university_id: int) -> list[Interaction]:
        logger.debug(f"Getting interactions for university_id={university_id}")
        stmt = (
            select(Interaction)
            .where(Interaction.university_id == university_id)
            .order_by(Interaction.created_at.desc())
        )
        res = await self.session.execute(stmt)
        return list(res.scalars().all())

    async def get_by_vendor(self, vendor_id: int) -> list[Interaction]:
        logger.debug(f"Getting interactions for vendor_id={vendor_id}")
        stmt = (
            select(Interaction)
            .where(Interaction.vendor_id == vendor_id)
            .order_by(Interaction.created_at.desc())
        )
        res = await self.session.execute(stmt)
        return list(res.scalars().all())
