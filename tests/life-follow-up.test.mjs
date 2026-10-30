import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  applyFollowUpAnswer,
  canGenerateNextFollowUpRound,
  deriveRuleFollowUpQuestions,
  filterKnownFollowUps,
  followUpsFromModelOutput,
  historyFromMappedFollowUps,
  mapFollowUpsToSavedRecords,
  nextFollowUpRound,
  normalizeFollowUpQuestions,
  normalizeSavedRecordFollowUpQuestions,
  parseFollowUpAnswer,
  shouldShowSmartFollowUpPanel,
  smartFollowUpZeroQuestionMessage,
  SMART_FOLLOW_UP_COMPLETION_TEXT,
  updateFollowUpHistoryStatus,
} from '../lib/life-follow-up.ts'
import {
  followUpSessionRecordIds,
  parseFollowUpSessionSnapshot,
  serializeFollowUpSessionSnapshot,
} from '../lib/life-follow-up-session.ts'
import { normalizeLifeRecord } from '../lib/life-records.ts'

const date = '2026-10-26'
const sourceRef = {
  messageId: 'message-1',
  start: 0,
  end: 8,
  text: '卧推60公斤',
  origin: 'ai',
  provider: 'chatgpt',
  model: 'gpt-test',
}

function exerciseRecord(overrides = {}) {
  return {
    id: 'record-exercise',
    type: 'exercise',
    date,
    note: '',
    activity: '卧推',
    weightKg: 60,
    sets: 4,
    sourceText: '卧推60公斤4组',
    sourceRef,
    createdAt: '2026-10-26T08:00:00.000Z',
    ...overrides,
  }
}

test('model questions are schema checked, deduplicated and limited to three', () => {
  const drafts = [
    { type: 'exercise', date, note: '', activity: '卧推', weightKg: 60, sets: 4 },
    { type: 'sleep', date, note: '', hours: 7 },
  ]
  const questions = normalizeFollowUpQuestions([
    { id: 'q1', recordIndex: 0, type: 'exercise', field: 'durationMinutes', question: '运动持续了多少分钟？', round: 1 },
    { id: 'q1', recordIndex: 0, type: 'exercise', field: 'durationMinutes', question: '重复字段', round: 1 },
    { id: 'q1', recordIndex: 0, type: 'exercise', field: 'weightKg', question: '重量是多少？', round: 1 },
    { id: 'q2', recordIndex: 1, type: 'sleep', field: 'hours', question: '睡了几小时？', round: 1 },
    { id: 'q3', recordIndex: 1, type: 'sleep', field: 'score', question: '不适用字段', round: 1 },
    { id: 'q4', recordIndex: 9, type: 'sleep', field: 'hours', question: '越界索引', round: 1 },
  ], drafts)
  assert.equal(questions.length, 3)
  assert.deepEqual(questions.map(question => question.field), ['durationMinutes', 'weightKg', 'hours'])
  assert.deepEqual(questions.map(question => question.origin), ['ai', 'ai', 'ai'])
  assert.equal(new Set(questions.map(question => question.id)).size, 3)
})

test('rule questions only request missing fields and are labelled as rule output', () => {
  const questions = deriveRuleFollowUpQuestions([
    { type: 'exercise', date, note: '', activity: '跑步', durationMinutes: 30 },
    { type: 'mood', date, note: '心情一般' },
  ])
  assert.equal(questions.length, 3)
  assert.equal(questions.some(question => question.type === 'exercise' && question.field === 'durationMinutes'), false)
  assert.equal(questions.every(question => question.origin === 'rule'), true)
})

