import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  buildCalendarIndex,
  buildMonthGrid,
  clampDateKeyToMonth,
  daysInMonth,
  fromLocalDateKey,
  isValidDateKey,
  isLeapYear,
  LIFE_RECORD_VISUALS,
  recordsForDate,
  recordsForMonth,
  shiftMonth,
  toLocalDateKey,
} from '../lib/life-calendar.ts'
import { searchLifeRecords } from '../lib/life-search.ts'
import { countRecordedDays, summarizeLifeRecords } from '../lib/life-records.ts'

/** @type {Array<import('../lib/life-records.ts').LifeRecord>} */
const records = [
  { id: 'a', type: 'exercise', date: '2026-10-22', note: '', sourceText: '今天练了胸，卧推60公斤做了4组', activity: '卧推', weightKg: 60, sets: 4 },
  { id: 'b', type: 'meal', date: '2026-10-22', note: '', sourceText: '午饭吃了肠粉', food: '肠粉' },
  { id: 'c', type: 'expense', date: '2026-10-22', note: '', sourceText: '午饭花了38元', amount: 38, currency: 'CNY' },
  { id: 'd', type: 'sleep', date: '2026-10-22', note: '', sourceText: '睡了7小时', hours: 7 },
  { id: 'e', type: 'learning', date: '2026-10-20', note: '', sourceText: '学英语45分钟', subject: '英语', durationMinutes: 45 },
  { id: 'f', type: 'mood', date: '2026-10-19', note: '', sourceText: '心情不错', score: 4 },
]

test('every month of a year builds a 6x7 grid with the right day count', () => {
  for (let month = 1; month <= 12; month += 1) {
    const grid = buildMonthGrid(2026, month)
    assert.equal(grid.weeks.length, 6)
    assert.equal(grid.days.length, daysInMonth(2026, month))
    assert.equal(grid.weekdays.join(''), '一二三四五六日')
    const filled = grid.weeks.flat().filter(Boolean)
    assert.equal(filled.length, daysInMonth(2026, month))
    assert.equal(new Set(filled).size, daysInMonth(2026, month))
  }
})

test('leap year February has 29 days and non-leap has 28', () => {
  assert.equal(isLeapYear(2024), true)
  assert.equal(isLeapYear(2026), false)
  assert.equal(isLeapYear(2000), true)
  assert.equal(isLeapYear(1900), false)
  assert.equal(daysInMonth(2024, 2), 29)
  assert.equal(daysInMonth(2026, 2), 28)
  const leap = buildMonthGrid(2024, 2)
  assert.equal(leap.days.length, 29)
  assert.equal(leap.days[28], '2024-02-29')
})

test('month shifting crosses the year boundary in both directions', () => {
  assert.deepEqual(shiftMonth(2026, 12, 1), { year: 2027, month: 1 })
  assert.deepEqual(shiftMonth(2027, 1, -1), { year: 2026, month: 12 })
  assert.deepEqual(shiftMonth(2026, 10, 3), { year: 2027, month: 1 })
  assert.deepEqual(shiftMonth(2026, 2, -2), { year: 2025, month: 12 })
  assert.deepEqual(shiftMonth(2026, 10, 0), { year: 2026, month: 10 })
})

test('the first weekday of the grid follows Monday-first ordering', () => {
  // 2026-10-01 is a Thursday, so it must sit at index 3.
  const grid = buildMonthGrid(2026, 10)
  assert.equal(grid.weeks[0][3], '2026-10-01')
  assert.equal(grid.weeks[0][0], null)
  // 2026-11-01 is a Sunday, so it must sit at index 6.
  const november = buildMonthGrid(2026, 11)
  assert.equal(november.weeks[0][6], '2026-11-01')
})

test('local date keys never shift across a timezone boundary', () => {
  assert.equal(toLocalDateKey(new Date(2026, 9, 22, 0, 30)), '2026-10-22')
  assert.equal(toLocalDateKey(new Date(2026, 9, 22, 23, 45)), '2026-10-22')
  assert.equal(fromLocalDateKey('2026-01-01').getFullYear(), 2026)
  assert.equal(fromLocalDateKey('2026-01-01').getMonth(), 0)
  assert.equal(fromLocalDateKey('2026-01-01').getDate(), 1)
  assert.equal(fromLocalDateKey('2026-12-31').getDate(), 31)
})

test('date validation rejects impossible calendar dates', () => {
  assert.equal(isValidDateKey('2026-10-22'), true)
  assert.equal(isValidDateKey('2024-02-29'), true)
  assert.equal(isValidDateKey('2026-02-30'), false)
  assert.equal(isValidDateKey('2026-13-01'), false)
  assert.equal(isValidDateKey('2026-00-10'), false)
  assert.equal(isValidDateKey('2026-02-00'), false)
  assert.equal(isValidDateKey('2026-2-3'), false)
  assert.equal(isValidDateKey('not-a-date'), false)
  assert.equal(isValidDateKey(undefined), false)
})

