import test from 'node:test'
import assert from 'node:assert/strict'
import { countRecordedDays, normalizeLifeRecord, parseDemoLifeText, parseModelLifeCandidates, parseModelLifeRecords, parseModelMealRecords, summarizeLifeRecords } from '../lib/life-records.ts'

const date = '2026-10-20'

test('demo parser identifies four categories without inventing a mood score', () => {
  const records = parseDemoLifeText('跑步30分钟，睡了7小时，花了25元，心情很好', date)
  assert.deepEqual(records.map(record => record.type), ['exercise', 'sleep', 'expense', 'mood'])
  assert.equal(records[0].durationMinutes, 30)
  assert.equal(records[1].hours, 7)
  assert.equal(records[2].amount, 25)
  assert.equal(records[3].score, undefined)
  assert.equal(records[3].needsFields, undefined)
  assert.deepEqual(parseDemoLifeText('今天读了一本书', date), [])
})

test('requested sentence keeps strength training without inventing duration', () => {
  const records = parseDemoLifeText('今天练了胸，卧推60公斤做了4组，睡了7小时，午饭花了38元，心情不错。', date)
  assert.deepEqual(records.map(record => record.type), ['exercise', 'sleep', 'expense', 'mood'])
  assert.deepEqual({ activity: records[0].activity, weightKg: records[0].weightKg, sets: records[0].sets, durationMinutes: records[0].durationMinutes },
    { activity: '卧推', weightKg: 60, sets: 4, durationMinutes: undefined })
  assert.equal(records[1].hours, 7)
  assert.equal(records[2].amount, 38)
  assert.equal(records[3].score, undefined)
  assert.equal(records[3].needsFields, undefined)
  assert.deepEqual(normalizeLifeRecord({ type: 'exercise', activity: '卧推', weightKg: 60 }, date), {
    type: 'exercise', date, activity: '卧推', weightKg: 60, note: '',
  })
  assert.throws(() => normalizeLifeRecord({ type: 'exercise' }, date), /运动内容/)
  assert.deepEqual(parseModelLifeRecords(JSON.stringify({ records: [{ type: 'exercise', activity: '卧推', weightKg: 60, sets: 4 }] }), date), [records[0]])
})

test('learning duration and completed quantities are editable structured records', () => {
  const timed = parseDemoLifeText('今天学习英语45分钟，心情不错', date)
  assert.deepEqual(timed.map(record => record.type), ['learning', 'mood'])
  assert.equal(timed[0].durationMinutes, 45)
  assert.equal(timed[0].subject, '学习英语')
  const counted = parseDemoLifeText('今天做了100道题', date)
  assert.equal(counted[0].type, 'learning')
  assert.equal(counted[0].quantity, 100)
  assert.equal(counted[0].unit, '题')
  const detailed = parseDemoLifeText('今天做了100道低压电工的考试题', date)
  assert.equal(detailed[0].quantity, 100)
  assert.equal(detailed[0].subject, '电工考试题')
  assert.throws(() => normalizeLifeRecord({ type: 'learning', subject: '英语' }, date))
  assert.deepEqual(parseModelLifeRecords(JSON.stringify({ records: [{ type: 'learning', subject: '英语', durationMinutes: 45 }] }), date)[0],
    { type: 'learning', date, subject: '英语', durationMinutes: 45, note: '' })
})

test('model output is validated before preview or storage', () => {
  const raw = '```json\n{"records":[{"type":"expense","date":"2026-10-20","amount":12.345,"note":"咖啡"}]}\n```'
  assert.equal(parseModelLifeRecords(raw, date)[0].amount, 12.35)
  assert.throws(() => normalizeLifeRecord({ type: 'expense', amount: -1 }, date))
  assert.throws(() => normalizeLifeRecord({ type: 'mood', score: 6 }, date))
  assert.throws(() => normalizeLifeRecord({ type: 'sleep', date: '2026-99-20', hours: 7 }, date))
  assert.throws(() => parseModelLifeRecords('{"records":{}}', date))
  assert.throws(() => parseModelLifeRecords('{"records":[{"type":"mood","score":3},{"type":"mood","score":4}]}', date))
})

test('summary uses saved record values', () => {
  const records = parseDemoLifeText('跑步30分钟，睡了7小时，花了25元，心情5分', date)
    .map((record, index) => ({ ...record, id: String(index), sourceText: '测试' }))
  assert.deepEqual(summarizeLifeRecords(records), {
    exerciseCount: 1, exerciseMinutes: 30, learningCount: 0, mealCount: 0, learningMinutes: 0, learningQuantities: {},
    sleepHours: 7, expenseAmount: 25, moodCount: 1, ratedMoodCount: 1, moodAverage: 5,
  })
})