test('answers are parsed only when their unit is explicit or the question permits a bare number', () => {
  const base = {
    id: 'q',
    recordIndex: 0,
    type: 'exercise',
    question: '测试',
    round: 1,
    origin: 'rule',
  }
  assert.equal(parseFollowUpAnswer('45分钟', { ...base, field: 'durationMinutes' }), 45)
  assert.equal(parseFollowUpAnswer('1.5小时', { ...base, field: 'durationMinutes' }), 90)
  assert.equal(parseFollowUpAnswer('45', { ...base, field: 'durationMinutes' }), null)
  assert.equal(parseFollowUpAnswer('60公斤', { ...base, field: 'weightKg' }), 60)
  assert.equal(parseFollowUpAnswer('4组', { ...base, field: 'sets' }), 4)
  assert.equal(parseFollowUpAnswer('每组8次', { ...base, field: 'repsPerSet' }), 8)
  assert.equal(parseFollowUpAnswer('仍然困倦', { ...base, type: 'sleep', field: 'wakeFeeling' }), '仍然困倦')
  assert.equal(parseFollowUpAnswer('3分', { ...base, field: 'score' }), 3)
  assert.equal(parseFollowUpAnswer('大概挺好', { ...base, field: 'score' }), null)
})

test('exercise reps and sleep wake feeling update only their original records', () => {
  const exercise = exerciseRecord()
  const exerciseDraft = applyFollowUpAnswer(exercise, {
    questionId: 'q-reps',
    recordIndex: 0,
    type: 'exercise',
    field: 'repsPerSet',
    question: '卧推每组做了多少次？',
    answer: '每组8次',
    round: 1,
  }, '2026-10-26T09:00:00.000Z')
  assert.equal(exerciseDraft.repsPerSet, 8)
  assert.equal(exerciseDraft.sets, 4)

  const sleep = {
    id: 'record-sleep',
    type: 'sleep',
    date,
    note: '',
    hours: 7.5,
    sourceText: '昨晚睡了7个半小时，睡醒感觉一般',
    createdAt: '2026-10-26T08:00:00.000Z',
  }
  const sleepDraft = applyFollowUpAnswer(sleep, {
    questionId: 'q-wake',
    recordIndex: 1,
    type: 'sleep',
    field: 'wakeFeeling',
    question: '醒来感觉一般，具体是仍然困倦还是身体疲惫？',
    answer: '仍然困倦',
    round: 1,
  }, '2026-10-26T09:00:00.000Z')
  assert.equal(sleepDraft.wakeFeeling, '仍然困倦')
  assert.equal(sleepDraft.hours, 7.5)
  assert.equal(exercise.repsPerSet, undefined)
})

test('a valid answer updates the original record and retains provenance and attachments', () => {
  const original = exerciseRecord({
    attachments: [{
      id: 'attachment-1',
      name: 'gym.png',
      mimeType: 'image/png',
      size: 123,
      sha256: 'a'.repeat(64),
    }],
  })
  const snapshot = structuredClone(original)
  const draft = applyFollowUpAnswer(original, {
    questionId: 'q-duration',
    recordIndex: 0,
    type: 'exercise',
    field: 'durationMinutes',
    question: '运动持续了多少分钟？',
    answer: '45分钟',
    round: 1,
  }, '2026-10-26T09:00:00.000Z', {
    origin: 'ai',
    provider: 'chatgpt',
    model: 'gpt-test',
  })
  assert.deepEqual(original, snapshot)
  assert.equal(draft.durationMinutes, 45)
  assert.deepEqual(draft.sourceRef, sourceRef)
  assert.deepEqual(draft.attachments, original.attachments)
  assert.equal(draft.supplements.length, 1)
  assert.deepEqual(draft.supplements[0], {
    id: 'q-duration',
    question: '运动持续了多少分钟？',
    answer: '45分钟',
    field: 'durationMinutes',
    origin: 'ai',
    provider: 'chatgpt',
    model: 'gpt-test',
    round: 1,
    createdAt: '2026-10-26T09:00:00.000Z',
  })
  assert.equal('id' in draft, false)
  assert.equal('sourceText' in draft, false)
})

test('conflicting values are rejected instead of silently overwriting facts', () => {
  assert.throws(() => applyFollowUpAnswer(exerciseRecord(), {
    questionId: 'q-weight',
    recordIndex: 0,
    type: 'exercise',
    field: 'weightKg',
    question: '重量是多少？',
    answer: '65公斤',
    round: 1,
  }), /冲突/)
})

