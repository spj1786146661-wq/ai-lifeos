'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  buildCalendarIndex,
  CALENDAR_TYPES,
  clampDateKeyToMonth,
  fromLocalDateKey,
  isValidDateKey,
  LIFE_RECORD_VISUALS,
  recordsForDate,
  shiftMonth,
  toLocalDateKey,
} from '@/lib/life-calendar.ts'
import type { LifeRecord, LifeRecordType } from '@/lib/life-records'
import DayRecordList from './DayRecordList'
import MonthCalendar from './MonthCalendar'
import TypeEntryGrid from './TypeEntryGrid'

interface Props {
  records: LifeRecord[]
  onEdit: (record: LifeRecord) => void
  onDelete: (record: LifeRecord) => void
  busy: boolean
  /** 总日历或分类日历的初始视图。组件由数据页在入口点击后显式挂载。 */
  initialView?: { kind: 'total' } | { kind: 'type'; type: LifeRecordType }
  /** 分类页或总日历打开后，把当前视图同步给上层圆环。 */
  onTypeView?: (type: LifeRecordType | null) => void
  /** 保留的搜索与统计入口，由上层页面渲染。 */
  children?: React.ReactNode
}

type CalendarView = { kind: 'total' } | { kind: 'type'; type: LifeRecordType }
type MonthCursor = { year: number; month: number }
type SavedTotal = { cursor: MonthCursor; selectedDate: string; scrollY: number }
type NextView = {
  view: CalendarView
  cursor: MonthCursor
  selectedDate: string
  scrollY?: number
}

const CALENDAR_HISTORY_MARKER = 'ai-lifeos-calendar-screen-v1'

const EXIT_MS = 300

function historyStateFor(type: LifeRecordType) {
  return { marker: CALENDAR_HISTORY_MARKER, calendar: 'type' as const, type }
}

function typeFromHistoryState(value: unknown): LifeRecordType | null {
  if (!value || typeof value !== 'object') return null
  const state = value as Record<string, unknown>
  if (state.marker !== CALENDAR_HISTORY_MARKER || state.calendar !== 'type') return null
  return typeof state.type === 'string' && CALENDAR_TYPES.includes(state.type as LifeRecordType)
    ? state.type as LifeRecordType
    : null
}

function recentSevenDays(today: string): string[] {
  const dates: string[] = []
  const base = fromLocalDateKey(today)
  for (let offset = 6; offset >= 0; offset -= 1) {
    const date = new Date(base)
    date.setDate(date.getDate() - offset)
    dates.push(toLocalDateKey(date))
  }
  return dates
}

function emptyTypeCounts(): Record<LifeRecordType, number> {
  return Object.fromEntries(CALENDAR_TYPES.map(type => [type, 0])) as Record<LifeRecordType, number>
}

