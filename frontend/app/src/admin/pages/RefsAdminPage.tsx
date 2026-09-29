import { useMemo, useState } from 'react'
import { Atomaro } from '../../ds/atomaro'
import { useUniversities } from '../../api/catalog'
import {
  useDirections,
  useVendors,
  useProducts,
  usePrograms,
  useSpecialties,
  useContacts,
  useCloseReasons,
  useDocumentKinds,
} from '../../api/catalog-extra'
import {
  useCreateDirection,
  useUpdateDirection,
  useDeleteDirection,
  useCreateVendor,
  useUpdateVendor,
  useDeleteVendor,
  useCreateProduct,
  useUpdateProduct,
  useDeleteProduct,
  useCreateProgram,
  useUpdateProgram,
  useDeleteProgram,
  useSetProgramPriority,
  useCreateSpecialty,
  useUpdateSpecialty,
  useDeleteSpecialty,
  useCreateUniversity,
  useUpdateUniversity,
  useDeleteUniversity,
  useSpecialtiesByUniversity,
  useSetUniversitySpecialties,
  useCreateContact,
  useUpdateContact,
  useDeleteContact,
  useCreateCloseReason,
  useUpdateCloseReason,
  useDeleteCloseReason,
  useCreateDocumentKind,
  useUpdateDocumentKind,
  useDeleteDocumentKind,
} from '../../api/catalog-admin'
import { ApiError } from '../../api/client'
import { useToast } from '../../manager/ToastContext'

// Экран администратора — полный CRUD по справочникам (в отличие от read-only
// экрана менеджера/руководителя RefsPage.tsx). Файл самостоятельный,
// образец структуры вкладок/таблиц подсмотрен там же, но не переиспользуется.

type TabKey =
  | 'directions'
  | 'products'
  | 'programs'
  | 'specialties'
  | 'universities'
  | 'vendors'
  | 'contacts'
  | 'reasons'
  | 'kinds'

const TAB_ORDER: TabKey[] = [
  'directions',
  'products',
  'programs',
  'specialties',
  'universities',
  'vendors',
  'contacts',
  'reasons',
  'kinds',
]

const TAB_LABEL: Record<TabKey, string> = {
  directions: 'Направления',
  products: 'Продукты',
  programs: 'Программы',
  specialties: 'Специальности',
  universities: 'Вузы',
  vendors: 'Вендоры',
  contacts: 'Контакты',
  reasons: 'Причины закрытия',
  kinds: 'Виды документов',
}

const TAB_COLS: Record<TabKey, { heads: string[]; gridCols: string }> = {
  directions: { heads: ['Название'], gridCols: 'minmax(220px,1fr)' },
  products: {
    heads: ['Название', 'Вендор', 'Направления', 'Активен'],
    gridCols: 'minmax(160px,1.2fr) minmax(120px,1fr) minmax(160px,1.2fr) 90px',
  },
  programs: {
    heads: ['Название', 'Направление', 'Продукты', 'Приоритет', 'Активна'],
    gridCols: 'minmax(180px,1.4fr) minmax(110px,1fr) minmax(160px,1.2fr) 90px 80px',
  },
  specialties: {
    heads: ['Код', 'Название', 'Уровень', 'Направления'],
    gridCols: '110px minmax(200px,1.6fr) minmax(120px,1fr) minmax(160px,1.2fr)',
  },
  universities: {
    heads: ['Короткое название', 'Регион', 'Город', 'ИНН'],
    gridCols: 'minmax(160px,1.2fr) minmax(150px,1.2fr) minmax(110px,1fr) 120px',
  },
  vendors: {
    heads: ['Название', 'Сайт', 'Тип'],
    gridCols: 'minmax(180px,1.2fr) minmax(160px,1fr) minmax(120px,1fr)',
  },
  contacts: {
    heads: ['ФИО', 'Должность', 'Организация', 'Связь', 'Актуален'],
    gridCols: 'minmax(150px,1.2fr) minmax(130px,1fr) minmax(150px,1.1fr) minmax(170px,1.2fr) 90px',
  },
  reasons: {
    heads: ['Название', 'Уровень', 'Исход', 'Комментарий'],
    gridCols: 'minmax(180px,1.4fr) minmax(150px,1fr) minmax(100px,.8fr) minmax(120px,1fr)',
  },
  kinds: {
    heads: ['Код', 'Название', 'Тип'],
    gridCols: 'minmax(160px,1fr) minmax(200px,1.4fr) minmax(110px,.8fr)',
  },
}

const LEVEL_LABEL: Record<string, string> = { BACHELOR: 'Бакалавриат', SPECIALIST: 'Специалитет', MASTER: 'Магистратура' }
const LEVEL_OPTIONS = [
  { value: 'BACHELOR', label: 'Бакалавриат' },
  { value: 'SPECIALIST', label: 'Специалитет' },
  { value: 'MASTER', label: 'Магистратура' },
]
const REASON_LEVEL_LABEL: Record<string, string> = {
  INTERACTION_BEFORE_SIGNING: 'До подписания',
  INTERACTION_AFTER_SIGNING: 'После подписания',
  BRANCH: 'Ветка',
}
const REASON_LEVEL_OPTIONS = [
  { value: 'INTERACTION_BEFORE_SIGNING', label: 'До подписания' },
  { value: 'INTERACTION_AFTER_SIGNING', label: 'После подписания' },
  { value: 'BRANCH', label: 'Ветка' },
]
const OUTCOME_LABEL: Record<string, string> = { DONE: 'Готово', REFUSED: 'Отказ' }
const OUTCOME_OPTIONS = [
  { value: 'DONE', label: 'Готово' },
  { value: 'REFUSED', label: 'Отказ' },
]

function dash(v: string | null | undefined): string {
  return v ? v : '—'
}

const PAGE_SIZE = 8

// ---- поля диалога создания/редактирования ----
type FieldSpec =
  | { kind: 'text' | 'number'; key: string; label: string; required?: boolean; placeholder?: string; span?: string }
  | { kind: 'bool'; key: string; label: string; span?: string }
  | { kind: 'select'; key: string; label: string; required?: boolean; options: { value: string; label: string }[]; span?: string }
  | { kind: 'multiselect'; key: string; label: string; options: { value: number; label: string }[]; span?: string }