test('duplicate question and same-round field submissions are rejected', () => {
  const record = exerciseRecord({
    supplements: [{
      id: 'q1',
      question: '运动持续了多少分钟？',
      answer: '45分钟',
      field: 'durationMinutes',
      origin: 'rule',
      round: 1,
      createdAt: '2026-10-26T09:00:00.000Z',
    }],
  })
  assert.throws(() => applyFollowUpAnswer(record, {
    questionId: 'q1',
    recordIndex: 0,
    type: 'exercise',
    field: 'durationMinutes',
    question: '运动持续了多少分钟？',
    answer: '45分钟',
    round: 1,
  }), /已经回答/)
  assert.throws(() => applyFollowUpAnswer(record, {
    questionId: 'q-other',
    recordIndex: 0,
    type: 'exercise',
    field: 'durationMinutes',
    question: '另一个问题',
    answer: '45分钟',
    round: 1,
  }), /已经回答/)
})

test('late answers from an older round are rejected', () => {
  const record = exerciseRecord({
    supplements: [{
      id: 'round-2',
      question: '第二轮问题',
      answer: '45分钟',
      field: 'durationMinutes',
      origin: 'rule',
      round: 2,
      createdAt: '2026-10-26T09:00:00.000Z',
    }],
  })
  assert.throws(() => applyFollowUpAnswer(record, {
    questionId: 'late-round-1',
    recordIndex: 0,
    type: 'exercise',
    field: 'activity',
    question: '旧问题',
    answer: '跑步',
    round: 1,
  }), /已经过期/)
})

test('round two and three contain only still-missing fields, then stop', () => {
  const first = deriveRuleFollowUpQuestions([{ type: 'learning', date, note: '', subject: '英语' }])
  assert.equal(first[0].round, 1)
  const second = nextFollowUpRound({
    id: 'learning-1',
    type: 'learning',
    date,
    note: '',
    subject: '英语',
    durationMinutes: 45,
    sourceText: '学英语45分钟',
    supplements: [{
      id: 'q-duration',
      question: '多久？',
      answer: '45分钟',
      field: 'durationMinutes',
      origin: 'rule',
      round: 1,
      createdAt: '2026-10-26T09:00:00.000Z',
    }],
  }, 0, 1)
  assert.equal(second.every(question => question.round === 2), true)
  assert.equal(second.some(question => question.field === 'durationMinutes'), false)
  assert.deepEqual(nextFollowUpRound(exerciseRecord(), 0, 3), [])
})

test('questions are mapped from parser indexes to records that were actually saved', () => {
  const questions = normalizeFollowUpQuestions([
    { id: 'q0', recordIndex: 0, field: 'hours', question: '睡了几小时？' },
    { id: 'q1', recordIndex: 1, field: 'amount', question: '花了多少钱？' },
    { id: 'q2', recordIndex: 2, field: 'durationMinutes', question: '学了多久？' },
  ], [
    { type: 'sleep', date, note: '', hours: 7 },
    { type: 'expense', date, note: '', amount: 20 },
    { type: 'learning', date, note: '', subject: '英语' },
  ])
  const saved = [
    { id: 'saved-sleep', type: 'sleep', date, note: '', hours: 7, sourceText: '睡7小时' },
    { id: 'saved-learning', type: 'learning', date, note: '', subject: '英语', durationMinutes: 60, sourceText: '学英语1小时' },
  ]
  const mapped = mapFollowUpsToSavedRecords(questions, [0, 1], [1], saved)
  assert.deepEqual(mapped.map(item => item.recordId), ['saved-sleep'])
  const allSaved = mapFollowUpsToSavedRecords(questions, [0, 1, 2], [], [
    { id: 'saved-sleep', type: 'sleep', date, note: '', hours: 7, sourceText: '睡7小时' },
    { id: 'saved-expense', type: 'expense', date, note: '', amount: 20, sourceText: '花20元' },
    { id: 'saved-learning', type: 'learning', date, note: '', subject: '英语', durationMinutes: 60, sourceText: '学英语1小时' },
  ])
  assert.deepEqual(allSaved.map(item => item.recordId), ['saved-sleep', 'saved-expense', 'saved-learning'])
})

