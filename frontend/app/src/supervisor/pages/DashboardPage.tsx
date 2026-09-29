import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTeam, usePendingActions, type ManagerLoadRead } from '../../api/org'
import { useInteractions } from '../../api/interactions'
import { useInteractionStats } from '../../api/manager-dashboard'
import { useNotifications } from '../../api/notifications'
import { useProposals } from '../../api/integrations'

const card: React.CSSProperties = {
  background: 'var(--bg-surface1)',
  border: '1px solid var(--border-muted)',
  borderRadius: 'var(--border-radius-l)',
  padding: 20,
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
}

// порядок и подписи — «Руководитель - Оболочка.dc.html», STATUS_CARDS
const STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Черновик',
  AWAITING_ACCEPTANCE: 'Ждёт принятия',
  IN_PROGRESS: 'В работе',
  PAUSED: 'На паузе',
  SIGNED: 'Подписано',
  CLOSED: 'Закрыто',
}
const STATUS_ORDER = ['DRAFT', 'AWAITING_ACCEPTANCE', 'IN_PROGRESS', 'PAUSED', 'SIGNED', 'CLOSED']

// незавершённые задачи очереди оргдействий (auth/pending_actions.py: _ACTIVE_STATUS_SQL)
const ACTIVE_PENDING_ACTION_STATUSES = new Set(['PENDING', 'IN_PROGRESS'])

