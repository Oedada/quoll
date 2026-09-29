import { useMemo, useState } from 'react'
import { useToast } from '../../manager/ToastContext'
import { ApiError } from '../../api/client'
import { useUniversities } from '../../api/catalog'
import { usePrograms } from '../../api/catalog-extra'
import {
  useRuns,
  useStartRun,
  useUploadRun,
  useStub,
  useUnmatched,
  useResolveUnmatched,
  useRejectUnmatched,
  useLmsStats,
  exportIntegrations,
  type RunFlow,
  type RunRead,
  type UnmatchedRead,
  type UnmatchedStatus,
} from '../../api/integrations'

// разметка и токены — crm/project/Интеграции.dc.html

const FLOWS: { code: RunFlow; desc: string; upload: boolean }[] = [
  { code: 'I1', desc: 'Заглушка: выгрузка в сторонний сервис', upload: false },
  { code: 'I2', desc: 'Заглушка: приём из стороннего сервиса', upload: false },
  { code: 'B1', desc: 'Загрузка файлом: первый формат', upload: true },
  { code: 'B2', desc: 'Загрузка файлом: второй формат', upload: true },
]

const TRIGGER_LABELS: Record<string, string> = { SCHEDULE: 'по расписанию', MANUAL: 'вручную', FILE: 'файл' }

const card: React.CSSProperties = {
  background: 'var(--bg-surface1)',
  border: '1px solid var(--border-muted)',
  borderRadius: 'var(--border-radius-l)',
  padding: 16,
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
}

const section: React.CSSProperties = {
  background: 'var(--bg-surface1)',
  border: '1px solid var(--border-muted)',
  borderRadius: 'var(--border-radius-l)',
  padding: '8px 16px 16px',
  display: 'flex',
  flexDirection: 'column',
  overflowX: 'auto',
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
}

const btnGhost: React.CSSProperties = {
  height: 30,
  padding: '0 10px',
  border: '1px solid var(--border-soft)',
  borderRadius: 'var(--border-radius-buttons)',
  background: 'var(--bg-surface1)',
  color: 'var(--fg-default)',
  font: 'var(--font-description-l-strong)',
  cursor: 'pointer',
}

const btnAccent: React.CSSProperties = {
  height: 40,
  padding: '0 20px',
  border: 0,
  borderRadius: 'var(--border-radius-buttons)',
  background: 'var(--accent-default)',
  color: '#fff',
  font: 'var(--font-body-s-strong)',
  cursor: 'pointer',
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const mi = String(d.getMinutes()).padStart(2, '0')
  return `${dd}.${mm} ${hh}:${mi}`
}

function formatCounters(counters: Record<string, number>): string {
  const entries = Object.entries(counters)
  if (entries.length === 0) return '—'
  return entries.map(([k, v]) => `${k} ${v}`).join(' · ')
}

function statusBadge(status: 'DONE' | 'FAILED' | null): { label: string; bg: string } {
  if (status === 'DONE') return { label: 'Готово', bg: 'var(--success-container-default)' }
  if (status === 'FAILED') return { label: 'Ошибка', bg: 'var(--error-container-default)' }
  return { label: 'Не запускался', bg: 'var(--neutral-container-soft)' }
}

type DialogState =
  | { kind: 'file'; flow: 'B1' | 'B2' }
  | { kind: 'stub'; flow: 'I1' | 'I2' }
  | { kind: 'resolve'; row: UnmatchedRead }

export default function IntegrationsPage() {
  const [tab, setTab] = useState<'flows' | 'unm' | 'exp' | 'lms'>('flows')
  const toast = useToast()

  const { data: universities } = useUniversities()
  const { data: programs } = usePrograms()

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
      <Tabs tab={tab} setTab={setTab} />
      {tab === 'flows' && <FlowsTab toast={toast} />}
      {tab === 'unm' && <UnmatchedTab toast={toast} universities={universities ?? []} programs={programs ?? []} />}
      {tab === 'exp' && <ExportTab toast={toast} universities={universities ?? []} programs={programs ?? []} />}
      {tab === 'lms' && <LmsTab universities={universities ?? []} programs={programs ?? []} />}
    </div>
  )
}