test('known fields are filtered and malformed follow-up JSON never affects saved records', () => {
  const drafts = [{ type: 'sleep', date, note: '', hours: 7 }]
  const questions = normalizeFollowUpQuestions([
    { id: 'known', recordIndex: 0, field: 'hours', question: '睡了多久？' },
  ], drafts)
  assert.deepEqual(filterKnownFollowUps(questions, drafts), [])
  assert.deepEqual(followUpsFromModelOutput('not json', drafts), [])
  assert.deepEqual(followUpsFromModelOutput('{"records":[{"type":"sleep"}]}', drafts), [])
})

test('legacy supplements without a round remain readable and valid', () => {
  const normalized = normalizeLifeRecord({
    type: 'exercise',
    date,
    note: '',
    activity: '卧推',
    sets: 4,
    supplements: [{
      id: 'legacy',
      question: '多久？',
      answer: '30分钟',
      field: 'durationMinutes',
      origin: 'rule',
      createdAt: '2026-10-26T09:00:00.000Z',
    }],
  }, date)
  assert.equal(normalized.supplements[0].round, undefined)
  assert.equal(normalized.supplements[0].id, 'legacy')
})

test('one parser response can recommend questions for different saved records', () => {
  const drafts = [
    { type: 'sleep', date, note: '', hours: 7.5 },
    { type: 'exercise', date, note: '', activity: '卧推', weightKg: 60, sets: 4 },
    { type: 'meal', date, note: '', food: '牛肉面' },
  ]
  const questions = normalizeFollowUpQuestions([
    {
      questionId: 'sleep-hours',
      recordIndex: 0,
      recordType: 'sleep',
      targetField: 'hours',
      question: '睡眠时长是否还有更精确的数字？',
      round: 1,
      priority: 2,
    },
    {
      questionId: 'exercise-duration',
      recordIndex: 1,
      recordType: 'exercise',
      targetField: 'durationMinutes',
      question: '这次卧推训练持续了多少分钟？',
      round: 1,
      priority: 1,
    },
  ], drafts)
  const saved = [
    { id: 'sleep-1', ...drafts[0], sourceText: '睡7个半小时' },
    { id: 'exercise-1', ...drafts[1], sourceText: '卧推60公斤4组' },
    { id: 'meal-1', ...drafts[2], sourceText: '牛肉面' },
  ]
  const mapped = mapFollowUpsToSavedRecords(questions, [0, 1, 2], [], saved)
  assert.deepEqual(mapped.map(item => item.recordId), ['exercise-1', 'sleep-1'])
  assert.deepEqual(mapped.map(item => item.question.recordType), ['exercise', 'sleep'])
  assert.deepEqual(mapped.map(item => item.question.priority), [1, 2])
})

test('joint assessment may return one question, zero questions, or three prioritized questions', () => {
  const drafts = [
    { type: 'sleep', date, note: '', hours: 7.5 },
    { type: 'exercise', date, note: '', activity: '卧推', weightKg: 60, sets: 4 },
    { type: 'meal', date, note: '', food: '牛肉面' },
  ]
  const one = normalizeFollowUpQuestions([
    { questionId: 'one', recordIndex: 1, targetField: 'durationMinutes', question: '训练多久？', priority: 1 },
  ], drafts)
  assert.equal(one.length, 1)
  assert.deepEqual(filterKnownFollowUps(normalizeFollowUpQuestions([
    { questionId: 'sleep-known', recordIndex: 0, targetField: 'hours', question: '睡多久？' },
    { questionId: 'weight-known', recordIndex: 1, targetField: 'weightKg', question: '重量？' },
    { questionId: 'food-known', recordIndex: 2, targetField: 'food', question: '吃了什么？' },
  ], drafts), drafts), [])
  const three = normalizeFollowUpQuestions([
    { questionId: 'meal', recordIndex: 2, targetField: 'food', question: '具体食物？', priority: 3 },
    { questionId: 'sleep', recordIndex: 0, targetField: 'hours', question: '睡眠时长？', priority: 2 },
    { questionId: 'exercise', recordIndex: 1, targetField: 'durationMinutes', question: '训练时长？', priority: 1 },
    { questionId: 'extra', recordIndex: 1, targetField: 'sets', question: '组数？', priority: 4 },
  ], drafts)
  assert.equal(three.length, 3)
  assert.deepEqual(three.map(item => item.questionId), ['exercise', 'sleep', 'meal'])
})

