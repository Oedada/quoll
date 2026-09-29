import { useMemo, useState } from 'react'
import type { RowRead } from '../../../api/imports'
import { useImportRows, useImportManagers, useImportDecisions, usePatchRow, errMessage } from '../../../api/imports'
import { DECISION_LABEL, MANAGER_STATUS_LABEL, groupsFromRows, issueText } from './constants'
import { useToast } from '../../../manager/ToastContext'

const DIALOG_OVERLAY: React.CSSProperties = { position: 'fixed', inset: 0, zIndex: 80, background: 'rgba(14,17,23,.4)' }
const DIALOG_BOX: React.CSSProperties = {
  position: 'fixed',
  zIndex: 81,
  top: '50%',
  left: '50%',
  transform: 'translate(-50%,-50%)',
  width: 680,
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
}

const DECISION_HINT: Record<string, string> = {
  REPLACE: 'Существующая заявка будет закрыта, а из файла создастся новая.',
  SKIP: 'Строки этого вуза не применяются: файлы и контакты тоже.',
}

export function ConflictDialog({ batchId, onClose, onDone }: { batchId: number; onClose: () => void; onDone: () => void }) {
  const toast = useToast()
  const [ci, setCi] = useState(0)
  const [mgrQ, setMgrQ] = useState('')
  const [err, setErr] = useState('')
  const rowsQ = useImportRows(batchId, { status: ['CONFLICT'], limit: 200 })
  const managersQ = useImportManagers(batchId, mgrQ)
  const decisions = useImportDecisions(batchId)
  const patchRow = usePatchRow(batchId)

  const groupsAll = useMemo(() => groupsFromRows<RowRead>(rowsQ.data?.rows ?? []), [rowsQ.data])
  const undecided = groupsAll.filter((g) => !g.decision).length
  const idx = Math.min(ci, Math.max(groupsAll.length - 1, 0))
  const cg = groupsAll[idx]

  async function pick(decision: string) {
    if (!cg) return
    try {
      await decisions.mutateAsync({ decision, group_keys: [cg.key], only_unresolved: false })
      setErr('')
    } catch (e) {
      toast({ title: 'Не удалось сохранить решение', subtitle: errMessage(e), colorScheme: 'error' })
    }
  }

  async function setManager(managerId: string) {
    if (!cg) return
    try {
      await Promise.all(cg.rows.map((r) => patchRow.mutateAsync({ rowId: r.id, body: { manager_choice: managerId } })))
    } catch (e) {
      toast({ title: 'Не удалось выбрать менеджера', subtitle: errMessage(e), colorScheme: 'error' })
    }
  }

  function confirm() {
    if (!cg) {
      onDone()
      return
    }
    if (!cg.decision) {
      setErr('Выберите решение для этой группы')
      return
    }
    setErr('')
    if (idx < groupsAll.length - 1) {
      setCi(idx + 1)
      return
    }
    toast({ title: 'Конфликты разрешены', subtitle: undecided > 1 ? `Осталось без решения: ${undecided - 1}` : 'Можно применять', colorScheme: 'success' })
    onDone()
  }

  if (rowsQ.isLoading) {
    return (
      <>
        <div onClick={onClose} style={DIALOG_OVERLAY} />
        <div style={DIALOG_BOX}>
          <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-muted)' }}>Загрузка…</span>
        </div>
      </>
    )
  }

  if (!cg) {
    return (
      <>
        <div onClick={onClose} style={DIALOG_OVERLAY} />
        <div style={DIALOG_BOX}>
          <span style={{ font: 'var(--font-heading-h3)', color: 'var(--fg-default)' }}>Разрешение конфликтов</span>
          <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-muted)' }}>Конфликтов нет</span>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button
              onClick={onClose}
              style={{ height: 40, padding: '0 20px', border: 0, borderRadius: 'var(--border-radius-buttons)', background: 'var(--accent-default)', color: '#fff', font: 'var(--font-body-s-strong)', cursor: 'pointer' }}
            >
              Закрыть
            </button>
          </div>
        </div>
      </>
    )
  }

  const why = [...new Set(cg.rows.flatMap((r) => r.issues.map((i) => issueText(i.code, i.field))))]
  const currentMgr = cg.rows.find((r) => r.manager_choice)?.manager_choice ?? ''

  return (
    <>
      <div onClick={onClose} style={DIALOG_OVERLAY} />
      <div style={DIALOG_BOX}>
        <span style={{ font: 'var(--font-heading-h3)', color: 'var(--fg-default)' }}>Разрешение конфликтов</span>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ height: 22, padding: '0 8px', borderRadius: 'var(--border-radius-m)', background: 'var(--warning-container-default)', font: 'var(--font-description-l-strong)', color: 'var(--fg-default)', display: 'flex', alignItems: 'center' }}>
            Конфликт {idx + 1} из {groupsAll.length}
          </span>
          <span style={{ font: 'var(--font-body-s-strong)', color: 'var(--fg-default)' }}>{cg.key}</span>
          <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)' }}>строк в группе: {cg.rows.length}</span>
        </div>

        {cg.rows.map((r) => (
          <div key={r.id} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div
              style={{ border: '1px solid var(--border-muted)', borderRadius: 'var(--border-radius-m)', padding: 12, display: 'flex', flexDirection: 'column', gap: 4 }}
            >
              <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)' }}>
                В файле · строка {r.sheet}:{r.number}
              </span>
              <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-default)', textWrap: 'pretty' }}>{Object.values(r.source).filter(Boolean).join(' · ')}</span>
            </div>
          </div>
        ))}
        {why.map((w, i) => (
          <div key={i} style={{ borderRadius: 'var(--border-radius-m)', padding: '8px 12px', background: 'var(--warning-container-soft)', font: 'var(--font-body-s)', color: 'var(--fg-default)', textWrap: 'pretty' }}>
            {w}
          </div>
        ))}

        {cg.needMgr && (
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ font: 'var(--font-description-l-strong)', color: 'var(--fg-soft)' }}>Менеджер</span>
            <input
              value={mgrQ}
              onInput={(e) => setMgrQ((e.target as HTMLInputElement).value)}
              placeholder="Поиск по ФИО"
              style={{ height: 32, padding: '0 10px', border: '1px solid var(--border-soft)', borderRadius: 'var(--border-radius-inputs)', background: 'var(--bg-surface1)', font: 'var(--font-body-s)', color: 'var(--fg-default)', outline: 0 }}
            />
            <select
              value={currentMgr}
              onChange={(e) => setManager(e.target.value)}
              style={{ height: 40, padding: '0 8px', border: '1px solid var(--border-soft)', borderRadius: 'var(--border-radius-inputs)', background: 'var(--bg-surface1)', font: 'var(--font-body-s)', color: 'var(--fg-default)', outline: 0 }}
            >
              <option value="">Не выбран</option>
              {(managersQ.data ?? []).map((m) => {
                const note = MANAGER_STATUS_LABEL[m.status]
                return (
                  <option key={m.id} value={m.id}>
                    {m.name}
                    {note ? ` (${note})` : ''}
                  </option>
                )
              })}
            </select>
          </label>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ font: 'var(--font-description-l-strong)', color: 'var(--fg-soft)' }}>Решение</span>
          {['REPLACE', 'SKIP'].map((v) => (
            <button
              key={v}
              onClick={() => pick(v)}
              style={{
                border: `1.5px solid ${cg.decision === v ? 'var(--accent-default)' : 'var(--border-soft)'}`,
                background: cg.decision === v ? 'var(--accent-container-muted)' : 'var(--bg-surface1)',
                borderRadius: 'var(--border-radius-m)',
                padding: '10px 12px',
                display: 'flex',
                flexDirection: 'column',
                gap: 2,
                textAlign: 'left',
                cursor: 'pointer',
              }}
            >
              <span style={{ font: 'var(--font-body-s-strong)', color: 'var(--fg-default)' }}>{DECISION_LABEL[v]}</span>
              <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)', textWrap: 'pretty' }}>{DECISION_HINT[v]}</span>
            </button>
          ))}
        </div>

        {err && <span style={{ font: 'var(--font-description-l)', color: 'var(--error-default)' }}>{err}</span>}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button
            onClick={onClose}
            style={{ height: 40, padding: '0 20px', border: '1px solid var(--border-soft)', borderRadius: 'var(--border-radius-buttons)', background: 'var(--bg-surface1)', color: 'var(--fg-default)', font: 'var(--font-body-s-strong)', cursor: 'pointer' }}
          >
            Отмена
          </button>
          <button
            onClick={confirm}
            style={{ height: 40, padding: '0 20px', border: 0, borderRadius: 'var(--border-radius-buttons)', background: 'var(--accent-default)', color: '#fff', font: 'var(--font-body-s-strong)', cursor: 'pointer' }}
          >
            {idx < groupsAll.length - 1 ? 'Далее' : 'Готово'}
          </button>
        </div>
      </div>
    </>
  )
}