type FormValues = Record<string, string | number | boolean | number[] | undefined>

interface RowItem {
  id: number
  cells: string[]
  filterValue?: string
  isSystem?: boolean
}

// диалог: создание/редактирование обычной записи, удаление, быстрый приоритет
// программы, состав специальностей вуза
type DialogState =
  | { kind: 'create' | 'edit'; id?: number }
  | { kind: 'delete'; id: number; label: string }
  | { kind: 'prio'; id: number; label: string }
  | { kind: 'specs'; id: number; label: string }

function errMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message
  return 'Не удалось выполнить действие'
}

export default function RefsAdminPage() {
  const toast = useToast()
  const [tab, setTab] = useState<TabKey>('directions')
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState('')
  const [offset, setOffset] = useState(0)

  const directionsQ = useDirections()
  const vendorsQ = useVendors()
  const productsQ = useProducts()
  const programsQ = usePrograms()
  const specialtiesQ = useSpecialties()
  const universitiesQ = useUniversities()
  const contactsQ = useContacts()
  const reasonsQ = useCloseReasons()
  const kindsQ = useDocumentKinds()

  const createDirection = useCreateDirection()
  const updateDirection = useUpdateDirection()
  const deleteDirection = useDeleteDirection()
  const createVendor = useCreateVendor()
  const updateVendor = useUpdateVendor()
  const deleteVendor = useDeleteVendor()
  const createProduct = useCreateProduct()
  const updateProduct = useUpdateProduct()
  const deleteProduct = useDeleteProduct()
  const createProgram = useCreateProgram()
  const updateProgram = useUpdateProgram()
  const deleteProgram = useDeleteProgram()
  const setProgramPriority = useSetProgramPriority()
  const createSpecialty = useCreateSpecialty()
  const updateSpecialty = useUpdateSpecialty()
  const deleteSpecialty = useDeleteSpecialty()
  const createUniversity = useCreateUniversity()
  const updateUniversity = useUpdateUniversity()
  const deleteUniversity = useDeleteUniversity()
  const setUniversitySpecialties = useSetUniversitySpecialties()
  const createContact = useCreateContact()
  const updateContact = useUpdateContact()
  const deleteContact = useDeleteContact()
  const createReason = useCreateCloseReason()
  const updateReason = useUpdateCloseReason()
  const deleteReason = useDeleteCloseReason()
  const createKind = useCreateDocumentKind()
  const updateKind = useUpdateDocumentKind()
  const deleteKind = useDeleteDocumentKind()

  const [dialog, setDialog] = useState<DialogState | null>(null)
  const [form, setForm] = useState<FormValues>({})
  const [tried, setTried] = useState(false)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const specsUniversityId = dialog?.kind === 'specs' ? dialog.id : undefined
  const currentSpecsQ = useSpecialtiesByUniversity(specsUniversityId)
  const [specsSelected, setSpecsSelected] = useState<Set<number>>(new Set())

  const directionOptions = useMemo(
    () => (directionsQ.data ?? []).map((d) => ({ value: d.id, label: d.name })),
    [directionsQ.data],
  )
  const vendorOptions = useMemo(
    () => (vendorsQ.data ?? []).map((v) => ({ value: String(v.id), label: v.name })),
    [vendorsQ.data],
  )
  const productOptions = useMemo(
    () => (productsQ.data ?? []).map((p) => ({ value: p.id, label: p.name })),
    [productsQ.data],
  )
  // владелец контакта — вуз или вендор, кодируем значение как "u<id>"/"v<id>"
  const ownerOptions = useMemo(() => {
    const opts = [{ value: '', label: 'Без организации' }]
    ;(universitiesQ.data ?? []).forEach((u) => opts.push({ value: `u${u.id}`, label: u.short_name }))
    ;(vendorsQ.data ?? []).forEach((v) => opts.push({ value: `v${v.id}`, label: v.name + ' (вендор)' }))
    return opts
  }, [universitiesQ.data, vendorsQ.data])

  const directionNameById = useMemo(() => {
    const m = new Map<number, string>()
    directionsQ.data?.forEach((d) => m.set(d.id, d.name))
    return m
  }, [directionsQ.data])
  const vendorNameById = useMemo(() => {
    const m = new Map<number, string>()
    vendorsQ.data?.forEach((v) => m.set(v.id, v.name))
    return m
  }, [vendorsQ.data])
  const universityNameById = useMemo(() => {
    const m = new Map<number, string>()
    universitiesQ.data?.forEach((u) => m.set(u.id, u.short_name))
    return m
  }, [universitiesQ.data])

  const activeQuery = {
    directions: directionsQ,
    products: productsQ,
    programs: programsQ,
    specialties: specialtiesQ,
    universities: universitiesQ,
    vendors: vendorsQ,
    contacts: contactsQ,
    reasons: reasonsQ,
    kinds: kindsQ,
  }[tab]

  const list: RowItem[] = useMemo(() => {
    switch (tab) {
      case 'directions':
        return (directionsQ.data ?? []).map((d) => ({ id: d.id, cells: [d.name] }))
      case 'products':
        return (productsQ.data ?? []).map((p) => {
          const vendorName = vendorNameById.get(p.vendor_id) ?? String(p.vendor_id)
          return {
            id: p.id,
            cells: [p.name, vendorName, p.directions.map((d) => d.name).join(', ') || '—', p.is_active ? 'да' : 'нет'],
            filterValue: vendorName,
          }
        })
      case 'programs':
        return (programsQ.data ?? []).map((pr) => {
          const directionName = directionNameById.get(pr.direction_id) ?? String(pr.direction_id)
          return {
            id: pr.id,
            cells: [
              pr.name,
              directionName,
              pr.products.map((p) => p.name).join(', ') || '—',
              pr.priority == null ? '—' : String(pr.priority),
              pr.is_active ? 'да' : 'нет',
            ],
            filterValue: directionName,
          }
        })
      case 'specialties':
        return (specialtiesQ.data ?? []).map((s) => ({
          id: s.id,
          cells: [s.code, s.name, LEVEL_LABEL[s.level] ?? s.level, s.directions.map((d) => d.name).join(', ') || '—'],
          filterValue: s.level,
        }))
      case 'universities':
        return (universitiesQ.data ?? []).map((u) => ({
          id: u.id,
          cells: [u.short_name, dash(u.region), dash(u.city), dash(u.inn)],
          filterValue: u.region ?? '',
        }))
      case 'vendors':
        return (vendorsQ.data ?? []).map((v) => ({ id: v.id, cells: [v.name, dash(v.site), dash(v.kind)] }))
      case 'contacts':
        return (contactsQ.data ?? []).map((c) => {
          const owner =
            c.university_id != null
              ? universityNameById.get(c.university_id) ?? String(c.university_id)
              : c.vendor_id != null
                ? (vendorNameById.get(c.vendor_id) ?? String(c.vendor_id)) + ' (вендор)'
                : '—'
          return {
            id: c.id,
            cells: [c.full_name, dash(c.position), owner, [c.phone, c.email].filter(Boolean).join(' · ') || '—', c.is_actual ? 'да' : 'нет'],
            filterValue: c.is_actual ? 'true' : 'false',
          }
        })
      case 'reasons':
        return (reasonsQ.data ?? []).map((r) => ({
          id: r.id,
          cells: [r.label, REASON_LEVEL_LABEL[r.level] ?? r.level, OUTCOME_LABEL[r.outcome] ?? r.outcome, r.needs_comment ? 'обязателен' : '—'],
          filterValue: r.level,
          isSystem: r.is_system,
        }))
      case 'kinds':
        return (kindsQ.data ?? []).map((k) => ({
          id: k.id,
          cells: [k.code, k.label, k.is_system ? 'системный' : 'свой'],
          isSystem: k.is_system,
        }))
      default:
        return []
    }
  }, [
    tab,
    directionsQ.data,
    productsQ.data,
    programsQ.data,
    specialtiesQ.data,
    universitiesQ.data,
    vendorsQ.data,
    contactsQ.data,
    reasonsQ.data,
    kindsQ.data,
    directionNameById,
    vendorNameById,
    universityNameById,
  ])

  const cols = TAB_COLS[tab]
  const filterLabel: string | undefined = {
    directions: undefined,
    products: 'Все вендоры',
    programs: 'Все направления',
    specialties: 'Любой уровень',
    universities: 'Все регионы',
    vendors: undefined,
    contacts: 'Любая актуальность',
    reasons: 'Любой уровень',
    kinds: undefined,
  }[tab]

  const filterOptions = useMemo(() => {
    if (!filterLabel) return []
    if (tab === 'contacts') {
      return [
        { v: '', l: filterLabel },
        { v: 'true', l: 'Только актуальные' },
        { v: 'false', l: 'Неактуальные' },
      ]
    }
    const values = [...new Set(list.map((r) => r.filterValue).filter((v): v is string => !!v))]
    return [{ v: '', l: filterLabel }, ...values.map((v) => ({ v, l: tab === 'reasons' ? (REASON_LEVEL_LABEL[v] ?? v) : v }))]
  }, [filterLabel, list, tab])

  const qLower = q.trim().toLowerCase()
  const filtered = list.filter((r) => {
    const matchesQ = !qLower || r.cells.join(' ').toLowerCase().includes(qLower)
    const matchesFilter = !filter || r.filterValue === filter
    return matchesQ && matchesFilter
  })
  const page = filtered.slice(offset, offset + PAGE_SIZE)
  const range = filtered.length ? `${offset + 1}–${Math.min(offset + PAGE_SIZE, filtered.length)} из ${filtered.length}` : '0 из 0'
  const canPrev = offset > 0
  const canNext = offset + PAGE_SIZE < filtered.length

  function pickTab(k: TabKey) {
    setTab(k)
    setQ('')
    setFilter('')
    setOffset(0)
  }

  // ---- поля формы create/edit по вкладке ----
  function fieldsFor(k: TabKey): FieldSpec[] {
    switch (k) {
      case 'directions':
        return [{ kind: 'text', key: 'name', label: 'Название', required: true, span: '1 / -1' }]
      case 'vendors':
        return [
          { kind: 'text', key: 'name', label: 'Название', required: true },
          { kind: 'text', key: 'site', label: 'Сайт' },
          { kind: 'text', key: 'type', label: 'Тип' },
        ]
      case 'products':
        return [
          { kind: 'text', key: 'name', label: 'Название', required: true },
          { kind: 'select', key: 'vendor_id', label: 'Вендор', required: true, options: vendorOptions },
          { kind: 'multiselect', key: 'direction_ids', label: 'Направления', options: directionOptions, span: '1 / -1' },
          { kind: 'text', key: 'description', label: 'Описание', span: '1 / -1' },
          { kind: 'text', key: 'url', label: 'Сайт' },
          { kind: 'bool', key: 'is_active', label: 'Активен' },
        ]
      case 'programs':
        return [
          { kind: 'text', key: 'name', label: 'Название', required: true, span: '1 / -1' },
          { kind: 'select', key: 'direction_id', label: 'Направление', required: true, options: directionOptions.map((d) => ({ value: String(d.value), label: d.label })) },
          { kind: 'number', key: 'priority', label: 'Приоритет' },
          { kind: 'multiselect', key: 'product_ids', label: 'Продукты', options: productOptions, span: '1 / -1' },
          { kind: 'text', key: 'description', label: 'Описание', span: '1 / -1' },
          { kind: 'text', key: 'url', label: 'Сайт' },
          { kind: 'text', key: 'site_course_id', label: 'ID курса на сайте' },
          { kind: 'bool', key: 'is_active', label: 'Активна' },
        ]
      case 'specialties':
        return [
          { kind: 'text', key: 'code', label: 'Код (00.00.00)', required: true, placeholder: '09.03.02' },
          { kind: 'select', key: 'level', label: 'Уровень', required: true, options: LEVEL_OPTIONS },
          { kind: 'text', key: 'name', label: 'Название', required: true, span: '1 / -1' },
          { kind: 'multiselect', key: 'direction_ids', label: 'Направления', options: directionOptions, span: '1 / -1' },
          { kind: 'text', key: 'tags', label: 'Теги (через запятую)', span: '1 / -1' },
        ]
      case 'universities':
        return [
          { kind: 'text', key: 'short_name', label: 'Короткое название', required: true },
          { kind: 'text', key: 'full_name', label: 'Полное название', required: true },
          { kind: 'text', key: 'inn', label: 'ИНН', required: true },
          { kind: 'text', key: 'kpp', label: 'КПП' },
          { kind: 'text', key: 'region', label: 'Регион', required: true },
          { kind: 'text', key: 'city', label: 'Город', required: true },
          { kind: 'text', key: 'site', label: 'Сайт' },
        ]
      case 'contacts':
        return [
          { kind: 'text', key: 'full_name', label: 'ФИО', required: true, span: '1 / -1' },
          { kind: 'select', key: 'owner', label: 'Вуз или вендор', options: ownerOptions },
          { kind: 'text', key: 'position', label: 'Должность' },
          { kind: 'text', key: 'phone', label: 'Телефон' },
          { kind: 'text', key: 'email', label: 'Почта' },
          { kind: 'bool', key: 'is_actual', label: 'Актуален' },
        ]
      case 'reasons': {
        const editing = dialog?.kind === 'edit'
        if (editing) {
          return [
            { kind: 'text', key: 'label', label: 'Название', required: true, span: '1 / -1' },
            { kind: 'bool', key: 'needs_comment', label: 'Требует комментарий' },
          ]
        }
        return [
          { kind: 'text', key: 'code', label: 'Код (ЛАТИНИЦА_КАПС)', required: true, placeholder: 'MY_REASON' },
          { kind: 'text', key: 'label', label: 'Название', required: true },
          { kind: 'select', key: 'level', label: 'Уровень', required: true, options: REASON_LEVEL_OPTIONS },
          { kind: 'select', key: 'outcome', label: 'Исход', required: true, options: OUTCOME_OPTIONS },
          { kind: 'bool', key: 'needs_comment', label: 'Требует комментарий' },
        ]
      }
      case 'kinds': {
        const editing = dialog?.kind === 'edit'
        if (editing) return [{ kind: 'text', key: 'label', label: 'Название', required: true, span: '1 / -1' }]
        return [
          { kind: 'text', key: 'code', label: 'Код (ЛАТИНИЦА_КАПС)', required: true, placeholder: 'MY_KIND' },
          { kind: 'text', key: 'label', label: 'Название', required: true },
        ]
      }
      default:
        return []
    }
  }

  function initialForm(k: TabKey, id?: number): FormValues {
    if (id == null) {
      // значения по умолчанию для создания
      const defaults: Record<TabKey, FormValues> = {
        directions: { name: '' },
        vendors: { name: '', site: '', type: '' },
        products: { name: '', vendor_id: '', direction_ids: [], description: '', url: '', is_active: true },
        programs: { name: '', direction_id: '', priority: '', product_ids: [], description: '', url: '', site_course_id: '', is_active: true },
        specialties: { code: '', name: '', level: 'BACHELOR', direction_ids: [], tags: '' },
        universities: { short_name: '', full_name: '', inn: '', kpp: '', region: '', city: '', site: '' },
        contacts: { full_name: '', owner: '', position: '', phone: '', email: '', is_actual: true },
        reasons: { code: '', label: '', level: 'INTERACTION_BEFORE_SIGNING', outcome: 'REFUSED', needs_comment: false },
        kinds: { code: '', label: '' },
      }
      return defaults[k]
    }
    switch (k) {
      case 'directions': {
        const r = directionsQ.data?.find((x) => x.id === id)
        return { name: r?.name ?? '' }
      }
      case 'vendors': {
        const r = vendorsQ.data?.find((x) => x.id === id)
        return { name: r?.name ?? '', site: r?.site ?? '', type: r?.kind ?? '' }
      }
      case 'products': {
        const r = productsQ.data?.find((x) => x.id === id)
        return {
          name: r?.name ?? '',
          vendor_id: r ? String(r.vendor_id) : '',
          direction_ids: r?.directions.map((d) => d.id) ?? [],
          description: r?.description ?? '',
          url: r?.url ?? '',
          is_active: r?.is_active ?? true,
        }
      }
      case 'programs': {
        const r = programsQ.data?.find((x) => x.id === id)
        return {
          name: r?.name ?? '',
          direction_id: r ? String(r.direction_id) : '',
          priority: r?.priority == null ? '' : String(r.priority),
          product_ids: r?.products.map((p) => p.id) ?? [],
          description: r?.description ?? '',
          url: r?.url ?? '',
          site_course_id: r?.site_course_id ?? '',
          is_active: r?.is_active ?? true,
        }
      }
      case 'specialties': {
        const r = specialtiesQ.data?.find((x) => x.id === id)
        return {
          code: r?.code ?? '',
          name: r?.name ?? '',
          level: r?.level ?? 'BACHELOR',
          direction_ids: r?.directions.map((d) => d.id) ?? [],
          tags: (r?.tags ?? []).join(', '),
        }
      }
      case 'universities': {
        const r = universitiesQ.data?.find((x) => x.id === id)
        return {
          short_name: r?.short_name ?? '',
          full_name: r?.full_name ?? '',
          inn: r?.inn ?? '',
          kpp: r?.kpp ?? '',
          region: r?.region ?? '',
          city: r?.city ?? '',
          site: r?.site ?? '',
        }
      }
      case 'contacts': {
        const r = contactsQ.data?.find((x) => x.id === id)
        const owner = r?.university_id != null ? `u${r.university_id}` : r?.vendor_id != null ? `v${r.vendor_id}` : ''
        return {
          full_name: r?.full_name ?? '',
          owner,
          position: r?.position ?? '',
          phone: r?.phone ?? '',
          email: r?.email ?? '',
          is_actual: r?.is_actual ?? true,
        }
      }
      case 'reasons': {
        const r = reasonsQ.data?.find((x) => x.id === id)
        return { code: r?.code ?? '', label: r?.label ?? '', level: r?.level ?? '', outcome: r?.outcome ?? '', needs_comment: r?.needs_comment ?? false }
      }
      case 'kinds': {
        const r = kindsQ.data?.find((x) => x.id === id)
        return { code: r?.code ?? '', label: r?.label ?? '' }
      }
      default:
        return {}
    }
  }

  function openCreate() {
    setDialog({ kind: 'create' })
    setForm(initialForm(tab))
    setTried(false)
    setErr('')
  }
  function openEdit(id: number) {
    setDialog({ kind: 'edit', id })
    setForm(initialForm(tab, id))
    setTried(false)
    setErr('')
  }
  function openDelete(id: number, label: string) {
    setDialog({ kind: 'delete', id, label })
    setErr('')
  }
  function openPrio(id: number, label: string, currentPriority: number | null) {
    setDialog({ kind: 'prio', id, label })
    setForm({ priority: currentPriority == null ? '' : String(currentPriority) })
    setTried(false)
    setErr('')
  }
  function openSpecs(id: number, label: string) {
    setDialog({ kind: 'specs', id, label })
    setSpecsSelected(new Set())
    setErr('')
  }
  function closeDialog() {
    setDialog(null)
    setForm({})
    setErr('')
  }

  // предзаполняем текущий состав специальностей, когда он загрузится
  const specsLoadedFor = currentSpecsQ.data
  useMemo(() => {
    if (dialog?.kind === 'specs' && specsLoadedFor) {
      setSpecsSelected(new Set(specsLoadedFor.map((s) => s.id)))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [specsLoadedFor, dialog?.kind])

  function setField(key: string, value: FormValues[string]) {
    setForm((f) => ({ ...f, [key]: value }))
    setErr('')
  }

  function validate(fields: FieldSpec[]): boolean {
    for (const f of fields) {
      if (f.kind !== 'bool' && f.kind !== 'multiselect' && 'required' in f && f.required) {
        const v = form[f.key]
        if (v == null || String(v).trim() === '') return false
      }
    }
    return true
  }

  async function submit() {
    if (!dialog) return
    setErr('')
    try {
      setBusy(true)
      if (dialog.kind === 'delete') {
        await runDelete(tab, dialog.id)
        toast({ title: 'Запись удалена' })
        closeDialog()
        return
      }
      if (dialog.kind === 'prio') {
        const raw = String(form.priority ?? '').trim()
        if (raw !== '' && !(Number(raw) >= 1)) {
          setErr('Число от 1 или пусто — без приоритета')
          setBusy(false)
          return
        }
        await setProgramPriority.mutateAsync({ id: dialog.id, priority: raw === '' ? null : Number(raw) })
        toast({ title: 'Приоритет сохранён' })
        closeDialog()
        return
      }
      if (dialog.kind === 'specs') {
        await setUniversitySpecialties.mutateAsync({ id: dialog.id, specialtyIds: [...specsSelected] })
        toast({ title: 'Специальности вуза сохранены', subtitle: specsSelected.size + ' шт.' })
        closeDialog()
        return
      }
      const fields = fieldsFor(tab)
      if (!validate(fields)) {
        setTried(true)
        setErr('Заполните обязательные поля')
        setBusy(false)
        return
      }
      if (dialog.kind === 'create') {
        await runCreate(tab)
        toast({ title: 'Запись создана' })
      } else {
        await runUpdate(tab, dialog.id!)
        toast({ title: 'Запись сохранена' })
      }
      closeDialog()
    } catch (e) {
      setErr(errMessage(e))
    } finally {
      setBusy(false)
    }
  }

  async function runCreate(k: TabKey) {
    switch (k) {
      case 'directions':
        return createDirection.mutateAsync({ name: String(form.name ?? '').trim() })
      case 'vendors':
        return createVendor.mutateAsync({ name: String(form.name ?? '').trim(), site: strOrNull(form.site), kind: strOrNull(form.type) })
      case 'products':
        return createProduct.mutateAsync({
          name: String(form.name ?? '').trim(),
          vendor_id: Number(form.vendor_id),
          direction_ids: (form.direction_ids as number[]) ?? [],
          description: strOrNull(form.description),
          url: strOrNull(form.url),
          is_active: !!form.is_active,
        })
      case 'programs':
        return createProgram.mutateAsync({
          name: String(form.name ?? '').trim(),
          direction_id: Number(form.direction_id),
          product_ids: (form.product_ids as number[]) ?? [],
          description: strOrNull(form.description),
          url: strOrNull(form.url),
          site_course_id: strOrNull(form.site_course_id),
          is_active: !!form.is_active,
        }).then(async (created) => {
          const raw = String(form.priority ?? '').trim()
          if (raw !== '') await setProgramPriority.mutateAsync({ id: created.id, priority: Number(raw) })
          return created
        })
      case 'specialties':
        return createSpecialty.mutateAsync({
          code: String(form.code ?? '').trim(),
          name: String(form.name ?? '').trim(),
          level: form.level as 'BACHELOR' | 'SPECIALIST' | 'MASTER',
          direction_ids: (form.direction_ids as number[]) ?? [],
          tags: splitTags(form.tags),
        })
      case 'universities':
        return createUniversity.mutateAsync({
          short_name: String(form.short_name ?? '').trim(),
          full_name: String(form.full_name ?? '').trim(),
          inn: String(form.inn ?? '').trim(),
          kpp: strOrNull(form.kpp),
          region: String(form.region ?? '').trim(),
          city: String(form.city ?? '').trim(),
          site: strOrNull(form.site),
        })
      case 'contacts': {
        const { universityId, vendorId } = decodeOwner(String(form.owner ?? ''))
        return createContact.mutateAsync({
          full_name: String(form.full_name ?? '').trim(),
          university_id: universityId,
          vendor_id: vendorId,
          position: strOrNull(form.position),
          phone: strOrNull(form.phone),
          email: strOrNull(form.email),
          is_actual: !!form.is_actual,
        })
      }
      case 'reasons':
        return createReason.mutateAsync({
          code: String(form.code ?? '').trim(),
          label: String(form.label ?? '').trim(),
          level: form.level as 'INTERACTION_BEFORE_SIGNING' | 'INTERACTION_AFTER_SIGNING' | 'BRANCH',
          outcome: form.outcome as 'DONE' | 'REFUSED',
          needs_comment: !!form.needs_comment,
        })
      case 'kinds':
        return createKind.mutateAsync({ code: String(form.code ?? '').trim(), label: String(form.label ?? '').trim() })
      default:
        return undefined
    }
  }

  async function runUpdate(k: TabKey, id: number) {
    switch (k) {
      case 'directions':
        return updateDirection.mutateAsync({ id, body: { name: String(form.name ?? '').trim() } })
      case 'vendors':
        return updateVendor.mutateAsync({ id, body: { name: String(form.name ?? '').trim(), site: strOrNull(form.site), kind: strOrNull(form.type) } })
      case 'products':
        return updateProduct.mutateAsync({
          id,
          body: {
            name: String(form.name ?? '').trim(),
            vendor_id: Number(form.vendor_id),
            direction_ids: (form.direction_ids as number[]) ?? [],
            description: strOrNull(form.description),
            url: strOrNull(form.url),
            is_active: !!form.is_active,
          },
        })
      case 'programs': {
        const raw = String(form.priority ?? '').trim()
        await setProgramPriority.mutateAsync({ id, priority: raw === '' ? null : Number(raw) })
        return updateProgram.mutateAsync({
          id,
          body: {
            name: String(form.name ?? '').trim(),
            direction_id: Number(form.direction_id),
            product_ids: (form.product_ids as number[]) ?? [],
            description: strOrNull(form.description),
            url: strOrNull(form.url),
            site_course_id: strOrNull(form.site_course_id),
            is_active: !!form.is_active,
          },
        })
      }
      case 'specialties':
        return updateSpecialty.mutateAsync({
          id,
          body: {
            code: String(form.code ?? '').trim(),
            name: String(form.name ?? '').trim(),
            level: form.level as 'BACHELOR' | 'SPECIALIST' | 'MASTER',
            direction_ids: (form.direction_ids as number[]) ?? [],
            tags: splitTags(form.tags),
          },
        })
      case 'universities':
        return updateUniversity.mutateAsync({
          id,
          body: {
            short_name: String(form.short_name ?? '').trim(),
            full_name: String(form.full_name ?? '').trim(),
            inn: String(form.inn ?? '').trim(),
            kpp: strOrNull(form.kpp),
            region: String(form.region ?? '').trim(),
            city: String(form.city ?? '').trim(),
            site: strOrNull(form.site),
          },
        })
      case 'contacts': {
        const { universityId, vendorId } = decodeOwner(String(form.owner ?? ''))
        return updateContact.mutateAsync({
          id,
          body: {
            full_name: String(form.full_name ?? '').trim(),
            university_id: universityId,
            vendor_id: vendorId,
            position: strOrNull(form.position),
            phone: strOrNull(form.phone),
            email: strOrNull(form.email),
            is_actual: !!form.is_actual,
          },
        })
      }
      case 'reasons':
        return updateReason.mutateAsync({ id, body: { label: String(form.label ?? '').trim(), needs_comment: !!form.needs_comment } })
      case 'kinds':
        return updateKind.mutateAsync({ id, body: { label: String(form.label ?? '').trim() } })
      default:
        return undefined
    }
  }

  async function runDelete(k: TabKey, id: number) {
    switch (k) {
      case 'directions':
        return deleteDirection.mutateAsync(id)
      case 'vendors':
        return deleteVendor.mutateAsync(id)
      case 'products':
        return deleteProduct.mutateAsync(id)
      case 'programs':
        return deleteProgram.mutateAsync(id)
      case 'specialties':
        return deleteSpecialty.mutateAsync(id)
      case 'universities':
        return deleteUniversity.mutateAsync(id)
      case 'contacts':
        return deleteContact.mutateAsync(id)
      case 'reasons':
        return deleteReason.mutateAsync(id)
      case 'kinds':
        return deleteKind.mutateAsync(id)
      default:
        return undefined
    }
  }

  const fields = dialog && (dialog.kind === 'create' || dialog.kind === 'edit') ? fieldsFor(tab) : []

  const dlgTitle = (() => {
    if (!dialog) return ''
    if (dialog.kind === 'create') return 'Создать: ' + TAB_LABEL[tab].toLowerCase()
    if (dialog.kind === 'edit') return 'Изменить запись'
    if (dialog.kind === 'delete') return 'Удалить запись'
    if (dialog.kind === 'prio') return 'Приоритет: ' + dialog.label
    return 'Специальности вуза: ' + (dialog.kind === 'specs' ? dialog.label : '')
  })()
  const dlgConfirmLabel = dialog
    ? { create: 'Создать', edit: 'Сохранить', delete: 'Удалить', prio: 'Сохранить', specs: 'Сохранить' }[dialog.kind]
    : ''
  const dlgBtnColor = dialog?.kind === 'delete' ? 'var(--error-default)' : 'var(--accent-default)'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
      <div
        style={{
          display: 'flex',
          gap: 2,
          padding: 2,
          borderRadius: 'var(--border-radius-m)',
          background: 'var(--neutral-container-soft)',
          alignSelf: 'flex-start',
          flexWrap: 'wrap',
        }}
      >
        {TAB_ORDER.map((k) => (
          <button
            key={k}
            onClick={() => pickTab(k)}
            style={{
              height: 30,
              padding: '0 12px',
              border: 0,
              borderRadius: 6,
              background: tab === k ? 'var(--bg-surface1)' : 'transparent',
              font: 'var(--font-description-l-strong)',
              color: tab === k ? 'var(--fg-default)' : 'var(--fg-soft)',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            {TAB_LABEL[k]}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <label
          style={{
            width: 260,
            height: 36,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '0 12px',
            background: 'var(--bg-surface1)',
            border: '1px solid var(--border-soft)',
            borderRadius: 'var(--border-radius-l)',
          }}
        >
          <Atomaro.Search16 size={16} fill="var(--fg-muted)" />
          <input
            value={q}
            onInput={(e) => {
              setQ((e.target as HTMLInputElement).value)
              setOffset(0)
            }}
            placeholder="Поиск"
            style={{ border: 0, outline: 0, background: 'transparent', flex: 1, minWidth: 0, font: 'var(--font-body-s)', color: 'var(--fg-default)' }}
          />
        </label>
        {filterLabel && (
          <select
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value)
              setOffset(0)
            }}
            style={{
              height: 36,
              padding: '0 8px',
              border: '1px solid var(--border-soft)',
              borderRadius: 'var(--border-radius-l)',
              background: 'var(--bg-surface1)',
              font: 'var(--font-body-s)',
              color: 'var(--fg-default)',
              outline: 0,
            }}
          >
            {filterOptions.map((o) => (
              <option key={o.v} value={o.v}>
                {o.l}
              </option>
            ))}
          </select>
        )}
        <span style={{ flex: 1 }} />
        <button
          onClick={openCreate}
          style={{
            height: 36,
            padding: '0 16px',
            border: 0,
            borderRadius: 'var(--border-radius-buttons)',
            background: 'var(--accent-default)',
            color: '#fff',
            font: 'var(--font-body-s-strong)',
            cursor: 'pointer',
          }}
        >
          Создать
        </button>
      </div>

      <section
        style={{
          background: 'var(--bg-surface1)',
          border: '1px solid var(--border-muted)',
          borderRadius: 'var(--border-radius-l)',
          padding: '8px 16px 16px',
          display: 'flex',
          flexDirection: 'column',
          overflowX: 'auto',
        }}
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: cols.gridCols + ' 240px',
            gap: 16,
            padding: '12px 8px 8px',
            font: 'var(--font-description-l)',
            color: 'var(--fg-muted)',
            minWidth: 760,
          }}
        >
          {cols.heads.map((h) => (
            <span key={h}>{h}</span>
          ))}
          <span></span>
        </div>

        {activeQuery.isLoading && (
          <div style={{ padding: '40px 8px', textAlign: 'center', font: 'var(--font-body-s)', color: 'var(--fg-muted)' }}>Загрузка…</div>
        )}
        {activeQuery.isError && (
          <div style={{ padding: '40px 8px', textAlign: 'center', font: 'var(--font-body-s)', color: 'var(--error-default)' }}>
            Не удалось загрузить данные
          </div>
        )}
        {!activeQuery.isLoading && !activeQuery.isError && filtered.length === 0 && (
          <div style={{ padding: '40px 8px', textAlign: 'center', font: 'var(--font-body-s)', color: 'var(--fg-muted)' }}>Ничего не найдено</div>
        )}

        {!activeQuery.isLoading &&
          !activeQuery.isError &&
          page.map((r) => (
            <div
              key={r.id}
              style={{
                display: 'grid',
                gridTemplateColumns: cols.gridCols + ' 240px',
                gap: 16,
                padding: '12px 8px',
                borderTop: '1px solid var(--border-muted)',
                alignItems: 'start',
                minWidth: 760,
              }}
            >
              {r.cells.map((c, i) => (
                <span key={i} style={{ font: i === 0 ? 'var(--font-body-s-strong)' : 'var(--font-body-s)', color: i === 0 ? 'var(--fg-default)' : 'var(--fg-soft)', textWrap: 'pretty' }}>
                  {c}
                </span>
              ))}
              <div style={{ display: 'flex', gap: 2, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                {tab === 'programs' && (
                  <RowActionButton label="Приоритет" color="var(--accent-default)" onClick={() => openPrio(r.id, r.cells[0], programsQ.data?.find((p) => p.id === r.id)?.priority ?? null)} />
                )}
                {tab === 'universities' && <RowActionButton label="Специальности" color="var(--fg-soft)" onClick={() => openSpecs(r.id, r.cells[0])} />}
                {!r.isSystem && (
                  <>
                    <RowActionButton label="Изменить" color="var(--fg-soft)" onClick={() => openEdit(r.id)} />
                    <RowActionButton label="Удалить" color="var(--error-default)" onClick={() => openDelete(r.id, r.cells[0])} />
                  </>
                )}
              </div>
            </div>
          ))}

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, borderTop: '1px solid var(--border-muted)', padding: '12px 8px 0', minWidth: 760 }}>
          <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-soft)' }}>
            Записей: <b style={{ fontWeight: 600, color: 'var(--fg-default)' }}>{filtered.length}</b>
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-soft)', fontVariantNumeric: 'tabular-nums' }}>{range}</span>
            <button
              onClick={() => canPrev && setOffset(offset - PAGE_SIZE)}
              style={{ width: 32, height: 32, border: '1px solid var(--border-soft)', borderRadius: 'var(--border-radius-m)', background: 'var(--bg-surface1)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', opacity: canPrev ? 1 : 0.4 }}
            >
              <Atomaro.ChevronLeft16 size={16} fill="var(--fg-soft)" />
            </button>
            <button
              onClick={() => canNext && setOffset(offset + PAGE_SIZE)}
              style={{ width: 32, height: 32, border: '1px solid var(--border-soft)', borderRadius: 'var(--border-radius-m)', background: 'var(--bg-surface1)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', opacity: canNext ? 1 : 0.4 }}
            >
              <Atomaro.ChevronRight16 size={16} fill="var(--fg-soft)" />
            </button>
          </div>
        </div>
      </section>

      {dialog && (
        <>
          <div onClick={closeDialog} style={{ position: 'fixed', inset: 0, zIndex: 80, background: 'rgba(14,17,23,.4)' }} />
          <div
            style={{
              position: 'fixed',
              zIndex: 81,
              top: '50%',
              left: '50%',
              transform: 'translate(-50%,-50%)',
              width: 520,
              maxWidth: 'calc(100vw - 32px)',
              maxHeight: 'calc(100vh - 48px)',
              overflowY: 'auto',
              background: 'var(--bg-elevated-xl)',
              borderRadius: 'var(--border-radius-xl)',
              boxShadow: 'var(--shadow-bottom-xl)',
              padding: 24,
              display: 'flex',
              flexDirection: 'column',
              gap: 16,
            }}
          >
            <span style={{ font: 'var(--font-heading-h3)', color: 'var(--fg-default)' }}>{dlgTitle}</span>
            {dialog.kind === 'delete' && (
              <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-soft)', textWrap: 'pretty' }}>
                Если запись где-то используется, сервер откажет — сначала уберите её оттуда.
              </span>
            )}

            {(dialog.kind === 'create' || dialog.kind === 'edit') && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                {fields.map((f) => (
                  <FieldRow key={f.key} spec={f} value={form[f.key]} invalid={tried && f.kind !== 'bool' && f.kind !== 'multiselect' && 'required' in f && !!f.required && !String(form[f.key] ?? '').trim()} onChange={(v) => setField(f.key, v)} />
                ))}
              </div>
            )}

            {dialog.kind === 'prio' && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 12 }}>
                <FieldRow
                  spec={{ kind: 'number', key: 'priority', label: 'Приоритет (1 — самая востребованная; пусто — без приоритета)' }}
                  value={form.priority}
                  invalid={false}
                  onChange={(v) => setField('priority', v)}
                />
              </div>
            )}

            {dialog.kind === 'specs' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 320, overflowY: 'auto' }}>
                {currentSpecsQ.isLoading && <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-muted)' }}>Загрузка…</span>}
                {(specialtiesQ.data ?? []).map((s) => {
                  const checked = specsSelected.has(s.id)
                  return (
                    <button
                      key={s.id}
                      onClick={(e) => {
                        e.preventDefault()
                        setSpecsSelected((prev) => {
                          const next = new Set(prev)
                          if (next.has(s.id)) next.delete(s.id)
                          else next.add(s.id)
                          return next
                        })
                      }}
                      style={{
                        height: 40,
                        padding: '0 12px',
                        border: '1px solid var(--border-soft)',
                        borderRadius: 'var(--border-radius-inputs)',
                        background: 'var(--bg-surface1)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        font: 'var(--font-body-s)',
                        color: 'var(--fg-default)',
                        cursor: 'pointer',
                        textAlign: 'left',
                      }}
                    >
                      <span style={{ width: 14, height: 14, borderRadius: 4, border: `2px solid ${checked ? 'var(--accent-default)' : 'var(--neutral-muted)'}`, background: checked ? 'var(--accent-default)' : 'transparent' }} />
                      {s.code} · {s.name}
                    </button>
                  )
                })}
              </div>
            )}

            {err && <span style={{ font: 'var(--font-description-l)', color: 'var(--error-default)' }}>{err}</span>}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button
                onClick={closeDialog}
                style={{ height: 40, padding: '0 20px', border: '1px solid var(--border-soft)', borderRadius: 'var(--border-radius-buttons)', background: 'var(--bg-surface1)', color: 'var(--fg-default)', font: 'var(--font-body-s-strong)', cursor: 'pointer' }}
              >
                Отмена
              </button>
              <button
                onClick={submit}
                disabled={busy}
                style={{ height: 40, padding: '0 20px', border: 0, borderRadius: 'var(--border-radius-buttons)', background: dlgBtnColor, color: '#fff', font: 'var(--font-body-s-strong)', cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1 }}
              >
                {dlgConfirmLabel}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function RowActionButton({ label, color, onClick }: { label: string; color: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{ height: 28, padding: '0 8px', border: 0, borderRadius: 'var(--border-radius-m)', background: 'transparent', font: 'var(--font-description-l-strong)', color, cursor: 'pointer', whiteSpace: 'nowrap' }}
    >
      {label}
    </button>
  )
}

