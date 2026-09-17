from quoll.auth.models import User


class UserRepositories():

    async def get(self, id_: str) -> User:
        