test('answers update only their target records and never create duplicate records', () => {
  const sleep = {
    id: 'sleep-1',
    type: 'sleep',
    date,
    note: '睡醒一般',
    sourceText: '昨晚睡醒感觉一般',
  }
  const exercise = exerciseRecord({ id: 'exercise-1' })
  const meal = {
    id: 'meal-1',
    type: 'meal',
    date,
    note: '',
    food: '牛肉面',
    sourceText: '牛肉面',
  }
  const sleepSnapshot = structuredClone(sleep)
  const exerciseSnapshot = structuredClone(exercise)
  const mealSnapshot = structuredClone(meal)
  const updatedSleep = applyFollowUpAnswer(sleep, {
    questionId: 'sleep-hours',
    recordIndex: 0,
    type: 'sleep',
    field: 'hours',
    question: '睡眠时长？',
    answer: '7.5小时',
    round: 1,
  })
  assert.equal(updatedSleep.hours, 7.5)
  assert.deepEqual(sleep, sleepSnapshot)
  assert.deepEqual(exercise, exerciseSnapshot)
  assert.deepEqual(meal, mealSnapshot)
  const updatedExercise = applyFollowUpAnswer(exercise, {
    questionId: 'exercise-duration',
    recordIndex: 1,
    type: 'exercise',
    field: 'durationMinutes',
    question: '训练多久？',
    answer: '45分钟',
    round: 1,
  })
  assert.equal(updatedExercise.durationMinutes, 45)
  assert.equal('id' in updatedExercise, false)
  assert.equal(updatedExercise.type, 'exercise')
  assert.equal(updatedExercise.activity, '卧推')
})

test('skipping one question keeps other questions answerable and records skip state', () => {
  const questions = normalizeFollowUpQuestions([
    { questionId: 'sleep-q', recordIndex: 0, targetField: 'hours', question: '睡眠时长？', priority: 1 },
    { questionId: 'exercise-q', recordIndex: 1, targetField: 'durationMinutes', question: '训练时长？', priority: 2 },
  ], [
    { type: 'sleep', date, note: '' },
    { type: 'exercise', date, note: '', activity: '卧推' },
  ])
  const history = historyFromMappedFollowUps(questions.map((question, index) => ({
    question,
    recordId: index === 0 ? 'sleep-1' : 'exercise-1',
  })))
  const skipped = updateFollowUpHistoryStatus(history, 'sleep-q', 'skipped')
  const answered = updateFollowUpHistoryStatus(skipped, 'exercise-q', 'answered', '45分钟')
  assert.equal(answered.find(item => item.questionId === 'sleep-q').status, 'skipped')
  assert.equal(answered.find(item => item.questionId === 'exercise-q').status, 'answered')
  assert.equal(answered.find(item => item.questionId === 'exercise-q').answer, '45分钟')
})

