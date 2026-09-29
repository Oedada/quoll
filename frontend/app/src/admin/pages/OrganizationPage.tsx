import {
  useAvailableProjectCapacity,
  useAvailableTeamQuota,
  usePendingActions,
  type PendingActionRead,
} from '../../api/org'
import { usePeople, personFullName } from '../../api/people'

const ACTION_TYPE_LABEL: Record<string, string> = {
  OFFBOARDING_MANAGER: 'Увольнение',
  OFFBOARDING_SUPERVISER: 'Увольнение',
  ROLE_TRANSITION: 'Смена роли',
}

const STATUS_LABEL: Record<string, string> = {
  PENDING: 'Ожидает',
  IN_PROGRESS: 'Повтор',
  COMPLETED: 'Выполнено',
  CANCELLED: 'Отменено',
  FAILED: 'Ошибка',
}

const STATUS_BG: Record<string, string> = {
  PENDING: 'var(--warning-container-default)',
  IN_PROGRESS: 'var(--warning-container-default)',
  COMPLETED: 'var(--success-container-default)',
  CANCELLED: 'var(--bg-surface2)',
  FAILED: 'var(--error-container-default)',
}

function formatDateTime(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return `${d.toLocaleDateString('ru-RU')}, ${d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`
}

export default function OrganizationPage() {
  const { data: capacity, isLoading: capacityLoading } = useAvailableProjectCapacity()
  const { data: quota, isLoading: quotaLoading } = useAvailableTeamQuota()
  const { data: actions, isLoading: actionsLoading } = usePendingActions()

  const peopleIds = (actions ?? []).flatMap((a) => [a.target_id, a.origin_supervisor_id])
  const { data: people } = usePeople(peopleIds)
  const peopleById = new Map((people ?? []).map((p) => [p.id, p]))
  const nameOf = (id: string | null) => (id ? (peopleById.get(id) ? personFullName(peopleById.get(id)!) : id) : '—')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 16, alignItems: 'start' }}>
        <section
          style={{
            background: 'var(--bg-surface1)',
            border: '1px solid var(--border-muted)',
            borderRadius: 'var(--border-radius-l)',
            padding: 20,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ font: 'var(--font-heading-h4)', color: 'var(--fg-default)' }}>Свободная ёмкость по проектам</span>
            <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)' }}>
              Свободные слоты у готовых менеджеров каждого руководителя
            </span>
          </div>
          {capacityLoading && (
            <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-muted)', padding: '10px 0' }}>Загрузка…</span>
          )}
          {!capacityLoading && (capacity ?? []).length === 0 && (
            <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-muted)', padding: '10px 0' }}>Нет руководителей</span>
          )}
          {(capacity ?? []).map((r) => (
            <div
              key={r.id}
              style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '10px 0', borderTop: '1px solid var(--border-muted)' }}
            >
              <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-default)' }}>
                {personFullName({ id: r.id, first_name: r.first_name, last_name: r.last_name, patronymic: r.patronymic, role: 'superviser', is_active: true })}
              </span>
              <span style={{ font: 'var(--font-body-s-strong)', color: 'var(--fg-default)', fontVariantNumeric: 'tabular-nums' }}>
                {r.free_project_slots}
              </span>
            </div>
          ))}
        </section>
        <section
          style={{
            background: 'var(--bg-surface1)',
            border: '1px solid var(--border-muted)',
            borderRadius: 'var(--border-radius-l)',
            padding: 20,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ font: 'var(--font-heading-h4)', color: 'var(--fg-default)' }}>Свободные места в командах</span>
            <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)' }}>
              Сколько ещё менеджеров может взять каждый руководитель
            </span>
          </div>
          {quotaLoading && (
            <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-muted)', padding: '10px 0' }}>Загрузка…</span>
          )}
          {!quotaLoading && (quota ?? []).length === 0 && (
            <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-muted)', padding: '10px 0' }}>Нет руководителей</span>
          )}
          {(quota ?? []).map((r) => (
            <div
              key={r.id}
              style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '10px 0', borderTop: '1px solid var(--border-muted)' }}
            >
              <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-default)' }}>
                {personFullName({ id: r.id, first_name: r.first_name, last_name: r.last_name, patronymic: r.patronymic, role: 'superviser', is_active: true })}
              </span>
              <span style={{ font: 'var(--font-body-s-strong)', color: 'var(--fg-default)', fontVariantNumeric: 'tabular-nums' }}>
                {r.free_places}
              </span>
            </div>
          ))}
        </section>
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
        <div style={{ padding: '12px 8px 4px', display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ font: 'var(--font-heading-h4)', color: 'var(--fg-default)' }}>Ожидающие действия</span>
          <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)' }}>По всей системе: увольнения и смены ролей</span>
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(120px,1fr) minmax(140px,1fr) minmax(140px,1fr) minmax(100px,.8fr) 80px minmax(130px,1fr) minmax(180px,1.3fr)',
            gap: 16,
            padding: '12px 8px 8px',
            font: 'var(--font-description-l)',
            color: 'var(--fg-muted)',
          }}
        >
          <span>Действие</span>
          <span>Кого касается</span>
          <span>Прежний руководитель</span>
          <span>Статус</span>
          <span>Попыток</span>
          <span>Следующая попытка</span>
          <span>Ошибка</span>
        </div>
        {actionsLoading && (
          <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-muted)', padding: '12px 8px' }}>Загрузка…</span>
        )}
        {!actionsLoading && (actions ?? []).length === 0 && (
          <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-muted)', padding: '12px 8px' }}>Нет ожидающих действий</span>
        )}
        {(actions ?? []).map((a: PendingActionRead) => (
          <div
            key={a.id}
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(120px,1fr) minmax(140px,1fr) minmax(140px,1fr) minmax(100px,.8fr) 80px minmax(130px,1fr) minmax(180px,1.3fr)',
              gap: 16,
              padding: '12px 8px',
              borderTop: '1px solid var(--border-muted)',
              alignItems: 'start',
            }}
          >
            <span style={{ font: 'var(--font-body-s-strong)', color: 'var(--fg-default)' }}>{ACTION_TYPE_LABEL[a.action_type] ?? a.action_type}</span>
            <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-default)' }}>{nameOf(a.target_id)}</span>
            <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-soft)' }}>{nameOf(a.origin_supervisor_id)}</span>
            <span
              style={{
                height: 22,
                padding: '0 8px',
                borderRadius: 'var(--border-radius-m)',
                background: STATUS_BG[a.status] ?? 'var(--bg-surface2)',
                font: 'var(--font-description-l-strong)',
                color: 'var(--fg-default)',
                display: 'flex',
                alignItems: 'center',
                justifySelf: 'start',
              }}
            >
              {STATUS_LABEL[a.status] ?? a.status}
            </span>
            <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-default)', fontVariantNumeric: 'tabular-nums' }}>{a.retry_count}</span>
            <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-soft)' }}>{formatDateTime(a.next_retry_at)}</span>
            <span style={{ font: 'var(--font-description-l)', color: 'var(--error-default)', textWrap: 'pretty' }}>{a.last_error ?? ''}</span>
          </div>
        ))}
      </section>
    </div>
  )
}
