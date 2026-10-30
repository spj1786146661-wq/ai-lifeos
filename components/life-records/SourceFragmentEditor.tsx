'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import RecordFields from './RecordFields'
import {
  spanFromOffsets,
  splitSourceSentences,
  type LifeSourceSpan,
} from '@/lib/life-source-fragments'
import {
  LIFE_RECORD_LABELS,
  LIFE_RECORD_TYPES,
  normalizeLifeRecord,
  type LifeRecordDraft,
  type LifeRecordSourceRef,
  type LifeRecordType,
} from '@/lib/life-records'

interface Props {
  messageId: string
  text: string
  date: string
  pendingImage?: boolean
  onAdd: (draft: LifeRecordDraft) => void
  onClose: () => void
}

function baseDraft(type: LifeRecordType, date: string, sourceRef: LifeRecordSourceRef): LifeRecordDraft {
  if (type === 'exercise') return { type, date, note: '', activity: sourceRef.text.slice(0, 40), sourceRef }
  if (type === 'sleep') return { type, date, note: '', sourceRef }
  if (type === 'expense') return { type, date, note: '', currency: 'CNY', sourceRef }
  if (type === 'learning') return { type, date, note: '', subject: sourceRef.text.slice(0, 40), sourceRef }
  if (type === 'meal') return { type, date, note: '', food: sourceRef.text.slice(0, 120), sourceRef }
  return { type, date, note: sourceRef.text.slice(0, 200), sourceRef }
}

export default function SourceFragmentEditor({ messageId, text, date, pendingImage = false, onAdd, onClose }: Props) {
  const contentRef = useRef<HTMLParagraphElement | null>(null)
  const [span, setSpan] = useState<LifeSourceSpan | null>(null)
  const [type, setType] = useState<LifeRecordType>('meal')
  const [draft, setDraft] = useState<LifeRecordDraft | null>(null)
  const [error, setError] = useState('')
  const sentences = useMemo(() => splitSourceSentences(text), [text])

  useEffect(() => {
    function captureSelection() {
      const element = contentRef.current
      const selection = window.getSelection()
      if (!element || !selection || selection.rangeCount === 0 || selection.isCollapsed) return
      const range = selection.getRangeAt(0)
      if (!element.contains(range.commonAncestorContainer)) return
      const before = document.createRange()
      before.selectNodeContents(element)
      before.setEnd(range.startContainer, range.startOffset)
      const raw = range.toString()
      const trimmed = raw.trim()
      if (!trimmed) return
      const leftTrim = raw.length - raw.trimStart().length
      const next = spanFromOffsets(text, before.toString().length + leftTrim, before.toString().length + leftTrim + trimmed.length)
      if (next) {
        setSpan(next)
        setDraft(null)
        setError('')
      }
    }
    document.addEventListener('mouseup', captureSelection)
    document.addEventListener('touchend', captureSelection)
    return () => {
      document.removeEventListener('mouseup', captureSelection)
      document.removeEventListener('touchend', captureSelection)
    }
  }, [text])

  function selectSentence(start: number, end: number) {
    setSpan({ start, end, text: text.slice(start, end) })
    setDraft(null)
    setError('')
  }

  function chooseType(nextType: LifeRecordType) {
    setType(nextType)
    if (!span) return
    const sourceRef: LifeRecordSourceRef = {
      messageId,
      start: span.start,
      end: span.end,
      text: span.text,
      origin: 'user',
    }
    try {
      setDraft(normalizeLifeRecord(baseDraft(nextType, date, sourceRef), date))
      setError('')
    } catch (cause) {
      setDraft(baseDraft(nextType, date, sourceRef))
      setError(cause instanceof Error ? cause.message : '请补充必要字段')
    }
  }

  function add() {
    if (!draft || !span) return
    try {
      const normalized = normalizeLifeRecord(draft, date)
      onAdd({ ...normalized, ...(pendingImage ? { candidate: true } : {}) })
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '请检查记录字段')
    }
  }

  return <section className="space-y-4 rounded-2xl border border-cyan-300/30 bg-[#0b1830] p-4" aria-label="从原文创建记录">
    <div className="flex items-start justify-between gap-3">
      <div>
        <p className="font-mono text-[10px] tracking-[0.18em] text-cyan-300">SOURCE / EDIT IN PLACE</p>
        <h3 className="mt-1 font-bold">直接在原话上纠错</h3>
      </div>
      <button type="button" onClick={onClose} className="rounded-lg border border-cyan-300/20 px-3 py-1.5 text-xs text-slate-300">关闭</button>
    </div>
    <p ref={contentRef} className="select-text whitespace-pre-wrap break-words rounded-xl border border-cyan-300/15 bg-[#071326] p-3 text-sm leading-7 text-slate-100" aria-label="原始消息，可选中一部分文字">
      {text}
    </p>
    <p className="text-xs text-muted">桌面端可拖动选择任意文字；手机端也可直接点下方片段，避免系统选择菜单挡住按钮。{pendingImage ? ' 所选片段会与本次待发送图片关联。' : ''}</p>
    <div className="flex flex-wrap gap-2" aria-label="原文片段">
      {sentences.map(sentence => <button
        key={`${sentence.start}:${sentence.end}`}
        type="button"
        onClick={() => selectSentence(sentence.start, sentence.end)}
        className={'rounded-full border px-3 py-2 text-xs ' + (span?.start === sentence.start && span?.end === sentence.end ? 'border-cyan-300 bg-cyan-300/20 text-cyan-100' : 'border-cyan-300/15 bg-[#101e38] text-slate-300')}
      >
        {sentence.text}
      </button>)}
    </div>
    {span && <div className="space-y-3 border-t border-cyan-300/15 pt-3">
      <p className="text-sm">已选原文：<strong className="text-cyan-200">{span.text}</strong></p>
      <div className="grid grid-cols-3 gap-2" aria-label="片段分类">
        {LIFE_RECORD_TYPES.map(item => <button key={item} type="button" onClick={() => chooseType(item)} className={'rounded-xl border px-2 py-2 text-xs font-bold ' + (type === item ? 'border-cyan-300 bg-cyan-300/20 text-cyan-100' : 'border-cyan-300/15 text-slate-300')}>{LIFE_RECORD_LABELS[item]}</button>)}
      </div>
      {!draft && <p className="text-xs text-amber-200">选择分类后，可在原文基础上补充必要字段；不会自动填入未经确认的时长、金额或评分。</p>}
      {draft && <RecordFields record={draft} onChange={setDraft} />}
      {error && <p className="text-xs text-amber-200">{error}</p>}
      <button type="button" disabled={!draft} onClick={add} className="w-full rounded-xl bg-cyan-300 px-4 py-3 text-sm font-bold text-[#071326] disabled:opacity-40">加入待确认记录</button>
    </div>}
  </section>
}
