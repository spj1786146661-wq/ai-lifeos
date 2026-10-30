'use client'

import { useMemo, useState } from 'react'
import {
  bulkDeleteOutcomeMessage,
  bulkDeleteSnapshot,
  type BulkDeleteOutcome,
  type BulkDeleteSnapshot,
} from '@/lib/life-record-bulk-delete'
import {
  LIFE_RECORD_LABELS,
  lifeRecordSummary,
  type LifeRecord,
  type LifeRecordType,
} from '@/lib/life-records'

interface Props {
  date: string
  dayRecords: readonly LifeRecord[]
  allRecords: readonly LifeRecord[]
  busy: boolean
  onDeleteSnapshot: (snapshot: BulkDeleteSnapshot) => Promise<BulkDeleteOutcome | void>
  /** Home history can expose a compact launcher and adjust the day scope. */
  compactLauncher?: boolean
  /** Open the full manager immediately when the page-level button mounts it. */
  initialManaging?: boolean
  onDateChange?: (date: string) => void
  onClose?: () => void
}

type PendingDelete =
  | { kind: 'selected'; snapshot: BulkDeleteSnapshot }
  | { kind: 'day'; snapshot: BulkDeleteSnapshot }
  | { kind: 'all'; snapshot: BulkDeleteSnapshot }

const DANGER_PHRASE = '清空全部生活记录'

function typeCountsText(snapshot: BulkDeleteSnapshot) {
  return (Object.entries(snapshot.typeCounts) as Array<[LifeRecordType, number]>)
    .map(([type, count]) => `${LIFE_RECORD_LABELS[type]} ${count} 条`)
    .join(' · ')
}

