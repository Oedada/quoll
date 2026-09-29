// Воркфлоу.dc.html, admin=true: просмотр как у руководителя (WorkflowsPage.tsx) плюс полный CRUD
// маршрутов/шагов/переходов, публикация/архивация. Пороги застоя для заявки — тот же блок, что и
// у руководителя (логика скопирована, отдельного экрана под это в дизайне нет).
import { useEffect, useMemo, useState } from 'react'
import { useToast } from '../../manager/ToastContext'
import { useWorkflows } from '../../api/workflows'
import { useStagesByWorkflow, type StageRead } from '../../api/stages'
import { useAvailableTransitions, useInteractions, useInteraction, type InteractionRead } from '../../api/interactions'
import { useUpdateInteractionSettings } from '../../api/interaction-settings'
import {
  useCreateWorkflow,
  useUpdateWorkflow,
  useDeleteWorkflow,
  usePublishWorkflow,
  useChangeStartStage,
  useCreateStage,
  useUpdateStage,
  useDeleteStage,
  useArchiveStage,
  useCreateTransition,
  useUpdateTransition,
  useDeleteTransition,
} from '../../api/workflows-admin'

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

const fieldInput: React.CSSProperties = {
  height: 40,
  padding: '0 12px',
  border: '1px solid var(--border-soft)',
  borderRadius: 'var(--border-radius-inputs)',
  background: 'var(--bg-surface1)',
  font: 'var(--font-body-s)',
  color: 'var(--fg-default)',
  outline: 0,
}

const headerBtn: React.CSSProperties = {
  height: 34,
  padding: '0 14px',
  border: '1px solid var(--border-soft)',
  borderRadius: 'var(--border-radius-buttons)',
  background: 'var(--bg-surface1)',
  color: 'var(--fg-default)',
  font: 'var(--font-body-s-strong)',
  cursor: 'pointer',
}

const primaryBtn: React.CSSProperties = { ...headerBtn, border: '1px solid var(--accent-default)', background: 'var(--accent-default)', color: '#fff' }
const dangerText: React.CSSProperties = { ...headerBtn, color: 'var(--error-default)' }

const smallActionBtn: React.CSSProperties = {
  height: 30,
  padding: '0 12px',
  border: '1px solid var(--border-soft)',
  borderRadius: 'var(--border-radius-buttons)',
  background: 'var(--bg-surface1)',
  font: 'var(--font-description-l-strong)',
  cursor: 'pointer',
}

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

type DialogKind = 'wfNew' | 'wfEdit' | 'wfPublish' | 'wfDel' | 'stNew' | 'stEdit' | 'archive' | 'stDel' | 'trNew' | 'trEdit' | 'trDel' | 'start'

interface DialogState {
  kind: DialogKind
  id?: number
}

type DV = Record<string, string | boolean>

type FieldSpec =
  | { kind: 'text'; label: string; key: string; type?: string; span?: string }
  | { kind: 'select'; label: string; key: string; options: { v: string; l: string }[]; span?: string }
  | { kind: 'bool'; label: string; key: string }

const DIALOG_TITLES: Record<DialogKind, string> = {
  wfNew: 'Создать воркфлоу',
  wfEdit: 'Изменить воркфлоу',
  wfPublish: 'Опубликовать воркфлоу',
  wfDel: 'Удалить воркфлоу',
  stNew: 'Создать шаг',
  stEdit: 'Изменить шаг',
  archive: 'Архивировать шаг',
  stDel: 'Удалить шаг',
  trNew: 'Создать переход',
  trEdit: 'Изменить переход',
  trDel: 'Удалить переход',
  start: 'Начальный шаг',
}

const DIALOG_CONFIRM_LABEL: Partial<Record<DialogKind, string>> = {
  wfNew: 'Создать',
  stNew: 'Создать',
  trNew: 'Создать',
  wfPublish: 'Опубликовать',
  wfDel: 'Удалить',
  stDel: 'Удалить',
  trDel: 'Удалить',
  archive: 'Архивировать',
}

