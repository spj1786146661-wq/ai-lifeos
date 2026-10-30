'use client'

import type { LifeRecord } from '@/lib/life-records'
import { lifeRecordSummary } from '@/lib/life-records'

export default function DuplicateReviewPrompt({
  existingRecord,
  busy,
  onEditExisting,
  onConfirmNew,
  onEditCandidate,
  onCancel,
}: {
  existingRecord: LifeRecord | null
  busy: boolean
  onEditExisting: () => void
  onConfirmNew: () => void
  onEditCandidate: () => void
  onCancel: () => void
}) {
  return (
    <div className="mt-3 rounded-xl border border-amber-300/30 bg-amber-950/30 p-3">
      <p className="text-sm font-semibold text-amber-100">识别成功，但发现已有相似记录。</p>
      {existingRecord ? (
        <p className="mt-1 break-words text-xs text-amber-100/80">
          已有：{existingRecord.date} · {lifeRecordSummary(existingRecord)}
        </p>
      ) : (
        <p className="mt-1 text-xs text-amber-100/80">原记录可能已被修改或删除，请刷新后重新确认。</p>
      )}
      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <button
          type="button"
          disabled={!existingRecord || busy}
          onClick={onEditExisting}
          className="min-h-11 rounded-lg border border-cyan-300/35 px-3 py-2 text-xs font-semibold text-cyan-200 disabled:opacity-40"
        >
          查看 / 修改已有记录
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onConfirmNew}
          className="min-h-11 rounded-lg bg-amber-300 px-3 py-2 text-xs font-bold text-[#261900] disabled:opacity-40"
        >
          确认这是新记录，仍然添加
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onEditCandidate}
          className="min-h-11 rounded-lg border border-amber-200/25 px-3 py-2 text-xs text-amber-100 disabled:opacity-40"
        >
          修改本次识别
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onCancel}
          className="min-h-11 rounded-lg px-3 py-2 text-xs text-slate-300 disabled:opacity-40"
        >
          取消
        </button>
      </div>
    </div>
  )
}
