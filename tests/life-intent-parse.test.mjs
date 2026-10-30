import test from 'node:test'
import assert from 'node:assert/strict'
import { parseFragmentCandidates, parseMessageCandidates } from '../lib/life-intent-parse.ts'
import { splitSourceSentences } from '../lib/life-source-fragments.ts'

const DATE = '2026-10-22'
const OPTIONS = { messageId: 'message-1', date: DATE }

const summary = (candidate) => {
  const { draft } = candidate
  const fields = Object.entries(draft)
    .filter(([key]) => !['type', 'date', 'note', 'sourceRef', 'candidate', 'needsFields', 'missingReason'].includes(key))
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
    .join(' ')
  return `${draft.type}${fields ? ' ' + fields : ''}`
}

const typesOf = (text) => parseMessageCandidates(text, OPTIONS).candidates.map(candidate => candidate.draft.type)

test('one message yields several categories from different sentences', () => {
  const text = '昨晚睡了7个小时，早上去健身房练胸，卧推60公斤做了4组，中午吃了一碗牛肉面花了28块，下午学了两个小时英语，晚上心情不错。'
  const found = parseMessageCandidates(text, OPTIONS).candidates.map(summary)
  assert.ok(found.some(item => item.startsWith('sleep hours=7')), found.join(' | '))
  assert.ok(found.some(item => item.startsWith('exercise activity="卧推" weightKg=60 sets=4')), found.join(' | '))
  assert.ok(found.some(item => item.startsWith('meal food="一碗牛肉面"')), found.join(' | '))
  assert.ok(found.some(item => item.startsWith('expense amount=28')), found.join(' | '))
  assert.ok(found.some(item => item.startsWith('learning subject="英语" durationMinutes=120')), found.join(' | '))
  const mood = parseMessageCandidates(text, OPTIONS).candidates.find(candidate => candidate.draft.type === 'mood')
  assert.ok(mood, found.join(' | '))
  assert.equal(mood.draft.note, '心情不错')
  assert.equal(mood.draft.score, undefined)
  assert.equal(mood.needsFields, false)
})

test('a single clause can produce both a meal and an expense', () => {
  const found = parseMessageCandidates('中午吃了一碗牛肉面花了28块', OPTIONS).candidates.map(summary)
  assert.deepEqual(found, ['meal food="一碗牛肉面"', 'expense amount=28 currency="CNY"'])
})

test('two different categories in one message are not collapsed into one', () => {
  const found = parseMessageCandidates('今天花了30元买午餐，下午去健身房练了胸。', OPTIONS).candidates.map(summary)
  assert.ok(found.some(item => item.startsWith('expense amount=30')), found.join(' | '))
  assert.ok(found.some(item => item.startsWith('exercise')), found.join(' | '))
})

test('a training detail and its bare mention are not saved as two workouts', () => {
  const { candidates } = parseMessageCandidates('早上去健身房练胸，卧推60公斤做了4组。', OPTIONS)
  const exercises = candidates.filter(candidate => candidate.draft.type === 'exercise')
  assert.equal(exercises.length, 1)
  assert.equal(exercises[0].draft.weightKg, 60)
  assert.equal(exercises[0].needsFields, false)
})

test('Chinese numerals are understood', () => {
  const found = parseMessageCandidates('下午学了两个小时英语，跑了半小时。', OPTIONS).candidates.map(summary)
  assert.ok(found.some(item => item.startsWith('learning subject="英语" durationMinutes=120')), found.join(' | '))
  assert.ok(found.some(item => item.includes('durationMinutes=30')), found.join(' | '))
})

test('half-hour expressions and comma-split strength details stay attached to their records', () => {
  const text = '昨晚睡了7个半小时，睡醒感觉一般。今天在健身房卧推60公斤，做了4组。中午吃了一碗牛肉面。'
  const { candidates, unmatched } = parseMessageCandidates(text, OPTIONS)
  assert.deepEqual(candidates.map(candidate => candidate.draft.type), ['sleep', 'exercise', 'meal'])
  assert.equal(candidates[0].draft.hours, 7.5)
  assert.equal(candidates[0].draft.sourceRef?.text, '昨晚睡了7个半小时')
  assert.equal(candidates[1].draft.activity, '卧推')
  assert.equal(candidates[1].draft.weightKg, 60)
  assert.equal(candidates[1].draft.sets, 4)
  assert.equal(candidates[1].draft.durationMinutes, undefined)
  assert.equal(candidates[1].draft.sourceRef?.text, '卧推60公斤，做了4组')
  assert.equal(candidates[2].draft.food, '一碗牛肉面')
  assert.deepEqual(unmatched.map(fragment => fragment.text), ['睡醒感觉一般'])

  const [chineseHalfHour] = parseMessageCandidates('昨晚睡了七个半小时。', OPTIONS).candidates
  assert.equal(chineseHalfHour.draft.hours, 7.5)
})

test('reading is recognised as study time', () => {
  assert.ok(typesOf('下午看了两个小时书').includes('learning'))
  assert.ok(typesOf('看了一会儿书').includes('learning'))
})

test('a distance-only workout is offered as a candidate that still needs a duration', () => {
  const [candidate] = parseMessageCandidates('早上跑了5公里', OPTIONS).candidates
  assert.equal(candidate.draft.type, 'exercise')
  assert.equal(candidate.draft.activity, '跑步')
  assert.equal(candidate.needsFields, true)
  assert.match(candidate.missingReason ?? '', /运动时长/)
  assert.match(candidate.missingReason ?? '', /5 公里/)
  assert.equal(candidate.draft.durationMinutes, undefined)
})

