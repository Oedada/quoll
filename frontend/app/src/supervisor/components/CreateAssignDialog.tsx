import { useMemo, useState } from 'react'
import { useUniversities, type UniversityRead } from '../../api/catalog'
import { usePrograms, type ProgramRead } from '../../api/catalog-extra'
import { useWorkflows } from '../../api/workflows'
import { useAssignmentPool } from '../../api/org'
import { useCreateInteractionDraft, useAssignInteraction, type BranchWrite } from '../../api/interactions'
import { useToast } from '../../manager/ToastContext'

type Props =
  | { kind: 'create'; onClose: () => void; onDone: (id: number) => void }
  | {
      kind: 'assign'
      interactionId: number
      currentOwnerName: string | null
      onClose: () => void
      onDone: () => void
    }

const fieldStyle: React.CSSProperties = {
  height: 40,
  padding: '0 12px',
  border: '1px solid var(--border-soft)',
  borderRadius: 'var(--border-radius-inputs)',
  background: 'var(--bg-surface1)',
  font: 'var(--font-body-s)',
  color: 'var(--fg-default)',
  outline: 0,
}

const overlay: React.CSSProperties = { position: 'fixed', inset: 0, zIndex: 80, background: 'rgba(14,17,23,.4)' }
const modal: React.CSSProperties = {
  position: 'fixed',
  zIndex: 81,
  top: '50%',
  left: '50%',
  transform: 'translate(-50%,-50%)',
  width: 560,
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
}

export function CreateAssignDialog(props: Props) {
  return (
    <>
      <div onClick={props.onClose} style={overlay} />
      <div style={modal}>{props.kind === 'create' ? <CreateBody {...props} /> : <AssignBody {...props} />}</div>
    </>
  )
}

