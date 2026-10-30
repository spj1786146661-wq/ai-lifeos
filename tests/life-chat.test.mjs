import test from 'node:test'
import assert from 'node:assert/strict'
import { analysisFacts, analysisWindow, demoAnalysis, detectChatIntent, normalizeAnalysisRecords } from '../lib/life-chat.ts'

test('one message distinguishes life records from weekly, monthly and yearly questions', () => {
  assert.deepEqual(detectChatIntent('今天练了胸，卧推60公斤做了4组，睡了7小时'), { kind: 'record' })
  assert.deepEqual(detectChatIntent('分析最近一周的生活'), { kind: 'analysis', period: 'week' })
  assert.deepEqual(detectChatIntent('我本月学习怎么样？'), { kind: 'analysis', period: 'month' })
  assert.deepEqual(detectChatIntent('复盘最近一年的变化'), { kind: 'analysis', period: 'year' })
})

test('analysis uses only confirmed saved records in the selected rolling window', () => {
  const today = '2026-10-20'
  assert.deepEqual(analysisWindow('week', today), { start: '2026-10-14', end: today, previousStart: '2026-10-07', previousEnd: '2026-10-13' })
  const records = normalizeAnalysisRecords([
    { type: 'exercise', date: today, activity: '卧推', sets: 4, weightKg: 60, note: '' },
    { type: 'sleep', date: today, hours: 7, note: '' },
    { type: 'expense', date: '2026-10-10', amount: 38, note: '' },
    { type: 'learning', date: '2026-01-01', subject: '英语', durationMinutes: 30, note: '' },
  ], today)
  const facts = analysisFacts(records, 'week', today)
  assert.equal(facts.current.length, 2)
  assert.equal(facts.previous.length, 1)
  assert.equal(facts.summary.exerciseCount, 1)
  assert.equal(facts.summary.sleepHours, 7)
  assert.equal(facts.summary.expenseAmount, 0)
  assert.match(demoAnalysis(records, 'week', today), /运动 1 次/)
  assert.match(demoAnalysis(records, 'week', today), /未调用|反思问题/)
  assert.throws(() => normalizeAnalysisRecords([{ type: 'expense', amount: -1 }], today))
})

test('empty analysis does not invent progress or activity', () => {
  const answer = demoAnalysis([], 'year', '2026-10-20')
  assert.match(answer, /没有已保存记录/)
  assert.match(answer, /无法从数据判断变化/)
})
