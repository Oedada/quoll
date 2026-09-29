import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMe } from '../../auth/useMe'
import { useToast } from '../ToastContext'
import { Atomaro } from '../../ds/atomaro'
import { useProfile } from '../../api/org'
import { useInteractions, useCreateInteractionDraft } from '../../api/interactions'
import { useNotifications, type NotificationRead } from '../../api/notifications'
import { useInteractionStats, usePassiveCount } from '../../api/manager-dashboard'
import { useUniversities } from '../../api/catalog'
import { usePrograms } from '../../api/catalog-extra'

// иконка по типу уведомления — те же типы, что в панели уведомлений (Menedzher - Oboloch.dc.html: TYPES)
const NOTIF_ICON: Record<string, string> = {
  INTERACTION_ASSIGNED: 'MailInbox',
  STALL: 'TimeStroke',
  REQUEST_DECIDED: 'CheckLarge',
  COMMENT_TO_OWNER: 'DocumentText',
  PAUSE_ENDED: 'TimeStroke',
  LICENSE_EXPIRING: 'DocumentText',
  CONTRACT_EXPIRING: 'DocumentText',
  MOVED_TO_PASSIVE: 'Undo',
}
const SEV_TINT: Record<string, [string, string]> = {
  INFO: ['var(--neutral-container-default)', 'var(--fg-soft)'],
  WARNING: ['var(--warning-container-default)', 'var(--warning-default)'],
  CRITICAL: ['var(--error-container-default)', 'var(--error-default)'],
}

const card: React.CSSProperties = {
  background: 'var(--bg-surface1)',
  border: '1px solid var(--border-muted)',
  borderRadius: 'var(--border-radius-l)',
}

