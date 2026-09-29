// Просмотр воркфлоу (Воркфлоу.dc.html, admin=false — без CRUD шагов/переходов, это у
// администратора) плюс пороги застоя для конкретной заявки (InteractionSettings).
import { useEffect, useMemo, useState } from 'react'
import { useToast } from '../../manager/ToastContext'
import { useWorkflows } from '../../api/workflows'
import { useStagesByWorkflow, type StageRead } from '../../api/stages'
import { useAvailableTransitions, useInteractions, useInteraction, type InteractionRead } from '../../api/interactions'
import { useUpdateInteractionSettings } from '../../api/interaction-settings'

const card: React.CSSProperties = {
  background: 'var(--bg-surface1)',
  border: '1px solid var(--border-muted)',
  borderRadius: 'var(--border-radius-l)',
}

const select: React.CSSProperties = {
  height: 36,
  padding: '0 8px',
  border: '1px solid var(--border-soft)',
  borderRadius: 'var(--border-radius-l)',
  background: 'var(--bg-surface1)',
  font: 'var(--font-body-s-strong)',
  color: 'var(--fg-default)',
  outline: 0,
}

// GET /interactions/{id} на самом деле отдаёт stall_overrides (InteractionRead в openapi),
// но локальный тип в interactions.ts его не объявляет - расширяем поверх того же ответа.
type InteractionWithOverrides = InteractionRead & { stall_overrides: Record<string, number> | null }

// GET /transitions/available отдаёт больше полей, чем TransitionEdge в interactions.ts.
interface TransitionFull {
  id: number
  workflow_id: number
  from_stage_id: number | null
  to_stage_id: number
  name: string
  is_active: boolean
  requires_approval: boolean
  is_backward: boolean
  is_irreversible: boolean
  required_document_kinds: string[]
  comments: string | null
}

function stageTags(s: StageRead): string[] {
  const tags: string[] = []
  if (s.is_terminal) tags.push('конечный')
  if (s.is_branch_start) tags.push('начало веток')
  if (s.is_branch_stage) tags.push('шаг ветки')
  if (s.is_side) tags.push('подшаг')
  if (s.archived_at) tags.push('архив')
  if (s.stall_days) tags.push(`застой ${s.stall_days} дн.`)
  return tags
}

function transitionFlags(t: TransitionFull): string[] {
  const flags: string[] = []
  if (t.requires_approval) flags.push('требует согласования')
  if (t.is_backward) flags.push('назад')
  if (t.is_irreversible) flags.push('необратимо')
  if (!t.is_active) flags.push('отключён')
  if (t.required_document_kinds.length) flags.push(`документы: ${t.required_document_kinds.join(', ')}`)
  return flags
}

