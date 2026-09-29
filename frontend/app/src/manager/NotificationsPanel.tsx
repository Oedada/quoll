import { useNavigate } from 'react-router-dom'
import { useMarkRead, useNotifications, type NotificationRead } from '../api/notifications'
import { Atomaro } from '../ds/atomaro'

const SEV: Record<string, { tint: string; ink: string; label: string }> = {
  INFO: { tint: 'var(--neutral-container-default)', ink: 'var(--fg-soft)', label: 'Инфо' },
  WARNING: { tint: 'var(--warning-container-default)', ink: 'var(--warning-default)', label: 'Важно' },
  CRITICAL: { tint: 'var(--error-container-default)', ink: 'var(--error-default)', label: 'Критично' },
}

function dayLabel(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (sameDay) return 'Сегодня'
  if (d.toDateString() === yesterday.toDateString()) return 'Вчера'
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })
}

export function NotificationsPanel({ onClose }: { onClose: () => void }) {
  const { data: notifications, isLoading } = useNotifications()
  const markRead = useMarkRead()
  const navigate = useNavigate()

  const items = notifications ?? []
  const groups = new Map<string, NotificationRead[]>()
  for (const n of items) {
    const label = dayLabel(n.created_at)
    if (!groups.has(label)) groups.set(label, [])
    groups.get(label)!.push(n)
  }

  const open = (n: NotificationRead) => {
    if (!n.read_at) markRead.mutate({ ids: [n.id] })
    onClose()
    if (n.interaction_id) navigate(`/manager/interactions/${n.interaction_id}`)
  }

  return (
    <section
      style={{
        position: 'absolute',
        zIndex: 10,
        top: 60,
        right: 20,
        width: 440,
        maxHeight: 700,
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--bg-elevated-l)',
        boxShadow: 'var(--shadow-bottom-xl)',
        border: '1px solid var(--border-muted)',
        borderRadius: 'var(--border-radius-xl)',
        overflow: 'hidden',
      }}
    >
      <div style={{ padding: '16px 16px 8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ font: 'var(--font-heading-h5)', color: 'var(--fg-default)' }}>Уведомления</span>
        {items.some((n) => !n.read_at) && (
          <button
            onClick={() => markRead.mutate({ all: true })}
            style={{ border: 0, background: 'transparent', color: 'var(--fg-soft)', font: 'var(--font-description-l-strong)', cursor: 'pointer' }}
          >
            Прочитать всё
          </button>
        )}
      </div>

      <div style={{ overflowY: 'auto', padding: '0 8px 8px' }}>
        {isLoading && <div style={{ padding: 16 }}><Atomaro.Loader size="s" /></div>}
        {!isLoading && items.length === 0 && (
          <div style={{ padding: '32px 16px', textAlign: 'center', font: 'var(--font-body-s)', color: 'var(--fg-muted)' }}>
            Всё прочитано
          </div>
        )}
        {[...groups.entries()].map(([label, group]) => (
          <div key={label} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <div style={{ padding: '8px 8px 4px', font: 'var(--font-description-l-strong)', color: 'var(--fg-muted)' }}>{label}</div>
            {group.map((n) => {
              const sev = SEV[n.severity] ?? SEV.INFO
              return (
                <button
                  key={n.id}
                  onClick={() => open(n)}
                  style={{
                    border: 0,
                    background: n.read_at ? 'transparent' : 'var(--accent-container-muted)',
                    borderRadius: 'var(--border-radius-m)',
                    padding: 8,
                    display: 'flex',
                    gap: 10,
                    cursor: 'pointer',
                    textAlign: 'left',
                    width: '100%',
                  }}
                >
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: sev.ink, flex: 'none', marginTop: 6 }} />
                  <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                      <span style={{ font: 'var(--font-body-s-strong)', color: 'var(--fg-default)' }}>{n.title}</span>
                      <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)', whiteSpace: 'nowrap' }}>
                        {new Date(n.created_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-soft)' }}>{n.body}</span>
                  </div>
                </button>
              )
            })}
          </div>
        ))}
      </div>
    </section>
  )
}
