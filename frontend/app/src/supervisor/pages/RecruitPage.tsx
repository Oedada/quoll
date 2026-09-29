import { useState } from 'react'
import { useToast } from '../../manager/ToastContext'
import { ApiError } from '../../api/client'
import {
  useTeam,
  useRecruitmentPool,
  useOrphanedManagers,
  useRecruitManager,
  useAdoptManager,
  type ManagerLoadRead,
} from '../../api/org'

type Tab = 'A' | 'C'

// ManagerLoadRead не несёт role/is_active - personFullName из api/people для него не подходит
function managerFullName(m: ManagerLoadRead): string {
  const name = [m.last_name, m.first_name, m.patronymic].filter(Boolean).join(' ')
  return name || m.username || 'Менеджер'
}

const STATUS_TONE: Record<string, { bg: string; dot: string; label: string }> = {
  AVAILABLE: { bg: 'var(--success-container-default)', dot: 'var(--success-default)', label: 'Доступен' },
  SATURATED: { bg: 'var(--warning-container-default)', dot: 'var(--warning-default)', label: 'Занят: лимит' },
  UNAVAILABLE: { bg: 'var(--neutral-container-default)', dot: 'var(--neutral-muted)', label: 'Недоступен' },
  INACTIVE: { bg: 'var(--neutral-container-default)', dot: 'var(--neutral-muted)', label: 'Неактивен' },
}

const gridCols = 'minmax(160px,1.3fr) minmax(120px,.9fr) minmax(150px,1.1fr) minmax(130px,1fr) 170px'

