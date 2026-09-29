// Справочники статусов/уровней/кодов замечаний импорта (Импорт.dc.html: BST/RST/LVL/MSG).
// Бэкенд отдаёт только коды - подписи и цвета подставляем сами.

export const BST: Record<string, [string, string]> = {
  DRAFT: ['Черновик', 'var(--neutral-container-default)'],
  APPLYING: ['Применяется', 'var(--warning-container-default)'],
  APPLIED: ['Применён', 'var(--success-container-default)'],
}

// [подпись, цвет точки/текста, цвет фона]
export const RST: Record<string, [string, string, string]> = {
  NEW: ['Новая', 'var(--success-default)', 'var(--success-container-default)'],
  UPDATE: ['Обновит', 'var(--info-default)', 'var(--info-container-default)'],
  SAME: ['Без изменений', 'var(--neutral-muted)', 'var(--neutral-container-soft)'],
  CONFLICT: ['Конфликт', 'var(--warning-default)', 'var(--warning-container-default)'],
  ERROR: ['Ошибка', 'var(--error-default)', 'var(--error-container-default)'],
  EXCLUDED: ['Исключена', 'var(--neutral-muted)', 'var(--neutral-container-default)'],
}

export const LVL: Record<string, [string, string]> = {
  E: ['var(--error-default)', 'var(--error-container-default)'],
  C: ['var(--warning-default)', 'var(--warning-container-default)'],
  W: ['var(--warning-default)', 'var(--warning-container-soft)'],
  I: ['var(--fg-muted)', 'var(--neutral-container-soft)'],
}

export const MANAGER_STATUS_LABEL: Record<string, string> = {
  AVAILABLE: '',
  SATURATED: 'сейчас лимит',
  UNAVAILABLE: 'недоступен',
  INACTIVE: 'неактивен',
}

export const DECISION_LABEL: Record<string, string> = {
  REPLACE: 'Заменить существующую',
  SKIP: 'Пропустить группу',
}

export const RESULT_LABEL: Record<string, string> = {
  APPLIED: 'Применено',
  SKIPPED: 'Пропущено',
  FAILED: 'Не удалось',
}

export interface ConflictGroup<T> {
  key: string
  rows: T[]
  decision: string | null
  needMgr: boolean
}

// группировка CONFLICT-строк по group_key (Импорт.dc.html: renderVals groupsAll)
export function groupsFromRows<T extends { group_key: string | null; decision: string | null; manager_choice: string | null; issues: { code: string }[] }>(
  rows: T[],
): ConflictGroup<T>[] {
  const byKey = new Map<string, T[]>()
  for (const r of rows) {
    if (!r.group_key) continue
    const arr = byKey.get(r.group_key) ?? []
    arr.push(r)
    byKey.set(r.group_key, arr)
  }
  return [...byKey.entries()].map(([key, rs]) => ({
    key,
    rows: rs,
    decision: rs[0].decision ?? null,
    needMgr: rs.some((r) => r.issues.some((i) => i.code === 'IMP-004' || i.code === 'IMP-005') && !r.manager_choice),
  }))
}

