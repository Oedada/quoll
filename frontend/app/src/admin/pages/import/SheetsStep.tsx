import type { BatchRead, KindRead } from '../../../api/imports'
import { usePatchSheet } from '../../../api/imports'
import { LVL, issueText } from './constants'

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

export function SheetsStep({ batch, kinds }: { batch: BatchRead; kinds: KindRead[] }) {
  const patchSheet = usePatchSheet(batch.id)
  const draft = batch.status === 'DRAFT'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {batch.sheets.map((sh) => {
        const kind = kinds.find((k) => k.key === sh.kind)
        const fields = kind?.fields ?? []
        const counts = Object.entries(sh.counts)
          .map(([k, n]) => `${k}: ${n}`)
          .join(', ')
        return (
          <section
            key={sh.number}
            style={{ background: 'var(--bg-surface1)', border: '1px solid var(--border-muted)', borderRadius: 'var(--border-radius-l)', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <span style={{ font: 'var(--font-body-s-strong)', color: 'var(--fg-default)' }}>
                Лист {sh.number} · {sh.name}
              </span>
              <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)' }}>
                заголовки в строке {sh.header_row}
                {counts ? ` · ${counts}` : ''}
              </span>
              <span style={{ flex: 1 }} />
              <select
                value={sh.kind ?? ''}
                disabled={!draft}
                onChange={(e) => patchSheet.mutate({ number: sh.number, body: { kind: e.target.value || null } })}
                style={SELECT_STYLE}
              >
                <option value="">Пропустить лист</option>
                {kinds.map((k) => (
                  <option key={k.key} value={k.key}>
                    {k.label}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: '8px 16px' }}>
              {sh.headers.map((h) => (
                <label key={h.index} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)' }}>Колонка «{h.title}»</span>
                  <select
                    value={h.field ?? ''}
                    disabled={!draft || !sh.kind}
                    onChange={(e) =>
                      patchSheet.mutate({ number: sh.number, body: { mapping: { [h.index]: e.target.value || null } } })
                    }
                    style={SELECT_STYLE}
                  >
                    <option value="">— не использовать —</option>
                    {fields.map((f) => (
                      <option key={f.key} value={f.key}>
                        {f.label}
                        {f.required ? ' *' : ''}
                      </option>
                    ))}
                  </select>
                  {!h.field && <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)' }}>не используется</span>}
                  {h.field && fields.find((f) => f.key === h.field)?.ignored && (
                    <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)' }}>не импортируется</span>
                  )}
                </label>
              ))}
            </div>

            {sh.issues.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {sh.issues.map((i, idx) => {
                  const code = typeof i.code === 'string' ? i.code : ''
                  const level = typeof i.level === 'string' ? i.level : 'I'
                  const color = LVL[level]?.[0] ?? 'var(--warning-default)'
                  const field = typeof i.field === 'string' ? i.field : null
                  return (
                    <span key={idx} style={{ font: 'var(--font-description-l)', color, textWrap: 'pretty' }}>
                      {code ? `${code} · ${issueText(code, field)}` : JSON.stringify(i)}
                    </span>
                  )
                })}
              </div>
            )}
          </section>
        )
      })}
    </div>
  )
}
