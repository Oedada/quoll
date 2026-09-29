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

// Экран менеджера — только просмотр. Создание/изменение/удаление справочников
// доступно администратору на отдельном экране (по заданию сюда не входит).

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

interface TabMeta {
  label: string
  cols: string[]
  gridCols: string
  filterLabel?: string
}

const TABS: Record<TabKey, TabMeta> = {
  directions: { label: 'Направления', cols: ['Название'], gridCols: 'minmax(220px,1fr)' },
  products: {
    label: 'Продукты',
    cols: ['Название', 'Вендор', 'Направления', 'Активен'],
    gridCols: 'minmax(160px,1.2fr) minmax(120px,1fr) minmax(160px,1.2fr) 90px',
    filterLabel: 'Все вендоры',
  },
  programs: {
    label: 'Программы',
    cols: ['Название', 'Направление', 'Продукты', 'Приоритет', 'Активна'],
    gridCols: 'minmax(180px,1.4fr) minmax(110px,1fr) minmax(160px,1.2fr) 90px 80px',
    filterLabel: 'Все направления',
  },
  specialties: {
    label: 'Специальности',
    cols: ['Код', 'Название', 'Уровень', 'Направления'],
    gridCols: '110px minmax(200px,1.6fr) minmax(120px,1fr) minmax(160px,1.2fr)',
    filterLabel: 'Любой уровень',
  },
  universities: {
    label: 'Вузы',
    cols: ['Короткое название', 'Регион', 'Город', 'ИНН'],
    gridCols: 'minmax(160px,1.2fr) minmax(150px,1.2fr) minmax(110px,1fr) 120px',
    filterLabel: 'Все регионы',
  },
  vendors: {
    label: 'Вендоры',
    cols: ['Название', 'Сайт', 'Тип'],
    gridCols: 'minmax(180px,1.2fr) minmax(160px,1fr) minmax(120px,1fr)',
  },
  contacts: {
    label: 'Контакты',
    cols: ['ФИО', 'Должность', 'Организация', 'Связь', 'Актуален'],
    gridCols: 'minmax(150px,1.2fr) minmax(130px,1fr) minmax(150px,1.1fr) minmax(170px,1.2fr) 90px',
    filterLabel: 'Любая актуальность',
  },
  reasons: {
    label: 'Причины закрытия',
    cols: ['Название', 'Уровень', 'Исход', 'Комментарий'],
    gridCols: 'minmax(180px,1.4fr) minmax(150px,1fr) minmax(100px,.8fr) minmax(120px,1fr)',
    filterLabel: 'Любой уровень',
  },
  kinds: {
    label: 'Виды документов',
    cols: ['Код', 'Название', 'Тип'],
    gridCols: 'minmax(160px,1fr) minmax(200px,1.4fr) minmax(110px,.8fr)',
  },
}

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

const PAGE_SIZE = 8

interface Row {
  id: number
  cells: string[]
  filterValue?: string
}

function dash(v: string | null | undefined): string {
  return v ? v : '—'
}

