"""Кого пускать в систему. Одно правило на каждый запрос, на сокет и на вход"""

from fastapi import status

from quoll.auth.models import IdentitySyncStatus, RoleTransitionStatus, User


def identity_denial(user: User | None) -> tuple[int, str] | None:
    """почему пользователя нельзя пускать, или None, если можно"""
    if user is None or not user.is_active:
        return status.HTTP_401_UNAUTHORIZED, "Not authenticated"
    if user.identity_sync_status != IdentitySyncStatus.OK:
        return status.HTTP_403_FORBIDDEN, "Account role mapping is inconsistent"
    # П8 - на время смены роли учётка блокируется полностью, чтение тоже
    if user.role_transition_status != RoleTransitionStatus.NONE:
        return status.HTTP_409_CONFLICT, "Role transition in progress"
    return None


def is_incapacitated(user: User | None) -> bool:
    """руководитель, которого нет в строю: неактивен, конфликт ролей или смена
    роли. Его команда осиротела - заявки может забрать другой руководитель"""
    return user is None or identity_denial(user) is not None
