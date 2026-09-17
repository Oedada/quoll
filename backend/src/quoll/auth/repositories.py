from sqlalchemy.ext.asyncio import AsyncSession
from quoll.core import BaseRepository

class UserRepositories(BaseRepository[None]):

    def __init__(self, session: AsyncSession):
        self.s = session

    def 
