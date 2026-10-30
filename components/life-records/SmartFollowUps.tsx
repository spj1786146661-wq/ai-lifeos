'use client'

import { useState } from 'react'
import {
  LIFE_RECORD_LABELS,
  type LifeRecordType,
} from '@/lib/life-records'
import {
  shouldShowSmartFollowUpPanel,
  smartFollowUpZeroQuestionMessage,
  type LifeFollowUpQuestion,
} from '@/lib/life-follow-up'

export interface SmartFollowUpItem {
  question: LifeFollowUpQuestion
  recordId: string
  recordType: LifeRecordType
  recordSummary: string
  round: 1 | 2 | 3
}

interface Props {
  items: readonly SmartFollowUpItem[]
  busy: boolean
  currentRound: 1 | 2 | 3
  canContinue: boolean
  ended: boolean
  hasSession: boolean
  continueBusy: boolean
  historyCounts: { answered: number; skipped: number }
  notice: string
  error: string
  onSubmit: (item: SmartFollowUpItem, answer: string) => Promise<boolean>
  onSkip: (item: SmartFollowUpItem) => void
  onSkipAll: () => void
  onContinue: () => void
  onEnd: () => void
}

function itemKey(item: SmartFollowUpItem) {
  return `${item.recordId}:${item.question.questionId}`
}

export default function SmartFollowUps({
  items,
  busy,
  currentRound,
  canContinue,
  ended,
  hasSession,
  continueBusy,
  historyCounts,
  notice,
  error,
  onSubmit,
  onSkip,
  onSkipAll,
  onContinue,
  onEnd,
}: Props) {
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [submittingKey, setSubmittingKey] = useState<string | null>(null)
  const zeroQuestionMessage = smartFollowUpZeroQuestionMessage({
    ended,
    currentRound,
    hasNotice: Boolean(notice),
    hasError: Boolean(error),
  })

  if (!shouldShowSmartFollowUpPanel({
    hasSession,
    itemCount: items.length,
    canContinue,
    ended,
    hasNotice: Boolean(notice),
    hasError: Boolean(error),
  })) return null

  async function submit(item: SmartFollowUpItem) {
    const key = itemKey(item)
    const answer = answers[key]?.trim() ?? ''
    if (!answer || busy || submittingKey) return
    setSubmittingKey(key)
    try {
      const succeeded = await onSubmit(item, answer)
      if (succeeded) {
        setAnswers(current => {
          const next = { ...current }
          delete next[key]
          return next
        })
      }
    } finally {
      setSubmittingKey(null)
    }
  }

  return <section className="smart-followups rounded-2xl border border-violet-300/25 bg-[#18182f]/80 p-4" aria-labelledby="smart-followups-title">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p className="font-mono text-[10px] tracking-[0.18em] text-violet-300">SMART FOLLOW-UP</p>
        <h2 id="smart-followups-title" className="mt-1 font-bold text-slate-100">智能补充</h2>
        <p className="mt-1 text-xs leading-5 text-muted">回答只会补充对应原记录，不会新建副本。最多三轮，每轮最多三个问题；可直接忽略。</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {items.length > 0 && <button type="button" disabled={busy} onClick={onSkipAll} className="rounded-lg border border-slate-400/25 px-3 py-1.5 text-xs text-slate-300 disabled:opacity-40">跳过本轮</button>}
        {!ended && <button type="button" disabled={busy} onClick={onEnd} className="rounded-lg border border-slate-400/25 px-3 py-1.5 text-xs text-slate-300 disabled:opacity-40">结束补充</button>}
      </div>
    </div>
    <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-muted">
      <span className="rounded-full bg-white/5 px-2 py-1">当前第 {currentRound}/3 轮</span>
      <span className="rounded-full bg-white/5 px-2 py-1">已回答 {historyCounts.answered}</span>
      <span className="rounded-full bg-white/5 px-2 py-1">已跳过 {historyCounts.skipped}</span>
    </div>
    {notice && <p role="status" className="mt-3 rounded-xl border border-violet-300/20 bg-violet-950/30 px-3 py-2 text-xs leading-5 text-violet-100">{notice}</p>}
    {error && <p role="alert" className="mt-3 rounded-xl border border-red-400/30 bg-red-950/50 px-3 py-2 text-xs leading-5 text-red-100">{error}</p>}
    <div className="mt-3 space-y-3">
      {items.slice(0, 3).map(item => {
        const key = itemKey(item)
        const submitting = submittingKey === key
        return <div key={key} className="rounded-xl border border-violet-300/15 bg-[#101a31] p-3">
          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            <span className="rounded-full border border-violet-300/25 px-2 py-0.5 font-semibold text-violet-200">
              {item.question.origin === 'ai' ? 'AI 推荐' : '规则推荐 · 未调用 AI'}
            </span>
            <span className="text-muted">{LIFE_RECORD_LABELS[item.recordType]} · {item.recordSummary}</span>
            <span className="font-mono text-muted">第 {item.round}/3 轮 · 优先级 {item.question.priority}</span>
          </div>
          <p className="mt-2 break-words text-sm font-semibold text-slate-100">{item.question.question}</p>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            <label className="sr-only" htmlFor={`followup-${key}`}>回答智能补充问题</label>
            <input
              id={`followup-${key}`}
              value={answers[key] ?? ''}
              onChange={event => setAnswers(current => ({ ...current, [key]: event.target.value }))}
              onKeyDown={event => {
                if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault()
                  void submit(item)
                }
              }}
              disabled={busy || submitting}
              maxLength={120}
              placeholder="补充你明确知道的信息"
              className="min-w-0 flex-1 rounded-xl border border-violet-300/20 bg-[#0b1529] px-3 py-2.5 text-base text-slate-100 outline-none placeholder:text-slate-500 focus:border-violet-300 sm:text-sm"
            />
            <div className="flex gap-2">
              <button type="button" disabled={busy || submitting || !answers[key]?.trim()} onClick={() => void submit(item)} className="flex-1 rounded-xl bg-violet-300 px-4 py-2.5 text-sm font-bold text-[#111326] disabled:opacity-40 sm:flex-none">
                {submitting ? '保存中…' : '补充'}
              </button>
              <button type="button" disabled={busy || submitting} onClick={() => onSkip(item)} className="rounded-xl border border-slate-400/25 px-3 py-2.5 text-xs text-slate-300 disabled:opacity-40">跳过</button>
            </div>
          </div>
        </div>
      })}
      {items.length === 0 && zeroQuestionMessage && <div className="rounded-xl border border-violet-300/15 bg-[#101a31] p-4 text-sm leading-6 text-slate-300">
        {zeroQuestionMessage}
      </div>}
      {canContinue && <button
        type="button"
        disabled={busy || continueBusy}
        onClick={onContinue}
        className="w-full rounded-xl border border-violet-300/35 bg-violet-300/10 px-4 py-3 text-sm font-bold text-violet-100 disabled:opacity-40"
      >
        {continueBusy ? `正在评估第 ${currentRound + 1} 轮…` : `继续第 ${currentRound + 1} 轮智能评估`}
      </button>}
    </div>
  </section>
}