export default function TotalRecordManager({ date, dayRecords, allRecords, busy, onDeleteSnapshot, compactLauncher = false, initialManaging = false, onDateChange, onClose }: Props) {
  const [managing, setManaging] = useState(initialManaging)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const [pending, setPending] = useState<PendingDelete | null>(null)
  const [dangerOpen, setDangerOpen] = useState(false)
  const [dangerPhrase, setDangerPhrase] = useState('')
  const [status, setStatus] = useState('')

  const daySnapshot = useMemo(
    () => bulkDeleteSnapshot(allRecords, { kind: 'day', date }),
    [allRecords, date],
  )
  const allSnapshot = useMemo(
    () => bulkDeleteSnapshot(allRecords, { kind: 'all' }),
    [allRecords],
  )
  const selectedSnapshot = useMemo(
    () => bulkDeleteSnapshot(allRecords, { kind: 'selected', ids: [...selectedIds] }),
    [allRecords, selectedIds],
  )

  function exitManageMode() {
    setManaging(false)
    setSelectedIds(new Set())
    setPending(null)
    setDangerOpen(false)
    setDangerPhrase('')
    onClose?.()
  }

  function toggle(id: string) {
    setPending(null)
    setSelectedIds(current => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function confirmDelete() {
    if (!pending || busy) return
    const outcome = await onDeleteSnapshot(pending.snapshot)
    if (outcome) setStatus(bulkDeleteOutcomeMessage(outcome))
    setSelectedIds(new Set())
    setPending(null)
    setDangerPhrase('')
    setDangerOpen(false)
    if (pending.kind !== 'selected') setManaging(false)
  }

  return <section className={compactLauncher ? 'space-y-3' : 'rounded-[1.5rem] border border-cyan-300/20 bg-[#0b1830]/95 p-4'} aria-labelledby="manage-records-heading">
    {compactLauncher && !managing && <button
      type="button"
      onClick={() => setManaging(true)}
      className="rounded-lg border border-cyan-300/35 bg-cyan-300/10 px-3 py-1.5 text-xs font-bold text-cyan-200"
    >
      管理
    </button>}
    {!compactLauncher && <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <p className="font-mono text-[10px] tracking-[0.18em] text-cyan-300">RECORD CONTROL</p>
        <h3 id="manage-records-heading" className="mt-1 text-lg font-black">管理记录</h3>
        <p className="mt-1 text-xs leading-5 text-muted">只管理已保存记录。删除前会重新读取权威数据，并按本次确认的范围执行。</p>
      </div>
      <button
        type="button"
      onClick={() => managing ? exitManageMode() : setManaging(true)}
        className="rounded-xl border border-cyan-300/35 bg-cyan-300/10 px-4 py-2 text-sm font-bold text-cyan-200"
      >
        {managing ? '退出管理' : '管理记录'}
      </button>
    </div>}

    {managing && <div className={compactLauncher ? 'space-y-4 rounded-[1.5rem] border border-cyan-300/20 bg-[#0b1830]/95 p-4' : 'mt-4 space-y-4 border-t border-cyan-300/15 pt-4'}>
      {compactLauncher && <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] tracking-[0.18em] text-cyan-300">RECORD CONTROL</p>
          <h3 id="manage-records-heading" className="mt-1 text-lg font-black">管理历史记录</h3>
        </div>
        <button type="button" onClick={exitManageMode} className="rounded-lg border border-cyan-300/30 px-3 py-1.5 text-xs text-cyan-200">退出管理</button>
      </div>}
      <div>
        <div className="flex items-center justify-between gap-3">
          <label className="text-sm font-bold" htmlFor="manage-day-date">删除某一天的记录</label>
          <span className="font-mono text-xs text-muted">{dayRecords.length} 条</span>
        </div>
        {onDateChange && <input
          id="manage-day-date"
          aria-label="选择要删除记录的日期"
          type="date"
          value={date}
          onChange={event => onDateChange(event.target.value)}
          className="mt-2 rounded-lg border border-cyan-300/20 bg-[#101e38] px-2 py-1.5 text-xs text-slate-100"
        />}
        {dayRecords.length === 0
          ? <p className="mt-2 rounded-xl border border-cyan-300/15 bg-[#101e38] p-3 text-sm text-muted">这一天没有可删除的记录。</p>
          : <div className="mt-2 space-y-2">
            {dayRecords.map(record => <label key={record.id} className="flex cursor-pointer items-start gap-3 rounded-xl border border-cyan-300/15 bg-[#101e38] p-3">
              <input
                type="checkbox"
                checked={selectedIds.has(record.id)}
                onChange={() => toggle(record.id)}
                className="mt-1 h-4 w-4 accent-cyan-300"
              />
              <span className="min-w-0 flex-1">
                <span className="block text-xs text-cyan-200">{LIFE_RECORD_LABELS[record.type]} · {record.date}</span>
                <span className="mt-1 block break-words text-sm font-semibold">{lifeRecordSummary(record)}</span>
              </span>
            </label>)}
          </div>}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={busy || selectedSnapshot.recordCount === 0}
            onClick={() => setPending({ kind: 'selected', snapshot: selectedSnapshot })}
            className="rounded-xl bg-red-500 px-4 py-2 text-sm font-bold text-white disabled:opacity-40"
          >
            删除选中 {selectedSnapshot.recordCount ? `(${selectedSnapshot.recordCount})` : ''}
          </button>
          <button
            type="button"
            disabled={busy || daySnapshot.recordCount === 0}
            onClick={() => setPending({ kind: 'day', snapshot: daySnapshot })}
            className="rounded-xl border border-red-300/35 px-4 py-2 text-sm font-bold text-red-200 disabled:opacity-40"
          >
            删除当天全部（{daySnapshot.recordCount}）
          </button>
          {selectedIds.size > 0 && <button type="button" onClick={() => setSelectedIds(new Set())} className="text-xs text-muted underline">清除勾选</button>}
        </div>
      </div>

      <div className="rounded-2xl border border-red-400/30 bg-red-950/35 p-4">
        <h4 className="text-sm font-bold text-red-100">危险操作</h4>
        <p className="mt-1 text-xs leading-5 text-red-100/80">清空当前权威数据源中的全部生活记录。没有其他记录引用的图片附件会一并清理；共享图片会保留。操作不可轻易撤销。</p>
        <p className="mt-2 font-mono text-sm font-black text-red-200">{allSnapshot.recordCount} 条记录</p>
        <button
          type="button"
          disabled={busy || allSnapshot.recordCount === 0}
          onClick={() => { setDangerOpen(true); setDangerPhrase(''); setPending(null) }}
          className="mt-3 rounded-xl border border-red-300/40 px-4 py-2 text-sm font-bold text-red-200 disabled:opacity-40"
        >
          打开清空全部流程
        </button>
      </div>
    </div>}

    {pending && <div role="alertdialog" aria-modal="true" aria-labelledby="delete-confirm-title" className="mt-4 rounded-2xl border border-red-300/35 bg-red-950/60 p-4 text-red-50">
      <h4 id="delete-confirm-title" className="font-bold">
        {pending.kind === 'selected' ? '确认删除选中记录' : pending.kind === 'day' ? '确认删除当天全部记录' : '确认清空全部生活记录'}
      </h4>
      <p className="mt-2 text-sm">
        将删除 <strong>{pending.snapshot.recordCount}</strong> 条记录
        {pending.kind === 'day' ? `，日期为 ${pending.snapshot.date ?? date}` : ''}。
      </p>
      {pending.kind === 'day' && <p className="mt-1 text-xs text-red-100/80">{typeCountsText(pending.snapshot)}。只影响 {pending.snapshot.date ?? date}，不会删除整月或其他日期。</p>}
      {pending.kind === 'selected' && <p className="mt-1 text-xs text-red-100/80">仅删除上方已勾选的记录。</p>}
      {pending.kind === 'all' && <p className="mt-1 text-xs text-red-100/80">范围是本次确认快照中的全部 {pending.snapshot.recordCount} 条记录，不是筛选结果；确认后新增的记录不会被扩大删除。请先导出备份。</p>}
      <p className="mt-2 text-xs leading-5 text-red-100/80">未被其他记录引用的图片附件会清理；共享附件会保留。若底层只能逐条写入，将按实际结果显示部分成功或失败。</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" disabled={busy} onClick={() => setPending(null)} className="rounded-xl border border-red-200/30 px-4 py-2 text-sm">取消</button>
        <button type="button" disabled={busy} onClick={() => void confirmDelete()} className="rounded-xl bg-red-500 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{busy ? '删除中…' : `确认删除 ${pending.snapshot.recordCount} 条`}</button>
      </div>
    </div>}

    {dangerOpen && <div role="alertdialog" aria-modal="true" aria-labelledby="danger-confirm-title" className="mt-4 rounded-2xl border-2 border-red-400/60 bg-[#250814] p-4 text-red-50">
      <h4 id="danger-confirm-title" className="text-lg font-black">清空全部生活记录</h4>
      <p className="mt-2 text-sm leading-6">当前权威数据源共有 <strong>{allSnapshot.recordCount}</strong> 条记录。此操作会尝试全部删除，并清理无人引用的图片附件；共享图片会保留。清空操作不可轻易撤销。</p>
      <p className="mt-2 rounded-xl border border-amber-300/30 bg-amber-950/40 p-3 text-xs leading-5 text-amber-100">请先在「我的」页面导出 JSON 备份。输入下面的确认文字后，删除按钮才会启用。</p>
      <label className="mt-3 block text-xs font-bold" htmlFor="danger-delete-phrase">输入：{DANGER_PHRASE}</label>
      <input
        id="danger-delete-phrase"
        value={dangerPhrase}
        onChange={event => setDangerPhrase(event.target.value)}
        autoComplete="off"
        className="mt-1 w-full rounded-xl border border-red-300/30 bg-[#10101b] px-3 py-2.5 text-sm text-white outline-none focus:border-red-300"
      />
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={() => { setDangerOpen(false); setDangerPhrase('') }} className="rounded-xl border border-red-200/30 px-4 py-2 text-sm">取消</button>
        <button
          type="button"
          disabled={busy || dangerPhrase !== DANGER_PHRASE || allSnapshot.recordCount === 0}
          onClick={() => {
            setDangerOpen(false)
            setPending({ kind: 'all', snapshot: allSnapshot })
          }}
          className="rounded-xl bg-red-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-40"
        >
          继续确认清空
        </button>
      </div>
    </div>}

    {status && <p className="mt-3 rounded-xl border border-cyan-300/25 bg-cyan-950/30 p-3 text-xs leading-5 text-cyan-100">{status}</p>}
  </section>
}
