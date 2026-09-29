import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Atomaro } from '../../ds/atomaro'
import { useInteractions, type InteractionListRead } from '../../api/interactions'
import { InteractionPreviewPanel } from '../../shared/InteractionPreviewPanel'

// админ - только просмотр, бэкенд отдаёт весь список без скоупа по команде
// (can_read у admin в access_policy.py всегда true), поэтому фильтр по
// ответственному строим из уже загруженных строк, а не через /org/subordinates -
// этот эндпоинт доступен только руководителю (SupervisorUser)

const COLS = 'minmax(96px,.8fr) minmax(220px,1.6fr) minmax(170px,1.2fr) minmax(140px,1fr) minmax(110px,.8fr)'

const STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Черновик',
  AWAITING_ACCEPTANCE: 'Ждёт принятия',
  IN_PROGRESS: 'В работе',
  PAUSED: 'На паузе',
  SIGNED: 'Подписано',
  CLOSED: 'Закрыто',
}
const STATUS_TONE: Record<string, [string, string]> = {
  DRAFT: ['var(--neutral-container-default)', 'var(--neutral-muted)'],
  AWAITING_ACCEPTANCE: ['var(--warning-container-default)', 'var(--warning-default)'],
  IN_PROGRESS: ['var(--info-container-default)', 'var(--info-default)'],
  PAUSED: ['var(--neutral-container-default)', 'var(--neutral-muted)'],
  SIGNED: ['var(--success-container-default)', 'var(--success-default)'],
  CLOSED: ['var(--neutral-container-default)', 'var(--neutral-muted)'],
}
const OUTCOME_LABEL: Record<string, string> = { COMPLETED: 'Завершено', REFUSED: 'Отказ', CANCELLED: 'Отменено' }
const OUTCOME_TONE: Record<string, [string, string]> = {
  COMPLETED: ['var(--success-container-default)', 'var(--success-default)'],
  REFUSED: ['var(--error-container-default)', 'var(--error-default)'],
  CANCELLED: ['var(--neutral-container-default)', 'var(--neutral-muted)'],
}
const CONTRACT_LABEL: Record<string, string> = { PROPOSED: 'Предложен', APPROVED: 'Одобрен', REJECTED: 'Отклонён' }
const CONTRACT_TONE: Record<string, [string, string]> = {
  PROPOSED: ['var(--warning-container-default)', 'var(--warning-default)'],
  APPROVED: ['var(--success-container-default)', 'var(--success-default)'],
  REJECTED: ['var(--error-container-default)', 'var(--error-default)'],
}

const ALL_STATUSES = ['DRAFT', 'AWAITING_ACCEPTANCE', 'IN_PROGRESS', 'PAUSED', 'SIGNED', 'CLOSED']
// пределы бэкенда (SystemDefaults.MAX_PAGE_SIZE) - фильтрация и пагинация
// ниже на клиенте, как в оригинале руководителя, поэтому одним запросом
// берём максимум; при сотнях заявок в системе список будет неполным
const FETCH_LIMIT = 100

