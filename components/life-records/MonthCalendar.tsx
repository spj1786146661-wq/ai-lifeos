'use client'

import { useEffect, useRef, useState } from 'react'
import { buildMonthGrid, LIFE_RECORD_VISUALS, monthLabel, type CalendarIndex } from '@/lib/life-calendar.ts'

interface Props {
  year: number
  month: number
  selectedDate: string
  today: string
  index: CalendarIndex
  /** 供读屏与文字提示使用的分类名映射，保证颜色不是唯一识别信息。 */
  typeNames: Record<string, string>
  onSelectDate: (date: string) => void
  onShiftMonth: (delta: number) => void
  /** 月份切换方向，用于触发对应的进入动画。 */
  animationKey: string
}

/** 水平滑动判定阈值：位移需同时超过距离与时间窗口，避免轻触误切月份。 */
const SWIPE_MIN_X = 56
const SWIPE_MAX_Y = 64
const SWIPE_MAX_MS = 700

export default function MonthCalendar({ year, month, selectedDate, today, index, typeNames, onSelectDate, onShiftMonth, animationKey }: Props) {
  const grid = buildMonthGrid(year, month)
  const touchStart = useRef<{ x: number; y: number; time: number } | null>(null)
  const [swiping, setSwiping] = useState(false)

  // 月份变化时重放进入动画：通过 key 变化让 React 重新挂载动画容器。
  const trackRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const node = trackRef.current
    if (!node) return
    node.classList.remove('aios-month-next', 'aios-month-prev')
    // 强制回流，确保同一月份重复切换时动画能重新触发。
    void node.offsetWidth
    node.classList.add(animationKey === 'prev' ? 'aios-month-prev' : 'aios-month-next')
  }, [animationKey, year, month])

  function handleTouchStart(event: React.TouchEvent<HTMLDivElement>) {
    const touch = event.touches[0]
    touchStart.current = { x: touch.clientX, y: touch.clientY, time: Date.now() }
  }

  function handleTouchEnd(event: React.TouchEvent<HTMLDivElement>) {
    const start = touchStart.current
    touchStart.current = null
    if (!start) return
    const touch = event.changedTouches[0]
    const dx = touch.clientX - start.x
    const dy = touch.clientY - start.y
    const elapsed = Date.now() - start.time
    // 纵向滚动优先：竖向位移过大时交给浏览器处理，不切月份。
    if (Math.abs(dy) > SWIPE_MAX_Y) return
    if (Math.abs(dx) < SWIPE_MIN_X) return
    if (elapsed > SWIPE_MAX_MS) return
    setSwiping(false)
    onShiftMonth(dx < 0 ? 1 : -1)
  }

  return <section className="space-y-3" aria-label="月历">
    <div className="flex items-center justify-between gap-2">
      <button type="button" onClick={() => onShiftMonth(-1)} aria-label="上一个月" className="aios-day-cell flex h-11 w-11 items-center justify-center rounded-xl border border-cyan-300/20 bg-[#0d1a32] text-lg text-cyan-200 hover:border-cyan-300/60">
        <span aria-hidden="true">‹</span>
      </button>
      <h3 className="text-lg font-black tabular-nums tracking-tight" aria-live="polite">{monthLabel(year, month)}</h3>
      <button type="button" onClick={() => onShiftMonth(1)} aria-label="下一个月" className="aios-day-cell flex h-11 w-11 items-center justify-center rounded-xl border border-cyan-300/20 bg-[#0d1a32] text-lg text-cyan-200 hover:border-cyan-300/60">
        <span aria-hidden="true">›</span>
      </button>
    </div>

    <div
      ref={trackRef}
      className="aios-month-track rounded-2xl border border-cyan-300/15 bg-[#0b1428]/80 p-2"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onTouchMove={() => { if (touchStart.current) setSwiping(true) }}
    >
      <div className="grid grid-cols-7 gap-1" role="grid" aria-label={`${year} 年 ${month} 月`}>
        {grid.weekdays.map(label => <div key={label} role="columnheader" className="py-1 text-center text-[11px] font-bold text-muted">{label}</div>)}
        {grid.weeks.flat().map((date, position) => {
          if (!date) return <div key={`empty-${position}`} role="gridcell" aria-hidden="true" className="aspect-square" />
          const marker = index.byDate.get(date)
          const isSelected = date === selectedDate
          const isToday = date === today
          const day = Number(date.slice(8, 10))
          const markerTitle = marker ? `${marker.count} 条记录：${marker.types.map(type => typeNames[type] ?? type).join('、')}` : '当天暂无记录'
          return <button
            key={date}
            type="button"
            aria-label={`${date}，${markerTitle}`}
            aria-current={isSelected ? 'date' : undefined}
            data-date={date}
            data-has-records={marker ? 'true' : 'false'}
            onClick={() => onSelectDate(date)}
            className={
              'aios-day-cell relative flex aspect-square flex-col items-center justify-center rounded-xl border text-sm font-semibold tabular-nums focus-visible:outline-2 focus-visible:outline-cyan-300 ' +
              (isSelected
                ? 'border-cyan-300/80 bg-cyan-300/20 text-cyan-50'
                : isToday
                  ? 'border-cyan-300/40 bg-[#12233d] text-slate-100'
                  : marker
                    ? 'border-cyan-300/15 bg-[#0e1b33] text-slate-200'
                    : 'border-transparent bg-transparent text-slate-400')
            }
          >
            <span className={isSelected ? 'aios-day-pop inline-block' : undefined} key={isSelected ? `pop-${date}` : undefined}>{day}</span>
            {isToday && !isSelected && <span className="absolute bottom-1 h-1 w-1 rounded-full bg-cyan-300" aria-hidden="true" />}
            {marker && <span className="absolute bottom-1 flex items-center gap-0.5" aria-hidden="true">
              {marker.types.map(type => <span key={type} className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: LIFE_RECORD_VISUALS[type].color }} />)}
            </span>}
          </button>
        })}
      </div>
      {swiping && <span className="sr-only" role="status">正在切换月份</span>}
    </div>

    <p className="px-1 text-[11px] leading-4 text-muted">
      {index.byDate.get(selectedDate)
        ? `${selectedDate} 有 ${index.byDate.get(selectedDate)!.count} 条记录：${index.byDate.get(selectedDate)!.types.map(type => typeNames[type] ?? type).join('、')}`
        : `${selectedDate} 暂无记录`}
      。手机可左右滑动切换月份。
    </p>
  </section>
}
