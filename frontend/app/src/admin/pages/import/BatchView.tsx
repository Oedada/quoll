import { useMemo, useState } from 'react'
import type { RowRead } from '../../../api/imports'
import { useImportBatch, useImportKinds, usePatchBatch, useImportRows, errMessage } from '../../../api/imports'
import { useWorkflows } from '../../../api/workflows'
import { useStagesByWorkflow } from '../../../api/stages'
import { BST, RST, groupsFromRows } from './constants'
import { SheetsStep } from './SheetsStep'
import { RowsStep } from './RowsStep'
import { ConflictsStep } from './ConflictsStep'
import { ApplyStep } from './ApplyStep'
import { RowDialog } from './RowDialog'
import { ConflictDialog } from './ConflictDialog'
import { useToast } from '../../../manager/ToastContext'

type Step = 'sheets' | 'rows' | 'conf' | 'apply'
const STEPS: { key: Step; label: string }[] = [
  { key: 'sheets', label: '1 · Листы' },
  { key: 'rows', label: '2 · Предпросмотр' },
  { key: 'conf', label: '3 · Конфликты' },
  { key: 'apply', label: '4 · Применение' },
]

const SELECT_STYLE: React.CSSProperties = {
  height: 32,
  padding: '0 8px',
  border: '1px solid var(--border-soft)',
  borderRadius: 'var(--border-radius-inputs)',
  background: 'var(--bg-surface1)',
  font: 'var(--font-body-s)',
  color: 'var(--fg-default)',
  outline: 0,
}