test('remote mood candidates save the description without inventing a score', () => {
  const raw = JSON.stringify({ records: [
    { type: 'mood', date, note: '心情不错', score: 4 },
    { type: 'sleep', date, hours: 7 },
  ] })
  const [mood, sleep] = parseModelLifeCandidates(raw, date, '睡了7小时，心情不错')
  assert.equal(mood.type, 'mood')
  assert.equal(mood.note, '心情不错')
  assert.equal(mood.score, undefined)
  assert.equal(mood.needsFields, undefined)
  assert.equal(sleep.type, 'sleep')
  assert.equal(sleep.hours, 7)
})

test('only a score explicitly stated in the user source is retained', () => {
  const raw = JSON.stringify({ records: [
    { type: 'mood', date, note: '模型改写成心情很好', score: 5 },
  ] })
  const [mood] = parseModelLifeCandidates(raw, date, '今天心情3分')
  assert.equal(mood.note, '模型改写成心情很好')
  assert.equal(mood.score, 3)
  assert.equal(mood.needsFields, undefined)
})

test('vague moods and invalid model scores never become confirmed ratings', () => {
  for (const [text, score] of [['心情一般', 3], ['整个人有点烦躁', 2], ['心情不错', 6], ['心情不错', 3.5]]) {
    const raw = JSON.stringify({ records: [{ type: 'mood', date, note: text, score }] })
    const [mood] = parseModelLifeCandidates(raw, date, text)
    assert.equal(mood.score, undefined, `${text} / ${score}`)
    assert.equal(mood.needsFields, undefined, `${text} / ${score}`)
  }
})

test('explicit mood scores survive the rule parser unchanged', () => {
  const [mood] = parseDemoLifeText('今天心情3分', date)
  assert.equal(mood.type, 'mood')
  assert.equal(mood.score, 3)
  assert.equal(mood.needsFields, undefined)
})

test('a mood description is a complete record while invalid explicit scores still fail', () => {
  for (const note of ['心情一般', '有点烦躁', '心情不错']) {
    assert.deepEqual(normalizeLifeRecord({ type: 'mood', note }, date), { type: 'mood', date, note })
  }
  assert.throws(() => normalizeLifeRecord({ type: 'mood', note: '心情一般', score: 0 }, date), /1–5/)
  assert.throws(() => normalizeLifeRecord({ type: 'mood', note: '心情一般', score: 3.5 }, date), /1–5/)
  assert.deepEqual(normalizeLifeRecord({ type: 'mood', note: '心情3分', score: 3 }, date), {
    type: 'mood', date, note: '心情3分', score: 3,
  })
})

test('unrated moods count as records but do not distort the average score', () => {
  const summary = summarizeLifeRecords([
    { type: 'mood', date, note: '心情一般' },
    { type: 'mood', date, note: '心情不错', score: 4 },
    { type: 'mood', date, note: '有点烦躁', score: 2 },
  ])
  assert.equal(summary.moodCount, 3)
  assert.equal(summary.ratedMoodCount, 2)
  assert.equal(summary.moodAverage, 3)
  const unscored = summarizeLifeRecords([{ type: 'mood', date, note: '心情一般' }])
  assert.equal(unscored.moodCount, 1)
  assert.equal(unscored.ratedMoodCount, 0)
  assert.equal(unscored.moodAverage, null)
})

test('food descriptions are stored without inventing calories', () => {
  const records = parseDemoLifeText('午饭吃了米饭、鸡蛋和青菜，午饭花了38元', date)
  assert.equal(records.find(record => record.type === 'meal')?.food, '米饭、鸡蛋和青菜')
  assert.equal(records.find(record => record.type === 'expense')?.amount, 38)
  assert.equal('calories' in records.find(record => record.type === 'meal'), false)
  assert.equal(parseDemoLifeText('午饭花了38元', date).some(record => record.type === 'meal'), false)
  assert.deepEqual(parseModelMealRecords('{"records":[{"type":"meal","food":"米饭、鸡蛋"}]}', date), [{ type: 'meal', date, food: '米饭、鸡蛋', note: '' }])
  assert.throws(() => parseModelMealRecords('{"records":[{"type":"expense","amount":38}]}', date))
})

test('coverage rings count distinct recorded days rather than arbitrary target values', () => {
  const records = [
    { type: 'learning', date, id: '1', sourceText: '', note: '', subject: '英语', durationMinutes: 30 },
    { type: 'learning', date, id: '2', sourceText: '', note: '', subject: '阅读', durationMinutes: 20 },
    { type: 'learning', date: '2026-10-19', id: '3', sourceText: '', note: '', subject: '英语', durationMinutes: 40 },
  ]
  assert.equal(countRecordedDays(records, 'learning', ['2026-10-19', date]), 2)
  assert.equal(summarizeLifeRecords(records).learningMinutes, 90)
  assert.equal(summarizeLifeRecords(records).learningCount, 3)
  const mixed = [...records, { type: 'learning', date, id: '4', sourceText: '', note: '', subject: '刷题', quantity: 100, unit: '题' },
    { type: 'learning', date, id: '5', sourceText: '', note: '', subject: '阅读', quantity: 20, unit: '页' }]
  assert.deepEqual(summarizeLifeRecords(mixed).learningQuantities, { 题: 100, 页: 20 })
})
