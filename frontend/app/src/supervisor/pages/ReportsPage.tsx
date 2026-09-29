import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Atomaro } from '../../ds/atomaro'
import { useToast } from '../../manager/ToastContext'
import { ApiError } from '../../api/client'
import {
  useReportOptions,
  useReportPreview,
  useCreateReportExport,
  useReportExport,
  reportExportFileUrl,
  type OptionRead,
  type ReportColumn,
  type ReportParams,
  type PreviewRead,
  type ExportFormat,
  type ExportRead,
} from '../../api/reports'

const COLS: [ReportColumn, string][] = [
  ['university', 'Вуз'],
  ['direction', 'Направление'],
  ['program', 'Программа'],
  ['product', 'Продукт'],
  ['status', 'Статус'],
  ['responsible', 'Ответственный'],
  ['students', 'Студенты'],
  ['streams', 'Потоки'],
  ['teachers_kam', 'Преподаватели (КАМ)'],
  ['teachers_lms', 'Преподаватели (LMS)'],
  ['transitions', 'Переходы'],
  ['contract_number', 'Номер договора'],
  ['license_until', 'Лицензия до'],
  ['transfer_status', 'Передача'],
  ['region', 'Регион'],
]
const COL_LABEL = Object.fromEntries(COLS) as Record<ReportColumn, string>
const DEFAULT_COLS: ReportColumn[] = ['university', 'program', 'product', 'status', 'responsible', 'students']
const PAGE_SIZE = 50
const FORMATS: ExportFormat[] = ['xlsx', 'xls', 'pdf']

type FilterKey = 'university' | 'region' | 'direction' | 'program' | 'product' | 'status' | 'responsible'

interface Filters {
  university: string
  region: string
  direction: string
  program: string
  product: string
  status: string
  responsible: string
}
const EMPTY_FILTERS: Filters = { university: '', region: '', direction: '', program: '', product: '', status: '', responsible: '' }

