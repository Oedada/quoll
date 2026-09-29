"""Подписи отчёта по-русски - одни и те же в предпросмотре и в файле"""

TITLE = "Отчёт по взаимодействиям с вузами"
DASH = "—"
NOT_SET = {
    "direction": "не указано",
    "program": "не указана",
    "product": "без продукта",
}
NO_MOVES = "нет"

COLUMNS = {
    "university": "Вуз",
    "direction": "ИТ-направление",
    "program": "ИТ-программа",
    "product": "ИТ-продукт",
    "status": "Статус",
    "responsible": "Ответственный",
    "students": "Студентов",
    "streams": "Потоков",
    "teachers_kam": "Обучено преподавателей (КАМ)",
    "teachers_lms": "Обучено преподавателей (LMS)",
    "transitions": "Переходы за период",
    "contract_number": "Номер договора",
    "license_until": "Лицензия до",
    "transfer_status": "Статус передачи",
    "region": "Регион",
}
# pdf: узкие колонки с короткими подписями - длинное слово рвалось бы по слогам
PDF_COLUMNS = {
    **COLUMNS,
    "direction": "Направление",
    "program": "Программа",
    "product": "Продукт",
    "students": "Студ.",
    "streams": "Потоки",
    "teachers_kam": "Обуч. преп. (КАМ)",
    "teachers_lms": "Обуч. преп. (LMS)",
    "transitions": "Переходы за период",
    "contract_number": "№ договора",
    "transfer_status": "Передача",
}
FILTERS = {
    "university_ids": "Вузы",
    "regions": "Регион",
    "direction_ids": "ИТ-направления",
    "program_ids": "ИТ-программы",
    "product_ids": "ИТ-продукты",
    "responsible_ids": "Ответственные",
    "statuses": "Статус",
}
ALL = "все"
SPECIAL_STATUSES = {
    "AWAITING": "Ждёт принятия",
    "DONE": "Завершена",
    "REFUSED": "Отказ",
}
TRANSFER = {"TRANSFERRED": "передано", "NOT_TRANSFERRED": "не передано"}
ROLES = {"manager": "КАМ", "superviser": "Руководитель", "admin": "Администратор"}
NO_PRODUCT = "Без продукта"


def responsible(name: str, earlier: str | None) -> str:
    return f"{name} (ранее: {earlier})" if earlier else name


def status(s) -> str:
    if s.kind != "STEP":
        return SPECIAL_STATUSES[s.kind]
    text = s.stage_name or DASH
    if s.archived:
        text += " (архив)"
    if s.paused:
        text += " · пауза"
    if s.agreement:
        text += " · идёт допсоглашение"
    return text


def move(m) -> str:
    day = m.at.strftime("%d.%m")
    if m.kind == "PAUSE":
        return f"{day} пауза"
    if m.kind == "UNPAUSE":
        return f"{day} снятие паузы"
    if m.kind == "CLOSE":
        return f"{day} закрыта"
    if m.kind == "REOPEN":
        return (
            f"{day} возобновлена → {m.to_name}" if m.restart else f"{day} переоткрыта"
        )
    if m.kind == "IMPORT":
        return f"{day} импорт → {m.to_name}"
    if m.from_name is None:
        return f"{day} → {m.to_name}"
    return f"{day} {m.from_name} → {m.to_name}"


def moves(items, sep: str = "; ") -> str:
    return sep.join(move(m) for m in items) if items else NO_MOVES
