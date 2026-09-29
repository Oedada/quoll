import { useState } from 'react'
import { useImportRows } from '../../../api/imports'
import { RST, DECISION_LABEL, LVL, issueText, targetsText } from './constants'

const GRID = '70px 100px minmax(180px,1.2fr) minmax(220px,1.6fr) minmax(200px,1.4fr) 110px'
const PAGE_SIZE = 50

function sourceText(source: Record<string, string>): string {
  return Object.values(source).filter(Boolean).join(' · ') || '—'
}

function changeText(row: { status: string; excluded: boolean; diff: Record<string, [unknown, unknown]>; labels: Record<string, string>; targets: { part: string; action: string; id?: number }[] }): string {
  if (row.excluded) return 'Исключена'
  if (row.status === 'SAME') return 'Без изменений'
  if (row.status === 'ERROR') return '—'
  const diffEntries = Object.entries(row.diff)
  if (diffEntries.length) {
    return diffEntries.map(([k, v]) => `${row.labels[k] ?? k}: ${String(v[0])} → ${String(v[1])}`).join('; ')
  }
  return targetsText(row.targets)
}

export function RowsStep({ batchId, status, onOpenRow }: { batchId: number; status: string; onOpenRow: (id: number) => void }) {
  const [offset, setOffset] = useState(0)
  const [prevStatus, setPrevStatus] = useState(status)
  if (prevStatus !== status) {
    setPrevStatus(status)
    setOffset(0)
  }
  const rowsQ = useImportRows(batchId, { status: status ? [status] : undefined, limit: PAGE_SIZE, offset })
  const rows = rowsQ.data?.rows ?? []
  const total = rowsQ.data?.total ?? 0
  const canPrev = offset > 0
  const canNext = offset + PAGE_SIZE < total

  return (
    <section style={{ background: 'var(--bg-surface1)', border: '1px solid var(--border-muted)', borderRadius: 'var(--border-radius-l)', padding: '8px 16px 16px', display: 'flex', flexDirection: 'column', overflowX: 'auto' }}>
      <div style={{ padding: '12px 8px 4px', font: 'var(--font-description-l)', color: 'var(--fg-muted)' }}>
        Показано строк: {total}. Нажмите на строку — откроется предпросмотр и правка.
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: GRID, gap: 16, padding: '12px 8px 8px', font: 'var(--font-description-l)', color: 'var(--fg-muted)', minWidth: 900 }}>
        <span>Строка</span>
        <span>Статус</span>
        <span>Из файла</span>
        <span>Что будет в базе</span>
        <span>Замечания</span>
        <span>Решение</span>
      </div>
      {rowsQ.isLoading && <div style={{ padding: '40px 8px', textAlign: 'center', font: 'var(--font-body-s)', color: 'var(--fg-muted)' }}>Загрузка…</div>}
      {!rowsQ.isLoading && rows.length === 0 && <div style={{ padding: '40px 8px', textAlign: 'center', font: 'var(--font-body-s)', color: 'var(--fg-muted)' }}>Строк нет</div>}
      {rows.map((r) => {
        const rs = RST[r.status] ?? [r.status, 'var(--fg-default)', 'var(--neutral-container-default)']
        return (
          <div
            key={r.id}
            onClick={() => onOpenRow(r.id)}
            style={{ display: 'grid', gridTemplateColumns: GRID, gap: 16, padding: '12px 8px', borderTop: '1px solid var(--border-muted)', alignItems: 'start', minWidth: 900, opacity: r.excluded ? 0.5 : 1, cursor: 'pointer' }}
          >
            <span style={{ font: 'var(--font-body-s-strong)', color: 'var(--fg-default)' }}>
              {r.sheet}:{r.number}
            </span>
            <span style={{ height: 22, padding: '0 8px', borderRadius: 'var(--border-radius-m)', background: rs[2], font: 'var(--font-description-l-strong)', color: 'var(--fg-default)', display: 'flex', alignItems: 'center', justifySelf: 'start' }}>
              {rs[0]}
            </span>
            <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-soft)', textWrap: 'pretty' }}>{sourceText(r.source)}</span>
            <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-default)', textWrap: 'pretty' }}>{changeText(r)}</span>
            <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {r.issues.map((i, idx) => (
                <span key={idx} style={{ font: 'var(--font-description-l)', color: LVL[i.level]?.[0] ?? 'var(--fg-muted)', textWrap: 'pretty' }}>
                  {i.code} · {issueText(i.code, i.field)}
                </span>
              ))}
            </span>
            <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-soft)' }}>{r.decision ? DECISION_LABEL[r.decision] ?? r.decision : '—'}</span>
          </div>
        )
      })}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, borderTop: '1px solid var(--border-muted)', padding: '12px 8px 0', minWidth: 900 }}>
        <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-soft)', fontVariantNumeric: 'tabular-nums' }}>
          {total ? `${offset + 1}–${Math.min(offset + PAGE_SIZE, total)} из ${total}` : '0 из 0'}
        </span>
        <button
          onClick={() => canPrev && setOffset(offset - PAGE_SIZE)}
          disabled={!canPrev}
          style={{ height: 32, padding: '0 12px', border: '1px solid var(--border-soft)', borderRadius: 'var(--border-radius-m)', background: 'var(--bg-surface1)', color: 'var(--fg-default)', cursor: canPrev ? 'pointer' : 'default', opacity: canPrev ? 1 : 0.4 }}
        >
          Назад
        </button>
        <button
          onClick={() => canNext && setOffset(offset + PAGE_SIZE)}
          disabled={!canNext}
          style={{ height: 32, padding: '0 12px', border: '1px solid var(--border-soft)', borderRadius: 'var(--border-radius-m)', background: 'var(--bg-surface1)', color: 'var(--fg-default)', cursor: canNext ? 'pointer' : 'default', opacity: canNext ? 1 : 0.4 }}
        >
          Дальше
        </button>
      </div>
    </section>
  )
}
