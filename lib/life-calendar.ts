import { LIFE_RECORD_LABELS, type LifeRecord, type LifeRecordType } from './life-records.ts'

/**
 * 日历专用的纯函数模块：日期计算与按日期聚合。
 *
 * 平台无关，不依赖 React、DOM 或任何存储实现，方便未来复用到 APP 和小程序。
 * 所有日期都使用本地日历日期的 `YYYY-MM-DD` 字符串，绝不经过 UTC 解析，
 * 避免因为时区差异把记录显示到错误的日期上。
 */

export const LIFE_RECORD_VISUALS: Record<LifeRecordType, { label: string; english: string; color: string; background: string }> = {
  exercise: { label: '运动', english: 'Exercise', color: '#35f2ce', background: '#123a41' },
  sleep: { label: '睡眠', english: 'Sleep', color: '#a58cff', background: '#2a2350' },
  learning: { label: '学习', english: 'Study', color: '#61b9ff', background: '#183451' },
  meal: { label: '饮食', english: 'Food', color: '#a7ef89', background: '#29402f' },
  expense: { label: '消费', english: 'Bill', color: '#ffb46a', background: '#433127' },
  mood: { label: '心情', english: 'Emotion', color: '#ff79bc', background: '#482542' },
}

export const CALENDAR_TYPES: LifeRecordType[] = ['exercise', 'sleep', 'learning', 'meal', 'expense', 'mood']

const WEEKDAY_LABELS = ['一', '二', '三', '四', '五', '六', '日']

/** 本地日历日期，星期一是每周第一天。 */
export function toLocalDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/** 从 `YYYY-MM-DD` 构造本地 Date；固定用中午，彻底避开时区偏移。 */
export function fromLocalDateKey(key: string): Date {
  const [year, month, day] = key.split('-').map(Number)
  return new Date(year, month - 1, day, 12, 0, 0, 0)
}

export function isValidDateKey(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  if (month < 1 || month > 12 || day < 1) return false
  const probe = new Date(year, month - 1, day, 12)
  return probe.getFullYear() === year && probe.getMonth() === month - 1 && probe.getDate() === day
}

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}

export function daysInMonth(year: number, month: number): number {
  if (!Number.isInteger(month) || month < 1 || month > 12) return 30
  if (month === 2) return isLeapYear(year) ? 29 : 28
  // 31 天的月份：1、3、5、7、8、10、12；其余（4、6、9、11）为 30 天。
  return [1, 3, 5, 7, 8, 10, 12].includes(month) ? 31 : 30
}

export interface MonthGrid {
  year: number
  month: number
  /** 星期标题，固定周一到周日。 */
  weekdays: string[]
  /** 6 行 × 7 列的日期键；非本月用 null 占位，保证网格不错位。 */
  weeks: Array<Array<string | null>>
  /** 本月全部日期键，按天升序。 */
  days: string[]
}

/** 生成月历网格，始终返回 6 行，月份切换时布局高度不变。 */
export function buildMonthGrid(year: number, month: number): MonthGrid {
  const total = daysInMonth(year, month)
  const days: string[] = []
  for (let day = 1; day <= total; day += 1) {
    days.push(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`)
  }
  const firstWeekday = (fromLocalDateKey(days[0]).getDay() + 6) % 7
  const weeks: Array<Array<string | null>> = []
  let cursor = firstWeekday
  let row: Array<string | null> = Array.from({ length: 7 }, () => null)
  for (const key of days) {
    row[cursor] = key
    cursor += 1
    if (cursor === 7) { weeks.push(row); row = Array.from({ length: 7 }, () => null); cursor = 0 }
  }
  if (cursor !== 0) weeks.push(row)
  while (weeks.length < 6) weeks.push(Array.from({ length: 7 }, () => null))
  return { year, month, weekdays: WEEKDAY_LABELS, weeks, days }
}

/** 月份偏移，正确处理跨年：2027-01 的上一个月是 2026-12。 */
export function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const probe = new Date(year, month - 1 + delta, 1, 12)
  return { year: probe.getFullYear(), month: probe.getMonth() + 1 }
}

export interface DayMarker {
  date: string
  /** 当天有记录的分类，按固定顺序排列。 */
  types: LifeRecordType[]
  /** 当天记录总数。 */
  count: number
}

export interface CalendarIndex {
  /** `YYYY-MM-DD` → 当天标记。只包含真实有记录的日期。 */
  byDate: Map<string, DayMarker>
}

/**
 * 按日期聚合记录。只读，不复制、不修改、不重排传入的记录对象。
 *
 * `typeFilter` 为 null 时统计全部分类；传入具体类型时只统计该分类，
 * 因此分类日历与总日历读取同一份数据，只是展示范围不同。
 */
export function buildCalendarIndex(records: readonly LifeRecord[], typeFilter: LifeRecordType | null = null): CalendarIndex {
  const byDate = new Map<string, DayMarker>()
  for (const record of records) {
    if (!isValidDateKey(record.date)) continue
    if (typeFilter !== null && record.type !== typeFilter) continue
    const existing = byDate.get(record.date)
    if (existing) {
      existing.count += 1
      if (!existing.types.includes(record.type)) existing.types.push(record.type)
    } else {
      byDate.set(record.date, { date: record.date, types: [record.type], count: 1 })
    }
  }
  for (const marker of byDate.values()) {
    marker.types.sort((left, right) => CALENDAR_TYPES.indexOf(left) - CALENDAR_TYPES.indexOf(right))
  }
  return { byDate }
}

/** 取出某一天在该分类范围内的记录，保持传入顺序（最新写入在前由调用方决定）。 */
export function recordsForDate(records: readonly LifeRecord[], date: string, typeFilter: LifeRecordType | null = null): LifeRecord[] {
  return records.filter(record => record.date === date && (typeFilter === null || record.type === typeFilter))
}

export function monthLabel(year: number, month: number): string {
  return `${year} 年 ${month} 月`
}

export function typeLabel(type: LifeRecordType): string {
  return LIFE_RECORD_LABELS[type]
}

export function sameMonth(left: { year: number; month: number }, right: { year: number; month: number }): boolean {
  return left.year === right.year && left.month === right.month
}

export function clampDateKeyToMonth(date: string, year: number, month: number): string {
  if (isValidDateKey(date)) {
    const current = fromLocalDateKey(date)
    if (current.getFullYear() === year && current.getMonth() + 1 === month) return date
  }
  return `${year}-${String(month).padStart(2, '0')}-01`
}

export function recordsForMonth(records: readonly LifeRecord[], year: number, month: number, typeFilter: LifeRecordType | null = null): LifeRecord[] {
  const prefix = `${year}-${String(month).padStart(2, '0')}-`
  return records.filter(record => record.date.startsWith(prefix) && (typeFilter === null || record.type === typeFilter))
}
