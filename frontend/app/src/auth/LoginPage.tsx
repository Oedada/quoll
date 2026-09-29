import { useEffect, useState } from 'react'
import { fetchDemoAccounts, goToKeycloakLogin } from './authApi'
import type { DemoAccount } from '../api/types'

// вёрстка и текст - точная копия экрана "login" из Вход и блокировки.dc.html
const ROLE_LABEL: Record<DemoAccount['role'], string> = {
  manager: 'Менеджер',
  superviser: 'Руководитель',
  admin: 'Администратор',
}

function initialsFor(role: DemoAccount['role']) {
  return ROLE_LABEL[role][0]
}

export function LoginPage() {
  const [demo, setDemo] = useState<DemoAccount[]>([])
  const [picked, setPicked] = useState<DemoAccount | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    fetchDemoAccounts().then(setDemo)
  }, [])

  const copyPass = async () => {
    if (!picked) return
    try {
      await navigator.clipboard.writeText(picked.password)
    } catch {
      // буфер обмена недоступен (нет разрешения/не https) - молча игнорируем,
      // пароль всё равно виден на экране
    }
    setCopied(true)
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'var(--bg-surface2)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 24,
        padding: '48px 24px 96px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: 'var(--border-radius-l)',
            background: 'var(--fg-default)',
          }}
        />
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span style={{ font: 'var(--font-heading-h5)', color: 'var(--fg-default)' }}>ИТ-школа</span>
          <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)' }}>Работа с вузами</span>
        </div>
      </div>

      <main
        style={{
          width: '100%',
          maxWidth: 440,
          background: 'var(--bg-surface1)',
          border: '1px solid var(--border-muted)',
          borderRadius: 'var(--border-radius-xl)',
          padding: 32,
          display: 'flex',
          flexDirection: 'column',
          gap: 24,
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <h1 style={{ margin: 0, font: 'var(--font-heading-h2)', color: 'var(--fg-default)' }}>Вход в систему</h1>
        </div>

        <a
          href="/auth/"
          onClick={(e) => {
            e.preventDefault()
            goToKeycloakLogin()
          }}
          style={{
            height: 48,
            borderRadius: 'var(--border-radius-buttons)',
            background: 'var(--accent-default)',
            color: '#fff',
            font: 'var(--font-body-m-strong)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            textDecoration: 'none',
          }}
        >
          Войти через Keycloak
        </a>

        {demo.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ font: 'var(--font-body-s-strong)', color: 'var(--fg-default)' }}>Демо-аккаунты</span>
              <span
                style={{
                  height: 20,
                  padding: '0 8px',
                  borderRadius: 'var(--border-radius-m)',
                  background: 'var(--warning-container-default)',
                  font: 'var(--font-description-l-strong)',
                  color: 'var(--fg-default)',
                  display: 'flex',
                  alignItems: 'center',
                }}
              >
                Только dev
              </span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {demo.map((d) => (
                <button
                  key={d.username}
                  onClick={() => {
                    setPicked(d)
                    setCopied(false)
                  }}
                  style={{
                    border: 0,
                    background: picked?.username === d.username ? 'var(--neutral-container-soft)' : 'transparent',
                    borderRadius: 'var(--border-radius-m)',
                    padding: 8,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    cursor: 'pointer',
                    textAlign: 'left',
                  }}
                >
                  <span
                    style={{
                      width: 32,
                      height: 32,
                      flex: 'none',
                      borderRadius: '50%',
                      background: 'var(--neutral-container-default)',
                      color: 'var(--fg-soft)',
                      font: 'var(--font-description-l-strong)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {initialsFor(d.role)}
                  </span>
                  <span style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                    <span style={{ font: 'var(--font-body-s-strong)', color: 'var(--fg-default)' }}>
                      {ROLE_LABEL[d.role]}
                    </span>
                    <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)' }}>{d.username}</span>
                  </span>
                </button>
              ))}
            </div>

            {picked && (
              <div
                style={{
                  background: 'var(--bg-surface2)',
                  borderRadius: 'var(--border-radius-m)',
                  padding: 12,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                }}
              >
                <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-soft)' }}>
                  Введите на странице Keycloak
                </span>
                <div style={{ display: 'flex', justifyContent: 'space-between', font: 'var(--font-body-s)' }}>
                  <span style={{ color: 'var(--fg-muted)' }}>Логин</span>
                  <b style={{ fontWeight: 600, color: 'var(--fg-default)' }}>{picked.username}</b>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', font: 'var(--font-body-s)' }}>
                  <span style={{ color: 'var(--fg-muted)' }}>Пароль</span>
                  <b style={{ fontWeight: 600, color: 'var(--fg-default)' }}>{picked.password}</b>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    onClick={copyPass}
                    style={{
                      height: 32,
                      padding: '0 12px',
                      border: '1px solid var(--border-soft)',
                      borderRadius: 'var(--border-radius-buttons)',
                      background: 'var(--bg-surface1)',
                      color: 'var(--fg-default)',
                      font: 'var(--font-body-s-strong)',
                      cursor: 'pointer',
                    }}
                  >
                    {copied ? 'Скопировано' : 'Скопировать пароль'}
                  </button>
                  <a
                    href="/auth/"
                    onClick={(e) => {
                      e.preventDefault()
                      goToKeycloakLogin()
                    }}
                    style={{
                      height: 32,
                      padding: '0 12px',
                      borderRadius: 'var(--border-radius-buttons)',
                      background: 'var(--fg-default)',
                      color: '#fff',
                      font: 'var(--font-body-s-strong)',
                      display: 'flex',
                      alignItems: 'center',
                      textDecoration: 'none',
                    }}
                  >
                    Продолжить
                  </a>
                </div>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  )
}
