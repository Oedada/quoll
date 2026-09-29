import { useMemo, useState } from 'react'
import { useToast } from '../../manager/ToastContext'
import { ApiError } from '../../api/client'
import type { UserRole } from '../../api/types'
import { useUsers } from '../../api/users'
import { useAllNotifications, useSendManualNotification, type NotificationRead } from '../../api/notifications'

// «кому» при рассылке на всю роль — дательный падеж
const ROLE_DATIVE: Record<UserRole, string> = {
  manager: 'Менеджерам',
  superviser: 'Руководителям',
  admin: 'Администраторам',
}

// код вида уведомления -> человеко-читаемый ярлык (из backend/src/quoll/notifications/kinds.py)
const TYPE_LABEL: Record<string, string> = {
  INTERACTION_DECLINED: 'Отказ от заявки',
  BACKWARD_MOVE: 'Возврат на шаг назад',
  DOCUMENT_PENDING: 'Файл ждёт одобрения',
  DOCUMENT_DECIDED: 'Решение по файлу',
  STEP_EDIT_PENDING: 'Правка шага ждёт одобрения',
  STEP_EDIT_DECIDED: 'Решение по правке шага',
  ALL_BRANCHES_CLOSED: 'Все ветки закрыты',
  WORKFLOW_CHANGE_DECIDED: 'Решение по изменению воркфлоу',
  MANUAL: 'Ручное',
  IMPORT_ASSIGNED: 'Назначено импортом',
  IMPORT_ASSIGNED_TEAM: 'Назначено импортом (команде)',
  STALL: 'Застой на шаге',
  LICENSE_EXPIRING: 'Лицензия скоро закончится',
  CONTRACT_EXPIRING: 'Договор скоро закончится',
  MOVED_TO_PASSIVE: 'Переведена в пассивные',
  INTERACTION_ASSIGNED: 'Назначена заявка',
  INTERACTION_TAKEN_AWAY: 'Заявку передали другому менеджеру',
  REQUEST_CREATED: 'Новая просьба',
  REQUEST_DECIDED: 'Решение по просьбе',
  PAUSE_ENDED: 'Пауза закончилась',
  PAUSE_WAITING_CAPACITY: 'Пауза закончилась, нет места',
  INTEGRATION_PROPOSAL_CREATE: 'LMS: новый вуз',
  INTEGRATION_PROPOSAL_ADD: 'LMS: добавить программу',
  COMMENT_REPLY: 'Ответ на комментарий',
  COMMENT_TO_OWNER: 'Комментарий от руководителя',
  COMMENT_TO_SUPERVISOR: 'Комментарий от менеджера',
  INTEGRATION_PROPOSAL_SIGN_NEEDED: 'LMS: нужно оформить ДС',
}

// backend отдаёт не «кому» (id/имя), а «за что» получатель отвечает (quoll.notifications.kinds.Role) —
// показываем получателей чипами по этому признаку, а не по имени
const RECIPIENT_ROLE_LABEL: Record<string, string> = {
  OWNER: 'Ответственный',
  PREVIOUS_OWNER: 'Прежний ответственный',
  OWNER_SUPERVISOR: 'Руководитель ответственного',
  AUTHOR: 'Автор заявки',
  REQUESTER: 'Автор просьбы',
  EDITOR: 'Автор правки',
  ADMINS: 'Администраторы',
  ALL_SUPERVISORS: 'Все руководители',
  USER: 'Получатель',
}

const SEV_LABEL: Record<string, [string, string]> = {
  INFO: ['Инфо', 'var(--neutral-container-default)'],
  WARNING: ['Важно', 'var(--warning-container-default)'],
  CRITICAL: ['Критично', 'var(--error-container-default)'],
}

const FEED_LIMIT = 100

function fmtWhen(iso: string): string {
  const d = new Date(iso)
  const p2 = (n: number) => String(n).padStart(2, '0')
  return `${p2(d.getDate())}.${p2(d.getMonth() + 1)} ${p2(d.getHours())}:${p2(d.getMinutes())}`
}