function isDangerKind(kind: DialogKind): boolean {
  return kind === 'wfDel' || kind === 'stDel' || kind === 'trDel' || kind === 'archive'
}

export default function WorkflowsAdminPage() {
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

  const [dlg, setDlg] = useState<DialogState | null>(null)
  const [dv, setDv] = useState<DV>({})
  const [err, setErr] = useState('')

  const createWf = useCreateWorkflow()
  const updateWf = useUpdateWorkflow()
  const deleteWf = useDeleteWorkflow()
  const publishWf = usePublishWorkflow()
  const changeStart = useChangeStartStage()
  const createStage = useCreateStage()
  const updateStage = useUpdateStage()
  const deleteStage = useDeleteStage()
  const archiveStage = useArchiveStage()
  const createTransition = useCreateTransition()
  const updateTransition = useUpdateTransition()
  const deleteTransition = useDeleteTransition()

  const pending =
    createWf.isPending ||
    updateWf.isPending ||
    deleteWf.isPending ||
    publishWf.isPending ||
    changeStart.isPending ||
    createStage.isPending ||
    updateStage.isPending ||
    deleteStage.isPending ||
    archiveStage.isPending ||
    createTransition.isPending ||
    updateTransition.isPending ||
    deleteTransition.isPending

  const closeDlg = () => {
    setDlg(null)
    setDv({})
    setErr('')
  }

  const openDlg = (kind: DialogKind, id?: number) => {
    let initial: DV = {}
    if (kind === 'wfNew') initial = { name: '', description: '', warn: '60, 30' }
    else if (kind === 'wfEdit' && wf) initial = { name: wf.name, description: wf.description ?? '', warn: wf.warn_days.join(', ') }
    else if (kind === 'stNew') initial = { name: '', description: '', position: '', terminal: false, branch: false }
    else if (kind === 'stEdit' && cur) initial = { name: cur.name, description: cur.description ?? '', position: '', stall: cur.stall_days != null ? String(cur.stall_days) : '', passive: cur.passive_after_days != null ? String(cur.passive_after_days) : '' }
    else if (kind === 'trNew') initial = { name: '', to: sortedStages[0] ? String(sortedStages[0].id) : '', approval: false, back: false, irrev: false, docs: '' }
    else if (kind === 'trEdit' && id != null) {
      const t = out.find((x) => x.id === id)
      initial = { name: t?.name ?? '', active: t?.is_active !== false, comments: t?.comments ?? '', approval: !!t?.requires_approval, back: !!t?.is_backward, irrev: !!t?.is_irreversible, docs: t?.required_document_kinds.join(', ') ?? '' }
    } else if (kind === 'archive' && cur) {
      const fallback = sortedStages.find((s) => s.id !== cur.id && !s.is_terminal) ?? sortedStages.find((s) => s.id !== cur.id)
      initial = { relocate: fallback ? String(fallback.id) : '' }
    } else if (kind === 'start') initial = { stage: sortedStages[0] ? String(sortedStages[0].id) : '' }

    setDlg({ kind, id })
    setDv(initial)
    setErr('')
  }

  const stageOptions = (excludeId?: number) => sortedStages.filter((s) => s.id !== excludeId).map((s) => ({ v: String(s.id), l: s.name }))

  const fieldsFor = (kind: DialogKind): FieldSpec[] => {
    const B = (label: string, key: string): FieldSpec => ({ kind: 'bool', label, key })
    switch (kind) {
      case 'wfNew':
      case 'wfEdit':
        return [
          { kind: 'text', label: 'Название', key: 'name', span: '1 / -1' },
          { kind: 'text', label: 'Описание', key: 'description', span: '1 / -1' },
          { kind: 'text', label: 'Предупреждать за, дней (1–5 значений через запятую)', key: 'warn', span: '1 / -1' },
        ]
      case 'stNew':
        return [
          { kind: 'text', label: 'Название', key: 'name', span: '1 / -1' },
          { kind: 'text', label: 'Описание', key: 'description', span: '1 / -1' },
          { kind: 'text', label: 'Позиция', key: 'position', type: 'number' },
          B('Конечный', 'terminal'),
          B('Шаг ветки', 'branch'),
        ]
      case 'stEdit':
        return [
          { kind: 'text', label: 'Название', key: 'name', span: '1 / -1' },
          { kind: 'text', label: 'Описание', key: 'description', span: '1 / -1' },
          { kind: 'text', label: 'Позиция', key: 'position', type: 'number' },
          { kind: 'text', label: 'Дней до зависания', key: 'stall', type: 'number' },
          { kind: 'text', label: 'Дней до перевода в пассив', key: 'passive', type: 'number' },
        ]
      case 'trNew':
        return [
          { kind: 'text', label: 'Название', key: 'name' },
          { kind: 'select', label: 'Куда', key: 'to', options: stageOptions() },
          B('Требует согласования', 'approval'),
          B('Назад', 'back'),
          B('Необратимо', 'irrev'),
          { kind: 'text', label: 'Обязательные виды документов (через запятую)', key: 'docs', span: '1 / -1' },
        ]
      case 'trEdit':
        return [
          { kind: 'text', label: 'Название', key: 'name' },
          B('Активен', 'active'),
          { kind: 'text', label: 'Комментарий', key: 'comments', span: '1 / -1' },
          B('Требует согласования', 'approval'),
          B('Назад', 'back'),
          B('Необратимо', 'irrev'),
          { kind: 'text', label: 'Обязательные виды документов (через запятую)', key: 'docs', span: '1 / -1' },
        ]
      case 'archive':
        return [{ kind: 'select', label: 'Куда перенести взаимодействия с этого шага', key: 'relocate', options: stageOptions(cur?.id), span: '1 / -1' }]
      case 'start':
        return [{ kind: 'select', label: 'Новый начальный шаг', key: 'stage', options: stageOptions(), span: '1 / -1' }]
      default:
        return []
    }
  }

  const dialogText = (kind: DialogKind): string => {
    if (kind === 'wfPublish') return 'После публикации маршрут доступен для новых взаимодействий, шаги и переходы нельзя удалять, только архивировать и отключать.'
    if (kind === 'wfDel') return wf?.is_published ? 'Опубликованный маршрут удалить нельзя.' : 'Черновик маршрута будет удалён.'
    if (kind === 'stDel') return 'Шаг черновика будет удалён.'
    if (kind === 'archive') return 'Шаг опубликованного маршрута не удаляют, а архивируют. Взаимодействия на нём переедут.'
    if (kind === 'trDel') return 'Переход будет удалён.'
    return ''
  }

  const confirmDlg = () => {
    if (!dlg) return
    const kind = dlg.kind
    const nm = () => String(dv.name ?? '').trim()

    if (['wfNew', 'wfEdit', 'stNew', 'stEdit', 'trNew'].includes(kind) && !nm()) {
      setErr('Укажите название')
      return
    }

    const parseWarn = (): number[] | null => {
      const a = String(dv.warn ?? '')
        .split(',')
        .map((x) => Number(x.trim()))
      if (!(a.length >= 1 && a.length <= 5 && a.every((n) => Number.isInteger(n) && n >= 1 && n <= 365))) return null
      return a
    }

    const onOk = (title: string, subtitle?: string) => {
      closeDlg()
      toast({ title, subtitle, colorScheme: 'success' })
    }
    const onErr = (e: unknown) => setErr(e instanceof Error ? e.message : 'Не удалось выполнить действие')

    if (kind === 'wfNew') {
      const warn = parseWarn()
      if (!warn) return setErr('От 1 до 5 значений, 1–365 дней')
      createWf.mutate(
        { name: nm(), description: String(dv.description ?? '').trim() || null, warn_days: warn },
        { onSuccess: (row) => { setWfId(row.id); onOk('Воркфлоу создан', nm()) }, onError: onErr },
      )
      return
    }
    if (kind === 'wfEdit' && wf) {
      const warn = parseWarn()
      if (!warn) return setErr('От 1 до 5 значений, 1–365 дней')
      updateWf.mutate(
        { id: wf.id, body: { name: nm(), description: String(dv.description ?? '').trim() || null, warn_days: warn } },
        { onSuccess: () => onOk('Воркфлоу сохранён', nm()), onError: onErr },
      )
      return
    }
    if (kind === 'wfPublish' && wf) {
      publishWf.mutate(wf.id, { onSuccess: () => onOk('Воркфлоу опубликован'), onError: onErr })
      return
    }
    if (kind === 'wfDel' && wf) {
      deleteWf.mutate(wf.id, { onSuccess: () => { setWfId(null); onOk('Воркфлоу удалён') }, onError: onErr })
      return
    }
    if (kind === 'stNew' && wf) {
      createStage.mutate(
        {
          name: nm(),
          description: String(dv.description ?? '').trim() || null,
          position: dv.position === '' || dv.position == null ? undefined : Number(dv.position),
          workflow_id: wf.id,
          is_terminal: !!dv.terminal,
          is_branch_stage: !!dv.branch,
        },
        { onSuccess: (row) => { setStageId(row.id); onOk('Шаг создан', nm()) }, onError: onErr },
      )
      return
    }
    if (kind === 'stEdit' && cur) {
      updateStage.mutate(
        {
          id: cur.id,
          body: {
            name: nm(),
            description: String(dv.description ?? '').trim() || null,
            position: dv.position === '' || dv.position == null ? undefined : Number(dv.position),
            stall_days: dv.stall === '' || dv.stall == null ? null : Number(dv.stall),
            passive_after_days: dv.passive === '' || dv.passive == null ? null : Number(dv.passive),
          },
        },
        { onSuccess: () => onOk('Шаг сохранён', nm()), onError: onErr },
      )
      return
    }
    if (kind === 'archive' && cur) {
      archiveStage.mutate(
        { id: cur.id, relocateToStageId: dv.relocate ? Number(dv.relocate) : null },
        {
          onSuccess: () => {
            const label = sortedStages.find((s) => String(s.id) === String(dv.relocate))?.name ?? ''
            setStageId(null)
            onOk('Шаг в архиве', label ? `Заявки перенесены на «${label}»` : undefined)
          },
          onError: onErr,
        },
      )
      return
    }
    if (kind === 'stDel' && cur && wf) {
      deleteStage.mutate({ id: cur.id, workflowId: wf.id }, { onSuccess: () => { setStageId(null); onOk('Шаг удалён') }, onError: onErr })
      return
    }
    if (kind === 'trNew' && wf && cur) {
      const docs = String(dv.docs ?? '')
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean)
      createTransition.mutate(
        {
          name: nm(),
          workflow_id: wf.id,
          from_stage_id: cur.id,
          to_stage_id: Number(dv.to),
          requires_approval: !!dv.approval,
          is_backward: !!dv.back,
          is_irreversible: !!dv.irrev,
          required_document_kinds: docs,
        },
        { onSuccess: () => onOk('Переход создан', nm()), onError: onErr },
      )
      return
    }
    if (kind === 'trEdit' && dlg.id != null) {
      const docs = String(dv.docs ?? '')
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean)
      updateTransition.mutate(
        {
          id: dlg.id,
          body: {
            name: nm() || null,
            is_active: !!dv.active,
            comments: String(dv.comments ?? '').trim() || null,
            requires_approval: !!dv.approval,
            is_backward: !!dv.back,
            is_irreversible: !!dv.irrev,
            required_document_kinds: docs,
          },
        },
        { onSuccess: () => onOk('Переход сохранён'), onError: onErr },
      )
      return
    }
    if (kind === 'trDel' && dlg.id != null && wf) {
      deleteTransition.mutate({ id: dlg.id, workflowId: wf.id }, { onSuccess: () => onOk('Переход удалён'), onError: onErr })
      return
    }
    if (kind === 'start' && wf && dv.stage) {
      changeStart.mutate(
        { workflowId: wf.id, stageId: Number(dv.stage) },
        { onSuccess: () => onOk('Начальный шаг изменён', stageName(Number(dv.stage))), onError: onErr },
      )
      return
    }
  }

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
        <span style={{ flex: 1 }} />
        <button onClick={() => openDlg('wfNew')} style={primaryBtn}>
          Создать
        </button>
        {wf && (
          <button onClick={() => openDlg('wfEdit')} style={headerBtn}>
            Изменить
          </button>
        )}
        {wf && sortedStages.length > 0 && (
          <button onClick={() => openDlg('start')} style={headerBtn}>
            Начальный шаг
          </button>
        )}
        {wf && !wf.is_published && (
          <button onClick={() => openDlg('wfPublish')} style={headerBtn}>
            Опубликовать
          </button>
        )}
        {wf && (
          <button onClick={() => openDlg('wfDel')} style={dangerText}>
            Удалить
          </button>
        )}
      </div>

      {wfLoading && <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-muted)' }}>Загрузка…</span>}
      {!wfLoading && (workflows ?? []).length === 0 && (
        <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-muted)' }}>Маршрутов ещё нет — создайте первый</span>
      )}

      {!wfLoading && wf && (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,4fr) minmax(0,8fr)', gap: 16, alignItems: 'start' }}>
          <section style={{ ...card, padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ font: 'var(--font-heading-h4)', color: 'var(--fg-default)' }}>Шаги</span>
              <button onClick={() => openDlg('stNew')} style={{ border: 0, background: 'transparent', font: 'var(--font-body-s-strong)', color: 'var(--accent-default)', cursor: 'pointer' }}>
                ＋ Шаг
              </button>
            </div>
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
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
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
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button onClick={() => openDlg('stEdit')} style={smallActionBtn}>
                      Изменить
                    </button>
                    {wf.is_published ? (
                      <button onClick={() => openDlg('archive')} style={{ ...smallActionBtn, color: 'var(--fg-default)' }}>
                        Архивировать
                      </button>
                    ) : (
                      <button onClick={() => openDlg('stDel')} style={{ ...smallActionBtn, color: 'var(--error-default)' }}>
                        Удалить
                      </button>
                    )}
                  </div>
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
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ font: 'var(--font-body-s-strong)', color: 'var(--fg-default)' }}>Переходы из шага</span>
                    <button onClick={() => openDlg('trNew')} style={{ border: 0, background: 'transparent', font: 'var(--font-body-s-strong)', color: 'var(--accent-default)', cursor: 'pointer' }}>
                      ＋ Переход
                    </button>
                  </div>
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
                      <span style={{ flex: 1 }} />
                      <button
                        onClick={() => openDlg('trEdit', t.id)}
                        style={{ height: 26, padding: '0 8px', border: 0, borderRadius: 'var(--border-radius-m)', background: 'transparent', font: 'var(--font-description-l-strong)', color: 'var(--fg-soft)', cursor: 'pointer' }}
                      >
                        Изменить
                      </button>
                      <button
                        onClick={() => { setDlg({ kind: 'trDel', id: t.id }); setDv({}); setErr('') }}
                        style={{ height: 26, padding: '0 8px', border: 0, borderRadius: 'var(--border-radius-m)', background: 'transparent', font: 'var(--font-description-l-strong)', color: 'var(--error-default)', cursor: 'pointer' }}
                      >
                        Удалить
                      </button>
                    </div>
                  ))}
                </div>
              </>
            )}
          </section>
        </div>
      )}

      {wf && <StallThresholds toast={toast} />}

      {dlg && (
        <Dialog
          title={DIALOG_TITLES[dlg.kind]}
          text={dialogText(dlg.kind)}
          confirmLabel={DIALOG_CONFIRM_LABEL[dlg.kind] ?? 'Сохранить'}
          danger={isDangerKind(dlg.kind)}
          fields={fieldsFor(dlg.kind)}
          dv={dv}
          setDv={setDv}
          err={err}
          onClose={closeDlg}
          onConfirm={confirmDlg}
          pending={pending}
        />
      )}
    </div>
  )
}

