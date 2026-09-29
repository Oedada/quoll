import { Atomaro } from '../../ds/atomaro'
import { useMe } from '../../auth/useMe'
import { useProfile } from '../../api/org'
import { usePeople, personFullName } from '../../api/people'

const ROLE_LABEL: Record<string, string> = {
  manager: 'Менеджер',
  superviser: 'Руководитель',
  admin: 'Администратор',
}

function fieldRow(label: string, value: string) {
  return (
    <div key={label} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)' }}>{label}</span>
      <span style={{ font: 'var(--font-body-s-strong)', color: 'var(--fg-default)' }}>{value}</span>
    </div>
  )
}

export default function ProfilePage() {
  const { data: me, isLoading: meLoading } = useMe()
  const { data: profile, isLoading: profileLoading } = useProfile(me?.id)
  const { data: people } = usePeople([me?.superviser_id])
  const supervisor = people?.[0]

  if (meLoading || profileLoading || !me || !profile) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
        <Atomaro.Loader size="m" />
      </div>
    )
  }

  const fullName = [me.last_name, me.first_name, me.patronymic].filter(Boolean).join(' ') || me.username || me.id

  const hasConflict = profile.identity_sync_status !== 'OK'
  const hasTransition = profile.role_transition_status !== 'NONE'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 1040 }}>
      {(hasConflict || hasTransition) && (
        <div
          style={{
            background: hasConflict ? 'var(--error-container-default)' : 'var(--warning-container-default)',
            borderRadius: 'var(--border-radius-l)',
            padding: '16px 20px',
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
          }}
        >
          <span style={{ font: 'var(--font-body-s-strong)', color: 'var(--fg-default)' }}>
            {hasConflict ? 'Роль не согласована с Keycloak' : 'Идёт смена роли'}
          </span>
          <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-soft)', textWrap: 'pretty' }}>
            {hasConflict
              ? 'Обратитесь к администратору: работа с заявками ограничена.'
              : 'Руководитель разбирает вашу текущую работу. До завершения доступ ограничен.'}
          </span>
        </div>
      )}

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
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span
            style={{
              width: 48,
              height: 48,
              borderRadius: '50%',
              background: 'var(--neutral-container-default)',
              color: 'var(--fg-soft)',
              font: 'var(--font-heading-h4)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            {`${me.first_name[0] ?? ''}${me.last_name[0] ?? ''}` || (me.username?.[0] ?? '?').toUpperCase()}
          </span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ font: 'var(--font-heading-h4)', color: 'var(--fg-default)' }}>{fullName}</span>
            <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-soft)' }}>
              {ROLE_LABEL[me.role] ?? me.role}
            </span>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 16 }}>
          {fieldRow('Логин', me.username ?? '—')}
          {fieldRow('Email', me.email ?? '—')}
        </div>
      </section>

      <section
        style={{
          background: 'var(--bg-surface1)',
          border: '1px solid var(--border-muted)',
          borderRadius: 'var(--border-radius-l)',
          padding: 24,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span
            style={{
              width: 40,
              height: 40,
              borderRadius: '50%',
              background: 'var(--neutral-container-default)',
              color: 'var(--fg-soft)',
              font: 'var(--font-body-s-strong)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {supervisor
              ? `${supervisor.first_name[0] ?? ''}${supervisor.last_name[0] ?? ''}` || 'Р'
              : '—'}
          </span>
          <span style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)' }}>
              Мой руководитель
            </span>
            <span
              style={{
                font: 'var(--font-body-s-strong)',
                color: me.superviser_id ? 'var(--fg-default)' : 'var(--fg-muted)',
              }}
            >
              {me.superviser_id ? (supervisor ? personFullName(supervisor) : '…') : 'Не назначен'}
            </span>
          </span>
        </div>
      </section>

      {profile.load && (
        <section
          style={{
            background: 'var(--bg-surface1)',
            border: '1px solid var(--border-muted)',
            borderRadius: 'var(--border-radius-l)',
            padding: 24,
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
          }}
        >
          <span style={{ font: 'var(--font-heading-h4)', color: 'var(--fg-default)' }}>Загрузка</span>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 16 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ font: 'var(--font-heading-h2)', color: 'var(--fg-default)' }}>
                {profile.load.capacity_used}/{profile.load.max_active_projects}
              </span>
              <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)' }}>
                Слотов занято
              </span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ font: 'var(--font-heading-h2)', color: 'var(--fg-default)' }}>
                {profile.load.open_projects}
              </span>
              <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)' }}>
                Открытых проектов
              </span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ font: 'var(--font-heading-h2)', color: 'var(--fg-default)' }}>
                {profile.load.blocking_projects}
              </span>
              <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)' }}>
                Блокирующих
              </span>
            </div>
          </div>
        </section>
      )}

      {/* Личный чек-лист задач и календарь встреч из прототипа пропущены: это
          декоративный мок, для них нет эндпоинта в бэкенде. */}
    </div>
  )
}
