import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Atomaro } from '../../ds/atomaro'
import { useInteraction, useInteractionHistory, type InteractionRead } from '../../api/interactions'
import { useBranches, useComments, type InteractionDetailExtra } from '../../api/interaction-detail'
import { useStagesByWorkflow, type StageRead } from '../../api/stages'
import { usePrograms, useProducts, useVendors, useCloseReasons } from '../../api/catalog-extra'
import { usePeople, personFullName } from '../../api/people'
import { useSidePointers, useStageValuesList, useDocuments, type DocumentRead } from '../../api/interaction-documents'

// Карточка взаимодействия для админа - только просмотр (роль admin в
// access_policy.py может can_read, но не can_change): без принятия, переходов,
// назначения, паузы, смены статуса договора и закрытия веток - только данные,
// путь, ветки, история и комментарии для чтения

const STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Черновик',
  AWAITING_ACCEPTANCE: 'Ждёт принятия',
  IN_PROGRESS: 'В работе',
  PAUSED: 'На паузе',
  SIGNED: 'Подписано',
  CLOSED: 'Закрыто',
}
const STATUS_TONE: Record<string, [string, string]> = {
  DRAFT: ['var(--neutral-container-default)', 'var(--neutral-muted)'],
  AWAITING_ACCEPTANCE: ['var(--warning-container-default)', 'var(--warning-default)'],
  IN_PROGRESS: ['var(--info-container-default)', 'var(--info-default)'],
  PAUSED: ['var(--neutral-container-default)', 'var(--neutral-muted)'],
  SIGNED: ['var(--success-container-default)', 'var(--success-default)'],
  CLOSED: ['var(--neutral-container-default)', 'var(--neutral-muted)'],
}
const OUTCOME_LABEL: Record<string, string> = { COMPLETED: 'Завершено', REFUSED: 'Отказ', CANCELLED: 'Отменено' }
const OUTCOME_TONE: Record<string, [string, string]> = {
  COMPLETED: ['var(--success-container-default)', 'var(--success-default)'],
  REFUSED: ['var(--error-container-default)', 'var(--error-default)'],
  CANCELLED: ['var(--neutral-container-default)', 'var(--neutral-muted)'],
}
const CONTRACT_LABEL: Record<string, string> = { PROPOSED: 'Предложен', APPROVED: 'Одобрен', REJECTED: 'Отклонён' }
const CONTRACT_TONE: Record<string, [string, string]> = {
  PROPOSED: ['var(--warning-container-default)', 'var(--warning-default)'],
  APPROVED: ['var(--success-container-default)', 'var(--success-default)'],
  REJECTED: ['var(--error-container-default)', 'var(--error-default)'],
}

function Badge({ tone, label }: { tone: [string, string]; label: string }) {
  return (
    <span
      style={{
        height: 24,
        padding: '0 10px',
        borderRadius: 'var(--border-radius-m)',
        background: tone[0],
        font: 'var(--font-description-l-strong)',
        color: 'var(--fg-default)',
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        whiteSpace: 'nowrap',
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: tone[1] }} />
      {label}
    </span>
  )
}

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return `${d.toLocaleDateString('ru-RU')} ${d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`
}
function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('ru-RU')
}

