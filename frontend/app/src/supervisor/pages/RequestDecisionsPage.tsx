import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useInteractions } from '../../api/interactions'
import { useRequests, type RequestRead, type RequestKind } from '../../api/requests'
import { useApproveRequest, useRejectRequest } from '../../api/request-decisions'
import { useCloseReasons, useStage } from '../../api/requestRefs'
import { useTeam } from '../../api/org'
import { usePeople, personFullName } from '../../api/people'
import type { ManagerLoadRead } from '../../api/org'
import { useToast } from '../../manager/ToastContext'

const TABS: Array<{ key: string; label: string }> = [
  { key: 'PENDING', label: 'Ждут решения' },
  { key: 'APPROVED', label: 'Одобрены' },
  { key: 'REJECTED', label: 'Отклонены' },
  { key: 'ALL', label: 'Все' },
]

const TONE: Record<string, [string, string]> = {
  warning: ['var(--warning-container-default)', 'var(--warning-default)'],
  success: ['var(--success-container-default)', 'var(--success-default)'],
  error: ['var(--error-container-default)', 'var(--error-default)'],
}
const ST: Record<string, [keyof typeof TONE, string]> = {
  PENDING: ['warning', 'Ожидает'],
  APPROVED: ['success', 'Одобрена'],
  REJECTED: ['error', 'Отклонена'],
}
const KIND: Record<RequestKind, string> = { TRANSFER: 'Передача', CLOSE: 'Закрытие', TRANSITION: 'Переход' }

type DlgKind = 'approve' | 'reject'

// ManagerLoadRead - облегчённая карточка загрузки, без role/is_active как у PersonRead
function managerName(m: ManagerLoadRead): string {
  return [m.last_name, m.first_name, m.patronymic].filter(Boolean).join(' ') || m.id
}

