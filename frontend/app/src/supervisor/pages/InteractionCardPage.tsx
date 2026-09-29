import { useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMe } from '../../auth/useMe'
import { useToast } from '../../manager/ToastContext'
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
import { useStagesByWorkflow, type StageRead } from '../../api/stages'
import { usePrograms, useProducts, useVendors, useCloseReasons } from '../../api/catalog-extra'
import { usePeople, personFullName } from '../../api/people'
import { useUpdatePlannedDate } from '../../api/interaction-settings'
import { useRequests, type RequestRead } from '../../api/requests'
import { useApproveRequest, useRejectRequest } from '../../api/request-decisions'
import { CreateAssignDialog } from '../components/CreateAssignDialog'
import {
  useDocuments,
  useUploadDocument,
  useApproveDocument,
  useRejectDocument,
  useAgreements,
  useSidePointers,
  useStageValuesList,
  useApproveStageValues,
  useRejectStageValues,
  type DocumentRead,
  type AgreementRead,
  type SidePointerRead,
} from '../../api/supervisor/interaction-documents'

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
const REQUEST_KIND_LABEL: Record<string, string> = {
  TRANSFER: 'Передача КАМу',
  CLOSE: 'Закрытие',
  TRANSITION: 'Переход этапа',
}
const REQUEST_STATUS_LABEL: Record<string, string> = {
  PENDING: 'На рассмотрении',
  APPROVED: 'Одобрено',
  REJECTED: 'Отклонено',
  CANCELLED: 'Отозвано',
}
const REQUEST_STATUS_TONE: Record<string, [string, string]> = {
  PENDING: ['var(--warning-container-default)', 'var(--warning-default)'],
  APPROVED: ['var(--success-container-default)', 'var(--success-default)'],
  REJECTED: ['var(--error-container-default)', 'var(--error-default)'],
  CANCELLED: ['var(--neutral-container-default)', 'var(--neutral-muted)'],
}
const DOC_KIND_LABEL: Record<string, string> = {
  CONTRACT_DRAFT: 'Проект договора',
  CONTRACT: 'Договор',
  TRANSFER_ACT: 'Акт передачи',
  OTHER: 'Другое',
  SUPPLEMENTARY_AGREEMENT: 'Скан допсоглашения',
}
const UPLOAD_KINDS = ['CONTRACT_DRAFT', 'CONTRACT', 'TRANSFER_ACT', 'OTHER']
const DOC_STATUS_LABEL: Record<string, string> = { ACTIVE: 'Действует', PENDING: 'Ждёт согласования', REJECTED: 'Отклонён' }
const DOC_STATUS_TONE: Record<string, [string, string]> = {
  ACTIVE: ['var(--success-container-default)', 'var(--success-default)'],
  PENDING: ['var(--warning-container-default)', 'var(--warning-default)'],
  REJECTED: ['var(--error-container-default)', 'var(--error-default)'],
}
const AGREEMENT_STATUS_LABEL: Record<string, string> = { DRAFT: 'Черновик', PENDING: 'На одобрении', APPROVED: 'Одобрено', CANCELLED: 'Отменено' }
const AGREEMENT_STATUS_TONE: Record<string, [string, string]> = {
  DRAFT: ['var(--neutral-container-default)', 'var(--neutral-muted)'],
  PENDING: ['var(--warning-container-default)', 'var(--warning-default)'],
  APPROVED: ['var(--success-container-default)', 'var(--success-default)'],
  CANCELLED: ['var(--neutral-container-default)', 'var(--neutral-muted)'],
}
const SIDE_STATUS_LABEL: Record<string, string> = { ACTIVE: 'Активен', FINISHED: 'Завершён', CANCELLED: 'Отменён' }
const SIDE_STATUS_TONE: Record<string, [string, string]> = {
  ACTIVE: ['var(--info-container-default)', 'var(--info-default)'],
  FINISHED: ['var(--success-container-default)', 'var(--success-default)'],
  CANCELLED: ['var(--neutral-container-default)', 'var(--neutral-muted)'],
}
const AGREEMENT_ACTION_LABEL: Record<string, string> = {
  NEW_BRANCH: 'Новая ветка',
  EXTEND_LICENSE: 'Продление лицензии',
  RESUME: 'Возобновление ветки',
  EXCLUDE: 'Исключение ветки',
  EXTEND_CONTRACT: 'Продление договора',
}
function formatFileSize(bytes: number | undefined): string {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} Б`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`
}
function formatFieldValue(v: unknown, type: string): string {
  if (v == null || v === '') return '—'
  if (type === 'bool') return v ? 'Да' : 'Нет'
  if (type === 'date') return formatDate(String(v))
  if (type === 'datetime') return formatDateTime(String(v))
  return String(v)
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
  const { data: requests } = useRequests(id)
  const { data: documents } = useDocuments(id)
  const { data: agreements } = useAgreements(id)
  const { data: sidePointers } = useSidePointers(id)
  const { data: stageValues } = useStageValuesList(id)
  const { data: people } = usePeople([r?.owner_id, r?.created_by, ...(requests ?? []).map((q) => q.requested_by)])

  const [tab, setTab] = useState<'stage' | 'history' | 'requests' | 'data' | 'documents' | 'agreements' | 'side' | 'branch'>('stage')
  const [pauseDlg, setPauseDlg] = useState<null | { kind: 'interaction' } | { kind: 'branch'; branch: BranchRead }>(null)
  const [closeDlg, setCloseDlg] = useState<BranchRead | null>(null)
  const [transitionDlg, setTransitionDlg] = useState<null | { kind: 'accept' | 'transition' | 'decline' }>(null)
  const [assignDlg, setAssignDlg] = useState(false)
  const [ctx, setCtx] = useState<string>('main')
  const [stageSel, setStageSel] = useState<number | null>(null)
  const [infoOpen, setInfoOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [planDlg, setPlanDlg] = useState(false)
  const [planValue, setPlanValue] = useState('')

  const pauseInteraction = usePauseInteraction()
  const unpauseInteraction = useUnpauseInteraction()
  const pauseBranch = usePauseBranch()
  const unpauseBranch = useUnpauseBranch()
  const setContractStatus = useSetBranchContractStatus()
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

  const pendingRequestsCount = (requests ?? []).filter((q) => q.status === 'PENDING').length

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
          onClick={() => navigate('/supervisor/interactions')}
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
    !!stageValues?.find((v) => v.stage_id === stageId && v.branch_id == null && v.side_pointer_id == null)?.pending_values

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
  // показываем во вкладке «Данные». main|branch:<id>|side:<id>.
  const selBranch = ctx.startsWith('branch:') ? (branches ?? []).find((b) => `branch:${b.id}` === ctx) ?? null : null
  const selSide = ctx.startsWith('side:') ? (sidePointers ?? []).find((p) => `side:${p.id}` === ctx) ?? null : null
  const ctxCurStageId = selBranch ? selBranch.state_id : selSide ? selSide.stage_id : r.state_id
  const selStageId = stageSel ?? ctxCurStageId ?? null
  const selBranchId = selBranch?.id ?? null
  const selSideId = selSide?.id ?? null
  const pickMain = (stageId: number) => () => {
    setCtx('main')
    setStageSel(stageId)
    setTab('data')
  }
  const pickBranch = (branchId: number, stageId: number | null) => () => {
    setCtx(`branch:${branchId}`)
    setStageSel(stageId)
    setTab('branch')
  }
  const pickSide = (sideId: number, stageId: number | null) => () => {
    setCtx(`side:${sideId}`)
    setStageSel(stageId)
    setTab('data')
  }

  const infoBanners: { bg: string; title: string; text?: string }[] = []
  if (r.status === 'AWAITING_ACCEPTANCE') infoBanners.push({ bg: 'var(--warning-container-default)', title: 'Ожидает принятия', text: 'Менеджер ещё не принял заявку' })
  if (r.status === 'DRAFT') infoBanners.push({ bg: 'var(--neutral-container-soft)', title: 'Черновик', text: 'Заявка ещё не назначена' })
  if (r.stall_since && r.status !== 'PAUSED')
    infoBanners.push({ bg: 'var(--error-container-default)', title: `Зависает с ${formatDate(r.stall_since)}`, text: `нет движения на шаге «${stages?.find((s) => s.id === r.state_id)?.name ?? '—'}»` })
  if (r.pause_state === 'PAUSED')
    infoBanners.push({ bg: 'var(--neutral-container-soft)', title: r.paused_until ? `На паузе до ${formatDate(r.paused_until)}` : 'На паузе бессрочно', text: r.pause_comment ?? undefined })
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
            onClick={() => navigate('/supervisor/interactions')}
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
          {r.status !== 'CLOSED' && (
            <button onClick={() => setAssignDlg(true)} style={smallOutlineBtn}>
              {r.owner_id ? 'Переназначить КАМа' : 'Назначить КАМа'}
            </button>
          )}
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
                      <div onClick={pickBranch(b.id, b.state_id)} style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 12, padding: '0 12px', height: '100%', cursor: 'pointer' }}>
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
      {tab === 'branch' &&
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
                Ветка «{programName(b.program_id)}»{stages?.find((s) => s.id === selStageId) ? ` · Шаг ${stages.find((s) => s.id === selStageId)!.position}: ${stages.find((s) => s.id === selStageId)!.name.replace(/^\d+(\.\d+)?\.?\s*/, '')}` : ''}
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

      {/* Данные / Документы / Допсоглашения / Побочные указатели / Комментарии / Просьбы / История */}
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
        {tab === 'data' && (
          <StageDataSection
            key={`${ctx}|${selStageId}`}
            interactionId={id}
            stages={stages}
            stageId={selStageId}
            stageName={stages?.find((s) => s.id === selStageId)?.name}
            stageValues={stageValues ?? []}
            branchId={selBranchId}
            sidePointerId={selSideId}
          />
        )}
        {tab === 'documents' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            <DocumentsSection interactionId={id} documents={documents ?? []} stages={stages ?? []} currentStageId={r.state_id} onToast={toast} />
            <AgreementsSection agreements={agreements ?? []} />
          </div>
        )}
        {tab === 'side' && <SidePointersSection pointers={sidePointers ?? []} stages={stages ?? []} />}
        {tab === 'stage' && <StageComments interactionId={id} stageId={selStageId} stageName={stages?.find((s) => s.id === selStageId)?.name} myId={me?.id} />}
        {tab === 'requests' && <RequestsSection requests={requests ?? []} people={people ?? []} onToast={toast} />}
        {tab === 'history' && <HistorySection history={history} />}
      </section>

      {/* Плавающая панель — вкладки раздела + основное действие + «Действия ▾» */}
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
        {(
          [
            ...(ctx.startsWith('branch:') ? ([['branch', 'Ветка', 0]] as [string, string, number][]) : []),
            ['data', 'Данные', 0],
            ['documents', 'Документы', (documents?.length ?? 0) + (agreements?.length ?? 0)],
            ['stage', 'Комментарии', 0],
            ['history', 'История', 0],
          ] as [string, string, number][]
        ).map(([key, label, count]) => (
          <button
            key={key}
            onClick={() => setTab(key as typeof tab)}
            style={{
              height: 36,
              padding: '0 14px',
              border: 0,
              borderRadius: 999,
              background: tab === key ? 'var(--neutral-container-soft)' : 'transparent',
              color: tab === key ? 'var(--fg-default)' : 'var(--fg-soft)',
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
        <span style={{ width: 1, height: 22, background: 'var(--border-muted)', margin: '0 6px', flex: 'none' }} />
        {r.status === 'AWAITING_ACCEPTANCE' ? (
          <button onClick={() => setTransitionDlg({ kind: 'accept' })} style={dockPrimaryBtn}>
            Принять в работу
          </button>
        ) : (
          r.status !== 'CLOSED' &&
          (transitions ?? []).length > 0 && (
            <button onClick={() => setTransitionDlg({ kind: 'transition' })} style={dockPrimaryBtn}>
              Перейти на следующий этап
            </button>
          )
        )}
        {(() => {
          const menuItems: { label: string; run: () => void; count?: number }[] = []
          menuItems.push({ label: 'Побочные указатели', run: () => setTab('side'), count: sidePointers?.length ?? 0 })
          menuItems.push({ label: 'Просьбы', run: () => setTab('requests'), count: pendingRequestsCount })
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
            menuItems.push({ label: r.owner_id ? 'Переназначить КАМа' : 'Назначить КАМа', run: () => setAssignDlg(true) })
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
                      style={{ height: 36, padding: '0 12px', border: 0, borderRadius: 'var(--border-radius-m)', background: 'transparent', color: 'var(--fg-default)', font: 'var(--font-body-s)', textAlign: 'left', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}
                    >
                      {m.label}
                      {!!m.count && <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)' }}>{m.count}</span>}
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

      {assignDlg && (
        <CreateAssignDialog
          kind="assign"
          interactionId={id}
          currentOwnerName={ownerName}
          onClose={() => setAssignDlg(false)}
          onDone={() => setAssignDlg(false)}
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

// Значения полей текущего этапа (только чтение для руководителя) + решение по правке
// пройденного шага, которую прислал КАМ (Supervisor applies/drops a pending edit of a passed step).
function StageDataSection({
  interactionId,
  stages,
  stageId,
  stageName,
  stageValues,
  branchId,
  sidePointerId,
}: {
  interactionId: number
  stages: StageRead[] | undefined
  stageId: number | null | undefined
  stageName: string | undefined
  stageValues: { stage_id: number; branch_id: number | null; side_pointer_id: number | null; values: Record<string, unknown>; pending_values: Record<string, unknown> | null; pending_by: string | null }[]
  branchId?: number | null
  sidePointerId?: number | null
}) {
  const toast = useToast()
  const approve = useApproveStageValues()
  const reject = useRejectStageValues()
  const { data: people } = usePeople(stageValues.map((v) => v.pending_by))

  if (!stageId) return <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-muted)' }}>Текущий этап не определён</span>

  const stage = stages?.find((s) => s.id === stageId)
  const fields = stage?.fields ?? []
  const row = stageValues.find((v) => v.stage_id === stageId && v.branch_id == (branchId ?? null) && v.side_pointer_id == (sidePointerId ?? null))
  const pendingByName = row?.pending_by ? personFullName((people ?? []).find((p) => p.id === row.pending_by) as any) || row.pending_by : ''

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <span style={{ font: 'var(--font-heading-h5)', color: 'var(--fg-default)' }}>Данные шага «{stageName ?? stageId}»</span>

      {row?.pending_values && (
        <div style={{ background: 'var(--warning-container-default)', borderRadius: 'var(--border-radius-m)', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={{ font: 'var(--font-body-s-strong)', color: 'var(--fg-default)' }}>Правка пройденного шага на согласовании · {pendingByName}</span>
          {Object.entries(row.pending_values).map(([key, proposed]) => {
            const f = fields.find((x) => x.key === key)
            return (
              <div key={key} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-soft)' }}>{f?.label ?? key}</span>
                <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-default)' }}>Сейчас: {formatFieldValue(row.values[key], f?.type ?? 'string')}</span>
                <span style={{ font: 'var(--font-body-s-strong)', color: 'var(--fg-default)' }}>Предложено: {formatFieldValue(proposed, f?.type ?? 'string')}</span>
              </div>
            )
          })}
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() =>
                approve.mutate(
                  { interactionId, stageId, branchId: branchId ?? undefined, sidePointerId: sidePointerId ?? undefined },
                  {
                    onSuccess: () => toast({ title: 'Правка применена', colorScheme: 'success' }),
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
                  { interactionId, stageId, branchId: branchId ?? undefined, sidePointerId: sidePointerId ?? undefined },
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
        </div>
      )}

      {fields.length === 0 ? (
        <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-muted)' }}>У этого шага нет дополнительных полей</span>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 16 }}>
          {fields.map((f) => (
            <Fact key={f.key} k={f.label} v={formatFieldValue(row?.values?.[f.key], f.type)} />
          ))}
        </div>
      )}
    </div>
  )
}

// Документы шага: список версий + загрузка + решение руководителя по документам, ждущим
// согласования (approve/reject; PENDING возникает, когда КАМ прикладывает файл не на текущий шаг).
function DocumentsSection({
  interactionId,
  documents,
  stages,
  currentStageId,
  onToast,
}: {
  interactionId: number
  documents: DocumentRead[]
  stages: StageRead[]
  currentStageId: number | null | undefined
  onToast: ReturnType<typeof useToast>
}) {
  const approve = useApproveDocument()
  const reject = useRejectDocument()
  const [uploadOpen, setUploadOpen] = useState(false)
  const [decideDlg, setDecideDlg] = useState<null | { doc: DocumentRead; kind: 'approve' | 'reject' }>(null)
  const { data: people } = usePeople(documents.map((d) => d.uploaded_by))

  const stageName = (stageId: number) => stages.find((s) => s.id === stageId)?.name ?? `Шаг #${stageId}`
  const byName = (personId: string | null) => {
    const p = (people ?? []).find((x) => x.id === personId)
    return p ? personFullName(p as any) : '—'
  }

  // версии одного документа объединяем в цепочку: сначала оригинал, потом replaces_document_id
  const chains: DocumentRead[][] = []
  const seen = new Set<number>()
  for (const d of documents) {
    if (seen.has(d.id)) continue
    if (d.replaces_document_id != null && documents.some((x) => x.id === d.replaces_document_id)) continue
    const chain: DocumentRead[] = [d]
    seen.add(d.id)
    let next = documents.find((x) => x.replaces_document_id === d.id)
    while (next) {
      chain.push(next)
      seen.add(next.id)
      next = documents.find((x) => x.replaces_document_id === next!.id)
    }
    chains.push(chain)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <span style={{ font: 'var(--font-heading-h5)', color: 'var(--fg-default)' }}>Документы</span>
        {!!currentStageId && (
          <button onClick={() => setUploadOpen(true)} style={primaryBtn}>
            Прикрепить документ
          </button>
        )}
      </div>

      {documents.length === 0 && <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-muted)' }}>К этому взаимодействию пока ничего не приложено</span>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {chains.map((chain) => (
          <div key={chain[0].id} style={{ border: '1px solid var(--border-muted)', borderRadius: 'var(--border-radius-m)', display: 'flex', flexDirection: 'column' }}>
            {chain.map((d, i) => {
              const tone = DOC_STATUS_TONE[d.status] ?? DOC_STATUS_TONE.ACTIVE
              return (
                <div key={d.id} style={{ display: 'flex', gap: 16, padding: '12px 16px', borderTop: i > 0 ? '1px solid var(--border-muted)' : undefined, opacity: d.is_current ? 1 : 0.7, alignItems: 'flex-start' }}>
                  <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                      <span style={{ font: 'var(--font-body-s-strong)', color: 'var(--fg-default)' }}>{d.title}</span>
                      <span style={{ height: 20, padding: '0 6px', borderRadius: 'var(--border-radius-s)', background: 'var(--neutral-container-default)', font: 'var(--font-description-l-strong)', color: 'var(--fg-soft)', display: 'flex', alignItems: 'center' }}>
                        {DOC_KIND_LABEL[d.kind] ?? d.kind}
                      </span>
                      <Badge tone={tone} label={DOC_STATUS_LABEL[d.status] ?? d.status} />
                      {d.is_current && <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)' }}>актуальная версия</span>}
                    </div>
                    <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)' }}>
                      {stageName(d.stage_id)} · {byName(d.uploaded_by)}, {formatDateTime(d.created_at)}
                      {d.attachment ? ` · ${formatFileSize(d.attachment.size_bytes)}` : ''}
                    </span>
                    {d.contract_number && (
                      <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-soft)' }}>
                        Договор № {d.contract_number} · подписан {formatDate(d.contract_signed_at)} · действует до {formatDate(d.contract_valid_until)}
                      </span>
                    )}
                    {d.description && <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-soft)' }}>{d.description}</span>}
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    {d.attachment && (
                      <a
                        href={`/api/v1/attachments/${d.attachment.id}/download`}
                        target="_blank"
                        rel="noreferrer"
                        style={{ ...smallOutlineBtn, textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}
                      >
                        Скачать
                      </a>
                    )}
                    {d.status === 'PENDING' && (
                      <>
                        <button onClick={() => setDecideDlg({ doc: d, kind: 'approve' })} style={smallOutlineBtn}>
                          Одобрить
                        </button>
                        <button onClick={() => setDecideDlg({ doc: d, kind: 'reject' })} style={{ ...smallOutlineBtn, color: 'var(--error-default)' }}>
                          Отклонить
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        ))}
      </div>

      {uploadOpen && !!currentStageId && (
        <UploadDocumentDialog interactionId={interactionId} stageId={currentStageId} onClose={() => setUploadOpen(false)} onToast={onToast} />
      )}

      {decideDlg && (
        <DocumentDecisionDialog
          doc={decideDlg.doc}
          kind={decideDlg.kind}
          busy={approve.isPending || reject.isPending}
          onClose={() => setDecideDlg(null)}
          onConfirm={(comment) => {
            const mutation = decideDlg.kind === 'approve' ? approve : reject
            mutation.mutate(
              { id: decideDlg.doc.id, interactionId, comment },
              {
                onSuccess: () => {
                  onToast({ title: decideDlg.kind === 'approve' ? 'Документ одобрен' : 'Документ отклонён', colorScheme: decideDlg.kind === 'approve' ? 'success' : 'info' })
                  setDecideDlg(null)
                },
                onError: (e: any) => onToast({ title: 'Не удалось сохранить решение', subtitle: e?.message, colorScheme: 'error' }),
              },
            )
          }}
        />
      )}
    </div>
  )
}

function DocumentDecisionDialog({
  doc,
  kind,
  onClose,
  onConfirm,
  busy,
}: {
  doc: DocumentRead
  kind: 'approve' | 'reject'
  onClose: () => void
  onConfirm: (comment: string | undefined) => void
  busy: boolean
}) {
  const [comment, setComment] = useState('')
  return (
    <DialogShell title={kind === 'approve' ? 'Одобрить документ' : 'Отклонить документ'} onClose={onClose} onConfirm={() => onConfirm(comment.trim() || undefined)} confirmLabel={kind === 'approve' ? 'Одобрить' : 'Отклонить'} busy={busy}>
      <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-soft)' }}>«{doc.title}»</span>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ font: 'var(--font-description-l-strong)', color: 'var(--fg-soft)' }}>Комментарий (необязательно)</span>
        <textarea rows={3} value={comment} onChange={(e) => setComment(e.target.value)} style={textareaStyle} />
      </label>
    </DialogShell>
  )
}

function UploadDocumentDialog({
  interactionId,
  stageId,
  onClose,
  onToast,
}: {
  interactionId: number
  stageId: number
  onClose: () => void
  onToast: ReturnType<typeof useToast>
}) {
  const upload = useUploadDocument(interactionId)
  const [file, setFile] = useState<File | null>(null)
  const [title, setTitle] = useState('')
  const [kind, setKind] = useState('OTHER')
  const [description, setDescription] = useState('')
  const [contractNumber, setContractNumber] = useState('')
  const [contractSigned, setContractSigned] = useState('')
  const [contractUntil, setContractUntil] = useState('')
  const [tried, setTried] = useState(false)
  const isContract = kind === 'CONTRACT'

  const confirm = () => {
    if (!file || !title.trim()) {
      setTried(true)
      return
    }
    upload.mutate(
      {
        file,
        stage_id: stageId,
        title: title.trim(),
        kind,
        description: description.trim() || undefined,
        contract_number: isContract ? contractNumber.trim() || undefined : undefined,
        contract_signed_at: isContract ? contractSigned || undefined : undefined,
        contract_valid_until: isContract ? contractUntil || undefined : undefined,
      },
      {
        onSuccess: () => {
          onToast({ title: 'Документ прикреплён', colorScheme: 'success' })
          onClose()
        },
        onError: (e: any) => onToast({ title: 'Не удалось загрузить документ', subtitle: e?.message, colorScheme: 'error' }),
      },
    )
  }

  return (
    <DialogShell title="Прикрепить документ" onClose={onClose} onConfirm={confirm} confirmLabel="Загрузить" busy={upload.isPending}>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ font: 'var(--font-description-l-strong)', color: 'var(--fg-soft)' }}>Файл *</span>
        <input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        {tried && !file && <span style={{ font: 'var(--font-description-l)', color: 'var(--error-default)' }}>Выберите файл</span>}
      </label>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ font: 'var(--font-description-l-strong)', color: 'var(--fg-soft)' }}>Название *</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} style={{ ...inputStyle, borderColor: tried && !title.trim() ? 'var(--error-default)' : 'var(--border-soft)' }} />
      </label>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ font: 'var(--font-description-l-strong)', color: 'var(--fg-soft)' }}>Вид</span>
        <select value={kind} onChange={(e) => setKind(e.target.value)} style={inputStyle}>
          {UPLOAD_KINDS.map((k) => (
            <option key={k} value={k}>
              {DOC_KIND_LABEL[k]}
            </option>
          ))}
        </select>
      </label>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ font: 'var(--font-description-l-strong)', color: 'var(--fg-soft)' }}>Описание</span>
        <textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} style={textareaStyle} />
      </label>
      {isContract && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 12, background: 'var(--bg-surface2)', borderRadius: 'var(--border-radius-m)', padding: 12 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ font: 'var(--font-description-l-strong)', color: 'var(--fg-soft)' }}>Номер</span>
            <input value={contractNumber} onChange={(e) => setContractNumber(e.target.value)} style={inputStyle} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ font: 'var(--font-description-l-strong)', color: 'var(--fg-soft)' }}>Подписан</span>
            <input type="date" value={contractSigned} onChange={(e) => setContractSigned(e.target.value)} style={inputStyle} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ font: 'var(--font-description-l-strong)', color: 'var(--fg-soft)' }}>Действует до</span>
            <input type="date" value={contractUntil} onChange={(e) => setContractUntil(e.target.value)} style={inputStyle} />
          </label>
        </div>
      )}
    </DialogShell>
  )
}

