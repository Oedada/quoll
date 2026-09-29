# Примеры JSON

Данные вымышленные; вузы, ИНН и КПП взяты из открытых источников. ID одни во всех примерах: ТПУ это вуз 17, «Инженерия машинного обучения» — программа 4, её курс на сайте — `course_id = 42`, продукт — `id = 8`, ветка — `id = 101`, договор — `id = 55`. В примерах В1 и В2 показаны строки таблиц сопоставления; в И1, И2 и Результирующем JSON — структура сообщений. Правила: разделы 6.5 и 7; коды ошибок: приложение А.

## В1. Сайт → CRM

Что показывает: запись по названию курса и по `program_id`; неизвестный курс; повтор; пустая запись.

| Запись | Случай | Ожидаемо |
| --- | --- | --- |
| №1 | null вместо записи | INT-422 |
| №2, №3 | «Инженер-тестировщик» по названию; по<br>`program_id = 6` | приняты |
| №4 | Курса нет в каталоге | INT-404 → очередь |
| №5 | Повтор заказа из №2 | INT-208 |

```json
[ 
  null, 
  { 
    "Номер заявки": "ORD-20260915101500-KTRWPM", "Курс": "Инженер-
тестировщик", "Фамилия": "Лесная", 
    "Имя": "Ольга", "Отчество": "Игоревна", "Телефон": "7 (900) 000-00-01", 
    "Email": "O.Lesnaya@example.ru", "Номер потока": 2 
  }, 
  { 
    "Номер заявки": "ORD-202609161200047-3HQZVN", "Курс": "Инженер-тестировщик", 
    "Фамилия": "Горный", "Имя": "Павел", "Отчество": "Андреевич", "Телефон": "7 (900) 000-00-02", 
    "Email": "p.gorny@example.ru", "Номер потока": 2, "program_id": 6 
  }, 
  { 
    "Номер заявки": "ORD-20260917093000-BELUXA", "Курс": "Системный администратор Linux", 
    "Фамилия": "Речная", "Имя": "Мария", "Отчество": "Олеговна", "Телефон": "7 (900) 000-00-03", 
    "Email": "m.rechnaya@example.ru", "Номер потока": 1 
  }, 
  { 
    "Номер заявки": "ORD-20260915101500-KTRWPM", "Курс": "Инженер-
тестировщик", "Фамилия": "Лесная", 
    "Имя": "Ольга", "Отчество": "Игоревна", "Телефон": "7 (900) 000-00-01", 
    "Email": "O.Lesnaya@example.ru", "Номер потока": 2 
  } 
]
```

## В2. LMS → CRM

Что показывает: вуз по ID, по ИНН + КПП, только по ИНН; программа по ID и по ID курса.

| Запись | Случай | Ожидаемо |
| --- | --- | --- |
| №1 | Вуз 17 × программа 5, ветки 201 и 202 есть | принято: 120 / 4 / 3, одно значение на<br>обе ветки |
| №2 | ТулГУ по ИНН + КПП, заявки нет | INT-202 → «создать заявку» |
| №3 | Вуза с ID 9999 нет в CRM | INT-404 → очередь |
| №4 | Только ИНН ТПУ, вуз с ним один | принято: пара 17 × 6, ветка 203 |
| №5 | Вуз 17 × программа 8, в подписанной заявке<br>её нет | INT-202 → «добавить программу»,<br>дальше шаг 4.1 |

```json
[ 
  { 
    "university": {"id": 17, "short_name": "ТПУ"}, 
    "program": { 
      "id": 5, 
      "name": "Аналитика данных и методы искусственного интеллекта на базе решений ПАО «Ростелеком
»" 
    }, 
    "students": 120, "streams": 4, "teachers_trained": 3 
  }, 
  { 
    "university": {"inn": "7106003011", "kpp": "710601001", "short_name": "ТулГУ"}, 
    "program": {"site_course_id": "inzhener-testirovshhik", "name": "Инженер-тестировщик"}, 
    "students": 45, "streams": 2 
  }, 
  { 
    "university": {"id": 9999, "short_name": "Вуз, которого нет в CRM"}, "program": {"id": 5}, 
    "students": 30, "streams": 1, "teachers_trained": 1 
  }, 
  {"university": {"inn": "7018007264"}, "program": {"id": 6}, "students": 60, "streams": 2}, 
  { 
    "university": {"id": 17}, 
    "program": {"id": 8, "site_course_id": "specialist-po-analizu-dannyx"}, "students": 25, 
    "streams": 1, "teachers_trained": 2 
  } 
]
```

## И1. CRM → LMS

Что показывает: подписанная заявка и открытые ветки с нашими ID; ветка без продукта и на паузе (203). Ожидаемо: LMS заменяет прежний снимок; заглушка недоступна: INT-503.

```json
[ 
  { 
    "application_id": 101, 
    "university": { 
      "id": 17, 
      "full_name": "Федеральное государственное автономное образовательное учреждение высшего обра
зования «Национальный исследовательский Томский политехнический университет»", 
      "short_name": "ТПУ", "inn": "7018007264", "kpp": "701701001" 
    }, 
    "branches": [ 
      { 
        "id": 201, "program": {"id": 5, "site_course_id": "ad-ai-rt"}, 
        "product": {"id": 12, "name": "RT.DataLake", "vendor": {"id": 4, "name": "TData (DataOffic
e)"}}, 
        "step": {"id": 7, "name": "Обучение преподавателей"}, "paused": false, "paused_until": nul
l, 
        "license_until": "2028-08-31", "transfer_status": "TRANSFERRED" 
      }, 
      { 
        "id": 203, "program": {"id": 6, "site_course_id": "inzhener-testirovshhik"}, 
        "product": null, "step": {"id": 5, "name": "Передача материалов"}, "paused": true, 
        "paused_until": null, "license_until": null, "transfer_status": "NOT_TRANSFERRED" 
      }, 
      … 
    ] 
  } 
]
```

