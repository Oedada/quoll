import { useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMe } from '../../auth/useMe'
import { useToast } from '../ToastContext'
import { Atomaro } from '../../ds/atomaro'
import {
  useInteraction,
  useInteractionHistory,
  useAvailableTransitions,
  useAcceptInteraction,
  useTransitionInteraction,
  useDeclineInteraction,
  usePauseInteraction,
  useUnpauseInteraction,
  type InteractionRead,
} from '../../api/interactions'
import {
  useBranches,
  usePauseBranch,
  useUnpauseBranch,
  useSetBranchContractStatus,
  useCloseBranch,
  useComments,
  useCreateComment,
  useDeleteComment,
  type BranchRead,
  type InteractionDetailExtra,
} from '../../api/interaction-detail'
import { useStagesByWorkflow, type StageRead, type StageField } from '../../api/stages'
import { usePrograms, useProducts, useVendors, useCloseReasons, useContacts, useDocumentKinds } from '../../api/catalog-extra'
import { useUpdatePlannedDate } from '../../api/interaction-settings'
import { usePeople, personFullName } from '../../api/people'
import {
  useDocuments,
  useUploadDocument,
  useApproveDocument,
  useRejectDocument,
  useAgreements,
  useUpdateAgreement,
  useAddAgreementAction,
  useRemoveAgreementAction,
  useUploadAgreementScan,
  useSidePointers,
  useStartSidePointer,
  useTransitionSidePointer,
  useCancelSidePointer,
  useStageValuesList,
  useSetStageValues,
  useApproveStageValues,
  useRejectStageValues,
  type DocumentRead,
  type AgreementRead,
  type AgreementActionWrite,
  type SidePointerRead,
  type StageValuesRead,
} from '../../api/interaction-documents'

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

