import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMe } from '../../auth/useMe'
import { Atomaro } from '../../ds/atomaro'
import { useInteractions, type InteractionListRead } from '../../api/interactions'
import { useRequests, useDeleteRequest, type RequestRead, type RequestKind } from '../../api/requests'
import { useCloseReasons, useStage } from '../../api/requestRefs'
import { useToast } from '../ToastContext'
import RequestDialog from '../components/RequestDialog'

const COLS = 'minmax(110px,.8fr) minmax(90px,.6fr) minmax(220px,1.6fr) minmax(160px,1.2fr) minmax(140px,1fr) 100px'
const LIMIT = 5

const TONE: Record<string, [string, string]> = {
  neutral: ['var(--neutral-container-default)', 'var(--neutral-muted)'],
  success: ['var(--success-container-default)', 'var(--success-default)'],
  warning: ['var(--warning-container-default)', 'var(--warning-default)'],
  error: ['var(--error-container-default)', 'var(--error-default)'],
}
const ST: Record<string, [keyof typeof TONE, string]> = {
  PENDING: ['warning', 'Ожидает'],
  APPROVED: ['success', 'Одобрена'],
  REJECTED: ['error', 'Отклонена'],
  CANCELLED: ['neutral', 'Отменена'],
}
const KIND: Record<RequestKind, string> = { TRANSFER: 'Передача', CLOSE: 'Закрытие', TRANSITION: 'Переход' }

// активные заявки, из которых можно попросить руководителя - только свои и не черновик/не закрытые
const CREATABLE_STATUSES = ['IN_PROGRESS', 'SIGNED', 'PAUSED']