// коды замечаний строк/листов (import-design §22.2, backend/src/quoll/imports/spec.py ISSUES)
export const MSG: Record<string, string> = {
  'IMP-003': 'ФИО менеджера не в распознаваемом виде',
  'IMP-004': 'Менеджер не найден — выберите вручную',
  'IMP-005': 'Подходит несколько менеджеров — выберите одного',
  'IMP-006': 'Вуз не найден в справочнике',
  'IMP-017': 'Для листа реестра нужен опубликованный воркфлоу',
  'IMP-101': 'Тип листа не распознан — лист будет пропущен',
  'IMP-104': 'Слишком много строк реестра',
  'IMP-110': 'Значение не подходит полю',
  'IMP-111': 'Найдено несколько подходящих записей',
  'IMP-120': 'Телефон не распознан, оставлен как есть',
  'IMP-121': 'Продукт принадлежит другому вендору',
  'IMP-122': 'Продукт не найден — добавьте его на лист «Продукты»',
  'IMP-123': 'Регион сопоставлен по похожему названию',
  'IMP-130': 'Договорные данные отличаются — останутся прежние',
  'IMP-140': 'Слито с предыдущей строкой',
  'IMP-141': 'Противоречит предыдущей строке',
  'IMP-142': 'Исходная строка не была применена',
  'IMP-150': 'Поле группы различается между строками вуза',
  'IMP-151': 'Программа не указана и не определяется по продукту',
  'IMP-152': 'Продукт не относится к программе',
  'IMP-153': 'Вендор или продукт будут созданы',
  'IMP-154': 'Программа и продукт повторяются в группе',
  'IMP-155': 'Шаг является боковым',
  'IMP-156': 'Смешаны основной шаг и шаг ветки',
  'IMP-157': 'В группе разные основные шаги',
  'IMP-158': 'Основной шаг терминальный — закрывайте ветки',
  'IMP-159': 'Договор переводит заявку на шаг подписания',
  'IMP-160': 'Нет шага по умолчанию для перенесённой ветки',
  'IMP-161': 'Перенесённая ветка на старте ветки',
  'IMP-162': 'Менеджера нет — заявка останется черновиком',
  'IMP-163': 'Отказ по ветке требует причину закрытия',
  'IMP-164': 'В воркфлоу нет шага для закрытия заявки',
  'IMP-165': 'Статус не совпадает с результатом',
  'IMP-166': 'Пауза требует шаг',
  'IMP-167': 'Указанный человек не менеджер',
  'IMP-168': 'Менеджер не может брать работу',
  'IMP-169': 'Нужно указать менеджера',
  'IMP-170': 'Срок паузы недопустим',
  'IMP-171': 'Пауза ветки недопустима',
  'IMP-172': 'Допсоглашение нельзя открыть',
  'IMP-173': 'Продление договора недопустимо',
  'IMP-174': 'Продление лицензии недопустимо',
  'IMP-175': 'Превышен лимит менеджера',
  'IMP-176': 'Даты договора или лицензии недопустимы',
  'IMP-177': 'Дата шага раньше подписания — взята дата подписания',
  'IMP-178': 'Номера договоров различаются — взят из файла',
  'IMP-179': 'Нет шага для прикрепления файла',
  'IMP-180': 'У вуза есть открытая заявка другого менеджера',
  'IMP-181': 'У вуза есть открытая заявка с другими ветками',
  'IMP-182': 'У вуза есть открытая заявка на другом шаге',
  'IMP-183': 'Группа пропущена — файлы и контакты не применяются',
  'IMP-184': 'Шаг ещё не достигнут',
  'IMP-185': 'В поле шага попадёт только первый контакт',
  'IMP-186': 'Заменяемая заявка изменилась после решения',
  'IMP-187': 'Нет шага закрытия в воркфлоу заменяемой заявки',
  'IMP-188': 'Дата продления перенесена на дату шага ветки',
  'IMP-189': 'В другой строке группы есть ошибка',
  'IMP-190': 'Изменилось после предпросмотра',
  'IMP-191': 'Отказ системного правила при применении',
  'IMP-192': 'Конфликт в базе при применении',
  'IMP-193': 'Применение было остановлено',
  'IMP-194': 'Служба идентификации недоступна',
}

export function issueText(code: string, field?: string | null): string {
  const base = MSG[code] || 'Замечание ' + code
  return field ? base + ' (поле «' + field + '»)' : base
}

// подпись верхнеуровневых ошибок API (413/409/422 из import_error) - когда код не строчный
export const API_MSG: Record<string, string> = {
  'IMP-001': 'Файл не читается как таблица',
  'IMP-008': 'Файл слишком большой',
  'IMP-010': 'Импорт уже не черновик',
  'IMP-011': 'Есть неразрешённые конфликты',
  'IMP-013': 'Неизвестный вид или поле',
  'IMP-017': 'Воркфлоу не опубликован',
  'IMP-018': 'Предпросмотр устарел — данные обновлены, проверьте ещё раз',
  'IMP-019': 'Ошибки на листах блокируют импорт',
}

const PART_LABEL: Record<string, string> = {
  direction: 'ИТ-направление',
  vendor: 'вендор',
  vendor_contact: 'контакт вендора',
  product: 'продукт',
  program: 'программа',
  specialty: 'специальность',
  university: 'вуз',
  university_specialty: 'специальность вуза',
  contact: 'контакт вуза',
  interaction: 'заявка',
  branch: 'ветка',
}

const ACTION_LABEL: Record<string, string> = {
  NEW: 'создаст',
  UPDATE: 'обновит',
  SAME: 'без изменений',
  MERGED: 'слито в',
}

// человекочитаемое описание того, что сделает применение строки (RowRead.targets)
export function targetsText(targets: { part: string; action: string; id?: number }[]): string {
  if (!targets.length) return ''
  return targets
    .map((t) => {
      const label = PART_LABEL[t.part] || t.part
      const action = ACTION_LABEL[t.action] || t.action
      const ref = t.action === 'UPDATE' && t.id != null ? ` #${t.id}` : ''
      return `${action} ${label}${ref}`
    })
    .join('; ')
}
