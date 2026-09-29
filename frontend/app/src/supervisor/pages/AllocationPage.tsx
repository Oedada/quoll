import { useMemo, useState } from 'react'
import { useQueries } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { api } from '../../api/client'
import { useTeam, useOrphanedManagers, useAvailableProjectCapacity, type ManagerLoadRead } from '../../api/org'
import { useInteractions, type InteractionListRead, type InteractionListPage } from '../../api/interactions'
import { CreateAssignDialog } from '../components/CreateAssignDialog'

function personLabel(p: { last_name: string; first_name: string; patronymic: string; id: string; username?: string | null }): string {
  const name = [p.last_name, p.first_name, p.patronymic].filter(Boolean).join(' ')
  return name || p.username || p.id
}

const STATUS_TONE: Record<string, { bg: string; bar: string; label: string }> = {
  AVAILABLE: { bg: 'var(--success-container-default)', bar: 'var(--fg-soft)', label: 'Доступен' },
  SATURATED: { bg: 'var(--warning-container-default)', bar: 'var(--warning-default)', label: 'Занят: лимит' },
  UNAVAILABLE: { bg: 'var(--neutral-container-default)', bar: 'var(--fg-soft)', label: 'Недоступен' },
  INACTIVE: { bg: 'var(--neutral-container-default)', bar: 'var(--fg-soft)', label: 'Неактивен' },
}

const card: React.CSSProperties = {
  background: 'var(--bg-surface1)',
  border: '1px solid var(--border-muted)',
  borderRadius: 'var(--border-radius-l)',
}

// строка "ждут назначения": либо ничей черновик, либо заявка осиротевшей команды
interface WaitRow {
  id: number
  uniName: string
  why: string
  ownerName: string | null
}

