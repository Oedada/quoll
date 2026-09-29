import { useState } from 'react'
import { useMe } from '../../auth/useMe'
import { useToast } from '../ToastContext'
import { Atomaro } from '../../ds/atomaro'
import {
  useInteractions,
  useAvailableTransitions,
  useAcceptInteraction,
  useDeclineInteraction,
  type InteractionListRead,
} from '../../api/interactions'

const COLS = 'minmax(96px,.8fr) minmax(220px,1.6fr) minmax(140px,1fr) minmax(90px,.7fr) minmax(90px,.7fr) 224px'

type Dialog = { kind: 'accept' | 'reject'; row: InteractionListRead }

export default function InboxPage() {
  const { data: me } = useMe()
  const toast = useToast()
  const { data, isLoading } = useInteractions({
    responsible_id: me?.id,
    status: ['AWAITING_ACCEPTANCE'],
  })
  const [dialog, setDialog] = useState<Dialog | null>(null)

  const rows = data?.items ?? []

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0, position: 'relative' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
        <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-soft)' }}>
          Входящих: <b style={{ fontWeight: 600, color: 'var(--fg-default)', fontVariantNumeric: 'tabular-nums' }}>{data?.total ?? 0}</b>
        </span>
      </div>

      <section
        style={{
          background: 'var(--bg-surface1)',
          border: '1px solid var(--border-muted)',
          borderRadius: 'var(--border-radius-l)',
          padding: '8px 16px 16px',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: COLS,
            gap: 16,
            padding: '12px 8px 8px',
            font: 'var(--font-description-l)',
            color: 'var(--fg-muted)',
          }}
        >
          <span>Вуз</span>
          <span>Ветки</span>
          <span>Создал и назначил</span>
          <span>План</span>
          <span>Назначено</span>
          <span></span>
        </div>

        {isLoading && (
          <>
            {[1, 2, 3].map((k) => (
              <div
                key={k}
                style={{
                  display: 'grid',
                  gridTemplateColumns: COLS,
                  gap: 16,
                  padding: '16px 8px',
                  borderTop: '1px solid var(--border-muted)',
                }}
              >
                <div style={{ height: 14, width: '70%', borderRadius: 4, background: 'var(--neutral-container-default)' }} />
                <div style={{ height: 14, width: '80%', borderRadius: 4, background: 'var(--neutral-container-soft)' }} />
                <div style={{ height: 14, width: '60%', borderRadius: 4, background: 'var(--neutral-container-soft)' }} />
                <div style={{ height: 14, width: '50%', borderRadius: 4, background: 'var(--neutral-container-soft)' }} />
                <div style={{ height: 14, width: '60%', borderRadius: 4, background: 'var(--neutral-container-soft)' }} />
                <div />
              </div>
            ))}
          </>
        )}

        {!isLoading &&
          rows.map((r) => (
            <InboxRow key={r.id} row={r} onAccept={() => setDialog({ kind: 'accept', row: r })} onReject={() => setDialog({ kind: 'reject', row: r })} />
          ))}

        {!isLoading && rows.length === 0 && (
          <div
            style={{
              borderTop: '1px solid var(--border-muted)',
              padding: '56px 16px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 8,
              textAlign: 'center',
            }}
          >
            {Atomaro.MailInbox && <Atomaro.MailInbox size={32} fill="var(--neutral-muted)" />}
            <span style={{ font: 'var(--font-body-s-strong)', color: 'var(--fg-soft)' }}>Входящих нет</span>
            <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)' }}>
              Новые назначения от руководителя появятся здесь
            </span>
          </div>
        )}
      </section>

      {dialog && <DecisionDialog dialog={dialog} onClose={() => setDialog(null)} onToast={toast} />}
    </div>
  )
}