export default function InteractionCardPage() {
  const { id: idParam } = useParams<{ id: string }>()
  const id = Number(idParam)
  const navigate = useNavigate()
  const toast = useToast()
  const { data: me } = useMe()

  const { data: raw, isLoading, error } = useInteraction(id)
  // GET /interactions/{id} реально отдаёт InteractionDetailRead (шире типа InteractionRead
  // из interactions.ts) - университет и текущий шаг приезжают в том же ответе.
  const r = raw as (InteractionRead & Partial<InteractionDetailExtra>) | undefined

  const { data: branches } = useBranches(id)
  const { data: stages } = useStagesByWorkflow(r?.workflow_id)
  const { data: history } = useInteractionHistory(id)
  const { data: transitions } = useAvailableTransitions(r?.workflow_id ?? undefined, r?.state_id)
  const { data: programs } = usePrograms()
  const { data: products } = useProducts()
  const { data: vendors } = useVendors()
  const { data: closeReasons } = useCloseReasons()
  const { data: people } = usePeople([r?.owner_id, r?.created_by])
  const { data: contacts } = useContacts()
  const { data: documentKinds } = useDocumentKinds()
  const { data: documents } = useDocuments(id)
  const { data: agreements } = useAgreements(id)
  const { data: sidePointers } = useSidePointers(id)
  const { data: stageValuesList } = useStageValuesList(id)

  const [sec, setSec] = useState<string>('data')
  const [menuOpen, setMenuOpen] = useState(false)
  const [pauseDlg, setPauseDlg] = useState<null | { kind: 'interaction' } | { kind: 'branch'; branch: BranchRead }>(null)
  const [closeDlg, setCloseDlg] = useState<BranchRead | null>(null)
  const [transitionDlg, setTransitionDlg] = useState<null | { kind: 'accept' | 'transition' | 'decline' }>(null)
  const [uploadDlg, setUploadDlg] = useState(false)
  const [addActionSa, setAddActionSa] = useState<AgreementRead | null>(null)
  const [scanSa, setScanSa] = useState<AgreementRead | null>(null)
  const [cancelSaDlg, setCancelSaDlg] = useState<AgreementRead | null>(null)
  const [infoOpen, setInfoOpen] = useState(false)
  const [planDlg, setPlanDlg] = useState(false)
  const [planValue, setPlanValue] = useState('')
  // Выбор контекста на «гусенице»/лейнах: по какому шагу сейчас смотрим Данные/Документы.
  const [ctx, setCtx] = useState<string>('main')
  const [stageSel, setStageSel] = useState<number | null>(null)

  const pauseInteraction = usePauseInteraction()
  const unpauseInteraction = useUnpauseInteraction()
  const pauseBranch = usePauseBranch()
  const unpauseBranch = useUnpauseBranch()
  const setContractStatus = useSetBranchContractStatus()
  const startSidePointer = useStartSidePointer()
  const updatePlannedDate = useUpdatePlannedDate()

  const ownerName = useMemo(() => {
    const p = people?.find((x) => x.id === r?.owner_id)
    return p ? personFullName(p) : null
  }, [people, r?.owner_id])
  const createdByName = useMemo(() => {
    const p = people?.find((x) => x.id === r?.created_by)
    return p ? personFullName(p) : null
  }, [people, r?.created_by])
  const closeReasonLabel = closeReasons?.find((cr) => cr.id === r?.close_reason_id)?.label ?? null

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
          onClick={() => navigate('/manager/interactions')}
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
          К списку взаимодействий
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

  const programName = (id: number | null) => programs?.find((p) => p.id === id)?.name ?? '—'
  const productOf = (id: number | null) => products?.find((p) => p.id === id) ?? null
  const vendorName = (vendorId: number | undefined) => vendors?.find((v) => v.id === vendorId)?.name ?? null

  // одобрять правки пройденного шага и документы может только руководитель владельца
  const isSupervisor = me?.role === 'superviser'
  const currentStage = stages?.find((s) => s.id === r.state_id)
  const saHandlerStage = stages?.find((s) => s.handler === 'SUPPLEMENTARY_AGREEMENT')
  const openSidePointer = sidePointers?.find((p) => p.status === 'ACTIVE')
  const openAgreement = agreements?.find((a) => a.status === 'DRAFT' || a.status === 'PENDING')
  const canStartSa = !!r.no_return_at && r.status !== 'CLOSED' && !openAgreement && !openSidePointer && !!saHandlerStage

  // «Гусеница»: основные шаги + побочный указатель (4.1) + шаги веток — одним путём,
  // как в «Карточка взаимодействия.dc.html» (flow/path в renderVals()).
  const mainStages = (stages ?? []).filter((s) => !s.is_branch_stage && !s.is_side).sort((a, b) => a.position - b.position)
  const branchStages = (stages ?? []).filter((s) => s.is_branch_stage).sort((a, b) => a.position - b.position)
  const sideStages = (stages ?? []).filter((s) => s.is_side).sort((a, b) => a.position - b.position)
  const mainNonTerminal = mainStages.filter((s) => !s.is_terminal)
  const mainTerminal = mainStages.filter((s) => s.is_terminal)
  const branchNonTerminal = branchStages.filter((s) => !s.is_terminal)
  const openSide = openSidePointer ?? null
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
  // показываем в «Данные»/«Документы»/«Комментарии». main|branch:<id>|side:<id>.
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
  }
  const pickBranch = (branchId: number, stageId: number | null) => () => {
    setCtx(`branch:${branchId}`)
    setStageSel(stageId)
  }
  const pickSide = (sideId: number, stageId: number | null) => () => {
    setCtx(`side:${sideId}`)
    setStageSel(stageId)
  }

  // Какие вкладки в плавающей панели — зависит от выбранного контекста, как в дизайне.
  const secDefs: [string, string, number][] = [
    ...(ctx.startsWith('side:')
      ? ([['agreements', 'Допсоглашения', agreements?.length ?? 0]] as [string, string, number][])
      : ctx.startsWith('branch:')
        ? ([
            ['branch', 'Ветка', 0],
            ['data', 'Данные', 0],
            ['documents', 'Документы', selDocs.length],
          ] as [string, string, number][])
        : ([
            ['data', 'Данные', 0],
            ['documents', 'Документы', selDocs.length],
            ['agreements', 'Допсоглашения', agreements?.length ?? 0],
          ] as [string, string, number][])),
    ['comments', 'Комментарии', 0],
    ['history', 'История', 0],
  ]
  const effectiveSec = secDefs.some((d) => d[0] === sec) ? sec : secDefs[0][0]

  // Банеры «Сведений» — как в дизайне: ожидание принятия/черновик/застой/пауза/точка невозврата.
  const infoBanners: { bg: string; title: string; text?: string }[] = []
  if (r.status === 'AWAITING_ACCEPTANCE') infoBanners.push({ bg: 'var(--warning-container-default)', title: 'Ожидает принятия', text: 'Менеджер ещё не принял заявку' })
  if (r.status === 'DRAFT') infoBanners.push({ bg: 'var(--neutral-container-soft)', title: 'Черновик', text: 'Заявка ещё не назначена' })
  if (r.stall_since && r.status !== 'PAUSED')
    infoBanners.push({ bg: 'var(--error-container-default)', title: `Зависает с ${formatDate(r.stall_since)}`, text: `нет движения на шаге «${currentStage?.name ?? '—'}»` })
  if (r.pause_state === 'PAUSED')
    infoBanners.push({
      bg: 'var(--neutral-container-soft)',
      title: r.paused_until ? `На паузе до ${formatDate(r.paused_until)}` : 'На паузе бессрочно',
      text: r.pause_comment ?? undefined,
    })
  if (r.no_return_at) infoBanners.push({ bg: 'var(--neutral-container-soft)', title: `Точка невозврата ${formatDate(r.no_return_at)}`, text: 'К шагам 1–4 не вернуться: состав договора меняется только допсоглашением' })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0, paddingBottom: 72 }}>
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
            onClick={() => navigate(-1)}
            title="Назад к списку"
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
                      {
                        label: 'Плановая дата',
                        value: formatDate(r.planned_date),
                        canEdit: r.status !== 'CLOSED',
                        edit: () => {
                          setPlanValue(r.planned_date ?? '')
                          setPlanDlg(true)
                        },
                      },
                      { label: 'Подписано', value: formatDate(r.signed_at) },
                      { label: 'Закрыто', value: formatDate(r.closed_at) },
                      { label: 'Причина закрытия', value: closeReasonLabel ?? '—' },
                      { label: 'Маршрут', value: r.workflow?.name ?? '—' },
                    ].map((f) => (
                      <div key={f.label} style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                        <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)' }}>{f.label}</span>
                        <span style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                          <span style={{ font: 'var(--font-body-s-strong)', color: 'var(--fg-default)' }}>{f.value}</span>
                          {f.canEdit && (
                            <button onClick={f.edit} style={{ border: 0, background: 'transparent', padding: 0, font: 'var(--font-description-l-strong)', color: 'var(--accent-default)', cursor: 'pointer' }}>
                              Изменить
                            </button>
                          )}
                        </span>
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
          <span style={{ flex: 1 }} />
          {r.pause_state === 'PAUSED' ? (
            <button
              onClick={() =>
                unpauseInteraction.mutate(
                  { id },
                  {
                    onSuccess: () => toast({ title: 'Пауза снята', colorScheme: 'success' }),
                    onError: (e: any) => toast({ title: 'Не удалось снять паузу', subtitle: e?.message, colorScheme: 'error' }),
                  },
                )
              }
              style={smallOutlineBtn}
            >
              Снять паузу
            </button>
          ) : (
            r.status !== 'CLOSED' && (
              <button onClick={() => setPauseDlg({ kind: 'interaction' })} style={smallOutlineBtn}>
                Поставить на паузу
              </button>
            )
          )}
        </div>
      </section>

      {/* Путь (этапы workflow) — гусеница по «Карточка взаимодействия.dc.html»: основная
          цепочка + побочный указатель (4.1) + шаги веток (один путь, когда ветка одна,
          иначе — сводный узел «Шаги N–M», детали ниже в лейнах) */}
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

      {/* Ветка — открывается только по клику на лейне («Открыть»/«Открыта» выше), как в дизайне */}
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
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', borderTop: '1px solid var(--border-muted)', paddingTop: 10 }}>
                <div style={{ display: 'flex', gap: 2, padding: 2, borderRadius: 'var(--border-radius-m)', background: 'var(--neutral-container-soft)' }}>
                  {(['PROPOSED', 'APPROVED', 'REJECTED'] as const).map((cs) => (
                    <button
                      key={cs}
                      onClick={() =>
                        cs !== b.contract_status &&
                        setContractStatus.mutate(
                          { interactionId: id, branchId: b.id, contract_status: cs },
                          { onError: (e: any) => toast({ title: 'Не удалось изменить статус договора', subtitle: e?.message, colorScheme: 'error' }) },
                        )
                      }
                      style={{
                        height: 28,
                        padding: '0 10px',
                        border: 0,
                        borderRadius: 6,
                        background: cs === b.contract_status ? 'var(--bg-surface1)' : 'transparent',
                        font: 'var(--font-description-l-strong)',
                        color: cs === b.contract_status ? 'var(--fg-default)' : 'var(--fg-muted)',
                        cursor: 'pointer',
                      }}
                    >
                      {CONTRACT_LABEL[cs]}
                    </button>
                  ))}
                </div>
                {b.pause_state === 'PAUSED' ? (
                  <button
                    onClick={() =>
                      unpauseBranch.mutate(
                        { interactionId: id, branchId: b.id },
                        { onError: (e: any) => toast({ title: 'Не удалось снять паузу', subtitle: e?.message, colorScheme: 'error' }) },
                      )
                    }
                    style={smallOutlineBtn}
                  >
                    Снять паузу
                  </button>
                ) : (
                  <button onClick={() => setPauseDlg({ kind: 'branch', branch: b })} style={smallOutlineBtn}>
                    Пауза
                  </button>
                )}
                <button onClick={() => setCloseDlg(b)} style={{ ...smallOutlineBtn, color: 'var(--error-default)' }}>
                  Закрыть ветку
                </button>
              </div>
            </section>
          )
        })()}

      {effectiveSec === 'comments' && (
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
          <StageComments interactionId={id} stageId={selStageId} stageName={selStage?.name} myId={me?.id} />
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

      {/* Данные шага (выбранного на гусенице/ветке/указателе) */}
      {effectiveSec === 'data' && selStageId && (
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
          <StageValuesSection
            key={`${ctx}|${selStageId}`}
            interactionId={id}
            stage={selStage}
            values={selStageValues}
            branchId={selBranchId}
            sidePointerId={selSideId}
            isSupervisor={isSupervisor}
            contacts={contacts}
            universityId={r.university_id}
            toast={toast}
          />
        </section>
      )}

      {/* Документы шага (выбранного на гусенице/ветке/указателе) */}
      {effectiveSec === 'documents' && selStageId && (
        <section
          style={{
            background: 'var(--bg-surface1)',
            border: '1px solid var(--border-muted)',
            borderRadius: 'var(--border-radius-l)',
            padding: 20,
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
            <span style={{ font: 'var(--font-heading-h5)', color: 'var(--fg-default)' }}>
              Документы шага «{selStage?.name ?? ''}»
              <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)' }}> · {selDocs.length}</span>
            </span>
            {r.status !== 'CLOSED' && ctx === 'main' && (
              <button onClick={() => setUploadDlg(true)} style={primaryBtn}>
                Прикрепить документ
              </button>
            )}
          </div>
          <DocumentsList docs={selDocs} isSupervisor={isSupervisor} interactionId={id} toast={toast} />
        </section>
      )}

      {/* Допсоглашения */}
      {effectiveSec === 'agreements' && (
      <section
        style={{
          background: 'var(--bg-surface1)',
          border: '1px solid var(--border-muted)',
          borderRadius: 'var(--border-radius-l)',
          padding: 20,
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <span style={{ font: 'var(--font-heading-h5)', color: 'var(--fg-default)' }}>
            Допсоглашения
            <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)' }}> · {agreements?.length ?? 0}</span>
          </span>
          {canStartSa && (
            <button
              onClick={() =>
                startSidePointer.mutate(
                  { interactionId: id, stage_id: saHandlerStage!.id },
                  {
                    onSuccess: () => toast({ title: 'Допсоглашение запущено', colorScheme: 'success' }),
                    onError: (e: any) => toast({ title: 'Не удалось запустить допсоглашение', subtitle: e?.message, colorScheme: 'error' }),
                  },
                )
              }
              disabled={startSidePointer.isPending}
              style={primaryBtn}
            >
              Запустить допсоглашение
            </button>
          )}
        </div>
        {(agreements ?? []).length === 0 && <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-muted)' }}>Допсоглашений пока нет</span>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {(agreements ?? []).map((a) => (
            <AgreementCard
              key={a.id}
              interactionId={id}
              agreement={a}
              programs={programs}
              products={products}
              branches={branches}
              onAddAction={() => setAddActionSa(a)}
              onUploadScan={() => setScanSa(a)}
              onCancel={() => setCancelSaDlg(a)}
              toast={toast}
            />
          ))}
        </div>
      </section>
      )}

      {/* Побочные указатели — индекс всех, виден только в главном контексте */}
      {effectiveSec === 'data' && ctx === 'main' && sidePointers && sidePointers.length > 0 && (
        <section
          style={{
            background: 'var(--bg-surface1)',
            border: '1px solid var(--border-muted)',
            borderRadius: 'var(--border-radius-l)',
            padding: 20,
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}
        >
          <span style={{ font: 'var(--font-heading-h5)', color: 'var(--fg-default)' }}>
            Побочные указатели<span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)' }}> · {sidePointers.length}</span>
          </span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {sidePointers.map((p) => (
              <SidePointerRow key={p.id} interactionId={id} pointer={p} stages={stages} toast={toast} />
            ))}
          </div>
        </section>
      )}

      {/* Плавающая панель — как в дизайне: вкладки раздела + основное действие + «Действия ▾» + История */}
      {menuOpen && <div onClick={() => setMenuOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 14 }} />}
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
        {r.status === 'AWAITING_ACCEPTANCE' ? (
          <button onClick={() => setTransitionDlg({ kind: 'accept' })} style={{ ...dockPrimaryBtn }}>
            Принять в работу
          </button>
        ) : (
          r.status !== 'CLOSED' &&
          (transitions ?? []).length > 0 && (
            <button onClick={() => setTransitionDlg({ kind: 'transition' })} style={{ ...dockPrimaryBtn }}>
              Перейти на следующий этап
            </button>
          )
        )}
        {(() => {
          const menuItems: { label: string; run: () => void; danger?: boolean }[] = []
          if (r.status === 'AWAITING_ACCEPTANCE') menuItems.push({ label: 'Отклонить', run: () => setTransitionDlg({ kind: 'decline' }) })
          if (r.status !== 'CLOSED') {
            if (r.pause_state === 'PAUSED')
              menuItems.push({
                label: 'Снять паузу',
                run: () =>
                  unpauseInteraction.mutate(
                    { id },
                    {
                      onSuccess: () => toast({ title: 'Пауза снята', colorScheme: 'success' }),
                      onError: (e: any) => toast({ title: 'Не удалось снять паузу', subtitle: e?.message, colorScheme: 'error' }),
                    },
                  ),
              })
            else menuItems.push({ label: 'Пауза', run: () => setPauseDlg({ kind: 'interaction' }) })
          }
          if (menuItems.length === 0) return null
          return (
            <div style={{ position: 'relative' }}>
              <button
                onClick={() => setMenuOpen((v) => !v)}
                style={{ height: 36, padding: '0 14px', border: 0, borderRadius: 999, background: 'var(--neutral-container-soft)', color: 'var(--fg-default)', font: 'var(--font-body-s-strong)', cursor: 'pointer', whiteSpace: 'nowrap' }}
              >
                Действия {menuOpen ? '▾' : '▴'}
              </button>
              {menuOpen && (
                <div
                  style={{
                    position: 'absolute',
                    zIndex: 16,
                    right: 0,
                    bottom: 'calc(100% + 12px)',
                    minWidth: 220,
                    background: 'var(--bg-elevated-xl)',
                    border: '1px solid var(--border-muted)',
                    borderRadius: 'var(--border-radius-l)',
                    boxShadow: 'var(--shadow-bottom-xl)',
                    padding: 6,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 2,
                  }}
                >
                  {menuItems.map((m) => (
                    <button
                      key={m.label}
                      onClick={() => {
                        setMenuOpen(false)
                        m.run()
                      }}
                      style={{
                        height: 36,
                        padding: '0 12px',
                        border: 0,
                        borderRadius: 'var(--border-radius-m)',
                        background: 'transparent',
                        color: m.danger ? 'var(--error-default)' : 'var(--fg-default)',
                        font: 'var(--font-body-s)',
                        textAlign: 'left',
                        cursor: 'pointer',
                      }}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )
        })()}
      </div>

      {planDlg && (
        <DialogShell
          title="Плановая дата"
          onClose={() => setPlanDlg(false)}
          confirmLabel="Сохранить"
          busy={updatePlannedDate.isPending}
          onConfirm={() =>
            updatePlannedDate.mutate(
              { id, planned_date: planValue || null },
              {
                onSuccess: () => {
                  setPlanDlg(false)
                  toast({ title: 'Плановая дата сохранена', colorScheme: 'success' })
                },
                onError: (e: any) => toast({ title: 'Не удалось сохранить', subtitle: e?.message, colorScheme: 'error' }),
              },
            )
          }
        >
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ font: 'var(--font-description-l-strong)', color: 'var(--fg-soft)' }}>Плановая дата (пусто — снять дату)</span>
            <input
              type="date"
              value={planValue}
              onChange={(e) => setPlanValue(e.target.value)}
              style={{ height: 40, padding: '0 12px', border: '1px solid var(--border-soft)', borderRadius: 'var(--border-radius-inputs)', background: 'var(--bg-surface1)', font: 'var(--font-body-s)', color: 'var(--fg-default)', outline: 0 }}
            />
          </label>
        </DialogShell>
      )}

      {uploadDlg && (
        <UploadDocumentDialog
          interactionId={id}
          stageId={selStageId!}
          kinds={documentKinds}
          onClose={() => setUploadDlg(false)}
          onToast={toast}
        />
      )}

      {addActionSa && (
        <AddAgreementActionDialog
          interactionId={id}
          sa={addActionSa}
          programs={programs}
          products={products}
          branches={branches}
          onClose={() => setAddActionSa(null)}
          onToast={toast}
        />
      )}

      {scanSa && (
        <UploadScanDialog interactionId={id} sa={scanSa} onClose={() => setScanSa(null)} onToast={toast} />
      )}

      {cancelSaDlg && (
        <CancelAgreementDialog interactionId={id} sa={cancelSaDlg} onClose={() => setCancelSaDlg(null)} onToast={toast} />
      )}

      {pauseDlg && (
        <PauseDialog
          onClose={() => setPauseDlg(null)}
          onConfirm={(body) => {
            if (pauseDlg.kind === 'interaction') {
              pauseInteraction.mutate(
                { id, body },
                {
                  onSuccess: () => {
                    toast({ title: 'Взаимодействие поставлено на паузу', colorScheme: 'success' })
                    setPauseDlg(null)
                  },
                  onError: (e: any) => toast({ title: 'Не удалось поставить на паузу', subtitle: e?.message, colorScheme: 'error' }),
                },
              )
            } else {
              pauseBranch.mutate(
                { interactionId: id, branchId: pauseDlg.branch.id, body },
                {
                  onSuccess: () => {
                    toast({ title: 'Ветка поставлена на паузу', colorScheme: 'success' })
                    setPauseDlg(null)
                  },
                  onError: (e: any) => toast({ title: 'Не удалось поставить ветку на паузу', subtitle: e?.message, colorScheme: 'error' }),
                },
              )
            }
          }}
          busy={pauseInteraction.isPending || pauseBranch.isPending}
        />
      )}

      {closeDlg && (
        <CloseBranchDialog
          reasons={(closeReasons ?? []).filter((cr) => cr.level === 'BRANCH')}
          onClose={() => setCloseDlg(null)}
          interactionId={id}
          branch={closeDlg}
          onDone={() => setCloseDlg(null)}
          onToast={toast}
        />
      )}

      {transitionDlg && (
        <TransitionDialog
          kind={transitionDlg.kind}
          interactionId={id}
          transitions={transitions ?? []}
          onClose={() => setTransitionDlg(null)}
          onToast={toast}
        />
      )}
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

function StageComments({
  interactionId,
  stageId,
  stageName,
  myId,
}: {
  interactionId: number
  stageId: number | null | undefined
  stageName: string | undefined
  myId: string | undefined
}) {
  const { data, isLoading } = useComments(interactionId, stageId)
  const createComment = useCreateComment(interactionId)
  const deleteComment = useDeleteComment(interactionId)
  const [text, setText] = useState('')

  if (!stageId) return <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-muted)' }}>Текущий этап не определён</span>

  const items = data?.items ?? []

  const send = () => {
    if (!text.trim()) return
    createComment.mutate(
      { stage_id: stageId, text: text.trim() },
      { onSuccess: () => setText('') },
    )
  }

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
            <span style={{ font: 'var(--font-body-s)', color: c.deleted ? 'var(--fg-muted)' : 'var(--fg-default)' }}>
              {c.deleted ? 'Комментарий удалён' : c.text}
            </span>
            {!c.deleted && c.author.id === myId && (
              <div style={{ display: 'flex', gap: 12 }}>
                <button onClick={() => deleteComment.mutate(c.id)} style={{ border: 0, background: 'transparent', padding: 0, font: 'var(--font-description-l-strong)', color: 'var(--fg-muted)', cursor: 'pointer' }}>
                  Удалить
                </button>
              </div>
            )}
          </div>
        </div>
      ))}

      {!isLoading && items.length === 0 && <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-muted)' }}>Пока никто не комментировал этот шаг</span>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <textarea
          rows={2}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Написать комментарий к шагу"
          style={{ resize: 'vertical', padding: 12, border: '1px solid var(--border-soft)', borderRadius: 'var(--border-radius-inputs)', background: 'var(--bg-surface1)', font: 'var(--font-body-s)', color: 'var(--fg-default)', outline: 0 }}
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button onClick={send} disabled={createComment.isPending || !text.trim()} style={{ ...primaryBtn, opacity: !text.trim() ? 0.6 : 1 }}>
            Отправить
          </button>
        </div>
      </div>
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