export default function AllocationPage() {
  const navigate = useNavigate()
  const [dlg, setDlg] = useState<WaitRow | null>(null)

  const { data: team } = useTeam()
  const { data: orphaned } = useOrphanedManagers()
  const { data: caps } = useAvailableProjectCapacity()
  const { data: drafts, isLoading: draftsLoading } = useInteractions({ status: ['DRAFT'], limit: 100 })

  // API не даёт фильтр "владелец из списка осиротевших" одним запросом - берём по одному на менеджера
  const orphanQueries = useQueries({
    queries: (orphaned ?? []).map((m) => ({
      queryKey: ['interactions', { responsible_id: m.id, orphaned: true }],
      queryFn: () => api.get<InteractionListPage>(`/interactions/?responsible_id=${encodeURIComponent(m.id)}&limit=100`),
    })),
  })
  const orphanLoading = orphanQueries.some((q) => q.isLoading)

  const pool = useMemo(() => [...(team?.members ?? [])].sort((a, b) => a.capacity_used - b.capacity_used), [team])

  const waitRows = useMemo<WaitRow[]>(() => {
    const draftRows: WaitRow[] = (drafts?.items ?? [])
      .filter((r) => r.owner_id === null)
      .map((r) => ({ id: r.id, uniName: r.university.name, why: 'черновик без владельца', ownerName: null }))

    const orphanRows: WaitRow[] = (orphaned ?? []).flatMap((m, i) => {
      const items = (orphanQueries[i]?.data?.items ?? []) as InteractionListRead[]
      return items
        .filter((r) => r.status !== 'CLOSED')
        .map((r) => ({ id: r.id, uniName: r.university.name, why: 'менеджер ушёл — заявка осиротела', ownerName: personLabel(m) }))
    })

    // на случай если одна и та же заявка попала в обе выборки (не должно, но не дублируем)
    const seen = new Set<number>()
    return [...draftRows, ...orphanRows].filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)))
  }, [drafts, orphaned, orphanQueries])

  const loading = draftsLoading || orphanLoading

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,5fr) minmax(0,7fr)', gap: 16, alignItems: 'start', minWidth: 0 }}>
      <section style={{ ...card, padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ font: 'var(--font-heading-h4)', color: 'var(--fg-default)' }}>Загрузка команды</span>
          <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)' }}>Сначала наименее загруженные</span>
        </div>
        {pool.map((m) => (
          <TeamRow key={m.id} m={m} />
        ))}
        {pool.length === 0 && (
          <div style={{ padding: '24px 0', font: 'var(--font-body-s)', color: 'var(--fg-muted)' }}>В команде пока никого нет</div>
        )}
      </section>

      <section style={{ ...card, padding: '8px 16px 16px', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '12px 8px 4px', display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ font: 'var(--font-heading-h4)', color: 'var(--fg-default)' }}>
            Ждут назначения <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)' }}>· {waitRows.length}</span>
          </span>
          <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)' }}>
            Черновики без владельца и заявки осиротевших менеджеров
          </span>
        </div>
        {!loading && waitRows.length === 0 && (
          <div style={{ padding: '40px 8px', textAlign: 'center', font: 'var(--font-body-s)', color: 'var(--fg-muted)' }}>
            Всё распределено
          </div>
        )}
        {waitRows.map((r) => (
          <div
            key={r.id}
            style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '12px 8px', borderTop: '1px solid var(--border-muted)' }}
          >
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
              <a
                href={`/supervisor/interactions/${r.id}`}
                onClick={(e) => {
                  e.preventDefault()
                  navigate(`/supervisor/interactions/${r.id}`)
                }}
                style={{ font: 'var(--font-body-s-strong)', color: 'var(--fg-default)', textDecoration: 'none' }}
              >
                {r.uniName}
              </a>
              <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)' }}>
                #{r.id} · {r.why}
              </span>
            </div>
            <button
              onClick={() => setDlg(r)}
              style={{
                height: 32,
                padding: '0 14px',
                border: 0,
                borderRadius: 'var(--border-radius-buttons)',
                background: 'var(--accent-default)',
                color: '#fff',
                font: 'var(--font-body-s-strong)',
                cursor: 'pointer',
              }}
            >
              Назначить
            </button>
          </div>
        ))}
      </section>

      <section style={{ ...card, padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ font: 'var(--font-heading-h4)', color: 'var(--fg-default)' }}>Свободные слоты у других руководителей</span>
          <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)' }}>
            Куда можно передать заявку, если в команде нет свободных КАМов
          </span>
        </div>
        {(caps ?? []).map((c) => (
          <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, paddingTop: 8, borderTop: '1px solid var(--border-muted)' }}>
            <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-default)' }}>{personLabel(c)}</span>
            <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-soft)' }}>свободно слотов: {c.free_project_slots}</span>
          </div>
        ))}
        {(caps ?? []).length === 0 && (
          <div style={{ padding: '12px 0', font: 'var(--font-body-s)', color: 'var(--fg-muted)' }}>Свободных слотов нет</div>
        )}
      </section>

      {dlg && (
        <CreateAssignDialog
          kind="assign"
          interactionId={dlg.id}
          currentOwnerName={dlg.ownerName}
          onClose={() => setDlg(null)}
          onDone={() => setDlg(null)}
        />
      )}
    </div>
  )
}

function TeamRow({ m }: { m: ManagerLoadRead }) {
  const tone = STATUS_TONE[m.effective_status] ?? STATUS_TONE.UNAVAILABLE
  const pct = m.max_active_projects > 0 ? Math.round((m.capacity_used / m.max_active_projects) * 100) : 0
  const free = Math.max(0, m.max_active_projects - m.capacity_used)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingTop: 10, borderTop: '1px solid var(--border-muted)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
        <span style={{ font: 'var(--font-body-s-strong)', color: 'var(--fg-default)' }}>{personLabel(m)}</span>
        <span
          style={{
            height: 20,
            padding: '0 6px',
            borderRadius: 'var(--border-radius-s)',
            background: tone.bg,
            font: 'var(--font-description-l-strong)',
            color: 'var(--fg-default)',
            display: 'flex',
            alignItems: 'center',
          }}
        >
          {tone.label}
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ flex: 1, height: 8, borderRadius: 4, background: 'var(--neutral-container-default)', overflow: 'hidden' }}>
          <div style={{ width: `${pct}%`, height: '100%', background: tone.bar }} />
        </div>
        <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-soft)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
          свободно {free} из {m.max_active_projects}
        </span>
      </div>
    </div>
  )
}
