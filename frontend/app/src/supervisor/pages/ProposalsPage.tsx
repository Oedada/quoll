import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useUniversities } from '../../api/catalog'
import { usePrograms } from '../../api/catalog-extra'
import { useWorkflows } from '../../api/workflows'
import { useApproveProposal, useProposals, useRejectProposal, type ProposalRead, type ProposalStatus } from '../../api/integrations'
import { usePeople, personFullName } from '../../api/people'
import { useToast } from '../../manager/ToastContext'

const COLS = 'minmax(120px,.9fr) minmax(130px,1fr) minmax(120px,.9fr) minmax(200px,1.5fr) minmax(150px,1.1fr) 190px'

const TONE: Record<string, [string, string]> = {
  warning: ['var(--warning-container-default)', 'var(--warning-default)'],
  success: ['var(--success-container-default)', 'var(--success-default)'],
  error: ['var(--error-container-default)', 'var(--error-default)'],
}
const ST: Record<ProposalStatus, [keyof typeof TONE, string]> = {
  PENDING: ['warning', 'Ожидает'],
  APPROVED: ['success', 'Одобрено'],
  REJECTED: ['error', 'Отклонено'],
}
const KIND: Record<string, string> = {
  CREATE_INTERACTION: 'Создать взаимодействие',
  ADD_PROGRAM: 'Добавить программу',
}

const STATUSES: ProposalStatus[] = ['PENDING', 'APPROVED', 'REJECTED']

type Dialog = { id: number; kind: 'approve' | 'reject'; proposalKind: string }

