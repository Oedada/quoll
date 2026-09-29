# Дизайн: комментарии к шагам заявки

*Редакция 23, 29.09.2026. Ред. 21 — переработка заготовки (ред. 18–20 этой ветки); ред. 22 — по итерации 1 проверки сходимости; ред. 23 — по итерации 2 (P2-1, P3-a…c, §0.5); документ сошёлся. Сверено с `dev @ f8fc068`. Что изменено относительно ред. 20 — §0.2, по итерации 1 — §0.4.*

Основание:
- модель данных v1.3 (`docs/2709/`): п. 3.15 «Событие заявки» (комментарий — одно из событий; здесь — отход, §0.2), п. 7 «Правка пройденного шага: комментарий — свободно», п. 9 «Комментарии: ПДн — правило в руководстве пользователя, технически не контролируем», п. 12 «Комментарий реестра — все комментарии в одном месте»;
- решения пользователя А1–А5 (ред. 18 этой ветки): без черновиков; на шагах веток — к ветке; плоская лента с ответом на реплику; править — только автор, удалять — автор или админ; лента шага и сквозная лента заявки;
- код `dev`: права `interactions/access_policy.py` (`can_read`, `can_change`), область `interactions/scope.py` (`lock_interaction_scope`, `allow_closed`), доп. указатель (`contract_service.active_pass`, `check_side_target`, Д41), документы заявки (`document_service.upload` — образец загрузки файла вместе с записью, `check_attachment_readable`, `is_interaction_document`), уведомления `interactions/notify.py` поверх `notifications/emit.py`, журнал `auth/audit.py`, коды `docs/errors-ru.md`.

Метки: [А№] — решение пользователя; [М] — модель v1.3; [Д№] — side-pointer-design; [РК] — решение этого документа.

---

## 0. Решения

### 0.1 Принятые

| # | Вопрос | Решение | Откуда |
|---|---|---|---|
| Р1 | Черновики | Нет: комментарий публикуется сразу | А1 |
| Р2 | К чему привязан | К шагу заявки. На шагах веток (`is_branch_stage`) — ещё и к ветке. На доп. шаге, который пишут доп. прохождением, — ещё и к прохождению (`side_pointer_id`) | А2, Д41 |
| Р3 | Структура | Плоская лента по времени; необязательный «ответ на» (`reply_to_id`) — только на реплику того же места | А3 |
| Р4 | Правка и удаление | Править — только автор. Удалять (мягко) — автор или админ. Руководитель чужие не правит и не удаляет | А4 |
| Р5 | Ленты | Одна ручка: сквозная лента заявки; фильтры по шагу, ветке, прохождению дают ленту места | А5 |
| Р6 | Кто пишет | Кто может менять заявку (`can_change`): текущий КАМ и руководитель его команды. Руководитель осиротевшей команды пишет, когда переназначит заявку. Админ не пишет, но модерирует удалением | код, А4 |
| Р7 | Какие шаги | Текущий или пройденный шаг своего места — как у значений шагов (`set_values`). Будущий — нельзя. Архивный пройденный — можно | [М] п. 7 |
| Р8 | Закрытое | Закрытая заявка, закрытая ветка, завершённое или отменённое доп. прохождение — только чтение: ни новых, ни правок, ни удаления автором. Админ удаляет всегда. Исключение — импорт (§4.8) | ред. 20, Д41 |
| Р9 | Файлы | В том же запросе, что и текст (multipart), до 10. Набор после создания не меняется | ред. 20; образец — документы |
| Р10 | Уведомления | КАМ пишет — руководителю только с флагом `notify_supervisor`. Руководитель пишет — КАМу-владельцу всегда. Ответ — автору реплики, если он в текущей команде заявки (бывшим владельцам — нет). Себе — никогда. Одному человеку — одно уведомление на комментарий | ред. 20 |
| Р11 | История правок | Журнал аудита: `COMMENT_UPDATED` со старым и новым текстом | [РК] |
| Р12 | Удалённый | Строка остаётся (на неё ссылаются ответы). Не-админу — без текста и файлов; админу — всё | ред. 20 |
| Р13 | Комментарии импорта | Колонка «Комментарий» реестра — комментарий без автора (`author_id NULL`, подпись «Импорт»); место — §4.8 | [М] п. 12 |

