from sqlalchemy import select

from quoll.core.base_repository import BaseRepository
from quoll.notifications.models import Notify


class NotifyRepository(BaseRepository[Notify]):
    model = Notify

    async def get_by_user(self, user_id: str, limit: int = 100, offset: int = 0) -> list[Notify]:
        result = await self.session.execute(
            select(self.model)
            .where(self.model.user_id == user_id)
            .order_by(self.model.created_at.desc())
            .limit(limit)
            .offset(offset)
        )
        return list(result.scalars().all())

    async def get_unread_by_user(self, user_id: str) -> list[Notify]:
        result = await self.session.execute(
            select(self.model)
            .where(self.model.user_id == user_id)
            .where(self.model.is_read == False)  # noqa: E712
            .order_by(self.model.created_at.desc())
        )
        return list(result.scalars().all())

    async def get_all(self, limit: int = 100, offset: int = 0) -> list[Notify]:
        result = await self.session.execute(
            select(self.model)
            .order_by(self.model.created_at.desc())
            .limit(limit)
            .offset(offset)
        )
        return list(result.scalars().all())