export default function ProposalsPage() {
  const navigate = useNavigate()
  const toast = useToast()

  const [tab, setTab] = useState<ProposalStatus>('PENDING')
  const pending = useProposals('PENDING')
  const approved = useProposals('APPROVED')
  const rejected = useProposals('REJECTED')
  const byTab: Record<ProposalStatus, typeof pending> = { PENDING: pending, APPROVED: approved, REJECTED: rejected }
  const current = byTab[tab]

  const { data: universities } = useUniversities()
  const { data: programs } = usePrograms()
  const { data: workflows } = useWorkflows()
  const publishedWorkflows = useMemo(() => (workflows ?? []).filter((w) => w.is_published), [workflows])

  const uniName = useMemo(() => new Map((universities ?? []).map((u) => [u.id, u.short_name])), [universities])
  const programName = useMemo(() => new Map((programs ?? []).map((p) => [p.id, p.name])), [programs])

  const allRows = useMemo(() => [...(pending.data ?? []), ...(approved.data ?? []), ...(rejected.data ?? [])], [pending.data, approved.data, rejected.data])
  const peopleIds = useMemo(() => allRows.map((r) => r.decided_by), [allRows])
  const { data: people } = usePeople(peopleIds)
  const personLabel = (id: string) => {
    const p = people?.find((p) => p.id === id)
    return p ? personFullName(p) : id
  }

  const approveMutation = useApproveProposal()
  const rejectMutation = useRejectProposal()

  const [dialog, setDialog] = useState<Dialog | null>(null)
  const [wf, setWf] = useState('')
  const [comment, setComment] = useState('')
  const [tried, setTried] = useState(false)
  const [err, setErr] = useState('')

  const isApprove = dialog?.kind === 'approve'
  const needsWorkflow = dialog?.proposalKind === 'CREATE_INTERACTION'

  const closeDialog = () => {
    setDialog(null)
    setWf('')
    setComment('')
    setTried(false)
    setErr('')
  }

  const openApprove = (p: ProposalRead) => {
    setDialog({ id: p.id, kind: 'approve', proposalKind: p.kind })
    setWf('')
    setComment('')
    setTried(false)
    setErr('')
  }
  const openReject = (p: ProposalRead) => {
    setDialog({ id: p.id, kind: 'reject', proposalKind: p.kind })
    setComment('')
    setTried(false)
    setErr('')
  }

  const confirm = () => {
    if (!dialog) return
    setTried(true)
    if (isApprove) {
      if (needsWorkflow && !wf) {
        setErr('Для создания взаимодействия нужен воркфлоу')
        return
      }
      approveMutation.mutate(
        { id: dialog.id, body: { workflow_id: needsWorkflow ? Number(wf) : null, comment: comment.trim() || null } },
        {
          onSuccess: (res: ProposalRead) => {
            toast({
              title: 'Предложение одобрено',
              subtitle: res.result_interaction_id ? `Взаимодействие #${res.result_interaction_id}` : undefined,
              colorScheme: 'success',
            })
            closeDialog()
          },
          onError: (e: any) => {
            setErr(e?.message ?? 'Не удалось одобрить предложение')
          },
        },
      )
    } else {
      if (!comment.trim()) {
        setErr('Комментарий при отказе обязателен')
        return
      }
      rejectMutation.mutate(
        { id: dialog.id, body: { comment: comment.trim() } },
        {
          onSuccess: () => {
            toast({ title: 'Предложение отклонено', subtitle: `#${dialog.id}`, colorScheme: 'info' })
            closeDialog()
          },
          onError: (e: any) => {
            setErr(e?.message ?? 'Не удалось отклонить предложение')
          },
        },
      )
    }
  }

  const busy = approveMutation.isPending || rejectMutation.isPending
  const rows = current.data ?? []

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 2, padding: 2, borderRadius: 'var(--border-radius-m)', background: 'var(--neutral-container-soft)' }}>
          {STATUSES.map((s) => (
            <button
              key={s}
              onClick={() => setTab(s)}
              style={{
                height: 32,
                padding: '0 14px',
                border: 0,
                borderRadius: 6,
                background: tab === s ? 'var(--bg-surface1)' : 'transparent',
                font: 'var(--font-body-s-strong)',
                color: tab === s ? 'var(--fg-default)' : 'var(--fg-soft)',
                cursor: 'pointer',
              }}
            >
              {ST[s][1]} <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)' }}>{byTab[s].data?.length ?? ''}</span>
            </button>
          ))}
        </div>
        <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)' }}>Предложения приходят из LMS.</span>
      </div>

      <section style={{ background: 'var(--bg-surface1)', border: '1px solid var(--border-muted)', borderRadius: 'var(--border-radius-l)', padding: '8px 16px 16px', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'grid', gridTemplateColumns: COLS, gap: 16, padding: '12px 8px 8px', font: 'var(--font-description-l)', color: 'var(--fg-muted)' }}>
          <span>Вуз</span>
          <span>Программа</span>
          <span>Тип</span>
          <span>Основание</span>
          <span>Решение</span>
          <span></span>
        </div>

        {current.isLoading &&
          [1, 2, 3].map((k) => (
            <div key={k} style={{ display: 'grid', gridTemplateColumns: COLS, gap: 16, padding: '16px 8px', borderTop: '1px solid var(--border-muted)' }}>
              <div style={{ height: 14, width: '70%', borderRadius: 4, background: 'var(--neutral-container-default)' }} />
              <div style={{ height: 14, width: '60%', borderRadius: 4, background: 'var(--neutral-container-soft)' }} />
              <div style={{ height: 14, width: '50%', borderRadius: 4, background: 'var(--neutral-container-soft)' }} />
              <div style={{ height: 14, width: '85%', borderRadius: 4, background: 'var(--neutral-container-soft)' }} />
              <div style={{ height: 14, width: '60%', borderRadius: 4, background: 'var(--neutral-container-soft)' }} />
              <div />
            </div>
          ))}

        {!current.isLoading && rows.length === 0 && (
          <div style={{ padding: '48px 8px', textAlign: 'center', font: 'var(--font-body-s)', color: 'var(--fg-muted)' }}>Предложений в этом статусе нет</div>
        )}

        {!current.isLoading &&
          rows.map((r) => {
            const [tone, label] = ST[r.status]
            const [bg, dot] = TONE[tone]
            const created = new Date(r.created_at).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })
            const decidedAt = r.decided_at ? new Date(r.decided_at).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' }) : ''
            const decidedText = r.decided_by ? `${personLabel(r.decided_by)}, ${decidedAt}${r.decision_comment ? ` · «${r.decision_comment}»` : ''}` : ''

            return (
              <div key={r.id} style={{ display: 'grid', gridTemplateColumns: COLS, gap: 16, padding: '12px 8px', borderTop: '1px solid var(--border-muted)', alignItems: 'start' }}>
                <span style={{ display: 'flex', flexDirection: 'column' }}>
                  <span style={{ font: 'var(--font-body-s-strong)', color: 'var(--fg-default)' }}>{uniName.get(r.university_id) ?? `#${r.university_id}`}</span>
                  <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)' }}>
                    #{r.id} · {created}
                  </span>
                </span>
                <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-default)' }}>{programName.get(r.program_id) ?? `#${r.program_id}`}</span>
                <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-default)' }}>{KIND[r.kind] ?? r.kind}</span>
                <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-soft)', textWrap: 'pretty' as any }}>{r.reason}</span>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
                  <span style={{ height: 22, padding: '0 8px', borderRadius: 'var(--border-radius-m)', background: bg, font: 'var(--font-description-l-strong)', color: 'var(--fg-default)', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: dot }} />
                    {label}
                  </span>
                  {decidedText && <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)', textWrap: 'pretty' as any }}>{decidedText}</span>}
                  {r.result_interaction_id != null && (
                    <a
                      href="#"
                      onClick={(e) => {
                        e.preventDefault()
                        navigate(`/supervisor/interactions/${r.result_interaction_id}`)
                      }}
                      style={{ font: 'var(--font-description-l-strong)' }}
                    >
                      Взаимодействие #{r.result_interaction_id}
                    </a>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                  {r.status === 'PENDING' && (
                    <>
                      <button
                        onClick={() => openApprove(r)}
                        style={{ height: 32, padding: '0 12px', border: 0, borderRadius: 'var(--border-radius-buttons)', background: 'var(--accent-default)', color: '#fff', font: 'var(--font-body-s-strong)', cursor: 'pointer' }}
                      >
                        Одобрить
                      </button>
                      <button
                        onClick={() => openReject(r)}
                        style={{ height: 32, padding: '0 12px', border: '1px solid var(--border-soft)', borderRadius: 'var(--border-radius-buttons)', background: 'var(--bg-surface1)', color: 'var(--error-default)', font: 'var(--font-body-s-strong)', cursor: 'pointer' }}
                      >
                        Отклонить
                      </button>
                    </>
                  )}
                </div>
              </div>
            )
          })}
      </section>

      {dialog && (
        <>
          <div onClick={closeDialog} style={{ position: 'fixed', inset: 0, zIndex: 80, background: 'rgba(14,17,23,.4)' }} />
          <div
            style={{
              position: 'fixed',
              zIndex: 81,
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
            <span style={{ font: 'var(--font-heading-h3)', color: 'var(--fg-default)' }}>
              {isApprove ? `Одобрить предложение #${dialog.id}` : `Отклонить предложение #${dialog.id}`}
            </span>
            <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-soft)', textWrap: 'pretty' as any }}>
              {isApprove
                ? needsWorkflow
                  ? 'Будет создано взаимодействие-черновик по вузу и программе из предложения.'
                  : 'Программа будет добавлена в открытое взаимодействие по этому вузу.'
                : 'Причину увидит тот, кто следит за интеграцией.'}
            </span>

            {isApprove && needsWorkflow && (
              <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={{ font: 'var(--font-description-l-strong)', color: 'var(--fg-soft)' }}>Воркфлоу для нового взаимодействия *</span>
                <select
                  value={wf}
                  onChange={(e) => {
                    setWf(e.target.value)
                    setErr('')
                  }}
                  style={{
                    height: 40,
                    padding: '0 12px',
                    border: `1px solid ${tried && !wf ? 'var(--error-default)' : 'var(--border-soft)'}`,
                    borderRadius: 'var(--border-radius-inputs)',
                    background: 'var(--bg-surface1)',
                    font: 'var(--font-body-s)',
                    color: 'var(--fg-default)',
                    outline: 0,
                  }}
                >
                  <option value="">Выберите воркфлоу</option>
                  {publishedWorkflows.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
              </label>
            )}

            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ font: 'var(--font-description-l-strong)', color: 'var(--fg-soft)' }}>{isApprove ? 'Комментарий (необязательно)' : 'Комментарий *'}</span>
              <textarea
                rows={3}
                value={comment}
                onChange={(e) => {
                  setComment(e.target.value)
                  setErr('')
                }}
                style={{
                  resize: 'vertical',
                  padding: 12,
                  border: `1px solid ${tried && !isApprove && !comment.trim() ? 'var(--error-default)' : 'var(--border-soft)'}`,
                  borderRadius: 'var(--border-radius-inputs)',
                  background: 'var(--bg-surface1)',
                  font: 'var(--font-body-s)',
                  color: 'var(--fg-default)',
                  outline: 0,
                }}
              />
            </label>

            {err && <span style={{ font: 'var(--font-description-l)', color: 'var(--error-default)' }}>{err}</span>}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button
                onClick={closeDialog}
                style={{ height: 40, padding: '0 20px', border: '1px solid var(--border-soft)', borderRadius: 'var(--border-radius-buttons)', background: 'var(--bg-surface1)', color: 'var(--fg-default)', font: 'var(--font-body-s-strong)', cursor: 'pointer' }}
              >
                Отмена
              </button>
              <button
                onClick={confirm}
                disabled={busy}
                style={{ height: 40, padding: '0 20px', border: 0, borderRadius: 'var(--border-radius-buttons)', background: 'var(--accent-default)', color: '#fff', font: 'var(--font-body-s-strong)', cursor: 'pointer', opacity: busy ? 0.7 : 1 }}
              >
                {isApprove ? 'Одобрить' : 'Отклонить'}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