export default function RefsPage() {
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

  const rows: Row[] = useMemo(() => {
    switch (tab) {
      case 'directions':
        return (directionsQ.data ?? []).map((d) => ({ id: d.id, cells: [d.name] }))
      case 'products':
        return (productsQ.data ?? []).map((p) => {
          const vendorName = vendorNameById.get(p.vendor_id) ?? String(p.vendor_id)
          return {
            id: p.id,
            cells: [
              p.name,
              vendorName,
              p.directions.map((d) => d.name).join(', ') || '—',
              p.is_active ? 'да' : 'нет',
            ],
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
          cells: [s.code, s.name, s.level, s.directions.map((d) => d.name).join(', ') || '—'],
          filterValue: s.level,
        }))
      case 'universities':
        return (universitiesQ.data ?? []).map((u) => ({
          id: u.id,
          cells: [u.short_name, dash(u.region), dash(u.city), dash(u.inn)],
          filterValue: u.region ?? '',
        }))
      case 'vendors':
        return (vendorsQ.data ?? []).map((v) => ({
          id: v.id,
          cells: [v.name, dash(v.site), dash(v.kind)],
        }))
      case 'contacts':
        return (contactsQ.data ?? []).map((c) => {
          const owner = c.university_id != null
            ? universityNameById.get(c.university_id) ?? String(c.university_id)
            : c.vendor_id != null
              ? (vendorNameById.get(c.vendor_id) ?? String(c.vendor_id)) + ' (вендор)'
              : '—'
          return {
            id: c.id,
            cells: [
              c.full_name,
              dash(c.position),
              owner,
              [c.phone, c.email].filter(Boolean).join(' · ') || '—',
              c.is_actual ? 'да' : 'нет',
            ],
            filterValue: c.is_actual ? 'true' : 'false',
          }
        })
      case 'reasons':
        return (reasonsQ.data ?? []).map((r) => ({
          id: r.id,
          cells: [r.label, r.level, r.outcome, r.needs_comment ? 'обязателен' : '—'],
          filterValue: r.level,
        }))
      case 'kinds':
        return (kindsQ.data ?? []).map((k) => ({
          id: k.id,
          cells: [k.code, k.label, k.is_system ? 'системный' : 'свой'],
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

  const meta = TABS[tab]

  const filterOptions = useMemo(() => {
    if (!meta.filterLabel) return []
    if (tab === 'contacts') {
      return [
        { v: '', l: meta.filterLabel },
        { v: 'true', l: 'Только актуальные' },
        { v: 'false', l: 'Неактуальные' },
      ]
    }
    const values = [...new Set(rows.map((r) => r.filterValue).filter((v): v is string => !!v))]
    return [{ v: '', l: meta.filterLabel }, ...values.map((v) => ({ v, l: v }))]
  }, [meta.filterLabel, rows, tab])

  const qLower = q.trim().toLowerCase()
  const filtered = rows.filter((r) => {
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
            {TABS[k].label}
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
            style={{
              border: 0,
              outline: 0,
              background: 'transparent',
              flex: 1,
              minWidth: 0,
              font: 'var(--font-body-s)',
              color: 'var(--fg-default)',
            }}
          />
        </label>
        {meta.filterLabel && (
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
            gridTemplateColumns: meta.gridCols,
            gap: 16,
            padding: '12px 8px 8px',
            font: 'var(--font-description-l)',
            color: 'var(--fg-muted)',
            minWidth: 760,
          }}
        >
          {meta.cols.map((h) => (
            <span key={h}>{h}</span>
          ))}
        </div>

        {activeQuery.isLoading && (
          <div style={{ padding: '40px 8px', textAlign: 'center', font: 'var(--font-body-s)', color: 'var(--fg-muted)' }}>
            Загрузка…
          </div>
        )}

        {activeQuery.isError && (
          <div style={{ padding: '40px 8px', textAlign: 'center', font: 'var(--font-body-s)', color: 'var(--error-default)' }}>
            Не удалось загрузить данные
          </div>
        )}

        {!activeQuery.isLoading && !activeQuery.isError && filtered.length === 0 && (
          <div style={{ padding: '40px 8px', textAlign: 'center', font: 'var(--font-body-s)', color: 'var(--fg-muted)' }}>
            Ничего не найдено
          </div>
        )}

        {!activeQuery.isLoading &&
          !activeQuery.isError &&
          page.map((r) => (
            <div
              key={r.id}
              style={{
                display: 'grid',
                gridTemplateColumns: meta.gridCols,
                gap: 16,
                padding: '12px 8px',
                borderTop: '1px solid var(--border-muted)',
                alignItems: 'start',
                minWidth: 760,
              }}
            >
              {r.cells.map((c, i) => (
                <span
                  key={i}
                  style={{
                    font: i === 0 ? 'var(--font-body-s-strong)' : 'var(--font-body-s)',
                    color: i === 0 ? 'var(--fg-default)' : 'var(--fg-soft)',
                    textWrap: 'pretty',
                  }}
                >
                  {c}
                </span>
              ))}
            </div>
          ))}

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 16,
            borderTop: '1px solid var(--border-muted)',
            padding: '12px 8px 0',
            minWidth: 760,
          }}
        >
          <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-soft)' }}>
            Записей: <b style={{ fontWeight: 600, color: 'var(--fg-default)' }}>{filtered.length}</b>
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-soft)', fontVariantNumeric: 'tabular-nums' }}>
              {range}
            </span>
            <button
              onClick={() => canPrev && setOffset(offset - PAGE_SIZE)}
              style={{
                width: 32,
                height: 32,
                border: '1px solid var(--border-soft)',
                borderRadius: 'var(--border-radius-m)',
                background: 'var(--bg-surface1)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                opacity: canPrev ? 1 : 0.4,
              }}
            >
              <Atomaro.ChevronLeft16 size={16} fill="var(--fg-soft)" />
            </button>
            <button
              onClick={() => canNext && setOffset(offset + PAGE_SIZE)}
              style={{
                width: 32,
                height: 32,
                border: '1px solid var(--border-soft)',
                borderRadius: 'var(--border-radius-m)',
                background: 'var(--bg-surface1)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                opacity: canNext ? 1 : 0.4,
              }}
            >
              <Atomaro.ChevronRight16 size={16} fill="var(--fg-soft)" />
            </button>
          </div>
        </div>
      </section>
    </div>
  )
}