export default function WorkflowsPage() {
  const toast = useToast()
  const { data: workflows, isLoading: wfLoading } = useWorkflows()
  const [pickedWfId, setWfId] = useState<number | null>(null)
  const [pickedStageId, setStageId] = useState<number | null>(null)
  const wfId = pickedWfId ?? workflows?.[0]?.id ?? null

  const wf = workflows?.find((w) => w.id === wfId) ?? null
  const { data: stages, isLoading: stagesLoading } = useStagesByWorkflow(wfId ?? undefined)
  const sortedStages = useMemo(() => [...(stages ?? [])].sort((a, b) => a.position - b.position), [stages])

  const stageId = sortedStages.some((s) => s.id === pickedStageId) ? pickedStageId : sortedStages[0]?.id ?? null

  const cur = sortedStages.find((s) => s.id === stageId) ?? null
  const { data: transitionsRaw } = useAvailableTransitions(wfId ?? undefined, stageId)
  const out = (transitionsRaw as unknown as TransitionFull[] | undefined) ?? []

  const stageName = (id: number) => sortedStages.find((s) => s.id === id)?.name ?? `#${id}`

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <select
          value={wfId ?? ''}
          onChange={(e) => {
            setWfId(Number(e.target.value))
            setStageId(null)
          }}
          style={select}
        >
          {(workflows ?? []).map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
        {wf && (
          <span
            style={{
              height: 22,
              padding: '0 8px',
              borderRadius: 'var(--border-radius-m)',
              background: wf.is_published ? 'var(--success-container-default)' : 'var(--neutral-container-default)',
              font: 'var(--font-description-l-strong)',
              color: 'var(--fg-default)',
              display: 'flex',
              alignItems: 'center',
            }}
          >
            {wf.is_published ? 'Опубликован' : 'Черновик'}
          </span>
        )}
        {wf && (
          <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)' }}>
            предупреждения о лицензии и договоре за {wf.warn_days.join(', ')} дн.
          </span>
        )}
      </div>

      {wfLoading && <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-muted)' }}>Загрузка…</span>}

      {!wfLoading && wf && (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,4fr) minmax(0,8fr)', gap: 16, alignItems: 'start' }}>
          <section style={{ ...card, padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span style={{ font: 'var(--font-heading-h4)', color: 'var(--fg-default)' }}>Шаги</span>
            {stagesLoading && <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-muted)' }}>Загрузка…</span>}
            {!stagesLoading && sortedStages.length === 0 && (
              <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-muted)' }}>У маршрута нет шагов</span>
            )}
            {sortedStages.map((s) => {
              const active = s.id === cur?.id
              return (
                <button
                  key={s.id}
                  onClick={() => setStageId(s.id)}
                  style={{
                    border: `1.5px solid ${active ? 'var(--accent-default)' : 'var(--border-muted)'}`,
                    background: active ? 'var(--accent-container-muted)' : 'transparent',
                    borderRadius: 'var(--border-radius-m)',
                    padding: '8px 10px',
                    marginLeft: s.is_side ? 16 : 0,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    textAlign: 'left',
                    cursor: 'pointer',
                    opacity: s.archived_at ? 0.5 : 1,
                  }}
                >
                  <span style={{ flex: 1, font: 'var(--font-body-s-strong)', color: 'var(--fg-default)' }}>{s.name}</span>
                  {stageTags(s).map((t) => (
                    <span
                      key={t}
                      style={{
                        height: 18,
                        padding: '0 6px',
                        borderRadius: 'var(--border-radius-s)',
                        background: 'var(--neutral-container-default)',
                        font: 'var(--font-description-l)',
                        color: 'var(--fg-soft)',
                        display: 'flex',
                        alignItems: 'center',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {t}
                    </span>
                  ))}
                </button>
              )
            })}
          </section>

          <section style={{ ...card, padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
            {cur && (
              <>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{ font: 'var(--font-heading-h4)', color: 'var(--fg-default)' }}>{cur.name}</span>
                  <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)' }}>
                    {[
                      cur.description,
                      ...stageTags(cur),
                      cur.stall_days ? `порог застоя по умолчанию: ${cur.stall_days} дн.` : 'застоя на шаге нет',
                      cur.passive_after_days ? `в пассивные через ${cur.passive_after_days} дн.` : '',
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <span style={{ font: 'var(--font-body-s-strong)', color: 'var(--fg-default)' }}>Поля шага</span>
                  {cur.fields.length === 0 && (
                    <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)' }}>У шага нет полей</span>
                  )}
                  {cur.fields.map((f) => (
                    <div
                      key={f.key}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'minmax(140px,1.2fr) 100px minmax(120px,1fr)',
                        gap: 12,
                        padding: '8px 0',
                        borderTop: '1px solid var(--border-muted)',
                      }}
                    >
                      <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-default)' }}>
                        {f.label}
                        {f.required && <span style={{ color: 'var(--error-default)' }}> *</span>}
                      </span>
                      <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-soft)' }}>{f.type}</span>
                      <span />
                    </div>
                  ))}
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <span style={{ font: 'var(--font-body-s-strong)', color: 'var(--fg-default)' }}>Переходы из шага</span>
                  {out.length === 0 && (
                    <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)' }}>Из этого шага нет переходов</span>
                  )}
                  {out.map((t) => (
                    <div
                      key={t.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        flexWrap: 'wrap',
                        padding: '8px 0',
                        borderTop: '1px solid var(--border-muted)',
                        opacity: t.is_active ? 1 : 0.5,
                      }}
                    >
                      <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-default)' }}>→ {stageName(t.to_stage_id)}</span>
                      {transitionFlags(t).map((x) => (
                        <span
                          key={x}
                          style={{
                            height: 20,
                            padding: '0 6px',
                            borderRadius: 'var(--border-radius-s)',
                            background: 'var(--neutral-container-default)',
                            font: 'var(--font-description-l-strong)',
                            color: 'var(--fg-soft)',
                            display: 'flex',
                            alignItems: 'center',
                          }}
                        >
                          {x}
                        </span>
                      ))}
                    </div>
                  ))}
                </div>
              </>
            )}
          </section>
        </div>
      )}

      <StallThresholds toast={toast} />
    </div>
  )
}