function Tabs({
  tab,
  setTab,
}: {
  tab: 'flows' | 'unm' | 'exp' | 'lms'
  setTab: (t: 'flows' | 'unm' | 'exp' | 'lms') => void
}) {
  const { data: pending } = useUnmatched('PENDING', 200)
  const items: { k: 'flows' | 'unm' | 'exp' | 'lms'; label: string; count?: number }[] = [
    { k: 'flows', label: 'Потоки и запуски' },
    { k: 'unm', label: 'Несопоставленные', count: pending?.length },
    { k: 'exp', label: 'Выгрузка' },
    { k: 'lms', label: 'Статистика LMS' },
  ]
  return (
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
      {items.map((it) => (
        <button
          key={it.k}
          onClick={() => setTab(it.k)}
          style={{
            height: 30,
            padding: '0 12px',
            border: 0,
            borderRadius: 6,
            background: tab === it.k ? 'var(--bg-surface1)' : 'transparent',
            font: 'var(--font-description-l-strong)',
            color: tab === it.k ? 'var(--fg-default)' : 'var(--fg-soft)',
            cursor: 'pointer',
          }}
        >
          {it.label} {!!it.count && <span style={{ color: 'var(--fg-muted)' }}>{it.count}</span>}
        </button>
      ))}
    </div>
  )
}

function FlowsTab({ toast }: { toast: ReturnType<typeof useToast> }) {
  const [filterFlow, setFilterFlow] = useState<RunFlow | ''>('')
  const { data: runs } = useRuns(filterFlow, 100)
  const { data: allRuns } = useRuns('', 200)
  const [dialog, setDialog] = useState<DialogState | null>(null)

  const startRun = useStartRun()
  const uploadRun = useUploadRun()

  function handleStart(flow: RunFlow) {
    startRun.mutate(flow, {
      onSuccess: (r) => {
        if (r.status === 'FAILED') {
          toast({ title: `Запуск ${flow} не удался`, subtitle: r.error ?? undefined, colorScheme: 'warning' })
        } else {
          toast({ title: `Поток ${flow} запущен`, subtitle: 'Результат появится в списке запусков', colorScheme: 'success' })
        }
      },
      onError: (err) => toast({ title: `Не удалось запустить ${flow}`, subtitle: err instanceof ApiError ? err.message : undefined, colorScheme: 'error' }),
    })
  }

  const lastByFlow = useMemo(() => {
    const map = new Map<string, RunRead>()
    for (const r of allRuns ?? []) {
      if (!map.has(r.flow)) map.set(r.flow, r)
    }
    return map
  }, [allRuns])

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,minmax(0,1fr))', gap: 12 }}>
        {FLOWS.map((f) => {
          const last = lastByFlow.get(f.code)
          const badge = statusBadge(last ? (last.status as 'DONE' | 'FAILED') : null)
          return (
            <div key={f.code} style={card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ font: 'var(--font-heading-h4)', color: 'var(--fg-default)' }}>{f.code}</span>
                <span
                  style={{
                    height: 22,
                    padding: '0 8px',
                    borderRadius: 'var(--border-radius-m)',
                    background: badge.bg,
                    font: 'var(--font-description-l-strong)',
                    color: 'var(--fg-default)',
                    display: 'flex',
                    alignItems: 'center',
                  }}
                >
                  {badge.label}
                </span>
              </div>
              <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-soft)', textWrap: 'pretty' }}>{f.desc}</span>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {f.upload ? (
                  <button onClick={() => setDialog({ kind: 'file', flow: f.code as 'B1' | 'B2' })} style={btnGhost}>
                    Загрузить файл
                  </button>
                ) : (
                  <>
                    <button onClick={() => handleStart(f.code)} style={btnGhost}>
                      Запустить
                    </button>
                    <button onClick={() => setDialog({ kind: 'stub', flow: f.code as 'I1' | 'I2' })} style={btnGhost}>
                      Что приняла заглушка
                    </button>
                  </>
                )}
              </div>
            </div>
          )
        })}
      </div>

      <section style={{ ...section, marginTop: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 8px 4px' }}>
          <span style={{ font: 'var(--font-heading-h4)', color: 'var(--fg-default)' }}>Запуски</span>
          <select value={filterFlow} onChange={(e) => setFilterFlow(e.target.value as RunFlow | '')} style={selectStyle}>
            <option value="">Все потоки</option>
            {FLOWS.map((f) => (
              <option key={f.code} value={f.code}>
                {f.code}
              </option>
            ))}
          </select>
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '60px minmax(110px,.8fr) minmax(110px,.8fr) minmax(140px,1fr) minmax(190px,1.4fr) minmax(150px,1.2fr)',
            gap: 16,
            padding: '12px 8px 8px',
            font: 'var(--font-description-l)',
            color: 'var(--fg-muted)',
            minWidth: 800,
          }}
        >
          <span>Поток</span>
          <span>Запуск</span>
          <span>Статус</span>
          <span>Начало — конец</span>
          <span>Счётчики</span>
          <span>Ошибка, кто запустил</span>
        </div>
        {(runs ?? []).length === 0 && (
          <div style={{ padding: '40px 8px', textAlign: 'center', font: 'var(--font-body-s)', color: 'var(--fg-muted)' }}>Запусков ещё не было</div>
        )}
        {(runs ?? []).map((r) => {
          const badge = statusBadge(r.status)
          return (
            <div
              key={r.id}
              style={{
                display: 'grid',
                gridTemplateColumns: '60px minmax(110px,.8fr) minmax(110px,.8fr) minmax(140px,1fr) minmax(190px,1.4fr) minmax(150px,1.2fr)',
                gap: 16,
                padding: '12px 8px',
                borderTop: '1px solid var(--border-muted)',
                alignItems: 'start',
                minWidth: 800,
              }}
            >
              <span style={{ font: 'var(--font-body-s-strong)', color: 'var(--fg-default)' }}>{r.flow}</span>
              <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-soft)' }}>{TRIGGER_LABELS[r.trigger] ?? r.trigger}</span>
              <span
                style={{
                  height: 22,
                  padding: '0 8px',
                  borderRadius: 'var(--border-radius-m)',
                  background: badge.bg,
                  font: 'var(--font-description-l-strong)',
                  color: 'var(--fg-default)',
                  display: 'flex',
                  alignItems: 'center',
                  justifySelf: 'start',
                }}
              >
                {badge.label}
              </span>
              <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-soft)' }}>
                {formatDate(r.started_at)} — {formatDate(r.finished_at)}
              </span>
              <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-soft)' }}>{formatCounters(r.counters)}</span>
              <span style={{ font: 'var(--font-description-l)', color: r.error ? 'var(--error-default)' : 'var(--fg-muted)', textWrap: 'pretty' }}>
                {r.error ?? (r.actor_id ?? 'система')}
              </span>
            </div>
          )
        })}
      </section>

      {dialog && dialog.kind === 'file' && (
        <UploadDialog
          flow={dialog.flow}
          onClose={() => setDialog(null)}
          uploadRun={uploadRun}
          toast={toast}
        />
      )}
      {dialog && dialog.kind === 'stub' && <StubDialog flow={dialog.flow} onClose={() => setDialog(null)} />}
    </>
  )
}