function FieldRow({
  spec,
  value,
  invalid,
  onChange,
}: {
  spec: FieldSpec
  value: FormValues[string]
  invalid: boolean
  onChange: (v: FormValues[string]) => void
}) {
  const border = invalid ? 'var(--error-default)' : 'var(--border-soft)'
  const label = spec.label + ('required' in spec && spec.required ? ' *' : '')
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6, gridColumn: spec.span ?? 'auto' }}>
      <span style={{ font: 'var(--font-description-l-strong)', color: 'var(--fg-soft)' }}>{label}</span>
      {spec.kind === 'select' && (
        <select
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
          style={{ height: 40, padding: '0 8px', border: `1px solid ${border}`, borderRadius: 'var(--border-radius-inputs)', background: 'var(--bg-surface1)', font: 'var(--font-body-s)', color: 'var(--fg-default)', outline: 0 }}
        >
          <option value="">—</option>
          {spec.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )}
      {(spec.kind === 'text' || spec.kind === 'number') && (
        <input
          type={spec.kind}
          value={String(value ?? '')}
          onInput={(e) => onChange((e.target as HTMLInputElement).value)}
          placeholder={spec.placeholder ?? ''}
          style={{ height: 40, padding: '0 12px', border: `1px solid ${border}`, borderRadius: 'var(--border-radius-inputs)', background: 'var(--bg-surface1)', font: 'var(--font-body-s)', color: 'var(--fg-default)', outline: 0 }}
        />
      )}
      {spec.kind === 'bool' && (
        <button
          onClick={(e) => {
            e.preventDefault()
            onChange(!value)
          }}
          style={{ height: 40, padding: '0 12px', border: '1px solid var(--border-soft)', borderRadius: 'var(--border-radius-inputs)', background: 'var(--bg-surface1)', display: 'flex', alignItems: 'center', gap: 8, font: 'var(--font-body-s)', color: 'var(--fg-default)', cursor: 'pointer', textAlign: 'left' }}
        >
          <span style={{ width: 14, height: 14, borderRadius: 4, border: `2px solid ${value ? 'var(--accent-default)' : 'var(--neutral-muted)'}`, background: value ? 'var(--accent-default)' : 'transparent' }} />
          {value ? 'Да' : 'Нет'}
        </button>
      )}
      {spec.kind === 'multiselect' && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: 8, border: '1px solid var(--border-soft)', borderRadius: 'var(--border-radius-inputs)', background: 'var(--bg-surface1)' }}>
          {spec.options.length === 0 && <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-muted)' }}>Нет вариантов</span>}
          {spec.options.map((o) => {
            const arr = (value as number[] | undefined) ?? []
            const checked = arr.includes(o.value)
            return (
              <button
                key={o.value}
                onClick={(e) => {
                  e.preventDefault()
                  const next = checked ? arr.filter((v) => v !== o.value) : [...arr, o.value]
                  onChange(next)
                }}
                style={{
                  height: 28,
                  padding: '0 10px',
                  border: `1px solid ${checked ? 'var(--accent-default)' : 'var(--border-soft)'}`,
                  borderRadius: 'var(--border-radius-buttons)',
                  background: checked ? 'var(--accent-default)' : 'transparent',
                  color: checked ? '#fff' : 'var(--fg-default)',
                  font: 'var(--font-description-l)',
                  cursor: 'pointer',
                }}
              >
                {o.label}
              </button>
            )
          })}
        </div>
      )}
    </label>
  )
}

function strOrNull(v: FormValues[string]): string | null {
  const s = String(v ?? '').trim()
  return s === '' ? null : s
}

function splitTags(v: FormValues[string]): string[] {
  return String(v ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
}

function decodeOwner(v: string): { universityId: number | null; vendorId: number | null } {
  if (v.startsWith('u')) return { universityId: Number(v.slice(1)), vendorId: null }
  if (v.startsWith('v')) return { universityId: null, vendorId: Number(v.slice(1)) }
  return { universityId: null, vendorId: null }
}