interface Card {
  notification_id: number
  type: string
  severity: string
  title: string
  body: string
  actor_id: string | null
  created_at: string
  recipients: { role: string; read_at: string | null }[]
}

function groupByNotification(rows: NotificationRead[]): Card[] {
  const map = new Map<number, Card>()
  const order: number[] = []
  for (const r of rows) {
    let card = map.get(r.notification_id)
    if (!card) {
      card = {
        notification_id: r.notification_id,
        type: r.type,
        severity: r.severity,
        title: r.title,
        body: r.body,
        actor_id: r.actor_id,
        created_at: r.created_at,
        recipients: [],
      }
      map.set(r.notification_id, card)
      order.push(r.notification_id)
    }
    card.recipients.push({ role: r.role, read_at: r.read_at })
  }
  return order.map((id) => map.get(id)!)
}

type Mode = 'role' | 'users'

interface SendForm {
  title: string
  body: string
  mode: Mode
  role: UserRole
  selected: Record<string, boolean>
}

const EMPTY_FORM: SendForm = { title: '', body: '', mode: 'role', role: 'manager', selected: {} }

export default function NotificationsFeedPage() {
  const toast = useToast()
  const [userFilter, setUserFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [interFilter, setInterFilter] = useState('')

  // отдельный незафильтрованный запрос — источник для списков фильтров (типы, взаимодействия)
  const { data: baseRows } = useAllNotifications({ limit: FEED_LIMIT })
  const { data: rows, isLoading } = useAllNotifications({
    user_id: userFilter || undefined,
    type: typeFilter || undefined,
    interaction_id: interFilter ? Number(interFilter) : undefined,
    limit: FEED_LIMIT,
  })
  const { data: usersPage } = useUsers({ limit: 100 })
  const people = useMemo(() => usersPage?.users ?? [], [usersPage])
  const nameById = useMemo(() => {
    const m = new Map<string, string>()
    for (const u of people) {
      const name = [u.last_name, u.first_name].filter(Boolean).join(' ') || u.username || u.id
      m.set(u.id, name)
    }
    return m
  }, [people])
  const nameOf = (id: string | null) => (id ? nameById.get(id) ?? id : 'система')

  const typeOpts = useMemo(() => Array.from(new Set((baseRows ?? []).map((r) => r.type))).sort(), [baseRows])
  const interactionOpts = useMemo(() => {
    const ids = Array.from(new Set((baseRows ?? []).map((r) => r.interaction_id).filter((v): v is number => v != null)))
    ids.sort((a, b) => b - a)
    return ids
  }, [baseRows])

  const cards = useMemo(() => groupByNotification(rows ?? []), [rows])
  const empty = !isLoading && cards.length === 0

  const [dlg, setDlg] = useState(false)
  const [form, setForm] = useState<SendForm>(EMPTY_FORM)
  const [tried, setTried] = useState(false)
  const send = useSendManualNotification()

  function openDlg() {
    setForm(EMPTY_FORM)
    setTried(false)
    setDlg(true)
  }
  function closeDlg() {
    setDlg(false)
  }
  function toggleUser(id: string) {
    setForm((f) => ({ ...f, selected: { ...f.selected, [id]: !f.selected[id] } }))
  }

  function handleSend() {
    const selectedIds = Object.keys(form.selected).filter((id) => form.selected[id])
    if (!form.title.trim() || !form.body.trim() || (form.mode === 'users' && selectedIds.length === 0)) {
      setTried(true)
      return
    }
    send.mutate(
      {
        title: form.title.trim(),
        body: form.body.trim(),
        ...(form.mode === 'users' ? { user_ids: selectedIds } : { role: form.role }),
      },
      {
        onSuccess: () => {
          closeDlg()
          toast({ title: 'Уведомление отправлено', subtitle: form.title.trim(), colorScheme: 'success' })
        },
        onError: (err) => {
          toast({ title: 'Не удалось отправить', subtitle: err instanceof ApiError ? err.message : undefined, colorScheme: 'error' })
        },
      },
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
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0, position: 'relative' }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <select value={userFilter} onChange={(e) => setUserFilter(e.target.value)} style={selectStyle}>
          <option value="">Все получатели</option>
          {people.map((u) => (
            <option key={u.id} value={u.id}>
              {nameById.get(u.id)}
            </option>
          ))}
        </select>
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} style={selectStyle}>
          <option value="">Все типы</option>
          {typeOpts.map((t) => (
            <option key={t} value={t}>
              {TYPE_LABEL[t] ?? t}
            </option>
          ))}
        </select>
        <select value={interFilter} onChange={(e) => setInterFilter(e.target.value)} style={selectStyle}>
          <option value="">Все взаимодействия</option>
          {interactionOpts.map((id) => (
            <option key={id} value={String(id)}>
              #{id}
            </option>
          ))}
        </select>
        <span style={{ flex: 1 }} />
        <button
          onClick={openDlg}
          style={{
            height: 36,
            padding: '0 16px',
            border: 0,
            borderRadius: 'var(--border-radius-buttons)',
            background: 'var(--accent-default)',
            color: '#fff',
            font: 'var(--font-body-s-strong)',
            cursor: 'pointer',
          }}
        >
          Отправить уведомление
        </button>
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
        {empty && (
          <div style={{ padding: '48px 8px', textAlign: 'center', font: 'var(--font-body-s)', color: 'var(--fg-muted)' }}>
            Уведомлений по этим фильтрам нет
          </div>
        )}
        {cards.map((n) => {
          const [sevLabel, sevBg] = SEV_LABEL[n.severity] ?? [n.severity, 'var(--neutral-container-default)']
          return (
            <div
              key={n.notification_id}
              style={{ padding: '14px 8px', borderTop: '1px solid var(--border-muted)', display: 'flex', flexDirection: 'column', gap: 6 }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ font: 'var(--font-body-s-strong)', color: 'var(--fg-default)' }}>{n.title}</span>
                <span
                  style={{
                    height: 20,
                    padding: '0 6px',
                    borderRadius: 'var(--border-radius-s)',
                    background: sevBg,
                    font: 'var(--font-description-l-strong)',
                    color: 'var(--fg-default)',
                    display: 'flex',
                    alignItems: 'center',
                  }}
                >
                  {sevLabel}
                </span>
                <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)' }}>
                  {TYPE_LABEL[n.type] ?? n.type} · {fmtWhen(n.created_at)} · от: {nameOf(n.actor_id)}
                </span>
              </div>
              <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-soft)', textWrap: 'pretty' }}>{n.body}</span>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {n.recipients.map((r, i) => (
                  <span
                    key={i}
                    style={{
                      height: 22,
                      padding: '0 8px',
                      borderRadius: 'var(--border-radius-m)',
                      background: r.read_at ? 'var(--neutral-container-soft)' : 'var(--warning-container-default)',
                      font: 'var(--font-description-l)',
                      color: 'var(--fg-default)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: r.read_at ? 'var(--neutral-muted)' : 'var(--warning-default)' }} />
                    {RECIPIENT_ROLE_LABEL[r.role] ?? r.role} · {r.read_at ? 'прочитано' : 'не прочитано'}
                  </span>
                ))}
              </div>
            </div>
          )
        })}
      </section>

      {dlg && (
        <SendDialog
          form={form}
          setForm={setForm}
          tried={tried}
          people={people.map((u) => ({ id: u.id, name: nameById.get(u.id) ?? u.id }))}
          pending={send.isPending}
          onToggleUser={toggleUser}
          onClose={closeDlg}
          onSend={handleSend}
        />
      )}
    </div>
  )
}

