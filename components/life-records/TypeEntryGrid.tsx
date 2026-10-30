'use client'

import { CALENDAR_TYPES, LIFE_RECORD_VISUALS } from '@/lib/life-calendar.ts'
import type { LifeRecordType } from '@/lib/life-records'

interface Props {
  /** 每个分类在最近 7 天有记录的天数，用于入口上的次要提示。 */
  recentDays: Record<LifeRecordType, number>
  totalCounts: Record<LifeRecordType, number>
  onOpen: (type: LifeRecordType) => void
}

export default function TypeEntryGrid({ recentDays, totalCounts, onOpen }: Props) {
  return <section className="space-y-3" aria-label="分类日历入口">
    <div>
      <h3 className="text-lg font-bold">分类日历</h3>
      <p className="mt-1 text-xs text-muted">点一个分类，进入只属于它的日历。所有分类读取同一份记录。</p>
    </div>
    <div className="grid grid-cols-3 gap-2 sm:gap-3">
      {CALENDAR_TYPES.map(type => {
        const visual = LIFE_RECORD_VISUALS[type]
        return <button
          key={type}
          type="button"
          onClick={() => onOpen(type)}
          aria-label={`进入${visual.label}日历，共 ${totalCounts[type]} 条记录，近 7 天记录 ${recentDays[type]} 天`}
          className="aios-type-card flex min-h-[5.5rem] flex-col items-start justify-between rounded-2xl border p-3 text-left focus-visible:outline-2 focus-visible:outline-cyan-300"
          style={{ borderColor: `${visual.color}33`, backgroundColor: visual.background, color: visual.color }}
        >
          <span className="text-base font-black leading-tight">{visual.label}</span>
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] opacity-80">{visual.english}</span>
          <span className="mt-1 text-[11px] font-semibold tabular-nums text-slate-200">
            {totalCounts[type]} 条 · 近 7 天 {recentDays[type]} 天
          </span>
        </button>
      })}
    </div>
  </section>
}
