"""Коды ошибок области COM (errors-ru.md §7)."""

from quoll.core.exceptions import AppException

_MESSAGES: dict[str, tuple[int, str]] = {
    "COM-001": (404, "Comment not found"),
    "COM-002": (403, "Not allowed to write to this interaction"),
    "COM-003": (403, "Not allowed to edit this comment"),
    "COM-004": (403, "Not allowed to delete this comment"),
    "COM-005": (409, "Comment is already deleted"),
    "COM-006": (422, "Comment text is empty"),
    "COM-007": (422, "Comment text is longer than 4000 characters"),
    "COM-008": (404, "Reply target is not in this place"),
    "COM-009": (422, "Too many files, at most 10 allowed"),
}


def com_error(code: str) -> AppException:
    status_code, message = _MESSAGES[code]
    return AppException(status_code, message, code)