// «Сегодня»: в дизайне это мок без бэкенда (нет моделей календаря/задач в API) —
// показываем виджет как в «Менеджер - Оболочка.dc.html», с тем же иллюстративным
// содержимым; переключение задач — только локальное состояние, не сохраняется.
const TODAY_EVENTS = [
  { time: '10:00', range: '10:00–11:00', title: 'Встреча с вузом', who: 'Контактное лицо вуза' },
  { time: '13:30', range: '13:30–14:00', title: 'Созвон с вузом', who: 'Контактное лицо вуза' },
  { time: '16:00', range: '16:00–17:00', title: 'Встреча в вузе', who: 'Контактное лицо вуза' },
]
const TODAY_TASKS = ['Отправить программу курса в вуз', 'Подготовить договор оферты', 'Позвонить по продлению паузы']
const TODAY_LABEL = new Intl.DateTimeFormat('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date())

export default function DashboardPage() {
  const navigate = useNavigate()
  const toast = useToast()
  const { data: me } = useMe()
  const { data: profile } = useProfile(me?.id)
  const { data: stats } = useInteractionStats()
  const { data: passive } = usePassiveCount(me?.id)
  const { data: notifs } = useNotifications()
  const { data: mine, isLoading: stalledLoading } = useInteractions({ responsible_id: me?.id, limit: 100 })
  const [draftOpen, setDraftOpen] = useState(false)
  const [taskDone, setTaskDone] = useState<Record<number, boolean>>({})

  const load = profile?.load
  const used = load?.capacity_used ?? 0
  const max = load?.max_active_projects ?? 0
  const free = Math.max(0, max - used)
  const slotColor =
    load?.effective_status === 'UNAVAILABLE'
      ? 'var(--error-default)'
      : load?.effective_status === 'SATURATED'
        ? 'var(--warning-default)'
        : 'var(--neutral-muted)'

  const statTiles = stats
    ? [
        { value: String(passive ?? '—'), label: 'Пассивные' },
        { value: String(stats.by_status.PAUSED ?? 0), label: 'На паузе' },
        { value: String(stats.pending_requests), label: 'Просьбы' },
      ]
    : []

  const unread = useMemo(
    () => (notifs ?? []).filter((n) => !n.read_at).sort((a, b) => b.created_at.localeCompare(a.created_at)),
    [notifs],
  )
  const feed = unread.slice(0, 5)

  const stalled = useMemo(() => {
    const rows = (mine?.items ?? []).filter((r) => r.stall_since)
    return rows
      .map((r) => ({ row: r, days: daysSince(r.stall_since as string) }))
      .sort((a, b) => b.days - a.days)
      .slice(0, 5)
  }, [mine])

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,4fr) minmax(0,8fr)', gap: 16, alignItems: 'start' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
        <section style={{ ...card, padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ font: 'var(--font-heading-h5)', color: 'var(--fg-default)' }}>Новая заявка</span>
            <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-soft)' }}>
              Начать взаимодействие с вузом по продукту вендора
            </span>
          </div>
          <button
            onClick={() => setDraftOpen(true)}
            style={{
              height: 40,
              border: 0,
              borderRadius: 'var(--border-radius-buttons)',
              background: 'var(--accent-default)',
              color: '#fff',
              font: 'var(--font-body-s-strong)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
            }}
          >
            {Atomaro.AddSmall16 && <Atomaro.AddSmall16 size={16} fill="#fff" />}
            Создать заявку
          </button>
        </section>

        <section style={{ ...card, padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{ font: 'var(--font-heading-h5)', color: 'var(--fg-default)' }}>Сегодня</span>
              <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)', textTransform: 'capitalize' }}>{TODAY_LABEL}</span>
            </div>
            <a
              href="https://calendar.google.com/"
              target="_blank"
              rel="noreferrer"
              title="Открыть Google Календарь"
              style={{ height: 28, padding: '0 8px', borderRadius: 'var(--border-radius-m)', display: 'flex', alignItems: 'center', gap: 4, font: 'var(--font-description-l-strong)', color: 'var(--fg-soft)', textDecoration: 'none' }}
            >
              Календарь
              {Atomaro.ArrowRightUp16 && <Atomaro.ArrowRightUp16 size={16} fill="var(--fg-muted)" />}
            </a>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {TODAY_EVENTS.map((ev) => (
              <div key={ev.time} style={{ display: 'flex', gap: 12, alignItems: 'stretch' }}>
                <span style={{ width: 40, flex: 'none', font: 'var(--font-description-l)', color: 'var(--fg-muted)', paddingTop: 8, fontVariantNumeric: 'tabular-nums' }}>{ev.time}</span>
                <div style={{ flex: 1, minWidth: 0, background: 'var(--info-container-default)', borderRadius: 'var(--border-radius-m)', padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{ font: 'var(--font-body-s-strong)', color: 'var(--fg-default)' }}>{ev.title}</span>
                  <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-soft)' }}>
                    {ev.range} · {ev.who}
                  </span>
                </div>
              </div>
            ))}
          </div>
          <div style={{ height: 1, background: 'var(--border-muted)' }} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ font: 'var(--font-description-l-strong)', color: 'var(--fg-muted)', paddingBottom: 4 }}>Задачи на сегодня</span>
            {TODAY_TASKS.map((title, i) => {
              const done = !!taskDone[i]
              return (
                <button
                  key={title}
                  onClick={() => setTaskDone((z) => ({ ...z, [i]: !z[i] }))}
                  style={{ border: 0, background: 'transparent', padding: '6px 0', display: 'flex', alignItems: 'flex-start', gap: 12, cursor: 'pointer', textAlign: 'left' }}
                >
                  <span
                    style={{
                      width: 18,
                      height: 18,
                      flex: 'none',
                      marginTop: 1,
                      borderRadius: '50%',
                      border: `2px solid ${done ? 'var(--accent-default)' : 'var(--neutral-muted)'}`,
                      background: done ? 'var(--accent-default)' : 'transparent',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {done && Atomaro.CheckSmall16 && <Atomaro.CheckSmall16 size={12} fill="#fff" />}
                  </span>
                  <span style={{ font: 'var(--font-body-s)', color: done ? 'var(--fg-muted)' : 'var(--fg-default)', textDecoration: done ? 'line-through' : 'none' }}>{title}</span>
                </button>
              )
            })}
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <a
              href="https://tasks.google.com/"
              target="_blank"
              rel="noreferrer"
              title="Открыть Google Tasks"
              style={{ height: 28, padding: '0 8px', borderRadius: 'var(--border-radius-m)', display: 'flex', alignItems: 'center', gap: 4, font: 'var(--font-description-l-strong)', color: 'var(--fg-soft)', textDecoration: 'none' }}
            >
              Tasks
              {Atomaro.ArrowRightUp16 && <Atomaro.ArrowRightUp16 size={16} fill="var(--fg-muted)" />}
            </a>
          </div>
        </section>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
        <section style={{ ...card, padding: 20, display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ font: 'var(--font-heading-h5)', color: 'var(--fg-default)' }}>Взаимодействия</span>
            <HeaderLink label="Все" onClick={() => navigate('/manager/interactions')} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,5fr) minmax(0,7fr)', gap: 40, alignItems: 'end' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)' }}>Активные слоты</span>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <span style={{ font: 'var(--font-display-s-strong)', color: 'var(--fg-default)', fontVariantNumeric: 'tabular-nums' }}>
                  {used}
                </span>
                <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-soft)' }}>из {max} · свободно {free}</span>
              </div>
              <div style={{ height: 6, borderRadius: 3, background: 'var(--neutral-container-default)', overflow: 'hidden' }}>
                <div style={{ width: max ? `${Math.round((used / max) * 100)}%` : '0%', height: '100%', background: slotColor, borderRadius: 3 }} />
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 16 }}>
              {statTiles.map((st) => (
                <div key={st.label} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={{ font: 'var(--font-heading-h2)', color: 'var(--fg-default)', fontVariantNumeric: 'tabular-nums' }}>
                    {st.value}
                  </span>
                  <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-soft)' }}>{st.label}</span>
                </div>
              ))}
            </div>
          </div>
          {/* "Завершено за месяц" из дизайна пропущен: ни /interactions/stats, ни список
              не дают фильтр по дате закрытия — посчитать помесячно без похода за всеми заявками нельзя */}
        </section>

        <section style={{ ...card, padding: '20px 12px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ font: 'var(--font-heading-h5)', color: 'var(--fg-default)' }}>Лента</span>
              <span style={{ font: 'var(--font-description-l-strong)', color: 'var(--fg-muted)' }}>непрочитанные · {unread.length}</span>
            </div>
            <HeaderLink label="Все" onClick={() => navigate('/manager/inbox')} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {feed.map((n) => (
              <FeedRow key={n.id} n={n} onOpen={() => navigate(n.interaction_id ? `/manager/interactions/${n.interaction_id}` : '/manager/inbox')} />
            ))}
            {feed.length === 0 && (
              <div style={{ padding: '48px 20px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                {Atomaro.CheckLargeDouble && <Atomaro.CheckLargeDouble size={32} fill="var(--neutral-muted)" />}
                <span style={{ font: 'var(--font-body-s-strong)', color: 'var(--fg-soft)' }}>Действий не требуется</span>
              </div>
            )}
          </div>
        </section>

        <section style={{ ...card, padding: '20px 12px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ font: 'var(--font-heading-h5)', color: 'var(--fg-default)' }}>Зависшие</span>
              <span style={{ font: 'var(--font-description-l-strong)', color: 'var(--fg-muted)' }}>{stalled.length}</span>
            </div>
            <HeaderLink label="Все" onClick={() => navigate('/manager/interactions')} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {stalled.map(({ row, days }) => (
              <button
                key={row.id}
                onClick={() => navigate(`/manager/interactions/${row.id}`)}
                style={{
                  border: 0,
                  background: 'transparent',
                  borderRadius: 'var(--border-radius-m)',
                  padding: 8,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                  <span style={{ font: 'var(--font-body-s-strong)', color: 'var(--fg-default)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {row.university.name}
                  </span>
                  <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)' }}>{row.stage?.name ?? '—'}</span>
                </span>
                <span style={{ font: 'var(--font-body-s-strong)', color: 'var(--error-default)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                  {days} дн.
                </span>
              </button>
            ))}
            {!stalledLoading && stalled.length === 0 && (
              <div style={{ padding: '24px 8px', font: 'var(--font-body-s)', color: 'var(--fg-muted)' }}>Зависших нет</div>
            )}
          </div>
        </section>
      </div>

      {draftOpen && (
        <NewInteractionDialog
          onClose={() => setDraftOpen(false)}
          onCreated={(id) => {
            setDraftOpen(false)
            toast({ title: 'Черновик заявки создан', subtitle: `#${id}`, colorScheme: 'success' })
            navigate(`/manager/interactions/${id}`)
          }}
        />
      )}
    </div>
  )
}

function HeaderLink({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        height: 28,
        padding: '0 8px',
        border: 0,
        borderRadius: 'var(--border-radius-m)',
        background: 'transparent',
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        font: 'var(--font-description-l-strong)',
        color: 'var(--fg-soft)',
        cursor: 'pointer',
      }}
    >
      {label}
      {Atomaro.ChevronRight16 && <Atomaro.ChevronRight16 size={16} fill="var(--fg-muted)" />}
    </button>
  )
}

function FeedRow({ n, onOpen }: { n: NotificationRead; onOpen: () => void }) {
  const icon = NOTIF_ICON[n.type] ?? 'Notification'
  const [tint, ink] = SEV_TINT[n.severity] ?? SEV_TINT.INFO
  const Icon = Atomaro[icon]
  return (
    <div style={{ display: 'flex', gap: 12, padding: '12px 8px', borderRadius: 'var(--border-radius-m)' }}>
      <div style={{ width: 32, height: 32, flex: 'none', borderRadius: '50%', background: tint, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {Icon && <Icon size={16} fill={ink} />}
      </div>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
          <span style={{ font: 'var(--font-body-s-strong)', color: 'var(--fg-default)' }}>{n.title}</span>
          <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)', whiteSpace: 'nowrap' }}>{formatTime(n.created_at)}</span>
        </div>
        <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-soft)' }}>{n.body}</span>
        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
          <button
            onClick={onOpen}
            style={{
              height: 32,
              padding: '0 12px',
              border: '1px solid var(--accent-default)',
              borderRadius: 'var(--border-radius-buttons)',
              background: 'var(--accent-default)',
              color: '#fff',
              font: 'var(--font-body-s-strong)',
              cursor: 'pointer',
            }}
          >
            Открыть
          </button>
        </div>
      </div>
    </div>
  )
}

function NewInteractionDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (id: number) => void }) {
  const { data: universities } = useUniversities()
  const { data: programs } = usePrograms()
  const create = useCreateInteractionDraft()
  const [universityId, setUniversityId] = useState<number | ''>('')
  const [programId, setProgramId] = useState<number | ''>('')
  const [productId, setProductId] = useState<number | ''>('')
  const [tried, setTried] = useState(false)

  const program = programs?.find((p) => p.id === programId)
  const invalid = !universityId || !programId

  const submit = () => {
    if (invalid) {
      setTried(true)
      return
    }
    create.mutate(
      {
        university_id: Number(universityId),
        branches: [{ program_id: Number(programId), product_id: productId ? Number(productId) : null }],
      },
      { onSuccess: (row) => onCreated(row.id) },
    )
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

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 30, background: 'rgba(14,17,23,.4)' }} />
      <div
        style={{
          position: 'fixed',
          zIndex: 31,
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
          gap: 20,
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ font: 'var(--font-heading-h3)', color: 'var(--fg-default)' }}>Новая заявка</span>
          <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-soft)' }}>Вуз и программа, с которой начнётся взаимодействие.</span>
        </div>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ font: 'var(--font-description-l-strong)', color: 'var(--fg-soft)' }}>Вуз *</span>
          <select value={universityId} onChange={(e) => setUniversityId(e.target.value ? Number(e.target.value) : '')} style={{ ...fieldStyle, borderColor: tried && !universityId ? 'var(--error-default)' : 'var(--border-soft)' }}>
            <option value="">Выберите вуз</option>
            {(universities ?? []).map((u) => (
              <option key={u.id} value={u.id}>
                {u.short_name}
              </option>
            ))}
          </select>
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ font: 'var(--font-description-l-strong)', color: 'var(--fg-soft)' }}>Программа *</span>
          <select
            value={programId}
            onChange={(e) => {
              setProgramId(e.target.value ? Number(e.target.value) : '')
              setProductId('')
            }}
            style={{ ...fieldStyle, borderColor: tried && !programId ? 'var(--error-default)' : 'var(--border-soft)' }}
          >
            <option value="">Выберите программу</option>
            {(programs ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>

        {program && program.products.length > 0 && (
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ font: 'var(--font-description-l-strong)', color: 'var(--fg-soft)' }}>Продукт вендора (необязательно)</span>
            <select value={productId} onChange={(e) => setProductId(e.target.value ? Number(e.target.value) : '')} style={fieldStyle}>
              <option value="">Без продукта</option>
              {program.products.map((pr) => (
                <option key={pr.id} value={pr.id}>
                  {pr.name}
                </option>
              ))}
            </select>
          </label>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button
            onClick={onClose}
            style={{ height: 40, padding: '0 20px', border: '1px solid var(--border-soft)', borderRadius: 'var(--border-radius-buttons)', background: 'var(--bg-surface1)', color: 'var(--fg-default)', font: 'var(--font-body-s-strong)', cursor: 'pointer' }}
          >
            Отмена
          </button>
          <button
            onClick={submit}
            disabled={create.isPending}
            style={{ height: 40, padding: '0 20px', border: 0, borderRadius: 'var(--border-radius-buttons)', background: 'var(--accent-default)', color: '#fff', font: 'var(--font-body-s-strong)', cursor: create.isPending ? 'default' : 'pointer', opacity: create.isPending ? 0.6 : 1 }}
          >
            Создать
          </button>
        </div>
      </div>
    </>
  )
}

function daysSince(iso: string): number {
  const ms = Date.now() - new Date(iso).getTime()
  return Math.max(0, Math.floor(ms / 86_400_000))
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}