export default function InteractionCardAdminPage() {
  const { id: idParam } = useParams<{ id: string }>()
  const id = Number(idParam)
  const navigate = useNavigate()

  const { data: raw, isLoading, error } = useInteraction(id)
  // GET /interactions/{id} реально отдаёт InteractionDetailRead (шире типа
  // InteractionRead из interactions.ts) - университет и текущий шаг приезжают
  // в том же ответе, как и в карточках менеджера/руководителя
  const r = raw as (InteractionRead & Partial<InteractionDetailExtra>) | undefined

  const { data: branches } = useBranches(id)
  const { data: stages } = useStagesByWorkflow(r?.workflow_id)
  const { data: history } = useInteractionHistory(id)
  const { data: programs } = usePrograms()
  const { data: products } = useProducts()
  const { data: vendors } = useVendors()
  const { data: people } = usePeople([r?.owner_id, r?.created_by])
  const { data: sidePointers } = useSidePointers(id)
  const { data: stageValuesList } = useStageValuesList(id)
  const { data: closeReasons } = useCloseReasons()
  const { data: documents } = useDocuments(id)

  const [ctx, setCtx] = useState<string>('main')
  const [stageSel, setStageSel] = useState<number | null>(null)
  const [sec, setSec] = useState<string>('stage')
  const [infoOpen, setInfoOpen] = useState(false)

  const ownerName = useMemo(() => {
    const p = people?.find((x) => x.id === r?.owner_id)
    return p ? personFullName(p) : null
  }, [people, r?.owner_id])
  const createdByName = useMemo(() => {
    const p = people?.find((x) => x.id === r?.created_by)
    return p ? personFullName(p) : null
  }, [people, r?.created_by])

  if (error) {
    return (
      <div
        style={{
          background: 'var(--bg-surface1)',
          border: '1px solid var(--border-muted)',
          borderRadius: 'var(--border-radius-l)',
          padding: 32,
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          alignItems: 'flex-start',
        }}
      >
        <span style={{ font: 'var(--font-heading-h4)', color: 'var(--fg-default)' }}>Взаимодействие не найдено</span>
        <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-soft)' }}>{error.message}</span>
        <button
          onClick={() => navigate('/admin/all')}
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
          Ко всем взаимодействиям
        </button>
      </div>
    )
  }

  if (isLoading || !r) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div
          style={{
            background: 'var(--bg-surface1)',
            border: '1px solid var(--border-muted)',
            borderRadius: 'var(--border-radius-l)',
            padding: 24,
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
          }}
        >
          <div style={{ height: 24, width: '45%', borderRadius: 4, background: 'var(--neutral-container-default)' }} />
          <div style={{ height: 12, width: '70%', borderRadius: 4, background: 'var(--neutral-container-soft)' }} />
          <div style={{ height: 48, borderRadius: 8, background: 'var(--neutral-container-soft)' }} />
        </div>
        <div style={{ height: 320, borderRadius: 'var(--border-radius-l)', background: 'var(--bg-surface1)', border: '1px solid var(--border-muted)' }} />
      </div>
    )
  }

  const university = r.university
  const statusTone = STATUS_TONE[r.status] ?? STATUS_TONE.IN_PROGRESS
  const outcomeTone = r.outcome ? OUTCOME_TONE[r.outcome] ?? OUTCOME_TONE.CANCELLED : null

  const programName = (pid: number | null) => programs?.find((p) => p.id === pid)?.name ?? '—'
  const productOf = (pid: number | null) => products?.find((p) => p.id === pid) ?? null
  const vendorName = (vendorId: number | undefined) => vendors?.find((v) => v.id === vendorId)?.name ?? null

  // «Гусеница»: основные шаги + побочный указатель (4.1) + шаги веток — одним путём,
  // как в «Карточка взаимодействия.dc.html» (flow/path в renderVals()).
  const mainStages = (stages ?? []).filter((s) => !s.is_branch_stage && !s.is_side).sort((a, b) => a.position - b.position)
  const branchStages = (stages ?? []).filter((s) => s.is_branch_stage).sort((a, b) => a.position - b.position)
  const sideStages = (stages ?? []).filter((s) => s.is_side).sort((a, b) => a.position - b.position)
  const mainNonTerminal = mainStages.filter((s) => !s.is_terminal)
  const mainTerminal = mainStages.filter((s) => s.is_terminal)
  const branchNonTerminal = branchStages.filter((s) => !s.is_terminal)
  const openSide = sidePointers?.find((p) => p.status === 'ACTIVE') ?? null
  const statedBranches = (branches ?? []).filter((b) => b.state_id != null)
  const isSplit = !!r.no_return_at && statedBranches.length > 1
  const singleBranch = r.no_return_at && !isSplit ? statedBranches[0] ?? null : null
  const singleBranchIdx = singleBranch ? branchNonTerminal.findIndex((s) => s.id === singleBranch.state_id) : -1
  const doneClosed = r.status === 'CLOSED'
  const preSign = !r.no_return_at && ['DRAFT', 'AWAITING_ACCEPTANCE', 'IN_PROGRESS', 'PAUSED'].includes(r.status)
  const pendingForStage = (stageId: number) =>
    !!stageValuesList?.find((v) => v.stage_id === stageId && v.branch_id == null && v.side_pointer_id == null)?.pending_values

  type PathNode = { id: number; name: string; kind: 'main' | 'side' | 'branch' | 'group'; passed: boolean; current: boolean; pending?: boolean; note?: string; dashed?: boolean }
  const curMainIdx = mainNonTerminal.findIndex((s) => s.id === r.state_id)
  const pathNodes: PathNode[] = [
    ...mainNonTerminal.map((s, i) => ({
      id: s.id,
      name: s.name,
      kind: 'main' as const,
      passed: r.no_return_at ? true : curMainIdx >= 0 && i < curMainIdx,
      current: !r.no_return_at && !doneClosed && s.id === r.state_id,
      pending: pendingForStage(s.id),
    })),
    ...sideStages.map((s) => ({ id: s.id, name: s.name, kind: 'side' as const, passed: false, current: !!openSide, dashed: true })),
    ...(isSplit
      ? [{ id: -1, name: 'Шаги 5–8', kind: 'group' as const, passed: false, current: false, note: `${statedBranches.length} ветки — ниже`, dashed: true }]
      : branchNonTerminal.map((s, i) => ({
          id: s.id,
          name: s.name,
          kind: 'branch' as const,
          passed: !!singleBranch && (i < singleBranchIdx || (!!singleBranch.closed_at && i <= singleBranchIdx)),
          current: !!singleBranch && !singleBranch.closed_at && i === singleBranchIdx,
          dashed: true,
        }))),
    ...mainTerminal.map((s) => ({
      id: s.id,
      name: s.name,
      kind: 'main' as const,
      passed: false,
      current: doneClosed && r.outcome !== 'CANCELLED' && (s.name === 'Отказ') === (r.outcome === 'REFUSED'),
    })),
  ]

  // Выбранный контекст (клик по гусенице/веткам/побочному указателю) — какой шаг сейчас
  // показываем во вкладках «Данные»/«Документы». main|branch:<id>|side:<id>.
  const selBranch = ctx.startsWith('branch:') ? (branches ?? []).find((b) => `branch:${b.id}` === ctx) ?? null : null
  const selSide = ctx.startsWith('side:') ? (sidePointers ?? []).find((p) => `side:${p.id}` === ctx) ?? null : null
  const ctxCurStageId = selBranch ? selBranch.state_id : selSide ? selSide.stage_id : r.state_id
  const selStageId = stageSel ?? ctxCurStageId ?? null
  const selStage = stages?.find((s) => s.id === selStageId)
  const selBranchId = selBranch?.id ?? null
  const selSideId = selSide?.id ?? null
  const selStageValues = stageValuesList?.find((v) => v.stage_id === selStageId && v.branch_id == selBranchId && v.side_pointer_id == selSideId)
  const selDocs = (documents ?? []).filter((d) => d.stage_id === selStageId && d.branch_id == selBranchId && d.side_pointer_id == selSideId)
  const pickMain = (stageId: number) => () => {
    setCtx('main')
    setStageSel(stageId)
    setSec('data')
  }
  const pickBranch = (branchId: number, stageId: number | null) => () => {
    setCtx(`branch:${branchId}`)
    setStageSel(stageId)
    setSec('branch')
  }
  const pickSide = (sideId: number, stageId: number | null) => () => {
    setCtx(`side:${sideId}`)
    setStageSel(stageId)
    setSec('data')
  }

  // Какие вкладки в плавающей панели — зависит от выбранного контекста, как у менеджера/руководителя.
  const secDefs: [string, string, number][] = [
    ...(ctx.startsWith('branch:') ? ([['branch', 'Ветка', 0]] as [string, string, number][]) : []),
    ['data', 'Данные', 0],
    ['documents', 'Документы', selDocs.length],
    ['stage', 'Комментарии', 0],
    ['history', 'История', 0],
  ]
  const effectiveSec = secDefs.some((d) => d[0] === sec) ? sec : secDefs[0][0]

  const closeReasonLabel = closeReasons?.find((cr) => cr.id === r.close_reason_id)?.label ?? null
  const infoBanners: { bg: string; title: string; text?: string }[] = []
  if (r.status === 'AWAITING_ACCEPTANCE') infoBanners.push({ bg: 'var(--warning-container-default)', title: 'Ожидает принятия', text: 'Менеджер ещё не принял заявку' })
  if (r.status === 'DRAFT') infoBanners.push({ bg: 'var(--neutral-container-soft)', title: 'Черновик', text: 'Заявка ещё не назначена' })
  if (r.stall_since && r.status !== 'PAUSED')
    infoBanners.push({ bg: 'var(--error-container-default)', title: `Зависает с ${formatDate(r.stall_since)}`, text: `нет движения на шаге «${stages?.find((s) => s.id === r.state_id)?.name ?? '—'}»` })
  if (r.pause_state === 'PAUSED')
    infoBanners.push({ bg: 'var(--neutral-container-soft)', title: r.paused_until ? `На паузе до ${formatDate(r.paused_until)}` : 'На паузе бессрочно', text: r.pause_comment ?? undefined })
  if (r.no_return_at) infoBanners.push({ bg: 'var(--neutral-container-soft)', title: `Точка невозврата ${formatDate(r.no_return_at)}`, text: 'К шагам 1–4 не вернуться: состав договора меняется только допсоглашением' })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
      {/* Шапка */}
      <section
        style={{
          background: 'var(--bg-surface1)',
          border: '1px solid var(--border-muted)',
          borderRadius: 'var(--border-radius-l)',
          padding: '12px 16px',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
          <button
            onClick={() => navigate('/admin/all')}
            title="Ко всем взаимодействиям"
            style={{
              width: 32,
              height: 32,
              flex: 'none',
              border: 0,
              borderRadius: 'var(--border-radius-m)',
              background: 'var(--neutral-container-soft)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
            }}
          >
            {Atomaro.ChevronLeft16 && <Atomaro.ChevronLeft16 size={16} fill="var(--fg-soft)" />}
          </button>
          <div style={{ minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column', position: 'relative' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)' }}>
                Взаимодействие #{r.id}
                {university?.city ? ` · ${university.city}` : ''}
              </span>
              <button
                onClick={() => setInfoOpen((v) => !v)}
                style={{ height: 22, padding: '0 8px', border: 0, borderRadius: 'var(--border-radius-m)', background: 'var(--neutral-container-soft)', color: 'var(--fg-soft)', font: 'var(--font-description-l-strong)', cursor: 'pointer' }}
              >
                Сведения {infoOpen ? '▴' : '▾'}
              </button>
            </div>
            <h1
              title={university?.full_name}
              style={{ margin: 0, font: 'var(--font-heading-h4)', color: 'var(--fg-default)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
            >
              {university?.full_name ?? `Вуз #${r.university_id}`}
            </h1>
            {infoOpen && (
              <>
                <div onClick={() => setInfoOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 19 }} />
                <div
                  style={{
                    position: 'absolute',
                    zIndex: 20,
                    top: 'calc(100% + 6px)',
                    left: 0,
                    width: 760,
                    maxWidth: 'calc(100vw - 340px)',
                    background: 'var(--bg-elevated-xl)',
                    border: '1px solid var(--border-muted)',
                    borderRadius: 'var(--border-radius-l)',
                    boxShadow: 'var(--shadow-bottom-xl)',
                    padding: 20,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 16,
                  }}
                >
                  <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-soft)' }}>
                    {university?.full_name} · {university?.region} · ИНН {university?.inn}
                    {university?.site && (
                      <>
                        {' · '}
                        <a href={university.site.startsWith('http') ? university.site : `https://${university.site}`} target="_blank" rel="noreferrer">
                          {university.site}
                        </a>
                      </>
                    )}
                  </span>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,minmax(0,1fr))', gap: 20 }}>
                    {[
                      { label: 'Ответственный', value: ownerName ?? 'Не назначен' },
                      { label: 'Создал', value: createdByName ?? '—' },
                      { label: 'Создано', value: formatDateTime(r.created_at) },
                      { label: 'Плановая дата', value: formatDate(r.planned_date) },
                      { label: 'Подписано', value: formatDate(r.signed_at) },
                      { label: 'Закрыто', value: formatDate(r.closed_at) },
                      { label: 'Причина закрытия', value: closeReasonLabel ?? '—' },
                      { label: 'Маршрут', value: r.workflow?.name ?? '—' },
                    ].map((f) => (
                      <div key={f.label} style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                        <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)' }}>{f.label}</span>
                        <span style={{ font: 'var(--font-body-s-strong)', color: 'var(--fg-default)' }}>{f.value}</span>
                      </div>
                    ))}
                  </div>
                  {infoBanners.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {infoBanners.map((b, i) => (
                        <div key={i} style={{ background: b.bg, borderRadius: 'var(--border-radius-m)', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
                          <span style={{ font: 'var(--font-body-s-strong)', color: 'var(--fg-default)' }}>{b.title}</span>
                          {b.text && <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-soft)' }}>{b.text}</span>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
          <div style={{ display: 'flex', gap: 6, flex: 'none', alignItems: 'center' }}>
            <Badge tone={statusTone} label={STATUS_LABEL[r.status] ?? r.status} />
            {r.outcome && outcomeTone && <Badge tone={outcomeTone} label={OUTCOME_LABEL[r.outcome] ?? r.outcome} />}
            <span
              style={{
                height: 24,
                padding: '0 10px',
                borderRadius: 'var(--border-radius-m)',
                background: r.slot === 'ACTIVE' ? 'var(--info-container-default)' : 'var(--neutral-container-default)',
                font: 'var(--font-description-l-strong)',
                color: 'var(--fg-soft)',
                display: 'flex',
                alignItems: 'center',
                whiteSpace: 'nowrap',
              }}
            >
              {r.slot === 'ACTIVE' ? 'Активный' : 'Пассивный'}
            </span>
            <span
              style={{
                height: 24,
                padding: '0 10px',
                borderRadius: 'var(--border-radius-m)',
                background: 'var(--neutral-container-soft)',
                font: 'var(--font-description-l-strong)',
                color: 'var(--fg-muted)',
                display: 'flex',
                alignItems: 'center',
                whiteSpace: 'nowrap',
              }}
            >
              Только чтение
            </span>
          </div>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, font: 'var(--font-body-s)', color: 'var(--fg-soft)' }}>
          <span>
            Ответственный: <span style={{ color: 'var(--fg-default)' }}>{ownerName ?? '—'}</span>
          </span>
          <span>
            План: <span style={{ color: 'var(--fg-default)' }}>{formatDate(r.planned_date)}</span>
          </span>
          {r.pause_state === 'PAUSED' && (
            <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--fg-soft)' }}>
              {Atomaro.TimeStroke16 && <Atomaro.TimeStroke16 size={14} fill="var(--fg-soft)" />}
              На паузе{r.paused_until ? ` до ${formatDate(r.paused_until)}` : ''}
              {r.pause_comment ? ` · «${r.pause_comment}»` : ''}
            </span>
          )}
        </div>
      </section>

      {/* Путь (этапы workflow) — гусеница по «Карточка взаимодействия.dc.html»: основная
          цепочка + побочный указатель (4.1) + шаги веток */}
      {stages && stages.length > 0 && (
        <section
          style={{
            background: 'var(--bg-surface1)',
            border: '1px solid var(--border-muted)',
            borderRadius: 'var(--border-radius-l)',
            padding: '8px 12px',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          <div style={{ border: '1.5px solid var(--accent-default)', background: 'var(--bg-surface1)', borderRadius: 'var(--border-radius-m)', padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ font: 'var(--font-description-l-strong)', color: 'var(--fg-soft)' }}>Основной путь</span>
            <div style={{ display: 'flex', alignItems: 'stretch', overflowX: 'auto', scrollbarWidth: 'none', padding: '4px 0' }}>
              {pathNodes.map((n, i) => {
                const clickable = n.kind === 'group' ? false : n.kind === 'side' ? !!openSide : n.kind === 'branch' ? !!singleBranch : true
                const onPick = !clickable
                  ? undefined
                  : n.kind === 'main'
                    ? pickMain(n.id)
                    : n.kind === 'side'
                      ? pickSide(openSide!.id, n.id)
                      : pickBranch(singleBranch!.id, n.id)
                const picked = (n.kind === 'main' && ctx === 'main' && selStageId === n.id) || (n.kind === 'branch' && selBranch?.id === singleBranch?.id && selStageId === n.id) || (n.kind === 'side' && selSide?.id === openSide?.id && selStageId === n.id)
                return (
                <div key={`${n.kind}-${n.id}`} style={{ display: 'flex', alignItems: 'stretch', flex: 'none' }}>
                  {i > 0 && <div style={{ width: 14, height: 2, marginTop: 17, flex: 'none', background: n.passed || n.current ? 'var(--fg-default)' : 'var(--border-soft)' }} />}
                  <button
                    onClick={onPick}
                    disabled={!clickable}
                    style={{
                      border: 0,
                      background: picked ? 'var(--neutral-container-soft)' : 'transparent',
                      borderRadius: 8,
                      padding: '6px 4px',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: 8,
                      width: 92,
                      cursor: clickable ? 'pointer' : 'default',
                    }}
                  >
                    <span
                      style={{
                        position: 'relative',
                        width: 24,
                        height: 24,
                        borderRadius: n.kind === 'group' ? 6 : '50%',
                        border: `2px ${n.dashed ? 'dashed' : 'solid'} ${n.current ? 'var(--accent-default)' : n.passed ? 'var(--fg-default)' : 'var(--neutral-muted)'}`,
                        background: n.current ? 'var(--accent-default)' : n.passed ? 'var(--fg-default)' : 'transparent',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      {n.passed && Atomaro.CheckSmall16 && <Atomaro.CheckSmall16 size={14} fill="#fff" />}
                      {n.pending && (
                        <span
                          title="Есть правка на согласовании"
                          style={{ position: 'absolute', top: -4, right: -4, width: 10, height: 10, borderRadius: '50%', background: 'var(--warning-default)', border: '2px solid var(--bg-surface1)' }}
                        />
                      )}
                    </span>
                    <span style={{ font: 'var(--font-description-l-strong)', color: n.current ? 'var(--fg-default)' : 'var(--fg-soft)', textAlign: 'center' }}>{n.name}</span>
                    {n.note && <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)', marginTop: -6 }}>{n.note}</span>}
                  </button>
                </div>
                )
              })}
            </div>
          </div>

          {(branches?.length || openSide) && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 8, borderRadius: 'var(--border-radius-m)', background: 'var(--bg-surface2)' }}>
              <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)' }}>
                {preSign ? 'Состав договора (черновик): ветки разойдутся по своим шагам после подписания' : isSplit ? 'Ветки идут по своим шагам независимо' : 'Ветка договора'}
              </span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 178, overflowY: 'auto' }}>
                {(branches ?? []).map((b) => {
                  const product = productOf(b.product_id)
                  const closed = !!b.closed_at
                  const branchIdx = branchNonTerminal.findIndex((s) => s.id === b.state_id)
                  const isSelBranch = ctx === `branch:${b.id}`
                  return (
                    <div
                      key={b.id}
                      style={{
                        height: 40,
                        flex: 'none',
                        border: `1.5px solid ${isSelBranch ? 'var(--accent-default)' : 'var(--border-muted)'}`,
                        background: isSelBranch ? 'var(--bg-surface1)' : 'transparent',
                        borderRadius: 'var(--border-radius-m)',
                        display: 'flex',
                        alignItems: 'center',
                      }}
                    >
                      <div
                        onClick={pickBranch(b.id, b.state_id)}
                        style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 12, padding: '0 12px', height: '100%', cursor: 'pointer' }}
                      >
                        <span style={{ width: 220, flex: 'none', display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                          <span style={{ font: 'var(--font-body-s-strong)', color: 'var(--fg-default)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {programName(b.program_id)}
                            {closed ? ' · закрыта' : ''}
                          </span>
                          <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)' }}>{product?.name ?? '—'}</span>
                        </span>
                        <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 6, overflow: 'hidden' }}>
                          {isSplit && b.state_id
                            ? branchNonTerminal.map((s, i) => {
                                const cur = i === branchIdx && !closed
                                const passed = branchIdx > i
                                const chipSel = isSelBranch && selStageId === s.id
                                return (
                                  <span key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        pickBranch(b.id, s.id)()
                                      }}
                                      style={{
                                        height: 26,
                                        padding: '0 10px',
                                        borderRadius: 'var(--border-radius-m)',
                                        border: `1px solid ${chipSel ? 'var(--fg-default)' : cur ? 'var(--accent-default)' : 'transparent'}`,
                                        background: cur ? 'var(--accent-container-default)' : passed ? 'var(--neutral-container-default)' : 'var(--neutral-container-soft)',
                                        font: 'var(--font-description-l-strong)',
                                        color: cur || passed ? 'var(--fg-default)' : 'var(--fg-muted)',
                                        display: 'flex',
                                        alignItems: 'center',
                                        whiteSpace: 'nowrap',
                                        cursor: 'pointer',
                                      }}
                                    >
                                      {s.name}
                                    </button>
                                    {i < branchNonTerminal.length - 1 && <span style={{ color: 'var(--fg-muted)' }}>›</span>}
                                  </span>
                                )
                              })
                            : (
                                <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)' }}>
                                  {preSign ? 'Стартует после подписания' : !b.state_id ? 'Не одобрена вузом — не стартовала' : 'Шаги 5–8 — в основной гусенице выше'}
                                </span>
                              )}
                        </div>
                      </div>
                      <button
                        onClick={pickBranch(b.id, b.state_id)}
                        style={{
                          height: 22,
                          padding: '0 8px',
                          marginRight: 10,
                          border: 0,
                          borderRadius: 'var(--border-radius-m)',
                          background: isSelBranch ? 'var(--accent-container-default)' : 'var(--neutral-container-soft)',
                          font: 'var(--font-description-l-strong)',
                          color: 'var(--fg-default)',
                          display: 'flex',
                          alignItems: 'center',
                          whiteSpace: 'nowrap',
                          cursor: 'pointer',
                          flex: 'none',
                        }}
                      >
                        {isSelBranch ? 'Открыта' : 'Открыть'}
                      </button>
                    </div>
                  )
                })}
                {openSide && (
                  <div
                    onClick={pickSide(openSide.id, openSide.stage_id)}
                    style={{
                      height: 40,
                      flex: 'none',
                      border: `1.5px solid ${ctx === `side:${openSide.id}` ? 'var(--accent-default)' : 'var(--border-muted)'}`,
                      background: ctx === `side:${openSide.id}` ? 'var(--bg-surface1)' : 'transparent',
                      borderRadius: 'var(--border-radius-m)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      padding: '0 12px',
                      cursor: 'pointer',
                    }}
                  >
                    <span style={{ width: 220, flex: 'none', font: 'var(--font-body-s-strong)', color: 'var(--fg-default)' }}>Побочный указатель</span>
                    <span style={{ flex: 1, font: 'var(--font-description-l)', color: 'var(--fg-muted)' }}>
                      {sideStages.find((s) => s.id === openSide.stage_id)?.name ?? '4.1 Допсоглашение'} · запущен {formatDate(openSide.started_at)}
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}
        </section>
      )}

      {/* Ветка — открывается только по клику на лейне, только просмотр, без действий */}
      {effectiveSec === 'branch' &&
        selBranch &&
        (() => {
          const b = selBranch
          const product = productOf(b.product_id)
          const vName = vendorName(product?.vendor_id)
          const contractTone = CONTRACT_TONE[b.contract_status]
          return (
            <section
              style={{
                background: 'var(--bg-surface1)',
                border: '1px solid var(--border-muted)',
                borderRadius: 'var(--border-radius-l)',
                padding: 20,
                display: 'flex',
                flexDirection: 'column',
                gap: 16,
              }}
            >
              <span style={{ font: 'var(--font-heading-h5)', color: 'var(--fg-default)' }}>
                Ветка «{programName(b.program_id)}»{selStage ? ` · Шаг ${selStage.position}: ${selStage.name.replace(/^\d+(\.\d+)?\.?\s*/, '')}` : ''}
              </span>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start' }}>
                <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{ font: 'var(--font-body-m-strong)', color: 'var(--fg-default)' }}>{programName(b.program_id)}</span>
                  <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-soft)' }}>
                    {product?.name ?? '—'}
                    {vName ? ` · ${vName}` : ''}
                  </span>
                </span>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  {contractTone && <Badge tone={contractTone} label={CONTRACT_LABEL[b.contract_status] ?? b.contract_status} />}
                  {b.pause_state === 'PAUSED' && <Badge tone={STATUS_TONE.PAUSED} label="На паузе" />}
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,minmax(0,1fr))', gap: 12 }}>
                <Fact k="Открыта" v={formatDate(b.opened_at)} />
                <Fact k="Лицензия до" v={formatDate(b.license_until)} />
                <Fact k="Передача" v={b.transfer_status === 'TRANSFERRED' ? 'Передана' : 'Не передана'} />
                <Fact k="Обучено преподавателей" v={b.teachers_trained != null ? String(b.teachers_trained) : '—'} />
              </div>
            </section>
          )
        })()}

      {effectiveSec === 'data' && (
        <section
          style={{
            background: 'var(--bg-surface1)',
            border: '1px solid var(--border-muted)',
            borderRadius: 'var(--border-radius-l)',
            padding: 20,
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
          }}
        >
          <ReadOnlyStageData stage={selStage} values={selStageValues} />
        </section>
      )}

      {effectiveSec === 'documents' && (
        <section
          style={{
            background: 'var(--bg-surface1)',
            border: '1px solid var(--border-muted)',
            borderRadius: 'var(--border-radius-l)',
            padding: 20,
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
          }}
        >
          <span style={{ font: 'var(--font-heading-h5)', color: 'var(--fg-default)' }}>
            Документы шага «{selStage?.name ?? ''}»<span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)' }}> · {selDocs.length}</span>
          </span>
          <ReadOnlyDocumentsList docs={selDocs} />
        </section>
      )}

      {effectiveSec === 'stage' && (
        <section
          style={{
            background: 'var(--bg-surface1)',
            border: '1px solid var(--border-muted)',
            borderRadius: 'var(--border-radius-l)',
            padding: 20,
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
          }}
        >
          <StageComments interactionId={id} stageId={selStageId} stageName={selStage?.name} />
        </section>
      )}

      {effectiveSec === 'history' && (
        <section
          style={{
            background: 'var(--bg-surface1)',
            border: '1px solid var(--border-muted)',
            borderRadius: 'var(--border-radius-l)',
            padding: 20,
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
          }}
        >
          <HistorySection history={history} />
        </section>
      )}

      {/* Плавающая панель — только навигация по разделам, без действий (роль admin не меняет данные) */}
      <div
        style={{
          position: 'fixed',
          left: '50%',
          bottom: 16,
          transform: 'translateX(-50%)',
          zIndex: 15,
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          padding: 6,
          borderRadius: 999,
          background: 'var(--bg-elevated-xl)',
          border: '1px solid var(--border-muted)',
          boxShadow: 'var(--shadow-bottom-xl)',
          maxWidth: 'calc(100vw - 32px)',
        }}
      >
        {secDefs.map(([key, label, count]) => (
          <button
            key={key}
            onClick={() => setSec(key)}
            style={{
              height: 36,
              padding: '0 14px',
              border: 0,
              borderRadius: 999,
              background: effectiveSec === key ? 'var(--neutral-container-soft)' : 'transparent',
              color: effectiveSec === key ? 'var(--fg-default)' : 'var(--fg-soft)',
              font: 'var(--font-body-s-strong)',
              cursor: 'pointer',
              display: 'flex',
              gap: 6,
              alignItems: 'center',
              whiteSpace: 'nowrap',
            }}
          >
            {label}
            {!!count && <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)' }}>{count}</span>}
          </button>
        ))}
        <span style={{ width: 1, height: 22, background: 'var(--border-muted)', margin: '0 6px' }} />
        <span
          style={{
            height: 36,
            padding: '0 14px',
            borderRadius: 999,
            background: 'var(--neutral-container-soft)',
            color: 'var(--fg-muted)',
            font: 'var(--font-body-s-strong)',
            display: 'flex',
            alignItems: 'center',
            whiteSpace: 'nowrap',
          }}
        >
          Только чтение
        </span>
      </div>
    </div>
  )
}

