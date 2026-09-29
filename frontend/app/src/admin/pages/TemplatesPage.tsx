import { useMemo, useState } from 'react'
import { Atomaro } from '../../ds/atomaro'
import {
  useAttachments,
  useUploadAttachment,
  useDeleteAttachment,
  useAttachmentPresignedUrl,
  attachmentDownloadUrl,
  type AttachmentListRead,
} from '../../api/attachments'
import { ApiError } from '../../api/client'
import { useToast } from '../../manager/ToastContext'

type DialogState = { kind: 'upload' } | { kind: 'delete'; row: AttachmentListRead }

function errMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message
  return 'Не удалось выполнить действие'
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })
}

const GRID_COLS = 'minmax(200px,1.5fr) minmax(110px,.8fr) minmax(180px,1.2fr) minmax(200px,1.4fr) 230px'

export default function TemplatesPage() {
  const toast = useToast()
  const attachmentsQ = useAttachments()
  const uploadMutation = useUploadAttachment()
  const deleteMutation = useDeleteAttachment()
  const presignedUrlMutation = useAttachmentPresignedUrl()

  const [q, setQ] = useState('')
  const [cat, setCat] = useState('')
  const [dialog, setDialog] = useState<DialogState | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const [file, setFile] = useState<File | null>(null)
  const [title, setTitle] = useState('')
  const [category, setCategory] = useState('')
  const [preview, setPreview] = useState('')
  const [tried, setTried] = useState(false)

  const rows = useMemo(() => attachmentsQ.data ?? [], [attachmentsQ.data])

  const categories = useMemo(() => [...new Set(rows.map((r) => r.category).filter((c): c is string => !!c))], [rows])

  const filtered = useMemo(() => {
    const qLower = q.trim().toLowerCase()
    return rows.filter((r) => {
      const matchesCat = !cat || r.category === cat
      const matchesQ = !qLower || `${r.title ?? ''} ${r.filename}`.toLowerCase().includes(qLower)
      return matchesCat && matchesQ
    })
  }, [rows, q, cat])

  function openUpload() {
    setDialog({ kind: 'upload' })
    setFile(null)
    setTitle('')
    setCategory('')
    setPreview('')
    setTried(false)
    setErr('')
  }
  function openDelete(row: AttachmentListRead) {
    setDialog({ kind: 'delete', row })
    setErr('')
  }
  function closeDialog() {
    setDialog(null)
    setErr('')
  }

  async function handleDownload(row: AttachmentListRead) {
    window.open(attachmentDownloadUrl(row.id), '_blank')
  }

  async function handleCopyLink(row: AttachmentListRead) {
    try {
      const res = await presignedUrlMutation.mutateAsync(row.id)
      await navigator.clipboard.writeText(res.url)
      toast({ title: 'Ссылка скопирована', subtitle: `Действует ${Math.round(res.expires_in / 60)} мин.`, colorScheme: 'success' })
    } catch (e) {
      toast({ title: 'Не удалось получить ссылку', subtitle: errMessage(e), colorScheme: 'error' })
    }
  }

  async function submitUpload() {
    if (!file || !title.trim()) {
      setTried(true)
      setErr('Заполните обязательные поля')
      return
    }
    setErr('')
    setBusy(true)
    try {
      await uploadMutation.mutateAsync({
        file,
        title: title.trim(),
        category: category.trim() || undefined,
        preview: preview.trim() || undefined,
      })
      toast({ title: 'Шаблон загружен', subtitle: title.trim(), colorScheme: 'success' })
      closeDialog()
    } catch (e) {
      setErr(errMessage(e))
    } finally {
      setBusy(false)
    }
  }

  async function submitDelete() {
    if (dialog?.kind !== 'delete') return
    setErr('')
    setBusy(true)
    try {
      await deleteMutation.mutateAsync(dialog.row.id)
      toast({ title: 'Шаблон удалён', subtitle: dialog.row.title ?? dialog.row.filename, colorScheme: 'success' })
      closeDialog()
    } catch (e) {
      setErr(errMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const fileBorder = tried && !file ? 'var(--error-default)' : 'var(--border-soft)'
  const titleBorder = tried && !title.trim() ? 'var(--error-default)' : 'var(--border-soft)'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <label
          style={{
            width: 260,
            height: 36,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '0 12px',
            background: 'var(--bg-surface1)',
            border: '1px solid var(--border-soft)',
            borderRadius: 'var(--border-radius-l)',
          }}
        >
          <Atomaro.Search16 size={16} fill="var(--fg-muted)" />
          <input
            value={q}
            onInput={(e) => setQ((e.target as HTMLInputElement).value)}
            placeholder="Название или файл"
            style={{ border: 0, outline: 0, background: 'transparent', flex: 1, minWidth: 0, font: 'var(--font-body-s)', color: 'var(--fg-default)' }}
          />
        </label>
        <select
          value={cat}
          onChange={(e) => setCat(e.target.value)}
          style={{
            height: 36,
            padding: '0 8px',
            border: '1px solid var(--border-soft)',
            borderRadius: 'var(--border-radius-l)',
            background: 'var(--bg-surface1)',
            font: 'var(--font-body-s)',
            color: 'var(--fg-default)',
            outline: 0,
          }}
        >
          <option value="">Все категории</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <span style={{ flex: 1 }} />
        <button
          onClick={openUpload}
          style={{
            height: 36,
            padding: '0 16px',
            border: 0,
            borderRadius: 'var(--border-radius-buttons)',
            background: 'var(--accent-default)',
            color: '#fff',
            font: 'var(--font-body-s-strong)',
            cursor: 'pointer',
          }}
        >
          Загрузить шаблон
        </button>
      </div>

      <section
        style={{
          background: 'var(--bg-surface1)',
          border: '1px solid var(--border-muted)',
          borderRadius: 'var(--border-radius-l)',
          padding: '8px 16px 16px',
          display: 'flex',
          flexDirection: 'column',
          overflowX: 'auto',
        }}
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: GRID_COLS,
            gap: 16,
            padding: '12px 8px 8px',
            font: 'var(--font-description-l)',
            color: 'var(--fg-muted)',
            minWidth: 860,
          }}
        >
          <span>Шаблон</span>
          <span>Категория</span>
          <span>Файл</span>
          <span>Используется в переходах</span>
          <span></span>
        </div>

        {attachmentsQ.isLoading && (
          <div style={{ padding: '40px 8px', textAlign: 'center', font: 'var(--font-body-s)', color: 'var(--fg-muted)' }}>Загрузка…</div>
        )}
        {attachmentsQ.isError && (
          <div style={{ padding: '40px 8px', textAlign: 'center', font: 'var(--font-body-s)', color: 'var(--error-default)' }}>
            Не удалось загрузить шаблоны
          </div>
        )}
        {!attachmentsQ.isLoading && !attachmentsQ.isError && filtered.length === 0 && (
          <div style={{ padding: '40px 8px', textAlign: 'center', font: 'var(--font-body-s)', color: 'var(--fg-muted)' }}>Шаблонов нет</div>
        )}

        {!attachmentsQ.isLoading &&
          !attachmentsQ.isError &&
          filtered.map((r) => (
            <div
              key={r.id}
              style={{
                display: 'grid',
                gridTemplateColumns: GRID_COLS,
                gap: 16,
                padding: '12px 8px',
                borderTop: '1px solid var(--border-muted)',
                alignItems: 'start',
                minWidth: 860,
              }}
            >
              <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ font: 'var(--font-body-s-strong)', color: 'var(--fg-default)' }}>{r.title ?? r.filename}</span>
                {r.preview && <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)', textWrap: 'pretty' }}>{r.preview}</span>}
              </span>
              <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-soft)' }}>{r.category ?? '—'}</span>
              <span style={{ display: 'flex', flexDirection: 'column' }}>
                <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-default)' }}>{r.filename}</span>
                <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)' }}>
                  {formatSize(r.size_bytes)} · {formatDate(r.created_at)}
                </span>
              </span>
              <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {r.used_by.length === 0 && <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)' }}>пока нигде</span>}
                {r.used_by.map((u) => (
                  <span
                    key={u.id}
                    style={{
                      height: 22,
                      padding: '0 8px',
                      borderRadius: 'var(--border-radius-m)',
                      background: 'var(--neutral-container-soft)',
                      font: 'var(--font-description-l)',
                      color: 'var(--fg-soft)',
                      display: 'flex',
                      alignItems: 'center',
                    }}
                  >
                    {u.name}
                  </span>
                ))}
              </span>
              <div style={{ display: 'flex', gap: 2, justifyContent: 'flex-end' }}>
                <RowActionButton label="Скачать" color="var(--fg-soft)" onClick={() => handleDownload(r)} />
                <RowActionButton label="Ссылка" color="var(--fg-soft)" onClick={() => handleCopyLink(r)} />
                <RowActionButton label="Удалить" color="var(--error-default)" onClick={() => openDelete(r)} />
              </div>
            </div>
          ))}
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
              gap: 14,
            }}
          >
            <span style={{ font: 'var(--font-heading-h3)', color: 'var(--fg-default)' }}>
              {dialog.kind === 'upload' ? 'Загрузить шаблон' : 'Удалить шаблон'}
            </span>

            {dialog.kind === 'delete' && (
              <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-soft)', textWrap: 'pretty' }}>
                {dialog.row.used_by.length > 0
                  ? `Шаблон привязан к переходам (${dialog.row.used_by.map((u) => u.name).join(', ')}). После удаления он исчезнет и оттуда.`
                  : 'Файл будет удалён.'}
              </span>
            )}

            {dialog.kind === 'upload' && (
              <>
                <label style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}>
                  <span
                    style={{
                      height: 36,
                      padding: '0 16px',
                      border: `1px solid ${fileBorder}`,
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
                    onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                    style={{ display: 'none' }}
                  />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <span style={{ font: 'var(--font-description-l-strong)', color: 'var(--fg-soft)' }}>Название *</span>
                  <input
                    value={title}
                    onInput={(e) => setTitle((e.target as HTMLInputElement).value)}
                    style={{ height: 40, padding: '0 12px', border: `1px solid ${titleBorder}`, borderRadius: 'var(--border-radius-inputs)', background: 'var(--bg-surface1)', font: 'var(--font-body-s)', color: 'var(--fg-default)', outline: 0 }}
                  />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <span style={{ font: 'var(--font-description-l-strong)', color: 'var(--fg-soft)' }}>Категория</span>
                  <input
                    value={category}
                    onInput={(e) => setCategory((e.target as HTMLInputElement).value)}
                    style={{ height: 40, padding: '0 12px', border: '1px solid var(--border-soft)', borderRadius: 'var(--border-radius-inputs)', background: 'var(--bg-surface1)', font: 'var(--font-body-s)', color: 'var(--fg-default)', outline: 0 }}
                  />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <span style={{ font: 'var(--font-description-l-strong)', color: 'var(--fg-soft)' }}>Краткое описание</span>
                  <input
                    value={preview}
                    onInput={(e) => setPreview((e.target as HTMLInputElement).value)}
                    style={{ height: 40, padding: '0 12px', border: '1px solid var(--border-soft)', borderRadius: 'var(--border-radius-inputs)', background: 'var(--bg-surface1)', font: 'var(--font-body-s)', color: 'var(--fg-default)', outline: 0 }}
                  />
                </label>
              </>
            )}

            {err && <span style={{ font: 'var(--font-description-l)', color: 'var(--error-default)' }}>{err}</span>}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button
                onClick={closeDialog}
                style={{ height: 40, padding: '0 20px', border: '1px solid var(--border-soft)', borderRadius: 'var(--border-radius-buttons)', background: 'var(--bg-surface1)', color: 'var(--fg-default)', font: 'var(--font-body-s-strong)', cursor: 'pointer' }}
              >
                Отмена
              </button>
              <button
                onClick={dialog.kind === 'upload' ? submitUpload : submitDelete}
                disabled={busy}
                style={{
                  height: 40,
                  padding: '0 20px',
                  border: 0,
                  borderRadius: 'var(--border-radius-buttons)',
                  background: dialog.kind === 'upload' ? 'var(--accent-default)' : 'var(--error-default)',
                  color: '#fff',
                  font: 'var(--font-body-s-strong)',
                  cursor: busy ? 'default' : 'pointer',
                  opacity: busy ? 0.6 : 1,
                }}
              >
                {dialog.kind === 'upload' ? 'Загрузить' : 'Удалить'}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function RowActionButton({ label, color, onClick }: { label: string; color: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{ height: 28, padding: '0 8px', border: 0, borderRadius: 'var(--border-radius-m)', background: 'transparent', font: 'var(--font-description-l-strong)', color, cursor: 'pointer' }}
    >
      {label}
    </button>
  )
}
