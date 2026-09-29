import { Atomaro } from '../../ds/atomaro'
import { useMe } from '../../auth/useMe'
import { useProfile, useSetMyWorkload } from '../../api/org'
import type { EffectiveStatus } from '../../api/org'
import { usePeople, personFullName } from '../../api/people'
import { useToast } from '../ToastContext'

const EFF: Record<EffectiveStatus, ['neutral' | 'success' | 'warning' | 'error', string]> = {
  AVAILABLE: ['success', 'Доступен'],
  SATURATED: ['warning', 'Слоты заняты'],
  UNAVAILABLE: ['neutral', 'Недоступен'],
  INACTIVE: ['error', 'Отключён'],
}

const TONE: Record<'neutral' | 'success' | 'warning' | 'error', [string, string]> = {
  neutral: ['var(--neutral-container-default)', 'var(--neutral-muted)'],
  success: ['var(--success-container-default)', 'var(--success-default)'],
  warning: ['var(--warning-container-default)', 'var(--warning-default)'],
  error: ['var(--error-container-default)', 'var(--error-default)'],
}

const EFF_WHY: Record<EffectiveStatus, (freeSlots: number) => string> = {
  AVAILABLE: (free) => `Вы готовы принимать заявки. Свободных слотов: ${free}.`,
  SATURATED: () => 'Все активные слоты заняты. Новые заявки не назначаются, пока не освободится слот.',
  UNAVAILABLE: () => 'Вы отключили приём. Руководитель не видит вас в пуле назначений.',
  INACTIVE: () => 'Учётная запись отключена или роль настроена с ошибкой.',
}

export default function StatusPage() {
  const { data: me } = useMe()
  const { data: profile, isLoading } = useProfile(me?.id)
  const setWorkload = useSetMyWorkload()
  const toast = useToast()
  const { data: people } = usePeople([me?.superviser_id])
  const supervisor = people?.[0]

  if (isLoading || !profile) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
        <Atomaro.Loader size="m" />
      </div>
    )
  }

  const load = profile.load
  if (!load) {
    // нет данных о нагрузке - профиль без роли менеджера
    return (
      <div style={{ font: 'var(--font-body-s)', color: 'var(--fg-muted)' }}>
        Для этой учётной записи нет данных о загрузке.
      </div>
    )
  }

  const manual = load.manual_workload_status
  const used = load.capacity_used
  const max = load.max_active_projects
  const pct = max > 0 ? Math.round((used / max) * 100) : 0
  const [tone, effLabel] = EFF[load.effective_status]
  const why = EFF_WHY[load.effective_status](Math.max(max - used, 0))

  const options: Array<{ key: 'available' | 'unavailable'; label: string }> = [
    { key: 'available', label: 'Доступен' },
    { key: 'unavailable', label: 'Недоступен' },
  ]

  const pick = (key: 'available' | 'unavailable') => {
    if (key === manual || setWorkload.isPending) return
    setWorkload.mutate(key, {
      onSuccess: () => toast({ title: 'Статус обновлён', colorScheme: 'success' }),
      onError: (e) => toast({ title: 'Не удалось обновить статус', subtitle: String(e), colorScheme: 'error' }),
    })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 1040 }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)',
          gap: 16,
          alignItems: 'stretch',
        }}
      >
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
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ font: 'var(--font-heading-h4)', color: 'var(--fg-default)' }}>
              Приём новых заявок
            </span>
            <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-soft)' }}>
              Вы решаете, назначает ли вам руководитель новые заявки.
            </span>
          </div>
          <div
            style={{
              display: 'flex',
              gap: 2,
              padding: 2,
              borderRadius: 'var(--border-radius-l)',
              background: 'var(--neutral-container-soft)',
              alignSelf: 'flex-start',
            }}
          >
            {options.map((o) => (
              <button
                key={o.key}
                onClick={() => pick(o.key)}
                disabled={setWorkload.isPending}
                style={{
                  height: 36,
                  padding: '0 20px',
                  border: 0,
                  borderRadius: 'var(--border-radius-m)',
                  background: manual === o.key ? 'var(--bg-surface1)' : 'transparent',
                  font: 'var(--font-body-s-strong)',
                  color: manual === o.key ? 'var(--fg-default)' : 'var(--fg-soft)',
                  cursor: setWorkload.isPending ? 'default' : 'pointer',
                }}
              >
                {o.label}
              </button>
            ))}
          </div>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              background: 'var(--bg-surface2)',
              borderRadius: 'var(--border-radius-m)',
              padding: 16,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)' }}>
                Итоговый статус
              </span>
              <span
                style={{
                  height: 22,
                  padding: '0 8px',
                  borderRadius: 'var(--border-radius-m)',
                  background: TONE[tone][0],
                  font: 'var(--font-description-l-strong)',
                  color: 'var(--fg-default)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: TONE[tone][1] }} />
                {effLabel}
              </span>
            </div>
            <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-soft)', textWrap: 'pretty' }}>
              {why}
            </span>
          </div>
        </section>
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
          <span style={{ font: 'var(--font-heading-h4)', color: 'var(--fg-default)' }}>Слоты</span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span
                style={{
                  font: 'var(--font-display-s-strong)',
                  color: 'var(--fg-default)',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {used}
              </span>
              <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-soft)' }}>из {max} активных</span>
            </div>
            <div
              style={{
                height: 6,
                borderRadius: 3,
                background: 'var(--neutral-container-default)',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  width: `${pct}%`,
                  height: '100%',
                  background: 'var(--neutral-muted)',
                  borderRadius: 3,
                }}
              />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 16 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ font: 'var(--font-heading-h2)', color: 'var(--fg-default)' }}>
                {load.open_projects}
              </span>
              <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)' }}>
                Открытых проектов
              </span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ font: 'var(--font-heading-h2)', color: 'var(--fg-default)' }}>
                {load.blocking_projects}
              </span>
              <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)' }}>
                Блокирующих
              </span>
            </div>
          </div>
          <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)', textWrap: 'pretty' }}>
            Лимит меняет только администратор.
          </span>
        </section>
      </div>
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
            {supervisor ? `${supervisor.first_name[0] ?? ''}${supervisor.last_name[0] ?? ''}` : '—'}
          </span>
          <span style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)' }}>
              Мой руководитель
            </span>
            <span
              style={{
                font: 'var(--font-body-s-strong)',
                color: me?.superviser_id ? 'var(--fg-default)' : 'var(--fg-muted)',
              }}
            >
              {me?.superviser_id ? (supervisor ? personFullName(supervisor) : '…') : 'Не назначен'}
            </span>
          </span>
        </div>
        {!me?.superviser_id && (
          <span
            style={{
              height: 22,
              padding: '0 8px',
              borderRadius: 'var(--border-radius-m)',
              background: 'var(--warning-container-default)',
              font: 'var(--font-description-l-strong)',
              color: 'var(--fg-default)',
              display: 'flex',
              alignItems: 'center',
            }}
          >
            Без руководителя
          </span>
        )}
      </section>
    </div>
  )
}