export default function AllInteractionsPage() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()

  const q = params.get('q') ?? ''
  const status = params.get('status') ?? ''
  const [resp, setResp] = useState('')
  const [outcome, setOutcome] = useState('')
  const [stage, setStage] = useState('')
  const [stalled, setStalled] = useState(false)
  const [limit, setLimit] = useState(10)
  const [offset, setOffset] = useState(0)
  const [previewId, setPreviewId] = useState<number | null>(null)

  const { data, isLoading } = useInteractions({ limit: FETCH_LIMIT })
  const items = useMemo(() => data?.items ?? [], [data])

  const setQ = (v: string) => {
    const next = new URLSearchParams(params)
    if (v) next.set('q', v)
    else next.delete('q')
    setParams(next, { replace: true })
    setOffset(0)
  }
  const setStatus = (v: string) => {
    const next = new URLSearchParams(params)
    if (v) next.set('status', v)
    else next.delete('status')
    setParams(next, { replace: true })
    setOffset(0)
  }

  const stages = useMemo(() => {
    const set = new Map<string, number>()
    for (const r of items) if (r.stage) set.set(r.stage.name, r.stage.id)
    return Array.from(set.entries())
  }, [items])

  const responsibles = useMemo(() => {
    const set = new Map<string, string>()
    for (const r of items) if (r.responsible) set.set(r.responsible.id, r.responsible.name)
    return Array.from(set.entries())
  }, [items])

  const ql = q.trim().toLowerCase()
  const filtered = items.filter((r) => {
    if (status && r.status !== status) return false
    if (resp && r.responsible?.id !== resp) return false
    if (outcome && r.outcome !== outcome) return false
    if (stage && r.stage?.name !== stage) return false
    if (stalled && !r.stall_since) return false
    if (ql) {
      const hay = ('#' + r.id + ' ' + r.university.name + ' ' + r.branches.map((b) => `${b.program?.name ?? ''} ${b.product?.name ?? ''} ${b.vendor_name ?? ''}`).join(' ')).toLowerCase()
      if (!hay.includes(ql)) return false
    }
    return true
  })

  const total = filtered.length
  const page = filtered.slice(offset, offset + limit)

  const hasFilters = !!(q || status || resp || outcome || stage || stalled)
  const reset = () => {
    setResp('')
    setOutcome('')
    setStage('')
    setStalled(false)
    setOffset(0)
    setParams({}, { replace: true })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0, position: 'relative' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {[['', 'Все'], ...ALL_STATUSES.map((s) => [s, STATUS_LABEL[s]])].map(([value, label]) => {
            const count = value ? items.filter((r) => r.status === value).length : items.length
            return (
              <button
                key={value}
                onClick={() => setStatus(value)}
                style={{
                  height: 32,
                  padding: '0 12px',
                  border: 0,
                  borderRadius: 'var(--border-radius-m)',
                  background: status === value ? 'var(--neutral-container-default)' : 'transparent',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  font: 'var(--font-body-s-strong)',
                  color: status === value ? 'var(--fg-default)' : 'var(--fg-soft)',
                  cursor: 'pointer',
                }}
              >
                {label}
                <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)', fontVariantNumeric: 'tabular-nums' }}>{count}</span>
              </button>
            )
          })}
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <label
            style={{
              width: 240,
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
            {Atomaro.Search16 && <Atomaro.Search16 size={16} fill="var(--fg-muted)" />}
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Вуз, вендор, №"
              style={{ flex: 1, minWidth: 0, border: 0, outline: 0, background: 'transparent', font: 'var(--font-body-s)', color: 'var(--fg-default)' }}
            />
          </label>

          <select
            value={resp}
            onChange={(e) => {
              setResp(e.target.value)
              setOffset(0)
            }}
            style={selectStyle}
          >
            <option value="">Все ответственные</option>
            {responsibles.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>

          <select
            value={outcome}
            onChange={(e) => {
              setOutcome(e.target.value)
              setOffset(0)
            }}
            style={selectStyle}
          >
            <option value="">Любой исход</option>
            {Object.entries(OUTCOME_LABEL).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>

          <select
            value={stage}
            onChange={(e) => {
              setStage(e.target.value)
              setOffset(0)
            }}
            style={{ ...selectStyle, maxWidth: 220 }}
          >
            <option value="">Все этапы</option>
            {stages.map(([name, id]) => (
              <option key={id} value={name}>
                {name}
              </option>
            ))}
          </select>

          <button
            onClick={() => {
              setStalled((v) => !v)
              setOffset(0)
            }}
            style={{
              height: 36,
              padding: '0 12px',
              border: '1px solid var(--border-soft)',
              borderRadius: 'var(--border-radius-l)',
              background: stalled ? 'var(--neutral-container-default)' : 'var(--bg-surface1)',
              font: 'var(--font-body-s)',
              color: 'var(--fg-default)',
              cursor: 'pointer',
            }}
          >
            Зависшие
          </button>

          {hasFilters && (
            <button
              onClick={reset}
              style={{ height: 36, padding: '0 8px', border: 0, background: 'transparent', font: 'var(--font-body-s-strong)', color: 'var(--fg-soft)', cursor: 'pointer' }}
            >
              Сбросить
            </button>
          )}
        </div>
      </div>

      <section
        style={{
          background: 'var(--bg-surface1)',
          border: '1px solid var(--border-muted)',
          borderRadius: 'var(--border-radius-l)',
          padding: '8px 16px 16px',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: COLS,
            gap: 16,
            padding: '12px 8px 8px',
            font: 'var(--font-description-l)',
            color: 'var(--fg-muted)',
          }}
        >
          <span>Вуз</span>
          <span>Ветки</span>
          <span>Этап и статус</span>
          <span>Ответственный</span>
          <span>Даты</span>
        </div>

        {isLoading && (
          <>
            {[1, 2, 3, 4].map((k) => (
              <div key={k} style={{ display: 'grid', gridTemplateColumns: COLS, gap: 16, padding: '16px 8px', borderTop: '1px solid var(--border-muted)' }}>
                <div style={{ height: 14, width: '70%', borderRadius: 4, background: 'var(--neutral-container-default)' }} />
                <div style={{ height: 14, width: '80%', borderRadius: 4, background: 'var(--neutral-container-soft)' }} />
                <div style={{ height: 14, width: '60%', borderRadius: 4, background: 'var(--neutral-container-soft)' }} />
                <div style={{ height: 14, width: '50%', borderRadius: 4, background: 'var(--neutral-container-soft)' }} />
                <div style={{ height: 14, width: '60%', borderRadius: 4, background: 'var(--neutral-container-soft)' }} />
              </div>
            ))}
          </>
        )}

        {!isLoading && page.map((r) => <InteractionRow key={r.id} row={r} onOpen={() => setPreviewId(r.id)} onGo={() => navigate(`/admin/all/${r.id}`)} />)}

        {!isLoading && total === 0 && (
          <div style={{ borderTop: '1px solid var(--border-muted)', padding: '56px 16px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, textAlign: 'center' }}>
            {Atomaro.Search16 && <Atomaro.Search16 size={32} fill="var(--neutral-muted)" />}
            <span style={{ font: 'var(--font-body-s-strong)', color: 'var(--fg-soft)' }}>Ничего не найдено</span>
            <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)' }}>Измените запрос или сбросьте фильтры</span>
            {hasFilters && (
              <button
                onClick={reset}
                style={{
                  marginTop: 8,
                  height: 32,
                  padding: '0 12px',
                  border: '1px solid var(--border-soft)',
                  borderRadius: 'var(--border-radius-buttons)',
                  background: 'var(--bg-surface1)',
                  color: 'var(--fg-default)',
                  font: 'var(--font-body-s-strong)',
                  cursor: 'pointer',
                }}
              >
                Сбросить фильтры
              </button>
            )}
          </div>
        )}

        {!isLoading && total > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, borderTop: '1px solid var(--border-muted)', padding: '12px 8px 0' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, font: 'var(--font-description-l)', color: 'var(--fg-muted)' }}>
              <span>Строк на странице</span>
              <select
                value={limit}
                onChange={(e) => {
                  setLimit(Number(e.target.value))
                  setOffset(0)
                }}
                style={{ height: 28, padding: '0 8px', border: 0, borderRadius: 'var(--border-radius-m)', background: 'var(--neutral-container-soft)', font: 'var(--font-description-l-strong)', color: 'var(--fg-default)', outline: 0, cursor: 'pointer' }}
              >
                <option value={5}>5</option>
                <option value={10}>10</option>
                <option value={25}>25</option>
              </select>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-soft)', fontVariantNumeric: 'tabular-nums' }}>
                {(total ? offset + 1 : 0)}–{Math.min(offset + limit, total)} из {total}
              </span>
              <button
                onClick={() => offset > 0 && setOffset(Math.max(0, offset - limit))}
                title="Назад"
                style={{ ...pagerBtn, opacity: offset > 0 ? 1 : 0.4 }}
              >
                {Atomaro.ChevronLeft16 && <Atomaro.ChevronLeft16 size={16} fill="var(--fg-soft)" />}
              </button>
              <button
                onClick={() => offset + limit < total && setOffset(offset + limit)}
                title="Вперёд"
                style={{ ...pagerBtn, opacity: offset + limit < total ? 1 : 0.4 }}
              >
                {Atomaro.ChevronRight16 && <Atomaro.ChevronRight16 size={16} fill="var(--fg-soft)" />}
              </button>
            </div>
          </div>
        )}
      </section>

      {previewId != null && (
        <InteractionPreviewPanel interactionId={previewId} onClose={() => setPreviewId(null)} onOpen={(id) => navigate(`/admin/all/${id}`)} />
      )}
    </div>
  )
}