## И2. CRM → сайт

Что показывает: порядок по ручному приоритету, при равенстве по названию, без приоритета в конце (раздел 6.4.2); программа без ID курса. Ожидаемо: как у И1.

```json
[ 
  { 
    "id": 5, "site_course_id": "ad-ai-rt", 
    "name": "Аналитика данных и методы искусственного интеллекта на базе решений ПАО «Ростелеком»"
, 
    "direction": {"id": 1, "name": "Аналитика"}, "priority": 1 
  }, 
  { 
    "id": 6, "site_course_id": "inzhener-testirovshhik", "name": "Инженер-тестировщик", 
    "direction": {"id": 4, "name": "Разработка"}, "priority": 2 
  }, 
  { 
    "id": 8, "site_course_id": "specialist-po-analizu-dannyx", 
    "name": "Специалист по анализу данных", "direction": {"id": 1, "name": "Аналитика"}, 
    "priority": 2 
  }, 
  { 
    "id": 9, "site_course_id": null, "name": "Введение в информационную безопасность", 
    "direction": {"id": 3, "name": "Информационная безопасность"}, "priority": null 
  }, 
  { 
    "id": 7, "site_course_id": "prompt-inziniring", "name": "Промпт-инжиниринг", 
    "direction": {"id": 4, "name": "Разработка"}, "priority": null 
  } 
]
```

## Результирующий JSON

Что показывает: договор и допсоглашение; ветку из договора (201, лицензия продлена допсоглашением) и из допсоглашения (204); обученных преподавателей по КАМу (4) и по LMS (3); ключи файлов в S3. Выгрузка пишется в журнал действий.

```json
[ 
  { 
    "application_id": 101, "workflow": {"id": 1, "name": "Работа с вузами", "client_type": "B2B"}, 
    "university": { 
      "id": 17, 
      "full_name": "Федеральное государственное автономное образовательное учреждение высшего обра
зования «Национальный исследовательский Томский политехнический университет»", 
      "short_name": "ТПУ", "inn": "7018007264", "kpp": "701701001", "region": "Томская область", 
      "city": "Томск" 
    }, 
    "responsible": {"id": "0c9b8a7d-6e5f-4d3c-9b2a-1f0e9d8c7b6a", "name": "Иванова А. С."}, 
    "step": {"id": 4, "name": "Подписание договора"}, "pause": {"state": "ACTIVE", "until": null}, 
    "created_at": "2026-06-02T10:14:00+03:00", "closed_at": null, "close_reason": null, 
    "contract": { 
      "document_id": 301, "number": "Д-2026/017", "signed_at": "2026-08-15", 
      "valid_until": "2029-08-14" 
    }, 
    "supplementary_agreements": [ 
      { 
        "id": 401, "number": "ДС-1 к Д-2026/017", "signed_at": "2026-09-10", "status": "APPROVED", 
        "document_id": 305, 
        "actions": [ 
          {"type": "NEW_BRANCH", "branch_id": 204, "program_id": 7, "product_id": 20}, 
          {"type": "EXTEND_LICENSE", "branch_id": 201, "license_until": "2028-08-31"} 
        ] 
      } 
    ], 
    "documents": […], 
    "branches": [ 
      { 
        "id": 201, "origin": {"kind": "CONTRACT", "supplementary_agreement_id": null}, 
        "program": { 
          "id": 5, "site_course_id": "ad-ai-rt", 
          "name": "Аналитика данных и методы искусственного интеллекта на базе решений ПАО «Ростел
еком»", 
          "direction": {"id": 1, "name": "Аналитика"} 
        }, 
        "product": {"id": 12, "name": "RT.DataLake", "vendor": {"id": 4, "name": "TData (DataOffic
e)"}}, 
        "contract_status": "APPROVED", "step": {"id": 7, "name": "Обучение преподавателей"}, 
        "pause": {"state": "ACTIVE", "until": null}, "closed_at": null, "close_reason": null, 
        "license": {"signed_at": "2026-08-20", "term_years": 1, "until": "2028-08-31"}, 
        "transfer_status": "TRANSFERRED", "transfer_status_label": "Передано", 
        "teachers_trained": 4, 
        "lms_stats": { 
          "students": 120, "streams": 4, "teachers_trained": 3, 
          "updated_at": "2026-09-27T03:00:00+03:00" 
        }, 
        "documents": [ 
          { 
            "id": 302, "title": "Акт передачи RT.DataLake.pdf", "kind": "TRANSFER_ACT", 
            "kind_label": "Акт приёма-передачи", "description": null, "status": "ACTIVE", 
            "storage_key": "interactions/101/201/act-v1.pdf", "replaces": null 
          }, 
          … 
        ] 
      }, 
      …, 
      { 
        "id": 204, "origin": {"kind": "SUPPLEMENTARY_AGREEMENT", "supplementary_agreement_id": 401
}, 
        "program": { 
          "id": 7, "site_course_id": "prompt-inziniring", "name": "Промпт-инжиниринг", 
          "direction": {"id": 4, "name": "Разработка"} 
        }, 
        "product": {"id": 20, "name": "Нейрошлюз", "vendor": {"id": 6, "name": "ООО «РТК ИТ»"}}, 
        "contract_status": "APPROVED", "step": {"id": 5, "name": "Передача материалов"},
```
