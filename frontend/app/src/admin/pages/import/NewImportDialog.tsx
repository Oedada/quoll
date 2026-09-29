import { useState } from 'react'
import { useImportKinds, useUploadImport, importTemplateUrl, triggerDownload, errMessage } from '../../../api/imports'
import { useToast } from '../../../manager/ToastContext'

const DIALOG_OVERLAY: React.CSSProperties = { position: 'fixed', inset: 0, zIndex: 80, background: 'rgba(14,17,23,.4)' }
const DIALOG_BOX: React.CSSProperties = {
  position: 'fixed',
  zIndex: 81,
  top: '50%',
  left: '50%',
  transform: 'translate(-50%,-50%)',
  width: 520,
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

export function NewImportDialog({ onClose, onUploaded }: { onClose: () => void; onUploaded: (batchId: number) => void }) {
  const toast = useToast()
  const kindsQ = useImportKinds()
  const upload = useUploadImport()
  const [file, setFile] = useState<File | null>(null)
  const [tplKinds, setTplKinds] = useState<Set<string>>(new Set())
  const [err, setErr] = useState('')

  function toggleTpl(key: string) {
    setTplKinds((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  async function confirm() {
    if (!file) {
      setErr('Выберите файл')
      return
    }
    setErr('')
    try {
      const batch = await upload.mutateAsync({ file })
      toast({ title: 'Файл разобран', subtitle: file.name, colorScheme: 'success' })
      onUploaded(batch.id)
    } catch (e) {
      setErr(errMessage(e))
    }
  }

  return (
    <>
      <div onClick={onClose} style={DIALOG_OVERLAY} />
      <div style={DIALOG_BOX}>
        <span style={{ font: 'var(--font-heading-h3)', color: 'var(--fg-default)' }}>Новый импорт</span>

        <label style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}>
          <span
            style={{
              height: 36,
              padding: '0 16px',
              border: `1px solid ${err && !file ? 'var(--error-default)' : 'var(--border-soft)'}`,
              borderRadius: 'var(--border-radius-buttons)',
              background: 'var(--bg-surface1)',
              color: 'var(--fg-default)',
              font: 'var(--font-body-s-strong)',
              display: 'flex',
              alignItems: 'center',
            }}
          >
            Выбрать файл
          </span>
          <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-muted)' }}>{file ? file.name : 'Файл не выбран'}</span>
          <input
            type="file"
            accept=".xlsx,.xls,.csv,.json"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null)
              setErr('')
            }}
            style={{ display: 'none' }}
          />
        </label>
        <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)' }}>xlsx, xls, csv или json. Листы, которые не удалось опознать, пропускаются.</span>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ font: 'var(--font-description-l-strong)', color: 'var(--fg-soft)' }}>Шаблон файла с инструкциями: отметьте нужные виды листов</span>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {(kindsQ.data ?? []).map((k) => {
              const on = tplKinds.has(k.key)
              return (
                <button
                  key={k.key}
                  onClick={() => toggleTpl(k.key)}
                  style={{
                    height: 28,
                    padding: '0 10px',
                    border: `1px solid ${on ? 'var(--accent-default)' : 'var(--border-soft)'}`,
                    borderRadius: 'var(--border-radius-m)',
                    background: on ? 'var(--accent-container-muted)' : 'var(--bg-surface1)',
                    font: 'var(--font-description-l-strong)',
                    color: 'var(--fg-default)',
                    cursor: 'pointer',
                  }}
                >
                  {k.label}
                </button>
              )
            })}
          </div>
          <button
            onClick={() => triggerDownload(importTemplateUrl([...tplKinds]))}
            style={{
              alignSelf: 'flex-start',
              height: 32,
              padding: '0 12px',
              border: '1px solid var(--border-soft)',
              borderRadius: 'var(--border-radius-buttons)',
              background: 'var(--bg-surface1)',
              color: 'var(--fg-default)',
              font: 'var(--font-body-s-strong)',
              cursor: 'pointer',
            }}
          >
            Скачать шаблон (xlsx)
          </button>
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
            disabled={upload.isPending}
            style={{
              height: 40,
              padding: '0 20px',
              border: 0,
              borderRadius: 'var(--border-radius-buttons)',
              background: 'var(--accent-default)',
              color: '#fff',
              font: 'var(--font-body-s-strong)',
              cursor: upload.isPending ? 'default' : 'pointer',
              opacity: upload.isPending ? 0.6 : 1,
            }}
          >
            Загрузить
          </button>
        </div>
      </div>
    </>
  )
}
