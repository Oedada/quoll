import { useMemo, useState } from 'react'
import { Atomaro } from '../../ds/atomaro'
import { useToast } from '../../manager/ToastContext'
import { ApiError } from '../../api/client'
import type { UserRead, UserRole } from '../../api/types'
import {
  useUsers,
  useCreateUser,
  useUpdateUser,
  useChangeRole,
  useDeactivateUser,
  useReactivateUser,
} from '../../api/users'
import { useSetUserLimits } from '../../api/user-limits'
import { useProfile } from '../../api/org'
import { usePeople, personFullName } from '../../api/people'

const ROLE_LABEL: Record<UserRole, string> = {
  manager: 'Менеджер',
  superviser: 'Руководитель',
  admin: 'Администратор',
}

const PAGE_SIZE = 10

function fullName(u: UserRead): string {
  const name = [u.last_name, u.first_name, u.patronymic].filter(Boolean).join(' ')
  return name || u.username || u.email || u.id
}

function shortName(u: UserRead): string {
  const initials = [u.first_name?.[0], u.patronymic?.[0]].filter(Boolean).map((c) => `${c}.`).join(' ')
  return [u.last_name, initials].filter(Boolean).join(' ') || fullName(u)
}

type DialogKind = 'create' | 'edit' | 'role' | 'limits' | 'deactivate' | 'reactivate' | 'profile'

interface DialogState {
  kind: DialogKind
  user: UserRead | null
}

interface FormState {
  username: string
  email: string
  last_name: string
  first_name: string
  patronymic: string
  password: string
  role: UserRole
  limit: string
}

const EMPTY_FORM: FormState = {
  username: '',
  email: '',
  last_name: '',
  first_name: '',
  patronymic: '',
  password: '',
  role: 'manager',
  limit: '',
}

const inputStyle = (invalid: boolean): React.CSSProperties => ({
  height: 40,
  padding: '0 12px',
  border: `1px solid ${invalid ? 'var(--error-default)' : 'var(--border-soft)'}`,
  borderRadius: 'var(--border-radius-inputs)',
  background: 'var(--bg-surface1)',
  font: 'var(--font-body-s)',
  color: 'var(--fg-default)',
  outline: 0,
  width: '100%',
})

const labelStyle: React.CSSProperties = { font: 'var(--font-description-l-strong)', color: 'var(--fg-soft)' }
const fieldWrap: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6 }

