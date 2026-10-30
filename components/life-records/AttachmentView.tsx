'use client'

import { useEffect, useState } from 'react'
import { getAttachmentStorage } from '@/lib/life-record-store'
import { objectUrlForAttachment, revokeObjectUrl } from '@/lib/life-attachments'
import type { LifeRecordAttachmentRef } from '@/lib/life-records'

export default function AttachmentView({ attachment, compact = false }: { attachment: LifeRecordAttachmentRef; compact?: boolean }) {
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    let created: string | null = null
    void getAttachmentStorage().load(attachment.id).then(record => {
      if (!active) return
      if (!record) { setError('图片附件不存在'); return }
      created = objectUrlForAttachment(record)
      setUrl(created)
    }).catch(cause => {
      if (active) setError(cause instanceof Error ? cause.message : '图片加载失败')
    })
    return () => {
      active = false
      revokeObjectUrl(created)
    }
  }, [attachment.id])

  if (error) return <span className="text-[11px] text-amber-200">{error}</span>
  if (!url) return <span className="text-[11px] text-muted">图片加载中…</span>
  return <a href={url} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-xl border border-cyan-300/20">
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img src={url} alt={attachment.name || '生活记录图片'} className={compact ? 'h-16 w-16 object-cover' : 'max-h-64 w-full object-contain'} />
  </a>
}