function CreateBody({ onClose, onDone }: { onClose: () => void; onDone: (id: number) => void }) {
  const toast = useToast()
  const { data: universities } = useUniversities()
  const { data: programs } = usePrograms()
  const { data: workflows } = useWorkflows()
  const create = useCreateInteractionDraft()

  const [uni, setUni] = useState<UniversityRead | null>(null)
  const [q, setQ] = useState('')
  const [branches, setBranches] = useState<Array<{ programId: number | ''; productId: number | '' }>>([
    { programId: '', productId: '' },
  ])
  const [date, setDate] = useState('')
  const [wf, setWf] = useState('')
  const [tried, setTried] = useState(false)
  const [err, setErr] = useState('')

  const found = useMemo(() => {
    const ql = q.trim().toLowerCase()
    const list = universities ?? []
    if (!ql) return list.slice(0, 8)
    return list
      .filter((u) => `${u.short_name} ${u.full_name} ${u.region ?? ''} ${u.inn ?? ''}`.toLowerCase().includes(ql))
      .slice(0, 8)
  }, [universities, q])

  const publishedWfs = (workflows ?? []).filter((w) => w.is_published)

  const setBranch = (i: number, patch: Partial<{ programId: number | ''; productId: number | '' }>) =>
    setBranches((bs) => bs.map((b, j) => (j === i ? { ...b, ...patch } : b)))

  const confirm = () => {
    setTried(true)
    if (!uni) return setErr('Выберите вуз из справочника')
    if (branches.some((b) => !b.programId)) return setErr('У каждой ветки должна быть программа')
    const body = {
      university_id: uni.id,
      branches: branches.map<BranchWrite>((b) => ({
        program_id: Number(b.programId),
        product_id: b.productId ? Number(b.productId) : null,
      })),
      planned_date: date || null,
      workflow_id: wf ? Number(wf) : null,
    }
    create.mutate(body, {
      onSuccess: (row) => {
        toast({ title: 'Черновик создан', subtitle: `${uni.short_name} · веток: ${branches.length}. Осталось назначить КАМа`, colorScheme: 'success' })
        onDone(row.id)
      },
      onError: (e) => setErr(e.message),
    })
  }

  return (
    <>
      <span style={{ font: 'var(--font-heading-h3)', color: 'var(--fg-default)' }}>Создать взаимодействие</span>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ font: 'var(--font-description-l-strong)', color: 'var(--fg-soft)' }}>Вуз</span>
        {uni ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              padding: '10px 12px',
              border: '1px solid var(--border-soft)',
              borderRadius: 'var(--border-radius-inputs)',
            }}
          >
            <span style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{ font: 'var(--font-body-s-strong)', color: 'var(--fg-default)' }}>{uni.short_name}</span>
              <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)' }}>
                {uni.region ?? '—'} · ИНН {uni.inn ?? '—'}
              </span>
            </span>
            <button
              onClick={() => setUni(null)}
              style={{ border: 0, background: 'transparent', font: 'var(--font-description-l-strong)', color: 'var(--accent-default)', cursor: 'pointer' }}
            >
              Изменить
            </button>
          </div>
        ) : (
          <>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Название, регион или ИНН"
              style={{ ...fieldStyle, borderColor: tried && !uni ? 'var(--error-default)' : 'var(--border-soft)' }}
            />
            <div style={{ display: 'flex', flexDirection: 'column', border: '1px solid var(--border-muted)', borderRadius: 'var(--border-radius-m)', maxHeight: 132, overflowY: 'auto' }}>
              {found.map((u) => (
                <button
                  key={u.id}
                  onClick={() => {
                    setUni(u)
                    setQ('')
                  }}
                  style={{ border: 0, background: 'transparent', textAlign: 'left', padding: '8px 12px', display: 'flex', justifyContent: 'space-between', gap: 12, cursor: 'pointer' }}
                >
                  <span style={{ font: 'var(--font-body-s-strong)', color: 'var(--fg-default)' }}>{u.short_name}</span>
                  <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)' }}>
                    {u.region ?? '—'} · {u.inn ?? '—'}
                  </span>
                </button>
              ))}
              {found.length === 0 && (
                <span style={{ padding: 12, font: 'var(--font-description-l)', color: 'var(--fg-muted)' }}>Ничего не найдено в справочнике</span>
              )}
            </div>
          </>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span style={{ font: 'var(--font-description-l-strong)', color: 'var(--fg-soft)' }}>Ветки договора</span>
        {branches.map((b, i) => {
          const program = (programs ?? []).find((p: ProgramRead) => p.id === b.programId)
          return (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 32px', gap: 8, alignItems: 'center' }}>
              <select
                value={b.programId}
                onChange={(e) => setBranch(i, { programId: e.target.value ? Number(e.target.value) : '', productId: '' })}
                style={{ ...fieldStyle, borderColor: tried && !b.programId ? 'var(--error-default)' : 'var(--border-soft)' }}
              >
                <option value="">Программа *</option>
                {(programs ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <select
                value={b.productId}
                onChange={(e) => setBranch(i, { productId: e.target.value ? Number(e.target.value) : '' })}
                style={fieldStyle}
                disabled={!program}
              >
                <option value="">Продукт (необязательно)</option>
                {(program?.products ?? []).map((pr) => (
                  <option key={pr.id} value={pr.id}>
                    {pr.name}
                  </option>
                ))}
              </select>
              <button
                onClick={() => branches.length > 1 && setBranches((bs) => bs.filter((_, j) => j !== i))}
                title="Убрать ветку"
                disabled={branches.length <= 1}
                style={{ width: 32, height: 32, border: 0, borderRadius: 'var(--border-radius-m)', background: 'transparent', color: 'var(--fg-soft)', cursor: 'pointer', opacity: branches.length > 1 ? 1 : 0.3 }}
              >
                ✕
              </button>
            </div>
          )
        })}
        <button
          onClick={() => setBranches((bs) => [...bs, { programId: '', productId: '' }])}
          style={{ alignSelf: 'flex-start', border: 0, background: 'transparent', padding: 0, font: 'var(--font-body-s-strong)', color: 'var(--accent-default)', cursor: 'pointer' }}
        >
          ＋ Добавить ветку
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ font: 'var(--font-description-l-strong)', color: 'var(--fg-soft)' }}>Плановая дата (необязательно)</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={fieldStyle} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ font: 'var(--font-description-l-strong)', color: 'var(--fg-soft)' }}>Воркфлоу (только опубликованные)</span>
          <select value={wf} onChange={(e) => setWf(e.target.value)} style={fieldStyle}>
            <option value="">По умолчанию</option>
            {publishedWfs.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)' }}>
        Создаётся черновик: его видите только вы, пока не назначите КАМа.
      </span>

      {err && <span style={{ font: 'var(--font-body-s)', color: 'var(--error-default)' }}>{err}</span>}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button onClick={onClose} style={{ height: 40, padding: '0 20px', border: '1px solid var(--border-soft)', borderRadius: 'var(--border-radius-buttons)', background: 'var(--bg-surface1)', color: 'var(--fg-default)', font: 'var(--font-body-s-strong)', cursor: 'pointer' }}>
          Отмена
        </button>
        <button
          onClick={confirm}
          disabled={create.isPending}
          style={{ height: 40, padding: '0 20px', border: 0, borderRadius: 'var(--border-radius-buttons)', background: 'var(--accent-default)', color: '#fff', font: 'var(--font-body-s-strong)', cursor: 'pointer' }}
        >
          Создать черновик
        </button>
      </div>
    </>
  )
}

