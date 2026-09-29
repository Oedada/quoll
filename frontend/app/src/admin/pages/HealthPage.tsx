import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useHealthChecks, type HealthRead } from '../../api/admin-health'
import { useInteractionStats } from '../../api/manager-dashboard'
import { useIntegrationRuns, type RunRead } from '../../api/integrations'
import { useNotifications } from '../../api/notifications'

const card: React.CSSProperties = {
  background: 'var(--bg-surface1)',
  border: '1px solid var(--border-muted)',
  borderRadius: 'var(--border-radius-l)',
  padding: 20,
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
}

// порядок, подписи и адресаты — «Сводка здоровья.dc.html», renderVals()
const CARD_DEFS: { key: keyof HealthRead; label: string; hint: string; page: string; cap: boolean }[] = [
  { key: 'failed_tasks', label: 'Упавшие задачи', hint: 'Фоновые действия, которые не удались после всех попыток', page: '/admin/org', cap: false },
  { key: 'tasks_waiting_over_3_days', label: 'Задачи в ожидании больше 3 дней', hint: 'Увольнения и смены ролей, которые зависли', page: '/admin/org', cap: false },
  { key: 'interactions_waiting_capacity_over_a_day', label: 'Ждут свободного места больше суток', hint: 'Пауза закончилась, а у КАМа нет свободного слота', page: '/admin/all', cap: false },
  { key: 'managers_without_supervisor_with_work', label: 'Менеджеры без руководителя с работой', hint: 'Их заявки некому вести — нужно усыновление', page: '/admin/all', cap: false },
  { key: 'capable_supervisers', label: 'Руководителей, способных работать', hint: 'Если ноль — заявки некому назначать и решать', page: '/admin/users', cap: true },
  { key: 'capable_admins', label: 'Администраторов, способных работать', hint: 'Если ноль — систему некому чинить', page: '/admin/users', cap: true },
]

const STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Черновик',
  AWAITING_ACCEPTANCE: 'Ждёт принятия',
  IN_PROGRESS: 'В работе',
  PAUSED: 'На паузе',
  SIGNED: 'Подписано',
  CLOSED: 'Закрыто',
}
const STATUS_ORDER = ['DRAFT', 'AWAITING_ACCEPTANCE', 'IN_PROGRESS', 'PAUSED', 'SIGNED', 'CLOSED']

const TRIGGER_LABELS: Record<string, string> = { SCHEDULE: 'по расписанию', MANUAL: 'вручную', FILE: 'файл' }

function runFlowLabel(flow: string): string {
  // И1/И2 — интеграционные потоки, Б1/Б2 — импорт файлов (backend/integrations/models.py: RunFlow)
  return flow.replace(/^I/, 'И').replace(/^B/, 'Б')
}

function formatRunWhen(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const mi = String(d.getMinutes()).padStart(2, '0')
  return `${dd}.${mm} ${hh}:${mi}`
}