function UploadDialog({
  flow,
  onClose,
  uploadRun,
  toast,
}: {
  flow: 'B1' | 'B2'
  onClose: () => void
  uploadRun: ReturnType<typeof useUploadRun>
  toast: ReturnType<typeof useToast>
}) {
  const [file, setFile] = useState<File | null>(null)
  const [err, setErr] = useState('')

  function confirm() {
    if (!file) return setErr('Выберите файл')
    uploadRun.mutate(
      { flow, file },
      {
        onSuccess: (r) => {
          onClose()
          if (r.status === 'FAILED') {
            toast({ title: `Загрузка в ${flow} не удалась`, subtitle: r.error ?? undefined, colorScheme: 'warning' })
          } else {
            toast({ title: `Файл загружен в ${flow}`, subtitle: file.name, colorScheme: 'success' })
          }
        },
        onError: (e) => setErr(e instanceof ApiError ? e.message : 'Не удалось загрузить файл'),
      },
    )
  }

  return (
    <Dialog title={`Загрузить файл в поток ${flow}`} onClose={onClose} onConfirm={confirm} confirmLabel="Загрузить" pending={uploadRun.isPending}>
      <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-soft)', textWrap: 'pretty' }}>
        JSON-массив в формате заглушки. Файл после разбора не хранится.
      </span>
      <label style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}>
        <span
          style={{
            height: 36,
            padding: '0 16px',
            border: '1px solid var(--border-soft)',
            borderRadius: 'var(--border-radius-buttons)',
            background: 'var(--bg-surface1)',
            color: 'var(--fg-default)',
            font: 'var(--font-body-s-strong)',
            display: 'flex',
            alignItems: 'center',
          }}
        >
          Выбрать файл
        </span>
        <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-muted)' }}>{file?.name ?? 'Файл не выбран'}</span>
        <input
          type="file"
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null)
            setErr('')
          }}
          style={{ display: 'none' }}
        />
      </label>
      {err && <span style={{ font: 'var(--font-description-l)', color: 'var(--error-default)' }}>{err}</span>}
    </Dialog>
  )
}