export default function RequestDecisionsPage() {
  const navigate = useNavigate()
  const toast = useToast()

  const { data: requests, isLoading } = useRequests()
  // список нужен только для названий вузов/текущих владельцев и опций фильтра - без interaction_id грузим первую страницу
  const { data: interactionsPage } = useInteractions({ limit: 200 })
  const { data: closeReasonsAll } = useCloseReasons()
  const { data: team } = useTeam()
  const approveRequest = useApproveRequest()
  const rejectRequest = useRejectRequest()

  const [tab, setTab] = useState('PENDING')
  const [inter, setInter] = useState('')
  const [dlg, setDlg] = useState<{ id: number; kind: DlgKind; rk: RequestKind } | null>(null)
  const [comment, setComment] = useState('')
  const [mgr, setMgr] = useState('')
  const [tried, setTried] = useState(false)

  const all = useMemo(() => requests ?? [], [requests])
  const interactionsById = useMemo(() => new Map((interactionsPage?.items ?? []).map((i) => [i.id, i])), [interactionsPage])
  const closeReasonLabel = useMemo(() => new Map((closeReasonsAll ?? []).map((r) => [r.id, r.label])), [closeReasonsAll])
  const peopleIds = useMemo(() => all.flatMap((r) => [r.requested_by, r.decided_by]), [all])
  const { data: people } = usePeople(peopleIds)
  const peopleById = useMemo(() => new Map((people ?? []).map((p) => [p.id, p])), [people])
  const personLabel = (id: string | null) => {
    if (!id) return ''
    const p = peopleById.get(id)
    return p ? personFullName(p) : id
  }

  const interOpts = useMemo(() => {
    const seen = new Map<number, string>()
    for (const r of all) {
      if (seen.has(r.interaction_id)) continue
      const uni = interactionsById.get(r.interaction_id)?.university.name
      seen.set(r.interaction_id, uni ? `${uni} #${r.interaction_id}` : `#${r.interaction_id}`)
    }
    return Array.from(seen.entries())
  }, [all, interactionsById])

  const base = useMemo(() => all.filter((r) => !inter || String(r.interaction_id) === inter), [all, inter])
  const list = base.filter((r) => tab === 'ALL' || r.status === tab)
  const counts = useMemo(() => {
    const c: Record<string, number> = { PENDING: 0, APPROVED: 0, REJECTED: 0, ALL: base.length }
    for (const r of base) c[r.status] = (c[r.status] ?? 0) + 1
    return c
  }, [base])

  const openDlg = (r: RequestRead, kind: DlgKind) => {
    setDlg({ id: r.id, kind, rk: r.kind as RequestKind })
    setComment('')
    setMgr(r.target_manager_id ?? team?.members[0]?.id ?? '')
    setTried(false)
  }
  const closeDlg = () => setDlg(null)

  const confirmDlg = () => {
    if (!dlg) return
    if (dlg.kind === 'reject' && !comment.trim()) {
      setTried(true)
      return
    }
    if (dlg.kind === 'approve') {
      approveRequest.mutate(
        { id: dlg.id, body: { target_manager_id: dlg.rk === 'TRANSFER' ? mgr || null : null, comment: comment.trim() || null } },
        {
          onSuccess: () => {
            toast({ title: 'Просьба одобрена', subtitle: `#${dlg.id}`, colorScheme: 'success' })
            closeDlg()
          },
          onError: (e: any) => {
            toast({ title: 'Не удалось одобрить просьбу', subtitle: e?.message, colorScheme: 'error' })
          },
        },
      )
    } else {
      rejectRequest.mutate(
        { id: dlg.id, body: { comment: comment.trim() } },
        {
          onSuccess: () => {
            toast({ title: 'Просьба отклонена', subtitle: `#${dlg.id}`, colorScheme: 'info' })
            closeDlg()
          },
          onError: (e: any) => {
            toast({ title: 'Не удалось отклонить просьбу', subtitle: e?.message, colorScheme: 'error' })
          },
        },
      )
    }
  }

  const pending = approveRequest.isPending || rejectRequest.isPending
  const cErr = tried && dlg?.kind === 'reject' && !comment.trim()
  const dlgInfo = dlg
    ? dlg.kind === 'approve'
      ? { title: `Одобрить просьбу #${dlg.id}`, sub: `${KIND[dlg.rk]}. Решение применится к заявке.`, needMgr: dlg.rk === 'TRANSFER', cLabel: 'Комментарий (необязательно)', confirm: 'Одобрить' }
      : { title: `Отклонить просьбу #${dlg.id}`, sub: 'КАМ увидит ваш комментарий.', needMgr: false, cLabel: 'Комментарий', confirm: 'Отклонить' }
    : null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0, position: 'relative' }}>
      <div style={{ display: 'flex', gap: 2, padding: 2, borderRadius: 'var(--border-radius-m)', background: 'var(--neutral-container-soft)', alignSelf: 'flex-start' }}>
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{
              height: 32,
              padding: '0 14px',
              border: 0,
              borderRadius: 6,
              background: tab === t.key ? 'var(--bg-surface1)' : 'transparent',
              font: 'var(--font-body-s-strong)',
              color: tab === t.key ? 'var(--fg-default)' : 'var(--fg-soft)',
              cursor: 'pointer',
            }}
          >
            {t.label} <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)' }}>{counts[t.key] ?? 0}</span>
          </button>
        ))}
      </div>

      <select
        value={inter}
        onChange={(e) => setInter(e.target.value)}
        style={{ alignSelf: 'flex-start', height: 36, padding: '0 8px', border: '1px solid var(--border-soft)', borderRadius: 'var(--border-radius-l)', background: 'var(--bg-surface1)', font: 'var(--font-body-s)', color: 'var(--fg-default)', outline: 0, cursor: 'pointer' }}
      >
        <option value="">Все взаимодействия</option>
        {interOpts.map(([id, label]) => (
          <option key={id} value={id}>
            {label}
          </option>
        ))}
      </select>

      <section style={{ background: 'var(--bg-surface1)', border: '1px solid var(--border-muted)', borderRadius: 'var(--border-radius-l)', display: 'flex', flexDirection: 'column' }}>
        {isLoading &&
          [1, 2, 3].map((k) => (
            <div key={k} style={{ display: 'flex', gap: 16, padding: '16px 20px', borderTop: k > 1 ? '1px solid var(--border-muted)' : '0' }}>
              <div style={{ height: 14, width: '60%', borderRadius: 4, background: 'var(--neutral-container-soft)' }} />
            </div>
          ))}

        {!isLoading && list.length === 0 && (
          <div style={{ padding: '56px 16px', textAlign: 'center', font: 'var(--font-body-s)', color: 'var(--fg-muted)' }}>
            {tab === 'PENDING' ? 'Просьб на решение нет' : 'Просьб в этом статусе нет'}
          </div>
        )}

        {!isLoading &&
          list.map((r, i) => {
            const [tone, label] = ST[r.status] ?? ['warning', r.status]
            const [bg, dot] = TONE[tone]
            const uni = interactionsById.get(r.interaction_id)?.university.name ?? `#${r.interaction_id}`
            const owner = interactionsById.get(r.interaction_id)?.responsible?.name ?? '—'
            const by = personLabel(r.requested_by) || '—'
            const created = new Date(r.created_at).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })
            const decided = r.decided_by && r.decided_at
              ? `${personLabel(r.decided_by)}, ${new Date(r.decided_at).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })}${r.decision_comment ? ` · «${r.decision_comment}»` : ''}`
              : ''

            return (
              <div key={r.id} style={{ display: 'flex', gap: 16, padding: '16px 20px', borderTop: i ? '1px solid var(--border-muted)' : '0', alignItems: 'flex-start' }}>
                <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <a
                      href="#"
                      onClick={(e) => {
                        e.preventDefault()
                        navigate(`/supervisor/interactions/${r.interaction_id}`)
                      }}
                      style={{ font: 'var(--font-body-s-strong)', color: 'var(--fg-default)' }}
                    >
                      {uni}
                    </a>
                    <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)' }}>#{r.interaction_id}</span>
                    <span style={{ height: 20, padding: '0 6px', borderRadius: 'var(--border-radius-s)', background: 'var(--neutral-container-default)', font: 'var(--font-description-l-strong)', color: 'var(--fg-soft)', display: 'flex', alignItems: 'center' }}>
                      {KIND[r.kind as RequestKind] ?? r.kind}
                    </span>
                    <span style={{ height: 20, padding: '0 6px', borderRadius: 'var(--border-radius-s)', background: bg, font: 'var(--font-description-l-strong)', color: 'var(--fg-default)', display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: dot }} />
                      {label}
                    </span>
                  </div>
                  <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-soft)' }}>
                    <TargetText r={r} closeReasonLabel={closeReasonLabel} personLabel={personLabel} />
                  </span>
                  <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-muted)', textWrap: 'pretty' as any }}>«{r.reason}»</span>
                  <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)' }}>
                    {by}, {created} · текущий владелец {owner}
                    {decided ? ` · ${decided}` : ''}
                  </span>
                </div>
                {r.status === 'PENDING' && (
                  <div style={{ display: 'flex', gap: 6, flex: 'none' }}>
                    <button
                      onClick={() => openDlg(r, 'approve')}
                      style={{ height: 32, padding: '0 14px', border: 0, borderRadius: 'var(--border-radius-buttons)', background: 'var(--accent-default)', color: '#fff', font: 'var(--font-body-s-strong)', cursor: 'pointer' }}
                    >
                      Одобрить
                    </button>
                    <button
                      onClick={() => openDlg(r, 'reject')}
                      style={{ height: 32, padding: '0 14px', border: '1px solid var(--border-soft)', borderRadius: 'var(--border-radius-buttons)', background: 'var(--bg-surface1)', color: 'var(--error-default)', font: 'var(--font-body-s-strong)', cursor: 'pointer' }}
                    >
                      Отклонить
                    </button>
                  </div>
                )}
              </div>
            )
          })}
      </section>

      {dlg && dlgInfo && (
        <>
          <div onClick={closeDlg} style={{ position: 'fixed', inset: 0, zIndex: 30, background: 'rgba(14,17,23,.4)' }} />
          <div
            style={{
              position: 'fixed',
              zIndex: 31,
              top: '50%',
              left: '50%',
              transform: 'translate(-50%,-50%)',
              width: 480,
              maxWidth: 'calc(100vw - 32px)',
              background: 'var(--bg-elevated-xl)',
              borderRadius: 'var(--border-radius-xl)',
              boxShadow: 'var(--shadow-bottom-xl)',
              padding: 24,
              display: 'flex',
              flexDirection: 'column',
              gap: 16,
            }}
          >
            <span style={{ font: 'var(--font-heading-h3)', color: 'var(--fg-default)' }}>{dlgInfo.title}</span>
            <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-soft)', textWrap: 'pretty' as any }}>{dlgInfo.sub}</span>

            {dlgInfo.needMgr && (
              <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={{ font: 'var(--font-description-l-strong)', color: 'var(--fg-soft)' }}>
                  Новый менеджер (решает руководитель, предложение КАМа не обязательно)
                </span>
                <select
                  value={mgr}
                  onChange={(e) => setMgr(e.target.value)}
                  style={{ height: 40, padding: '0 12px', border: '1px solid var(--border-soft)', borderRadius: 'var(--border-radius-inputs)', background: 'var(--bg-surface1)', font: 'var(--font-body-s)', color: 'var(--fg-default)', outline: 0 }}
                >
                  {(team?.members ?? []).map((m) => (
                    <option key={m.id} value={m.id}>
                      {managerName(m)} · слотов {Math.max(0, m.max_active_projects - m.capacity_used)} из {m.max_active_projects}
                    </option>
                  ))}
                </select>
              </label>
            )}

            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ font: 'var(--font-description-l-strong)', color: 'var(--fg-soft)' }}>{dlgInfo.cLabel}</span>
              <textarea
                rows={3}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                style={{ resize: 'vertical', padding: 12, border: `1px solid ${cErr ? 'var(--error-default)' : 'var(--border-soft)'}`, borderRadius: 'var(--border-radius-inputs)', background: 'var(--bg-surface1)', font: 'var(--font-body-s)', color: 'var(--fg-default)', outline: 0 }}
              />
            </label>
            {cErr && <span style={{ font: 'var(--font-description-l)', color: 'var(--error-default)' }}>Укажите комментарий: при отказе он обязателен</span>}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button onClick={closeDlg} style={{ height: 40, padding: '0 20px', border: '1px solid var(--border-soft)', borderRadius: 'var(--border-radius-buttons)', background: 'var(--bg-surface1)', color: 'var(--fg-default)', font: 'var(--font-body-s-strong)', cursor: 'pointer' }}>
                Отмена
              </button>
              <button
                onClick={confirmDlg}
                disabled={pending}
                style={{ height: 40, padding: '0 20px', border: 0, borderRadius: 'var(--border-radius-buttons)', background: 'var(--accent-default)', color: '#fff', font: 'var(--font-body-s-strong)', cursor: 'pointer', opacity: pending ? 0.7 : 1 }}
              >
                {dlgInfo.confirm}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function TargetText({
  r,
  closeReasonLabel,
  personLabel,
}: {
  r: RequestRead
  closeReasonLabel: Map<number, string>
  personLabel: (id: string | null) => string
}) {
  const { data: stage } = useStage(r.target_stage_id)
  if (r.kind === 'TRANSFER') {
    return <>{r.target_manager_id ? `Кому: ${personLabel(r.target_manager_id)}` : 'Кому: решит руководитель'}</>
  }
  const stageName = stage?.name ?? (r.target_stage_id ? `#${r.target_stage_id}` : '—')
  if (r.kind === 'CLOSE') {
    const reasonId = r.branch_id ? r.branch_close_reason_id : r.close_reason_id
    const reasonLabel = reasonId ? closeReasonLabel.get(reasonId) ?? `#${reasonId}` : ''
    const scope = r.branch_id ? `Ветка #${r.branch_id}` : 'Заявка'
    return (
      <>
        {scope} → Закрытие{reasonLabel ? ` · причина «${reasonLabel}»` : ''}
      </>
    )
  }
  return (
    <>
      {r.branch_id ? `Ветка #${r.branch_id}: ` : ''}Этап «{stageName}»
    </>
  )
}
