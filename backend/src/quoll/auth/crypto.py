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

    def decrypt(self, ciphertext: str) -> str | None:
        """None, если расшифровать нечем - ключ потеряли
        закрываем сессию
        """
        try:
            return self._fernet.decrypt(ciphertext.encode()).decode()
        except InvalidToken:
            logger.warning("Session refresh token could not be decrypted")
            return None