function StubDialog({ flow, onClose }: { flow: 'I1' | 'I2'; onClose: () => void }) {
  const { data: stub, isLoading } = useStub(flow)
  return (
    <Dialog title={`Что приняла заглушка ${flow}`} onClose={onClose} cancelLabel="Закрыть">
      {isLoading && <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-muted)' }}>Загрузка…</span>}
      {!isLoading && (
        <>
          <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)' }}>
            {stub?.received_at ? `Принято: ${formatDate(stub.received_at)}` : 'Успешных приёмов ещё не было'}
          </span>
          <pre
            style={{
              background: 'var(--bg-surface2)',
              borderRadius: 'var(--border-radius-m)',
              padding: 12,
              font: 'var(--font-description-l)',
              color: 'var(--fg-default)',
              overflow: 'auto',
              maxHeight: 220,
              margin: 0,
            }}
          >
            {JSON.stringify(stub?.payload ?? null, null, 2)}
          </pre>
        </>
      )}
    </Dialog>
  )
}

function recordSummary(record: Record<string, unknown>): string {
  return Object.entries(record)
    .map(([k, v]) => `${k}: ${v}`)
    .join(', ')
}

function UnmatchedTab({
  toast,
  universities,
  programs,
}: {
  toast: ReturnType<typeof useToast>
  universities: { id: number; short_name: string }[]
  programs: { id: number; name: string }[]
}) {
  const [status, setStatus] = useState<UnmatchedStatus>('PENDING')
  const { data: rows } = useUnmatched(status, 200)
  const [dialog, setDialog] = useState<DialogState | null>(null)
  const rejectUnmatched = useRejectUnmatched()

  function candidateLabel(kind: string, id: number): string {
    if (kind === 'UNIVERSITY') return universities.find((u) => u.id === id)?.short_name ?? `id ${id}`
    return programs.find((p) => p.id === id)?.name ?? `id ${id}`
  }

  function handleReject(row: UnmatchedRead) {
    rejectUnmatched.mutate(row.id, {
      onSuccess: () => toast({ title: 'Запись отклонена', subtitle: row.record_key, colorScheme: 'info' }),
      onError: (err) => toast({ title: 'Не удалось отклонить', subtitle: err instanceof ApiError ? err.message : undefined, colorScheme: 'error' }),
    })
  }

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <select value={status} onChange={(e) => setStatus(e.target.value as UnmatchedStatus)} style={selectStyle}>
          <option value="PENDING">Ждут решения</option>
          <option value="RESOLVED">Сопоставлены</option>
          <option value="REJECTED">Отклонены</option>
        </select>
        <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)' }}>Записи, которые не удалось сопоставить со справочником</span>
      </div>

      <section style={section}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '60px minmax(160px,1.2fr) minmax(130px,1fr) minmax(170px,1.3fr) minmax(150px,1fr) 190px',
            gap: 16,
            padding: '12px 8px 8px',
            font: 'var(--font-description-l)',
            color: 'var(--fg-muted)',
            minWidth: 860,
          }}
        >
          <span>Поток</span>
          <span>Ключ записи</span>
          <span>Причина</span>
          <span>Запись</span>
          <span>Кандидаты</span>
          <span />
        </div>
        {(rows ?? []).length === 0 && (
          <div style={{ padding: '40px 8px', textAlign: 'center', font: 'var(--font-body-s)', color: 'var(--fg-muted)' }}>Очередь пуста</div>
        )}
        {(rows ?? []).map((u) => (
          <div
            key={u.id}
            style={{
              display: 'grid',
              gridTemplateColumns: '60px minmax(160px,1.2fr) minmax(130px,1fr) minmax(170px,1.3fr) minmax(150px,1fr) 190px',
              gap: 16,
              padding: '12px 8px',
              borderTop: '1px solid var(--border-muted)',
              alignItems: 'start',
              minWidth: 860,
            }}
          >
            <span style={{ font: 'var(--font-body-s-strong)', color: 'var(--fg-default)' }}>{u.flow}</span>
            <span style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{ font: 'var(--font-body-s-strong)', color: 'var(--fg-default)' }}>{u.record_key}</span>
              <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)' }}>ext: {u.external_key}</span>
            </span>
            <span style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-default)' }}>{u.code}</span>
              <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)' }}>{u.mapping_kind}</span>
            </span>
            <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-soft)', textWrap: 'pretty' }}>{recordSummary(u.record)}</span>
            <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-soft)' }}>
              {u.candidates.length ? u.candidates.map((c) => candidateLabel(u.mapping_kind, c)).join(', ') : 'нет'}
            </span>
            <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
              {u.status === 'PENDING' ? (
                <>
                  <button onClick={() => setDialog({ kind: 'resolve', row: u })} style={{ ...btnGhost, border: 0, background: 'var(--accent-default)', color: '#fff' }}>
                    Сопоставить
                  </button>
                  <button onClick={() => handleReject(u)} style={{ ...btnGhost, color: 'var(--error-default)' }}>
                    Отклонить
                  </button>
                </>
              ) : (
                <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)' }}>
                  {u.decided_by ?? '—'}
                  {u.decided_at ? `, ${formatDate(u.decided_at)}` : ''}
                </span>
              )}
            </div>
          </div>
        ))}
      </section>

      {dialog && dialog.kind === 'resolve' && (
        <ResolveDialog row={dialog.row} candidateLabel={candidateLabel} onClose={() => setDialog(null)} toast={toast} />
      )}
    </>
  )
}

