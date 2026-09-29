import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useToast } from '../../manager/ToastContext'
import { useMe } from '../../auth/useMe'
import {
  useTeam,
  useAvailableTeamQuota,
  useTransferManager,
  useReleaseManager,
  usePendingActions,
  type ManagerLoadRead,
  type EffectiveStatus,
  type SupervisorQuotaRead,
} from '../../api/org'
import { useInteractions } from '../../api/interactions'
import { usePeople, personFullName } from '../../api/people'

const card: React.CSSProperties = {
  background: 'var(--bg-surface1)',
  border: '1px solid var(--border-muted)',
  borderRadius: 'var(--border-radius-l)',
  padding: '8px 16px 16px',
  display: 'flex',
  flexDirection: 'column',
}

const TEAM_COLS = 'minmax(160px,1.3fr) minmax(120px,.9fr) minmax(110px,.8fr) minmax(150px,1.1fr) minmax(110px,.8fr) 240px'
const PENDING_COLS = 'minmax(140px,1fr) minmax(140px,1fr) minmax(110px,.8fr) 80px minmax(130px,1fr) minmax(180px,1.4fr)'

const ST_TONE: Record<EffectiveStatus, [string, string]> = {
  AVAILABLE: ['var(--success-container-default)', 'var(--success-default)'],
  SATURATED: ['var(--warning-container-default)', 'var(--warning-default)'],
  UNAVAILABLE: ['var(--neutral-container-default)', 'var(--neutral-muted)'],
  INACTIVE: ['var(--neutral-container-default)', 'var(--neutral-muted)'],
}
const ST_LABEL: Record<EffectiveStatus, string> = {
  AVAILABLE: 'Доступен',
  SATURATED: 'Занят: лимит',
  UNAVAILABLE: 'Недоступен',
  INACTIVE: 'Неактивен',
}
const MANUAL_LABEL: Record<'available' | 'unavailable', string> = {
  available: 'Готов',
  unavailable: 'Недоступен',
}

const STATUS_LABEL: Record<string, string> = {
  IN_PROGRESS: 'В работе',
  PAUSED: 'На паузе',
  SIGNED: 'Подписано',
}

const PENDING_STATUS_LABEL: Record<string, string> = {
  PENDING: 'Ожидает',
  RETRYING: 'Повтор',
  DONE: 'Выполнено',
  FAILED: 'Не удалось',
}

function personName(p: { first_name: string; last_name: string; patronymic: string; username?: string | null; id?: string }): string {
  return [p.last_name, p.first_name, p.patronymic].filter(Boolean).join(' ') || p.username || p.id || '—'
}