### 0.2 Что изменено относительно ред. 20 и почему

| Было в ред. 20 | Стало | Почему |
|---|---|---|
| «8 основных шагов, а не 14» | Правила — по признакам стадии (`is_branch_stage`, `is_side`) | Маршрут редактирует админ; число шагов коду не нужно |
| Своя таблица `attachments` со статусами | Существующая `attachments` без изменений | Таблица уже есть; статусы нужны были только для отдельной загрузки |
| Загрузка файла отдельным запросом, проверки «свой, свежий < 24 ч», уборщик сирот | Файлы — частью запроса создания | Нет ничьих файлов: нечего привязывать чужими id и нечего убирать. Так уже работают документы |
| `scrub` по 152-ФЗ, чистка `audit_logs`, очередь удаления из S3 | Нет | [М] п. 9: ПДн в комментариях технически не контролируем. `audit_logs` защищён триггером «только добавление» |
| `comment_versions` | История — в журнале | Дублировала бы журнал |
| Триггер `check_zones`, составной FK ответа | Проверка места в сервисе под блокировкой заявки | Место не меняется ни одной ручкой (PATCH — только текст) |
| Две ручки лент | Одна с фильтрами | Лента места — та же выборка с условием |
| COM-016/018/019 (закрытое, терминальная стадия) | Нет: закрытые заявка, ветка и прохождение уже дают свои коды | Заявка или ветка на терминальной стадии закрыта; §7 |
| `author_role` | Нет | Для подписи хватает имени на момент записи |
| Тесты в `tests_catalog/` | Ветка `tests`, `tests_stage1/test_comments.py` | Так устроен проект |
| Модуль-заглушка `comments/models.py` | Заменяется | Не подключён к миграциям и не используется |
| — | **Отход от [М] п. 3.15**: комментарий — не событие `interaction_stage_history`, а своя строка `comments` | Событие истории неизменно, а комментарий правят, удаляют, на него отвечают и к нему прикладывают файлы. История переходов комментариев не содержит; экран истории, если захочет показывать их вперемешку, склеивает две ленты по времени. Значение `StageChangeKind.COMMENT` остаётся (писателей нет, удалять — пересобирать CHECK) |

### 0.3 Вопросы пользователю

Нет открытых. Возражения к Р8 или Р13 — правка одного предиката.

### 0.4 Что изменено по итерации 1

| Находка | Правка |
|---|---|
| P1-1 аудитория «руководителю» уходила всем руководителям | §4.5: через `interactions.notify` с полной аудиторией области |
| P1-2 место комментария импорта не определено | §4.8: правило места, `create_system` без проверок места и Р8, обрезка длины |
| P2-1 запрет архивной стадии | Снят (§4.1, Р7) |
| P2-2 разные коды у создания и правки | Правка и удаление зовут те же проверки; COM-016/018 убраны (§4.3, §4.4, §7) |
| P2-3 привязка файла комментария шаблоном ребра | §4.6: общая проверка «файл заявки» в `delete_attachment` и `link_attachment` |
| P2-4 уведомление об ответе потерявшему доступ | §4.5: только если `can_read` |
| P2-5 отход от модели и значение COMMENT | §0.2; значение остаётся |
| P3 | Без ложного довода про RESTRICT; без блокировки строки комментария; `Place.current`; загрузка внутри `try`; 415; фильтр основного места; нумерация кодов подряд; тесты |

### 0.5 Что изменено по итерации 2