interface SendDialogProps {
  form: SendForm
  setForm: React.Dispatch<React.SetStateAction<SendForm>>
  tried: boolean
  people: { id: string; name: string }[]
  pending: boolean
  onToggleUser: (id: string) => void
  onClose: () => void
  onSend: () => void
}

function SendDialog({ form, setForm, tried, people, pending, onToggleUser, onClose, onSend }: SendDialogProps) {
  const titleInvalid = tried && !form.title.trim()
  const bodyInvalid = tried && !form.body.trim()
  const usersInvalid = tried && form.mode === 'users' && !Object.values(form.selected).some(Boolean)

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
          width: 500,
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
        <span style={{ font: 'var(--font-heading-h3)', color: 'var(--fg-default)' }}>Отправить уведомление</span>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ font: 'var(--font-description-l-strong)', color: 'var(--fg-soft)' }}>Заголовок *</span>
          <input
            value={form.title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            style={{
              height: 40,
              padding: '0 12px',
              border: `1px solid ${titleInvalid ? 'var(--error-default)' : 'var(--border-soft)'}`,
              borderRadius: 'var(--border-radius-inputs)',
              background: 'var(--bg-surface1)',
              font: 'var(--font-body-s)',
              color: 'var(--fg-default)',
              outline: 0,
            }}
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ font: 'var(--font-description-l-strong)', color: 'var(--fg-soft)' }}>Текст *</span>
          <textarea
            rows={3}
            value={form.body}
            onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
            style={{
              resize: 'vertical',
              padding: 12,
              border: `1px solid ${bodyInvalid ? 'var(--error-default)' : 'var(--border-soft)'}`,
              borderRadius: 'var(--border-radius-inputs)',
              background: 'var(--bg-surface1)',
              font: 'var(--font-body-s)',
              color: 'var(--fg-default)',
              outline: 0,
            }}
          />
        </label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ font: 'var(--font-description-l-strong)', color: 'var(--fg-soft)' }}>Кому *</span>
          <div style={{ display: 'flex', gap: 2, padding: 2, borderRadius: 'var(--border-radius-m)', background: 'var(--neutral-container-soft)', alignSelf: 'flex-start' }}>
            {(['role', 'users'] as Mode[]).map((m) => (
              <button
                key={m}
                onClick={() => setForm((f) => ({ ...f, mode: m }))}
                style={{
                  height: 28,
                  padding: '0 12px',
                  border: 0,
                  borderRadius: 6,
                  background: form.mode === m ? 'var(--bg-surface1)' : 'transparent',
                  font: 'var(--font-description-l-strong)',
                  color: 'var(--fg-default)',
                  cursor: 'pointer',
                }}
              >
                {m === 'role' ? 'Вся роль' : 'Конкретные люди'}
              </button>
            ))}
          </div>
          {form.mode === 'role' && (
            <select
              value={form.role}
              onChange={(e) => setForm((f) => ({ ...f, role: e.target.value as UserRole }))}
              style={{
                height: 40,
                padding: '0 8px',
                border: '1px solid var(--border-soft)',
                borderRadius: 'var(--border-radius-inputs)',
                background: 'var(--bg-surface1)',
                font: 'var(--font-body-s)',
                color: 'var(--fg-default)',
                outline: 0,
              }}
            >
              {(Object.keys(ROLE_DATIVE) as UserRole[]).map((r) => (
                <option key={r} value={r}>
                  {ROLE_DATIVE[r]}
                </option>
              ))}
            </select>
          )}
          {form.mode === 'users' && (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 2,
                maxHeight: 150,
                overflowY: 'auto',
                border: `1px solid ${usersInvalid ? 'var(--error-default)' : 'var(--border-soft)'}`,
                borderRadius: 'var(--border-radius-m)',
                padding: 4,
              }}
            >
              {people.map((p) => (
                <button
                  key={p.id}
                  onClick={() => onToggleUser(p.id)}
                  style={{
                    border: 0,
                    background: form.selected[p.id] ? 'var(--accent-container-muted)' : 'transparent',
                    borderRadius: 6,
                    padding: '6px 8px',
                    textAlign: 'left',
                    font: 'var(--font-body-s)',
                    color: 'var(--fg-default)',
                    cursor: 'pointer',
                    display: 'flex',
                    gap: 8,
                  }}
                >
                  <span>{form.selected[p.id] ? '☑' : '☐'}</span>
                  {p.name}
                </button>
              ))}
            </div>
          )}
        </div>
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
            Отмена
          </button>
          <button
            onClick={onSend}
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
            Отправить
          </button>
        </div>
      </div>
    </>
  )
}
