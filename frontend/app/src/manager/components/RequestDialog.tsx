import { useState, type CSSProperties } from 'react'
import type { InteractionListRead } from '../../api/interactions'
import { useAvailableTransitions } from '../../api/interactions'
import { useStagesByWorkflow } from '../../api/stages'
import { useCloseReasons } from '../../api/requestRefs'
import { useCreateRequest, type RequestKind } from '../../api/requests'
import { useToast } from '../ToastContext'

const KIND_LABEL: Record<RequestKind, string> = {
  TRANSFER: 'Передача',
  CLOSE: 'Закрытие',
  TRANSITION: 'Переход',
}

const inputStyle = (bad?: boolean): CSSProperties => ({
  height: 40,
  padding: '0 12px',
  border: `1px solid ${bad ? 'var(--error-default)' : 'var(--border-soft)'}`,
  borderRadius: 'var(--border-radius-inputs)',
  background: 'var(--bg-surface1)',
  font: 'var(--font-body-s)',
  color: 'var(--fg-default)',
  outline: 0,
})

export default function RequestDialog({
  interaction,
  onClose,
  onDone,
}: {
  interaction: InteractionListRead
  onClose: () => void
  onDone?: () => void
}) {
  const toast = useToast()
  const [kind, setKind] = useState<RequestKind>('TRANSFER')
  const [targetStageId, setTargetStageId] = useState<number | ''>('')
  const [closeReasonId, setCloseReasonId] = useState<number | ''>('')
  const [branchCloseReasonId, setBranchCloseReasonId] = useState<number | ''>('')
  const [reason, setReason] = useState('')
  const [tried, setTried] = useState(false)
  const [err, setErr] = useState('')

  const signed = !!interaction.signed_at
  const stageId = interaction.stage?.id ?? null

  const { data: stages } = useStagesByWorkflow(kind === 'CLOSE' ? interaction.workflow_id : null)
  const terminalStages = (stages ?? []).filter((s) => s.is_terminal)

  const { data: transitions } = useAvailableTransitions(
    kind === 'TRANSITION' ? interaction.workflow_id ?? undefined : undefined,
    stageId,
  )

  const { data: closeReasons } = useCloseReasons(
    signed ? 'INTERACTION_AFTER_SIGNING' : 'INTERACTION_BEFORE_SIGNING',
    kind === 'CLOSE',
  )
  const { data: branchCloseReasons } = useCloseReasons('BRANCH', kind === 'CLOSE' && signed)

  const create = useCreateRequest(interaction.id)

  const changeKind = (v: RequestKind) => {
    setKind(v)
    setTargetStageId('')
    setCloseReasonId('')
    setBranchCloseReasonId('')
    setErr('')
    setTried(false)
  }

  const reasonBad = tried && !reason.trim()
  const stageBad = tried && (kind === 'CLOSE' || kind === 'TRANSITION') && !targetStageId
  const closeReasonBad = tried && kind === 'CLOSE' && !closeReasonId

  const canSubmit =
    !!reason.trim() &&
    (kind !== 'CLOSE' || (!!targetStageId && !!closeReasonId)) &&
    (kind !== 'TRANSITION' || !!targetStageId)

  const submit = () => {
    setTried(true)
    setErr('')
    if (!canSubmit) return
    create.mutate(
      {
        kind,
        reason: reason.trim(),
        target_stage_id: kind === 'CLOSE' || kind === 'TRANSITION' ? Number(targetStageId) : null,
        // руководитель сам выбирает получателя - менеджеру недоступен список коллег
        // (assignment-pool отдаётся только руководителю), поэтому предложения нет
        target_manager_id: null,
        close_reason_id: kind === 'CLOSE' ? Number(closeReasonId) : null,
        branch_close_reason_id: kind === 'CLOSE' && signed && branchCloseReasonId ? Number(branchCloseReasonId) : null,
      },
      {
        onSuccess: () => {
          toast({ title: 'Просьба отправлена руководителю', subtitle: `#${interaction.id} · ${KIND_LABEL[kind]}`, colorScheme: 'success' })
          if (onDone) onDone()
          else onClose()
        },
        onError: (e: any) => setErr(e?.message ?? 'Не удалось отправить просьбу'),
      },
    )
  }

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 80, background: 'rgba(14,17,23,.4)' }} />
      <div
        style={{
          position: 'fixed',
          zIndex: 81,
          top: '50%',
          left: '50%',
          transform: 'translate(-50%,-50%)',
          width: 540,
          maxWidth: 'calc(100vw - 32px)',
          maxHeight: 'calc(100vh - 48px)',
          overflowY: 'auto',
          background: 'var(--bg-elevated-xl)',
          borderRadius: 'var(--border-radius-xl)',
          boxShadow: 'var(--shadow-bottom-xl)',
          padding: 24,
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ font: 'var(--font-heading-h3)', color: 'var(--fg-default)' }}>Создать просьбу</span>
          <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-soft)', textWrap: 'pretty' as any }}>
            Просьба уходит руководителю. Заявки создаёт руководитель, а вы просите передать, закрыть или перевести
            уже назначенную вам ({interaction.university.name} · #{interaction.id}).
          </span>
        </div>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ font: 'var(--font-description-l-strong)', color: 'var(--fg-soft)' }}>Тип просьбы</span>
          <select value={kind} onChange={(e) => changeKind(e.target.value as RequestKind)} style={inputStyle()}>
            {(Object.keys(KIND_LABEL) as RequestKind[]).map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </label>

        {kind === 'TRANSFER' && (
          <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)', textWrap: 'pretty' as any }}>
            {/* менеджеру недоступен список коллег (эндпоинт со списком - только для руководителя),
               поэтому получателя предложить нельзя - решит руководитель */}
            Кому передать — решит руководитель, вы можете только описать причину ниже.
          </span>
        )}

        {kind === 'CLOSE' && (
          <>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ font: 'var(--font-description-l-strong)', color: 'var(--fg-soft)' }}>Терминальный шаг</span>
              <select
                value={targetStageId}
                onChange={(e) => setTargetStageId(e.target.value ? Number(e.target.value) : '')}
                style={inputStyle(stageBad)}
              >
                <option value="">— выберите —</option>
                {terminalStages.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              {stageBad && <span style={{ font: 'var(--font-description-l)', color: 'var(--error-default)' }}>Выберите шаг</span>}
            </label>

            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ font: 'var(--font-description-l-strong)', color: 'var(--fg-soft)' }}>Причина закрытия</span>
              <select
                value={closeReasonId}
                onChange={(e) => setCloseReasonId(e.target.value ? Number(e.target.value) : '')}
                style={inputStyle(closeReasonBad)}
              >
                <option value="">— выберите —</option>
                {(closeReasons ?? []).map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </select>
              {closeReasonBad && <span style={{ font: 'var(--font-description-l)', color: 'var(--error-default)' }}>Выберите причину</span>}
            </label>

            {signed && (
              <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={{ font: 'var(--font-description-l-strong)', color: 'var(--fg-soft)' }}>
                  Причина закрытия открытых веток (если есть)
                </span>
                <select
                  value={branchCloseReasonId}
                  onChange={(e) => setBranchCloseReasonId(e.target.value ? Number(e.target.value) : '')}
                  style={inputStyle()}
                >
                  <option value="">— не закрывать ветки —</option>
                  {(branchCloseReasons ?? []).map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </>
        )}

        {kind === 'TRANSITION' && (
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ font: 'var(--font-description-l-strong)', color: 'var(--fg-soft)' }}>Целевой шаг (переход с одобрением)</span>
            <select
              value={targetStageId}
              onChange={(e) => setTargetStageId(e.target.value ? Number(e.target.value) : '')}
              style={inputStyle(stageBad)}
            >
              <option value="">— выберите —</option>
              {(transitions ?? []).map((t) => (
                <option key={t.id} value={t.to_stage_id}>
                  {t.name}
                </option>
              ))}
            </select>
            {stageBad && <span style={{ font: 'var(--font-description-l)', color: 'var(--error-default)' }}>Выберите шаг</span>}
          </label>
        )}

        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ font: 'var(--font-description-l-strong)', color: 'var(--fg-soft)' }}>Причина *</span>
          <textarea
            rows={3}
            value={reason}
            onChange={(e) => {
              setReason(e.target.value)
              setErr('')
            }}
            placeholder="Опишите, чем вызвана просьба"
            style={{ ...inputStyle(reasonBad), height: 'auto', padding: 12, resize: 'vertical' as any }}
          />
          {reasonBad && <span style={{ font: 'var(--font-description-l)', color: 'var(--error-default)' }}>Причина обязательна</span>}
        </label>

        {err && <span style={{ font: 'var(--font-description-l)', color: 'var(--error-default)' }}>{err}</span>}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button
            onClick={onClose}
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
            Отмена
          </button>
          <button
            onClick={submit}
            disabled={create.isPending}
            style={{
              height: 40,
              padding: '0 20px',
              border: 0,
              borderRadius: 'var(--border-radius-buttons)',
              background: 'var(--accent-default)',
              color: '#fff',
              font: 'var(--font-body-s-strong)',
              cursor: create.isPending ? 'default' : 'pointer',
              opacity: create.isPending ? 0.7 : 1,
            }}
          >
            {create.isPending ? 'Отправка…' : 'Отправить руководителю'}
          </button>
        </div>
      </div>
    </>
  )
}