export default function LifeCalendar({ records, onEdit, onDelete, busy, initialView = { kind: 'total' }, onTypeView, children }: Props) {
  const today = useMemo(() => toLocalDateKey(new Date()), [])
  const now = useMemo(() => new Date(), [])
  const initialMonth = useMemo(() => {
    if (initialView.kind === 'type') {
      let latest: string | null = null
      for (const record of records) {
        if (record.type === initialView.type && isValidDateKey(record.date)) {
          if (latest === null || record.date > latest) latest = record.date
        }
      }
      if (latest) {
        const date = fromLocalDateKey(latest)
        return { cursor: { year: date.getFullYear(), month: date.getMonth() + 1 }, selectedDate: latest }
      }
    }
    return { cursor: { year: now.getFullYear(), month: now.getMonth() + 1 }, selectedDate: today }
  }, [initialView, now, records, today])
  const [view, setView] = useState<CalendarView>(initialView)
  const [cursor, setCursor] = useState(initialMonth.cursor)
  const [selectedDate, setSelectedDate] = useState(initialMonth.selectedDate)
  const [monthAnimation, setMonthAnimation] = useState<'next' | 'prev'>('next')
  const [transition, setTransition] = useState<'none' | 'entering' | 'leaving'>('none')
  // 进入分类前保存总日历的月份、选中日和滚动位置；用状态保存，返回图层可直接渲染。
  const [savedTotal, setSavedTotal] = useState<SavedTotal | null>(null)
  // 目标视图连同上屏时需要的月份与选中日，在点击时一次算好，避免在 effect 里同步 setState。
  const [nextView, setNextView] = useState<NextView | null>(null)

  const typeFilter = view.kind === 'type' ? view.type : null

  const beginEnterType = useCallback((type: LifeRecordType, updateHistory: boolean) => {
    // 动画期间禁止再次切换，避免连续快速操作造成页面错乱。
    if (transition !== 'none') return
    setSavedTotal({ cursor, selectedDate, scrollY: window.scrollY })
    let latest: string | null = null
    for (const record of records) {
      if (record.type !== type || !isValidDateKey(record.date)) continue
      if (latest === null || record.date > latest) latest = record.date
    }
    const target = fromLocalDateKey(latest ?? today)
    if (updateHistory) window.history.pushState(historyStateFor(type), '', `#calendar-${type}`)
    setView({ kind: 'type', type })
    onTypeView?.(type)
    setCursor({ year: target.getFullYear(), month: target.getMonth() + 1 })
    setSelectedDate(latest ?? today)
    setTransition('entering')
  }, [cursor, selectedDate, transition, records, today, onTypeView])

  const beginLeaveType = useCallback(() => {
    if (transition !== 'none') return
    const saved = savedTotal ?? { cursor, selectedDate, scrollY: window.scrollY }
    setNextView({ view: { kind: 'total' }, cursor: saved.cursor, selectedDate: saved.selectedDate, scrollY: saved.scrollY })
    setTransition('leaving')
  }, [cursor, selectedDate, savedTotal, transition])

  useEffect(() => {
    onTypeView?.(view.kind === 'type' ? view.type : null)
  }, [onTypeView, view])

  useEffect(() => {
    if (view.kind !== 'type') return
    const current = window.history.state
    if (current?.marker === CALENDAR_HISTORY_MARKER && current.calendar === 'type' && current.type === view.type) return
    window.history.pushState(historyStateFor(view.type), '', `#calendar-${view.type}`)
  }, [view])

  const openType = useCallback((type: LifeRecordType) => {
    beginEnterType(type, true)
  }, [beginEnterType])

  const backToTotal = useCallback(() => {
    const state = typeof window === 'undefined' ? null : window.history.state
    if (typeFromHistoryState(state)) {
      window.history.back()
      return
    }
    beginLeaveType()
  }, [beginLeaveType])

  // 让浏览器后退恢复总日历，前进也能重新进入同一分类日历。
  useEffect(() => {
    function handlePopState(event: PopStateEvent) {
      const type = typeFromHistoryState(event.state)
      if (type) {
        if (view.kind === 'total') beginEnterType(type, false)
        return
      }
      if (view.kind === 'type') beginLeaveType()
    }
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [beginEnterType, beginLeaveType, view.kind])

  // 进入动画期间两个图层都已挂载；退出结束后才提交总日历状态，避免白屏或高度塌缩。
  useEffect(() => {
    if (transition === 'entering') {
      const timer = setTimeout(() => setTransition('none'), EXIT_MS)
      return () => clearTimeout(timer)
    }
    if (transition !== 'leaving' || !nextView) return
    const timer = setTimeout(() => {
      setView(nextView.view)
      setCursor(nextView.cursor)
      setSelectedDate(nextView.selectedDate)
      if (nextView.view.kind === 'total') {
        setSavedTotal(null)
        onTypeView?.(null)
      }
      setNextView(null)
      setTransition('none')
      if (nextView.scrollY !== undefined) {
        requestAnimationFrame(() => window.scrollTo({ top: nextView.scrollY, behavior: 'auto' }))
      }
    }, EXIT_MS)
    return () => clearTimeout(timer)
  }, [transition, nextView, onTypeView])

  const index = useMemo(() => buildCalendarIndex(records, typeFilter), [records, typeFilter])
  const totalIndex = useMemo(() => buildCalendarIndex(records, null), [records])
  const dayRecords = useMemo(() => recordsForDate(records, selectedDate, typeFilter), [records, selectedDate, typeFilter])
  const totalLayerCursor = transition !== 'none' && savedTotal ? savedTotal.cursor : cursor
  const totalLayerSelectedDate = transition !== 'none' && savedTotal ? savedTotal.selectedDate : selectedDate
  const totalDayRecords = useMemo(
    () => recordsForDate(records, totalLayerSelectedDate, null),
    [records, totalLayerSelectedDate],
  )

  const weekDates = useMemo(() => recentSevenDays(today), [today])

  const recentDays = useMemo(() => {
    const result = emptyTypeCounts()
    for (const type of CALENDAR_TYPES) {
      result[type] = new Set(records.filter(record => record.type === type && weekDates.includes(record.date)).map(record => record.date)).size
    }
    return result
  }, [records, weekDates])

  const totalCounts = useMemo(() => {
    const result = emptyTypeCounts()
    for (const record of records) result[record.type] += 1
    return result
  }, [records])

  function shiftMonthAndSelect(delta: number) {
    const next = shiftMonth(cursor.year, cursor.month, delta)
    setCursor(next)
    setMonthAnimation(delta > 0 ? 'next' : 'prev')
    setSelectedDate(current => clampDateKeyToMonth(current, next.year, next.month))
  }

  const typeNames = useMemo(
    () => Object.fromEntries(CALENDAR_TYPES.map(type => [type, LIFE_RECORD_VISUALS[type].label])) as Record<string, string>,
    [],
  )

  const calendar = <MonthCalendar
    year={cursor.year}
    month={cursor.month}
    selectedDate={selectedDate}
    today={today}
    index={index}
    typeNames={typeNames}
    onSelectDate={setSelectedDate}
    onShiftMonth={shiftMonthAndSelect}
    animationKey={monthAnimation}
  />

  const totalCalendar = <MonthCalendar
    year={totalLayerCursor.year}
    month={totalLayerCursor.month}
    selectedDate={totalLayerSelectedDate}
    today={today}
    index={totalIndex}
    typeNames={typeNames}
    onSelectDate={setSelectedDate}
    onShiftMonth={shiftMonthAndSelect}
    animationKey={monthAnimation}
  />

  const showTotalLayer = view.kind === 'total' || transition === 'entering' || transition === 'leaving'
  const showTypeLayer = view.kind === 'type'

  return <div id="life-calendar" className="space-y-5 scroll-mt-24 pb-4">
    <div className="relative overflow-hidden rounded-[1.8rem] border border-cyan-300/25 bg-gradient-to-br from-[#102b45] via-[#111a39] to-[#29183f] px-5 py-5 shadow-[0_12px_55px_rgba(0,223,255,.10)]">
      <div className="pointer-events-none absolute right-6 top-0 h-32 w-32 rounded-full bg-cyan-300/25 blur-3xl" />
      <div className="relative flex items-start justify-between gap-3">
        <div>
          <p className="font-mono text-xs font-bold tracking-[0.2em] text-cyan-300">
            LIFE CALENDAR / {view.kind === 'type' ? LIFE_RECORD_VISUALS[view.type].english.toUpperCase() : 'ALL'}
          </p>
          <h2 className="mt-2 text-2xl font-black tracking-tight">
            {view.kind === 'type' ? `${LIFE_RECORD_VISUALS[view.type].label}日历` : '总日历'}
          </h2>
          <p className="mt-2 text-sm leading-6 text-slate-300">
            {view.kind === 'type'
              ? `只显示${LIFE_RECORD_VISUALS[view.type].label}记录，共 ${totalCounts[view.type]} 条。`
              : '所有分类的生活记录按日期汇总。点下方分类进入它的专属日历。'}
          </p>
        </div>
        {view.kind === 'type' && <button
          type="button"
          onClick={backToTotal}
          className="shrink-0 rounded-xl border border-cyan-300/40 bg-cyan-300/10 px-3 py-2 text-xs font-bold text-cyan-200 hover:bg-cyan-300/20 focus-visible:outline-2 focus-visible:outline-cyan-300"
        >
          ← 返回总日历
        </button>}
      </div>
    </div>

    <div className="relative">
      {/* 底层总日历：进入分类时轻微左移，形成 iOS 页面层级。 */}
      <div className={transition === 'entering' ? 'aios-page-under' : transition === 'leaving' ? 'aios-page-restore' : undefined}>
        {showTotalLayer && <>
          {totalCalendar}
          <div className="mt-5 space-y-5">
            <TypeEntryGrid recentDays={recentDays} totalCounts={totalCounts} onOpen={openType} />
            <DayRecordList date={totalLayerSelectedDate} records={totalDayRecords} typeFilter={null} onEdit={onEdit} onDelete={onDelete} busy={busy} />
          </div>
        </>}
      </div>

      {/* 分类日历层：从右向左滑入，返回时向右滑出。 */}
      {showTypeLayer && <div
        className={transition === 'leaving' ? 'aios-page-exit absolute inset-0 z-10 bg-[#070d1b]' : 'aios-page-enter relative z-10 bg-[#070d1b]'}
        role="region"
        aria-label="分类日历"
      >
        {view.kind === 'type' && <>
          {calendar}
          <div className="mt-5">
            <DayRecordList date={selectedDate} records={dayRecords} typeFilter={view.type} onEdit={onEdit} onDelete={onDelete} busy={busy} />
          </div>
        </>}
      </div>}
    </div>

    {showTotalLayer && children}
  </div>
}
