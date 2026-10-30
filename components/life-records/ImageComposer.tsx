'use client'

import { useEffect, useMemo, useState } from 'react'
import { attachmentTypeFromName, validateAttachmentFile } from '@/lib/life-attachments'
import { truncateDisplayName } from '@/lib/life-attachment-display'

interface Props {
  file: File | null
  onChange: (file: File | null) => void
  disabled?: boolean
}

export default function ImageComposer({ file, onChange, disabled = false }: Props) {
  const [error, setError] = useState('')
  const preview = useMemo(() => file ? URL.createObjectURL(file) : null, [file])
  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview)
  }, [preview])

  function choose(next: File | undefined) {
    setError('')
    if (!next) return
    try {
      const mimeType = attachmentTypeFromName(next.name)
      if (!mimeType) {
        validateAttachmentFile(next)
        return
      }
      // Some Android pickers provide an empty MIME type even for a valid image.
      const normalized = next.type === mimeType ? next : new File([next], next.name, { type: mimeType, lastModified: next.lastModified })
      validateAttachmentFile(normalized)
      onChange(normalized)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '图片无效')
      onChange(null)
    }
  }

  return <div className="space-y-2">
    <label className={'inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border px-3 text-xs font-semibold ' + (disabled ? 'cursor-not-allowed border-cyan-300/10 text-slate-600' : 'border-cyan-300/25 bg-[#101e38] text-cyan-100 hover:border-cyan-300/60')}>
      <span aria-hidden="true">▧</span>
      图片
      <input
        type="file"
        accept="image/jpeg,image/png,image/webp"
        disabled={disabled}
        className="sr-only"
        onChange={event => choose(event.target.files?.[0])}
      />
    </label>
    {file && preview && <div className="flex items-center gap-3 rounded-xl border border-cyan-300/20 bg-[#0b1830] p-2">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={preview} alt="待发送图片预览" className="h-16 w-16 rounded-lg object-cover" />
      <div className="min-w-0 flex-1 text-xs"><p className="truncate text-slate-200" title={truncateDisplayName(file.name)}>{truncateDisplayName(file.name)}</p><p className="mt-1 text-muted">{Math.ceil(file.size / 1024)} KB</p></div>
      <button type="button" onClick={() => onChange(null)} className="rounded-lg border border-red-300/30 px-2 py-1 text-xs text-red-200">移除</button>
    </div>}
    {error && <p className="text-xs text-amber-200">{error}</p>}
  </div>
}