export default function DashboardPage() {
  const navigate = useNavigate()
  const { data: stats } = useInteractionStats()
  const { data: team } = useTeam()
  const { data: pendingActions } = usePendingActions()
  const { data: proposals } = useProposals('PENDING')
  const { data: notifs } = useNotifications()
  // без responsible_id — для руководителя readable_filter отдаёт всю команду
  // (backend/interactions/access_policy.py: readable_filter для SUPERVISER)
  const { data: teamInteractions } = useInteractions({ limit: 100 })

  const activePendingActions = (pendingActions ?? []).filter((a) => ACTIVE_PENDING_ACTION_STATUSES.has(a.status))

  const cards = [
    {
      value: stats?.pending_requests ?? '—',
      label: 'Просьбы к решению',
      hint: 'Ждут вашего решения',
      color: 'var(--accent-default)',
      go: () => navigate('/supervisor/requests'),
    },
    {
      value: stats?.by_status.DRAFT ?? '—',
      label: 'Черновики без назначения',
      hint: 'Ждут владельца, включая осиротевшие',
      color: 'var(--fg-default)',
      go: () => navigate('/supervisor/alloc'),
    },
    {
      value: proposals?.length ?? '—',
      label: 'Предложения интеграции',
      hint: 'Ждут решения',
      color: 'var(--fg-default)',
      go: () => navigate('/supervisor/proposals'),
    },
    {
      value: activePendingActions.length,
      label: 'Ожидающие действия',
      hint: 'Оргизменения команды в очереди',
      color: activePendingActions.length > 0 ? 'var(--error-default)' : 'var(--fg-default)',
      go: () => navigate('/supervisor/team'),
    },
  ]

  const svStatus = STATUS_ORDER.map((k) => ({ key: k, label: STATUS_LABELS[k], n: stats?.by_status[k] ?? 0 }))
  const svStages = stats?.by_stage ?? []

  const svNotifs = useMemo(() => (notifs ?? []).slice(0, 3), [notifs])

  const stalled = useMemo(() => {
    const rows = (teamInteractions?.items ?? []).filter((r) => r.stall_since)
    return rows
      .map((r) => ({ row: r, days: daysSince(r.stall_since as string) }))
      .sort((a, b) => b.days - a.days)
      .slice(0, 5)
  }, [teamInteractions])

  const upcoming = useMemo(() => {
    const rows = (teamInteractions?.items ?? []).filter((r) => r.planned_date && !r.closed_at)
    return rows
      .map((r) => ({ row: r, left: daysUntil(r.planned_date as string) }))
      .filter((x) => x.left >= 0)
      .sort((a, b) => a.left - b.left)
      .slice(0, 5)
  }, [teamInteractions])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,minmax(0,1fr))', gap: 16 }}>
        {cards.map((c) => (
          <button
            key={c.label}
            onClick={c.go}
            style={{
              textAlign: 'left',
              background: 'var(--bg-surface1)',
              border: '1px solid var(--border-muted)',
              borderRadius: 'var(--border-radius-l)',
              padding: 20,
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
              cursor: 'pointer',
            }}
          >
            <span style={{ font: 'var(--font-heading-h1)', color: c.color, fontVariantNumeric: 'tabular-nums' }}>{c.value}</span>
            <span style={{ font: 'var(--font-body-s-strong)', color: 'var(--fg-default)' }}>{c.label}</span>
            <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)' }}>{c.hint}</span>
          </button>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,6fr) minmax(0,6fr)', gap: 16, alignItems: 'start' }}>
        <section style={card}>
          <span style={{ font: 'var(--font-heading-h4)', color: 'var(--fg-default)' }}>Нагрузка команды</span>
          {(team?.members ?? []).map((m) => (
            <TeamRow key={m.id} m={m} />
          ))}
          {team && team.members.length === 0 && (
            <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-muted)' }}>В команде пока никого нет</span>
          )}
          <button
            onClick={() => navigate('/supervisor/team')}
            style={{ alignSelf: 'flex-start', border: 0, background: 'transparent', padding: 0, font: 'var(--font-body-s-strong)', color: 'var(--accent-default)', cursor: 'pointer' }}
          >
            Открыть команду
          </button>
        </section>

        <section style={card}>
          <span style={{ font: 'var(--font-heading-h4)', color: 'var(--fg-default)' }}>
            Взаимодействия команды <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)' }}>· по статусам и этапам</span>
          </span>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {svStatus.map((x) => (
              <button
                key={x.key}
                onClick={() => navigate(`/supervisor/interactions?status=${x.key}`)}
                style={{
                  height: 28,
                  padding: '0 10px',
                  border: 0,
                  borderRadius: 'var(--border-radius-m)',
                  background: 'var(--neutral-container-soft)',
                  font: 'var(--font-description-l-strong)',
                  color: 'var(--fg-default)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  cursor: 'pointer',
                }}
              >
                {x.label}
                <span style={{ color: 'var(--fg-muted)', fontVariantNumeric: 'tabular-nums' }}>{x.n}</span>
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {svStages.map((x) => (
              <button
                key={x.stage_id}
                onClick={() => navigate(`/supervisor/interactions?stage_id=${x.stage_id}`)}
                style={{
                  height: 28,
                  padding: '0 10px',
                  border: '1px solid var(--border-muted)',
                  borderRadius: 'var(--border-radius-m)',
                  background: 'transparent',
                  font: 'var(--font-description-l-strong)',
                  color: 'var(--fg-soft)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  cursor: 'pointer',
                }}
              >
                {x.name}
                <span style={{ color: 'var(--fg-muted)', fontVariantNumeric: 'tabular-nums' }}>{x.count}</span>
              </button>
            ))}
          </div>
        </section>

        <section style={card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ font: 'var(--font-heading-h4)', color: 'var(--fg-default)' }}>Последние уведомления</span>
          </div>
          {svNotifs.map((n) => (
            <button
              key={n.id}
              onClick={() => n.interaction_id && navigate(`/supervisor/interactions/${n.interaction_id}`)}
              style={{
                border: 0,
                borderTop: '1px solid var(--border-muted)',
                background: 'transparent',
                padding: '10px 0',
                display: 'flex',
                flexDirection: 'column',
                gap: 2,
                textAlign: 'left',
                cursor: n.interaction_id ? 'pointer' : 'default',
              }}
            >
              <span style={{ font: 'var(--font-body-s-strong)', color: 'var(--fg-default)' }}>{n.title}</span>
              <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-soft)' }}>{n.body}</span>
            </button>
          ))}
          {svNotifs.length === 0 && <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-muted)' }}>Уведомлений нет</span>}
        </section>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
          <section style={card}>
            <span style={{ font: 'var(--font-heading-h4)', color: 'var(--fg-default)' }}>Зависли у команды</span>
            {stalled.map(({ row, days }) => (
              <button
                key={row.id}
                onClick={() => navigate(`/supervisor/interactions/${row.id}`)}
                style={{
                  border: 0,
                  borderTop: '1px solid var(--border-muted)',
                  background: 'transparent',
                  padding: '10px 0',
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 12,
                  textAlign: 'left',
                  cursor: 'pointer',
                }}
              >
                <span style={{ display: 'flex', flexDirection: 'column' }}>
                  <span style={{ font: 'var(--font-body-s-strong)', color: 'var(--fg-default)' }}>{row.university.name}</span>
                  <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)' }}>{row.stage?.name ?? '—'}</span>
                </span>
                <span style={{ font: 'var(--font-description-l-strong)', color: 'var(--error-default)', whiteSpace: 'nowrap' }}>{days} дн.</span>
              </button>
            ))}
            {stalled.length === 0 && <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-muted)' }}>Зависших нет</span>}
          </section>

          <section style={card}>
            <span style={{ font: 'var(--font-heading-h4)', color: 'var(--fg-default)' }}>Ближайшие сроки</span>
            {upcoming.map(({ row, left }) => (
              <button
                key={row.id}
                onClick={() => navigate(`/supervisor/interactions/${row.id}`)}
                style={{
                  border: 0,
                  borderTop: '1px solid var(--border-muted)',
                  background: 'transparent',
                  padding: '10px 0',
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 12,
                  textAlign: 'left',
                  cursor: 'pointer',
                }}
              >
                <span style={{ display: 'flex', flexDirection: 'column' }}>
                  <span style={{ font: 'var(--font-body-s-strong)', color: 'var(--fg-default)' }}>{row.university.name}</span>
                  <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)' }}>Плановая дата · {formatDate(row.planned_date as string)}</span>
                </span>
                <span
                  style={{
                    height: 22,
                    padding: '0 8px',
                    borderRadius: 'var(--border-radius-m)',
                    background: left <= 3 ? 'var(--warning-container-default)' : 'var(--neutral-container-default)',
                    font: 'var(--font-description-l-strong)',
                    color: 'var(--fg-default)',
                    display: 'flex',
                    alignItems: 'center',
                  }}
                >
                  {left} дн.
                </span>
              </button>
            ))}
            {upcoming.length === 0 && <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-muted)' }}>Ближайших сроков нет</span>}
          </section>
        </div>
      </div>
    </div>
  )
}

function TeamRow({ m }: { m: ManagerLoadRead }) {
  const used = m.capacity_used
  const max = m.max_active_projects
  const pct = max ? Math.round((used / max) * 100) : 0
  const bar = m.effective_status === 'UNAVAILABLE' ? 'var(--error-default)' : m.effective_status === 'SATURATED' ? 'var(--warning-default)' : 'var(--fg-soft)'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <span style={{ width: 130, flex: 'none', font: 'var(--font-body-s)', color: 'var(--fg-default)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {shortName(m)}
      </span>
      <div style={{ flex: 1, height: 8, borderRadius: 4, background: 'var(--neutral-container-default)', overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: bar }} />
      </div>
      <span style={{ width: 44, textAlign: 'right', font: 'var(--font-description-l)', color: 'var(--fg-soft)', fontVariantNumeric: 'tabular-nums' }}>
        {used} / {max}
      </span>
    </div>
  )
}

function shortName(m: ManagerLoadRead): string {
  const initials = [m.first_name, m.patronymic].filter(Boolean).map((x) => `${x[0]}.`).join(' ')
  return [m.last_name, initials].filter(Boolean).join(' ') || m.username || m.id
}

function daysSince(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000))
}

function daysUntil(iso: string): number {
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000)
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' })
}