const DOC_STATUS_TONE: Record<string, [string, string]> = {
  ACTIVE: ['var(--success-container-default)', 'var(--success-default)'],
  PENDING: ['var(--warning-container-default)', 'var(--warning-default)'],
  REJECTED: ['var(--error-container-default)', 'var(--error-default)'],
}
const DOC_STATUS_LABEL: Record<string, string> = { ACTIVE: 'Действует', PENDING: 'На одобрении', REJECTED: 'Отклонён' }
const SA_STATUS_TONE: Record<string, [string, string]> = {
  DRAFT: ['var(--neutral-container-default)', 'var(--neutral-muted)'],
  PENDING: ['var(--warning-container-default)', 'var(--warning-default)'],
  APPROVED: ['var(--success-container-default)', 'var(--success-default)'],
  REJECTED: ['var(--error-container-default)', 'var(--error-default)'],
  CANCELLED: ['var(--neutral-container-default)', 'var(--neutral-muted)'],
  RETURNED: ['var(--warning-container-default)', 'var(--warning-default)'],
}
const SA_STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Черновик',
  PENDING: 'На согласовании',
  APPROVED: 'Одобрено',
  REJECTED: 'Отклонено',
  CANCELLED: 'Отменено',
  RETURNED: 'Возвращено в черновик',
}
const SA_ACTION_LABEL: Record<string, string> = {
  NEW_BRANCH: 'Новая ветка',
  EXTEND_LICENSE: 'Продление лицензии',
  RESUME: 'Возобновление',
  EXCLUDE: 'Исключение',
  EXTEND_CONTRACT: 'Продление договора',
}