export function BatchView({ batchId, onBack }: { batchId: number; onBack: () => void }) {
  const toast = useToast()
  const batchQ = useImportBatch(batchId)
  const batch = batchQ.data
  const kindsQ = useImportKinds(batch?.workflow_id)
  const workflowsQ = useWorkflows()
  const stagesQ = useStagesByWorkflow(batch?.workflow_id)
  const patchBatch = usePatchBatch(batchId)
  const conflictRowsQ = useImportRows(batch?.status === 'DRAFT' ? batchId : null, { status: ['CONFLICT'], limit: 200 })

  const [step, setStep] = useState<Step>('rows')
  const [rf, setRf] = useState('')
  const [openRowId, setOpenRowId] = useState<number | null>(null)
  const [showConfDialog, setShowConfDialog] = useState(false)

  const groupsAll = useMemo(() => groupsFromRows<RowRead>(conflictRowsQ.data?.rows ?? []), [conflictRowsQ.data])
  const undecided = groupsAll.filter((g) => !g.decision).length
  const errors = batch?.summary.statuses?.ERROR ?? 0
  const needAttention = batch?.status === 'DRAFT' && (undecided > 0 || errors > 0)

  if (batchQ.isLoading || !batch) {
    return <div style={{ font: 'var(--font-body-s)', color: 'var(--fg-muted)' }}>Загрузка…</div>
  }
  if (batchQ.isError) {
    return <div style={{ font: 'var(--font-body-s)', color: 'var(--error-default)' }}>Не удалось загрузить пакет</div>
  }

  const st = BST[batch.status] ?? [batch.status, 'var(--neutral-container-default)']
  const publishedWorkflows = (workflowsQ.data ?? []).filter((w) => w.is_published)
  const replaceStageValue = batch.replace_stages[String(batch.workflow_id ?? '')] ?? ''
  const terminalStages = (stagesQ.data ?? []).filter((s) => s.is_terminal && !s.is_branch_stage && !s.archived_at)
  const draft = batch.status === 'DRAFT'

  async function setWorkflow(value: string) {
    try {
      await patchBatch.mutateAsync({ workflow_id: value ? Number(value) : null })
    } catch (e) {
      toast({ title: 'Не удалось сохранить воркфлоу', subtitle: errMessage(e), colorScheme: 'error' })
    }
  }
  async function setReplaceStage(value: string) {
    if (!batch || batch.workflow_id == null) return
    try {
      await patchBatch.mutateAsync({ replace_stages: { ...batch.replace_stages, [String(batch.workflow_id)]: Number(value) } })
    } catch (e) {
      toast({ title: 'Не удалось сохранить шаг закрытия', subtitle: errMessage(e), colorScheme: 'error' })
    }
  }

  function openConf() {
    if (undecided > 0) {
      setShowConfDialog(true)
    } else {
      setRf('ERROR')
      setStep('rows')
    }
  }

  const statuses = batch.summary.statuses ?? {}
  const totalRows = Object.values(statuses).reduce((a, b) => a + b, 0)
  const chips = [
    { key: '', label: 'Все', n: totalRows, dot: 'var(--neutral-muted)' },
    ...Object.entries(RST).map(([k, [label, dot]]) => ({ key: k, label, n: statuses[k] ?? 0, dot })),
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <button
          onClick={onBack}
          style={{ height: 32, padding: '0 12px', border: '1px solid var(--border-soft)', borderRadius: 'var(--border-radius-buttons)', background: 'var(--bg-surface1)', color: 'var(--fg-default)', font: 'var(--font-body-s-strong)', cursor: 'pointer' }}
        >
          ← Все пакеты
        </button>
        <span style={{ font: 'var(--font-heading-h4)', color: 'var(--fg-default)' }}>{batch.filename}</span>
        <span style={{ height: 22, padding: '0 8px', borderRadius: 'var(--border-radius-m)', background: st[1], font: 'var(--font-description-l-strong)', color: 'var(--fg-default)', display: 'flex', alignItems: 'center' }}>
          {st[0]}
        </span>
        <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)' }}>версия {batch.version}</span>
        <span style={{ flex: 1 }} />
        <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)' }}>Воркфлоу</span>
          <select value={batch.workflow_id ?? ''} disabled={!draft} onChange={(e) => setWorkflow(e.target.value)} style={SELECT_STYLE}>
            <option value="">Нет</option>
            {publishedWorkflows.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8 }} title="Куда закрывать заявки, которые заменяет импорт">
          <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)' }}>Заменяемые закрывать в</span>
          <select value={replaceStageValue} disabled={!draft || batch.workflow_id == null} onChange={(e) => setReplaceStage(e.target.value)} style={SELECT_STYLE}>
            <option value="">— выберите шаг —</option>
            {terminalStages.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {needAttention && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', background: 'var(--warning-container-default)', borderRadius: 'var(--border-radius-l)', padding: '12px 16px' }}>
          <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-default)', textWrap: 'pretty' }}>
            {undecided ? `Конфликтов без решения: ${undecided}. ` : ''}
            {errors ? `Ошибок в строках: ${errors} — исправьте их в предпросмотре или исключите строки.` : ''}
          </span>
          <button
            onClick={openConf}
            style={{ height: 34, padding: '0 16px', border: 0, borderRadius: 'var(--border-radius-buttons)', background: 'var(--accent-default)', color: '#fff', font: 'var(--font-body-s-strong)', cursor: 'pointer' }}
          >
            {undecided ? 'Разрешить конфликты' : 'Показать ошибки'}
          </button>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {chips.map((c) => (
          <button
            key={c.key}
            onClick={() => {
              setRf(c.key)
              setStep('rows')
            }}
            style={{
              height: 30,
              padding: '0 10px',
              border: `1px solid ${rf === c.key ? 'var(--accent-default)' : 'var(--border-soft)'}`,
              borderRadius: 'var(--border-radius-m)',
              background: rf === c.key ? 'var(--accent-container-muted)' : 'var(--bg-surface1)',
              font: 'var(--font-description-l-strong)',
              color: 'var(--fg-default)',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              cursor: 'pointer',
            }}
          >
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: c.dot }} />
            {c.label}
            <span style={{ color: 'var(--fg-muted)', fontVariantNumeric: 'tabular-nums' }}>{c.n}</span>
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 2, padding: 2, borderRadius: 'var(--border-radius-m)', background: 'var(--neutral-container-soft)', alignSelf: 'flex-start', flexWrap: 'wrap' }}>
        {STEPS.map((s) => (
          <button
            key={s.key}
            onClick={() => setStep(s.key)}
            style={{
              height: 30,
              padding: '0 14px',
              border: 0,
              borderRadius: 6,
              background: step === s.key ? 'var(--bg-surface1)' : 'transparent',
              font: 'var(--font-description-l-strong)',
              color: step === s.key ? 'var(--fg-default)' : 'var(--fg-soft)',
              cursor: 'pointer',
            }}
          >
            {s.label}
            {s.key === 'conf' && undecided > 0 ? ` · ${undecided}` : ''}
          </button>
        ))}
      </div>

      {step === 'sheets' && <SheetsStep batch={batch} kinds={kindsQ.data ?? []} />}
      {step === 'rows' && <RowsStep batchId={batchId} status={rf} onOpenRow={setOpenRowId} />}
      {step === 'conf' && <ConflictsStep batchId={batchId} />}
      {step === 'apply' && <ApplyStep batch={batch} onCancelled={onBack} />}

      {openRowId != null && <RowDialog batchId={batchId} rowId={openRowId} onClose={() => setOpenRowId(null)} />}
      {showConfDialog && <ConflictDialog batchId={batchId} onClose={() => setShowConfDialog(false)} onDone={() => setShowConfDialog(false)} />}
    </div>
  )
}
