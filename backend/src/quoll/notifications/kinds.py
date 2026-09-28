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
    INTEGRATION_PROPOSAL = "INTEGRATION_PROPOSAL"


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
INTERACTION_ASSIGNED = _kind(
    "INTERACTION_ASSIGNED",
    Severity.INFO,
    [Role.OWNER],
    "Вам назначена заявка",
    "{interaction}{note}",
)
INTERACTION_TAKEN_AWAY = _kind(
    "INTERACTION_TAKEN_AWAY",
    Severity.INFO,
    [Role.PREVIOUS_OWNER],
    "Заявку передали другому менеджеру",
    "{interaction}",
)
REQUEST_CREATED = _kind(
    "REQUEST_CREATED",
    Severity.CRITICAL,
    [Role.OWNER_SUPERVISOR],
    "Просьба ждёт решения: {request}",
    "{interaction}: {reason}",
    critical=True,
)
REQUEST_DECIDED = _kind(
    "REQUEST_DECIDED",
    Severity.CRITICAL,
    [Role.REQUESTER],
    "Просьба {decision}: {request}",
    "{interaction}. {comment}",
    critical=True,
)
PAUSE_ENDED = _kind(
    "PAUSE_ENDED",
    Severity.INFO,
    [Role.OWNER],
    "Пауза закончилась",
    "{interaction}{branch}: срок паузы вышел, работа продолжается",
)
PAUSE_WAITING_CAPACITY = _kind(
    "PAUSE_WAITING_CAPACITY",
    Severity.WARNING,
    [Role.OWNER, Role.OWNER_SUPERVISOR],
    "Пауза закончилась, но нет места",
    "{interaction}: срок паузы вышел, у менеджера заняты все активные слоты",
)
# LMS прислала статистику по вузу без заявки - предлагаем завести (К §4)
INTEGRATION_PROPOSAL_CREATE = _kind(
    "INTEGRATION_PROPOSAL_CREATE",
    Severity.INFO,
    [Role.ALL_SUPERVISORS],
    "LMS: новый вуз ждёт заявку",
    "{university}, программа «{program}»: {reason}",
)
# LMS прислала статистику по программе, которой нет в открытой заявке
INTEGRATION_PROPOSAL_ADD = _kind(
    "INTEGRATION_PROPOSAL_ADD",
    Severity.INFO,
    [Role.USER],
    "LMS: добавить программу в заявку",
    "{university}, программа «{program}»: {reason}",
)
# ADD_PROGRAM одобрен после подписания (Р5): ветку заводит КАМ через ДС 4.1
INTEGRATION_PROPOSAL_SIGN_NEEDED = _kind(
    "INTEGRATION_PROPOSAL_SIGN_NEEDED",
    Severity.INFO,
    [Role.USER],
    "LMS: программу нужно оформить допсоглашением",
    "{university}, программа «{program}»: одобрено, оформите ДС на шаге 4.1",
)
