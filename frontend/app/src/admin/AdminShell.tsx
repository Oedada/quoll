import { useMemo, useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { Atomaro } from '../ds/atomaro'
import { useMe } from '../auth/useMe'
import { logout } from '../auth/authApi'
import { useUnreadCount } from '../api/notifications'
import { NotificationsPanel } from '../manager/NotificationsPanel'
import '../manager/manager.css'

interface PageMeta {
  key: string
  label: string
  icon: string
  group: string
  desc: string
}

const PAGES: Record<string, PageMeta> = {
  home: { key: 'home', label: 'Сводка здоровья', icon: 'Home', group: 'Система', desc: 'Что в системе требует внимания человека' },
  users: { key: 'users', label: 'Пользователи', icon: 'User', group: 'Система', desc: 'Учётные записи, роли и лимиты' },
  org: { key: 'org', label: 'Организация', icon: 'Group', group: 'Система', desc: 'Свободная ёмкость руководителей и фоновые действия' },
  wf: { key: 'wf', label: 'Воркфлоу', icon: 'Merge', group: 'Процессы', desc: 'Маршруты, шаги, поля и переходы' },
  tpl: { key: 'tpl', label: 'Шаблоны', icon: 'DocumentText', group: 'Процессы', desc: 'Файлы, которые менеджеры скачивают на переходах' },
  refs: { key: 'refs', label: 'Справочники', icon: 'Catalog', group: 'Процессы', desc: 'Вузы, вендоры, программы, продукты, причины и виды документов' },
  imp: { key: 'imp', label: 'Импорт', icon: 'CloudUpload', group: 'Данные', desc: 'Загрузка заявок и контактов из файлов' },
  integ: { key: 'integ', label: 'Интеграции', icon: 'Connect', group: 'Данные', desc: 'Потоки, несопоставленные записи, выгрузка и статистика LMS' },
  proposals: { key: 'proposals', label: 'Предложения интеграции', icon: 'DocumentText', group: 'Данные', desc: 'Предложения из LMS. Только просмотр' },
  all: { key: 'all', label: 'Все взаимодействия', icon: 'Portfolio', group: 'Данные', desc: 'Заявки всех команд. Только чтение' },
  reports: { key: 'reports', label: 'Отчёты', icon: 'CheckStatistics', group: 'Аккаунт', desc: 'Отчёты по всем заявкам' },
  feed: { key: 'feed', label: 'Уведомления', icon: 'Notification', group: 'Аккаунт', desc: 'Общая лента и ручная рассылка' },
  profile: { key: 'profile', label: 'Мой профиль', icon: 'User', group: 'Аккаунт', desc: 'Данные учётной записи' },
}

const NAV_KEYS = ['home', 'users', 'org', 'wf', 'tpl', 'refs', 'imp', 'integ', 'proposals', 'all', 'reports']

function Icon({ name, size = 20, fill = 'currentColor' }: { name: string; size?: number; fill?: string }) {
  const Cmp = Atomaro[name]
  if (!Cmp) return null
  return <Cmp size={size} fill={fill} />
}

function useCurrentPageKey(): string {
  const { pathname } = useLocation()
  const rest = pathname.replace(/^\/admin\/?/, '')
  const first = rest.split('/')[0]
  return first || 'home'
}

export function AdminShell() {
  const navigate = useNavigate()
  const { data: me } = useMe()
  const { data: unread } = useUnreadCount()
  const [collapsed, setCollapsed] = useState(false)
  const [notifOpen, setNotifOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)

  const pageKey = useCurrentPageKey()
  const isDetail = /^all\/\d+/.test(useLocation().pathname.replace(/^\/admin\/?/, ''))
  const page = PAGES[pageKey] ?? PAGES.home

  const initials = useMemo(() => {
    if (!me) return ''
    return `${me.first_name?.[0] ?? ''}${me.last_name?.[0] ?? ''}`.toUpperCase() || (me.username ?? '?')[0].toUpperCase()
  }, [me])

  const fullName = me ? `${me.last_name} ${me.first_name} ${me.patronymic}`.trim() || me.username : ''

  const sideW = collapsed ? 72 : 256

  return (
    <div style={{ display: 'flex', height: '100vh', minWidth: 1280, background: 'var(--bg-page)', overflow: 'hidden', position: 'relative' }}>
      <aside
        style={{
          width: sideW,
          flex: 'none',
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--bg-surface2)',
          borderRight: '1px solid var(--border-muted)',
          transition: 'width .18s ease',
          position: 'relative',
          zIndex: 3,
        }}
      >
        <div style={{ height: 64, display: 'flex', alignItems: 'center', gap: 12, padding: `0 ${collapsed ? 20 : 16}px` }}>
          <div style={{ width: 32, height: 32, flex: 'none', borderRadius: 'var(--border-radius-l)', background: 'var(--fg-default)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="RostelecomFill" size={20} fill="#fff" />
          </div>
          {!collapsed && (
            <>
              <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
                <span style={{ display: 'flex', alignItems: 'baseline', gap: 6, whiteSpace: 'nowrap' }}>
                  <span style={{ font: 'var(--font-heading-h5)', color: 'var(--fg-default)' }}>ИТ-школа</span>
                  <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)' }}>quoll</span>
                </span>
                <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)', whiteSpace: 'nowrap' }}>Работа с вузами</span>
              </div>
              <button
                className="icon-btn"
                onClick={() => setCollapsed(true)}
                title="Свернуть меню"
                style={{ width: 28, height: 28, border: 0, borderRadius: 'var(--border-radius-m)', background: 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
              >
                <Icon name="ChevronLeft16" size={16} fill="var(--fg-soft)" />
              </button>
            </>
          )}
        </div>

        <nav style={{ flex: 1, overflowY: 'auto', padding: `12px ${collapsed ? 14 : 12}px`, display: 'flex', flexDirection: 'column', gap: 2 }}>
          {NAV_KEYS.map((key) => {
            const p = PAGES[key]
            const active = key === pageKey
            return (
              <button
                key={key}
                className={`nav-item${active ? ' active' : ''}`}
                onClick={() => navigate(key === 'home' ? '/admin' : `/admin/${key}`)}
                title={p.label}
                style={{
                  position: 'relative',
                  height: 40,
                  border: 0,
                  borderRadius: 'var(--border-radius-l)',
                  background: 'transparent',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '0 10px',
                  cursor: 'pointer',
                  textAlign: 'left',
                  width: '100%',
                  marginTop: key === 'wf' || key === 'imp' || key === 'reports' ? 16 : 0,
                }}
              >
                <Icon name={p.icon} size={20} fill={active ? 'var(--fg-soft)' : 'var(--fg-muted)'} />
                {!collapsed && (
                  <span style={{ flex: 1, font: 'var(--font-body-s-strong)', color: active ? 'var(--fg-default)' : 'var(--fg-soft)', whiteSpace: 'nowrap' }}>
                    {p.label}
                  </span>
                )}
              </button>
            )
          })}
        </nav>

        {collapsed && (
          <div style={{ padding: '8px 12px', display: 'flex', justifyContent: 'center' }}>
            <button className="icon-btn" onClick={() => setCollapsed(false)} title="Развернуть меню" style={{ width: 40, height: 32, border: 0, borderRadius: 'var(--border-radius-m)', background: 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
              <Icon name="ChevronRight16" size={16} fill="var(--fg-soft)" />
            </button>
          </div>
        )}

        <div style={{ padding: `8px ${collapsed ? 14 : 12}px 12px`, position: 'relative' }}>
          <button
            className="profile-block"
            onClick={() => {
              setProfileOpen((v) => !v)
              setNotifOpen(false)
            }}
            style={{ width: '100%', border: 0, background: profileOpen ? 'var(--neutral-container-default)' : 'transparent', borderRadius: 'var(--border-radius-l)', padding: '6px 8px', display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', textAlign: 'left' }}
          >
            <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--neutral-container-default)', color: 'var(--fg-soft)', font: 'var(--font-description-l-strong)', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>
              {initials}
            </div>
            {!collapsed && (
              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                <span style={{ font: 'var(--font-body-s-strong)', color: 'var(--fg-default)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{fullName}</span>
                <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)', whiteSpace: 'nowrap' }}>Администратор</span>
              </div>
            )}
          </button>

          {profileOpen && (
            <div style={{ position: 'absolute', left: collapsed ? 14 : 12, bottom: 80, width: 320, background: 'var(--bg-elevated-m)', borderRadius: 'var(--border-radius-xl)', boxShadow: 'var(--shadow-bottom-l)', border: '1px solid var(--border-muted)', zIndex: 20, overflow: 'hidden' }}>
              <button
                className="popover-row"
                onClick={() => {
                  navigate('/admin/profile')
                  setProfileOpen(false)
                }}
                style={{ width: '100%', border: 0, background: 'transparent', padding: 16, display: 'flex', gap: 12, alignItems: 'center', cursor: 'pointer', textAlign: 'left' }}
              >
                <div style={{ width: 48, height: 48, flex: 'none', borderRadius: '50%', background: 'var(--neutral-container-default)', color: 'var(--fg-soft)', font: 'var(--font-heading-h4)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {initials}
                </div>
                <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{ font: 'var(--font-heading-h5)', color: 'var(--fg-default)' }}>{fullName}</span>
                  <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)' }}>{me?.email}</span>
                </div>
                <Icon name="ChevronRight16" size={16} fill="var(--fg-muted)" />
              </button>
              <div style={{ borderTop: '1px solid var(--border-muted)', padding: 6 }}>
                <button
                  className="logout-row"
                  onClick={() => logout().then(() => (window.location.href = '/'))}
                  style={{ width: '100%', height: 36, border: 0, background: 'transparent', borderRadius: 'var(--border-radius-m)', display: 'flex', alignItems: 'center', gap: 12, padding: '0 8px', cursor: 'pointer', font: 'var(--font-body-s)', color: 'var(--error-default)' }}
                >
                  <Icon name="SignOut16" size={16} fill="var(--error-default)" />
                  Выйти
                </button>
              </div>
            </div>
          )}
        </div>
      </aside>

      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <header style={{ height: 64, flex: 'none', display: 'flex', alignItems: 'center', gap: 16, padding: '0 24px', background: 'var(--bg-surface2)', position: 'relative', zIndex: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: 1 }}>
            <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-muted)', whiteSpace: 'nowrap' }}>{page.group}</span>
            <Icon name="ChevronRight16" size={16} fill="var(--fg-muted)" />
            <span style={{ font: 'var(--font-body-s-strong)', color: 'var(--fg-default)', whiteSpace: 'nowrap' }}>{page.label}</span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
            <button className="icon-btn" title="Справка" style={{ width: 36, height: 36, border: 0, borderRadius: 'var(--border-radius-l)', background: 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
              <Icon name="HelpStroke" size={20} fill="var(--fg-muted)" />
            </button>
            <button
              className="icon-btn"
              onClick={() => {
                setNotifOpen((v) => !v)
                setProfileOpen(false)
              }}
              title="Уведомления"
              style={{ position: 'relative', width: 36, height: 36, border: 0, borderRadius: 'var(--border-radius-l)', background: notifOpen ? 'var(--neutral-container-soft)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
            >
              <Icon name="Notification" size={20} fill={notifOpen ? 'var(--fg-default)' : 'var(--fg-soft)'} />
              {!!unread?.total && (
                <span
                  style={{
                    position: 'absolute',
                    top: 4,
                    right: 3,
                    minWidth: 12,
                    height: 12,
                    padding: '0 3px',
                    borderRadius: 6,
                    background: 'var(--accent-default)',
                    border: '1.5px solid var(--bg-surface2)',
                    boxSizing: 'content-box',
                    color: '#fff',
                    font: '600 9px/12px Manrope,sans-serif',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {unread.total > 9 ? '9+' : unread.total}
                </span>
              )}
            </button>
          </div>
        </header>

        <main style={{ flex: 1, overflow: 'auto', background: 'var(--bg-surface2)', padding: '24px 32px 32px', display: 'flex', flexDirection: 'column', gap: 20 }}>
          {!isDetail && page.key !== 'home' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <h1 style={{ margin: 0, font: 'var(--font-heading-h1)', color: 'var(--fg-default)' }}>{page.label}</h1>
              {page.desc && <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-soft)' }}>{page.desc}</span>}
            </div>
          )}
          <Outlet />
        </main>

        {notifOpen && <NotificationsPanel onClose={() => setNotifOpen(false)} />}
      </div>
    </div>
  )
}