export default function RequestsPage() {
  const { data: me } = useMe()
  const navigate = useNavigate()
  const toast = useToast()

  const { data: requests, isLoading } = useRequests()
  const { data: myActive } = useInteractions({ responsible_id: me?.id, status: CREATABLE_STATUSES })
  const { data: closeReasonsAll } = useCloseReasons()
  const deleteRequest = useDeleteRequest()

  const [status, setStatus] = useState('')
  const [inter, setInter] = useState('')
  const [offset, setOffset] = useState(0)
  const [confirmId, setConfirmId] = useState<number | null>(null)
  const [pickInteractionId, setPickInteractionId] = useState('')
  const [dialogInteraction, setDialogInteraction] = useState<InteractionListRead | null>(null)

  const activeItems = useMemo(() => myActive?.items ?? [], [myActive])
  const interactionsById = useMemo(() => new Map(activeItems.map((i) => [i.id, i])), [activeItems])
  const closeReasonLabel = useMemo(() => new Map((closeReasonsAll ?? []).map((r) => [r.id, r.label])), [closeReasonsAll])

  const all = useMemo(() => requests ?? [], [requests])
  const filtered = all.filter((r) => (!status || r.status === status) && (!inter || String(r.interaction_id) === inter))
  const page = filtered.slice(offset, offset + LIMIT)
  const hasFilters = !!(status || inter)

  const interOpts = useMemo(() => {
    const seen = new Map<number, string>()
    for (const r of all) {
      if (seen.has(r.interaction_id)) continue
      const uni = interactionsById.get(r.interaction_id)?.university.name
      seen.set(r.interaction_id, uni ? `#${r.interaction_id} ${uni}` : `#${r.interaction_id}`)
    }
    return Array.from(seen.entries())
  }, [all, interactionsById])

  const reset = () => {
    setStatus('')
    setInter('')
    setOffset(0)
  }

  const doRevoke = () => {
    if (confirmId == null) return
    deleteRequest.mutate(confirmId, {
      onSuccess: () => {
        toast({ title: 'Просьба отозвана', subtitle: 'Руководитель её больше не увидит', colorScheme: 'info' })
        setConfirmId(null)
      },
      onError: (e: any) => {
        toast({ title: 'Не удалось отозвать просьбу', subtitle: e?.message, colorScheme: 'error' })
        setConfirmId(null)
      },
    })
  }

  const openCreate = () => {
    const id = Number(pickInteractionId)
    const row = interactionsById.get(id)
    if (row) setDialogInteraction(row)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value)
            setOffset(0)
          }}
          style={selectStyle}
        >
          <option value="">Все статусы</option>
          {Object.entries(ST).map(([k, v]) => (
            <option key={k} value={k}>
              {v[1]}
            </option>
          ))}
        </select>
        <select
          value={inter}
          onChange={(e) => {
            setInter(e.target.value)
            setOffset(0)
          }}
          style={selectStyle}
        >
          <option value="">Все взаимодействия</option>
          {interOpts.map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
        {hasFilters && (
          <button onClick={reset} style={{ height: 36, padding: '0 8px', border: 0, background: 'transparent', font: 'var(--font-body-s-strong)', color: 'var(--fg-soft)', cursor: 'pointer' }}>
            Сбросить
          </button>
        )}

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          <select value={pickInteractionId} onChange={(e) => setPickInteractionId(e.target.value)} style={{ ...selectStyle, maxWidth: 260 }}>
            <option value="">Выберите взаимодействие…</option>
            {activeItems.map((i) => (
              <option key={i.id} value={i.id}>
                #{i.id} {i.university.name}
              </option>
            ))}
          </select>
          <button
            onClick={openCreate}
            disabled={!pickInteractionId}
            style={{
              height: 36,
              padding: '0 16px',
              border: 0,
              borderRadius: 'var(--border-radius-buttons)',
              background: 'var(--accent-default)',
              color: '#fff',
              font: 'var(--font-body-s-strong)',
              cursor: pickInteractionId ? 'pointer' : 'default',
              opacity: pickInteractionId ? 1 : 0.5,
            }}
          >
            Новая просьба
          </button>
        </div>
      </div>

      <section style={{ background: 'var(--bg-surface1)', border: '1px solid var(--border-muted)', borderRadius: 'var(--border-radius-l)', padding: '8px 16px 16px', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'grid', gridTemplateColumns: COLS, gap: 16, padding: '12px 8px 8px', font: 'var(--font-description-l)', color: 'var(--fg-muted)' }}>
          <span>Взаимодействие</span>
          <span>Тип</span>
          <span>Цель и причина</span>
          <span>Решение</span>
          <span>Статус</span>
          <span></span>
        </div>

        {isLoading &&
          [1, 2, 3].map((k) => (
            <div key={k} style={{ display: 'grid', gridTemplateColumns: COLS, gap: 16, padding: '16px 8px', borderTop: '1px solid var(--border-muted)' }}>
              <div style={{ height: 14, width: '70%', borderRadius: 4, background: 'var(--neutral-container-default)' }} />
              <div style={{ height: 14, width: '60%', borderRadius: 4, background: 'var(--neutral-container-soft)' }} />
              <div style={{ height: 14, width: '85%', borderRadius: 4, background: 'var(--neutral-container-soft)' }} />
              <div style={{ height: 14, width: '60%', borderRadius: 4, background: 'var(--neutral-container-soft)' }} />
              <div style={{ height: 14, width: '50%', borderRadius: 4, background: 'var(--neutral-container-soft)' }} />
              <div />
            </div>
          ))}

        {!isLoading &&
          page.map((r) => (
            <RequestRow
              key={r.id}
              r={r}
              uni={interactionsById.get(r.interaction_id)?.university.name}
              closeReasonLabel={closeReasonLabel}
              onOpen={() => navigate(`/manager/interactions/${r.interaction_id}`)}
              onRevoke={() => setConfirmId(r.id)}
            />
          ))}

        {!isLoading && filtered.length === 0 && (
          <div style={{ borderTop: '1px solid var(--border-muted)', padding: '56px 16px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, textAlign: 'center' }}>
            {Atomaro.Forward && <Atomaro.Forward size={32} fill="var(--neutral-muted)" />}
            <span style={{ font: 'var(--font-body-s-strong)', color: 'var(--fg-soft)' }}>{hasFilters ? 'Ничего не найдено' : 'Просьб пока нет'}</span>
            <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)', textWrap: 'pretty' as any }}>
              {hasFilters ? 'Измените фильтры' : 'Выберите взаимодействие выше и создайте просьбу о передаче, закрытии или переходе'}
            </span>
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, borderTop: '1px solid var(--border-muted)', padding: '12px 8px 0' }}>
          <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)' }}></span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-soft)', fontVariantNumeric: 'tabular-nums' }}>
              {filtered.length ? offset + 1 : 0}–{Math.min(offset + LIMIT, filtered.length)} из {filtered.length}
            </span>
            <button onClick={() => setOffset((o) => Math.max(0, o - LIMIT))} title="Назад" disabled={offset === 0} style={pagerBtnStyle(offset === 0)}>
              {Atomaro.ChevronLeft16 && <Atomaro.ChevronLeft16 size={16} fill="var(--fg-soft)" />}
            </button>
            <button
              onClick={() => setOffset((o) => (o + LIMIT < filtered.length ? o + LIMIT : o))}
              title="Вперёд"
              disabled={offset + LIMIT >= filtered.length}
              style={pagerBtnStyle(offset + LIMIT >= filtered.length)}
            >
              {Atomaro.ChevronRight16 && <Atomaro.ChevronRight16 size={16} fill="var(--fg-soft)" />}
            </button>
          </div>
        </div>
      </section>

      {confirmId != null && (
        <>
          <div onClick={() => setConfirmId(null)} style={{ position: 'fixed', inset: 0, zIndex: 30, background: 'rgba(14,17,23,.4)' }} />
          <div
            style={{
              position: 'fixed',
              zIndex: 31,
              top: '50%',
              left: '50%',
              transform: 'translate(-50%,-50%)',
              width: 420,
              maxWidth: 'calc(100vw - 32px)',
              background: 'var(--bg-elevated-xl)',
              borderRadius: 'var(--border-radius-xl)',
              boxShadow: 'var(--shadow-bottom-xl)',
              padding: 24,
              display: 'flex',
              flexDirection: 'column',
              gap: 20,
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ font: 'var(--font-heading-h3)', color: 'var(--fg-default)' }}>Отозвать просьбу?</span>
              <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-soft)', textWrap: 'pretty' as any }}>
                Руководитель больше не увидит её. Вы сможете создать новую из этого же взаимодействия.
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button onClick={() => setConfirmId(null)} style={{ height: 40, padding: '0 20px', border: '1px solid var(--border-soft)', borderRadius: 'var(--border-radius-buttons)', background: 'var(--bg-surface1)', color: 'var(--fg-default)', font: 'var(--font-body-s-strong)', cursor: 'pointer' }}>
                Не отзывать
              </button>
              <button onClick={doRevoke} disabled={deleteRequest.isPending} style={{ height: 40, padding: '0 20px', border: 0, borderRadius: 'var(--border-radius-buttons)', background: 'var(--accent-default)', color: '#fff', font: 'var(--font-body-s-strong)', cursor: 'pointer', opacity: deleteRequest.isPending ? 0.7 : 1 }}>
                Отозвать
              </button>
            </div>
          </div>
        </>
      )}

      {dialogInteraction && (
        <RequestDialog
          interaction={dialogInteraction}
          onClose={() => setDialogInteraction(null)}
          onDone={() => {
            setDialogInteraction(null)
            setPickInteractionId('')
          }}
        />
      )}
    </div>
  )
}