// --- Данные шага (значения полей текущего шага, per-step)

function StageValuesSection({
  interactionId,
  stage,
  values,
  branchId,
  sidePointerId,
  isSupervisor,
  contacts,
  universityId,
  toast,
}: {
  interactionId: number
  stage: StageRead | undefined
  values: StageValuesRead | undefined
  branchId?: number | null
  sidePointerId?: number | null
  isSupervisor: boolean
  contacts: { id: number; university_id: number | null; full_name: string }[] | undefined
  universityId: number
  toast: ReturnType<typeof useToast>
}) {
  const setValues = useSetStageValues()
  const approve = useApproveStageValues()
  const reject = useRejectStageValues()
  const [form, setForm] = useState<Record<string, unknown>>(() => values?.values ?? {})

  const fields: StageField[] = stage?.fields ?? []
  const uniContacts = (contacts ?? []).filter((c) => c.university_id === universityId)

  if (!stage) return <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)' }}>Текущий этап не определён</span>

  const set = (key: string, v: unknown) => setForm((f) => ({ ...f, [key]: v }))

  const save = () => {
    setValues.mutate(
      { interactionId, stageId: stage.id, values: form, branchId: branchId ?? undefined, sidePointerId: sidePointerId ?? undefined },
      {
        onSuccess: () => toast({ title: 'Данные шага сохранены', colorScheme: 'success' }),
        onError: (e: any) => toast({ title: 'Не удалось сохранить данные', subtitle: e?.message, colorScheme: 'error' }),
      },
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <span style={{ font: 'var(--font-heading-h5)', color: 'var(--fg-default)' }}>Данные шага «{stage.name}»</span>

      {values?.pending_values && (
        <div style={{ background: 'var(--warning-container-default)', borderRadius: 'var(--border-radius-m)', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={{ font: 'var(--font-body-s-strong)', color: 'var(--fg-default)' }}>Правка пройденного шага на согласовании</span>
          {fields.map((f) => (
            <div key={f.key} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
              <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-soft)' }}>{f.label}</span>
              <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-default)' }}>Сейчас: {String(values.values[f.key] ?? '—')}</span>
              <span style={{ font: 'var(--font-body-s-strong)', color: 'var(--fg-default)' }}>Предложено: {String(values.pending_values![f.key] ?? '—')}</span>
            </div>
          ))}
          {isSupervisor && (
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() =>
                  approve.mutate(
                    { interactionId, stageId: stage.id, branchId: branchId ?? undefined, sidePointerId: sidePointerId ?? undefined },
                    {
                      onSuccess: () => toast({ title: 'Правка согласована', colorScheme: 'success' }),
                      onError: (e: any) => toast({ title: 'Не удалось согласовать', subtitle: e?.message, colorScheme: 'error' }),
                    },
                  )
                }
                style={primaryBtn}
              >
                Согласовать
              </button>
              <button
                onClick={() =>
                  reject.mutate(
                    { interactionId, stageId: stage.id, branchId: branchId ?? undefined, sidePointerId: sidePointerId ?? undefined },
                    {
                      onSuccess: () => toast({ title: 'Правка отклонена', colorScheme: 'info' }),
                      onError: (e: any) => toast({ title: 'Не удалось отклонить', subtitle: e?.message, colorScheme: 'error' }),
                    },
                  )
                }
                style={smallOutlineBtn}
              >
                Отклонить
              </button>
            </div>
          )}
        </div>
      )}

      {fields.length === 0 && <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)' }}>У этого шага нет полей для заполнения</span>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 16 }}>
        {fields.map((f) => {
          const v = form[f.key]
          if (f.type === 'bool') {
            return (
              <label key={f.key} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={{ font: 'var(--font-description-l-strong)', color: 'var(--fg-soft)' }}>
                  {f.label}
                  {f.required && <span style={{ color: 'var(--accent-default)' }}> *</span>}
                </span>
                <button
                  type="button"
                  onClick={() => set(f.key, !v)}
                  style={{ alignSelf: 'flex-start', height: 32, padding: '0 12px', border: '1px solid var(--border-soft)', borderRadius: 'var(--border-radius-m)', background: 'var(--bg-surface1)', display: 'flex', alignItems: 'center', gap: 8, font: 'var(--font-body-s)', color: 'var(--fg-default)', cursor: 'pointer' }}
                >
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: v ? 'var(--success-default)' : 'var(--neutral-muted)' }} />
                  {v ? 'Да' : 'Нет'}
                </button>
              </label>
            )
          }
          if (f.type === 'text') {
            return (
              <label key={f.key} style={{ display: 'flex', flexDirection: 'column', gap: 6, gridColumn: 'span 2' }}>
                <span style={{ font: 'var(--font-description-l-strong)', color: 'var(--fg-soft)' }}>
                  {f.label}
                  {f.required && <span style={{ color: 'var(--accent-default)' }}> *</span>}
                </span>
                <textarea rows={3} value={(v as string) ?? ''} onChange={(e) => set(f.key, e.target.value)} style={textareaStyle} />
              </label>
            )
          }
          if (f.type === 'contact') {
            return (
              <label key={f.key} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={{ font: 'var(--font-description-l-strong)', color: 'var(--fg-soft)' }}>
                  {f.label}
                  {f.required && <span style={{ color: 'var(--accent-default)' }}> *</span>}
                </span>
                <select value={(v as string) ?? ''} onChange={(e) => set(f.key, e.target.value ? Number(e.target.value) : null)} style={inputStyle}>
                  <option value="">—</option>
                  {uniContacts.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.full_name}
                    </option>
                  ))}
                </select>
              </label>
            )
          }
          const inputType = f.type === 'date' ? 'date' : f.type === 'datetime' ? 'datetime-local' : f.type === 'number' ? 'number' : 'text'
          return (
            <label key={f.key} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ font: 'var(--font-description-l-strong)', color: 'var(--fg-soft)' }}>
                {f.label}
                {f.required && <span style={{ color: 'var(--accent-default)' }}> *</span>}
              </span>
              <input
                type={inputType}
                value={(v as string | number) ?? ''}
                onChange={(e) => set(f.key, f.type === 'number' ? (e.target.value === '' ? null : Number(e.target.value)) : e.target.value)}
                style={inputStyle}
              />
            </label>
          )
        })}
      </div>

      {fields.length > 0 && (
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button onClick={save} disabled={setValues.isPending} style={{ ...primaryBtn, opacity: setValues.isPending ? 0.6 : 1 }}>
            Сохранить
          </button>
        </div>
      )}
    </div>
  )
}

