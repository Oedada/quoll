import logging

from cryptography.fernet import Fernet, InvalidToken, MultiFernet

logger = logging.getLogger(__name__)


class TokenCipher:
    """шифрование refresh-токенов.

    Fernet. Несколько ключей через запятую дают ротацию шифруем первым, расшифровываем любым
    """

    def __init__(self, keys: str):
        parsed = [key.strip() for key in keys.split(",") if key.strip()]
        if not parsed:
            raise ValueError("SESSION_SECRET_KEY is empty")
        self._fernet = MultiFernet([Fernet(key) for key in parsed])

    def encrypt(self, plaintext: str) -> str:
        return self._fernet.encrypt(plaintext.encode()).decode()

    def decrypt(self, ciphertext: str, ttl: int | None = None) -> str | None:
        """None, если расшифровать нечем - ключ потеряли
        закрываем сессию. ttl в секундах - старше не принимаем
        """
        try:
            return self._fernet.decrypt(ciphertext.encode(), ttl=ttl).decode()
        except InvalidToken:
            logger.warning("Encrypted value could not be decrypted or expired")
            return None