| Находка | Правка |
|---|---|
| P2-1 комментарии выпали из «активности» заявки | Комментарий пользователя — активность: `slots.last_activity` учитывает `max(comments.created_at)` (§4.9) |
| P3-a «ещё читает заявку» против `scope.ownership` без бывших владельцев | Р10, §4.5: бывшим владельцам — нет |
| P3-b выбывший автор реплики гасил резервную рассылку | §4.5: в `got` — только если уведомление создано (`notify` возвращает результат `emit`) |
| P3-c что обрезать у импорта | §4.8: обрезается итоговый текст вместе с префиксом |

---

## 1. Модель данных

### 1.1 Таблицы

```
comments
  id                BIGINT PK
  interaction_id    INT  NOT NULL -> interactions CASCADE
  stage_id          INT  NOT NULL -> stages RESTRICT
  branch_id         INT  NULL     -> branches CASCADE
  side_pointer_id   INT  NULL     -> side_pointers CASCADE
  author_id         STR  NULL     -> users SET NULL      -- NULL: импорт или удалённая учётка
  author_name       STR(255) NOT NULL                    -- подпись на момент записи
  reply_to_id       BIGINT NULL   -> comments (NO ACTION)
  text              TEXT NOT NULL
  edited_at         TIMESTAMPTZ NULL
  deleted_at        TIMESTAMPTZ NULL
  deleted_by        STR  NULL     -> users SET NULL
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()

  CHECK chk_comment_text: length(btrim(text)) BETWEEN 1 AND 4000
  CHECK chk_comment_place: branch_id IS NULL OR side_pointer_id IS NULL
  CHECK chk_comment_deleted_by: deleted_by IS NULL OR deleted_at IS NOT NULL
  INDEX ix_comments_interaction (interaction_id, id)
  INDEX ix_comments_reply_to (reply_to_id)

comment_attachments
  comment_id     BIGINT -> comments CASCADE
  attachment_id  INT    -> attachments CASCADE, UNIQUE
  PK (comment_id, attachment_id)
```

- `CASCADE` от заявки, ветки, прохождения: комментарии — часть их истории. Физически удаляются только черновые ветки (на них комментариев не бывает, §1.2) и заявки вместе с вузом или черновиком.
- `stage_id RESTRICT`: стадии архивируются; физически удаляются только стадии черновика маршрута, где заявок нет.
- `reply_to_id` без действия при удалении: комментарии физически не удаляются (Р12); каскад от заявки уносит реплики вместе с ответами.
- `author_id SET NULL` + `author_name`: подпись переживает удаление учётки. `deleted_by` тоже может обнулиться — поэтому CHECK требует только «кто удалил ⇒ когда».
- `attachment_id UNIQUE`: файл принадлежит одному комментарию.
- Подпись — `person(user)` («Фамилия И. О.»); функция переносится из `reports/labels.py` в `core/people.py`, отчёты импортируют её оттуда.

### 1.2 Место комментария

Место — `(interaction_id, stage_id, branch_id, side_pointer_id)`.

| Стадия | `branch_id` | `side_pointer_id` |
|---|---|---|
| шаг веток | обязателен: ветка этой заявки, не черновик (`state_id IS NOT NULL`) | нет |
| доп. шаг, пишет доп. прохождение | нет | обязателен: прохождение этой заявки |
| доп. шаг, основной проходит сам (до подписания, Д34) | нет | нет |
| прочие | нет | нет |

«Текущий или пройденный» — как у значений шагов: текущий шаг места (`branch.state_id`, `pointer.stage_id`, `interaction.state_id`) или шаг, упомянутый в истории места (`to_stage_id`/`from_stage_id` с тем же `branch_id` и `side_pointer_id`).

Импорт — исключение со своим правилом места (§4.8).

---

## 2. Права

| Действие | КАМ | Руководитель | Админ |
|---|---|---|---|
| читать ленту и файлы | если `can_read` (свои и бывшие свои) | если `can_read` | всё, включая удалённые |
| написать | если `can_change` | если `can_change` | нет (403) |
| править | свой, пока `can_change` | свой, пока `can_change` | нет |
| удалить | свой, пока `can_change` | свой, пока `can_change` | любой, всегда |

