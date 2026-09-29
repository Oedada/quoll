import { Atomaro } from '../../ds/atomaro'
import { useMe } from '../../auth/useMe'
import { useProfile } from '../../api/org'
import { personFullName } from '../../api/people'

const ROLE_LABEL: Record<string, string> = {
  manager: 'Менеджер',
  superviser: 'Руководитель',
  admin: 'Администратор',
}

function profileRow(label: string, value: string, color = 'var(--fg-default)') {
  return (
    <div
      key={label}
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        gap: 16,
        padding: '12px 0',
        borderTop: '1px solid var(--border-muted)',
      }}
    >
      <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-muted)' }}>{label}</span>
      <span style={{ font: 'var(--font-body-s-strong)', color, textAlign: 'right' }}>{value}</span>
    </div>
  )
}

// "Синхронизация с Keycloak" из дизайна отражает identity_sync_status из ProfileRead
// (бэкенд использует его же для сигнала конфликта роли у менеджера/руководителя).
function syncLabel(status: string): { text: string; color: string } {
  return status === 'OK'
    ? { text: 'В порядке', color: 'var(--success-default)' }
    : { text: 'Расхождение', color: 'var(--error-default)' }
}

function transitionLabel(status: string): string {
  return status === 'NONE' ? 'Нет' : 'Идёт'
}

export default function AdminProfilePage() {
  const { data: me, isLoading: meLoading } = useMe()
  const { data: profile, isLoading: profileLoading } = useProfile(me?.id)

  if (meLoading || profileLoading || !me || !profile) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
        <Atomaro.Loader size="m" />
      </div>
    )
  }

  const fullName = personFullName(me)
  const initials = `${me.first_name[0] ?? ''}${me.last_name[0] ?? ''}` || (me.username?.[0] ?? '?').toUpperCase()
  const sync = syncLabel(profile.identity_sync_status)

  return (
    <div style={{ maxWidth: 1040 }}>
      <section
        style={{
          background: 'var(--bg-surface1)',
          border: '1px solid var(--border-muted)',
          borderRadius: 'var(--border-radius-l)',
          padding: 24,
          display: 'flex',
          flexDirection: 'column',
          gap: 20,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <span
            style={{
              width: 64,
              height: 64,
              borderRadius: '50%',
              background: 'var(--neutral-container-default)',
              color: 'var(--fg-soft)',
              font: 'var(--font-heading-h2)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            {initials}
          </span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ font: 'var(--font-heading-h3)', color: 'var(--fg-default)' }}>{fullName}</span>
            <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-soft)' }}>
              {ROLE_LABEL[me.role] ?? me.role}
            </span>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {profileRow('Логин', me.username ?? '—')}
          {profileRow('Почта', me.email ?? '—')}
          {profileRow('Роль', ROLE_LABEL[me.role] ?? me.role)}
          {profileRow('Доступ', 'Все разделы')}
          {profileRow('Учётная запись', profile.is_active ? 'Активна' : 'Отключена', profile.is_active ? 'var(--success-default)' : 'var(--error-default)')}
          {profileRow('Синхронизация с Keycloak', sync.text, sync.color)}
          {profileRow('Смена роли', transitionLabel(profile.role_transition_status))}
        </div>
      </section>

      {/* Правая колонка "Загрузка" (КАМы/просьбы/зависшие) в дизайне относится к
          руководителю - у администратора нет команды и своей загрузки, секция пропущена. */}
    </div>
  )
}
