import logging
from typing import ClassVar

logger = logging.getLogger(__name__)


class AppException(Exception):
    message: str
    status_code: int
    # код для фронта по errors-ru.md и его параметры; у старых ошибок пусто
    code: str | None
    params: dict | None
    # составная ошибка (errors-ru.md §3): список пунктов {code, params},
    # у каждого свой код - APP-026, STEP-001, WF-001
    items: list[dict] | None

    def __init__(
        self,
        status_code: int,
        message: str,
        code: str | None = None,
        params: dict | None = None,
        items: list[dict] | None = None,
    ):
        self.message = message
        self.status_code = status_code
        self.code = code
        self.params = params
        self.items = items
        super().__init__(message)


class IdNotExistsException(AppException):
    def __init__(self, db_name: str, code: str | None = None):
        if code is None:
            # заявка не найдена - у пользователя своя подсказка (APP-001),
            # остальные сущности по умолчанию - общий текст Т (SYS-004);
            # некоторые вызовы переопределяют код (например DOC-003 у файлов)
            code = "APP-001" if db_name == "Interaction" else "SYS-004"
        super().__init__(404, f"Id in base {db_name} isn't exists", code=code)
        logger.warning(self.message)


class UserNotFoundException(AppException):
    def __init__(self, identifier: str):
        super().__init__(404, f"User with identifier '{identifier}' not found")
        logger.warning(self.message)


class InvalidUserRoleException(AppException):
    def __init__(self, id: str):
        super().__init__(400, f"User with id {id} has invalid role for this operation")
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


# не в строю и «не беру новые» - конфликт с состоянием, а не плохой запрос:
# 409, как у оргопераций
class ManagerNotActiveException(AppException):
    # ORG-001: причина - в трёх канонических формулировках из errors-ru §1
    _REASONS: ClassVar[dict[str, str]] = {
        "inactive": "учётная запись отключена",
        "role mapping conflict": "роль настроена с ошибкой",
        "role transition in progress": "идёт смена роли",
    }

    def __init__(self, manager_id: str, reason: str = "inactive"):
        super().__init__(
            409,
            f"Manager '{manager_id}' cannot work: {reason}",
            code="ORG-001",
            params={"reason": self._REASONS.get(reason, reason)},
        )
        logger.warning(self.message)


class ManagerUnavailableException(AppException):
    def __init__(self, manager_id: str):
        super().__init__(
            409, f"Manager '{manager_id}' is not accepting new projects", code="ORG-003"
        )
        logger.warning(self.message)


class CapacityExceededException(AppException):
    def __init__(self, manager_id: str, current: int, requested: int, maximum: int):
        super().__init__(
            409,
            f"Manager '{manager_id}' capacity exhausted: "
            f"{current}/{maximum} occupied, {requested} more requested",
            code="ORG-002",
            params={"current": current, "maximum": maximum},
        )
        logger.warning(self.message)


class WorkflowNotPublishedException(AppException):
    def __init__(self, workflow_id: int):
        super().__init__(
            409, f"Workflow '{workflow_id}' is not published", code="APP-020"
        )
        logger.warning(self.message)


class IdentityProviderUnavailableException(AppException):
    def __init__(self, details: str = ""):
        super().__init__(503, "Identity provider is unavailable")
        logger.error(f"{self.message}: {details}")


class InvalidAuthorizationCodeException(AppException):
    def __init__(self, provider_status: int):
        super().__init__(400, "Authorization code is invalid or expired")
        logger.warning(f"{self.message} (provider answered {provider_status})")


class LoginFlowException(AppException):
    def __init__(self, reason: str):
        super().__init__(400, f"Login flow rejected: {reason}")
        logger.warning(self.message)


class PublishedGraphChangeException(AppException):
    def __init__(self, fields: list[str]):
        super().__init__(
            409,
            f"Cannot change {', '.join(fields)} of a published workflow edge: "
            "deactivate it and create a new one",
            code="WF-016",
        )
        logger.warning(self.message)


class InteractionChangedConcurrentlyException(AppException):
    def __init__(self, interaction_id: int):
        super().__init__(
            409,
            f"Interaction '{interaction_id}' is being changed concurrently, retry",
            code="APP-002",
        )
        logger.warning(self.message)


class IdentityDeniedException(AppException):
    """актора перепроверили под блокировкой, а его уже нельзя пускать"""

    def __init__(
        self,
        status_code: int,
        detail: str,
        code: str | None = None,
        params: dict | None = None,
    ):
        super().__init__(status_code, detail, code=code, params=params)
        logger.warning(self.message)


class TargetAccountUnavailableException(AppException):
    """цель назначения не годится по данным Keycloak"""

    def __init__(self, user_id: str, reason: str):
        super().__init__(409, f"Target account '{user_id}' is unavailable: {reason}")
        logger.warning(self.message)


class StaleStateException(AppException):
    """клиент ожидал одно, а в базе уже другое - он работает с устаревшими данными.

    код зависит от вызова (APP-002/APP-003/ORG-010 и т.п.) - передаётся явно"""

    def __init__(
        self,
        what: str,
        current: object,
        code: str | None = None,
        params: dict | None = None,
    ):
        super().__init__(
            409,
            f"{what} has changed, current value: {current!r}",
            code=code,
            params=params,
        )
        logger.warning(self.message)


class OperationForbiddenException(AppException):
    def __init__(
        self, action: str, code: str | None = None, params: dict | None = None
    ):
        super().__init__(403, f"Not allowed to {action}", code=code, params=params)
        logger.warning(self.message)


class DomainRuleException(AppException):
    """операция нарушает доменное правило: 400 - запрос не имеет смысла,
    409 - противоречит текущему состоянию"""

    def __init__(
        self,
        status_code: int,
        detail: str,
        code: str | None = None,
        params: dict | None = None,
        items: list[dict] | None = None,
    ):
        super().__init__(status_code, detail, code=code, params=params, items=items)
        logger.warning(self.message)