test('a mentioned category with no number is offered for completion, never guessed', () => {
  const sleep = parseMessageCandidates('昨晚没睡好', OPTIONS).candidates
  assert.equal(sleep.length, 1)
  assert.equal(sleep[0].draft.type, 'sleep')
  assert.equal(sleep[0].needsFields, true)
  assert.equal(sleep[0].draft.hours, undefined)

  const study = parseMessageCandidates('学了英语', OPTIONS).candidates
  assert.equal(study.length, 1)
  assert.equal(study[0].needsFields, true)
  assert.equal(study[0].draft.durationMinutes, undefined)

  const spend = parseMessageCandidates('买了杯咖啡', OPTIONS).candidates
  assert.equal(spend.length, 1)
  assert.equal(spend[0].needsFields, true)
  assert.equal(spend[0].draft.amount, undefined)

  const workout = parseMessageCandidates('去健身房练了腿', OPTIONS).candidates
  assert.equal(workout.length, 1)
  assert.equal(workout[0].needsFields, true)
  assert.equal(workout[0].draft.durationMinutes, undefined)
})

test('an unmentioned field is never invented', () => {
  const found = parseMessageCandidates('午饭吃了牛肉面，心情不错。', OPTIONS).candidates.map(summary)
  assert.deepEqual(found, ['meal food="牛肉面"', 'mood'])
})

test('a vague mood keeps the words and saves without inventing a score', () => {
  const [mood] = parseMessageCandidates('晚上心情不错。', OPTIONS).candidates
  assert.equal(mood.draft.type, 'mood')
  assert.equal(mood.draft.note, '心情不错')
  assert.equal(mood.draft.score, undefined)
  assert.equal(mood.needsFields, false)
})

test('an explicit mood score is parsed as spoken', () => {
  const [mood] = parseMessageCandidates('今天心情3分。', OPTIONS).candidates
  assert.equal(mood.draft.type, 'mood')
  assert.equal(mood.draft.score, 3)
  assert.equal(mood.needsFields, false)
})

test('every candidate points back to a real span of the original message', () => {
  const text = '昨晚睡了7个小时，下午学了两个小时英语。'
  const { candidates } = parseMessageCandidates(text, OPTIONS)
  assert.ok(candidates.length >= 2)
  for (const candidate of candidates) {
    assert.equal(text.slice(candidate.span.start, candidate.span.end), candidate.span.text)
    assert.equal(candidate.draft.sourceRef?.text, candidate.span.text)
    assert.equal(candidate.draft.sourceRef?.messageId, 'message-1')
    assert.equal(candidate.draft.sourceRef?.origin, 'ai')
  }
})

test('fragments that produce nothing are returned for manual tagging', () => {
  const { candidates, unmatched } = parseMessageCandidates('今天天气很好。随便说了一句。', OPTIONS)
  assert.equal(candidates.length, 0)
  assert.deepEqual(unmatched.map(sentence => sentence.text), ['今天天气很好', '随便说了一句'])
})

test('repeating the same fact inside one message keeps one record', () => {
  const { candidates } = parseMessageCandidates('睡了7小时。又睡了个午觉，睡了7小时。', OPTIONS)
  const complete = candidates.filter(candidate => candidate.draft.hours === 7)
  assert.equal(complete.length, 1, JSON.stringify(candidates.map(summary)))
})

test('parsing does not mutate the source text', () => {
  const text = '中午吃了一碗牛肉面花了28块。'
  const before = structuredClone(splitSourceSentences(text))
  parseMessageCandidates(text, OPTIONS)
  assert.deepEqual(splitSourceSentences(text), before)
})

test('a single fragment can be parsed on its own', () => {
  const text = '午饭花了38元，心情不错。'
  const [sentence] = splitSourceSentences(text)
  const found = parseFragmentCandidates(sentence, text, OPTIONS).map(summary)
  assert.deepEqual(found, ['expense amount=38 currency="CNY"'])
})

test('an empty message yields no candidates', () => {
  const { candidates, unmatched } = parseMessageCandidates('   ', OPTIONS)
  assert.equal(candidates.length, 0)
  assert.equal(unmatched.length, 0)
})

test('a message with only punctuation yields no candidates', () => {
  const { candidates } = parseMessageCandidates('。。。！！', OPTIONS)
  assert.equal(candidates.length, 0)
})

test('study subject before the duration is understood', () => {
  const cases = [
    ['学习英语45分钟', '英语', 45],
    ['今天学英语45分钟', '英语', 45],
    ['背单词30分钟', '背单词', 30],
    ['复习数学两个小时', '数学', 120],
    ['看书一小时', '书', 60],
    ['学了两个小时英语', '英语', 120],
  ]
  for (const [text, subject, minutes] of cases) {
    const [candidate] = parseMessageCandidates(text, OPTIONS).candidates
    assert.ok(candidate, text)
    assert.equal(candidate.draft.type, 'learning', text)
    assert.equal(candidate.draft.subject, subject, text)
    assert.equal(candidate.draft.durationMinutes, minutes, text)
    assert.equal(candidate.needsFields, false, text)
  }
})

test('a study mention with no duration still reaches the review cards', () => {
  const [candidate] = parseMessageCandidates('学了英语', OPTIONS).candidates
  assert.equal(candidate.draft.type, 'learning')
  assert.equal(candidate.draft.subject, '英语')
  assert.equal(candidate.needsFields, true)
  assert.equal(candidate.draft.durationMinutes, undefined)
})
