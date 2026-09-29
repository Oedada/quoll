"""Примеры уведомлений для демо-учёток - чтобы лента и колокольчик не были
пустыми при первом входе. Отправляются тем же emit(), что и настоящие;
повторный запуск ничего не делает - у каждого примера свой dedup_key.
Без interaction_id: в чистой базе заявок нет, и ссылаться не на что
"""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from quoll.auth.bootstrap import DEMO_ACCOUNTS
from quoll.auth.models import User
from quoll.config import settings
from quoll.notifications import kinds
from quoll.notifications.emit import Audience, emit
from quoll.notifications.kinds import Kind, Subject

# (вид, {поле Audience: логин}, контекст шаблона). Руководителя указываем явно:
# без него emit() разошлёт «руководителю КАМа» всем руководителям
EXAMPLES: tuple[tuple[Kind, dict[str, str], dict[str, str]], ...] = (
    (
        kinds.INTERACTION_ASSIGNED,
        {"owner_id": "microbro1"},
        {
            "interaction": "СПбГУТ, заявка 1038",
            "note": ". Начните с первичного контакта",
        },
    ),
    (
        kinds.STALL,
        {"owner_id": "microbro1", "owner_superviser_id": "miniboss"},
        {
            "interaction": "УрФУ, заявка 1027",
            "branch": "",
            "stage": "Согласование программы",
            "days": "9",
        },
    ),
    (
        kinds.REQUEST_DECIDED,
        {"requester_id": "microbro1"},
        {
            "decision": "одобрена",
            "request": "переход на следующий шаг",
            "interaction": "МИРЭА, заявка 1012",
            "comment": "Договор подписан, можно переходить к передаче",
        },
    ),
    (
        kinds.LICENSE_EXPIRING,
        {"owner_id": "microbro1", "owner_superviser_id": "miniboss"},
        {
            "interaction": "ТПУ, заявка 998",
            "branch": ", ветка «Базы данных»",
            "until": "30.09.2026",
        },
    ),
    (
        kinds.INTERACTION_ASSIGNED,
        {"owner_id": "microbro2"},
        {"interaction": "МТУСИ, заявка 1005", "note": ""},
    ),
    (
        kinds.DOCUMENT_DECIDED,
        {"editor_id": "microbro2"},
        {
            "decision": "одобрен",
            "interaction": "НГТУ, заявка 1019",
            "document": "Проект программы курса",
            "comment": "Замечаний нет",
        },
    ),
    (
        kinds.PAUSE_ENDED,
        {"owner_id": "microbro2"},
        {"interaction": "ТУСУР, заявка 1031", "branch": ""},
    ),
    (
        kinds.REQUEST_CREATED,
        {"owner_id": "microbro2", "owner_superviser_id": "miniboss"},
        {
            "request": "закрытие заявки",
            "interaction": "СамГТУ, заявка 951",
            "reason": "Вуз отказался от сотрудничества в этом году",
        },
    ),
    (
        kinds.DOCUMENT_PENDING,
        {"owner_id": "microbro1", "owner_superviser_id": "miniboss"},
        {"interaction": "СПбГУТ, заявка 1038", "document": "Договор (редакция 2)"},
    ),
    (
        kinds.STEP_EDIT_PENDING,
        {"owner_id": "microbro2", "owner_superviser_id": "miniboss"},
        {
            "interaction": "ТУСУР, заявка 1031",
            "stage": "Встреча",
            "fields": "дата встречи, контактное лицо",
        },
    ),
    (
        kinds.INTERACTION_DECLINED,
        {"author_id": "miniboss"},
        {"interaction": "ТПУ, заявка 1044", "comment": "Нет свободных слотов"},
    ),
    (
        kinds.MANUAL,
        {"users": settings.app_admin_username},
        {
            "title": "Обмен с LMS завершён",
            "body": "Принято записей: 128, отклонено: 3. Отчёт - в разделе «Интеграции»",
        },
    ),
    (
        kinds.MANUAL,
        {"users": settings.app_admin_username},
        {
            "title": "Импорт реестра завершён",
            "body": "Создано заявок: 12, обновлено: 4, пропущено строк: 2",
        },
    ),
)


async def ensure_demo_notifications(session: AsyncSession) -> None:
    usernames = {u for u, *_ in DEMO_ACCOUNTS} | {settings.app_admin_username}
    rows = await session.execute(
        select(User.username, User.id).where(User.username.in_(usernames))
    )
    ids = dict(rows.tuples().all())
    for n, (kind, who, context) in enumerate(EXAMPLES):
        if not all(ids.get(u) for u in who.values()):
            continue
        audience = {
            field: (ids[u],) if field == "users" else ids[u] for field, u in who.items()
        }
        await emit(
            session,
            kind,
            subject=Subject.SYSTEM,
            audience=Audience(**audience),
            context=context,
            actor_id=None,
            dedup_key=f"demo-example:{n}",
        )
