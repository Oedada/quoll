import hashlib
import logging
from datetime import UTC, datetime

from sqlalchemy import delete as sa_delete
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import async_sessionmaker

from quoll.auth.models import Session

logger = logging.getLogger(__name__)


def hash_session_key(raw_key: str) -> str:
    """в БД лежит только хеш ключа, выданного клиенту"""
    return hashlib.sha256(raw_key.encode()).hexdigest()


class SessionStore:
    """сессии живут в своих коротких транзакциях, не в транзакции запроса.
    """

    def __init__(self, session_maker: async_sessionmaker):
        self._maker = session_maker

    async def create(
        self,
        key_hash: str,
        user_id: str,
        refresh_token: str,
        expires_at: datetime,
    ) -> None:
        async with self._maker() as db:
            db.add(
                Session(
                    id=key_hash,
                    user_id=user_id,
                    refresh_token=refresh_token,
                    expires_at=expires_at,
                    last_validated_at=datetime.now(UTC),
                )
            )
            await db.commit()
        logger.debug(f"Session created for user_id={user_id}")

    async def get_active(self, key_hash: str) -> Session | None:
        """срок проверяет сам запрос - просроченная сессия не находится"""
        async with self._maker() as db:
            stmt = select(Session).where(
                Session.id == key_hash, Session.expires_at > func.now()
            )
            return (await db.execute(stmt)).scalar_one_or_none()

    async def claim_validation(self, key_hash: str, expected: datetime) -> bool:
        """в сеть идёт только тот запрос, который выиграл CAS"""
        async with self._maker() as db:
            stmt = (
                update(Session)
                .where(Session.id == key_hash, Session.last_validated_at == expected)
                .values(last_validated_at=datetime.now(UTC))
                .returning(Session.id)
            )
            claimed = (await db.execute(stmt)).scalar_one_or_none() is not None
            await db.commit()
        return claimed

    async def release_claim(self, key_hash: str, previous: datetime) -> None:
        """вернуть метку на место после сетевого сбоя.

        иначе сдвиг соврёт, что сверка прошла, и сессия переживёт мёртвый Keycloak
        """
        async with self._maker() as db:
            await db.execute(
                update(Session)
                .where(Session.id == key_hash)
                .values(last_validated_at=previous)
            )
            await db.commit()

    async def apply_validation(
        self, key_hash: str, refresh_token: str, expires_at: datetime
    ) -> None:
        async with self._maker() as db:
            await db.execute(
                update(Session)
                .where(Session.id == key_hash)
                .values(
                    refresh_token=refresh_token,
                    expires_at=expires_at,
                    last_validated_at=datetime.now(UTC),
                )
            )
            await db.commit()

    async def delete(self, key_hash: str) -> None:
        async with self._maker() as db:
            await db.execute(sa_delete(Session).where(Session.id == key_hash))
            await db.commit()

    async def delete_for_user(self, user_id: str) -> int:
        """отзыв при деактивации, конфликте ролей и смене роли"""
        async with self._maker() as db:
            result = await db.execute(
                sa_delete(Session).where(Session.user_id == user_id)
            )
            await db.commit()
        return result.rowcount or 0