test('dynamic rounds evaluate all updated records and do not repeat answered or skipped fields', () => {
  const records = [
    {
      id: 'exercise-1',
      type: 'exercise',
      date,
      note: '',
      activity: '卧推',
      durationMinutes: 45,
      sets: 4,
      sourceText: '卧推4组45分钟',
    },
    {
      id: 'learning-1',
      type: 'learning',
      date,
      note: '',
      subject: '英语',
      sourceText: '学英语',
    },
  ]
  const history = [
    {
      questionId: 'duration-q',
      targetRecordId: 'exercise-1',
      recordType: 'exercise',
      targetField: 'durationMinutes',
      question: '训练多久？',
      round: 1,
      priority: 1,
      status: 'answered',
      answer: '45分钟',
    },
    {
      questionId: 'quantity-q',
      targetRecordId: 'learning-1',
      recordType: 'learning',
      targetField: 'quantity',
      question: '完成多少题？',
      round: 1,
      priority: 2,
      status: 'skipped',
    },
  ]
  const roundTwo = normalizeSavedRecordFollowUpQuestions([
    { questionId: 'repeat-duration', targetRecordId: 'exercise-1', targetField: 'durationMinutes', question: '训练多久？', priority: 1 },
    { questionId: 'weight-q', targetRecordId: 'exercise-1', targetField: 'weightKg', question: '用了多少公斤？', priority: 2 },
    { questionId: 'repeat-quantity', targetRecordId: 'learning-1', targetField: 'quantity', question: '完成多少题？', priority: 3 },
    { questionId: 'outside', targetRecordId: 'other-record', targetField: 'hours', question: '睡多久？', priority: 1 },
  ], records, 2, history)
  assert.deepEqual(roundTwo.map(item => item.questionId), ['weight-q'])
  assert.equal(roundTwo[0].targetRecordId, 'exercise-1')
  assert.equal(roundTwo[0].recordType, 'exercise')

  const roundThreeHistory = [
    ...history,
    {
      questionId: 'weight-q',
      targetRecordId: 'exercise-1',
      recordType: 'exercise',
      targetField: 'weightKg',
      question: '用了多少公斤？',
      round: 2,
      priority: 1,
      status: 'answered',
      answer: '60公斤',
    },
  ]
  const updatedRecords = records.map(record => record.id === 'exercise-1'
    ? { ...record, weightKg: 60 }
    : record)
  const roundThree = normalizeSavedRecordFollowUpQuestions([
    { questionId: 'repeat-weight', targetRecordId: 'exercise-1', targetField: 'weightKg', question: '用了多少公斤？', priority: 1 },
    { questionId: 'repeat-quantity', targetRecordId: 'learning-1', targetField: 'quantity', question: '完成多少题？', priority: 2 },
  ], updatedRecords, 3, roundThreeHistory)
  assert.deepEqual(roundThree, [])
})

test('follow-up round session survives refresh and preserves answered and pending state', () => {
  const questions = normalizeFollowUpQuestions([
    { questionId: 'sleep-q', recordIndex: 0, targetField: 'hours', question: '睡眠时长？', priority: 1 },
    { questionId: 'exercise-q', recordIndex: 1, targetField: 'durationMinutes', question: '训练时长？', priority: 2 },
  ], [
    { type: 'sleep', date, note: '' },
    { type: 'exercise', date, note: '', activity: '卧推' },
  ])
  const history = updateFollowUpHistoryStatus(
    historyFromMappedFollowUps([
      { question: questions[0], recordId: 'sleep-1' },
      { question: questions[1], recordId: 'exercise-1' },
    ]),
    'sleep-q',
    'answered',
    '7.5小时',
  )
  const snapshot = {
    version: 1,
    messageId: 'message-session',
    round: 2,
    ended: false,
    recordIds: ['sleep-1', 'exercise-1'],
    items: [{ question: questions[1], recordId: 'exercise-1' }],
    history,
  }
  const restored = parseFollowUpSessionSnapshot(serializeFollowUpSessionSnapshot(snapshot))
  assert.equal(restored.messageId, 'message-session')
  assert.equal(restored.round, 2)
  assert.equal(restored.items[0].recordId, 'exercise-1')
  assert.deepEqual(restored.recordIds.sort(), ['exercise-1', 'sleep-1'])
  assert.equal(restored.history.find(item => item.questionId === 'sleep-q').status, 'answered')
  assert.equal(restored.history.find(item => item.questionId === 'sleep-q').answer, '7.5小时')
})