function toIso(d: Date): string {
  return d.toISOString().slice(0, 10)
}
function todayIso(): string {
  return toIso(new Date())
}
function monthsAgoIso(n: number): string {
  const d = new Date()
  d.setMonth(d.getMonth() - n)
  return toIso(d)
}
function yearStartIso(): string {
  return `${new Date().getFullYear()}-01-01`
}
function ru(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}.${m}.${y}`
}

const PRESETS: Record<string, [string, string, string]> = {
  year: ['С начала года', yearStartIso(), todayIso()],
  quarter: ['Квартал', monthsAgoIso(3), todayIso()],
  month: ['Месяц', monthsAgoIso(1), todayIso()],
}

// значение id опции может быть числом или строкой ('none' у продукта, код статуса, uuid у ответственного) - сохраняем как есть
function idFor(options: OptionRead[], value: string): number | string | undefined {
  if (!value) return undefined
  const found = options.find((o) => String(o.id) === value)
  return found ? found.id : value
}

interface Built {
  params: ReportParams
  dateFrom: string
  dateTo: string
}

export default function ReportsPage() {
  const navigate = useNavigate()
  const toast = useToast()
  const { data: options } = useReportOptions()
  const preview = useReportPreview()
  const createExport = useCreateReportExport()

  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS)
  const [dateFrom, setDateFrom] = useState(PRESETS.year[1])
  const [dateTo, setDateTo] = useState(PRESETS.year[2])
  const [preset, setPreset] = useState('year')
  const [cols, setCols] = useState<ReportColumn[]>(DEFAULT_COLS)
  const [fmt, setFmt] = useState<ExportFormat>('xlsx')

  const [mode, setMode] = useState<'idle' | 'loading' | 'table' | 'empty'>('idle')
  const [built, setBuilt] = useState<Built | null>(null)
  const [previewData, setPreviewData] = useState<PreviewRead | null>(null)
  const [offset, setOffset] = useState(0)
  const [pageLoading, setPageLoading] = useState(false)
  const [q, setQ] = useState('')
  const [openRows, setOpenRows] = useState<Record<string, boolean>>({})
  const [banner, setBanner] = useState<{ title: string; text: string; retry?: boolean } | null>(null)

  const [exportId, setExportId] = useState<number | null>(null)
  const [exportError, setExportError] = useState<{ title: string; text: string } | null>(null)
  const [downloading, setDownloading] = useState(false)
  const exportQuery = useReportExport(exportId)

  const buildParams = (): ReportParams => ({
    date_from: dateFrom || null,
    date_to: dateTo || null,
    university_ids: (() => {
      const id = idFor(options?.universities ?? [], filters.university)
      return id === undefined ? [] : [Number(id)]
    })(),
    regions: filters.region ? [filters.region] : [],
    direction_ids: (() => {
      const id = idFor(options?.directions ?? [], filters.direction)
      return id === undefined ? [] : [Number(id)]
    })(),
    program_ids: (() => {
      const id = idFor(options?.programs ?? [], filters.program)
      return id === undefined ? [] : [Number(id)]
    })(),
    product_ids: (() => {
      const id = idFor(options?.products ?? [], filters.product)
      return id === undefined ? [] : [id === 'none' ? 'none' : Number(id)]
    })(),
    // отчёт руководителя - по всей команде; конкретный КАМ выбирается фильтром, пусто = вся команда
    responsible_ids: (() => {
      const id = idFor(options?.responsible ?? [], filters.responsible)
      return id === undefined ? [] : [String(id)]
    })(),
    statuses: (() => {
      const id = idFor(options?.statuses ?? [], filters.status)
      if (id === undefined) return []
      if (typeof id === 'number') return [id]
      if (id === 'AWAITING' || id === 'DONE' || id === 'REFUSED') return [id]
      return [Number(id)]
    })(),
    columns: cols,
  })

  const dirty = built !== null && JSON.stringify(buildParams()) !== JSON.stringify(built.params)
  const isBuilt = mode === 'table' || mode === 'empty'

  function bannerFromError(err: unknown): { title: string; text: string; retry?: boolean } {
    if (err instanceof ApiError) {
      if (err.status === 504) return { title: 'Сервер не успел собрать отчёт', text: 'Запрос выполнялся слишком долго. Сузьте период или фильтры и повторите.', retry: true }
      if (err.status === 429) return { title: 'Слишком много запросов', text: 'Подождите немного и повторите.', retry: true }
      return { title: 'Не удалось построить отчёт', text: err.message, retry: true }
    }
    return { title: 'Не удалось построить отчёт', text: 'Проверьте соединение и повторите.', retry: true }
  }

  function runPreview() {
    const params = buildParams()
    setMode('loading')
    setBanner(null)
    setQ('')
    setOffset(0)
    setOpenRows({})
    preview.mutate(
      { ...params, offset: 0, limit: PAGE_SIZE },
      {
        onSuccess: (data) => {
          setBuilt({ params, dateFrom, dateTo })
          setPreviewData(data)
          setMode(data.total === 0 ? 'empty' : 'table')
        },
        onError: (err) => {
          setBuilt(null)
          setPreviewData(null)
          setMode('idle')
          setBanner(bannerFromError(err))
        },
      }
    )
  }

  function goPage(newOffset: number) {
    if (!built) return
    setPageLoading(true)
    preview.mutate(
      { ...built.params, offset: newOffset, limit: PAGE_SIZE },
      {
        onSuccess: (data) => {
          setPreviewData(data)
          setOffset(newOffset)
          setPageLoading(false)
        },
        onError: (err) => {
          setPageLoading(false)
          setBanner(bannerFromError(err))
        },
      }
    )
  }

  function runCreateExport() {
    if (exportQuery.data && ['QUEUED', 'RUNNING'].includes(exportQuery.data.status)) return
    setExportError(null)
    createExport.mutate(
      { params: buildParams(), format: fmt },
      {
        onSuccess: (job) => setExportId(job.id),
        onError: (err) => {
          if (err instanceof ApiError && err.status === 413) {
            setExportError({ title: 'Слишком большой отчёт', text: 'В файл не поместится столько строк. Сузьте период или фильтры.' })
          } else if (err instanceof ApiError) {
            setExportError({ title: 'Не удалось поставить в очередь', text: err.message })
          } else {
            setExportError({ title: 'Не удалось поставить в очередь', text: 'Проверьте соединение и повторите.' })
          }
        },
      }
    )
  }

  async function handleDownload(job: ExportRead) {
    setDownloading(true)
    try {
      const res = await fetch(reportExportFileUrl(job.id), { credentials: 'include' })
      if (!res.ok) {
        const payload = await res.json().catch(() => null)
        toast({ title: 'Не удалось скачать файл', subtitle: payload?.detail ?? `Ошибка ${res.status}`, colorScheme: 'error' })
        return
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = job.file_name
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch {
      toast({ title: 'Не удалось скачать файл', subtitle: 'Проверьте соединение и повторите', colorScheme: 'error' })
    } finally {
      setDownloading(false)
    }
  }

  const filterDefs: { label: string; key: FilterKey; options: { value: string; label: string }[] }[] = options
    ? [
        { label: 'Вуз', key: 'university', options: [{ value: '', label: 'Все вузы' }, ...options.universities.map((o) => ({ value: String(o.id), label: o.name }))] },
        { label: 'Регион', key: 'region', options: [{ value: '', label: 'Все регионы' }, ...options.regions.map((r) => ({ value: r, label: r }))] },
        { label: 'Направление', key: 'direction', options: [{ value: '', label: 'Все направления' }, ...options.directions.map((o) => ({ value: String(o.id), label: o.name }))] },
        { label: 'Программа', key: 'program', options: [{ value: '', label: 'Все программы' }, ...options.programs.map((o) => ({ value: String(o.id), label: o.name }))] },
        { label: 'Продукт', key: 'product', options: [{ value: '', label: 'Все продукты' }, ...options.products.map((o) => ({ value: String(o.id), label: o.name }))] },
        {
          label: 'Ответственный',
          key: 'responsible',
          options: [{ value: '', label: 'Вся команда' }, ...options.responsible.map((o) => ({ value: String(o.id), label: o.name + (o.is_active ? '' : ' (неактивен)') }))],
        },
        {
          label: 'Статус',
          key: 'status',
          options: [{ value: '', label: 'Любой' }, ...options.statuses.map((o) => ({ value: String(o.id), label: o.name + (o.archived ? ' (архивный)' : '') }))],
        },
      ]
    : []

  const activeCount = Object.values(filters).filter(Boolean).length

  const q_ = q.trim().toLowerCase()
  const rows = previewData?.rows ?? []
  const filteredRows = q_
    ? rows.filter((r) =>
        [r.university, r.direction, r.program, r.product, r.status?.label, r.responsible?.name, r.region]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(q_)
      )
    : rows

  const total = previewData?.total ?? 0
  const columns = previewData?.columns ?? []
  const idle = mode === 'idle' && !banner
  const loading = mode === 'loading'
  const empty = mode === 'empty'
  const hasTable = mode === 'table' && total > 0 && columns.length > 0
  const noMatch = mode === 'table' && total > 0 && q_ !== '' && filteredRows.length === 0

  const stateLabel = loading ? 'Строим…' : !isBuilt ? 'Не построен' : dirty ? 'Параметры изменились — постройте заново' : 'Актуален'
  const stateBg = dirty ? 'var(--warning-container-default)' : isBuilt ? 'var(--success-container-default)' : 'var(--neutral-container-soft)'
  const buildLabel = isBuilt && dirty ? 'Обновить отчёт' : 'Построить отчёт'

  const summary = built && isBuilt ? `Период ${ru(built.dateFrom)} — ${ru(built.dateTo)} · фильтров: ${activeCount} · колонок: ${built.params.columns?.length ?? 0} · строк: ${total}. В таблице показаны первые ${PAGE_SIZE} строк, в файл войдут все.` : ''

  const job = exportError
    ? { bg: 'var(--error-container-default)', title: exportError.title, text: exportError.text, download: false }
    : exportQuery.data
      ? (() => {
          const d = exportQuery.data
          if (d.status === 'QUEUED') return { bg: 'var(--neutral-container-soft)', title: 'В очереди', text: d.position != null ? `Позиция в очереди: ${d.position}` : 'Ожидает начала сборки', download: false }
          if (d.status === 'RUNNING') return { bg: 'var(--neutral-container-soft)', title: 'Формируем файл', text: d.row_count != null ? `Строк: ${d.row_count}` : 'Идёт сборка…', download: false }
          if (d.status === 'DONE') return { bg: 'var(--success-container-default)', title: 'Файл готов', text: `${d.file_name}${d.row_count != null ? ' · строк: ' + d.row_count : ''}`, download: true }
          if (d.status === 'EXPIRED') return { bg: 'var(--error-container-default)', title: 'Ссылка устарела', text: 'Файл больше не хранится. Создайте отчёт заново.', download: false }
          if (d.status === 'TIMED_OUT') return { bg: 'var(--error-container-default)', title: 'Сервер не успел собрать файл', text: 'Сузьте период или фильтры и повторите.', download: false }
          return { bg: 'var(--error-container-default)', title: 'Не удалось построить файл', text: d.code ?? 'Повторите позже.', download: false }
        })()
      : null

  const createOp = exportQuery.data && ['QUEUED', 'RUNNING'].includes(exportQuery.data.status) ? 0.5 : 1

  return (
    <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap', minWidth: 0 }}>
      <section style={{ flex: '0 0 340px', maxWidth: '100%', background: 'var(--bg-surface1)', border: '1px solid var(--border-muted)', borderRadius: 'var(--border-radius-l)', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '20px 20px 12px', display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ font: 'var(--font-heading-h4)', color: 'var(--fg-default)' }}>Параметры отчёта</span>
          <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)' }}>
            Определяют, какие строки и колонки попадут в отчёт и в файл. Таблица справа меняется только после «Построить».
          </span>
        </div>

        <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border-muted)', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <span style={{ font: 'var(--font-body-s-strong)', color: 'var(--fg-default)' }}>1 · Период</span>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {Object.entries(PRESETS).map(([key, [label, a, b]]) => (
              <button
                key={key}
                onClick={() => {
                  setDateFrom(a)
                  setDateTo(b)
                  setPreset(key)
                }}
                style={{
                  height: 28,
                  padding: '0 12px',
                  border: `1px solid ${preset === key ? 'var(--accent-default)' : 'var(--border-soft)'}`,
                  borderRadius: 'var(--border-radius-m)',
                  background: preset === key ? 'var(--accent-container-default)' : 'var(--bg-surface1)',
                  font: 'var(--font-description-l-strong)',
                  color: 'var(--fg-default)',
                  cursor: 'pointer',
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)' }}>С</span>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => {
                  setDateFrom(e.target.value)
                  setPreset('')
                }}
                style={{ height: 36, padding: '0 8px', border: '1px solid var(--border-soft)', borderRadius: 'var(--border-radius-inputs)', background: 'var(--bg-surface1)', font: 'var(--font-body-s)', color: 'var(--fg-default)', outline: 0 }}
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)' }}>По</span>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => {
                  setDateTo(e.target.value)
                  setPreset('')
                }}
                style={{ height: 36, padding: '0 8px', border: '1px solid var(--border-soft)', borderRadius: 'var(--border-radius-inputs)', background: 'var(--bg-surface1)', font: 'var(--font-body-s)', color: 'var(--fg-default)', outline: 0 }}
              />
            </label>
          </div>
        </div>

        <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border-muted)', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ font: 'var(--font-body-s-strong)', color: 'var(--fg-default)' }}>
              2 · Что включить
              {activeCount > 0 && <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)' }}> · выбрано {activeCount}</span>}
            </span>
            {activeCount > 0 && (
              <button onClick={() => setFilters(EMPTY_FILTERS)} style={{ border: 0, background: 'transparent', padding: 0, font: 'var(--font-description-l-strong)', color: 'var(--accent-default)', cursor: 'pointer' }}>
                Сбросить
              </button>
            )}
          </div>
          {filterDefs.map((f) => (
            <label key={f.key} style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
              <span style={{ width: 104, flex: 'none', font: 'var(--font-description-l)', color: 'var(--fg-soft)' }}>{f.label}</span>
              <select
                value={filters[f.key]}
                onChange={(e) => setFilters((z) => ({ ...z, [f.key]: e.target.value }))}
                style={{
                  flex: 1,
                  height: 34,
                  padding: '0 8px',
                  border: `1px solid ${filters[f.key] ? 'var(--accent-default)' : 'var(--border-soft)'}`,
                  borderRadius: 'var(--border-radius-inputs)',
                  background: 'var(--bg-surface1)',
                  font: 'var(--font-body-s)',
                  color: 'var(--fg-default)',
                  outline: 0,
                  minWidth: 0,
                }}
              >
                {f.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>

        <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border-muted)', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <span style={{ font: 'var(--font-body-s-strong)', color: 'var(--fg-default)' }}>
            3 · Колонки <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)' }}>· {cols.length}</span>
          </span>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {COLS.map(([key, label]) => {
              const on = cols.includes(key)
              return (
                <button
                  key={key}
                  onClick={() => setCols((z) => (z.includes(key) ? z.filter((x) => x !== key) : [...z, key]))}
                  style={{
                    height: 28,
                    padding: '0 12px',
                    border: `1px solid ${on ? 'var(--fg-default)' : 'var(--border-soft)'}`,
                    borderRadius: 'var(--border-radius-m)',
                    background: on ? 'var(--neutral-container-default)' : 'var(--bg-surface1)',
                    font: 'var(--font-description-l-strong)',
                    color: on ? 'var(--fg-default)' : 'var(--fg-soft)',
                    cursor: 'pointer',
                  }}
                >
                  {label}
                </button>
              )
            })}
          </div>
        </div>

        <div style={{ padding: '16px 20px', borderTop: '1px solid var(--border-muted)', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button
            onClick={runPreview}
            disabled={preview.isPending}
            style={{ height: 44, border: 0, borderRadius: 'var(--border-radius-buttons)', background: 'var(--accent-default)', color: '#fff', font: 'var(--font-body-s-strong)', cursor: preview.isPending ? 'default' : 'pointer', opacity: preview.isPending ? 0.7 : 1 }}
          >
            {buildLabel}
          </button>
        </div>
      </section>

      <div style={{ flex: '1 1 480px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <section style={{ background: 'var(--bg-surface1)', border: '1px solid var(--border-muted)', borderRadius: 'var(--border-radius-l)', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ font: 'var(--font-heading-h4)', color: 'var(--fg-default)' }}>Результат</span>
              <span style={{ height: 22, padding: '0 8px', borderRadius: 'var(--border-radius-m)', background: stateBg, font: 'var(--font-description-l-strong)', color: 'var(--fg-default)', display: 'flex', alignItems: 'center' }}>{stateLabel}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }} title="Файл строится по параметрам слева. Поиск по таблице в него не входит.">
              <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)' }}>Файл:</span>
              <div style={{ display: 'flex', gap: 2, padding: 2, borderRadius: 'var(--border-radius-m)', background: 'var(--neutral-container-soft)' }}>
                {FORMATS.map((f) => (
                  <button
                    key={f}
                    onClick={() => setFmt(f)}
                    style={{ height: 28, padding: '0 10px', border: 0, borderRadius: 6, background: fmt === f ? 'var(--bg-surface1)' : 'transparent', font: 'var(--font-description-l-strong)', color: fmt === f ? 'var(--fg-default)' : 'var(--fg-soft)', cursor: 'pointer' }}
                  >
                    {f}
                  </button>
                ))}
              </div>
              <button
                onClick={runCreateExport}
                disabled={createOp !== 1}
                style={{ height: 36, padding: '0 16px', border: '1px solid var(--border-soft)', borderRadius: 'var(--border-radius-buttons)', background: 'var(--bg-surface1)', color: 'var(--fg-default)', font: 'var(--font-body-s-strong)', cursor: createOp === 1 ? 'pointer' : 'default', opacity: createOp }}
              >
                Создать файл
              </button>
            </div>
          </div>
          {summary && <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)' }}>{summary}</span>}
          {job && (
            <div style={{ background: job.bg, borderRadius: 'var(--border-radius-m)', padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ font: 'var(--font-body-s-strong)', color: 'var(--fg-default)' }}>{job.title}</span>
                <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-soft)' }}>{job.text}</span>
              </div>
              {job.download && exportQuery.data && (
                <button
                  onClick={() => handleDownload(exportQuery.data!)}
                  disabled={downloading}
                  style={{ height: 32, padding: '0 16px', border: 0, borderRadius: 'var(--border-radius-buttons)', background: 'var(--accent-default)', color: '#fff', font: 'var(--font-body-s-strong)', cursor: downloading ? 'default' : 'pointer', opacity: downloading ? 0.7 : 1 }}
                >
                  Скачать
                </button>
              )}
            </div>
          )}
        </section>

        {banner && (
          <div style={{ background: 'var(--warning-container-default)', borderRadius: 'var(--border-radius-l)', padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ font: 'var(--font-body-s-strong)', color: 'var(--fg-default)' }}>{banner.title}</span>
              <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-soft)' }}>{banner.text}</span>
            </div>
            {banner.retry && (
              <button onClick={runPreview} style={{ height: 32, padding: '0 16px', border: '1px solid var(--border-soft)', borderRadius: 'var(--border-radius-buttons)', background: 'var(--bg-surface1)', color: 'var(--fg-default)', font: 'var(--font-body-s-strong)', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                Повторить
              </button>
            )}
          </div>
        )}

        <section style={{ background: 'var(--bg-surface1)', border: '1px solid var(--border-muted)', borderRadius: 'var(--border-radius-l)', padding: '0 16px 16px', display: 'flex', flexDirection: 'column', overflowX: 'auto' }}>
          {hasTable && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '12px 8px 4px', minWidth: 640 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, maxWidth: 360, height: 34, padding: '0 10px', border: '1px solid var(--border-soft)', borderRadius: 'var(--border-radius-inputs)', background: 'var(--bg-surface2)' }}>
                <Atomaro.Search16 size={16} fill="var(--fg-muted)" />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Найти в результате" style={{ border: 0, outline: 0, background: 'transparent', flex: 1, minWidth: 0, font: 'var(--font-body-s)', color: 'var(--fg-default)' }} />
              </label>
              <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)' }}>Поиск только по загруженной странице, в файл не влияет</span>
            </div>
          )}
          {idle && (
            <div style={{ padding: '64px 16px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, textAlign: 'center' }}>
              <Atomaro.CheckStatistics size={32} fill="var(--neutral-muted)" />
              <span style={{ font: 'var(--font-body-s-strong)', color: 'var(--fg-soft)' }}>Отчёт ещё не построен</span>
              <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)' }}>Задайте период, фильтры и колонки слева и нажмите «Построить отчёт»</span>
            </div>
          )}
          {loading && (
            <div style={{ padding: '20px 0', display: 'flex', flexDirection: 'column', gap: 12 }}>
              {[1, 2, 3, 4].map((k) => (
                <div key={k} style={{ height: 16, borderRadius: 4, background: 'var(--neutral-container-soft)' }} />
              ))}
            </div>
          )}
          {empty && (
            <div style={{ padding: '64px 16px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, textAlign: 'center' }}>
              <span style={{ font: 'var(--font-body-s-strong)', color: 'var(--fg-soft)' }}>Нет данных</span>
              <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)' }}>По этим параметрам ничего не нашлось. Расширьте период или уберите часть фильтров и постройте отчёт заново.</span>
            </div>
          )}
          {noMatch && <div style={{ padding: '48px 16px', textAlign: 'center', font: 'var(--font-body-s)', color: 'var(--fg-muted)' }}>В построенном отчёте ничего не нашлось по запросу «{q}»</div>}
          {hasTable && (
            <TableBlock
              columns={columns}
              rows={filteredRows}
              openRows={openRows}
              setOpenRows={setOpenRows}
              onOpen={(id) => navigate(`/supervisor/interactions/${id}`)}
              total={total}
              offset={offset}
              limit={PAGE_SIZE}
              pageLoading={pageLoading}
              onPrev={() => offset > 0 && goPage(Math.max(0, offset - PAGE_SIZE))}
              onNext={() => offset + PAGE_SIZE < total && goPage(offset + PAGE_SIZE)}
            />
          )}
        </section>
      </div>
    </div>
  )
}

function TableBlock({
  columns,
  rows,
  openRows,
  setOpenRows,
  onOpen,
  total,
  offset,
  limit,
  pageLoading,
  onPrev,
  onNext,
}: {
  columns: ReportColumn[]
  rows: PreviewRead['rows']
  openRows: Record<string, boolean>
  setOpenRows: (updater: (z: Record<string, boolean>) => Record<string, boolean>) => void
  onOpen: (id: number) => void
  total: number
  offset: number
  limit: number
  pageLoading: boolean
  onPrev: () => void
  onNext: () => void
}) {
  const tcols = useMemo(
    () => columns.map((c) => (['transitions', 'status', 'program'].includes(c) ? 'minmax(140px,1.4fr)' : 'minmax(80px,1fr)')).join(' '),
    [columns]
  )
  const rangeText = rows.length ? `${offset + 1}–${offset + rows.length} из ${total}` : `0 из ${total}`

  return (
    <>
      <div style={{ maxHeight: 'calc(100vh - 380px)', minHeight: 240, overflow: 'auto', scrollbarWidth: 'thin' }}>
        <div style={{ position: 'sticky', top: 0, zIndex: 1, background: 'var(--bg-surface1)', display: 'grid', gridTemplateColumns: tcols, gap: 16, padding: '12px 8px 8px', font: 'var(--font-description-l)', color: 'var(--fg-muted)', minWidth: 640 }}>
          {columns.map((c) => (
            <span key={c}>{COL_LABEL[c]}</span>
          ))}
        </div>
        {rows.map((r) => {
          const key = `${r.interaction_id}-${r.branch_id ?? 'x'}`
          const open = !!openRows[key] && columns.includes('transitions')
          return (
            <div key={key} style={{ borderTop: '1px solid var(--border-muted)', minWidth: 640 }}>
              <div style={{ display: 'grid', gridTemplateColumns: tcols, gap: 16, padding: '12px 8px', alignItems: 'start' }}>
                {columns.map((c) => (
                  <Cell key={c} row={r} col={c} open={open} onOpen={onOpen} onToggle={() => setOpenRows((z) => ({ ...z, [key]: !z[key] }))} />
                ))}
              </div>
              {open && r.transitions && (
                <div style={{ padding: '0 8px 12px', display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {r.transitions.items.map((m, i) => (
                    <span key={i} style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)' }}>
                      {m.label}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, borderTop: '1px solid var(--border-muted)', padding: '12px 8px 0', minWidth: 640 }}>
        <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-soft)' }}>
          Строк в отчёте: <b style={{ fontWeight: 600, color: 'var(--fg-default)' }}>{total}</b>
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-soft)', fontVariantNumeric: 'tabular-nums' }}>{rangeText}</span>
          <button
            onClick={onPrev}
            disabled={offset === 0 || pageLoading}
            style={{ width: 32, height: 32, border: '1px solid var(--border-soft)', borderRadius: 'var(--border-radius-m)', background: 'var(--bg-surface1)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: offset === 0 ? 'default' : 'pointer', opacity: offset === 0 ? 0.4 : 1 }}
          >
            <Atomaro.ChevronLeft16 size={16} fill="var(--fg-soft)" />
          </button>
          <button
            onClick={onNext}
            disabled={offset + limit >= total || pageLoading}
            style={{ width: 32, height: 32, border: '1px solid var(--border-soft)', borderRadius: 'var(--border-radius-m)', background: 'var(--bg-surface1)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: offset + limit >= total ? 'default' : 'pointer', opacity: offset + limit >= total ? 0.4 : 1 }}
          >
            <Atomaro.ChevronRight16 size={16} fill="var(--fg-soft)" />
          </button>
        </div>
      </div>
    </>
  )
}

function Cell({
  row,
  col,
  open,
  onOpen,
  onToggle,
}: {
  row: PreviewRead['rows'][number]
  col: ReportColumn
  open: boolean
  onOpen: (id: number) => void
  onToggle: () => void
}) {
  if (col === 'transitions') {
    const t = row.transitions
    const text = !t || t.count === 0 ? 'нет' : `${t.count} · ${open ? 'скрыть' : 'показать'}`
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
        <button onClick={onToggle} style={{ alignSelf: 'flex-start', border: 0, background: 'transparent', padding: 0, font: 'var(--font-description-l-strong)', color: 'var(--fg-soft)', textDecoration: 'underline', cursor: t && t.count > 0 ? 'pointer' : 'default' }}>
          {text}
        </button>
      </div>
    )
  }
  if (col === 'university') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault()
            onOpen(row.interaction_id)
          }}
          style={{ font: 'var(--font-body-s-strong)', color: 'var(--fg-default)' }}
        >
          {row.university ?? '—'}
        </a>
      </div>
    )
  }
  if (col === 'status') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
        <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-default)' }}>{row.status?.label ?? '—'}</span>
      </div>
    )
  }
  if (col === 'responsible') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
        <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-default)' }}>{row.responsible?.name ?? '—'}</span>
        {row.responsible?.earlier_name && <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)' }}>ранее {row.responsible.earlier_name}</span>}
      </div>
    )
  }
  const value = row[col as keyof typeof row]
  const text = value === null || value === undefined || value === '' ? '—' : String(value)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
      <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-default)' }}>{text}</span>
    </div>
  )
}
