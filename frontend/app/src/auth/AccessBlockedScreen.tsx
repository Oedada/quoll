import { useState } from 'react'
import { logout } from './authApi'

// экраны 403/409/деактивирован из Вход и блокировки.dc.html - блокирующие
// состояния, которые /users/me может вернуть вместо профиля
export type BlockedKind = '403' | '409' | 'deactivated'

const SHELL: React.CSSProperties = {
  minHeight: '100vh',
  background: 'var(--bg-surface2)',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 24,
  padding: '48px 24px 96px',
}

const CARD: React.CSSProperties = {
  width: '100%',
  maxWidth: 480,
  background: 'var(--bg-surface1)',
  border: '1px solid var(--border-muted)',
  borderRadius: 'var(--border-radius-xl)',
  padding: 32,
  display: 'flex',
  flexDirection: 'column',
  gap: 24,
}

function RoleTransitionBlock() {
  const [checking, setChecking] = useState(false)
  const [attempts, setAttempts] = useState(0)

  const retry = () => {
    if (checking) return
    setChecking(true)
    window.location.reload()
  }

  return (
    <>
      <Header title="Идёт смена роли" text="Администратор меняет вашу роль. Пока руководитель не разберёт вашу текущую работу, доступ закрыт полностью, в том числе на чтение." />
      {attempts > 0 && (
        <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-default)' }}>
          Смена роли ещё не завершена. Проверили ещё раз {attempts} раз.
        </span>
      )}
      <Actions
        primary={{ label: checking ? 'Проверяем…' : 'Повторить', onClick: () => { setAttempts((a) => a + 1); retry() } }}
        secondary={{ label: 'Выйти', onClick: () => logout().then(() => window.location.reload()) }}
      />
      <Meta text="HTTP 409 · Role transition in progress" />
    </>
  )
}

function Header({ title, text }: { title: string; text: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <h1 style={{ margin: 0, font: 'var(--font-heading-h2)', color: 'var(--fg-default)' }}>{title}</h1>
      <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-soft)' }}>{text}</span>
    </div>
  )
}

function Actions({
  primary,
  secondary,
}: {
  primary: { label: string; onClick: () => void }
  secondary?: { label: string; onClick: () => void }
}) {
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      <button
        onClick={primary.onClick}
        style={{
          height: 40,
          padding: '0 20px',
          border: '1px solid var(--accent-default)',
          borderRadius: 'var(--border-radius-buttons)',
          background: 'var(--accent-default)',
          color: '#fff',
          font: 'var(--font-body-s-strong)',
          cursor: 'pointer',
        }}
      >
        {primary.label}
      </button>
      {secondary && (
        <button
          onClick={secondary.onClick}
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
          {secondary.label}
        </button>
      )}
    </div>
  )
}

function Meta({ text }: { text: string }) {
  return <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)' }}>{text}</span>
}

export function AccessBlockedScreen({ kind }: { kind: BlockedKind }) {
  return (
    <div style={SHELL}>
      <main style={CARD}>
        {kind === '403' && (
          <>
            <Header
              title="Роль не согласована с Keycloak"
              text="У учётной записи должна быть ровно одна роль приложения, а сейчас их несколько или нет ни одной. Доступ закрыт, пока администратор не исправит роль в Keycloak."
            />
            <Actions
              primary={{ label: 'Написать администратору', onClick: () => {} }}
              secondary={{ label: 'Выйти', onClick: () => logout().then(() => window.location.reload()) }}
            />
            <Meta text="HTTP 403 · Account role mapping is inconsistent" />
          </>
        )}
        {kind === '409' && <RoleTransitionBlock />}
        {kind === 'deactivated' && (
          <>
            <Header
              title="Аккаунт деактивирован"
              text="Учётная запись отключена, доступ закрыт. Если это ошибка, обратитесь к руководителю или администратору."
            />
            <Actions primary={{ label: 'Выйти', onClick: () => logout().then(() => (window.location.href = '/')) }} />
            <Meta text="HTTP 401 · Not authenticated · is_active = false" />
          </>
        )}
      </main>
    </div>
  )
}