КАМ, у которого заявку забрали, свои старые реплики больше не правит и не удаляет — как и остальное в заявке (П8). Закрытое (Р8) — только чтение, кроме удаления админом.

---

## 3. Жизненный цикл

```
создан ──PATCH автор──> создан (edited_at = now)
   │
   └──DELETE автор/админ──> удалён (deleted_at, deleted_by) ── конец
```

Удалённый не правится и не удаляется повторно (COM-005). Ответить на удалённый можно — превью «удалён». Восстановления нет [РК].

---

## 4. Механизмы

### 4.1 Проверка места (вынос из `step_service`)

```
interactions/step_place.py

@dataclass Place: stage, branch | None, pointer | None, current: int | None

async def resolve(session, interaction, stage_id, branch_id, side_pointer_id) -> Place:
    """под lock_interaction_scope. Тексты ошибок - прежние, из set_values"""
    stage = session.get(Stage, stage_id)
    нет или stage.workflow_id != interaction.workflow_id: 400 "Stage belongs to another workflow"
    current = interaction.state_id; pointer = branch = None
    если side_pointer_id:
        pointer = contract_service.active_pass(...)       # чужое 404, завершено 409 (Д41)
        contract_service.check_side_target(stage, branch_id)
        current = pointer.stage_id
    если branch_id:
        branch = session.get(Branch, branch_id)
        нет или чужая: 404 "Branch is not in this interaction"
        branch.state_id is None: 409 "Branch is a draft until the contract is signed"
        current = branch.state_id
    stage.is_branch_stage != (branch_id is not None): 400 "Branch stages are filled per branch"
    stage_id != current и не visited(...): 409 "Stage is not reached yet"
    return Place(stage, branch, pointer, current)
```

`step_service.set_values` заменяет свой блок проверок одним вызовом `resolve` и берёт `current` из `Place` для «пройден». Поведение значений шагов не меняется (тот же порядок проверок и тексты); тесты шагов остаются без правок.

Закрытость ветки `resolve` не проверяет (значениям шагов она не мешала — так и остаётся). Комментарии проверяют её сами:

```
def check_open(place):          # comment_service
    place.branch и place.branch.closed_at: 409 "Branch is closed"     # BR-001, как в branch_service
```

Закрытое прохождение ловит `active_pass`, закрытую заявку — `lock_interaction_scope`.

### 4.2 Создание

```
POST /api/v1/interactions/{id}/comments   multipart:
  stage_id, text, branch_id?, side_pointer_id?, reply_to_id?, notify_supervisor=false, files[] (0..10)

comment_service.create(session, attachments, *, interaction_id, actor, fields, files):
    text = fields.text.strip(); пусто -> 422 COM-006; > 4000 -> 422 COM-007
    len(files) > 10 -> 422 COM-009
    # без блокировок - права и структура до сети
    interaction = repo.get; не can_change(actor, repo.ownership) -> 403 COM-002
    stage из воркфлоу заявки, stage.is_branch_stage == (branch_id is not None) - иначе 400 (как _check_stage)
    uploaded = []
    try:
        for f in files: uploaded.append(attachments.upload_attachment(f))   # 413, 415
        scope = lock_interaction_scope(session, interaction_id, actor.id)   # закрытая заявка - 409 области
        не can_change(scope.actor, scope.ownership) -> 403 COM-002
        place = step_place.resolve(session, scope.interaction, ...)
        check_open(place)
        parent = None
        если reply_to_id:
            parent = session.get(Comment, reply_to_id)
            нет или (parent.interaction_id, stage_id, branch_id, side_pointer_id) != место -> 404 COM-008
        comment = Comment(..., text, author_id=actor.id, author_name=person(actor))
        add, flush; comment_attachments для uploaded
        audit COMMENT_CREATED {stage_id, branch_id, side_pointer_id, reply_to_id, files: n}
        notify_about(session, scope, comment, parent, notify_supervisor)     # §4.5
        return comment
    except:
        для каждого uploaded - удалить объект из S3; пробросить
```