test('a single day with several categories produces one marker listing every type', () => {
  const index = buildCalendarIndex(records, null)
  const marker = index.byDate.get('2026-10-22')
  assert.equal(marker.count, 4)
  assert.deepEqual(marker.types, ['exercise', 'sleep', 'meal', 'expense'])
  assert.equal(index.byDate.size, 3)
})

test('a single day with several records of the same category keeps one type but counts all', () => {
  const index = buildCalendarIndex(records, 'exercise')
  const marker = index.byDate.get('2026-10-22')
  assert.deepEqual(marker.types, ['exercise'])
  assert.equal(marker.count, 1)
  assert.equal(index.byDate.size, 1)
})

test('a category calendar never leaks records of other categories', () => {
  const index = buildCalendarIndex(records, 'meal')
  assert.deepEqual([...index.byDate.keys()], ['2026-10-22'])
  assert.equal(index.byDate.get('2026-10-22').count, 1)
  const dayRecords = recordsForDate(records, '2026-10-22', 'meal')
  assert.equal(dayRecords.length, 1)
  assert.equal(dayRecords[0].type, 'meal')
})

test('the total calendar returns every category for the selected day', () => {
  const dayRecords = recordsForDate(records, '2026-10-22', null)
  assert.equal(dayRecords.length, 4)
  assert.deepEqual(dayRecords.map(record => record.type), ['exercise', 'meal', 'expense', 'sleep'])
})

test('a day without records returns an empty list, not another day records', () => {
  assert.deepEqual(recordsForDate(records, '2026-10-21', null), [])
  assert.deepEqual(recordsForDate(records, '2026-10-21', 'exercise'), [])
  const index = buildCalendarIndex(records, null)
  assert.equal(index.byDate.has('2026-10-21'), false)
})

test('record order changes do not change the aggregation result', () => {
  const forward = buildCalendarIndex(records, null)
  const backward = buildCalendarIndex([...records].reverse(), null)
  assert.deepEqual([...forward.byDate.keys()].sort(), [...backward.byDate.keys()].sort())
  for (const key of forward.byDate.keys()) {
    assert.equal(forward.byDate.get(key).count, backward.byDate.get(key).count)
    assert.deepEqual(forward.byDate.get(key).types, backward.byDate.get(key).types)
  }
})

test('the calendar never mutates the records it reads', () => {
  const snapshot = JSON.stringify(records)
  buildCalendarIndex(records, null)
  recordsForDate(records, '2026-10-22', null)
  recordsForMonth(records, 2026, 10, null)
  assert.equal(JSON.stringify(records), snapshot)
})

test('invalid dates are ignored instead of showing up on a wrong day', () => {
  const dirty = [
    { id: 'x', type: 'mood', date: '2026-02-30', note: '', sourceText: '', score: 3 },
    { id: 'y', type: 'mood', date: '', note: '', sourceText: '', score: 3 },
    { id: 'z', type: 'sleep', date: '2026-10-22', note: '', sourceText: '', hours: 7 },
  ]
  const index = buildCalendarIndex(dirty, null)
  assert.equal(index.byDate.size, 1)
  assert.equal(index.byDate.get('2026-10-22').count, 1)
})

test('month selection clamps a selected date into the target month', () => {
  assert.equal(clampDateKeyToMonth('2026-10-31', 2026, 11), '2026-11-01')
  assert.equal(clampDateKeyToMonth('2026-10-31', 2026, 9), '2026-09-01')
  assert.equal(clampDateKeyToMonth('2026-10-15', 2026, 11), '2026-11-01')
  assert.equal(clampDateKeyToMonth('broken', 2026, 11), '2026-11-01')
  assert.equal(clampDateKeyToMonth('2026-11-20', 2026, 11), '2026-11-20')
})

test('records for a month only returns that month and optional category', () => {
  assert.equal(recordsForMonth(records, 2026, 10, null).length, 6)
  assert.equal(recordsForMonth(records, 2026, 10, 'learning').length, 1)
  assert.equal(recordsForMonth(records, 2026, 9, null).length, 0)
  assert.equal(recordsForMonth(records, 2027, 10, null).length, 0)
})

test('every category has a stable visual identity used by both calendars', () => {
  const types = Object.keys(LIFE_RECORD_VISUALS)
  assert.deepEqual(types.slice().sort(), ['exercise', 'expense', 'learning', 'meal', 'mood', 'sleep'])
  assert.equal(types.length, 6)
  const colors = types.map(type => LIFE_RECORD_VISUALS[type].color)
  assert.equal(new Set(colors).size, colors.length)
  for (const type of types) {
    assert.ok(LIFE_RECORD_VISUALS[type].label.length >= 2)
    assert.ok(LIFE_RECORD_VISUALS[type].english.length >= 3)
  }
})

