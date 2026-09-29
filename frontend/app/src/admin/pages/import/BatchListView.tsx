import { useState } from 'react'
import { useImportBatches } from '../../../api/imports'
import { BST } from './constants'
import { formatDateTime, formatDate } from './format'
import { NewImportDialog } from './NewImportDialog'

const GRID = 'minmax(200px,1.5fr) 80px minmax(110px,.8fr) minmax(140px,1fr) minmax(140px,1fr) minmax(140px,1fr)'

export function BatchListView({ onOpen }: { onOpen: (id: number) => void }) {
  const [st, setSt] = useState('')
  const [dlg, setDlg] = useState(false)
  const batchesQ = useImportBatches(st || undefined, 50, 0)
  const batches = batchesQ.data ?? []

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <select
          value={st}
          onChange={(e) => setSt(e.target.value)}
          style={{ height: 36, padding: '0 8px', border: '1px solid var(--border-soft)', borderRadius: 'var(--border-radius-l)', background: 'var(--bg-surface1)', font: 'var(--font-body-s)', color: 'var(--fg-default)', outline: 0 }}
        >
          <option value="">Все статусы</option>
          {Object.entries(BST).map(([v, [l]]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
        <span style={{ flex: 1 }} />
        <button
          onClick={() => setDlg(true)}
          style={{ height: 36, padding: '0 16px', border: 0, borderRadius: 'var(--border-radius-buttons)', background: 'var(--accent-default)', color: '#fff', font: 'var(--font-body-s-strong)', cursor: 'pointer' }}
        >
          Новый импорт
        </button>
      </div>

      <section style={{ background: 'var(--bg-surface1)', border: '1px solid var(--border-muted)', borderRadius: 'var(--border-radius-l)', padding: '8px 16px 16px', display: 'flex', flexDirection: 'column', overflowX: 'auto' }}>
        <div style={{ display: 'grid', gridTemplateColumns: GRID, gap: 16, padding: '12px 8px 8px', font: 'var(--font-description-l)', color: 'var(--fg-muted)', minWidth: 800 }}>
          <span>Файл</span>
          <span>Формат</span>
          <span>Статус</span>
          <span>Загружен</span>
          <span>Применён</span>
          <span>Хранится до</span>
        </div>
        {batchesQ.isLoading && <div style={{ padding: '40px 8px', textAlign: 'center', font: 'var(--font-body-s)', color: 'var(--fg-muted)' }}>Загрузка…</div>}
        {batchesQ.isError && <div style={{ padding: '40px 8px', textAlign: 'center', font: 'var(--font-body-s)', color: 'var(--error-default)' }}>Не удалось загрузить пакеты</div>}
        {!batchesQ.isLoading && !batchesQ.isError && batches.length === 0 && (
          <div style={{ padding: '40px 8px', textAlign: 'center', font: 'var(--font-body-s)', color: 'var(--fg-muted)' }}>Пакетов нет</div>
        )}
        {batches.map((b) => {
          const st = BST[b.status] ?? [b.status, 'var(--neutral-container-default)']
          return (
            <div
              key={b.id}
              onClick={() => onOpen(b.id)}
              style={{ display: 'grid', gridTemplateColumns: GRID, gap: 16, padding: '12px 8px', borderTop: '1px solid var(--border-muted)', alignItems: 'center', cursor: 'pointer', minWidth: 800 }}
            >
              <span style={{ font: 'var(--font-body-s-strong)', color: 'var(--fg-default)' }}>{b.filename}</span>
              <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-soft)' }}>{b.file_format}</span>
              <span
                style={{
                  height: 22,
                  padding: '0 8px',
                  borderRadius: 'var(--border-radius-m)',
                  background: st[1],
                  font: 'var(--font-description-l-strong)',
                  color: 'var(--fg-default)',
                  display: 'flex',
                  alignItems: 'center',
                  justifySelf: 'start',
                }}
              >
                {st[0]}
              </span>
              <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-soft)' }}>{formatDateTime(b.created_at)}</span>
              <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-soft)' }}>{formatDateTime(b.applied_at)}</span>
              <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-soft)' }}>{formatDate(b.expires_at)}</span>
            </div>
          )
        })}
      </section>

      {dlg && (
        <NewImportDialog
          onClose={() => setDlg(false)}
          onUploaded={(id) => {
            setDlg(false)
            onOpen(id)
          }}
        />
      )}
    </div>
  )
}