Текст при создании в журнал не пишется: он в строке; правки пишут старый и новый.

### 4.3 Правка

```
PATCH /api/v1/interactions/{id}/comments/{comment_id}   {text}

text = strip; пусто -> 422 COM-006; > 4000 -> 422 COM-007
scope = lock_interaction_scope(session, id, actor.id)           # закрытая заявка - 409 области
comment = session.get(Comment, comment_id, populate_existing=True)
нет или comment.interaction_id != id -> 404 COM-001
comment.deleted_at -> 409 COM-005
comment.author_id != actor.id или не can_change(scope.actor, scope.ownership) -> 403 COM-003
place = step_place.resolve(... место комментария ...); check_open(place)   # те же коды, что при создании
text не изменился -> вернуть как есть
old = comment.text; comment.text = text; comment.edited_at = now()
audit COMMENT_UPDATED old {text}, new {text}
```

Отдельной блокировки строки комментария нет: все его изменения идут под блокировкой его заявки — она их и сериализует. Уведомлений о правке нет.

`resolve` для существующего места проходит всегда, кроме закрытого: шаг был текущим или пройденным при создании и остаётся пройденным.

### 4.4 Удаление

```
DELETE /api/v1/interactions/{id}/comments/{comment_id}

admin = actor.role == ADMIN
scope = lock_interaction_scope(session, id, actor.id, allow_closed=admin)
comment = session.get(Comment, comment_id, populate_existing=True)
нет или чужой заявки -> 404 COM-001
comment.deleted_at -> 409 COM-005
если не admin:
    comment.author_id != actor.id или не can_change -> 403 COM-004
    resolve(...); check_open(...)                  # закрытое - коды создания
comment.deleted_at = now(); comment.deleted_by = actor.id
audit COMMENT_DELETED {comment_id, author_id}
```

Админ берёт ту же область: `lock_interaction_scope` блокирует и его строку `users` и проверяет дееспособность.

### 4.5 Уведомления

Через `interactions.notify.notify(session, kind, scope, ...)` — аудитория строится из области целиком (`owner_id`, `owner_superviser_id`, `author_id`), как у всех уведомлений заявки. Виды:

| Вид | Роль | Когда |
|---|---|---|
| `COMMENT_REPLY` | `USER` (`users=(parent.author_id,)`) | ответ; автор реплики — не актор, учётка есть, реплика не удалена, `can_read(автор, scope.ownership)` — по области без бывших владельцев, так что бывшему КАМу ответ не уходит |
| `COMMENT_TO_OWNER` | `OWNER` | пишет руководитель; владельцу, если он уже не получил ответ |
| `COMMENT_TO_SUPERVISOR` | `OWNER_SUPERVISOR` | пишет КАМ с `notify_supervisor`; руководителю, если он уже не получил ответ |

```
notify_about(session, scope, comment, parent, notify_supervisor):
    got = {actor.id}
    если parent и parent.author_id и parent.author_id not in got и parent.deleted_at is None:
        author = session.get(User, parent.author_id)
        если author и can_read(author, scope.ownership):
            # недееспособного emit отбросит - тогда он не «получил»
            если notify(COMMENT_REPLY, scope, users=(author.id,)): got.add(author.id)
    если actor руководитель и owner_id и owner_id not in got:
        notify(COMMENT_TO_OWNER, scope)
    если actor КАМ и notify_supervisor:
        sup = scope.owner.superviser_id if scope.owner else None
        если sup not in got: notify(COMMENT_TO_SUPERVISOR, scope)
```

`interactions.notify.notify` начинает возвращать результат `emit` (`Notification | None`) — одна строка.