test('category order is stable so markers never jump between renders', () => {
  const first = buildCalendarIndex(records, null).byDate.get('2026-10-22').types
  const second = buildCalendarIndex(records, null).byDate.get('2026-10-22').types
  assert.deepEqual(first, second)
  // 固定顺序：运动、睡眠、学习、饮食、消费、心情。
  assert.deepEqual(first, ['exercise', 'sleep', 'meal', 'expense'])
})

test('an empty record list produces an empty index without errors', () => {
  const index = buildCalendarIndex([], null)
  assert.equal(index.byDate.size, 0)
  assert.deepEqual(recordsForDate([], '2026-10-22', null), [])
})

test('the existing keyword search still works on the same record set the calendar reads', () => {
  assert.equal(searchLifeRecords(records, '卧推').length, 1)
  assert.equal(searchLifeRecords(records, '肠粉').length, 1)
  assert.equal(searchLifeRecords(records, '2026-10-20').length, 1)
  assert.equal(searchLifeRecords(records, '心情').length, 1)
  assert.equal(searchLifeRecords(records, '不存在的词').length, 0)
  assert.equal(searchLifeRecords(records, '   ').length, 0)
})

test('search and the category calendar agree on which records belong to a day', () => {
  const calendarDay = recordsForDate(records, '2026-10-22', null)
  const searchDay = searchLifeRecords(records, '2026-10-22').map(match => match.record)
  assert.equal(calendarDay.length, searchDay.length)
  assert.deepEqual(
    calendarDay.map(record => record.id).sort(),
    searchDay.map(record => record.id).sort(),
  )
})

test('the existing statistics still compute from the same records', () => {
  const summary = summarizeLifeRecords(records)
  assert.equal(summary.exerciseCount, 1)
  assert.equal(summary.mealCount, 1)
  assert.equal(summary.sleepHours, 7)
  assert.equal(summary.expenseAmount, 38)
  assert.equal(summary.moodCount, 1)
  assert.equal(summary.ratedMoodCount, 1)
  assert.equal(summary.moodAverage, 4)
  assert.equal(summary.learningMinutes, 45)
  const weekDates = ['2026-10-16', '2026-10-17', '2026-10-18', '2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22']
  assert.equal(countRecordedDays(records, 'exercise', weekDates), 1)
  assert.equal(countRecordedDays(records, 'sleep', weekDates), 1)
  assert.equal(countRecordedDays(records, 'meal', weekDates), 1)
})

test('a category calendar plus search narrows to the same records as the calendar alone', () => {
  const typeRecords = records.filter(record => record.type === 'exercise')
  const index = buildCalendarIndex(typeRecords, 'exercise')
  assert.equal(index.byDate.get('2026-10-22').count, 1)
  const hits = searchLifeRecords(typeRecords, '卧推')
  assert.equal(hits.length, 1)
  assert.equal(hits[0].record.id, 'a')
})

test('rapid month shifts never repeat or drop a month key', () => {
  let cursor = { year: 2026, month: 12 }
  const seen = []
  for (let step = 0; step < 12; step += 1) {
    cursor = shiftMonth(cursor.year, cursor.month, 1)
    seen.push(`${cursor.year}-${cursor.month}`)
  }
  assert.equal(new Set(seen).size, 12)
  assert.equal(seen[0], '2027-1')
  assert.equal(seen[11], '2027-12')
  cursor = { year: 2027, month: 1 }
  const back = []
  for (let step = 0; step < 13; step += 1) {
    cursor = shiftMonth(cursor.year, cursor.month, -1)
    back.push(`${cursor.year}-${cursor.month}`)
  }
  assert.equal(new Set(back).size, 13)
  assert.equal(back[12], '2025-12')
})

test('the selected day always exists in the month it is shown in', () => {
  for (const [year, month] of [[2026, 1], [2026, 2], [2024, 2], [2026, 12], [2027, 11]]) {
    const grid = buildMonthGrid(year, month)
    for (const key of grid.days) {
      assert.equal(isValidDateKey(key), true)
      assert.ok(key.startsWith(`${year}-${String(month).padStart(2, '0')}-`))
    }
  }
})

test('calendar motion is transform/opacity based and respects reduced motion', () => {
  const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8')
  const calendarMotion = css.slice(css.indexOf('/* ─── iOS 风格页面过渡与日历动效'))
  assert.match(calendarMotion, /@keyframes aios-page-in-right/)
  assert.match(calendarMotion, /@keyframes aios-month-in-left/)
  assert.match(calendarMotion, /@keyframes aios-day-select/)
  assert.match(calendarMotion, /@media \(prefers-reduced-motion: reduce\)/)
  assert.match(calendarMotion, /animation-duration:\s*1ms\s*!important/)
  assert.match(calendarMotion, /transition-duration:\s*1ms\s*!important/)
})
