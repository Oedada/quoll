"""Подпись человека: «Фамилия И. О.» - без отчества только инициал имени."""

DASH = "—"


def person(p) -> str:
    if p is None:
        return DASH
    initials = " ".join(f"{part[0]}." for part in (p.first_name, p.patronymic) if part)
    return f"{p.last_name} {initials}".strip()
