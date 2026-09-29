import type { BatchRead } from '../../../api/imports'
import { useApplyBatch, useStopBatch, useCancelBatch, importReportUrl, triggerDownload, errMessage } from '../../../api/imports'
import { RESULT_LABEL } from './constants'
import { useToast } from '../../../manager/ToastContext'

const RESULT_BG: Record<string, string> = {
  APPLIED: 'var(--success-container-default)',
  SKIPPED: 'var(--neutral-container-default)',
  FAILED: 'var(--error-container-default)',
}

export function ApplyStep({ batch, onCancelled }: { batch: BatchRead; onCancelled: () => void }) {
  const toast = useToast()
  const apply = useApplyBatch(batch.id)
  const stop = useStopBatch(batch.id)
  const cancel = useCancelBatch()

  const statuses = batch.summary.statuses ?? {}
  const errors = statuses.ERROR ?? 0
  const conflicts = statuses.CONFLICT ?? 0
  const blockedBy = errors > 0 || conflicts > 0
  const running = batch.status === 'APPLYING'
  const applied = batch.status === 'APPLIED'
  const canApply = batch.status === 'DRAFT'
  const canCancel = batch.status === 'DRAFT'
  const progress = batch.summary.progress
  const percent = progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0

  const resultsByKind = (batch.summary.results as Record<string, Record<string, number>> | undefined) ?? {}
  const resultTotals: Record<string, number> = {}
  for (const byResult of Object.values(resultsByKind)) {
    for (const [result, count] of Object.entries(byResult)) {
      if (result === 'NONE') continue
      resultTotals[result] = (resultTotals[result] ?? 0) + count
    }
  }

  const applyText = applied
    ? 'Пакет применён. Ниже — результат по строкам.'
    : running
      ? 'Применяется в фоне. Можно закрыть страницу — пакет продолжит.'
      : blockedBy
        ? 'Применить пока нельзя: ' + (errors ? `ошибок ${errors} (исправьте или исключите строки); ` : '') + (conflicts ? `конфликтов без решения ${conflicts}; ` : '')
        : `Всё готово. Версия пакета ${batch.version}: если данные изменились после предпросмотра, применение откажет и попросит перезагрузить.`

  async function doApply() {
    try {
      await apply.mutateAsync(batch.version)
    } catch (e) {
      toast({ title: 'Не удалось запустить применение', subtitle: errMessage(e), colorScheme: 'error' })
    }
  }
  async function doStop() {
    try {
      await stop.mutateAsync()
    } catch (e) {
      toast({ title: 'Не удалось остановить', subtitle: errMessage(e), colorScheme: 'error' })
    }
  }
  async function doCancel() {
    try {
      await cancel.mutateAsync(batch.id)
      toast({ title: 'Пакет удалён' })
      onCancelled()
    } catch (e) {
      toast({ title: 'Не удалось удалить пакет', subtitle: errMessage(e), colorScheme: 'error' })
    }
  }

  return (
    <section style={{ background: 'var(--bg-surface1)', border: '1px solid var(--border-muted)', borderRadius: 'var(--border-radius-l)', padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <span style={{ font: 'var(--font-body-s)', color: 'var(--fg-soft)', textWrap: 'pretty' }}>{applyText}</span>
      {running && (
        <div style={{ height: 8, borderRadius: 4, background: 'var(--neutral-container-default)', overflow: 'hidden' }}>
          <div style={{ width: `${percent}%`, height: '100%', background: 'var(--accent-default)' }} />
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {canApply && (
          <button
            onClick={doApply}
            disabled={blockedBy || apply.isPending}
            style={{ height: 40, padding: '0 20px', border: 0, borderRadius: 'var(--border-radius-buttons)', background: 'var(--accent-default)', color: '#fff', font: 'var(--font-body-s-strong)', cursor: blockedBy ? 'default' : 'pointer', opacity: blockedBy ? 0.5 : 1 }}
          >
            Применить
          </button>
        )}
        {running && (
          <button
            onClick={doStop}
            disabled={stop.isPending}
            style={{ height: 40, padding: '0 20px', border: '1px solid var(--border-soft)', borderRadius: 'var(--border-radius-buttons)', background: 'var(--bg-surface1)', color: 'var(--fg-default)', font: 'var(--font-body-s-strong)', cursor: 'pointer' }}
          >
            Остановить
          </button>
        )}
        {canCancel && (
          <button
            onClick={doCancel}
            disabled={cancel.isPending}
            style={{ height: 40, padding: '0 20px', border: '1px solid var(--border-soft)', borderRadius: 'var(--border-radius-buttons)', background: 'var(--bg-surface1)', color: 'var(--error-default)', font: 'var(--font-body-s-strong)', cursor: 'pointer' }}
          >
            Удалить пакет
          </button>
        )}
        {applied && (
          <button
            onClick={() => triggerDownload(importReportUrl(batch.id))}
            style={{ height: 40, padding: '0 20px', border: 0, borderRadius: 'var(--border-radius-buttons)', background: 'var(--accent-default)', color: '#fff', font: 'var(--font-body-s-strong)', cursor: 'pointer' }}
          >
            Скачать отчёт (xlsx)
          </button>
        )}
      </div>
      {applied && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {Object.entries(RESULT_LABEL).map(([code, label]) => (
            <span
              key={code}
              style={{ height: 28, padding: '0 10px', borderRadius: 'var(--border-radius-m)', background: RESULT_BG[code], font: 'var(--font-description-l-strong)', color: 'var(--fg-default)', display: 'flex', alignItems: 'center', gap: 6 }}
            >
              {label}
              <span style={{ color: 'var(--fg-soft)' }}>{resultTotals[code] ?? 0}</span>
            </span>
          ))}
        </div>
      )}
    </section>
  )
}