export default function UsersPage() {
  const toast = useToast()
  const [q, setQ] = useState('')
  const [role, setRole] = useState<UserRole | ''>('')
  const [active, setActive] = useState<'' | 'true' | 'false'>('')
  const [offset, setOffset] = useState(0)

  const { data, isLoading } = useUsers({
    q: q.trim() || undefined,
    role: role || undefined,
    is_active: active === '' ? undefined : active === 'true',
    limit: PAGE_SIZE,
    offset,
  })

  const users = useMemo(() => data?.users ?? [], [data])
  const total = data?.total ?? 0

  const supervisorIds = useMemo(() => users.map((u) => u.superviser_id), [users])
  const { data: supervisors } = usePeople(supervisorIds)
  const supervisorName = (id: string | null) => {
    if (!id) return '—'
    const p = supervisors?.find((x) => x.id === id)
    return p ? personFullName(p) : '…'
  }

  const [dialog, setDialog] = useState<DialogState | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [tried, setTried] = useState(false)

  const createUser = useCreateUser()
  const updateUser = useUpdateUser()
  const changeRole = useChangeRole()
  const deactivateUser = useDeactivateUser()
  const reactivateUser = useReactivateUser()
  const setLimits = useSetUserLimits()

  // грузим профиль (стат синхронизации, слоты/команда) только когда открыт диалог, где это нужно
  const needsProfile = dialog && ['role', 'deactivate', 'profile'].includes(dialog.kind) && dialog.user
  const { data: profile } = useProfile(needsProfile ? dialog!.user!.id : undefined)

  function openDialog(kind: DialogKind, user: UserRead | null) {
    setTried(false)
    if (kind === 'create') {
      setForm(EMPTY_FORM)
    } else if (user) {
      setForm({
        ...EMPTY_FORM,
        username: user.username ?? '',
        email: user.email ?? '',
        last_name: user.last_name,
        first_name: user.first_name,
        patronymic: user.patronymic,
        role: user.role,
        limit: String(user.role === 'manager' ? user.max_active_projects ?? '' : user.max_subordinates ?? ''),
      })
    }
    setDialog({ kind, user })
  }

  function closeDialog() {
    setDialog(null)
  }

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  const pending =
    createUser.isPending ||
    updateUser.isPending ||
    changeRole.isPending ||
    deactivateUser.isPending ||
    reactivateUser.isPending ||
    setLimits.isPending

  function handleError(title: string, err: unknown) {
    toast({ title, subtitle: err instanceof ApiError ? err.message : undefined, colorScheme: 'error' })
  }

  function handleConfirm() {
    if (!dialog) return
    const u = dialog.user

    if (dialog.kind === 'create') {
      const required = [form.username, form.email, form.last_name, form.first_name, form.patronymic, form.password]
      if (required.some((v) => !v.trim())) return setTried(true)
      createUser.mutate(
        {
          username: form.username.trim(),
          email: form.email.trim(),
          first_name: form.first_name.trim(),
          last_name: form.last_name.trim(),
          patronymic: form.patronymic.trim(),
          password: form.password,
          role: form.role,
        },
        {
          onSuccess: () => {
            closeDialog()
            toast({ title: 'Пользователь создан', subtitle: form.username, colorScheme: 'success' })
          },
          onError: (err) => handleError('Не удалось создать пользователя', err),
        },
      )
      return
    }

    if (!u) return

    if (dialog.kind === 'edit') {
      if (!form.email.trim() || !form.last_name.trim() || !form.first_name.trim()) return setTried(true)
      updateUser.mutate(
        {
          id: u.id,
          body: {
            email: form.email.trim(),
            last_name: form.last_name.trim(),
            first_name: form.first_name.trim(),
            patronymic: form.patronymic.trim(),
          },
        },
        {
          onSuccess: () => {
            closeDialog()
            toast({ title: 'Данные сохранены', subtitle: shortName(u), colorScheme: 'success' })
          },
          onError: (err) => handleError('Не удалось сохранить', err),
        },
      )
      return
    }

    if (dialog.kind === 'role') {
      changeRole.mutate(
        { id: u.id, role: form.role },
        {
          onSuccess: () => {
            closeDialog()
            toast({ title: 'Смена роли запущена', subtitle: shortName(u), colorScheme: 'success' })
          },
          onError: (err) => handleError('Не удалось сменить роль', err),
        },
      )
      return
    }

    if (dialog.kind === 'limits') {
      const n = Number(form.limit)
      if (!Number.isFinite(n) || n < 1) return setTried(true)
      const body = u.role === 'manager' ? { max_active_projects: n } : { max_subordinates: n }
      setLimits.mutate(
        { userId: u.id, body },
        {
          onSuccess: () => {
            closeDialog()
            toast({ title: 'Лимит сохранён', subtitle: shortName(u), colorScheme: 'success' })
          },
          onError: (err) => handleError('Не удалось сохранить лимит', err),
        },
      )
      return
    }

    if (dialog.kind === 'deactivate') {
      deactivateUser.mutate(u.id, {
        onSuccess: () => {
          closeDialog()
          toast({ title: 'Пользователь деактивирован', subtitle: shortName(u), colorScheme: 'success' })
        },
        onError: (err) => handleError('Не удалось деактивировать', err),
      })
      return
    }

    if (dialog.kind === 'reactivate') {
      reactivateUser.mutate(u.id, {
        onSuccess: () => {
          closeDialog()
          toast({ title: 'Пользователь активен', subtitle: shortName(u), colorScheme: 'success' })
        },
        onError: (err) => handleError('Не удалось реактивировать', err),
      })
      return
    }
  }

  const rangeText = total ? `${offset + 1}–${Math.min(offset + PAGE_SIZE, total)} из ${total}` : '0 из 0'
  const gridCols = 'minmax(170px,1.3fr) minmax(190px,1.3fr) minmax(110px,.8fr) minmax(110px,.8fr) minmax(130px,1fr) minmax(110px,.8fr) 210px'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0, position: 'relative' }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <label
          style={{
            width: 260,
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
          <Atomaro.Search16 size={16} fill="var(--fg-muted)" />
          <input
            value={q}
            onChange={(e) => {
              setQ(e.target.value)
              setOffset(0)
            }}
            placeholder="Поиск по имени"
            style={{ border: 0, outline: 0, background: 'transparent', flex: 1, minWidth: 0, font: 'var(--font-body-s)', color: 'var(--fg-default)' }}
          />
        </label>
        <select
          value={role}
          onChange={(e) => {
            setRole(e.target.value as UserRole | '')
            setOffset(0)
          }}
          style={{
            height: 36,
            padding: '0 8px',
            border: '1px solid var(--border-soft)',
            borderRadius: 'var(--border-radius-l)',
            background: 'var(--bg-surface1)',
            font: 'var(--font-body-s)',
            color: 'var(--fg-default)',
            outline: 0,
          }}
        >
          <option value="">Все роли</option>
          <option value="manager">Менеджер</option>
          <option value="superviser">Руководитель</option>
          <option value="admin">Администратор</option>
        </select>
        <select
          value={active}
          onChange={(e) => {
            setActive(e.target.value as '' | 'true' | 'false')
            setOffset(0)
          }}
          style={{
            height: 36,
            padding: '0 8px',
            border: '1px solid var(--border-soft)',
            borderRadius: 'var(--border-radius-l)',
            background: 'var(--bg-surface1)',
            font: 'var(--font-body-s)',
            color: 'var(--fg-default)',
            outline: 0,
          }}
        >
          <option value="">Любая активность</option>
          <option value="true">Активные</option>
          <option value="false">Заблокированные</option>
        </select>
        <span style={{ flex: 1 }} />
        <button
          onClick={() => openDialog('create', null)}
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
          Создать
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
          overflowX: 'auto',
        }}
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: gridCols,
            gap: 16,
            padding: '12px 8px 8px',
            font: 'var(--font-description-l)',
            color: 'var(--fg-muted)',
            minWidth: 900,
          }}
        >
          <span>Пользователь</span>
          <span>Почта</span>
          <span>Роль</span>
          <span>Статус</span>
          <span>Руководитель</span>
          <span>Лимит</span>
          <span />
        </div>

        {!isLoading && users.length === 0 && (
          <div style={{ padding: '40px 8px', textAlign: 'center', font: 'var(--font-body-s)', color: 'var(--fg-muted)' }}>
            Никого не нашлось
          </div>
        )}

        {users.map((u) => {
          const blocked = !u.is_active
          const st = blocked ? 'Заблокирован' : 'Активен'
          const stBg = blocked ? 'var(--neutral-container-default)' : 'var(--success-container-default)'
          const limit =
            u.role === 'manager'
              ? `проектов: ${u.max_active_projects ?? '—'}`
              : u.role === 'superviser'
                ? `команда: ${u.max_subordinates ?? '—'}`
                : '—'
          return (
            <div
              key={u.id}
              style={{
                display: 'grid',
                gridTemplateColumns: gridCols,
                gap: 16,
                padding: '12px 8px',
                borderTop: '1px solid var(--border-muted)',
                alignItems: 'center',
                minWidth: 900,
              }}
            >
              <button
                onClick={() => openDialog('profile', u)}
                style={{ border: 0, background: 'transparent', padding: 0, textAlign: 'left', display: 'flex', flexDirection: 'column', cursor: 'pointer' }}
              >
                <span style={{ font: 'var(--font-body-s-strong)', color: 'var(--fg-default)' }}>{fullName(u)}</span>
                <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)' }}>{u.username ?? '—'}</span>
              </button>
              <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-soft)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {u.email ?? '—'}
              </span>
              <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-default)' }}>{ROLE_LABEL[u.role]}</span>
              <span
                style={{
                  height: 22,
                  padding: '0 8px',
                  borderRadius: 'var(--border-radius-m)',
                  background: stBg,
                  font: 'var(--font-description-l-strong)',
                  color: 'var(--fg-default)',
                  display: 'flex',
                  alignItems: 'center',
                  justifySelf: 'start',
                }}
              >
                {st}
              </span>
              <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-soft)' }}>{supervisorName(u.superviser_id)}</span>
              <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-default)' }}>{limit}</span>
              <div style={{ display: 'flex', gap: 2, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                <button onClick={() => openDialog('edit', u)} style={actionBtnStyle('var(--fg-soft)')}>
                  Изменить
                </button>
                <button onClick={() => openDialog('role', u)} style={actionBtnStyle('var(--fg-soft)')}>
                  Роль
                </button>
                {u.role !== 'admin' && (
                  <button onClick={() => openDialog('limits', u)} style={actionBtnStyle('var(--fg-soft)')}>
                    Лимиты
                  </button>
                )}
                {u.is_active ? (
                  <button onClick={() => openDialog('deactivate', u)} style={actionBtnStyle('var(--error-default)')}>
                    Деактивировать
                  </button>
                ) : (
                  <button onClick={() => openDialog('reactivate', u)} style={actionBtnStyle('var(--accent-default)')}>
                    Реактивировать
                  </button>
                )}
              </div>
            </div>
          )
        })}

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 16,
            borderTop: '1px solid var(--border-muted)',
            padding: '12px 8px 0',
            minWidth: 900,
          }}
        >
          <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-soft)' }}>
            Всего: <b style={{ fontWeight: 600, color: 'var(--fg-default)' }}>{total}</b>
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-soft)', fontVariantNumeric: 'tabular-nums' }}>{rangeText}</span>
            <button
              onClick={() => offset > 0 && setOffset(Math.max(0, offset - PAGE_SIZE))}
              disabled={offset === 0}
              style={pagerBtnStyle(offset > 0)}
            >
              <Atomaro.ChevronLeft16 size={16} fill="var(--fg-soft)" />
            </button>
            <button
              onClick={() => offset + PAGE_SIZE < total && setOffset(offset + PAGE_SIZE)}
              disabled={offset + PAGE_SIZE >= total}
              style={pagerBtnStyle(offset + PAGE_SIZE < total)}
            >
              <Atomaro.ChevronRight16 size={16} fill="var(--fg-soft)" />
            </button>
          </div>
        </div>
      </section>

      {dialog && (
        <UserDialog
          dialog={dialog}
          form={form}
          setField={setField}
          tried={tried}
          pending={pending}
          profile={profile}
          onClose={closeDialog}
          onConfirm={handleConfirm}
        />
      )}
    </div>
  )
}