function fmtDate(s: string | null): string {
  if (!s) return '—'
  const d = new Date(s)
  return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

type Dlg = { kind: 'transfer' | 'release'; manager: ManagerLoadRead }

export default function TeamPage() {
  const navigate = useNavigate()
  const toast = useToast()
  const { data: me } = useMe()
  const { data: team, isLoading } = useTeam()
  const { data: pending } = usePendingActions()
  const [openRows, setOpenRows] = useState<Record<string, boolean>>({})
  const [dlg, setDlg] = useState<Dlg | null>(null)

  const members = team?.members ?? []
  const { data: pendingTargets } = usePeople((pending ?? []).map((a) => a.target_id))
  const targetName = (id: string) => {
    const p = pendingTargets?.find((x) => x.id === id)
    return p ? personFullName(p) : id
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
      <section style={card}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, padding: '12px 8px 4px' }}>
          <span style={{ font: 'var(--font-heading-h4)', color: 'var(--fg-default)' }}>
            Менеджеры команды{' '}
            <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)' }}>
              · {members.length} из {team?.max_subordinates ?? '—'}
            </span>
          </span>
          <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)' }}>Максимум задаёт администратор</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: TEAM_COLS, gap: 16, padding: '12px 8px 8px', font: 'var(--font-description-l)', color: 'var(--fg-muted)' }}>
          <span>Менеджер</span>
          <span>Статус</span>
          <span>Ручной статус</span>
          <span>Слоты</span>
          <span>Открытых / блокирующих</span>
          <span />
        </div>
        {isLoading && <span style={{ padding: '16px 8px', font: 'var(--font-body-s)', color: 'var(--fg-muted)' }}>Загрузка…</span>}
        {!isLoading && members.length === 0 && (
          <span style={{ padding: '16px 8px', font: 'var(--font-body-s)', color: 'var(--fg-muted)' }}>В команде нет менеджеров</span>
        )}
        {members.map((m) => (
          <TeamRow
            key={m.id}
            m={m}
            open={!!openRows[m.id]}
            onToggle={() => setOpenRows((s) => ({ ...s, [m.id]: !s[m.id] }))}
            onOpenInteraction={(id) => navigate(`/supervisor/interactions/${id}`)}
            onTransfer={() => setDlg({ kind: 'transfer', manager: m })}
            onRelease={() => setDlg({ kind: 'release', manager: m })}
          />
        ))}
      </section>

      <section style={card}>
        <div style={{ padding: '12px 8px 4px', display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ font: 'var(--font-heading-h4)', color: 'var(--fg-default)' }}>Ожидающие действия</span>
          <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)' }}>
            Фоновые задачи после увольнения или смены роли. Повторы выполняются автоматически.
          </span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: PENDING_COLS, gap: 16, padding: '12px 8px 8px', font: 'var(--font-description-l)', color: 'var(--fg-muted)' }}>
          <span>Действие</span>
          <span>Кого касается</span>
          <span>Статус</span>
          <span>Попыток</span>
          <span>Следующая попытка</span>
          <span>Ошибка</span>
        </div>
        {(pending ?? []).map((a) => {
          const done = a.status === 'DONE'
          const [bg] = done ? ST_TONE.AVAILABLE : ST_TONE.SATURATED
          return (
            <div
              key={a.id}
              style={{ display: 'grid', gridTemplateColumns: PENDING_COLS, gap: 16, padding: '12px 8px', borderTop: '1px solid var(--border-muted)', alignItems: 'start' }}
            >
              <span style={{ font: 'var(--font-body-s-strong)', color: 'var(--fg-default)' }}>{a.action_type}</span>
              <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-default)' }}>{targetName(a.target_id)}</span>
              <span style={{ height: 22, padding: '0 8px', borderRadius: 'var(--border-radius-m)', background: bg, font: 'var(--font-description-l-strong)', color: 'var(--fg-default)', display: 'flex', alignItems: 'center', justifySelf: 'start' }}>
                {PENDING_STATUS_LABEL[a.status] ?? a.status}
              </span>
              <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-default)', fontVariantNumeric: 'tabular-nums' }}>{a.retry_count}</span>
              <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-soft)' }}>{fmtDate(a.next_retry_at)}</span>
              <span style={{ font: 'var(--font-description-l)', color: 'var(--error-default)', textWrap: 'pretty' as any }}>{a.last_error ?? ''}</span>
            </div>
          )
        })}
        {(pending ?? []).length === 0 && (
          <span style={{ padding: '16px 8px', font: 'var(--font-body-s)', color: 'var(--fg-muted)' }}>Ожидающих действий нет</span>
        )}
      </section>

      {dlg && (
        <ConfirmDialog
          dlg={dlg}
          supervisorId={me?.id}
          onClose={() => setDlg(null)}
          onToast={toast}
        />
      )}
    </div>
  )
}