function ResolveDialog({
  row,
  candidateLabel,
  onClose,
  toast,
}: {
  row: UnmatchedRead
  candidateLabel: (kind: string, id: number) => string
  onClose: () => void
  toast: ReturnType<typeof useToast>
}) {
  const [mode, setMode] = useState<'candidate' | 'manual'>(row.candidates.length ? 'candidate' : 'manual')
  const [target, setTarget] = useState(row.candidates.length ? String(row.candidates[0]) : '')
  const [err, setErr] = useState('')
  const resolveUnmatched = useResolveUnmatched()

  function confirm() {
    const n = Number(target)
    if (!target || !Number.isFinite(n)) return setErr('Укажите id записи справочника')
    resolveUnmatched.mutate(
      { id: row.id, targetId: n },
      {
        onSuccess: () => {
          onClose()
          toast({ title: 'Запись сопоставлена', subtitle: row.record_key, colorScheme: 'success' })
        },
        onError: (e) => setErr(e instanceof ApiError ? e.message : 'Не удалось сопоставить'),
      },
    )
  }

  return (
    <Dialog title="Сопоставить запись" onClose={onClose} onConfirm={confirm} confirmLabel="Сопоставить" pending={resolveUnmatched.isPending}>
      <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-soft)', textWrap: 'pretty' }}>{recordSummary(row.record)}</span>
      {mode === 'candidate' ? (
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ font: 'var(--font-description-l-strong)', color: 'var(--fg-soft)' }}>Запись справочника</span>
          <select
            value={target}
            onChange={(e) => {
              setTarget(e.target.value)
              setErr('')
            }}
            style={{ ...selectStyle, height: 40, borderRadius: 'var(--border-radius-inputs)', width: '100%' }}
          >
            {row.candidates.map((c) => (
              <option key={c} value={c}>
                {candidateLabel(row.mapping_kind, c)} · id {c}
              </option>
            ))}
          </select>
          <button onClick={() => { setMode('manual'); setTarget('') }} style={{ alignSelf: 'flex-start', border: 0, background: 'transparent', color: 'var(--accent-default)', font: 'var(--font-description-l-strong)', cursor: 'pointer', padding: 0 }}>
            Указать id вручную
          </button>
        </label>
      ) : (
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ font: 'var(--font-description-l-strong)', color: 'var(--fg-soft)' }}>
            {row.candidates.length ? 'Id вручную' : 'Кандидатов нет — укажите id вручную'}
          </span>
          <input
            type="number"
            value={target}
            onChange={(e) => {
              setTarget(e.target.value)
              setErr('')
            }}
            style={{ height: 40, padding: '0 12px', border: '1px solid var(--border-soft)', borderRadius: 'var(--border-radius-inputs)', background: 'var(--bg-surface1)', font: 'var(--font-body-s)', color: 'var(--fg-default)', outline: 0 }}
          />
          {row.candidates.length > 0 && (
            <button onClick={() => { setMode('candidate'); setTarget(String(row.candidates[0])) }} style={{ alignSelf: 'flex-start', border: 0, background: 'transparent', color: 'var(--accent-default)', font: 'var(--font-description-l-strong)', cursor: 'pointer', padding: 0 }}>
              Выбрать из кандидатов
            </button>
          )}
        </label>
      )}
      {err && <span style={{ font: 'var(--font-description-l)', color: 'var(--error-default)' }}>{err}</span>}
    </Dialog>
  )
}

