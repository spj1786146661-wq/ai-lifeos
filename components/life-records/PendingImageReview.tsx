'use client'

import { useEffect, useMemo, useState } from 'react'
import { LIFE_RECORD_LABELS, type LifeRecord, type LifeRecordDraft } from '@/lib/life-records'
import { truncateDisplayName } from '@/lib/life-attachment-display'

interface Props {
  file: File
  preview: readonly LifeRecordDraft[]
  savedRecords?: readonly LifeRecord[]
  selectedIndex: number | null
  onSelect: (index: number | null) => void
  onAttachToSaved?: (recordId: string) => void
  attachingRecordId?: string | null
  onAddRecord: () => void
  onCancel: () => void
}

/** User-facing image review. Internal attachment ids never reach this UI. */
export default function PendingImageReview({
  file,
  preview,
  savedRecords = [],
  selectedIndex,
  onSelect,
  onAttachToSaved,
  attachingRecordId = null,
  onAddRecord,
  onCancel,
}: Props) {
  const url = useMemo(() => URL.createObjectURL(file), [file])
  const displayName = truncateDisplayName(file.name, 28)
  const [previewError, setPreviewError] = useState(false)
  useEffect(() => () => URL.revokeObjectURL(url), [url])

  return (
    <section className="rounded-2xl border border-cyan-300/25 bg-cyan-950/25 p-3" aria-label="待保存图片">
      <div className="flex items-start gap-3">
        <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-cyan-300/20 bg-[#071326]">
          {previewError
            ? <span className="px-2 text-center text-[10px] text-amber-200">预览失败</span>
            : <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={url}
                  alt={`待保存图片：${displayName}`}
                  className="h-full w-full object-cover"
                  onError={() => setPreviewError(true)}
                />
              </>}
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-cyan-100">待保存图片</p>
          <p className="mt-1 truncate text-xs text-slate-300" title={displayName}>
            {displayName}
          </p>
          <p className="mt-1 text-[11px] leading-5 text-muted">
            {preview.length
              ? '选择这张图片要归属的一条待调整记录；也可以关联到本次已经保存的记录。'
              : '文字记录已经保存。请明确选择要关联的一条，或为图片新建记录。'}
          </p>
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="shrink-0 rounded-lg border border-red-300/30 px-2.5 py-1.5 text-[11px] text-red-200"
        >
          取消图片
        </button>
      </div>
      {savedRecords.length > 0 && <div className="mt-3">
        <p className="text-[11px] font-semibold text-emerald-200">本次已保存记录</p>
        <div className="mt-2 flex flex-wrap gap-2" aria-label="关联到已保存记录">
          {savedRecords.map(record => <button
            key={record.id}
            type="button"
            disabled={attachingRecordId !== null}
            onClick={() => onAttachToSaved?.(record.id)}
            className="rounded-lg border border-emerald-300/35 bg-emerald-950/30 px-3 py-2 text-left text-[11px] font-semibold text-emerald-100 disabled:opacity-50"
          >
            {attachingRecordId === record.id ? '关联中…' : `关联到 ${LIFE_RECORD_LABELS[record.type]} · ${record.date}`}
          </button>)}
        </div>
      </div>}
      <div className="mt-3 flex flex-wrap gap-2" aria-label="待调整记录的图片归属">
        {preview.map((item, index) => (
          <button
            key={`${item.type}-${index}`}
            type="button"
            aria-pressed={selectedIndex === index}
            onClick={() => onSelect(selectedIndex === index ? null : index)}
            className={
              'rounded-lg border px-3 py-2 text-[11px] font-semibold '
              + (selectedIndex === index
                ? 'border-cyan-300 bg-cyan-300 text-[#071326]'
                : 'border-cyan-300/30 text-cyan-200')
            }
          >
            {index + 1}. {LIFE_RECORD_LABELS[item.type]}
          </button>
        ))}
        <button
          type="button"
          onClick={onAddRecord}
          className="rounded-lg border border-dashed border-cyan-300/35 px-3 py-2 text-[11px] text-cyan-200"
        >
          + 为图片添加记录
        </button>
      </div>
      {preview.length > 0 && selectedIndex === null && (
        <p className="mt-2 text-[11px] text-amber-200">
          尚未选择待调整记录的图片归属。可以取消图片、关联到已保存记录，或选择一条待调整记录后保存。
        </p>
      )}
    </section>
  )
}