У осиротевшей команды (руководитель выбыл) `emit` заменяет `OWNER_SUPERVISOR` рассылкой всем руководителям — это допустимо: заявку осиротевшей команды читают все руководители (`can_read`: `owner_orphaned`). Контекст: шаг, вуз, первые 200 знаков; payload — `{comment_id, stage_id, branch_id}`.

### 4.6 Файлы

- Загрузка — только в §4.2.
- Скачивание — `GET /api/v1/attachments/{id}`: `document_service.check_attachment_readable` дополняется веткой «файл комментария»: читает тот, кто читает заявку; у удалённого комментария — только админ. Порядок: документ заявки → файл комментария → шаблон ребра → админ.
- `is_interaction_document` обобщается в `is_interaction_file` (документ заявки или файл комментария) и используется везде, где файл заявки нельзя трогать как общий: `DELETE /attachments/{id}` (409) и привязка шаблоном ребра `workflows/router.link_attachment` (409).
- Файлы удалённого комментария остаются в S3 (админу нужны для разбора).

### 4.7 Лента

```
GET /api/v1/interactions/{id}/comments?stage_id&branch_id&side_pointer_id&main_only&limit=50&offset=0
    ReadableInteraction (can_read)
    фильтры - условия выборки (чужие id дают пустую ленту); main_only=true - side_pointer_id IS NULL
    ORDER BY id; total - count по тем же условиям
    не-админ: у удалённых text = null, attachments = []
    reply_to: {id, author_name, text_preview (200 знаков; null у удалённого для не-админа), deleted}
```

`stage_id` на доп. шаге без `side_pointer_id` отдаёт и основное место, и все прохождения; `main_only` — только основное.

### 4.8 Импорт

`imports/place.py` пишет колонку «Комментарий» строки реестра через `comment_service.create_system(session, interaction, branch, text)`:

- место:
  - ветка строки на шагах (`branch.state_id IS NOT NULL`, в том числе закрытая импортом «отказ»/«завершена») — `(interaction, branch.state_id, branch, None)`;
  - иначе (ветка-черновик, строки 4 и 6 таблицы §16.7 import-design) — шаг заявки без ветки: `(interaction, interaction.state_id, None, None)`, текст с префиксом «Программа / продукт: »;
  - у заявки нет шага (строка 7) — комментарий не применяется, в анализе предупреждение (свободный код IMP, текст «Комментарий не перенесён: у заявки нет шага»);
- `create_system` не зовёт `resolve`, `check_open` и проверки прав: импорт — актор «система», пишет историю задним числом, закрытое для него не закрыто (Р8);
- `author_id NULL`, `author_name = "Импорт"`, без уведомлений и файлов;
- итоговый текст (с префиксом) после `strip` длиннее 4000 знаков обрезается до 4000 с предупреждением анализа (тот же код IMP), пустой — не пишется.

Событие истории `COMMENT` импорт больше не пишет. Если ветка `imports` уже в `dev` — правка её кода входит в эту задачу; если нет — её делает задача импорта по этому разделу.

### 4.9 Активность заявки

Комментарий — работа по заявке: `slots.last_activity` добавляет `max(comments.created_at)` по заявке (кроме комментариев импорта — `author_id IS NOT NULL`). Иначе заявку, где КАМ неделями ведёт переписку комментариями, сторож уводил бы в пассивные. Правка и удаление активностью не считаются.

---

## 5. Конкурентность и отказы

### 5.1 Порядок блокировок

Все изменения — под `lock_interaction_scope` (Manager → User → Interaction). Своего уровня у комментария нет. `share_stage` не нужен: архивная пройденная стадия допустима (Р7), а текущую архивация переносит под блокировкой заявки.

### 5.2 Гонки

