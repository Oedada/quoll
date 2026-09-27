"""Срок паузы - общий у заявки и ветки"""

from datetime import UTC, datetime

from quoll.core import SystemDefaults
from quoll.core.exceptions import DomainRuleException


def check_pause_term(until: datetime) -> None:
    if until.tzinfo is None:
        raise DomainRuleException(400, "Pause term must include a timezone")
    hours = (until - datetime.now(UTC)).total_seconds() / 3600
    if not SystemDefaults.MIN_PAUSE_HOURS <= hours <= SystemDefaults.MAX_PAUSE_HOURS:
        raise DomainRuleException(
            400,
            f"Pause term must be {SystemDefaults.MIN_PAUSE_HOURS}-"
            f"{SystemDefaults.MAX_PAUSE_HOURS} hours ahead",
        )