function Fact({ k, v }: { k: string; v: string }) {
  return (
    <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)' }}>{k}</span>
      <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-default)' }}>{v}</span>
    </span>
  )
}

function StageComments({ interactionId, stageId, stageName }: { interactionId: number; stageId: number | null | undefined; stageName: string | undefined }) {
  const { data, isLoading } = useComments(interactionId, stageId)

  if (!stageId) return <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-muted)' }}>Текущий этап не определён</span>

  const items = data?.items ?? []

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <span style={{ font: 'var(--font-heading-h5)', color: 'var(--fg-default)' }}>
        Комментарии к шагу «{stageName ?? stageId}»<span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)' }}> · {data?.total ?? 0}</span>
      </span>

      {isLoading && <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-muted)' }}>Загрузка…</span>}

      {items.map((c) => (
        <div key={c.id} style={{ display: 'flex', gap: 12 }}>
          <span
            style={{
              width: 32,
              height: 32,
              flex: 'none',
              borderRadius: '50%',
              background: 'var(--neutral-container-default)',
              color: 'var(--fg-soft)',
              font: 'var(--font-description-l-strong)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {c.author.name
              .split(' ')
              .map((p) => p[0])
              .slice(0, 2)
              .join('')
              .toUpperCase()}
          </span>
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
              <span style={{ font: 'var(--font-body-s-strong)', color: 'var(--fg-default)' }}>{c.author.name}</span>
              <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)' }}>{formatDateTime(c.created_at)}</span>
              {c.edited_at && <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)' }}>изменено</span>}
            </div>
            {c.reply_to && (
              <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)', background: 'var(--bg-surface2)', borderRadius: 'var(--border-radius-m)', padding: '6px 10px' }}>
                «{c.reply_to.text_preview ?? '—'}»
              </span>
            )}
            <span style={{ font: 'var(--font-body-s)', color: c.deleted ? 'var(--fg-muted)' : 'var(--fg-default)' }}>{c.deleted ? 'Комментарий удалён' : c.text}</span>
          </div>
        </div>
      ))}

      {!isLoading && items.length === 0 && <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-muted)' }}>Пока никто не комментировал этот шаг</span>}
      {/* Отправка новых комментариев админу не нужна - у него нет роли в
          процессе, только наблюдение (см. задание: просмотр без действий) */}
    </div>
  )
}

