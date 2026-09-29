import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useMe } from '../../auth/useMe'
import { Atomaro } from '../../ds/atomaro'
import { useInteractions, type InteractionListRead } from '../../api/interactions'
import { InteractionPreviewPanel } from '../../shared/InteractionPreviewPanel'

const COLS = 'minmax(96px,.8fr) minmax(220px,1.6fr) minmax(170px,1.2fr) 100px minmax(110px,.8fr) 140px'

const STATUS_LABEL: Record<string, string> = {
  IN_PROGRESS: 'В работе',
  PAUSED: 'На паузе',
  SIGNED: 'Подписано',
}
const STATUS_TONE: Record<string, [string, string]> = {
  IN_PROGRESS: ['var(--info-container-default)', 'var(--info-default)'],
  PAUSED: ['var(--neutral-container-default)', 'var(--neutral-muted)'],
  SIGNED: ['var(--success-container-default)', 'var(--success-default)'],
}
const ALL_STATUSES = ['IN_PROGRESS', 'PAUSED', 'SIGNED']

export default function MyInteractionsPage() {
  const { data: me } = useMe()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()

  const q = params.get('q') ?? ''
  const status = params.get('status') ?? ''
  const [stage, setStage] = useState('')
  const [previewId, setPreviewId] = useState<number | null>(null)

  const setQ = (v: string) => {
    const next = new URLSearchParams(params)
    if (v) next.set('q', v)
    else next.delete('q')
    setParams(next, { replace: true })
  }
  const setStatus = (v: string) => {
    const next = new URLSearchParams(params)
    if (v) next.set('status', v)
    else next.delete('status')
    setParams(next, { replace: true })
  }

  const statuses = status ? [status] : ALL_STATUSES

  const { data, isLoading } = useInteractions({
    responsible_id: me?.id,
    status: statuses,
    q: q || undefined,
  })

  const items = useMemo(() => data?.items ?? [], [data])
  const stages = useMemo(() => {
    const set = new Map<string, number>()
    for (const r of items) if (r.stage) set.set(r.stage.name, r.stage.id)
    return Array.from(set.entries())
  }, [items])
  const filteredItems = stage ? items.filter((r) => r.stage?.name === stage) : items

  const hasFilters = !!(q || status || stage)
  const reset = () => {
    setStage('')
    setParams({}, { replace: true })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0, position: 'relative' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {[['', 'Все'], ...ALL_STATUSES.map((s) => [s, STATUS_LABEL[s]])].map(([value, label]) => (
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
            </button>
          ))}
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
              placeholder="Вуз"
              style={{ flex: 1, minWidth: 0, border: 0, outline: 0, background: 'transparent', font: 'var(--font-body-s)', color: 'var(--fg-default)' }}
            />
          </label>

          <select
            value={stage}
            onChange={(e) => setStage(e.target.value)}
            style={{
              height: 36,
              padding: '0 8px',
              border: '1px solid var(--border-soft)',
              borderRadius: 'var(--border-radius-l)',
              background: 'var(--bg-surface1)',
              font: 'var(--font-body-s)',
              color: 'var(--fg-default)',
              outline: 0,
              cursor: 'pointer',
              maxWidth: 220,
            }}
          >
            <option value="">Все этапы</option>
            {stages.map(([name, id]) => (
              <option key={id} value={name}>
                {name}
              </option>
            ))}
          </select>

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
          <span>Слот</span>
          <span>Даты</span>
          <span></span>
        </div>

        {isLoading && (
          <>
            {[1, 2, 3, 4].map((k) => (
              <div
                key={k}
                style={{ display: 'grid', gridTemplateColumns: COLS, gap: 16, padding: '16px 8px', borderTop: '1px solid var(--border-muted)' }}
              >
                <div style={{ height: 14, width: '70%', borderRadius: 4, background: 'var(--neutral-container-default)' }} />
                <div style={{ height: 14, width: '80%', borderRadius: 4, background: 'var(--neutral-container-soft)' }} />
                <div style={{ height: 14, width: '60%', borderRadius: 4, background: 'var(--neutral-container-soft)' }} />
                <div style={{ height: 14, width: '50%', borderRadius: 4, background: 'var(--neutral-container-soft)' }} />
                <div style={{ height: 14, width: '60%', borderRadius: 4, background: 'var(--neutral-container-soft)' }} />
                <div />
              </div>
            ))}
          </>
        )}

        {!isLoading &&
          filteredItems.map((r) => (
            <InteractionRow key={r.id} row={r} onOpen={() => setPreviewId(r.id)} onGo={() => navigate(`/manager/interactions/${r.id}`)} />
          ))}

        {!isLoading && filteredItems.length === 0 && (
          <div
            style={{
              borderTop: '1px solid var(--border-muted)',
              padding: '56px 16px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 8,
              textAlign: 'center',
            }}
          >
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
      </section>

      {previewId != null && (
        <InteractionPreviewPanel interactionId={previewId} onClose={() => setPreviewId(null)} onOpen={(id) => navigate(`/manager/interactions/${id}`)} />
      )}
    </div>
  )
}

function InteractionRow({ row, onOpen, onGo }: { row: InteractionListRead; onOpen: () => void; onGo: () => void }) {
  const branches = row.branches.slice(0, 2)
  const more = row.branches.length > 2 ? row.branches.length - 2 : 0
  const [bg, dot] = STATUS_TONE[row.status] ?? STATUS_TONE.IN_PROGRESS
  const slotLabel = row.slot === 'ACTIVE' ? 'Активный' : 'Пассивный'
  const slotBg = row.slot === 'ACTIVE' ? 'var(--info-container-default)' : 'var(--neutral-container-default)'

  return (
    <div
      onClick={onOpen}
      style={{
        display: 'grid',
        gridTemplateColumns: COLS,
        gap: 16,
        padding: '12px 8px',
        borderTop: '1px solid var(--border-muted)',
        alignItems: 'start',
        cursor: 'pointer',
      }}
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
        {branches.map((b) => (
          <div key={b.id} style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
            <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-default)', textWrap: 'pretty' as any }}>
              {b.program?.name ?? '—'}
              <span style={{ color: 'var(--fg-muted)' }}> · {b.product?.name ?? '—'}{b.vendor_name ? ` (${b.vendor_name})` : ''}</span>
            </span>
          </div>
        ))}
        {more > 0 && <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)' }}>ещё {more}</span>}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
        <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-default)' }}>{row.stage?.name ?? '—'}</span>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          <span
            style={{
              height: 22,
              padding: '0 8px',
              borderRadius: 'var(--border-radius-m)',
              background: bg,
              font: 'var(--font-description-l-strong)',
              color: 'var(--fg-default)',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              whiteSpace: 'nowrap',
            }}
          >
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: dot }} />
            {STATUS_LABEL[row.status] ?? row.status}
          </span>
          {row.pause_state === 'PAUSED' && (
            <span
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                font: 'var(--font-description-l)',
                color: 'var(--fg-soft)',
              }}
            >
              {Atomaro.TimeStroke16 && <Atomaro.TimeStroke16 size={12} fill="var(--fg-soft)" />}
              Пауза{row.paused_until ? ` до ${new Date(row.paused_until).toLocaleDateString('ru-RU')}` : ''}
            </span>
          )}
        </div>
      </div>

      <div>
        <span
          style={{
            height: 20,
            padding: '0 6px',
            borderRadius: 'var(--border-radius-s)',
            background: slotBg,
            font: 'var(--font-description-l-strong)',
            color: 'var(--fg-soft)',
            display: 'inline-flex',
            alignItems: 'center',
          }}
        >
          {slotLabel}
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, font: 'var(--font-description-l)', color: 'var(--fg-muted)', fontVariantNumeric: 'tabular-nums' }}>
        <span>
          План: <span style={{ color: 'var(--fg-default)' }}>{row.planned_date ? new Date(row.planned_date).toLocaleDateString('ru-RU') : '—'}</span>
        </span>
        <span>Создано: {new Date(row.created_at).toLocaleDateString('ru-RU')}</span>
        <span>Обновлено: {new Date(row.updated_at).toLocaleDateString('ru-RU')}</span>
      </div>

      <div />
    </div>
  )
}
