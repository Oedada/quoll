"""Правила шага гусенички. Чистые функции, в базу не ходят.

что обязательно на шаге, задаёт админ в графе: поля стадии и свойства ребра.
Здесь - только сверка фактов с этими настройками
"""

from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Any


def _fits(kind: str, value: Any) -> bool:
    if kind in ("string", "text"):
        return isinstance(value, str)
    if kind == "number":
        # bool - подкласс int, но числом не считается
        return isinstance(value, int | float) and not isinstance(value, bool)
    if kind == "bool":
        return isinstance(value, bool)
    if kind == "date":
        try:
            date.fromisoformat(value)
        except (TypeError, ValueError):
            return False
        return True
    if kind == "datetime":
        # встреча - момент, поэтому только с часовым поясом
        try:
            return datetime.fromisoformat(value).tzinfo is not None
        except (TypeError, ValueError):
            return False
    if kind == "contact":
        # id справочника или объект, из которого контакт создадут или поправят
        return isinstance(value, dict) or (
            isinstance(value, int) and not isinstance(value, bool)
        )
    return False


def value_problems(fields: list[dict[str, Any]], values: dict[str, Any]) -> list[str]:
    """что не так со значениями шага; пустое значение - null"""
    spec = {f["key"]: f for f in fields}
    problems = [f"unknown field '{key}'" for key in values if key not in spec]
    problems += [
        f"field '{key}' must be {spec[key]['type']}"
        for key, value in values.items()
        if key in spec and value is not None and not _fits(spec[key]["type"], value)
    ]
    return problems


def _filled(value: Any) -> bool:
    return value is not None and value != ""


@dataclass(frozen=True)
class Problem:
    """пункт составной ошибки APP-026 (errors-ru.md §3): код + параметры для
    фронта, названия полей и видов документов подставляет он сам по id"""

    code: str
    params: dict[str, Any] = field(default_factory=dict)


def transition_problems(
    *,
    requires_approval: bool,
    approved: bool,
    forward: bool,
    fields: list[dict[str, Any]],
    values: dict[str, Any],
    required_kinds: list[str],
    present_kinds: set[str],
) -> list[Problem]:
    """почему по ребру сейчас нельзя пройти; пусто - можно.

    обязательное проверяется только при движении вперёд: возврат - это как
    раз «шаг не доделан»
    """
    problems = []
    if requires_approval and not approved:
        problems.append(Problem("APP-027"))
    if forward:
        problems += [
            Problem("STEP-002", {"field": f["key"]})
            for f in fields
            if f.get("required") and not _filled(values.get(f["key"]))
        ]
        problems += [
            Problem("DOC-001", {"kind": kind})
            for kind in required_kinds
            if kind not in present_kinds
        ]
    return problems