function AssignBody({
  interactionId,
  currentOwnerName,
  onClose,
  onDone,
}: {
  interactionId: number
  currentOwnerName: string | null
  onClose: () => void
  onDone: () => void
}) {
  const toast = useToast()
  const { data: pool, isLoading } = useAssignmentPool()
  const assign = useAssignInteraction()
  const [mgr, setMgr] = useState('')
  const [reason, setReason] = useState('')
  const [err, setErr] = useState('')

  const sorted = [...(pool ?? [])].sort((a, b) => a.capacity_used - b.capacity_used)
  const chosen = sorted.find((m) => m.id === mgr)
  const noRoom = !!chosen && chosen.capacity_used >= chosen.max_active_projects

  const confirm = () => {
    if (!mgr) return setErr('Выберите менеджера')
    assign.mutate(
      { id: interactionId, body: { manager_id: mgr, expected_owner_id: null, reason: reason.trim() || null } },
      {
        onSuccess: () => {
          toast({ title: 'Ответственный назначен', subtitle: `#${interactionId} · ${chosen ? personLabel(chosen) : ''}`, colorScheme: 'success' })
          onDone()
        },
        onError: (e) => setErr(e.message),
      },
    )
  }

  return (
    <>
      <span style={{ font: 'var(--font-heading-h3)', color: 'var(--fg-default)' }}>Назначить менеджера</span>
      <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-soft)' }}>
        #{interactionId}
        <br />
        Сейчас: <b style={{ fontWeight: 600, color: 'var(--fg-default)' }}>{currentOwnerName ?? 'нет владельца'}</b>. Менеджеры — сначала наименее
        загруженные.
      </span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {isLoading && <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-muted)' }}>Загрузка…</span>}
        {sorted.map((m) => {
          const sel = mgr === m.id
          const full = m.capacity_used >= m.max_active_projects
          return (
            <button
              key={m.id}
              onClick={() => setMgr(m.id)}
              style={{
                border: `1px solid ${sel ? 'var(--accent-default)' : 'var(--border-muted)'}`,
                background: sel ? 'var(--accent-container-muted)' : 'transparent',
                borderRadius: 'var(--border-radius-m)',
                padding: '10px 12px',
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                textAlign: 'left',
                cursor: 'pointer',
              }}
            >
              <span style={{ width: 14, height: 14, borderRadius: '50%', border: `2px solid ${sel ? 'var(--accent-default)' : 'var(--neutral-muted)'}`, background: sel ? 'var(--accent-default)' : 'transparent', flex: 'none' }} />
              <span style={{ flex: 1, font: 'var(--font-body-s-strong)', color: 'var(--fg-default)' }}>{personLabel(m)}</span>
              <span style={{ width: 90, height: 6, borderRadius: 3, background: 'var(--neutral-container-default)', overflow: 'hidden', flex: 'none' }}>
                <span style={{ display: 'block', width: `${Math.round((m.capacity_used / m.max_active_projects) * 100)}%`, height: '100%', background: full ? 'var(--warning-default)' : 'var(--fg-soft)' }} />
              </span>
              <span style={{ width: 40, textAlign: 'right', font: 'var(--font-description-l)', color: 'var(--fg-soft)', fontVariantNumeric: 'tabular-nums' }}>
                {m.capacity_used}/{m.max_active_projects}
              </span>
              <span
                style={{
                  height: 20,
                  padding: '0 6px',
                  borderRadius: 'var(--border-radius-s)',
                  background: full ? 'var(--warning-container-default)' : 'var(--success-container-default)',
                  font: 'var(--font-description-l-strong)',
                  color: 'var(--fg-default)',
                  display: 'flex',
                  alignItems: 'center',
                  whiteSpace: 'nowrap',
                }}
              >
                {full ? 'Занят: лимит' : 'Доступен'}
              </span>
            </button>
          )
        })}
      </div>
      {noRoom && (
        <div style={{ background: 'var(--warning-container-default)', borderRadius: 'var(--border-radius-m)', padding: '10px 12px', font: 'var(--font-body-s)', color: 'var(--fg-default)' }}>
          У выбранного менеджера нет свободных слотов — сервер откажет с ошибкой. Выберите другого.
        </div>
      )}
      <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ font: 'var(--font-description-l-strong)', color: 'var(--fg-soft)' }}>Причина (необязательно)</span>
        <textarea
          rows={2}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          style={{ resize: 'vertical', padding: 12, border: '1px solid var(--border-soft)', borderRadius: 'var(--border-radius-inputs)', background: 'var(--bg-surface1)', font: 'var(--font-body-s)', color: 'var(--fg-default)', outline: 0 }}
        />
      </label>
      {err && <span style={{ font: 'var(--font-body-s)', color: 'var(--error-default)' }}>{err}</span>}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button onClick={onClose} style={{ height: 40, padding: '0 20px', border: '1px solid var(--border-soft)', borderRadius: 'var(--border-radius-buttons)', background: 'var(--bg-surface1)', color: 'var(--fg-default)', font: 'var(--font-body-s-strong)', cursor: 'pointer' }}>
          Отмена
        </button>
        <button
          onClick={confirm}
          disabled={assign.isPending}
          style={{ height: 40, padding: '0 20px', border: 0, borderRadius: 'var(--border-radius-buttons)', background: 'var(--accent-default)', color: '#fff', font: 'var(--font-body-s-strong)', cursor: 'pointer' }}
        >
          Назначить
        </button>
      </div>
    </>
  )
}

function personLabel(m: { last_name: string; first_name: string; patronymic: string; username: string | null; id: string }): string {
  const name = [m.last_name, m.first_name, m.patronymic].filter(Boolean).join(' ')
  return name || m.username || m.id
}
