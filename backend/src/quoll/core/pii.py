"""Шифрование персональных данных в базе (Q17): в таблице - нечитаемая
строка, ключ - в окружении, отдельно от базы. Несколько ключей через
запятую - ротация: шифрует первый, читает любой"""

from functools import cache

from cryptography.fernet import Fernet, MultiFernet
from sqlalchemy import Text
from sqlalchemy.types import TypeDecorator

from quoll.config import settings


@cache
def _fernet() -> MultiFernet:
    keys = [k.strip() for k in settings.pii_encryption_key.split(",") if k.strip()]
    return MultiFernet([Fernet(k) for k in keys])


class EncryptedString(TypeDecorator):
    """строка, которая в базе лежит зашифрованной. Искать по ней нельзя"""

    impl = Text
    cache_ok = True

    def process_bind_param(self, value: str | None, dialect) -> str | None:
        if value is None:
            return None
        return _fernet().encrypt(value.encode()).decode()

    def process_result_value(self, value: str | None, dialect) -> str | None:
        if value is None:
            return None
        return _fernet().decrypt(value.encode()).decode()