// Допсоглашения: решение по ним руководитель принимает через вкладку «Просьбы» (заявка на
// переход шага 4.1 → 5), здесь - просмотр номера, дат, действий и статуса.
function AgreementsSection({ agreements }: { agreements: AgreementRead[] }) {
  if (agreements.length === 0) return <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-muted)' }}>Допсоглашений пока нет</span>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {agreements.map((a) => {
        const tone = AGREEMENT_STATUS_TONE[a.status] ?? AGREEMENT_STATUS_TONE.DRAFT
        return (
          <div key={a.id} style={{ border: '1px solid var(--border-muted)', borderRadius: 'var(--border-radius-m)', padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start' }}>
              <span style={{ font: 'var(--font-body-m-strong)', color: 'var(--fg-default)' }}>Допсоглашение №{a.id}</span>
              <Badge tone={tone} label={AGREEMENT_STATUS_LABEL[a.status] ?? a.status} />
            </div>
            <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-soft)' }}>
              Номер: {a.number ?? '—'} · Подписано: {formatDate(a.signed_at)}
            </span>
            {a.decision_comment && <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)' }}>Решение: «{a.decision_comment}»</span>}
            {a.actions.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {a.actions.map((x) => (
                  <div key={x.id} style={{ display: 'flex', gap: 12, padding: '8px 0', borderTop: '1px solid var(--border-muted)' }}>
                    <span style={{ width: 160, flex: 'none', font: 'var(--font-body-s-strong)', color: 'var(--fg-default)' }}>{AGREEMENT_ACTION_LABEL[x.type] ?? x.type}</span>
                    <span style={{ flex: 1, font: 'var(--font-body-s)', color: 'var(--fg-soft)' }}>
                      {x.license_until ? `Лицензия до ${formatDate(x.license_until)}` : ''}
                      {x.contract_valid_until ? `Договор до ${formatDate(x.contract_valid_until)}` : ''}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// Побочные указатели: доп. прохождение шагов сбоку от главного пути (Д30-Д50); переход/отмена -
// действия владельца заявки, здесь - просмотр статуса и того, кто и когда запустил.
function SidePointersSection({ pointers, stages }: { pointers: SidePointerRead[]; stages: StageRead[] }) {
  const { data: people } = usePeople(pointers.flatMap((p) => [p.started_by, p.finished_by]))
  const byName = (personId: string | null) => {
    const p = (people ?? []).find((x) => x.id === personId)
    return p ? personFullName(p as any) : '—'
  }
  const stageName = (id: number) => stages.find((s) => s.id === id)?.name ?? `Шаг #${id}`

  if (pointers.length === 0) return <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-muted)' }}>Побочных указателей пока нет</span>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {pointers.map((p) => {
        const tone = SIDE_STATUS_TONE[p.status] ?? SIDE_STATUS_TONE.ACTIVE
        return (
          <div key={p.id} style={{ border: '1px solid var(--border-muted)', borderRadius: 'var(--border-radius-m)', padding: 16, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start' }}>
              <span style={{ font: 'var(--font-body-m-strong)', color: 'var(--fg-default)' }}>{stageName(p.stage_id)}</span>
              <Badge tone={tone} label={SIDE_STATUS_LABEL[p.status] ?? p.status} />
            </div>
            <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)' }}>
              Точка входа: {stageName(p.entry_stage_id)} · запустил {byName(p.started_by)}, {formatDateTime(p.started_at)}
            </span>
            {p.finished_at && (
              <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)' }}>
                Завершил {byName(p.finished_by)}, {formatDateTime(p.finished_at)}
                {p.finish_comment ? ` · «${p.finish_comment}»` : ''}
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}

// Просьбы КАМов по этому взаимодействию (передача/закрытие/переход) - руководитель
// одобряет или отклоняет; КАМ видит их в своей карточке и может только отозвать.
function RequestsSection({
  requests,
  people,
  onToast,
}: {
  requests: RequestRead[]
  people: { id: string; last_name: string; first_name: string; patronymic: string; role: any; is_active: boolean }[]
  onToast: ReturnType<typeof useToast>
}) {
  const approve = useApproveRequest()
  const reject = useRejectRequest()
  const [rejectDlg, setRejectDlg] = useState<RequestRead | null>(null)

  const personName = (personId: string | null) => {
    const p = people.find((x) => x.id === personId)
    return p ? personFullName(p as any) : '—'
  }

  if (requests.length === 0) {
    return <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-muted)' }}>Просьб по этому взаимодействию нет</span>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {requests.map((q) => {
        const tone = REQUEST_STATUS_TONE[q.status] ?? REQUEST_STATUS_TONE.PENDING
        return (
          <div key={q.id} style={{ border: '1px solid var(--border-muted)', borderRadius: 'var(--border-radius-m)', padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
              <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ font: 'var(--font-body-s-strong)', color: 'var(--fg-default)' }}>{REQUEST_KIND_LABEL[q.kind] ?? q.kind}</span>
                <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)' }}>
                  {personName(q.requested_by)} · {formatDateTime(q.created_at)}
                </span>
              </span>
              <Badge tone={tone} label={REQUEST_STATUS_LABEL[q.status] ?? q.status} />
            </div>
            <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-soft)' }}>«{q.reason}»</span>
            {q.decision_comment && (
              <span style={{ font: 'var(--font-description-l)', color: 'var(--fg-muted)' }}>Решение: «{q.decision_comment}»</span>
            )}
            {q.status === 'PENDING' && (
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={() =>
                    approve.mutate(
                      { id: q.id, body: {} },
                      {
                        onSuccess: () => onToast({ title: 'Просьба одобрена', colorScheme: 'success' }),
                        onError: (e: any) => onToast({ title: 'Не удалось одобрить', subtitle: e?.message, colorScheme: 'error' }),
                      },
                    )
                  }
                  style={smallOutlineBtn}
                >
                  Одобрить
                </button>
                <button onClick={() => setRejectDlg(q)} style={{ ...smallOutlineBtn, color: 'var(--error-default)' }}>
                  Отклонить
                </button>
              </div>
            )}
          </div>
        )
      })}

      {rejectDlg && (
        <RejectRequestDialog
          onClose={() => setRejectDlg(null)}
          busy={reject.isPending}
          onConfirm={(comment) =>
            reject.mutate(
              { id: rejectDlg.id, body: { comment } },
              {
                onSuccess: () => {
                  onToast({ title: 'Просьба отклонена', colorScheme: 'info' })
                  setRejectDlg(null)
                },
                onError: (e: any) => onToast({ title: 'Не удалось отклонить', subtitle: e?.message, colorScheme: 'error' }),
              },
            )
          }
        />
      )}
    </div>
  )
}

function RejectRequestDialog({ onClose, onConfirm, busy }: { onClose: () => void; onConfirm: (comment: string) => void; busy: boolean }) {
  const [comment, setComment] = useState('')
  const [tried, setTried] = useState(false)
  const err = tried && !comment.trim()

  return (
    <DialogShell
      title="Отклонить просьбу"
      onClose={onClose}
      onConfirm={() => {
        if (!comment.trim()) {
          setTried(true)
          return
        }
        onConfirm(comment.trim())
      }}
      confirmLabel="Отклонить"
      busy={busy}
    >
      <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ font: 'var(--font-description-l-strong)', color: 'var(--fg-soft)' }}>Причина *</span>
        <textarea rows={3} value={comment} onChange={(e) => setComment(e.target.value)} style={{ ...textareaStyle, borderColor: err ? 'var(--error-default)' : 'var(--border-soft)' }} />
        {err && <span style={{ font: 'var(--font-description-l)', color: 'var(--error-default)' }}>Укажите причину</span>}
      </label>
    </DialogShell>
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
