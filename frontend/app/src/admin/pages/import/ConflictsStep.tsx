import { useMemo, useState } from 'react'
import type { RowRead } from '../../../api/imports'
import { useImportRows, useImportManagers, useImportDecisions, usePatchRow, errMessage } from '../../../api/imports'
import { DECISION_LABEL, MANAGER_STATUS_LABEL, groupsFromRows, issueText } from './constants'
import { useToast } from '../../../manager/ToastContext'

const DECISIONS = ['REPLACE', 'SKIP']

export function ConflictsStep({ batchId }: { batchId: number }) {
  const toast = useToast()
  const [unresOnly, setUnresOnly] = useState(true)
  const [mgrQ, setMgrQ] = useState('')
  const rowsQ = useImportRows(batchId, { status: ['CONFLICT'], limit: 200 })
  const managersQ = useImportManagers(batchId, mgrQ)
  const decisions = useImportDecisions(batchId)
  const patchRow = usePatchRow(batchId)

  const groupsAll = useMemo(() => groupsFromRows<RowRead>(rowsQ.data?.rows ?? []), [rowsQ.data])
  const groups = unresOnly ? groupsAll.filter((g) => !g.decision) : groupsAll

  async function setGroupDecision(key: string, decision: string) {
    try {
      await decisions.mutateAsync({ decision, group_keys: [key], only_unresolved: false })
    } catch (e) {
      toast({ title: 'Не удалось сохранить решение', subtitle: errMessage(e), colorScheme: 'error' })
    }
  }

  async function setGroupManager(rows: RowRead[], managerId: string) {
    try {
      await Promise.all(rows.map((r) => patchRow.mutateAsync({ rowId: r.id, body: { manager_choice: managerId } })))
    } catch (e) {
      toast({ title: 'Не удалось выбрать менеджера', subtitle: errMessage(e), colorScheme: 'error' })
    }
  }

  async function bulk(decision: string) {
    try {
      await decisions.mutateAsync({ decision, only_unresolved: true })
      toast({ title: 'Решение применено ко всем конфликтам', colorScheme: 'success' })
    } catch (e) {
      toast({ title: 'Не удалось применить решение', subtitle: errMessage(e), colorScheme: 'error' })
    }
  }

  return (
    <section style={{ background: 'var(--bg-surface1)', border: '1px solid var(--border-muted)', borderRadius: 'var(--border-radius-l)', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-soft)', textWrap: 'pretty' }}>
          Конфликт — когда в базе уже есть открытая заявка на этот вуз. Для каждой группы строк: пропустить или заменить существующую (её закроют).
        </span>
        <button
          onClick={() => setUnresOnly((v) => !v)}
          style={{ height: 32, padding: '0 12px', border: '1px solid var(--border-soft)', borderRadius: 'var(--border-radius-inputs)', background: 'var(--bg-surface1)', display: 'flex', alignItems: 'center', gap: 8, font: 'var(--font-body-s)', color: 'var(--fg-default)', cursor: 'pointer' }}
        >
          <span style={{ width: 14, height: 14, borderRadius: 4, border: `2px solid ${unresOnly ? 'var(--accent-default)' : 'var(--neutral-muted)'}`, background: unresOnly ? 'var(--accent-default)' : 'transparent' }} />
          Только нерешённые
        </button>
      </div>

      <label style={{ display: 'flex', alignItems: 'center', gap: 8, alignSelf: 'flex-start' }}>
        <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)' }}>Поиск менеджера</span>
        <input
          value={mgrQ}
          onInput={(e) => setMgrQ((e.target as HTMLInputElement).value)}
          placeholder="ФИО"
          style={{ height: 32, padding: '0 10px', border: '1px solid var(--border-soft)', borderRadius: 'var(--border-radius-inputs)', background: 'var(--bg-surface1)', font: 'var(--font-body-s)', color: 'var(--fg-default)', outline: 0 }}
        />
      </label>

      {rowsQ.isLoading && <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-muted)' }}>Загрузка…</span>}
      {!rowsQ.isLoading && groups.length === 0 && <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-muted)', padding: '16px 0' }}>Конфликтов нет</span>}

      {groups.map((g) => {
        const why = [...new Set(g.rows.flatMap((r) => r.issues.map((i) => issueText(i.code, i.field))))]
        const currentMgr = g.rows.find((r) => r.manager_choice)?.manager_choice ?? ''
        return (
          <div key={g.key} style={{ border: '1px solid var(--border-muted)', borderRadius: 'var(--border-radius-m)', padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <span style={{ flex: 1, font: 'var(--font-body-s-strong)', color: 'var(--fg-default)' }}>
                {g.key} <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)' }}>· строк: {g.rows.length}</span>
              </span>
              {DECISIONS.map((d) => (
                <button
                  key={d}
                  onClick={() => setGroupDecision(g.key, d)}
                  style={{
                    height: 30,
                    padding: '0 12px',
                    border: `1px solid ${g.decision === d ? 'var(--accent-default)' : 'var(--border-soft)'}`,
                    borderRadius: 'var(--border-radius-buttons)',
                    background: g.decision === d ? 'var(--accent-container-muted)' : 'var(--bg-surface1)',
                    font: 'var(--font-description-l-strong)',
                    color: 'var(--fg-default)',
                    cursor: 'pointer',
                  }}
                >
                  {DECISION_LABEL[d]}
                </button>
              ))}
            </div>
            {why.map((w, i) => (
              <span key={i} style={{ font: 'var(--font-description-l)', color: 'var(--fg-soft)', textWrap: 'pretty' }}>
                {w}
              </span>
            ))}
            {g.needMgr && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)' }}>Менеджер</span>
                <select
                  value={currentMgr}
                  onChange={(e) => setGroupManager(g.rows, e.target.value)}
                  style={{ height: 32, padding: '0 8px', border: '1px solid var(--border-soft)', borderRadius: 'var(--border-radius-inputs)', background: 'var(--bg-surface1)', font: 'var(--font-body-s)', color: 'var(--fg-default)', outline: 0 }}
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
          </div>
        )
      })}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)', alignSelf: 'center' }}>Всем группам:</span>
        {DECISIONS.map((d) => (
          <button
            key={d}
            onClick={() => bulk(d)}
            style={{ height: 30, padding: '0 10px', border: '1px solid var(--border-soft)', borderRadius: 'var(--border-radius-buttons)', background: 'var(--bg-surface1)', font: 'var(--font-description-l-strong)', color: 'var(--fg-default)', cursor: 'pointer' }}
          >
            {DECISION_LABEL[d]}
          </button>
        ))}
      </div>
    </section>
  )
}