function HistorySection({ history }: { history: ReturnType<typeof useInteractionHistory>['data'] }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)', paddingBottom: 8 }}>Этапы и события</span>
        {(history?.stages ?? []).map((h, i) => (
          <div key={i} style={{ display: 'flex', gap: 12, padding: '12px 0', borderTop: '1px solid var(--border-muted)' }}>
            <span style={{ width: 96, flex: 'none', font: 'var(--font-description-l)', color: 'var(--fg-muted)', fontVariantNumeric: 'tabular-nums' }}>{formatDateTime(h.created_at)}</span>
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ font: 'var(--font-body-s-strong)', color: 'var(--fg-default)' }}>{h.kind}</span>
              {h.comment && <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-soft)' }}>«{h.comment}»</span>}
            </div>
          </div>
        ))}
        {(history?.stages ?? []).length === 0 && <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-muted)', padding: '12px 0' }}>Событий пока нет</span>}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)', paddingBottom: 8 }}>Назначения</span>
        {(history?.assignments ?? []).map((a, i) => (
          <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '12px 0', borderTop: '1px solid var(--border-muted)' }}>
            <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)' }}>
              {formatDateTime(a.assigned_at)} — {a.released_at ? formatDateTime(a.released_at) : 'сейчас'}
            </span>
            {a.reason && <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-soft)' }}>«{a.reason}»</span>}
          </div>
        ))}
        {(history?.assignments ?? []).length === 0 && <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-muted)', padding: '12px 0' }}>Переназначений не было</span>}
      </div>
    </div>
  )
}

