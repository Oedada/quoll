"""Поле шага «контакт» (Д15): в значениях шага лежит только id, ПДн - в
зашифрованном справочнике (М 9). Для человека поле выглядит частью шага:
чтение раскрывает контакт, запись может сразу создать или поправить его.
Создание и правка - через общий сервис справочника: журнал без ПДн (О 25)
"""

from typing import Any

from pydantic import ValidationError
from sqlalchemy.ext.asyncio import AsyncSession

from quoll.auth.audit_models import TargetType
from quoll.catalog import service as catalog
from quoll.catalog.models import Contact
from quoll.catalog.schemas import ContactPatch, ContactWrite
from quoll.core.exceptions import DomainRuleException
from quoll.workflows.models import Stage

_SHOWN = ("full_name", "phone", "email", "position", "contact_methods", "is_actual")


def _contact_keys(stage: Stage) -> set[str]:
    return {f["key"] for f in stage.fields if f.get("type") == "contact"}


async def _own(session: AsyncSession, contact_id: Any, university_id: int) -> Contact:
    contact = (
        await session.get(Contact, contact_id) if isinstance(contact_id, int) else None
    )
    if contact is None or contact.university_id != university_id:
        raise DomainRuleException(
            400, f"Contact '{contact_id}' is not of this university"
        )
    return contact


async def resolve(
    session: AsyncSession,
    stage: Stage,
    university_id: int,
    values: dict[str, Any],
    actor_id: str,
) -> dict[str, Any]:
    """значения шага с контактами в виде id: число - ссылка, объект без id -
    новый контакт вуза, объект с id - правка контакта"""
    resolved = dict(values)
    for key in _contact_keys(stage) & values.keys():
        value = values[key]
        if value is None or isinstance(value, int) and not isinstance(value, bool):
            if value is not None:
                await _own(session, value, university_id)
            continue
        if not isinstance(value, dict):
            raise DomainRuleException(422, f"field '{key}' must be a contact")
        data = {k: v for k, v in value.items() if k != "id"}
        try:
            if "id" in value:
                await _own(session, value["id"], university_id)
                if data:
                    await catalog.update(
                        session,
                        Contact,
                        TargetType.CONTACT,
                        value["id"],
                        ContactPatch(**data),
                        actor_id,
                    )
                resolved[key] = value["id"]
            else:
                created = await catalog.create(
                    session,
                    Contact,
                    TargetType.CONTACT,
                    ContactWrite(university_id=university_id, **data),
                    actor_id,
                )
                resolved[key] = created.id
        except ValidationError as e:
            raise DomainRuleException(
                422, f"field '{key}': {e.errors()[0]['msg']}"
            ) from e
    return resolved


async def expand(
    session: AsyncSession, stage: Stage, values: dict[str, Any], *, for_view: bool
) -> dict[str, Any]:
    """id -> данные контакта. Удалённый: для проверки шага - пусто (обязательное
    поле не засчитается), для показа - пометка «удалён»"""
    shown = dict(values)
    for key in _contact_keys(stage) & values.keys():
        contact = await session.get(Contact, values[key]) if values[key] else None
        shown[key] = (
            {"id": contact.id, **{f: getattr(contact, f) for f in _SHOWN}}
            if contact is not None
            else (
                {"id": values[key], "deleted": True}
                if for_view and values[key]
                else None
            )
        )
    return shown