test('refresh keeps every record from the saved batch for later cross-record rounds', () => {
  const restored = parseFollowUpSessionSnapshot(JSON.stringify({
    version: 1,
    messageId: 'message-all-records',
    round: 1,
    ended: false,
    recordIds: ['sleep-1', 'exercise-1', 'meal-1'],
    items: [],
    history: [],
  }))
  assert.deepEqual(restored.recordIds, ['sleep-1', 'exercise-1', 'meal-1'])
  assert.deepEqual(followUpSessionRecordIds(restored), ['sleep-1', 'exercise-1', 'meal-1'])
})

test('older saved follow-up sessions still recover their known record ids', () => {
  const question = normalizeSavedRecordFollowUpQuestions([
    { questionId: 'sleep-q', targetRecordId: 'sleep-1', targetField: 'hours', question: '睡了多久？', priority: 1 },
  ], [
    { id: 'sleep-1', type: 'sleep', date, note: '', sourceText: '昨晚睡了很久' },
  ], 1, [])[0]
  const restored = parseFollowUpSessionSnapshot(JSON.stringify({
    version: 1,
    messageId: 'legacy-session',
    round: 1,
    ended: false,
    items: [{ question, recordId: 'sleep-1' }],
    history: [{
      questionId: 'exercise-q',
      targetRecordId: 'exercise-1',
      recordType: 'exercise',
      targetField: 'durationMinutes',
      question: '练了多久？',
      round: 1,
      priority: 2,
      status: 'pending',
    }],
  }))
  assert.deepEqual(followUpSessionRecordIds(restored).sort(), ['exercise-1', 'sleep-1'])
})

test('refresh restore keeps pending questions while still excluding answered fields', () => {
  const records = [
    { id: 'sleep-1', type: 'sleep', date, note: '', sourceText: '昨晚睡了很久' },
    { id: 'exercise-1', type: 'exercise', date, note: '', activity: '卧推', sourceText: '卧推' },
  ]
  const pendingQuestion = normalizeSavedRecordFollowUpQuestions([
    { questionId: 'sleep-pending', targetRecordId: 'sleep-1', targetField: 'hours', question: '实际睡了几个小时？', priority: 1 },
  ], records, 1, [])[0]
  const history = updateFollowUpHistoryStatus([
    ...historyFromMappedFollowUps([{ question: pendingQuestion, recordId: 'sleep-1' }]),
    {
      questionId: 'exercise-answered',
      targetRecordId: 'exercise-1',
      recordType: 'exercise',
      targetField: 'durationMinutes',
      question: '训练多久？',
      round: 1,
      priority: 2,
      status: 'answered',
      answer: '45分钟',
    },
  ], 'exercise-answered', 'answered', '45分钟')
  const restored = normalizeSavedRecordFollowUpQuestions(
    [{ ...pendingQuestion, questionId: 'sleep-pending' }],
    records,
    1,
    history,
  )
  assert.deepEqual(restored.map(item => item.questionId), ['sleep-pending'])
})

test('a later round cannot reuse the id of a resolved earlier question', () => {
  const records = [
    { id: 'exercise-1', type: 'exercise', date, note: '', activity: '卧推', sets: 4, sourceText: '卧推4组' },
  ]
  const history = [{
    questionId: 'stable-id',
    targetRecordId: 'exercise-1',
    recordType: 'exercise',
    targetField: 'durationMinutes',
    question: '训练多久？',
    round: 1,
    priority: 1,
    status: 'answered',
    answer: '45分钟',
  }]
  const nextRound = normalizeSavedRecordFollowUpQuestions([
    { questionId: 'stable-id', targetRecordId: 'exercise-1', targetField: 'weightKg', question: '用了多少公斤？', priority: 1 },
  ], records, 2, history)
  assert.deepEqual(nextRound.map(item => item.questionId), ['stable-id-2'])
})