const DOC_STATUS_LABEL: Record<string, string> = { ACTIVE: 'Действует', PENDING: 'На одобрении', REJECTED: 'Отклонён' }
const DOC_STATUS_TONE: Record<string, [string, string]> = {
  ACTIVE: ['var(--success-container-default)', 'var(--success-default)'],
  PENDING: ['var(--warning-container-default)', 'var(--warning-default)'],
  REJECTED: ['var(--error-container-default)', 'var(--error-default)'],
}

function ReadOnlyStageData({ stage, values }: { stage: StageRead | undefined; values: { values: Record<string, unknown> } | undefined }) {
  if (!stage) return <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)' }}>Текущий этап не определён</span>

  const fields = stage.fields ?? []

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <span style={{ font: 'var(--font-heading-h5)', color: 'var(--fg-default)' }}>Данные шага «{stage.name}»</span>
      {fields.length === 0 && <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-muted)' }}>У этого шага нет полей</span>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 12 }}>
        {fields.map((f) => (
          <Fact key={f.key} k={f.label} v={values?.values[f.key] != null ? String(values.values[f.key]) : '—'} />
        ))}
      </div>
    </div>
  )
}

function ReadOnlyDocumentsList({ docs }: { docs: DocumentRead[] }) {
  if (docs.length === 0) return <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-muted)' }}>К этому шагу пока ничего не приложено</span>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {docs.map((d) => {
        const tone = DOC_STATUS_TONE[d.status] ?? DOC_STATUS_TONE.ACTIVE
        return (
          <div key={d.id} style={{ border: '1px solid var(--border-muted)', borderRadius: 'var(--border-radius-m)', padding: 12, display: 'flex', gap: 16, alignItems: 'flex-start', opacity: d.is_current ? 1 : 0.6 }}>
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ font: 'var(--font-body-s-strong)', color: 'var(--fg-default)' }}>{d.title}</span>
                <span style={{ height: 20, padding: '0 6px', borderRadius: 'var(--border-radius-s)', background: 'var(--neutral-container-default)', font: 'var(--font-description-l-strong)', color: 'var(--fg-soft)', display: 'flex', alignItems: 'center' }}>{d.kind}</span>
                <Badge tone={tone} label={DOC_STATUS_LABEL[d.status] ?? d.status} />
                {d.is_current && <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)' }}>актуальная версия</span>}
              </div>
              <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)' }}>
                {formatDateTime(d.created_at)}
                {d.attachment ? ` · ${d.attachment.filename}` : ''}
              </span>
              {d.kind === 'CONTRACT' && (d.contract_number || d.contract_signed_at || d.contract_valid_until) && (
                <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-soft)' }}>
                  Договор № {d.contract_number ?? '—'} · подписан {formatDate(d.contract_signed_at)} · действует до {formatDate(d.contract_valid_until)}
                </span>
              )}
            </div>
            {d.attachment && (
              <a href={`/api/v1/attachments/${d.attachment.id}/download`} target="_blank" rel="noreferrer" style={{ height: 32, padding: '0 14px', border: '1px solid var(--border-muted)', borderRadius: 'var(--border-radius-buttons)', font: 'var(--font-body-s-strong)', color: 'var(--fg-default)', textDecoration: 'none', display: 'flex', alignItems: 'center', whiteSpace: 'nowrap' }}>
                Скачать
              </a>
            )}
          </div>
        )
      })}
    </div>
  )
}