function TeamRow({
  m,
  open,
  onToggle,
  onOpenInteraction,
  onTransfer,
  onRelease,
}: {
  m: ManagerLoadRead
  open: boolean
  onToggle: () => void
  onOpenInteraction: (id: number) => void
  onTransfer: () => void
  onRelease: () => void
}) {
  const { data: items, isLoading } = useInteractions({ responsible_id: m.id, limit: 50 })
  const pct = m.max_active_projects > 0 ? Math.round((m.capacity_used / m.max_active_projects) * 100) : 0
  const [bg, dot] = ST_TONE[m.effective_status]

  return (
    <div style={{ borderTop: '1px solid var(--border-muted)' }}>
      <div
        onClick={onToggle}
        style={{ display: 'grid', gridTemplateColumns: TEAM_COLS, gap: 16, padding: '12px 8px', alignItems: 'center', cursor: 'pointer' }}
      >
        <span style={{ display: 'flex', flexDirection: 'column' }}>
          <span style={{ font: 'var(--font-body-s-strong)', color: 'var(--fg-default)' }}>{personName(m)}</span>
          <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)' }}>{open ? '▾' : '▸'} взаимодействия</span>
        </span>
        <span style={{ height: 22, padding: '0 8px', borderRadius: 'var(--border-radius-m)', background: bg, font: 'var(--font-description-l-strong)', color: 'var(--fg-default)', display: 'flex', alignItems: 'center', gap: 6, justifySelf: 'start' }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: dot }} />
          {ST_LABEL[m.effective_status]}
        </span>
        <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-soft)' }}>{MANUAL_LABEL[m.manual_workload_status]}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ flex: 1, height: 6, borderRadius: 3, background: 'var(--neutral-container-default)', overflow: 'hidden' }}>
            <div style={{ width: `${pct}%`, height: '100%', background: m.capacity_used >= m.max_active_projects ? 'var(--warning-default)' : 'var(--fg-soft)' }} />
          </div>
          <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-soft)', fontVariantNumeric: 'tabular-nums' }}>
            {m.capacity_used} / {m.max_active_projects}
          </span>
        </div>
        <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-default)', fontVariantNumeric: 'tabular-nums' }}>
          {m.open_projects} / {m.blocking_projects}
        </span>
        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
          <button
            onClick={(e) => {
              e.stopPropagation()
              onTransfer()
            }}
            style={{ height: 32, padding: '0 10px', border: '1px solid var(--border-soft)', borderRadius: 'var(--border-radius-buttons)', background: 'var(--bg-surface1)', color: 'var(--fg-default)', font: 'var(--font-body-s-strong)', cursor: 'pointer', whiteSpace: 'nowrap' }}
          >
            Передать
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation()
              onRelease()
            }}
            style={{ height: 32, padding: '0 10px', border: '1px solid var(--border-soft)', borderRadius: 'var(--border-radius-buttons)', background: 'var(--bg-surface1)', color: 'var(--error-default)', font: 'var(--font-body-s-strong)', cursor: 'pointer' }}
          >
            Освободить
          </button>
        </div>
      </div>
      {open && (
        <div style={{ padding: '0 8px 12px 24px', display: 'flex', flexDirection: 'column', gap: 2 }}>
          {isLoading && <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)' }}>Загрузка…</span>}
          {!isLoading && (items?.items.length ?? 0) === 0 && (
            <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)' }}>У менеджера нет взаимодействий</span>
          )}
          {items?.items.map((i) => (
            <div
              key={i.id}
              style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '6px 0', borderTop: '1px solid var(--border-muted)' }}
            >
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  onOpenInteraction(i.id)
                }}
                style={{ font: 'var(--font-body-s-strong)', color: 'var(--fg-default)' }}
              >
                {i.university.name} <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)' }}>#{i.id}</span>
              </a>
              <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-soft)' }}>{STATUS_LABEL[i.status] ?? i.status}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function ConfirmDialog({
  dlg,
  supervisorId,
  onClose,
  onToast,
}: {
  dlg: Dlg
  supervisorId: string | undefined
  onClose: () => void
  onToast: ReturnType<typeof useToast>
}) {
  const { data: quota } = useAvailableTeamQuota()
  const transfer = useTransferManager()
  const release = useReleaseManager()
  const [target, setTarget] = useState<SupervisorQuotaRead | null>(null)

  const m = dlg.manager
  const isTransfer = dlg.kind === 'transfer'
  const busy = transfer.isPending || release.isPending

  const title = isTransfer ? 'Передать другому руководителю' : 'Освободить менеджера'
  const text = isTransfer
    ? `${personName(m)} уйдёт со всеми взаимодействиями (открытых: ${m.open_projects}). Выберите руководителя со свободным местом в штате.`
    : `${personName(m)} уйдёт в пул свободных менеджеров. Открытых взаимодействий: ${m.open_projects}, блокирующих: ${m.blocking_projects} — они останутся у него, а другой руководитель сможет взять его в команду.`

  const confirm = () => {
    if (!supervisorId) return
    if (isTransfer) {
      if (!target) return
      transfer.mutate(
        { managerId: m.id, toSuperviserId: target.id, expectedSuperviserId: supervisorId },
        {
          onSuccess: () => {
            onToast({ title: 'Менеджер передан', subtitle: personName(m) })
            onClose()
          },
          onError: () => onToast({ title: 'Не удалось передать менеджера', colorScheme: 'error' }),
        },
      )
    } else {
      release.mutate(
        { managerId: m.id, expectedSuperviserId: supervisorId },
        {
          onSuccess: () => {
            onToast({ title: 'Менеджер освобождён', subtitle: personName(m) })
            onClose()
          },
          onError: () => onToast({ title: 'Не удалось освободить менеджера', colorScheme: 'error' }),
        },
      )
    }
  }

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
          width: 480,
          maxWidth: 'calc(100vw - 32px)',
          background: 'var(--bg-elevated-xl)',
          borderRadius: 'var(--border-radius-xl)',
          boxShadow: 'var(--shadow-bottom-xl)',
          padding: 24,
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}
      >
        <span style={{ font: 'var(--font-heading-h3)', color: 'var(--fg-default)' }}>{title}</span>
        <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-soft)', textWrap: 'pretty' as any }}>{text}</span>
        {isTransfer && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {(quota ?? []).map((t) => {
              const picked = target?.id === t.id
              const disabled = t.free_places <= 0
              return (
                <button
                  key={t.id}
                  onClick={() => !disabled && setTarget(t)}
                  disabled={disabled}
                  style={{
                    border: `1px solid ${picked ? 'var(--accent-default)' : 'var(--border-muted)'}`,
                    background: picked ? 'var(--accent-container-muted)' : 'transparent',
                    borderRadius: 'var(--border-radius-m)',
                    padding: '10px 12px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    textAlign: 'left',
                    cursor: disabled ? 'default' : 'pointer',
                    opacity: disabled ? 0.4 : 1,
                  }}
                >
                  <span
                    style={{
                      width: 14,
                      height: 14,
                      borderRadius: '50%',
                      border: `2px solid ${picked ? 'var(--accent-default)' : 'var(--neutral-muted)'}`,
                      background: picked ? 'var(--accent-default)' : 'transparent',
                      flex: 'none',
                    }}
                  />
                  <span style={{ flex: 1, font: 'var(--font-body-s-strong)', color: 'var(--fg-default)' }}>{personName(t)}</span>
                  <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-soft)' }}>свободно мест: {t.free_places}</span>
                </button>
              )
            })}
            {(quota ?? []).length === 0 && (
              <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)' }}>Нет руководителей со свободными местами</span>
            )}
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button
            onClick={onClose}
            style={{ height: 40, padding: '0 20px', border: '1px solid var(--border-soft)', borderRadius: 'var(--border-radius-buttons)', background: 'var(--bg-surface1)', color: 'var(--fg-default)', font: 'var(--font-body-s-strong)', cursor: 'pointer' }}
          >
            Отмена
          </button>
          <button
            onClick={confirm}
            disabled={busy || (isTransfer && !target)}
            style={{
              height: 40,
              padding: '0 20px',
              border: 0,
              borderRadius: 'var(--border-radius-buttons)',
              background: 'var(--accent-default)',
              color: '#fff',
              font: 'var(--font-body-s-strong)',
              cursor: 'pointer',
              opacity: busy || (isTransfer && !target) ? 0.5 : 1,
            }}
          >
            {isTransfer ? 'Передать' : 'Освободить'}
          </button>
        </div>
      </div>
    </>
  )
}
