from quoll.notifications.connection_storage import ConnectionStorage
from quoll.notifications.models import Notify
from quoll.notifications.repository import NotifyRepository
from quoll.notifications.schemas import NotifyCreate, NotifyRead


class NotifyService:
    def __init__(self, repo: NotifyRepository, connections: ConnectionStorage) -> None:
        self.repo = repo
        self.connections = connections

    async def create_and_send(
        self,
        user_id: str,
        title: str,
        message: str,
    ) -> Notify:
        data = NotifyCreate(
            user_id=user_id, title=title, message=message 
        )
        notify = await self.repo.create(data)
        await self.connections.send_to_user(
            user_id, NotifyCreate.model_validate(notify).model_dump()
        )
        return notify

    async def send_notification(self, user_id: str, title: str, message: str) -> Notify:
        return await self.create_and_send(user_id=user_id, title=title, message=message)

    async def mark_as_read(self, notify_id: int) -> Notify | None:
        notify = await self.repo.get(notify_id)
        if notify:
            notify.is_read = True
            await self.repo.update(notify_id, {"is_read": True})
        return notify