const selectStyle: React.CSSProperties = {
  height: 36,
  padding: '0 8px',
  border: '1px solid var(--border-soft)',
  borderRadius: 'var(--border-radius-l)',
  background: 'var(--bg-surface1)',
  font: 'var(--font-body-s)',
  color: 'var(--fg-default)',
  outline: 0,
  cursor: 'pointer',
  maxWidth: 180,
}
const pagerBtn: React.CSSProperties = {
  width: 32,
  height: 32,
  border: '1px solid var(--border-soft)',
  borderRadius: 'var(--border-radius-m)',
  background: 'var(--bg-surface1)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
}

function InteractionRow({ row, onOpen, onGo }: { row: InteractionListRead; onOpen: () => void; onGo: () => void }) {
  const branches = row.branches.slice(0, 2)
  const more = row.branches.length > 2 ? row.branches.length - 2 : 0
  const [bg, dot] = STATUS_TONE[row.status] ?? STATUS_TONE.IN_PROGRESS
  const [now] = useState(() => Date.now())
  const stallDays = row.stall_since ? Math.max(0, Math.floor((now - new Date(row.stall_since).getTime()) / 86400000)) : 0
  const showContract = row.status !== 'AWAITING_ACCEPTANCE' && row.status !== 'DRAFT'

  return (
    <div
      onClick={onOpen}
      style={{ display: 'grid', gridTemplateColumns: COLS, gap: 16, padding: '12px 8px', borderTop: '1px solid var(--border-muted)', alignItems: 'start', cursor: 'pointer' }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            onGo()
          }}
          style={{ font: 'var(--font-body-s-strong)', color: 'var(--fg-default)' }}
        >
          {row.university.name}
        </a>
        <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)' }}>#{row.id}</span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
        {branches.map((b) => {
          const [cbg] = CONTRACT_TONE[b.contract_status] ?? CONTRACT_TONE.PROPOSED
          return (
            <div key={b.id} style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
              <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-default)', textWrap: 'pretty' as any }}>
                {b.program?.name ?? '—'}
                <span style={{ color: 'var(--fg-muted)' }}> · {b.product?.name ?? '—'}{b.vendor_name ? ` (${b.vendor_name})` : ''}</span>
              </span>
              {showContract && (
                <span title="Статус ветки в договоре" style={{ height: 20, padding: '0 6px', borderRadius: 'var(--border-radius-s)', background: cbg, font: 'var(--font-description-l-strong)', color: 'var(--fg-default)', display: 'flex', alignItems: 'center', whiteSpace: 'nowrap' }}>
                  {CONTRACT_LABEL[b.contract_status] ?? b.contract_status}
                </span>
              )}
            </div>
          )
        })}
        {more > 0 && <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)' }}>ещё {more}</span>}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
        <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-default)' }}>{row.stage?.name ?? '—'}</span>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          <span style={{ height: 22, padding: '0 8px', borderRadius: 'var(--border-radius-m)', background: bg, font: 'var(--font-description-l-strong)', color: 'var(--fg-default)', display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: dot }} />
            {STATUS_LABEL[row.status] ?? row.status}
          </span>
          {row.outcome && (
            <span style={{ height: 22, padding: '0 8px', borderRadius: 'var(--border-radius-m)', background: (OUTCOME_TONE[row.outcome] ?? OUTCOME_TONE.CANCELLED)[0], font: 'var(--font-description-l-strong)', color: 'var(--fg-default)', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: (OUTCOME_TONE[row.outcome] ?? OUTCOME_TONE.CANCELLED)[1] }} />
              {OUTCOME_LABEL[row.outcome] ?? row.outcome}
            </span>
          )}
        </div>
        {(stallDays > 0 || row.pause_state === 'PAUSED') && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {stallDays > 0 && (
              <span style={{ display: 'flex', alignItems: 'center', gap: 4, font: 'var(--font-description-l)', color: 'var(--error-default)' }}>
                {Atomaro.TimeStroke16 && <Atomaro.TimeStroke16 size={12} fill="var(--error-default)" />}
                Зависла {stallDays} дн.
              </span>
            )}
            {row.pause_state === 'PAUSED' && (
              <span style={{ display: 'flex', alignItems: 'center', gap: 4, font: 'var(--font-description-l)', color: 'var(--fg-soft)' }}>
                {Atomaro.TimeStroke16 && <Atomaro.TimeStroke16 size={12} fill="var(--fg-soft)" />}
                Пауза{row.paused_until ? ` до ${new Date(row.paused_until).toLocaleDateString('ru-RU')}` : ''}
              </span>
            )}
          </div>
        )}
      </div>

      <div style={{ font: 'var(--font-body-s)', color: row.responsible ? 'var(--fg-default)' : 'var(--fg-muted)' }}>{row.responsible?.name ?? 'нет владельца'}</div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, font: 'var(--font-description-l)', color: 'var(--fg-muted)', fontVariantNumeric: 'tabular-nums' }}>
        <span>
          План: <span style={{ color: 'var(--fg-default)' }}>{row.planned_date ? new Date(row.planned_date).toLocaleDateString('ru-RU') : '—'}</span>
        </span>
        <span>Создано: {new Date(row.created_at).toLocaleDateString('ru-RU')}</span>
        <span>Обновлено: {new Date(row.updated_at).toLocaleDateString('ru-RU')}</span>
      </div>
    </div>
  )
}