export default function HealthPage() {
  const navigate = useNavigate()
  const { data: health } = useHealthChecks()
  const { data: stats } = useInteractionStats()
  const { data: runs } = useIntegrationRuns(6)
  const { data: notifs } = useNotifications()

  const cards = CARD_DEFS.map((d) => {
    const raw = health?.[d.key]
    const bad = raw === undefined ? false : d.cap ? raw === 0 : raw > 0
    return {
      ...d,
      value: raw === undefined ? '—' : String(raw),
      state: raw === undefined ? '' : bad ? 'Проблема' : 'Норма',
      bg: bad ? 'var(--error-container-default)' : 'var(--success-container-default)',
      color: bad ? 'var(--error-default)' : 'var(--fg-default)',
      border: bad ? 'var(--error-default)' : 'var(--border-muted)',
    }
  })

  const byStatus = STATUS_ORDER.map((k) => ({ key: k, label: STATUS_LABELS[k], n: stats?.by_status[k] ?? 0 }))
  const byStage = stats?.by_stage ?? []

  const crit = useMemo(() => (notifs ?? []).filter((n) => n.severity === 'CRITICAL' && !n.read_at), [notifs])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 16 }}>
        {cards.map((c) => (
          <button
            key={c.key}
            onClick={() => navigate(c.page)}
            style={{
              textAlign: 'left',
              background: 'var(--bg-surface1)',
              border: `1px solid ${c.border}`,
              borderRadius: 'var(--border-radius-l)',
              padding: 20,
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
              cursor: 'pointer',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <span style={{ font: 'var(--font-heading-h1)', color: c.color, fontVariantNumeric: 'tabular-nums' }}>{c.value}</span>
              {c.state && (
                <span style={{ height: 22, padding: '0 8px', borderRadius: 'var(--border-radius-m)', background: c.bg, font: 'var(--font-description-l-strong)', color: 'var(--fg-default)', display: 'flex', alignItems: 'center' }}>
                  {c.state}
                </span>
              )}
            </div>
            <span style={{ font: 'var(--font-body-s-strong)', color: 'var(--fg-default)' }}>{c.label}</span>
            <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)' }}>{c.hint}</span>
          </button>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 16, alignItems: 'start' }}>
        <section style={card}>
          <span style={{ font: 'var(--font-heading-h4)', color: 'var(--fg-default)' }}>Взаимодействия в системе</span>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {byStatus.map((x) => (
              <button
                key={x.key}
                onClick={() => navigate(`/admin/all?status=${x.key}`)}
                style={{ height: 28, padding: '0 10px', border: 0, borderRadius: 'var(--border-radius-m)', background: 'var(--neutral-container-soft)', font: 'var(--font-description-l-strong)', color: 'var(--fg-default)', display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}
              >
                {x.label}
                <span style={{ color: 'var(--fg-muted)', fontVariantNumeric: 'tabular-nums' }}>{x.n}</span>
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {byStage.map((x) => (
              <button
                key={x.stage_id}
                onClick={() => navigate(`/admin/all?stage_id=${x.stage_id}`)}
                style={{ height: 28, padding: '0 10px', border: '1px solid var(--border-muted)', borderRadius: 'var(--border-radius-m)', background: 'transparent', font: 'var(--font-description-l-strong)', color: 'var(--fg-soft)', display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}
              >
                {x.name}
                <span style={{ color: 'var(--fg-muted)', fontVariantNumeric: 'tabular-nums' }}>{x.count}</span>
              </button>
            ))}
          </div>
        </section>

        <section style={card}>
          <span style={{ font: 'var(--font-heading-h4)', color: 'var(--fg-default)' }}>Последние запуски интеграций</span>
          {(runs ?? []).map((r: RunRead) => (
            <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0', borderTop: '1px solid var(--border-muted)' }}>
              <span style={{ width: 36, flex: 'none', font: 'var(--font-body-s-strong)', color: 'var(--fg-default)' }}>{runFlowLabel(r.flow)}</span>
              <span style={{ flex: 1, minWidth: 0, font: 'var(--font-description-l)', color: 'var(--fg-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {formatRunWhen(r.started_at)} · {TRIGGER_LABELS[r.trigger] ?? r.trigger}
              </span>
              <span
                style={{
                  height: 22,
                  padding: '0 8px',
                  borderRadius: 'var(--border-radius-m)',
                  background: r.status === 'FAILED' ? 'var(--error-container-default)' : 'var(--success-container-default)',
                  font: 'var(--font-description-l-strong)',
                  color: 'var(--fg-default)',
                  display: 'flex',
                  alignItems: 'center',
                }}
              >
                {r.status === 'FAILED' ? 'Ошибка' : 'Готово'}
              </span>
            </div>
          ))}
          {runs && runs.length === 0 && <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-muted)' }}>Запусков ещё не было</span>}
        </section>
      </div>

      <section style={card}>
        <span style={{ font: 'var(--font-heading-h4)', color: 'var(--fg-default)' }}>Непрочитанные критичные уведомления</span>
        {crit.map((n) => (
          // дизайн добавляет "· кто вызвал", но actor_id — это uuid без имени в NotificationRead, пропускаем
          <div key={n.id} style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '10px 0', borderTop: '1px solid var(--border-muted)' }}>
            <span style={{ font: 'var(--font-body-s-strong)', color: 'var(--fg-default)' }}>{n.title}</span>
            <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-soft)' }}>{n.body}</span>
          </div>
        ))}
        {crit.length === 0 && <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-muted)' }}>Критичных уведомлений нет</span>}
      </section>
    </div>
  )
}
