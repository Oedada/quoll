"""Реестр видов уведомлений: кому по умолчанию, как выглядит, насколько важно.

виды - в коде, а не в базе: у каждого свой шаблон. Новый повод - новая
запись здесь и вызов emit() в сервисе
"""

from dataclasses import dataclass
from enum import StrEnum


class Severity(StrEnum):
    INFO = "INFO"
    WARNING = "WARNING"
    CRITICAL = "CRITICAL"


class Role(StrEnum):
    """отношение человека к предмету уведомления, а не роль в системе"""

    OWNER = "OWNER"  # текущий КАМ заявки
    PREVIOUS_OWNER = "PREVIOUS_OWNER"
    # руководитель КАМа; у заявки без КАМа - автор-руководитель
    OWNER_SUPERVISOR = "OWNER_SUPERVISOR"
    AUTHOR = "AUTHOR"  # руководитель, создавший заявку
    REQUESTER = "REQUESTER"  # автор просьбы
    EDITOR = "EDITOR"  # автор правки шага или файла
    ADMINS = "ADMINS"
    ALL_SUPERVISORS = "ALL_SUPERVISORS"
    USER = "USER"  # явно указанные


class Subject(StrEnum):
    INTERACTION = "INTERACTION"
    BRANCH = "BRANCH"
    REQUEST = "REQUEST"
    DOCUMENT = "DOCUMENT"
    WORKFLOW_CHANGE = "WORKFLOW_CHANGE"
    SYSTEM = "SYSTEM"


@dataclass(frozen=True)
class Kind:
    code: str
    severity: Severity
    audience: tuple[Role, ...]
    # шаблоны str.format по контексту emit()
    title: str
    body: str
    # такой повод нельзя будет отключить, когда появятся каналы (О 17-19)
    critical: bool = False
    # напоминание к действию нужно и тому, кто его вызвал
    include_actor: bool = False


_KINDS: dict[str, Kind] = {}


def _kind(code: str, severity: Severity, audience, title: str, body: str, **kw):
    kind = Kind(code, severity, tuple(audience), title, body, **kw)
    _KINDS[code] = kind
    return kind


def by_code(code: str) -> Kind:
    return _KINDS[code]


INTERACTION_DECLINED = _kind(
    "INTERACTION_DECLINED",
    Severity.INFO,
    [Role.AUTHOR],
    "Менеджер отказался от заявки",
    "{interaction}: {comment}",
)
BACKWARD_MOVE = _kind(
    "BACKWARD_MOVE",
    Severity.INFO,
    [Role.OWNER_SUPERVISOR],
    "Возврат на шаг назад",
    "{interaction}{branch}: {from_stage} → {to_stage}. {comment}",
)
DOCUMENT_PENDING = _kind(
    "DOCUMENT_PENDING",
    Severity.INFO,
    [Role.OWNER_SUPERVISOR],
    "Файл ждёт одобрения",
    "{interaction}: «{document}» на пройденный шаг",
)
DOCUMENT_DECIDED = _kind(
    "DOCUMENT_DECIDED",
    Severity.INFO,
    [Role.EDITOR],
    "Файл {decision}",
    "{interaction}: «{document}». {comment}",
)
STEP_EDIT_PENDING = _kind(
    "STEP_EDIT_PENDING",
    Severity.INFO,
    [Role.OWNER_SUPERVISOR],
    "Правка шага ждёт одобрения",
    "{interaction}, шаг «{stage}»: {fields}",
)
STEP_EDIT_DECIDED = _kind(
    "STEP_EDIT_DECIDED",
    Severity.INFO,
    [Role.EDITOR],
    "Правка шага {decision}",
    "{interaction}, шаг «{stage}»",
)
ALL_BRANCHES_CLOSED = _kind(
    "ALL_BRANCHES_CLOSED",
    Severity.INFO,
    [Role.OWNER_SUPERVISOR],
    "Все ветки закрыты",
    "{interaction}: ветки закрыты, заявку можно закрыть",
    include_actor=True,
)
WORKFLOW_CHANGE_DECIDED = _kind(
    "WORKFLOW_CHANGE_DECIDED",
    Severity.INFO,
    [Role.REQUESTER],
    "Изменение воркфлоу {decision}",
    "{comment}",
)
MANUAL = _kind("MANUAL", Severity.INFO, [Role.USER], "{title}", "{body}")
STALL = _kind(
    "STALL",
    Severity.CRITICAL,
    [Role.OWNER, Role.OWNER_SUPERVISOR],
    "Застой на шаге",
    "{interaction}{branch}: на шаге «{stage}» нет движения {days} дн.",
    critical=True,
)
LICENSE_EXPIRING = _kind(
    "LICENSE_EXPIRING",
    Severity.WARNING,
    [Role.OWNER, Role.OWNER_SUPERVISOR],
    "Лицензия скоро закончится",
    "{interaction}{branch}: лицензия действует до {until}",
)
CONTRACT_EXPIRING = _kind(
    "CONTRACT_EXPIRING",
    Severity.WARNING,
    [Role.OWNER, Role.OWNER_SUPERVISOR],
    "Договор скоро закончится",
    "{interaction}: договор действует до {until}",
)
MOVED_TO_PASSIVE = _kind(
    "MOVED_TO_PASSIVE",
    Severity.INFO,
    [Role.OWNER],
    "Заявка переведена в пассивные",
    "{interaction}: давно без действий на долгосрочных этапах. "
    "Вернуть в активные можно кнопкой на карточке",
)