function Dialog({
  title,
  text,
  confirmLabel,
  danger,
  fields,
  dv,
  setDv,
  err,
  onClose,
  onConfirm,
  pending,
}: {
  title: string
  text: string
  confirmLabel: string
  danger: boolean
  fields: FieldSpec[]
  dv: DV
  setDv: (v: DV | ((z: DV) => DV)) => void
  err: string
  onClose: () => void
  onConfirm: () => void
  pending: boolean
}) {
  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 80, background: 'rgba(14,17,23,.4)' }} />
      <div
        style={{
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
        }}
      >
        <span style={{ font: 'var(--font-heading-h3)', color: 'var(--fg-default)' }}>{title}</span>
        {text && <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-soft)', textWrap: 'pretty' as any }}>{text}</span>}
        {fields.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {fields.map((f) => (
              <label key={f.key} style={{ display: 'flex', flexDirection: 'column', gap: 6, gridColumn: f.kind === 'bool' ? 'auto' : f.span ?? 'auto' }}>
                <span style={{ font: 'var(--font-description-l-strong)', color: 'var(--fg-soft)' }}>{f.label}</span>
                {f.kind === 'select' && (
                  <select value={String(dv[f.key] ?? '')} onChange={(e) => setDv((z) => ({ ...z, [f.key]: e.target.value }))} style={fieldInput}>
                    {f.options.map((o) => (
                      <option key={o.v} value={o.v}>
                        {o.l}
                      </option>
                    ))}
                  </select>
                )}
                {f.kind === 'text' && (
                  <input
                    type={f.type ?? 'text'}
                    value={String(dv[f.key] ?? '')}
                    onChange={(e) => setDv((z) => ({ ...z, [f.key]: e.target.value }))}
                    style={fieldInput}
                  />
                )}
                {f.kind === 'bool' && (
                  <button
                    type="button"
                    onClick={() => setDv((z) => ({ ...z, [f.key]: !z[f.key] }))}
                    style={{ height: 40, padding: '0 12px', border: '1px solid var(--border-soft)', borderRadius: 'var(--border-radius-inputs)', background: 'var(--bg-surface1)', display: 'flex', alignItems: 'center', gap: 8, font: 'var(--font-body-s)', color: 'var(--fg-default)', cursor: 'pointer' }}
                  >
                    <span
                      style={{
                        width: 14,
                        height: 14,
                        borderRadius: 4,
                        border: `2px solid ${dv[f.key] ? 'var(--accent-default)' : 'var(--neutral-muted)'}`,
                        background: dv[f.key] ? 'var(--accent-default)' : 'transparent',
                      }}
                    />
                    {dv[f.key] ? 'Да' : 'Нет'}
                  </button>
                )}
              </label>
            ))}
          </div>
        )}
        {err && <span style={{ font: 'var(--font-description-l)', color: 'var(--error-default)' }}>{err}</span>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button onClick={onClose} style={{ height: 40, padding: '0 20px', border: '1px solid var(--border-soft)', borderRadius: 'var(--border-radius-buttons)', background: 'var(--bg-surface1)', color: 'var(--fg-default)', font: 'var(--font-body-s-strong)', cursor: 'pointer' }}>
            Отмена
          </button>
          <button
            onClick={onConfirm}
            disabled={pending}
            style={{
              height: 40,
              padding: '0 20px',
              border: 0,
              borderRadius: 'var(--border-radius-buttons)',
              background: danger ? 'var(--error-default)' : 'var(--accent-default)',
              color: '#fff',
              font: 'var(--font-body-s-strong)',
              cursor: 'pointer',
              opacity: pending ? 0.6 : 1,
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </>
  )
}

// Пороги застоя для заявки — тот же блок и та же логика, что и у руководителя
// (frontend/app/src/supervisor/pages/WorkflowsPage.tsx), отдельного экрана под это в дизайне нет.
type InteractionWithOverrides = InteractionRead & { stall_overrides: Record<string, number> | null }

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
  if (items.length === 0) return null

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
