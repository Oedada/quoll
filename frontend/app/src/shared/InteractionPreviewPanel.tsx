import { useState } from 'react'
import { Atomaro } from '../ds/atomaro'
import { useInteraction, type InteractionRead } from '../api/interactions'
import { useBranches, type InteractionDetailExtra } from '../api/interaction-detail'
import { usePeople, personFullName } from '../api/people'
import { usePrograms, useProducts, useVendors } from '../api/catalog-extra'
import { useRequests } from '../api/requests'
import { useDocuments } from '../api/interaction-documents'

// Боковая панель быстрого просмотра со списков взаимодействий (менеджер/руководитель) -
// по клику на строку, как в «Взаимодействия.dc.html» (previewOpen/pv). Общая для ролей,
// т.к. состав данных одинаковый - различаются только списки-источники.

const STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Черновик',
  AWAITING_ACCEPTANCE: 'Ждёт принятия',
  IN_PROGRESS: 'В работе',
  PAUSED: 'На паузе',
  SIGNED: 'Подписано',
  CLOSED: 'Закрыто',
}
const OUTCOME_LABEL: Record<string, string> = { COMPLETED: 'Завершено', REFUSED: 'Отказ', CANCELLED: 'Отменено' }
const CONTRACT_LABEL: Record<string, string> = { PROPOSED: 'Предложен', APPROVED: 'Одобрен', REJECTED: 'Отклонён' }
const CONTRACT_TONE: Record<string, string> = {
  PROPOSED: 'var(--warning-container-default)',
  APPROVED: 'var(--success-container-default)',
  REJECTED: 'var(--error-container-default)',
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('ru-RU')
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, padding: '6px 0' }}>
      <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-muted)', whiteSpace: 'nowrap' }}>{label}</span>
      <span style={{ font: 'var(--font-body-s-strong)', color: 'var(--fg-default)', textAlign: 'right' }}>{value}</span>
    </div>
  )
}