function InboxRow({
  row,
  onAccept,
  onReject,
}: {
  row: InteractionListRead
  onAccept: () => void
  onReject: () => void
}) {
  const branches = row.branches.slice(0, 2)
  const more = row.branches.length > 2 ? row.branches.length - 2 : 0
  const planned = row.planned_date ? formatDate(row.planned_date) : '—'
  const assignedAt = formatDate(row.updated_at)

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: COLS,
        gap: 16,
        padding: '12px 8px',
        borderTop: '1px solid var(--border-muted)',
        alignItems: 'start',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
        <span style={{ font: 'var(--font-body-s-strong)', color: 'var(--fg-default)' }}>{row.university.name}</span>
        <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)' }}>#{row.id}</span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
        {branches.map((b) => (
          <div key={b.id} style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
            <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-default)', textWrap: 'pretty' as any }}>
              {b.program?.name ?? '—'}
              <span style={{ color: 'var(--fg-muted)' }}> · {b.product?.name ?? '—'}{b.vendor_name ? ` (${b.vendor_name})` : ''}</span>
            </span>
          </div>
        ))}
        {more > 0 && <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)' }}>ещё {more}</span>}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, font: 'var(--font-body-s)', color: 'var(--fg-default)' }}>
        {/* в дизайне тут "Создал"/"Назначил" по именам; API отдаёт created_by как id без имени
            и не отдаёт списком, кто назначил — показываем то, что реально есть */}
        <span>Ответственный: {row.responsible?.name ?? '—'}</span>
      </div>

      <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-default)', fontVariantNumeric: 'tabular-nums' }}>{planned}</span>
      <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-soft)', fontVariantNumeric: 'tabular-nums' }}>{assignedAt}</span>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, flexWrap: 'nowrap' }}>
        <button
          onClick={onAccept}
          style={{
            height: 32,
            padding: '0 12px',
            border: '1px solid var(--accent-default)',
            borderRadius: 'var(--border-radius-buttons)',
            background: 'var(--accent-default)',
            color: '#fff',
            font: 'var(--font-body-s-strong)',
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          Принять
        </button>
        <button
          onClick={onReject}
          style={{
            height: 32,
            padding: '0 12px',
            border: '1px solid var(--border-soft)',
            borderRadius: 'var(--border-radius-buttons)',
            background: 'var(--bg-surface1)',
            color: 'var(--fg-default)',
            font: 'var(--font-body-s-strong)',
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          Отклонить
        </button>
      </div>
    </div>
  )
}

function DecisionDialog({
  dialog,
  onClose,
  onToast,
}: {
  dialog: Dialog
  onClose: () => void
  onToast: ReturnType<typeof useToast>
}) {
  const { row, kind } = dialog
  const [comment, setComment] = useState('')
  const [tried, setTried] = useState(false)
  const [toStageId, setToStageId] = useState<number | null>(null)

  const { data: transitions, isLoading: loadingTransitions } = useAvailableTransitions(
    kind === 'accept' ? row.workflow_id ?? undefined : undefined,
    null,
  )
  const accept = useAcceptInteraction()
  const decline = useDeclineInteraction()

  const commentError = kind === 'reject' && tried && !comment.trim()
  const busy = accept.isPending || decline.isPending

  const chosenStage = toStageId ?? transitions?.[0]?.to_stage_id ?? null

  const confirm = () => {
    if (kind === 'reject') {
      if (!comment.trim()) {
        setTried(true)
        return
      }
      decline.mutate(
        { id: row.id, body: { comment: comment.trim() } },
        {
          onSuccess: () => {
            onToast({ title: 'Заявка возвращена автору', subtitle: `#${row.id}`, colorScheme: 'info' })
            onClose()
          },
          onError: (e: any) => onToast({ title: 'Не удалось отклонить', subtitle: e?.message, colorScheme: 'error' }),
        },
      )
    } else {
      if (!chosenStage) return
      accept.mutate(
        { id: row.id, body: { to_stage_id: chosenStage, comment: comment.trim() || undefined } },
        {
          onSuccess: () => {
            onToast({ title: 'Заявка принята в работу', subtitle: `#${row.id}`, colorScheme: 'success' })
            onClose()
          },
          onError: (e: any) => onToast({ title: 'Не удалось принять', subtitle: e?.message, colorScheme: 'error' }),
        },
      )
    }
  }

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 30, background: 'rgba(14,17,23,.4)' }} />
      <div
        style={{
          position: 'fixed',
          zIndex: 31,
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
          gap: 20,
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ font: 'var(--font-heading-h3)', color: 'var(--fg-default)' }}>
            {kind === 'accept' ? 'Принять в работу' : 'Отклонить заявку'}
          </span>
          <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-soft)', textWrap: 'pretty' as any }}>
            {kind === 'accept'
              ? 'Выберите этап, с которого начнётся работа.'
              : 'Заявка вернётся автору вместе с вашей причиной.'}
          </span>
        </div>

        {kind === 'accept' && (
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ font: 'var(--font-description-l-strong)', color: 'var(--fg-soft)' }}>Стартовый этап</span>
            <select
              value={chosenStage ?? ''}
              onChange={(e) => setToStageId(Number(e.target.value))}
              disabled={loadingTransitions}
              style={{
                height: 40,
                padding: '0 12px',
                border: '1px solid var(--border-soft)',
                borderRadius: 'var(--border-radius-inputs)',
                background: 'var(--bg-surface1)',
                font: 'var(--font-body-s)',
                color: 'var(--fg-default)',
                outline: 0,
              }}
            >
              {(transitions ?? []).map((t) => (
                <option key={t.id} value={t.to_stage_id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
        )}

        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ font: 'var(--font-description-l-strong)', color: 'var(--fg-soft)' }}>
            {kind === 'accept' ? 'Комментарий (необязательно)' : 'Причина *'}
          </span>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={3}
            placeholder={kind === 'accept' ? 'Например, договорились о встрече' : 'Почему вы отказываетесь'}
            style={{
              resize: 'vertical',
              padding: 12,
              border: `1px solid ${commentError ? 'var(--error-default)' : 'var(--border-soft)'}`,
              borderRadius: 'var(--border-radius-inputs)',
              background: 'var(--bg-surface1)',
              font: 'var(--font-body-s)',
              color: 'var(--fg-default)',
              outline: 0,
            }}
          />
          {commentError && <span style={{ font: 'var(--font-description-l)', color: 'var(--error-default)' }}>Укажите причину</span>}
        </label>

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
            onClick={confirm}
            disabled={busy || (kind === 'accept' && !chosenStage)}
            style={{
              height: 40,
              padding: '0 20px',
              border: 0,
              borderRadius: 'var(--border-radius-buttons)',
              background: 'var(--accent-default)',
              color: '#fff',
              font: 'var(--font-body-s-strong)',
              cursor: busy ? 'default' : 'pointer',
              opacity: busy ? 0.6 : 1,
            }}
          >
            Подтвердить
          </button>
        </div>
      </div>
    </>
  )
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('ru-RU')
}