function StallThresholds({ toast }: { toast: ReturnType<typeof useToast> }) {
  const { data: page, isLoading: listLoading } = useInteractions({ limit: 100 })
  const items = page?.items ?? []
  const [pickedInterId, setInterId] = useState<number | null>(null)
  const interId = pickedInterId ?? items[0]?.id ?? null

  const { data: inter } = useInteraction(interId ?? undefined) as { data: InteractionWithOverrides | undefined }
  const { data: stages } = useStagesByWorkflow(inter?.workflow_id ?? undefined)
  const stallStages = useMemo(
    () => (stages ?? []).filter((s) => s.stall_days != null && !s.archived_at).sort((a, b) => a.position - b.position),
    [stages],
  )

  const [overrides, setOverrides] = useState<Record<number, string>>({})
  const [warn, setWarn] = useState('')
  const save = useUpdateInteractionSettings()

  // подтянуть текущие пороги заявки при выборе/загрузке
  useEffect(() => {
    if (!inter) return
    const ov = inter.stall_overrides ?? {}
    const next: Record<number, string> = {}
    for (const s of stallStages) {
      const v = ov[String(s.id)]
      next[s.id] = v == null ? '' : String(v)
    }
    setOverrides(next)
    setWarn((inter.warn_days ?? []).join(', '))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inter?.id, inter?.stall_overrides, inter?.warn_days, stallStages.length])

  if (listLoading) return null
  if (items.length === 0) {
    // у руководителя нет своих взаимодействий в команде - нечего настраивать
    return null
  }

  const warnValid = (() => {
    const v = warn.trim()
    if (!v) return true
    const a = v.split(',').map((x) => Number(x.trim()))
    return a.length <= 5 && a.every((n) => Number.isInteger(n) && n >= 1 && n <= 365)
  })()

  const overridesValid = Object.values(overrides).every((v) => v === '' || (Number.isInteger(Number(v)) && Number(v) >= 1))

  const doSave = () => {
    if (!interId) return
    if (!overridesValid || !warnValid) {
      toast({ title: 'Пороги не сохранены', subtitle: 'Проверьте значения', colorScheme: 'error' })
      return
    }
    const stall_overrides: Record<number, number | null> = {}
    for (const s of stallStages) {
      const v = overrides[s.id]
      stall_overrides[s.id] = v === '' || v === undefined ? null : Number(v)
    }
    const warn_days = warn.trim() ? warn.split(',').map((x) => Number(x.trim())) : null
    save.mutate(
      { id: interId, body: { stall_overrides, warn_days } },
      {
        onSuccess: () => toast({ title: 'Пороги сохранены', subtitle: `Заявка #${interId}` }),
        onError: () => toast({ title: 'Не удалось сохранить пороги', colorScheme: 'error' }),
      },
    )
  }

  const doReset = () => {
    if (!interId) return
    const stall_overrides: Record<number, number | null> = {}
    for (const s of stallStages) stall_overrides[s.id] = null
    save.mutate(
      { id: interId, body: { stall_overrides, warn_days: null } },
      {
        onSuccess: () => {
          setOverrides({})
          setWarn('')
          toast({ title: 'Сброшено к маршруту', subtitle: `Заявка #${interId}` })
        },
        onError: () => toast({ title: 'Не удалось сбросить пороги', colorScheme: 'error' }),
      },
    )
  }

  return (
    <section style={{ ...card, padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ font: 'var(--font-heading-h4)', color: 'var(--fg-default)' }}>Пороги застоя для заявки</span>
          <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)', textWrap: 'pretty' as any }}>
            Свои сроки для одной заявки. Пусто — как в маршруте. Отсчёт застоя начинается заново при переходе, возврате,
            снятии паузы и переоткрытии.
          </span>
        </div>
        <select value={interId ?? ''} onChange={(e) => setInterId(Number(e.target.value))} style={select}>
          {items.map((i) => (
            <option key={i.id} value={i.id}>
              #{i.id} · {i.university.name}
            </option>
          ))}
        </select>
      </div>

      {stallStages.length === 0 && (
        <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)' }}>
          У маршрута этой заявки нет шагов с порогом застоя
        </span>
      )}

      {stallStages.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,minmax(0,1fr))', gap: 12 }}>
          {stallStages.map((s) => {
            const v = overrides[s.id] ?? ''
            const bad = v !== '' && !(Number.isInteger(Number(v)) && Number(v) >= 1)
            return (
              <label key={s.id} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)' }}>{s.name}</span>
                <input
                  type="number"
                  value={v}
                  placeholder={`по маршруту: ${s.stall_days}`}
                  onChange={(e) => setOverrides((o) => ({ ...o, [s.id]: e.target.value }))}
                  style={{
                    height: 36,
                    padding: '0 10px',
                    border: `1px solid ${bad ? 'var(--error-default)' : 'var(--border-soft)'}`,
                    borderRadius: 'var(--border-radius-inputs)',
                    background: 'var(--bg-surface1)',
                    font: 'var(--font-body-s)',
                    color: 'var(--fg-default)',
                    outline: 0,
                  }}
                />
              </label>
            )
          })}
        </div>
      )}

      <label style={{ display: 'flex', flexDirection: 'column', gap: 4, maxWidth: 420 }}>
        <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)' }}>
          Предупреждать о конце лицензии и договора за, дней (1–5 значений через запятую)
        </span>
        <input
          value={warn}
          onChange={(e) => setWarn(e.target.value)}
          placeholder="по маршруту"
          style={{
            height: 36,
            padding: '0 10px',
            border: `1px solid ${warnValid ? 'var(--border-soft)' : 'var(--error-default)'}`,
            borderRadius: 'var(--border-radius-inputs)',
            background: 'var(--bg-surface1)',
            font: 'var(--font-body-s)',
            color: 'var(--fg-default)',
            outline: 0,
          }}
        />
      </label>

      <div style={{ display: 'flex', gap: 8 }}>
        <button
          onClick={doSave}
          disabled={save.isPending}
          style={{
            height: 40,
            padding: '0 20px',
            border: 0,
            borderRadius: 'var(--border-radius-buttons)',
            background: 'var(--accent-default)',
            color: '#fff',
            font: 'var(--font-body-s-strong)',
            cursor: 'pointer',
            opacity: save.isPending ? 0.6 : 1,
          }}
        >
          Сохранить пороги
        </button>
        <button
          onClick={doReset}
          disabled={save.isPending}
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
          Сбросить к маршруту
        </button>
      </div>
    </section>
  )
}
