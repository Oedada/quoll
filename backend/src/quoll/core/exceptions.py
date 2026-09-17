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

class AuthError(AppException):
    pass

class UnknowAuthError(AuthError):
    def __init__(self):
        super().__init__(500, "Unknow auth error")

class ExpiredAccessTokenAuthError(AuthError):
    def __init__(self):
        super().__init__(401, "Access token expired")

class ExpiredRefreshTokenAuthError(AuthError):
    def __init__(self):
        super().__init__(401, "Refresh token expired")

class InvalidSessionId(AuthError):
    def __init__(self):
        super().__init__(401, "Invalid token")

class UserAlreadyExistsAuthError(AuthError):
    def __init__(self):
        super().__init__(409, "User already exists")