// --- Документы шага

function DocumentsList({
  docs,
  isSupervisor,
  interactionId,
  toast,
}: {
  docs: DocumentRead[]
  isSupervisor: boolean
  interactionId: number
  toast: ReturnType<typeof useToast>
}) {
  const approve = useApproveDocument()
  const reject = useRejectDocument()

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
              <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)' }}>{formatDateTime(d.created_at)}{d.attachment ? ` · ${d.attachment.filename}` : ''}</span>
              {d.replaced_by_id && <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)' }}>Заменён новой версией</span>}
              {d.replaces_document_id && <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)' }}>Заменяет документ #{d.replaces_document_id}</span>}
              {d.kind === 'CONTRACT' && (d.contract_number || d.contract_signed_at || d.contract_valid_until) && (
                <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-soft)' }}>
                  Договор № {d.contract_number ?? '—'} · подписан {formatDate(d.contract_signed_at)} · действует до {formatDate(d.contract_valid_until)}
                </span>
              )}
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              {d.attachment && (
                <a href={`/api/v1/attachments/${d.attachment.id}/download`} target="_blank" rel="noreferrer" style={{ ...smallOutlineBtn, textDecoration: 'none', display: 'flex', alignItems: 'center' }}>
                  Скачать
                </a>
              )}
              {isSupervisor && d.status === 'PENDING' && (
                <>
                  <button
                    onClick={() =>
                      approve.mutate(
                        { interactionId, documentId: d.id },
                        {
                          onSuccess: () => toast({ title: 'Документ одобрен', colorScheme: 'success' }),
                          onError: (e: any) => toast({ title: 'Не удалось одобрить', subtitle: e?.message, colorScheme: 'error' }),
                        },
                      )
                    }
                    style={smallOutlineBtn}
                  >
                    Одобрить
                  </button>
                  <button
                    onClick={() =>
                      reject.mutate(
                        { interactionId, documentId: d.id },
                        {
                          onSuccess: () => toast({ title: 'Документ отклонён', colorScheme: 'info' }),
                          onError: (e: any) => toast({ title: 'Не удалось отклонить', subtitle: e?.message, colorScheme: 'error' }),
                        },
                      )
                    }
                    style={{ ...smallOutlineBtn, color: 'var(--error-default)' }}
                  >
                    Отклонить
                  </button>
                </>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function UploadDocumentDialog({
  interactionId,
  stageId,
  kinds,
  onClose,
  onToast,
}: {
  interactionId: number
  stageId: number
  kinds: { id: number; code: string; label: string }[] | undefined
  onClose: () => void
  onToast: ReturnType<typeof useToast>
}) {
  const upload = useUploadDocument()
  const [file, setFile] = useState<File | null>(null)
  const [title, setTitle] = useState('')
  const [kind, setKind] = useState(kinds?.[0]?.code ?? '')
  const [description, setDescription] = useState('')
  const [contractNumber, setContractNumber] = useState('')
  const [signedAt, setSignedAt] = useState('')
  const [validUntil, setValidUntil] = useState('')
  const [tried, setTried] = useState(false)

  const isContract = kind === 'CONTRACT' || kind === 'SUPPLEMENTARY_AGREEMENT'

  return (
    <DialogShell
      title="Прикрепить документ"
      onClose={onClose}
      confirmLabel="Загрузить"
      busy={upload.isPending}
      onConfirm={() => {
        if (!file || !title.trim() || !kind) {
          setTried(true)
          return
        }
        upload.mutate(
          {
            interactionId,
            file,
            stage_id: stageId,
            title: title.trim(),
            kind,
            description: description.trim() || undefined,
            contract_number: isContract ? contractNumber.trim() || undefined : undefined,
            contract_signed_at: isContract ? signedAt || undefined : undefined,
            contract_valid_until: isContract ? validUntil || undefined : undefined,
          },
          {
            onSuccess: () => {
              onToast({ title: 'Документ загружен', colorScheme: 'success' })
              onClose()
            },
            onError: (e: any) => onToast({ title: 'Не удалось загрузить документ', subtitle: e?.message, colorScheme: 'error' }),
          },
        )
      }}
    >
      <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ font: 'var(--font-description-l-strong)', color: 'var(--fg-soft)' }}>Файл *</span>
        <input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} style={inputStyle} />
        {tried && !file && <span style={{ font: 'var(--font-description-l)', color: 'var(--error-default)' }}>Выберите файл</span>}
      </label>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ font: 'var(--font-description-l-strong)', color: 'var(--fg-soft)' }}>Название *</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} style={{ ...inputStyle, borderColor: tried && !title.trim() ? 'var(--error-default)' : 'var(--border-soft)' }} />
      </label>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ font: 'var(--font-description-l-strong)', color: 'var(--fg-soft)' }}>Вид *</span>
        <select value={kind} onChange={(e) => setKind(e.target.value)} style={inputStyle}>
          {(kinds ?? []).map((k) => (
            <option key={k.id} value={k.code}>
              {k.label}
            </option>
          ))}
        </select>
      </label>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ font: 'var(--font-description-l-strong)', color: 'var(--fg-soft)' }}>Описание</span>
        <textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} style={textareaStyle} />
      </label>
      {isContract && (
        <>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ font: 'var(--font-description-l-strong)', color: 'var(--fg-soft)' }}>Номер договора</span>
            <input value={contractNumber} onChange={(e) => setContractNumber(e.target.value)} style={inputStyle} />
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ font: 'var(--font-description-l-strong)', color: 'var(--fg-soft)' }}>Подписан</span>
              <input type="date" value={signedAt} onChange={(e) => setSignedAt(e.target.value)} style={inputStyle} />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ font: 'var(--font-description-l-strong)', color: 'var(--fg-soft)' }}>Действует до</span>
              <input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} style={inputStyle} />
            </label>
          </div>
        </>
      )}
    </DialogShell>
  )
}

// --- Допсоглашения