test('next-round generation is available only after the current round is resolved', () => {
  assert.equal(canGenerateNextFollowUpRound(1, 1, false), false)
  assert.equal(canGenerateNextFollowUpRound(1, 0, false), true)
  assert.equal(canGenerateNextFollowUpRound(2, 0, false), true)
  assert.equal(canGenerateNextFollowUpRound(3, 0, false), false)
  assert.equal(canGenerateNextFollowUpRound(1, 0, true), false)
})

test('a completed zero-question follow-up round remains visible with its completion state', () => {
  assert.equal(shouldShowSmartFollowUpPanel({
    hasSession: false,
    itemCount: 0,
    canContinue: false,
    ended: true,
    hasNotice: true,
    hasError: false,
  }), false)
  assert.equal(shouldShowSmartFollowUpPanel({
    hasSession: true,
    itemCount: 0,
    canContinue: false,
    ended: true,
    hasNotice: true,
    hasError: false,
  }), true)
  assert.equal(shouldShowSmartFollowUpPanel({
    hasSession: true,
    itemCount: 0,
    canContinue: false,
    ended: false,
    hasNotice: false,
    hasError: true,
  }), true)
})

test('zero questions, request failure and the three-round limit have distinct states', () => {
  assert.equal(smartFollowUpZeroQuestionMessage({
    ended: true,
    currentRound: 2,
    hasNotice: false,
    hasError: false,
  }), SMART_FOLLOW_UP_COMPLETION_TEXT)
  assert.equal(SMART_FOLLOW_UP_COMPLETION_TEXT, '本轮没有新的有效补充问题，智能补充已完成。')

  const failed = smartFollowUpZeroQuestionMessage({
    ended: false,
    currentRound: 2,
    hasNotice: false,
    hasError: true,
  })
  assert.match(failed, /未完成/)
  assert.notEqual(failed, SMART_FOLLOW_UP_COMPLETION_TEXT)

  const thirdRound = smartFollowUpZeroQuestionMessage({
    ended: false,
    currentRound: 3,
    hasNotice: false,
    hasError: false,
  })
  assert.match(thirdRound, /不会发起第四轮/)
  assert.doesNotMatch(thirdRound, /第 4 轮发起/)
})

test('a completed zero-question session restores after refresh with its history', () => {
  const restored = parseFollowUpSessionSnapshot(serializeFollowUpSessionSnapshot({
    version: 1,
    messageId: 'completed-message',
    round: 2,
    ended: true,
    recordIds: ['sleep-1', 'exercise-1', 'meal-1'],
    items: [],
    history: [{
      questionId: 'exercise-reps',
      targetRecordId: 'exercise-1',
      recordType: 'exercise',
      targetField: 'repsPerSet',
      question: '每组多少次？',
      round: 1,
      priority: 1,
      status: 'answered',
      answer: '8次',
    }],
  }))

  assert.equal(restored?.ended, true)
  assert.equal(restored?.round, 2)
  assert.equal(restored?.items.length, 0)
  assert.equal(restored?.history.length, 1)
  assert.equal(shouldShowSmartFollowUpPanel({
    hasSession: true,
    itemCount: restored?.items.length ?? 0,
    canContinue: false,
    ended: restored?.ended ?? false,
    hasNotice: false,
    hasError: false,
  }), true)
  assert.equal(smartFollowUpZeroQuestionMessage({
    ended: restored?.ended ?? false,
    currentRound: restored?.round ?? 1,
    hasNotice: false,
    hasError: false,
  }), SMART_FOLLOW_UP_COMPLETION_TEXT)
})

test('the completion panel has no model request path of its own', () => {
  const source = readFileSync(
    new URL('../components/life-records/SmartFollowUps.tsx', import.meta.url),
    'utf8',
  )
  assert.doesNotMatch(source, /\bfetch\s*\(/)
  assert.doesNotMatch(source, /\/api\/life-records\/(?:chat|follow-up)/)
})