| Сценарий | Что происходит |
|---|---|
| Комментарий и закрытие заявки | Оба под блокировкой заявки; комментарий после закрытия — 409 «Interaction is closed» |
| Комментарий и закрытие ветки | То же; после закрытия — 409 «Branch is closed» (BR-001) |
| Комментарий и завершение/отмена доп. прохождения | То же (Д41); после — 409 `active_pass` |
| Две правки | Сериализуются блокировкой заявки; побеждает вторая, обе в журнале |
| Правка и удаление | Удаление первым — правка 409 COM-005 |
| Передача заявки и правка прежним КАМом | После передачи — 403 |
| Ответ на реплику, которую удаляют | Разрешено: строка остаётся |
| Архивация пройденной стадии и комментарий на неё | Оба исхода допустимы (Р7) |

### 5.3 Отказы

| Отказ | Поведение |
|---|---|
| S3 недоступен или файл отвергнут (413, 415) на k-м файле | Уже загруженные удаляются из S3 (цикл внутри `try`), в БД ничего |
| Ошибка после загрузки | Откат транзакции и удаление загруженных объектов; если удаление не удалось — «сирота» в S3 без строки (как у документов) |
| Отказ `notify` | В той же транзакции — откатывается и комментарий |

---

## 6. API

Под `/api/v1/interactions/{id}`.

| Метод | Путь | Тело / query | Ответ | Коды |
|---|---|---|---|---|
| GET | `/comments` | `stage_id?`, `branch_id?`, `side_pointer_id?`, `main_only=false`, `limit` 1..200, `offset` | `{total, items: CommentRead[]}` | 403, 404 |
| POST | `/comments` | multipart: `stage_id`, `text`, `branch_id?`, `side_pointer_id?`, `reply_to_id?`, `notify_supervisor`, `files[]` | 201 `CommentRead` | 400, 403, 404, 409, 413, 415, 422 |
| PATCH | `/comments/{comment_id}` | `{text}` | `CommentRead` | 403, 404, 409, 422 |
| DELETE | `/comments/{comment_id}` | — | 204 | 403, 404, 409 |

```
CommentRead:
  id, interaction_id, stage_id, branch_id, side_pointer_id
  author: {id | null, name}
  text: str | null                 # null у удалённого для не-админа
  reply_to: {id, author_name, text_preview | null, deleted} | null
  attachments: [AttachmentRead]    # [] у удалённого для не-админа
  edited_at, deleted_at, created_at, deleted: bool
```

Схемы — `comments/schemas.py`, `extra="forbid"`.

---

## 7. Коды ошибок

Новая область COM (добавить в список областей `errors-ru.md` §1).

| Код | Кат. | HTTP | Когда | Текст | Что делать |
|---|---|---|---|---|---|
| COM-001 | П | 404 | Комментария нет в этой заявке | Комментарий не найден | Обновите страницу |
| COM-002 | П | 403 | Писать может ответственный КАМ или его руководитель | Нет прав на это действие | — |
| COM-003 | П | 403 | Править может только автор, пока ведёт заявку | Нет прав на это действие | Оставьте новый комментарий с уточнением |
| COM-004 | П | 403 | Удалять может автор, пока ведёт заявку, или администратор | Нет прав на это действие | Обратитесь к администратору |
| COM-005 | П | 409 | Комментарий уже удалён | Комментарий уже удалён | Обновите страницу |
| COM-006 | П | 422 | Пустой текст | Напишите текст комментария | — |
| COM-007 | П | 422 | Длиннее 4000 знаков | Комментарий длиннее 4000 знаков | Сократите текст |
| COM-008 | П | 404 | Ответ на реплику другого места | Сообщение, на которое вы отвечаете, не найдено на этом шаге | Обновите страницу |
| COM-009 | П | 422 | Больше 10 файлов | Можно приложить не больше 10 файлов | Уберите лишние |

Остальные случаи — существующие коды: закрытая заявка (область заявки, `lock_interaction_scope`), закрытая ветка (BR-001), завершённое прохождение и ошибки места (коды `active_pass` и `set_values` в `errors-ru.md`), файлы (413/415 вложений).