function ExportTab({
  toast,
  universities,
  programs,
}: {
  toast: ReturnType<typeof useToast>
  universities: { id: number; short_name: string }[]
  programs: { id: number; name: string }[]
}) {
  const [uniIds, setUniIds] = useState<number[]>([])
  const [progIds, setProgIds] = useState<number[]>([])
  const [closed, setClosed] = useState(false)
  const [pending, setPending] = useState(false)

  function toggle(list: number[], setList: (v: number[]) => void, id: number) {
    setList(list.includes(id) ? list.filter((x) => x !== id) : [...list, id])
  }

  async function doExport() {
    setPending(true)
    try {
      const filename = await exportIntegrations({ universityIds: uniIds, programIds: progIds, includeClosed: closed })
      toast({ title: 'Выгрузка готова', subtitle: filename, colorScheme: 'success' })
    } catch (e) {
      toast({ title: 'Не удалось выгрузить', subtitle: e instanceof ApiError ? e.message : undefined, colorScheme: 'error' })
    } finally {
      setPending(false)
    }
  }

  const checkboxList = (
    items: { id: number; label: string }[],
    selected: number[],
    onToggle: (id: number) => void,
  ) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 160, overflowY: 'auto', border: '1px solid var(--border-soft)', borderRadius: 'var(--border-radius-inputs)', padding: 8 }}>
      {items.length === 0 && <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-muted)' }}>Список пуст</span>}
      {items.map((it) => (
        <label key={it.id} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', font: 'var(--font-body-s)', color: 'var(--fg-default)' }}>
          <input type="checkbox" checked={selected.includes(it.id)} onChange={() => onToggle(it.id)} />
          {it.label}
        </label>
      ))}
    </div>
  )

  return (
    <section style={{ ...card, padding: 20, gap: 14, maxWidth: 560 }}>
      <span style={{ font: 'var(--font-heading-h4)', color: 'var(--fg-default)' }}>Выгрузка в JSON</span>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ font: 'var(--font-description-l-strong)', color: 'var(--fg-soft)' }}>Вузы {uniIds.length ? '' : '(все)'}</span>
        {checkboxList(
          universities.map((u) => ({ id: u.id, label: u.short_name })),
          uniIds,
          (id) => toggle(uniIds, setUniIds, id),
        )}
      </label>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ font: 'var(--font-description-l-strong)', color: 'var(--fg-soft)' }}>Программы {progIds.length ? '' : '(все)'}</span>
        {checkboxList(
          programs.map((p) => ({ id: p.id, label: p.name })),
          progIds,
          (id) => toggle(progIds, setProgIds, id),
        )}
      </label>
      <button
        onClick={() => setClosed(!closed)}
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
        <span
          style={{
            width: 14,
            height: 14,
            borderRadius: 4,
            border: `2px solid ${closed ? 'var(--accent-default)' : 'var(--neutral-muted)'}`,
            background: closed ? 'var(--accent-default)' : 'transparent',
          }}
        />
        Включая закрытые
      </button>
      <button onClick={doExport} disabled={pending} style={{ ...btnAccent, alignSelf: 'flex-start', opacity: pending ? 0.6 : 1, cursor: pending ? 'default' : 'pointer' }}>
        Выгрузить
      </button>
    </section>
  )
}