function AgreementCard({
  interactionId,
  agreement: a,
  programs,
  products,
  branches,
  onAddAction,
  onUploadScan,
  onCancel,
  toast,
}: {
  interactionId: number
  agreement: AgreementRead
  programs: { id: number; name: string }[] | undefined
  products: { id: number; name: string }[] | undefined
  branches: BranchRead[] | undefined
  onAddAction: () => void
  onUploadScan: () => void
  onCancel: () => void
  toast: ReturnType<typeof useToast>
}) {
  const update = useUpdateAgreement()
  const removeAction = useRemoveAgreementAction()
  const [number, setNumber] = useState(a.number ?? '')
  const [signedAt, setSignedAt] = useState(a.signed_at ?? '')
  const isDraft = a.status === 'DRAFT'
  const tone = SA_STATUS_TONE[a.status] ?? SA_STATUS_TONE.DRAFT

  const actionText = (act: AgreementRead['actions'][number]) => {
    if (act.type === 'NEW_BRANCH') return `${programs?.find((p) => p.id === act.program_id)?.name ?? act.program_id}${act.product_id ? ` · ${products?.find((p) => p.id === act.product_id)?.name ?? act.product_id}` : ''}`
    if (act.type === 'EXTEND_LICENSE') return `${branches?.find((b) => b.id === act.branch_id)?.id ?? act.branch_id} · до ${formatDate(act.license_until)}`
    if (act.type === 'RESUME' || act.type === 'EXCLUDE') return `Ветка #${act.branch_id}`
    if (act.type === 'EXTEND_CONTRACT') return `до ${formatDate(act.contract_valid_until)}`
    return ''
  }

  return (
    <div style={{ border: '1px solid var(--border-muted)', borderRadius: 'var(--border-radius-m)', padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ font: 'var(--font-body-m-strong)', color: 'var(--fg-default)' }}>Допсоглашение #{a.id}</span>
          <Badge tone={tone} label={SA_STATUS_LABEL[a.status] ?? a.status} />
        </div>
        <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)' }}>{formatDate(a.created_at)}</span>
      </div>

      {isDraft ? (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ font: 'var(--font-description-l-strong)', color: 'var(--fg-soft)' }}>Номер</span>
            <input value={number} onChange={(e) => setNumber(e.target.value)} style={inputStyle} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ font: 'var(--font-description-l-strong)', color: 'var(--fg-soft)' }}>Дата подписания</span>
            <input type="date" value={signedAt} onChange={(e) => setSignedAt(e.target.value)} style={inputStyle} />
          </label>
        </div>
      ) : (
        <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-soft)' }}>
          Номер: {a.number ?? '—'} · Подписано: {formatDate(a.signed_at)}
        </span>
      )}

      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)', paddingBottom: 4 }}>Действия</span>
        {a.actions.map((act) => (
          <div key={act.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderTop: '1px solid var(--border-muted)' }}>
            <span style={{ width: 160, flex: 'none', font: 'var(--font-body-s-strong)', color: 'var(--fg-default)' }}>{SA_ACTION_LABEL[act.type] ?? act.type}</span>
            <span style={{ flex: 1, font: 'var(--font-body-s)', color: 'var(--fg-soft)' }}>{actionText(act)}</span>
            {act.result_branch_id && <span style={{ font: 'var(--font-description-l-strong)', color: 'var(--fg-muted)' }}>ветка #{act.result_branch_id}</span>}
            {isDraft && (
              <button
                onClick={() =>
                  removeAction.mutate(
                    { interactionId, saId: a.id, actionId: act.id },
                    { onError: (e: any) => toast({ title: 'Не удалось удалить действие', subtitle: e?.message, colorScheme: 'error' }) },
                  )
                }
                style={{ height: 28, padding: '0 10px', border: 0, borderRadius: 'var(--border-radius-m)', background: 'transparent', color: 'var(--error-default)', font: 'var(--font-description-l-strong)', cursor: 'pointer' }}
              >
                Удалить
              </button>
            )}
          </div>
        ))}
        {a.actions.length === 0 && <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-muted)', padding: '8px 0' }}>Действий пока нет</span>}
      </div>

      {isDraft && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', borderTop: '1px solid var(--border-muted)', paddingTop: 12 }}>
          <button onClick={onAddAction} style={smallOutlineBtn}>
            Добавить действие
          </button>
          <button onClick={onUploadScan} style={smallOutlineBtn}>
            Загрузить скан
          </button>
          <button
            onClick={() =>
              update.mutate(
                { interactionId, saId: a.id, body: { number: number.trim() || null, signed_at: signedAt || null } },
                {
                  onSuccess: () => toast({ title: 'Сохранено', colorScheme: 'success' }),
                  onError: (e: any) => toast({ title: 'Не удалось сохранить', subtitle: e?.message, colorScheme: 'error' }),
                },
              )
            }
            style={smallOutlineBtn}
          >
            Сохранить номер и дату
          </button>
          <span style={{ flex: 1 }} />
          <button onClick={onCancel} style={{ ...smallOutlineBtn, color: 'var(--error-default)' }}>
            Отменить допсоглашение
          </button>
        </div>
      )}
    </div>
  )
}

function AddAgreementActionDialog({
  interactionId,
  sa,
  programs,
  products,
  branches,
  onClose,
  onToast,
}: {
  interactionId: number
  sa: AgreementRead
  programs: { id: number; name: string }[] | undefined
  products: { id: number; name: string }[] | undefined
  branches: BranchRead[] | undefined
  onClose: () => void
  onToast: ReturnType<typeof useToast>
}) {
  const addAction = useAddAgreementAction()
  const [type, setType] = useState<AgreementActionWrite['type']>('NEW_BRANCH')
  const [programId, setProgramId] = useState<number | null>(programs?.[0]?.id ?? null)
  const [productId, setProductId] = useState<number | null>(null)
  const [branchId, setBranchId] = useState<number | null>(branches?.[0]?.id ?? null)
  const [licenseUntil, setLicenseUntil] = useState('')
  const [contractValidUntil, setContractValidUntil] = useState('')
  const [tried, setTried] = useState(false)

  const invalid =
    (type === 'NEW_BRANCH' && !programId) ||
    (type === 'EXTEND_LICENSE' && (!branchId || !licenseUntil)) ||
    ((type === 'RESUME' || type === 'EXCLUDE') && !branchId) ||
    (type === 'EXTEND_CONTRACT' && !contractValidUntil)

  return (
    <DialogShell
      title="Добавить действие допсоглашения"
      onClose={onClose}
      confirmLabel="Добавить"
      busy={addAction.isPending}
      onConfirm={() => {
        if (invalid) {
          setTried(true)
          return
        }
        const body: AgreementActionWrite =
          type === 'NEW_BRANCH'
            ? { type, program_id: programId, product_id: productId }
            : type === 'EXTEND_LICENSE'
              ? { type, branch_id: branchId, license_until: licenseUntil }
              : type === 'RESUME' || type === 'EXCLUDE'
                ? { type, branch_id: branchId }
                : { type, contract_valid_until: contractValidUntil }
        addAction.mutate(
          { interactionId, saId: sa.id, body },
          {
            onSuccess: () => {
              onToast({ title: 'Действие добавлено', colorScheme: 'success' })
              onClose()
            },
            onError: (e: any) => onToast({ title: 'Не удалось добавить действие', subtitle: e?.message, colorScheme: 'error' }),
          },
        )
      }}
    >
      <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ font: 'var(--font-description-l-strong)', color: 'var(--fg-soft)' }}>Тип действия</span>
        <select value={type} onChange={(e) => setType(e.target.value as AgreementActionWrite['type'])} style={inputStyle}>
          {(['NEW_BRANCH', 'EXTEND_LICENSE', 'RESUME', 'EXCLUDE', 'EXTEND_CONTRACT'] as const).map((t) => (
            <option key={t} value={t}>
              {SA_ACTION_LABEL[t]}
            </option>
          ))}
        </select>
      </label>
      {type === 'NEW_BRANCH' && (
        <>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ font: 'var(--font-description-l-strong)', color: 'var(--fg-soft)' }}>Программа *</span>
            <select value={programId ?? ''} onChange={(e) => setProgramId(Number(e.target.value))} style={inputStyle}>
              {(programs ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ font: 'var(--font-description-l-strong)', color: 'var(--fg-soft)' }}>Продукт</span>
            <select value={productId ?? ''} onChange={(e) => setProductId(e.target.value ? Number(e.target.value) : null)} style={inputStyle}>
              <option value="">—</option>
              {(products ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        </>
      )}
      {(type === 'EXTEND_LICENSE' || type === 'RESUME' || type === 'EXCLUDE') && (
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ font: 'var(--font-description-l-strong)', color: 'var(--fg-soft)' }}>Ветка *</span>
          <select value={branchId ?? ''} onChange={(e) => setBranchId(Number(e.target.value))} style={inputStyle}>
            {(branches ?? []).map((b) => (
              <option key={b.id} value={b.id}>
                #{b.id} · {programs?.find((p) => p.id === b.program_id)?.name ?? '—'}
              </option>
            ))}
          </select>
        </label>
      )}
      {type === 'EXTEND_LICENSE' && (
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ font: 'var(--font-description-l-strong)', color: 'var(--fg-soft)' }}>Лицензия до *</span>
          <input type="date" value={licenseUntil} onChange={(e) => setLicenseUntil(e.target.value)} style={inputStyle} />
        </label>
      )}
      {type === 'EXTEND_CONTRACT' && (
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ font: 'var(--font-description-l-strong)', color: 'var(--fg-soft)' }}>Договор действует до *</span>
          <input type="date" value={contractValidUntil} onChange={(e) => setContractValidUntil(e.target.value)} style={inputStyle} />
        </label>
      )}
      {tried && invalid && <span style={{ font: 'var(--font-description-l)', color: 'var(--error-default)' }}>Заполните обязательные поля</span>}
    </DialogShell>
  )
}

