import { useState } from 'react'
import {
  useImportRow,
  usePatchRow,
  useImportManagers,
  useUploadRowFile,
  useDeleteRowFile,
  errMessage,
} from '../../../api/imports'
import { useDocumentKinds } from '../../../api/catalog-extra'
import { RST, LVL, MANAGER_STATUS_LABEL, issueText, targetsText } from './constants'
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

const CONTACTS_OPTIONS = [
  { v: '', l: 'По умолчанию' },
  { v: 'add', l: 'Добавить к существующим' },
  { v: 'replace', l: 'Заменить существующие' },
]

export function RowDialog({ batchId, rowId, onClose }: { batchId: number; rowId: number; onClose: () => void }) {
  const toast = useToast()
  const rowQ = useImportRow(batchId, rowId)
  const row = rowQ.data
  const patchRow = usePatchRow(batchId)
  const uploadFile = useUploadRowFile(batchId)
  const deleteFile = useDeleteRowFile(batchId)
  const kindsQ = useDocumentKinds()
  const [mgrQ, setMgrQ] = useState('')
  const managersQ = useImportManagers(batchId, mgrQ)

  const [edits, setEdits] = useState<Record<string, string>>({})
  const [mgr, setMgr] = useState('')
  const [ct, setCt] = useState('')
  const [excl, setExcl] = useState(false)
  const [err, setErr] = useState('')
  const [fileKind, setFileKind] = useState('')

  // форма пересобирается из строки, когда та загрузилась или поменялась на сервере
  const rowKey = row ? `${row.id}|${row.manager_choice}|${row.contacts_target}|${row.excluded}` : ''
  const [syncedKey, setSyncedKey] = useState('')
  if (row && syncedKey !== rowKey) {
    setSyncedKey(rowKey)
    setMgr(row.manager_choice ?? '')
    setCt(row.contacts_target ?? '')
    setExcl(row.excluded)
    setEdits({})
  }

  if (!row) {
    return (
      <>
        <div onClick={onClose} style={DIALOG_OVERLAY} />
        <div style={DIALOG_BOX}>
          <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-muted)' }}>Загрузка…</span>
        </div>
      </>
    )
  }

  const rs = RST[row.status] ?? [row.status, 'var(--fg-default)', 'var(--neutral-container-default)']
  const sourceText = Object.values(row.source).filter(Boolean).join(' · ')
  const targets = targetsText(row.targets)

  async function save() {
    setErr('')
    try {
      const editsBody: Record<string, string | null> = {}
      for (const [k, v] of Object.entries(edits)) editsBody[k] = v
      await patchRow.mutateAsync({
        rowId,
        body: {
          edits: Object.keys(editsBody).length ? editsBody : undefined,
          excluded: excl,
          manager_choice: mgr,
          contacts_target: ct,
        },
      })
      toast({ title: 'Строка сохранена', colorScheme: 'success' })
      onClose()
    } catch (e) {
      setErr(errMessage(e))
    }
  }

  async function addFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const kind = fileKind || kindsQ.data?.[0]?.code
    if (!kind) return
    try {
      await uploadFile.mutateAsync({ rowId, file, kind })
      toast({ title: 'Файл прикреплён', colorScheme: 'success' })
    } catch (e2) {
      toast({ title: 'Не удалось прикрепить файл', subtitle: errMessage(e2), colorScheme: 'error' })
    }
  }

  async function removeFile(fileId: number) {
    try {
      await deleteFile.mutateAsync({ rowId, fileId })
    } catch (e2) {
      toast({ title: 'Не удалось открепить файл', subtitle: errMessage(e2), colorScheme: 'error' })
    }
  }

  return (
    <>
      <div onClick={onClose} style={DIALOG_OVERLAY} />
      <div style={DIALOG_BOX}>
        <span style={{ font: 'var(--font-heading-h3)', color: 'var(--fg-default)' }}>
          Строка {row.sheet}:{row.number}
        </span>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ height: 22, padding: '0 8px', borderRadius: 'var(--border-radius-m)', background: rs[2], font: 'var(--font-description-l-strong)', color: 'var(--fg-default)', display: 'flex', alignItems: 'center' }}>
            {rs[0]}
          </span>
          <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)' }}>{sourceText}</span>
        </div>

        {row.issues.map((i, idx) => (
          <div key={idx} style={{ borderRadius: 'var(--border-radius-m)', padding: '8px 12px', background: LVL[i.level]?.[1] ?? 'var(--neutral-container-soft)', font: 'var(--font-body-s)', color: 'var(--fg-default)', textWrap: 'pretty' }}>
            <b style={{ fontWeight: 600 }}>{i.code}</b> · {issueText(i.code, i.field)}
          </div>
        ))}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ font: 'var(--font-description-l-strong)', color: 'var(--fg-soft)' }}>Значения (можно поправить прямо здесь)</span>
          {Object.entries(row.values).map(([k, v]) => {
            const key = k
            const value = edits[key] ?? (v == null ? '' : String(v))
            const diff = row.diff[key]
            const bad = row.issues.some((i) => i.field === key && i.level === 'E')
            return (
              <div key={key} style={{ display: 'grid', gridTemplateColumns: '150px 1fr 1fr', gap: 10, alignItems: 'center', padding: '6px 0', borderTop: '1px solid var(--border-muted)' }}>
                <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)' }}>{row.labels[key] ?? key}</span>
                <input
                  value={value}
                  onInput={(e) => setEdits((z) => ({ ...z, [key]: (e.target as HTMLInputElement).value }))}
                  style={{ height: 34, padding: '0 10px', border: `1px solid ${bad ? 'var(--error-default)' : 'var(--border-soft)'}`, borderRadius: 'var(--border-radius-inputs)', background: 'var(--bg-surface1)', font: 'var(--font-body-s)', color: 'var(--fg-default)', outline: 0 }}
                />
                <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-soft)' }}>{diff ? `было: ${String(diff[0])}` : ''}</span>
              </div>
            )
          })}
        </div>

        {targets && <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-soft)', textWrap: 'pretty' }}>Затрагивает: {targets}</span>}

        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ font: 'var(--font-description-l-strong)', color: 'var(--fg-soft)' }}>Менеджер (если из файла не определился)</span>
          <input
            value={mgrQ}
            onInput={(e) => setMgrQ((e.target as HTMLInputElement).value)}
            placeholder="Поиск по ФИО"
            style={{ height: 32, padding: '0 10px', marginBottom: 4, border: '1px solid var(--border-soft)', borderRadius: 'var(--border-radius-inputs)', background: 'var(--bg-surface1)', font: 'var(--font-body-s)', color: 'var(--fg-default)', outline: 0 }}
          />
          <select
            value={mgr}
            onChange={(e) => setMgr(e.target.value)}
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

        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ font: 'var(--font-description-l-strong)', color: 'var(--fg-soft)' }}>Контакты вуза</span>
          <select
            value={ct}
            onChange={(e) => setCt(e.target.value)}
            style={{ height: 40, padding: '0 8px', border: '1px solid var(--border-soft)', borderRadius: 'var(--border-radius-inputs)', background: 'var(--bg-surface1)', font: 'var(--font-body-s)', color: 'var(--fg-default)', outline: 0 }}
          >
            {CONTACTS_OPTIONS.map((o) => (
              <option key={o.v} value={o.v}>
                {o.l}
              </option>
            ))}
          </select>
        </label>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ font: 'var(--font-description-l-strong)', color: 'var(--fg-soft)' }}>Файлы строки (договор, документы)</span>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            {row.files.map((f) => (
              <span key={f.id} style={{ height: 26, padding: '0 8px', borderRadius: 'var(--border-radius-m)', background: 'var(--neutral-container-soft)', font: 'var(--font-description-l)', color: 'var(--fg-default)', display: 'flex', alignItems: 'center', gap: 6 }}>
                {f.filename ?? f.kind}
                <button onClick={() => removeFile(f.id)} style={{ border: 0, background: 'transparent', color: 'var(--error-default)', cursor: 'pointer' }}>
                  ✕
                </button>
              </span>
            ))}
            <select
              value={fileKind}
              onChange={(e) => setFileKind(e.target.value)}
              style={{ height: 26, padding: '0 6px', border: '1px solid var(--border-soft)', borderRadius: 'var(--border-radius-m)', background: 'var(--bg-surface1)', font: 'var(--font-description-l)', color: 'var(--fg-default)', outline: 0 }}
            >
              {(kindsQ.data ?? []).map((k) => (
                <option key={k.code} value={k.code}>
                  {k.label}
                </option>
              ))}
            </select>
            <label style={{ height: 26, padding: '0 10px', border: '1px dashed var(--border-soft)', borderRadius: 'var(--border-radius-m)', font: 'var(--font-description-l-strong)', color: 'var(--accent-default)', display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
              ＋ Прикрепить
              <input type="file" onChange={addFile} style={{ display: 'none' }} />
            </label>
          </div>
        </div>

        <button
          onClick={() => setExcl((v) => !v)}
          style={{ height: 40, padding: '0 12px', border: '1px solid var(--border-soft)', borderRadius: 'var(--border-radius-inputs)', background: 'var(--bg-surface1)', display: 'flex', alignItems: 'center', gap: 8, font: 'var(--font-body-s)', color: 'var(--fg-default)', cursor: 'pointer' }}
        >
          <span style={{ width: 14, height: 14, borderRadius: 4, border: `2px solid ${excl ? 'var(--accent-default)' : 'var(--neutral-muted)'}`, background: excl ? 'var(--accent-default)' : 'transparent' }} />
          Исключить строку из импорта
        </button>

        {err && <span style={{ font: 'var(--font-description-l)', color: 'var(--error-default)' }}>{err}</span>}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button
            onClick={onClose}
            style={{ height: 40, padding: '0 20px', border: '1px solid var(--border-soft)', borderRadius: 'var(--border-radius-buttons)', background: 'var(--bg-surface1)', color: 'var(--fg-default)', font: 'var(--font-body-s-strong)', cursor: 'pointer' }}
          >
            Отмена
          </button>
          <button
            onClick={save}
            disabled={patchRow.isPending}
            style={{ height: 40, padding: '0 20px', border: 0, borderRadius: 'var(--border-radius-buttons)', background: 'var(--accent-default)', color: '#fff', font: 'var(--font-body-s-strong)', cursor: patchRow.isPending ? 'default' : 'pointer', opacity: patchRow.isPending ? 0.6 : 1 }}
          >
            Сохранить
          </button>
        </div>
      </div>
    </>
  )
}