function LmsTab({
  universities,
  programs,
}: {
  universities: { id: number; short_name: string }[]
  programs: { id: number; name: string }[]
}) {
  const [uniId, setUniId] = useState<number | ''>('')
  const [progId, setProgId] = useState<number | ''>('')
  const { data: rows } = useLmsStats(uniId || undefined, progId || undefined)

  const uniName = (id: number) => universities.find((u) => u.id === id)?.short_name ?? `id ${id}`
  const progName = (id: number) => programs.find((p) => p.id === id)?.name ?? `id ${id}`

  return (
    <>
      <div style={{ display: 'flex', gap: 8 }}>
        <select value={uniId} onChange={(e) => setUniId(e.target.value ? Number(e.target.value) : '')} style={selectStyle}>
          <option value="">Все вузы</option>
          {universities.map((u) => (
            <option key={u.id} value={u.id}>
              {u.short_name}
            </option>
          ))}
        </select>
        <select value={progId} onChange={(e) => setProgId(e.target.value ? Number(e.target.value) : '')} style={selectStyle}>
          <option value="">Все программы</option>
          {programs.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>
      <section style={section}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(120px,1fr) minmax(160px,1.2fr) 90px 90px 130px minmax(110px,.8fr) minmax(120px,1fr)',
            gap: 16,
            padding: '12px 8px 8px',
            font: 'var(--font-description-l)',
            color: 'var(--fg-muted)',
          }}
        >
          <span>Вуз</span>
          <span>Программа</span>
          <span>Студенты</span>
          <span>Потоки</span>
          <span>Обучено преп.</span>
          <span>Источник</span>
          <span>Обновлено</span>
        </div>
        {(rows ?? []).length === 0 && (
          <div style={{ padding: '40px 8px', textAlign: 'center', font: 'var(--font-body-s)', color: 'var(--fg-muted)' }}>
            LMS ничего не присылала по этой паре
          </div>
        )}
        {(rows ?? []).map((r, i) => (
          <div
            key={`${r.university_id}-${r.program_id}-${i}`}
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(120px,1fr) minmax(160px,1.2fr) 90px 90px 130px minmax(110px,.8fr) minmax(120px,1fr)',
              gap: 16,
              padding: '12px 8px',
              borderTop: '1px solid var(--border-muted)',
              font: 'var(--font-body-s)',
              color: 'var(--fg-default)',
            }}
          >
            <span style={{ font: 'var(--font-body-s-strong)' }}>{uniName(r.university_id)}</span>
            <span>{progName(r.program_id)}</span>
            <span>{r.students}</span>
            <span>{r.streams}</span>
            <span>{r.teachers_trained ?? '—'}</span>
            <span style={{ color: 'var(--fg-soft)' }}>{r.source}</span>
            <span style={{ color: 'var(--fg-soft)' }}>{formatDate(r.updated_at)}</span>
          </div>
        ))}
      </section>
    </>
  )
}

function Dialog({
  title,
  onClose,
  onConfirm,
  confirmLabel,
  cancelLabel = 'Отмена',
  pending,
  children,
}: {
  title: string
  onClose: () => void
  onConfirm?: () => void
  confirmLabel?: string
  cancelLabel?: string
  pending?: boolean
  children?: React.ReactNode
}) {
  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 80, background: 'rgba(14,17,23,.4)' }} />
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
          gap: 14,
        }}
      >
        <span style={{ font: 'var(--font-heading-h3)', color: 'var(--fg-default)' }}>{title}</span>
        {children}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button
            onClick={onClose}
            style={{
              height: 40,
              padding: '0 20px',
              border: '1px solid var(--border-soft)',
              borderRadius: 'var(--border-radius-buttons)',
              background: 'var(--bg-surface1)',
              color: 'var(--fg-default)',
              font: 'var(--font-body-s-strong)',
              cursor: 'pointer',
            }}
          >
            {cancelLabel}
          </button>
          {onConfirm && confirmLabel && (
            <button
              onClick={onConfirm}
              disabled={pending}
              style={{
                height: 40,
                padding: '0 20px',
                border: 0,
                borderRadius: 'var(--border-radius-buttons)',
                background: 'var(--accent-default)',
                color: '#fff',
                font: 'var(--font-body-s-strong)',
                cursor: pending ? 'default' : 'pointer',
                opacity: pending ? 0.6 : 1,
              }}
            >
              {confirmLabel}
            </button>
          )}
        </div>
      </div>
    </>
  )
}