const selectStyle = {
  height: 36,
  padding: '0 8px',
  border: '1px solid var(--border-soft)',
  borderRadius: 'var(--border-radius-l)',
  background: 'var(--bg-surface1)',
  font: 'var(--font-body-s)',
  color: 'var(--fg-default)',
  outline: 0,
  cursor: 'pointer',
} as const

function pagerBtnStyle(disabled: boolean) {
  return {
    width: 32,
    height: 32,
    border: '1px solid var(--border-soft)',
    borderRadius: 'var(--border-radius-m)',
    background: 'var(--bg-surface1)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: disabled ? 'default' : 'pointer',
    opacity: disabled ? 0.4 : 1,
  } as const
}

function RequestRow({
  r,
  uni,
  closeReasonLabel,
  onOpen,
  onRevoke,
}: {
  r: RequestRead
  uni: string | undefined
  closeReasonLabel: Map<number, string>
  onOpen: () => void
  onRevoke: () => void
}) {
  const [tone, label] = ST[r.status] ?? ['neutral', r.status]
  const [bg, dot] = TONE[tone]
  const decided = !!r.decided_by && !!r.decided_at
  const created = new Date(r.created_at).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })
  const decidedAt = r.decided_at ? new Date(r.decided_at).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' }) : ''

  return (
    <div style={{ display: 'grid', gridTemplateColumns: COLS, gap: 16, padding: '12px 8px', borderTop: '1px solid var(--border-muted)', alignItems: 'start' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault()
            onOpen()
          }}
          style={{ font: 'var(--font-body-s-strong)', color: 'var(--fg-default)' }}
        >
          {uni ?? `#${r.interaction_id}`}
        </a>
        <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)' }}>
          #{r.interaction_id} · {created}
        </span>
      </div>

      <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-default)' }}>{KIND[r.kind as RequestKind] ?? r.kind}</span>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
        <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-default)', textWrap: 'pretty' as any }}>
          <TargetText r={r} closeReasonLabel={closeReasonLabel} />
        </span>
        <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-muted)', textWrap: 'pretty' as any }}>«{r.reason}»</span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, font: 'var(--font-body-s)' }}>
        {decided && (
          <>
            <span style={{ color: 'var(--fg-default)' }}>
              {r.decided_by} · {decidedAt}
            </span>
            {r.decision_comment && <span style={{ color: 'var(--fg-muted)', textWrap: 'pretty' as any }}>«{r.decision_comment}»</span>}
          </>
        )}
        {!decided && r.status === 'PENDING' && <span style={{ color: 'var(--fg-muted)' }}>Ждёт решения</span>}
      </div>

      <div>
        <span style={{ height: 22, padding: '0 8px', borderRadius: 'var(--border-radius-m)', background: bg, font: 'var(--font-description-l-strong)', color: 'var(--fg-default)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: dot }} />
          {label}
        </span>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        {r.status === 'PENDING' && (
          <button onClick={onRevoke} style={{ height: 32, padding: '0 12px', border: '1px solid var(--border-soft)', borderRadius: 'var(--border-radius-buttons)', background: 'var(--bg-surface1)', color: 'var(--fg-default)', font: 'var(--font-body-s-strong)', cursor: 'pointer' }}>
            Отозвать
          </button>
        )}
      </div>
    </div>
  )
}

function TargetText({ r, closeReasonLabel }: { r: RequestRead; closeReasonLabel: Map<number, string> }) {
  const { data: stage } = useStage(r.target_stage_id)
  if (r.kind === 'TRANSFER') {
    // список коллег менеджеру недоступен (эндпоинт - только для руководителя), поэтому здесь только id или "решит сам"
    return <>{r.target_manager_id ? `Кому: ${r.target_manager_id}` : 'Кому: решит руководитель'}</>
  }
  const stageName = stage?.name ?? (r.target_stage_id ? `#${r.target_stage_id}` : '—')
  if (r.kind === 'CLOSE') {
    const reasonLabel = r.close_reason_id ? closeReasonLabel.get(r.close_reason_id) ?? `#${r.close_reason_id}` : ''
    return <>Этап «{stageName}»{reasonLabel ? ` · причина «${reasonLabel}»` : ''}</>
  }
  return <>Этап «{stageName}»</>
}