export function InteractionPreviewPanel({ interactionId, onClose, onOpen }: { interactionId: number | null; onClose: () => void; onOpen: (id: number) => void }) {
  const { data: raw } = useInteraction(interactionId ?? undefined)
  const r = raw as (InteractionRead & Partial<InteractionDetailExtra>) | undefined
  const { data: branches } = useBranches(interactionId ?? undefined)
  const { data: people } = usePeople([r?.created_by])
  const { data: programs } = usePrograms()
  const { data: products } = useProducts()
  const { data: vendors } = useVendors()
  const { data: requests } = useRequests(interactionId ?? undefined)
  const { data: documents } = useDocuments(interactionId ?? undefined)
  const [now] = useState(() => Date.now())

  if (interactionId == null) return null

  const createdByName = people?.find((p) => p.id === r?.created_by)
  const pendingRequests = (requests ?? []).filter((q) => q.status === 'PENDING').length
  const pendingDocs = (documents ?? []).filter((d) => d.status === 'PENDING').length

  const notes: { bg: string; title: string; text?: string }[] = []
  if (r?.stall_since) notes.push({ bg: 'var(--error-container-default)', title: `Зависла: ${Math.max(0, Math.floor((now - new Date(r.stall_since).getTime()) / 86400000))} дн.`, text: `Нет движения на этапе «${r.state?.name ?? '—'}»` })
  if (r?.pause_state === 'PAUSED') notes.push({ bg: 'var(--neutral-container-soft)', title: r.paused_until ? `На паузе до ${formatDate(r.paused_until)}` : 'На паузе бессрочно', text: r.pause_comment ?? undefined })

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 20, background: 'rgba(14,17,23,.12)' }} />
      <aside
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          bottom: 0,
          width: 440,
          maxWidth: '100vw',
          zIndex: 21,
          background: 'var(--bg-elevated-xl)',
          boxShadow: 'var(--shadow-bottom-xl)',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div style={{ padding: '20px 16px 16px 24px', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
            <span style={{ font: 'var(--font-heading-h3)', color: 'var(--fg-default)' }}>{r?.university?.full_name ?? `Вуз #${r?.university_id ?? ''}`}</span>
            <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)' }}>Взаимодействие #{interactionId}</span>
          </div>
          <button
            onClick={onClose}
            style={{ width: 32, height: 32, flex: 'none', border: 0, background: 'transparent', borderRadius: 'var(--border-radius-m)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
          >
            {Atomaro.CloseSmall && <Atomaro.CloseSmall size={20} fill="var(--fg-soft)" />}
          </button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '0 24px 16px', display: 'flex', flexDirection: 'column', gap: 24 }}>
          {!r && <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-muted)' }}>Загрузка…</span>}

          {notes.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {notes.map((n, i) => (
                <div key={i} style={{ background: n.bg, borderRadius: 'var(--border-radius-m)', padding: 12, display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{ font: 'var(--font-body-s-strong)', color: 'var(--fg-default)' }}>{n.title}</span>
                  {n.text && <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-soft)' }}>{n.text}</span>}
                </div>
              ))}
            </div>
          )}

          {r && (
            <>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)', paddingBottom: 4 }}>Вуз</span>
                <Row label="Короткое название" value={r.university?.short_name ?? '—'} />
                <Row label="Регион" value={r.university?.region ?? '—'} />
                <Row label="Город" value={r.university?.city ?? '—'} />
                <Row label="ИНН" value={r.university?.inn ?? '—'} />
                <Row label="Сайт" value={r.university?.site ?? '—'} />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)', paddingBottom: 4 }}>Состояние</span>
                <Row label="Статус" value={STATUS_LABEL[r.status] ?? r.status} />
                <Row label="Исход" value={r.outcome ? OUTCOME_LABEL[r.outcome] ?? r.outcome : '—'} />
                <Row label="Слот" value={r.slot === 'ACTIVE' ? 'Активный' : 'Пассивный'} />
                <Row label="Этап" value={r.state?.name ?? '—'} />
                <Row label="Воркфлоу" value={r.workflow?.name ?? '—'} />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)', paddingBottom: 4 }}>Люди и даты</span>
                <Row label="Создал" value={createdByName ? personFullName(createdByName) : '—'} />
                <Row label="Создано" value={formatDate(r.created_at)} />
                <Row label="Подписано" value={formatDate(r.signed_at)} />
                <Row label="Плановая дата" value={formatDate(r.planned_date)} />
                <Row label="Точка невозврата" value={formatDate(r.no_return_at)} />
                <Row label="Просьб в ожидании" value={String(pendingRequests)} />
                <Row label="Документов на согласовании" value={String(pendingDocs)} />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)' }}>Ветки · {branches?.length ?? 0}</span>
                {(branches ?? []).map((b) => {
                  const program = programs?.find((p) => p.id === b.program_id)
                  const product = products?.find((p) => p.id === b.product_id)
                  const vendor = vendors?.find((v) => v.id === product?.vendor_id)
                  return (
                    <div key={b.id} style={{ border: '1px solid var(--border-muted)', borderRadius: 'var(--border-radius-m)', padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
                        <span style={{ display: 'flex', flexDirection: 'column' }}>
                          <span style={{ font: 'var(--font-body-s-strong)', color: 'var(--fg-default)' }}>{program?.name ?? '—'}</span>
                          <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)' }}>
                            {product?.name ?? '—'}
                            {vendor ? ` · ${vendor.name}` : ''}
                          </span>
                        </span>
                        <span style={{ height: 20, padding: '0 6px', borderRadius: 'var(--border-radius-s)', background: CONTRACT_TONE[b.contract_status] ?? CONTRACT_TONE.PROPOSED, font: 'var(--font-description-l-strong)', color: 'var(--fg-default)', display: 'flex', alignItems: 'center' }}>
                          {CONTRACT_LABEL[b.contract_status] ?? b.contract_status}
                        </span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', font: 'var(--font-description-l)', color: 'var(--fg-muted)' }}>
                        <span>Лицензия до</span>
                        <span style={{ color: 'var(--fg-default)' }}>{formatDate(b.license_until)}</span>
                      </div>
                      {b.teachers_trained != null && (
                        <div style={{ display: 'flex', justifyContent: 'space-between', font: 'var(--font-description-l)', color: 'var(--fg-muted)' }}>
                          <span>Обучено преподавателей</span>
                          <span style={{ color: 'var(--fg-default)' }}>{b.teachers_trained}</span>
                        </div>
                      )}
                    </div>
                  )
                })}
                {(branches ?? []).length === 0 && <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-muted)' }}>Веток пока нет</span>}
              </div>
            </>
          )}
        </div>

        <div style={{ borderTop: '1px solid var(--border-muted)', padding: '16px 24px', display: 'flex', gap: 8 }}>
          <button
            onClick={() => onOpen(interactionId)}
            style={{ flex: 1, height: 40, border: 0, borderRadius: 'var(--border-radius-buttons)', background: 'var(--accent-default)', color: '#fff', font: 'var(--font-body-s-strong)', cursor: 'pointer' }}
          >
            Открыть карточку
          </button>
        </div>
      </aside>
    </>
  )
}
