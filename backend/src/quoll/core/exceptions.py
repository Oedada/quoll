import logging

logger = logging.getLogger(__name__)


class AppException(Exception):
    message: str
    status_code: int

    def __init__(self, status_code: int, message: str):
        self.message = message
        self.status_code = status_code
        super().__init__(message)


class IdNotExistsException(AppException):
    def __init__(self, db_name: str):
        super().__init__(404, f"Id in base {db_name} isn't exists")
        logger.warning(self.message)


class UserNotFoundException(AppException):
    def __init__(self, identifier: str):
        super().__init__(404, f"User with identifier '{identifier}' not found")
        logger.warning(self.message)

class InvalidUserRoleException(AppException):
    def __init__(self, id: str):
        super().__init__(400, f'User with id {id} has invalid role for this operation')
        logger.warning(self.message)

class AuthError(AppException):
    pass


class UnknowAuthError(AuthError):
    def __init__(self, details: str = ""):
        msg = "Unknown auth error"
        if details:
            msg += f": {details}"
        super().__init__(500, msg)
        logger.error(self.message)


class ExpiredAccessTokenAuthError(AuthError):
    def __init__(self):
        super().__init__(401, "Access token expired")
        logger.warning(self.message)


class ExpiredRefreshTokenAuthError(AuthError):
    def __init__(self):
        super().__init__(401, "Refresh token expired")
        logger.warning(self.message)


class InvalidSessionId(AuthError):
    def __init__(self):
        super().__init__(401, "Invalid token")
        logger.warning(self.message)


class UserAlreadyExistsAuthError(AuthError):
    def __init__(self):
        super().__init__(409, "User already exists")
        logger.warning(self.message)


class FileTooLargeException(AppException):
    def __init__(self, max_mb: int):
        super().__init__(413, f"File size exceeds maximum allowed limit of {max_mb} MB")
        logger.warning(self.message)


class StorageException(AppException):
    def __init__(self, detail: str = "Storage operation failed"):
        super().__init__(500, detail)
        logger.error(self.message)