export default function RecruitPage() {
  const toast = useToast()
  const [tab, setTab] = useState<Tab>('A')

  const { data: team } = useTeam()
  const { data: poolA, isLoading: loadingA } = useRecruitmentPool()
  const { data: poolC, isLoading: loadingC } = useOrphanedManagers()

  const recruit = useRecruitManager()
  const adopt = useAdoptManager()

  const teamSize = team?.members.length ?? 0
  const maxSubordinates = team?.max_subordinates ?? 0
  const free = Math.max(0, maxSubordinates - teamSize)
  const full = team ? free === 0 : false

  const a = poolA ?? []
  const c = poolC ?? []
  const list = tab === 'A' ? a : c
  const isLoading = tab === 'A' ? loadingA : loadingC

  function handleTake(m: ManagerLoadRead) {
    if (full) return
    if (tab === 'A') {
      recruit.mutate(m.id, {
        onSuccess: () => toast({ title: 'Менеджер в вашей команде', subtitle: managerFullName(m), colorScheme: 'success' }),
        onError: (err) =>
          toast({
            title: 'Не удалось взять менеджера',
            subtitle: err instanceof ApiError ? err.message : undefined,
            colorScheme: 'error',
          }),
      })
    } else {
      adopt.mutate(
        { managerId: m.id, expectedSuperviserId: m.superviser_id },
        {
          onSuccess: () => toast({ title: 'Менеджер усыновлён', subtitle: managerFullName(m), colorScheme: 'success' }),
          onError: (err) =>
            toast({
              title: 'Не удалось усыновить менеджера',
              subtitle: err instanceof ApiError ? err.message : undefined,
              colorScheme: 'error',
            }),
        },
      )
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
      <div
        style={{
          background: full ? 'var(--warning-container-default)' : 'var(--success-container-default)',
          borderRadius: 'var(--border-radius-l)',
          padding: '14px 20px',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
        }}
      >
        {team && (
          <span style={{ font: 'var(--font-heading-h4)', color: 'var(--fg-default)', fontVariantNumeric: 'tabular-nums' }}>
            {free} из {maxSubordinates}
          </span>
        )}
        <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-default)' }}>
          {full
            ? 'Команда заполнена: чтобы взять менеджера, освободите или передайте кого-то из своих'
            : 'свободных мест в вашей команде'}
        </span>
      </div>

      <div
        style={{
          display: 'flex',
          gap: 2,
          padding: 2,
          borderRadius: 'var(--border-radius-m)',
          background: 'var(--neutral-container-soft)',
          alignSelf: 'flex-start',
        }}
      >
        {(
          [
            ['A', 'Пул A · без руководителя', a.length],
            ['C', 'Пул C · осиротевшие', c.length],
          ] as const
        ).map(([key, label, count]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            style={{
              height: 32,
              padding: '0 14px',
              border: 0,
              borderRadius: 6,
              background: tab === key ? 'var(--bg-surface1)' : 'transparent',
              font: 'var(--font-body-s-strong)',
              color: tab === key ? 'var(--fg-default)' : 'var(--fg-soft)',
              cursor: 'pointer',
            }}
          >
            {label} <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)' }}>{count}</span>
          </button>
        ))}
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
        <div style={{ padding: '12px 8px 4px', font: 'var(--font-description-l)', color: 'var(--fg-muted)', textWrap: 'pretty' }}>
          {tab === 'A'
            ? 'Менеджеры, у которых нет руководителя. Вы берёте их вместе с текущей работой.'
            : 'Менеджеры, чей руководитель ушёл: у них есть открытая работа. «Усыновить» — взять их в свою команду.'}
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: gridCols,
            gap: 16,
            padding: '12px 8px 8px',
            font: 'var(--font-description-l)',
            color: 'var(--fg-muted)',
          }}
        >
          <span>Менеджер</span>
          <span>Статус</span>
          <span>Слоты</span>
          <span>Открытых / блокирующих</span>
          <span />
        </div>

        {!isLoading && list.length === 0 && (
          <div style={{ padding: '40px 8px', textAlign: 'center', font: 'var(--font-body-s)', color: 'var(--fg-muted)' }}>
            Здесь пока никого нет
          </div>
        )}

        {list.map((m) => {
          const tone = STATUS_TONE[m.effective_status] ?? STATUS_TONE.UNAVAILABLE
          const pct = m.max_active_projects > 0 ? Math.round((m.capacity_used / m.max_active_projects) * 100) : 0
          const bar = m.capacity_used >= m.max_active_projects ? 'var(--warning-default)' : 'var(--fg-soft)'
          const pending = tab === 'A' ? recruit.isPending : adopt.isPending
          return (
            <div
              key={m.id}
              style={{
                display: 'grid',
                gridTemplateColumns: gridCols,
                gap: 16,
                padding: '12px 8px',
                borderTop: '1px solid var(--border-muted)',
                alignItems: 'center',
              }}
            >
              <span style={{ display: 'flex', flexDirection: 'column' }}>
                <span style={{ font: 'var(--font-body-s-strong)', color: 'var(--fg-default)' }}>{managerFullName(m)}</span>
              </span>
              <span
                style={{
                  height: 22,
                  padding: '0 8px',
                  borderRadius: 'var(--border-radius-m)',
                  background: tone.bg,
                  font: 'var(--font-description-l-strong)',
                  color: 'var(--fg-default)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  justifySelf: 'start',
                }}
              >
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: tone.dot }} />
                {tone.label}
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ flex: 1, height: 6, borderRadius: 3, background: 'var(--neutral-container-default)', overflow: 'hidden' }}>
                  <div style={{ width: `${pct}%`, height: '100%', background: bar }} />
                </div>
                <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-soft)', fontVariantNumeric: 'tabular-nums' }}>
                  {m.capacity_used} / {m.max_active_projects}
                </span>
              </div>
              <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-default)', fontVariantNumeric: 'tabular-nums' }}>
                {m.open_projects} / {m.blocking_projects}
              </span>
              <button
                onClick={() => handleTake(m)}
                disabled={full || pending}
                title={full ? 'Команда заполнена' : undefined}
                style={{
                  height: 32,
                  padding: '0 12px',
                  border: 0,
                  borderRadius: 'var(--border-radius-buttons)',
                  background: 'var(--accent-default)',
                  color: '#fff',
                  font: 'var(--font-body-s-strong)',
                  cursor: full || pending ? 'default' : 'pointer',
                  whiteSpace: 'nowrap',
                  opacity: full ? 0.4 : 1,
                }}
              >
                {tab === 'A' ? 'Взять в команду' : 'Усыновить'}
              </button>
            </div>
          )
        })}
      </section>
    </div>
  )
}