function UploadScanDialog({
  interactionId,
  sa,
  onClose,
  onToast,
}: {
  interactionId: number
  sa: AgreementRead
  onClose: () => void
  onToast: ReturnType<typeof useToast>
}) {
  const uploadScan = useUploadAgreementScan()
  const [file, setFile] = useState<File | null>(null)
  const [tried, setTried] = useState(false)

  return (
    <DialogShell
      title="Загрузить скан допсоглашения"
      onClose={onClose}
      confirmLabel="Загрузить"
      busy={uploadScan.isPending}
      onConfirm={() => {
        if (!file) {
          setTried(true)
          return
        }
        uploadScan.mutate(
          { interactionId, saId: sa.id, file, replaces_document_id: sa.scan_document_id ?? undefined },
          {
            onSuccess: () => {
              onToast({ title: 'Скан загружен', colorScheme: 'success' })
              onClose()
            },
            onError: (e: any) => onToast({ title: 'Не удалось загрузить скан', subtitle: e?.message, colorScheme: 'error' }),
          },
        )
      }}
    >
      <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ font: 'var(--font-description-l-strong)', color: 'var(--fg-soft)' }}>Файл *</span>
        <input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} style={inputStyle} />
        {tried && !file && <span style={{ font: 'var(--font-description-l)', color: 'var(--error-default)' }}>Выберите файл</span>}
      </label>
    </DialogShell>
  )
}

function CancelAgreementDialog({
  interactionId,
  sa,
  onClose,
  onToast,
}: {
  interactionId: number
  sa: AgreementRead
  onClose: () => void
  onToast: ReturnType<typeof useToast>
}) {
  const cancelPointer = useCancelSidePointer()
  const [comment, setComment] = useState('')

  return (
    <DialogShell
      title="Отменить допсоглашение"
      onClose={onClose}
      confirmLabel="Отменить допсоглашение"
      busy={cancelPointer.isPending}
      onConfirm={() => {
        if (!sa.side_pointer_id) {
          onToast({ title: 'У допсоглашения нет побочного указателя', colorScheme: 'error' })
          return
        }
        cancelPointer.mutate(
          { interactionId, pointerId: sa.side_pointer_id, comment: comment.trim() || undefined },
          {
            onSuccess: () => {
              onToast({ title: 'Допсоглашение отменено', colorScheme: 'info' })
              onClose()
            },
            onError: (e: any) => onToast({ title: 'Не удалось отменить', subtitle: e?.message, colorScheme: 'error' }),
          },
        )
      }}
    >
      <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ font: 'var(--font-description-l-strong)', color: 'var(--fg-soft)' }}>Комментарий (необязательно)</span>
        <textarea rows={3} value={comment} onChange={(e) => setComment(e.target.value)} style={textareaStyle} />
      </label>
    </DialogShell>
  )
}

// --- Побочные указатели

const SIDE_STATUS_LABEL: Record<string, string> = { OPEN: 'Открыт', FINISHED: 'Завершён', CANCELLED: 'Отменён' }
const SIDE_STATUS_TONE: Record<string, [string, string]> = {
  OPEN: ['var(--info-container-default)', 'var(--info-default)'],
  FINISHED: ['var(--success-container-default)', 'var(--success-default)'],
  CANCELLED: ['var(--neutral-container-default)', 'var(--neutral-muted)'],
}

function SidePointerRow({
  interactionId,
  pointer: p,
  stages,
  toast,
}: {
  interactionId: number
  pointer: SidePointerRead
  stages: StageRead[] | undefined
  toast: ReturnType<typeof useToast>
}) {
  const transition = useTransitionSidePointer()
  const cancel = useCancelSidePointer()
  const stageName = (sid: number) => stages?.find((s) => s.id === sid)?.name ?? `#${sid}`
  const sideStages = (stages ?? []).filter((s) => s.is_side && s.id !== p.stage_id)
  const [toStageId, setToStageId] = useState<number | null>(sideStages[0]?.id ?? null)

  return (
    <div style={{ border: '1px solid var(--border-muted)', borderRadius: 'var(--border-radius-m)', padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <span style={{ font: 'var(--font-body-s-strong)', color: 'var(--fg-default)' }}>{stageName(p.stage_id)}</span>
        <Badge tone={SIDE_STATUS_TONE[p.status] ?? SIDE_STATUS_TONE.OPEN} label={SIDE_STATUS_LABEL[p.status] ?? p.status} />
      </div>
      <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)' }}>
        запущен {formatDateTime(p.started_at)}
        {p.finished_at ? ` · завершён ${formatDateTime(p.finished_at)}` : ''}
      </span>
      {p.status === 'ACTIVE' && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {sideStages.length > 0 && (
            <>
              <select value={toStageId ?? ''} onChange={(e) => setToStageId(Number(e.target.value))} style={{ ...inputStyle, height: 32 }}>
                {sideStages.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              <button
                onClick={() =>
                  toStageId &&
                  transition.mutate(
                    { interactionId, pointerId: p.id, to_stage_id: toStageId, expected_state_id: p.stage_id },
                    {
                      onSuccess: () => toast({ title: 'Переход выполнен', colorScheme: 'success' }),
                      onError: (e: any) => toast({ title: 'Не удалось перейти', subtitle: e?.message, colorScheme: 'error' }),
                    },
                  )
                }
                style={smallOutlineBtn}
              >
                Перейти
              </button>
            </>
          )}
          <button
            onClick={() =>
              cancel.mutate(
                { interactionId, pointerId: p.id },
                {
                  onSuccess: () => toast({ title: 'Указатель отменён', colorScheme: 'info' }),
                  onError: (e: any) => toast({ title: 'Не удалось отменить', subtitle: e?.message, colorScheme: 'error' }),
                },
              )
            }
            style={{ ...smallOutlineBtn, color: 'var(--error-default)' }}
          >
            Отменить
          </button>
        </div>
      )}
    </div>
  )
}

function PauseDialog({ onClose, onConfirm, busy }: { onClose: () => void; onConfirm: (body: { until: string | null; comment: string }) => void; busy: boolean }) {
  const [comment, setComment] = useState('')
  const [until, setUntil] = useState('')
  const [tried, setTried] = useState(false)
  const err = tried && !comment.trim()

  return (
    <DialogShell
      title="Поставить на паузу"
      onClose={onClose}
      onConfirm={() => {
        if (!comment.trim()) {
          setTried(true)
          return
        }
        onConfirm({ until: until || null, comment: comment.trim() })
      }}
      confirmLabel="Поставить на паузу"
      busy={busy}
    >
      <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ font: 'var(--font-description-l-strong)', color: 'var(--fg-soft)' }}>До какой даты (необязательно)</span>
        <input type="date" value={until} onChange={(e) => setUntil(e.target.value)} style={inputStyle} />
      </label>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ font: 'var(--font-description-l-strong)', color: 'var(--fg-soft)' }}>Причина *</span>
        <textarea rows={3} value={comment} onChange={(e) => setComment(e.target.value)} style={{ ...textareaStyle, borderColor: err ? 'var(--error-default)' : 'var(--border-soft)' }} />
        {err && <span style={{ font: 'var(--font-description-l)', color: 'var(--error-default)' }}>Укажите причину</span>}
      </label>
    </DialogShell>
  )
}