function actionBtnStyle(color: string): React.CSSProperties {
  return {
    height: 28,
    padding: '0 8px',
    border: 0,
    borderRadius: 'var(--border-radius-m)',
    background: 'transparent',
    font: 'var(--font-description-l-strong)',
    color,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  }
}

function pagerBtnStyle(enabled: boolean): React.CSSProperties {
  return {
    width: 32,
    height: 32,
    border: '1px solid var(--border-soft)',
    borderRadius: 'var(--border-radius-m)',
    background: 'var(--bg-surface1)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: enabled ? 'pointer' : 'default',
    opacity: enabled ? 1 : 0.4,
  }
}

interface DialogProps {
  dialog: DialogState
  form: FormState
  setField: <K extends keyof FormState>(key: K, value: FormState[K]) => void
  tried: boolean
  pending: boolean
  profile: import('../../api/org').ProfileRead | undefined
  onClose: () => void
  onConfirm: () => void
}

function UserDialog({ dialog, form, setField, tried, pending, profile, onClose, onConfirm }: DialogProps) {
  const u = dialog.user
  const kind = dialog.kind

  let title = ''
  let text = ''
  let warn = ''
  let confirmLabel = ''
  let btnBg = 'var(--accent-default)'

  if (kind === 'create') {
    title = 'Создать пользователя'
    confirmLabel = 'Создать'
  } else if (kind === 'edit' && u) {
    title = `Изменить: ${shortName(u)}`
    confirmLabel = 'Сохранить'
  } else if (kind === 'role' && u) {
    title = `Сменить роль: ${shortName(u)}`
    text = 'Смена роли выполняется в фоне: пока она идёт, учётная запись заблокирована.'
    confirmLabel = 'Сменить роль'
    if (u.role === 'manager') {
      const open = profile?.load?.open_projects
      warn = `Работа менеджера (открытых: ${open ?? '…'}) останется без ответственного, пока руководитель её не разберёт.`
    } else if (u.role === 'superviser') {
      const team = profile?.team_size
      warn = `Команда руководителя (${team ?? '…'}) уйдёт в пул свободных менеджеров, их работа останется у них.`
    }
  } else if (kind === 'limits' && u) {
    title = `Лимиты: ${shortName(u)}`
    text = u.role === 'manager' ? 'Сколько активных проектов может вести менеджер.' : 'Сколько менеджеров может быть в команде руководителя.'
    confirmLabel = 'Сохранить'
  } else if (kind === 'deactivate' && u) {
    title = `Деактивировать: ${shortName(u)}`
    text = 'Сотрудник больше не сможет войти. Учётка не удаляется.'
    confirmLabel = 'Деактивировать'
    btnBg = 'var(--error-default)'
    if (u.role === 'manager') {
      const open = profile?.load?.open_projects
      warn = `Заявки менеджера (открытых: ${open ?? '…'}) будут ждать нового ответственного — руководитель назначит КАМа.`
    } else if (u.role === 'superviser') {
      warn = 'Команда останется без руководителя: менеджеры уйдут в пулы, заявки будут ждать разбора.'
    }
  } else if (kind === 'reactivate' && u) {
    title = `Реактивировать: ${shortName(u)}`
    text = 'Сотрудник снова сможет войти.'
    confirmLabel = 'Реактивировать'
  } else if (kind === 'profile' && u) {
    title = fullName(u)
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
          gap: 16,
        }}
      >
        <span style={{ font: 'var(--font-heading-h3)', color: 'var(--fg-default)' }}>{title}</span>
        {text && <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-soft)', textWrap: 'pretty' }}>{text}</span>}
        {warn && (
          <div
            style={{
              background: 'var(--warning-container-default)',
              borderRadius: 'var(--border-radius-m)',
              padding: '10px 12px',
              font: 'var(--font-body-s)',
              color: 'var(--fg-default)',
              textWrap: 'pretty',
            }}
          >
            {warn}
          </div>
        )}

        {kind === 'profile' && u && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {profileRows(u, profile).map((row) => (
              <div
                key={row.k}
                style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '8px 0', borderTop: '1px solid var(--border-muted)' }}
              >
                <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)' }}>{row.k}</span>
                <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-default)', textAlign: 'right' }}>{row.v}</span>
              </div>
            ))}
          </div>
        )}

        {kind === 'create' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="Логин" required tried={tried} value={form.username} onChange={(v) => setField('username', v)} />
            <Field label="Почта" type="email" required tried={tried} value={form.email} onChange={(v) => setField('email', v)} />
            <Field label="Фамилия" required tried={tried} value={form.last_name} onChange={(v) => setField('last_name', v)} />
            <Field label="Имя" required tried={tried} value={form.first_name} onChange={(v) => setField('first_name', v)} />
            <Field label="Отчество" value={form.patronymic} onChange={(v) => setField('patronymic', v)} />
            <Field label="Пароль" type="password" required tried={tried} value={form.password} onChange={(v) => setField('password', v)} />
            <label style={fieldWrap}>
              <span style={labelStyle}>Роль</span>
              <select value={form.role} onChange={(e) => setField('role', e.target.value as UserRole)} style={inputStyle(false)}>
                <option value="manager">Менеджер</option>
                <option value="superviser">Руководитель</option>
                <option value="admin">Администратор</option>
              </select>
            </label>
          </div>
        )}

        {kind === 'edit' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div style={{ gridColumn: '1 / -1' }}>
              <Field label="Почта" type="email" required tried={tried} value={form.email} onChange={(v) => setField('email', v)} />
            </div>
            <Field label="Фамилия" required tried={tried} value={form.last_name} onChange={(v) => setField('last_name', v)} />
            <Field label="Имя" required tried={tried} value={form.first_name} onChange={(v) => setField('first_name', v)} />
            <Field label="Отчество" value={form.patronymic} onChange={(v) => setField('patronymic', v)} />
          </div>
        )}

        {kind === 'role' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <label style={{ ...fieldWrap, gridColumn: '1 / -1' }}>
              <span style={labelStyle}>Новая роль</span>
              <select value={form.role} onChange={(e) => setField('role', e.target.value as UserRole)} style={inputStyle(false)}>
                <option value="manager">Менеджер</option>
                <option value="superviser">Руководитель</option>
                <option value="admin">Администратор</option>
              </select>
            </label>
          </div>
        )}

        {kind === 'limits' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div style={{ gridColumn: '1 / -1' }}>
              <Field
                label={u?.role === 'manager' ? 'Макс. активных проектов' : 'Макс. подчинённых'}
                type="number"
                required
                tried={tried}
                value={form.limit}
                onChange={(v) => setField('limit', v)}
              />
            </div>
          </div>
        )}

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
            {kind === 'profile' ? 'Закрыть' : 'Отмена'}
          </button>
          {kind !== 'profile' && (
            <button
              onClick={onConfirm}
              disabled={pending}
              style={{
                height: 40,
                padding: '0 20px',
                border: 0,
                borderRadius: 'var(--border-radius-buttons)',
                background: btnBg,
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

function profileRows(u: UserRead, profile: import('../../api/org').ProfileRead | undefined): { k: string; v: string }[] {
  const rows: { k: string; v: string }[] = [
    { k: 'Логин', v: u.username ?? '—' },
    { k: 'Почта', v: u.email ?? '—' },
    { k: 'Роль', v: ROLE_LABEL[u.role] },
    { k: 'Синхронизация с Keycloak', v: profile?.identity_sync_status ?? '…' },
    { k: 'Смена роли', v: profile?.role_transition_status ?? '…' },
  ]
  if (u.role === 'manager' && profile?.load) {
    rows.push({ k: 'Слоты', v: `${profile.load.capacity_used} из ${profile.load.max_active_projects}` })
    rows.push({ k: 'Открытых проектов', v: String(profile.load.open_projects) })
  }
  if (u.role === 'superviser' && profile) {
    rows.push({ k: 'Команда', v: `${profile.team_size ?? '…'} из ${profile.max_subordinates ?? '…'}` })
  }
  return rows
}

interface FieldProps {
  label: string
  value: string
  onChange: (v: string) => void
  type?: string
  required?: boolean
  tried?: boolean
}

function Field({ label, value, onChange, type = 'text', required, tried }: FieldProps) {
  const invalid = !!required && !!tried && !value.trim()
  return (
    <label style={fieldWrap}>
      <span style={labelStyle}>
        {label}
        {required ? ' *' : ''}
      </span>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} style={inputStyle(invalid)} />
      {invalid && <span style={{ font: 'var(--font-description-l)', color: 'var(--error-default)' }}>Обязательное поле</span>}
    </label>
  )
}
