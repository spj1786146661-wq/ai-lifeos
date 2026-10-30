import { normalizeLifeRecord, summarizeLifeRecords, type LifeRecordDraft } from './life-records.ts'

export type AnalysisPeriod = 'week' | 'month' | 'year'

const PERIOD_DAYS: Record<AnalysisPeriod, number> = { week: 7, month: 30, year: 365 }
export const PERIOD_LABELS: Record<AnalysisPeriod, string> = { week: '近 7 天', month: '近 30 天', year: '近 365 天' }

/** Route clear review questions to analysis; factual daily statements remain record drafts. */
export function detectChatIntent(text: string): { kind: 'record' } | { kind: 'analysis'; period: AnalysisPeriod } {
  const asksAnalysis = /分析|复盘|总结|回顾|趋势|变化|进步|建议|表现|怎么样|如何|怎样|对比|比较|统计|多少次|多少天|多少小时|花了多少/.test(text)
  if (!asksAnalysis) return { kind: 'record' }
  const period: AnalysisPeriod = /一年|全年|年度|今年|去年|近年|过去.*年|最近.*年|365\s*天|12\s*个月/.test(text)
    ? 'year' : /一月|一个月|月度|本月|上月|近月|过去.*月|最近.*月|30\s*天/.test(text)
      ? 'month' : 'week'
  return { kind: 'analysis', period }
}

function shiftedDate(date: string, days: number) {
  const parsed = new Date(`${date}T12:00:00Z`)
  parsed.setUTCDate(parsed.getUTCDate() + days)
  return parsed.toISOString().slice(0, 10)
}

export function analysisWindow(period: AnalysisPeriod, today: string) {
  const days = PERIOD_DAYS[period]
  return { start: shiftedDate(today, 1 - days), end: today, previousStart: shiftedDate(today, 1 - days * 2), previousEnd: shiftedDate(today, -days) }
}

export function normalizeAnalysisRecords(value: unknown, today: string): LifeRecordDraft[] {
  if (!Array.isArray(value) || value.length > 2000) throw new Error('分析记录列表无效或超过 2000 条')
  return value.map(record => normalizeLifeRecord(record, today))
}

export function analysisFacts(records: LifeRecordDraft[], period: AnalysisPeriod, today: string) {
  const range = analysisWindow(period, today)
  const current = records.filter(record => record.date >= range.start && record.date <= range.end)
  const previous = records.filter(record => record.date >= range.previousStart && record.date <= range.previousEnd)
  const summary = summarizeLifeRecords(current)
  const previousSummary = summarizeLifeRecords(previous)
  const daysRecorded = new Set(current.map(record => record.date)).size
  return { range, current, previous, summary, previousSummary, daysRecorded }
}

/** Honest statistics fallback when no model key is configured. */
export function demoAnalysis(records: LifeRecordDraft[], period: AnalysisPeriod, today: string) {
  const facts = analysisFacts(records, period, today)
  const { current, previous, summary, daysRecorded, range } = facts
  if (current.length === 0) {
    return `${PERIOD_LABELS[period]}（${range.start} 至 ${range.end}）没有已保存记录。现在无法从数据判断变化。可以先记录几天，再回来复盘。\n\n反思问题：你最想先观察运动、睡眠、学习、消费还是心情？`
  }
  const sleepCount = current.filter(record => record.type === 'sleep').length
  const moodCount = current.filter(record => record.type === 'mood').length
  const learningQuantities = Object.entries(summary.learningQuantities).map(([unit, amount]) => `${amount}${unit}`).join('、')
  const lines = [
    `${PERIOD_LABELS[period]}（${range.start} 至 ${range.end}）共有 ${current.length} 条记录，覆盖 ${daysRecorded} 天。`,
    `运动 ${summary.exerciseCount} 次（已知时长 ${summary.exerciseMinutes} 分钟）；睡眠 ${sleepCount} 条（合计 ${Math.round(summary.sleepHours * 10) / 10} 小时）。`,
    `学习 ${summary.learningCount} 次（${summary.learningMinutes} 分钟${learningQuantities ? `，完成 ${learningQuantities}` : ''}）；消费 ¥${summary.expenseAmount.toFixed(2)}；心情 ${moodCount} 条${summary.ratedMoodCount ? `，有评分 ${summary.ratedMoodCount} 条、平均 ${summary.moodAverage?.toFixed(1)} / 5` : '，均未评分'}。`,
    previous.length ? `上一段等长时期有 ${previous.length} 条记录，本段有 ${current.length} 条；记录数量变化不等于生活状态变好或变差。` : '上一段等长时期没有记录，暂时不能比较前后趋势。',
    '反思问题：这些记录里，哪一项符合你的预期？下一段时间你想持续观察哪一项？',
  ]
  return lines.join('\n\n')
}