function CloseBranchDialog({
  reasons,
  onClose,
  interactionId,
  branch,
  onDone,
  onToast,
}: {
  reasons: { id: number; label: string; needs_comment: boolean }[]
  onClose: () => void
  interactionId: number
  branch: BranchRead
  onDone: () => void
  onToast: ReturnType<typeof useToast>
}) {
  const closeBranch = useCloseBranch()
  const [reasonId, setReasonId] = useState<number | null>(reasons[0]?.id ?? null)
  const [comment, setComment] = useState('')
  const reason = reasons.find((r) => r.id === reasonId)
  const [tried, setTried] = useState(false)
  const err = tried && reason?.needs_comment && !comment.trim()

  return (
    <DialogShell
      title="Закрыть ветку"
      onClose={onClose}
      confirmLabel="Закрыть ветку"
      busy={closeBranch.isPending}
      onConfirm={() => {
        if (!reasonId) return
        if (reason?.needs_comment && !comment.trim()) {
          setTried(true)
          return
        }
        closeBranch.mutate(
          { interactionId, branchId: branch.id, body: { close_reason_id: reasonId, comment: comment.trim() || null } },
          {
            onSuccess: () => {
              onToast({ title: 'Ветка закрыта', colorScheme: 'success' })
              onDone()
            },
            onError: (e: any) => onToast({ title: 'Не удалось закрыть ветку', subtitle: e?.message, colorScheme: 'error' }),
          },
        )
      }}
    >
      <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ font: 'var(--font-description-l-strong)', color: 'var(--fg-soft)' }}>Причина</span>
        <select value={reasonId ?? ''} onChange={(e) => setReasonId(Number(e.target.value))} style={inputStyle}>
          {reasons.map((r) => (
            <option key={r.id} value={r.id}>
              {r.label}
            </option>
          ))}
        </select>
      </label>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ font: 'var(--font-description-l-strong)', color: 'var(--fg-soft)' }}>Комментарий{reason?.needs_comment ? ' *' : ' (необязательно)'}</span>
        <textarea rows={3} value={comment} onChange={(e) => setComment(e.target.value)} style={{ ...textareaStyle, borderColor: err ? 'var(--error-default)' : 'var(--border-soft)' }} />
        {err && <span style={{ font: 'var(--font-description-l)', color: 'var(--error-default)' }}>Укажите комментарий</span>}
      </label>
    </DialogShell>
  )
}

function TransitionDialog({
  kind,
  interactionId,
  transitions,
  onClose,
  onToast,
}: {
  kind: 'accept' | 'transition' | 'decline'
  interactionId: number
  transitions: { id: number; to_stage_id: number; name: string }[]
  onClose: () => void
  onToast: ReturnType<typeof useToast>
}) {
  const accept = useAcceptInteraction()
  const doTransition = useTransitionInteraction()
  const decline = useDeclineInteraction()
  const [toStageId, setToStageId] = useState<number | null>(transitions[0]?.to_stage_id ?? null)
  const [comment, setComment] = useState('')
  const [tried, setTried] = useState(false)

  const busy = accept.isPending || doTransition.isPending || decline.isPending
  const needsComment = kind === 'decline'
  const err = tried && needsComment && !comment.trim()

  const confirm = () => {
    if (kind === 'decline') {
      if (!comment.trim()) {
        setTried(true)
        return
      }
      decline.mutate(
        { id: interactionId, body: { comment: comment.trim() } },
        {
          onSuccess: () => {
            onToast({ title: 'Взаимодействие возвращено автору', colorScheme: 'info' })
            onClose()
          },
          onError: (e: any) => onToast({ title: 'Не удалось отклонить', subtitle: e?.message, colorScheme: 'error' }),
        },
      )
      return
    }
    if (!toStageId) return
    if (kind === 'accept') {
      accept.mutate(
        { id: interactionId, body: { to_stage_id: toStageId, comment: comment.trim() || undefined } },
        {
          onSuccess: () => {
            onToast({ title: 'Взаимодействие принято в работу', colorScheme: 'success' })
            onClose()
          },
          onError: (e: any) => onToast({ title: 'Не удалось принять', subtitle: e?.message, colorScheme: 'error' }),
        },
      )
    } else {
      doTransition.mutate(
        { id: interactionId, body: { to_stage_id: toStageId, expected_state_id: null, comment: comment.trim() || undefined } },
        {
          onSuccess: () => {
            onToast({ title: 'Переход выполнен', colorScheme: 'success' })
            onClose()
          },
          onError: (e: any) => onToast({ title: 'Не удалось перейти', subtitle: e?.message, colorScheme: 'error' }),
        },
      )
    }
  }

  return (
    <DialogShell
      title={kind === 'accept' ? 'Принять в работу' : kind === 'decline' ? 'Отклонить' : 'Перейти на следующий этап'}
      onClose={onClose}
      onConfirm={confirm}
      confirmLabel="Подтвердить"
      busy={busy}
    >
      {kind !== 'decline' && (
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ font: 'var(--font-description-l-strong)', color: 'var(--fg-soft)' }}>Этап</span>
          <select value={toStageId ?? ''} onChange={(e) => setToStageId(Number(e.target.value))} style={inputStyle}>
            {transitions.map((t) => (
              <option key={t.id} value={t.to_stage_id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ font: 'var(--font-description-l-strong)', color: 'var(--fg-soft)' }}>{kind === 'decline' ? 'Причина *' : 'Комментарий (необязательно)'}</span>
        <textarea rows={3} value={comment} onChange={(e) => setComment(e.target.value)} style={{ ...textareaStyle, borderColor: err ? 'var(--error-default)' : 'var(--border-soft)' }} />
        {err && <span style={{ font: 'var(--font-description-l)', color: 'var(--error-default)' }}>Укажите причину</span>}
      </label>
    </DialogShell>
  )
}

function DialogShell({
  title,
  onClose,
  onConfirm,
  confirmLabel,
  busy,
  children,
}: {
  title: string
  onClose: () => void
  onConfirm: () => void
  confirmLabel: string
  busy: boolean
  children: ReactNode
}) {
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
          maxHeight: 'calc(100vh - 48px)',
          overflowY: 'auto',
          background: 'var(--bg-elevated-xl)',
          borderRadius: 'var(--border-radius-xl)',
          boxShadow: 'var(--shadow-bottom-xl)',
          padding: 24,
          display: 'flex',
          flexDirection: 'column',
          gap: 20,
        }}
      >
        <span style={{ font: 'var(--font-heading-h3)', color: 'var(--fg-default)' }}>{title}</span>
        {children}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button onClick={onClose} style={smallOutlineBtn}>
            Отмена
          </button>
          <button onClick={onConfirm} disabled={busy} style={{ ...primaryBtn, opacity: busy ? 0.6 : 1, cursor: busy ? 'default' : 'pointer' }}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </>
  )
}

const smallOutlineBtn: CSSProperties = {
  height: 32,
  padding: '0 12px',
  border: '1px solid var(--border-soft)',
  borderRadius: 'var(--border-radius-buttons)',
  background: 'var(--bg-surface1)',
  color: 'var(--fg-default)',
  font: 'var(--font-body-s-strong)',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
}
const primaryBtn: CSSProperties = {
  height: 36,
  padding: '0 16px',
  border: 0,
  borderRadius: 'var(--border-radius-buttons)',
  background: 'var(--accent-default)',
  color: '#fff',
  font: 'var(--font-body-s-strong)',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
}
const dockPrimaryBtn: CSSProperties = {
  height: 36,
  padding: '0 16px',
  border: 0,
  borderRadius: 999,
  background: 'var(--accent-default)',
  color: '#fff',
  font: 'var(--font-body-s-strong)',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
}
const inputStyle: CSSProperties = {
  height: 40,
  padding: '0 12px',
  border: '1px solid var(--border-soft)',
  borderRadius: 'var(--border-radius-inputs)',
  background: 'var(--bg-surface1)',
  font: 'var(--font-body-s)',
  color: 'var(--fg-default)',
  outline: 0,
}
const textareaStyle: CSSProperties = {
  resize: 'vertical',
  padding: 12,
  border: '1px solid var(--border-soft)',
  borderRadius: 'var(--border-radius-inputs)',
  background: 'var(--bg-surface1)',
  font: 'var(--font-body-s)',
  color: 'var(--fg-default)',
  outline: 0,
}