---

## 8. Миграция

Одна ревизия поверх головы `dev` на момент реализации: `comments`, `comment_attachments`. `comments/models.py` заменяется, модуль подключается в `alembic/env.py`. Цикл upgrade → downgrade -1 → upgrade → `alembic check`. События `COMMENT_CREATED/UPDATED/DELETED`, `TargetType.COMMENT` — в `auth/audit_models.py`; виды уведомлений — в `notifications/kinds.py`. `StageChangeKind.COMMENT` не трогается.

---

## 9. Тесты (`tests_stage1/test_comments.py`, ветка `tests`)

| # | Гарантия | Сценарий |
|---|---|---|
| T1 | Место | Шаг заявки без ветки — 201; с веткой на шаге заявки — 400; шаг веток без ветки — 400; чужая ветка — 404; черновая — 409 |
| T2 | Изоляция веток | Две ветки на шаге 5: лента ветки А без комментариев ветки Б |
| T3 | Прохождения | С `side_pointer_id` на 4.1 — 201; после завершения прохождения — 409 (`active_pass`); ответ на реплику другого прохождения — 404 COM-008; `main_only` отделяет основное место |
| T4 | Шаги | Будущий шаг — 409; пройденный архивный — 201 |
| T5 | Права записи | КАМ-владелец и его руководитель — 201; чужой КАМ, бывший КАМ, чужой руководитель, админ — 403 |
| T6 | Правка | Автор — `edited_at`, журнал со старым и новым; руководитель правит реплику КАМа — 403; удалённый — 409; бывший КАМ свой — 403 |
| T7 | Удаление | Автор — 204, для не-админа текст скрыт; руководитель чужой — 403; админ в закрытой заявке — 204; повтор — 409 |
| T8 | Закрытое | Закрытые заявка и ветка: создание, правка, удаление автором — 409 с кодами создания |
| T9 | Файлы | Два файла — в ленте и скачиваются читателем; после удаления — не-админу 403, админу 200; >10 — 422; сбой на втором файле — первый удалён из хранилища; `DELETE /attachments` и привязка шаблоном — 409 |
| T10 | Ответы | Ответ на удалённую — 201, превью «удалён» |
| T11 | Уведомления, точный набор получателей | КАМ без флага — никто; КАМ с флагом — только его руководитель; руководитель — только КАМ; ответ руководителя на реплику КАМа — КАМ один раз; автору реплики, потерявшему доступ, — не уходит |
| T12 | Гонка | Два соединения: закрытие заявки и комментарий — один проходит, другой 409; пользовательских комментариев позже закрытия нет |
| T13 | Лента | Сквозная по id, фильтры, пагинация, total |
| T16 | Активность | Свежий комментарий КАМа сдвигает `last_activity`; комментарий импорта — нет |
| T14 | Вынос места | Тесты значений шагов зелёные без правок |
| T15 | Импорт (если ветка `imports` в `dev`) | Комментарий строки на ветке шагов, на черновой — на шаге заявки с префиксом, без шага — предупреждение; длинный — обрезан |

---

## 10. Что не делаем

Упоминания, реакции, треды (А3); восстановление удалённого (§3); очистку ПДн ([М] п. 9); отдельную загрузку файлов и уборщик сирот (§0.2); правку набора файлов (Р9); уведомления о правке и удалении.

## 11. Порядок реализации

1. `step_place.resolve` — вынос из `step_service` без изменения поведения; перенос `person` в `core/people.py`; `notify` возвращает результат `emit`.
2. Модели, миграция, аудит, виды уведомлений.
3. `comment_service` и роутер; `slots.last_activity` (§4.9).
4. Файлы: ветка в `check_attachment_readable`, `is_interaction_file` в удалении и привязке шаблоном.
5. Импорт (§4.8), если ветка `imports` в `dev`.
6. Тесты §9; строки для `errors-ru.md` — в отчёте (файл у заказчика).
