import {
  LIFE_RECORD_TYPES,
  normalizeLifeRecord,
  type LifeRecord,
  type LifeRecordDraft,
  type LifeRecordSupplementField,
  type LifeRecordType,
} from './life-records.ts'
import type { LifeRecordProvider } from './ai/provider-types.ts'

export interface LifeFollowUpQuestion {
  /** Canonical identifier persisted in LifeRecordSupplement.id. */
  questionId: string
  /** Backward-compatible alias used by the original follow-up implementation. */
  id: string
  recordIndex: number
  /** Present after a parser question has been mapped to a saved record. */
  targetRecordId?: string
  type: LifeRecordType
  /** Explicit alias required by the cross-record follow-up contract. */
  recordType: LifeRecordType
  field: LifeRecordSupplementField
  /** Explicit alias required by the cross-record follow-up contract. */
  targetField: LifeRecordSupplementField
  question: string
  round: 1 | 2 | 3
  /** Lower values are more important. */
  priority: number
  origin: 'ai' | 'rule'
  reason?: string
}

export type LifeFollowUpStatus = 'pending' | 'answered' | 'skipped'

export interface LifeFollowUpHistoryItem {
  questionId: string
  targetRecordId: string
  recordType: LifeRecordType
  targetField: LifeRecordSupplementField
  question: string
  round: 1 | 2 | 3
  priority: number
  status: LifeFollowUpStatus
  answer?: string
}

export interface LifeFollowUpAnswer {
  questionId: string
  recordIndex: number
  type: LifeRecordType
  field: LifeRecordSupplementField
  question: string
  answer: string
  round: 1 | 2 | 3
}

export interface FollowUpPatch {
  recordIndex: number
  questionId: string
  field: LifeRecordSupplementField
  value: string | number
}

export interface FollowUpSupplementOptions {
  origin?: 'ai' | 'rule'
  provider?: LifeRecordProvider
  model?: string
}

export interface SavedFollowUpTarget {
  recordId: string
  recordIndex: number
  record: LifeRecord
}

const SUPPLEMENT_FIELDS: ReadonlySet<LifeRecordSupplementField> = new Set([
  'activity',
  'durationMinutes',
  'weightKg',
  'sets',
  'repsPerSet',
  'hours',
  'wakeFeeling',
  'amount',
  'score',
  'subject',
  'quantity',
  'unit',
  'food',
])

const ALLOWED_FIELDS: Record<LifeRecordType, ReadonlySet<LifeRecordSupplementField>> = {
  exercise: new Set(['activity', 'durationMinutes', 'weightKg', 'sets', 'repsPerSet']),
  sleep: new Set(['hours', 'wakeFeeling']),
  expense: new Set(['amount']),
  mood: new Set(['score']),
  learning: new Set(['subject', 'durationMinutes', 'quantity', 'unit']),
  meal: new Set(['food']),
}

const QUESTIONS: Record<LifeRecordType, Array<{
  field: LifeRecordSupplementField
  question: string
  isKnown: (draft: LifeRecordDraft) => boolean
}>> = {
  exercise: [
    { field: 'durationMinutes', question: '这次运动持续了多少分钟？', isKnown: draft => draft.durationMinutes !== undefined },
    { field: 'sets', question: '如果做了力量训练，一共做了几组？', isKnown: draft => draft.sets !== undefined },
    { field: 'repsPerSet', question: '力量训练每组做了多少次？', isKnown: draft => draft.repsPerSet !== undefined },
    { field: 'weightKg', question: '力量训练使用的重量是多少公斤？', isKnown: draft => draft.weightKg !== undefined },
  ],
  sleep: [
    { field: 'hours', question: '这次实际睡了几个小时？', isKnown: draft => draft.hours !== undefined },
    { field: 'wakeFeeling', question: '醒来时的具体感受是什么？', isKnown: draft => Boolean(draft.wakeFeeling?.trim()) },
  ],
  expense: [
    { field: 'amount', question: '这次实际花费了多少元？', isKnown: draft => draft.amount !== undefined },
  ],
  mood: [
    { field: 'score', question: '如果要给这次心情评分，1–5 分会是几分？', isKnown: draft => draft.score !== undefined },
  ],
  learning: [
    { field: 'durationMinutes', question: '这次学习持续了多少分钟？', isKnown: draft => draft.durationMinutes !== undefined },
    { field: 'quantity', question: '这次完成了多少题、页或单词？', isKnown: draft => draft.quantity !== undefined },
  ],
  meal: [
    { field: 'food', question: '这次吃或喝的具体内容是什么？', isKnown: draft => Boolean(draft.food?.trim()) },
  ],
}

function validRecordIndex(value: unknown, recordCount: number): value is number {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) < recordCount
}

function validType(value: unknown): value is LifeRecordType {
  return typeof value === 'string' && LIFE_RECORD_TYPES.includes(value as LifeRecordType)
}

export function isSupportedFollowUpField(
  type: LifeRecordType,
  field: unknown,
): field is LifeRecordSupplementField {
  return typeof field === 'string'
    && SUPPLEMENT_FIELDS.has(field as LifeRecordSupplementField)
    && ALLOWED_FIELDS[type].has(field as LifeRecordSupplementField)
}

function normalizeQuestion(value: unknown): string {
  return typeof value === 'string'
    ? value.normalize('NFKC').replace(/\s+/g, ' ').trim().slice(0, 160)
    : ''
}

/**
 * Model output is untrusted. Invalid questions are discarded individually so a
 * broken suggestion can never prevent the already parsed record from saving.
 */
export function normalizeFollowUpQuestions(
  value: unknown,
  drafts: readonly LifeRecordDraft[],
): LifeFollowUpQuestion[] {
  if (!Array.isArray(value)) return []
  const candidates = value.flatMap((raw, inputIndex) => {
    if (!raw || typeof raw !== 'object') return []
    const item = raw as Record<string, unknown>
    const recordIndex = item.recordIndex
    const type = item.type ?? (validRecordIndex(recordIndex, drafts.length) ? drafts[recordIndex].type : undefined)
    const field = item.targetField ?? item.field
    const question = normalizeQuestion(item.question)
    if (
      !validRecordIndex(recordIndex, drafts.length)
      || !validType(type)
      || type !== drafts[recordIndex].type
      || typeof field !== 'string'
      || !SUPPLEMENT_FIELDS.has(field as LifeRecordSupplementField)
      || !ALLOWED_FIELDS[type].has(field as LifeRecordSupplementField)
      || !question
    ) return []
    const roundValue = Number(item.round)
    const round: 1 | 2 | 3 = roundValue === 2 ? 2 : roundValue === 3 ? 3 : 1
    const priorityValue = Number(item.priority)
    const priority = Number.isFinite(priorityValue)
      ? Math.max(1, Math.min(999, Math.round(priorityValue)))
      : inputIndex + 1
    const requestedIdValue = item.questionId ?? item.id
    const requestedId = typeof requestedIdValue === 'string' && requestedIdValue.trim()
      ? requestedIdValue.trim().slice(0, 100)
      : `followup-${recordIndex}-${field}`
    return [{
      requestedId,
      recordIndex,
      type,
      field: field as LifeRecordSupplementField,
      question,
      round,
      priority,
      inputIndex,
      origin: item.origin === 'rule' ? 'rule' : 'ai',
      reason: typeof item.reason === 'string' ? item.reason.trim().slice(0, 240) || undefined : undefined,
    } as const]
  }).sort((left, right) => left.priority - right.priority || left.inputIndex - right.inputIndex)

  const seenFields = new Set<string>()
  const seenQuestions = new Set<string>()
  const seenIds = new Set<string>()
  const result: LifeFollowUpQuestion[] = []
  for (const candidate of candidates) {
    const fieldKey = `${candidate.recordIndex}|${candidate.type}|${candidate.field}`
    const questionKey = candidate.question.toLocaleLowerCase('zh-CN')
    if (seenFields.has(fieldKey) || seenQuestions.has(questionKey)) continue
    seenFields.add(fieldKey)
    seenQuestions.add(questionKey)
    let questionId = candidate.requestedId
    let suffix = 2
    while (seenIds.has(questionId)) {
      questionId = `${candidate.requestedId}-${suffix}`
      suffix += 1
    }
    seenIds.add(questionId)
    result.push({
      questionId,
      id: questionId,
      recordIndex: candidate.recordIndex,
      type: candidate.type,
      recordType: candidate.type,
      field: candidate.field,
      targetField: candidate.field,
      question: candidate.question,
      round: candidate.round,
      priority: candidate.priority,
      origin: candidate.origin,
      reason: candidate.reason,
    })
    if (result.length === 3) break
  }
  return result
}

/**
 * Deterministic fallback used for the rule provider and for a model response
 * which omitted questions. Candidates are interleaved by record so one record
 * cannot consume all three slots before other records are considered.
 */
export function deriveRuleFollowUpQuestions(
  drafts: readonly LifeRecordDraft[],
  round: 1 | 2 | 3 = 1,
  options: { excludeKeys?: Iterable<string> } = {},
): LifeFollowUpQuestion[] {
  const excluded = new Set(options.excludeKeys ?? [])
  const groups = drafts.map((draft, recordIndex) =>
    QUESTIONS[draft.type]
      .filter(candidate => !candidate.isKnown(draft))
      .filter(candidate => !excluded.has(`${recordIndex}|${draft.type}|${candidate.field}`))
      .map(candidate => ({ draft, recordIndex, candidate })),
  )
  const maxCandidates = Math.max(0, ...groups.map(group => group.length))
  const ordered: Array<(typeof groups)[number][number]> = []
  for (let pass = 0; pass < maxCandidates; pass += 1) {
    for (const group of groups) {
      if (group[pass]) ordered.push(group[pass])
    }
  }
  return ordered.slice(0, 3).map(({ draft, recordIndex, candidate }, index) => {
    const questionId = `followup-${round}-${recordIndex}-${candidate.field}`
    return {
      questionId,
      id: questionId,
      recordIndex,
      type: draft.type,
      recordType: draft.type,
      field: candidate.field,
      targetField: candidate.field,
      question: candidate.question,
      round,
      priority: index + 1,
      origin: 'rule',
    }
  })
}

export function followUpQuestionKey(question: LifeFollowUpQuestion): string {
  return `${question.recordIndex}|${question.type}|${question.field}`
}

/** Remove questions whose answer is already present in the saved record. */
export function filterKnownFollowUps(
  questions: readonly LifeFollowUpQuestion[],
  drafts: readonly LifeRecordDraft[],
): LifeFollowUpQuestion[] {
  return questions.filter(question => {
    const draft = drafts[question.recordIndex]
    if (!draft || draft.type !== question.type) return false
    return !QUESTIONS[question.type].find(item => item.field === question.field)?.isKnown(draft)
  })
}

export function parseFollowUpAnswer(
  answer: string,
  question: LifeFollowUpQuestion,
): number | string | null {
  const text = answer.normalize('NFKC').trim()
  if (!text) return null
  if (question.field === 'food' || question.field === 'subject' || question.field === 'activity' || question.field === 'unit' || question.field === 'wakeFeeling') {
    return text.slice(0, question.field === 'food' ? 120 : question.field === 'wakeFeeling' ? 120 : question.field === 'unit' ? 8 : 40)
  }
  if (question.field === 'score') {
    const match = /(?:^|\D)([1-5])(?:\s*分|\s*$)/.exec(text)
    return match ? Number(match[1]) : null
  }
  const number = Number(/(\d+(?:\.\d+)?)/.exec(text)?.[1])
  if (!Number.isFinite(number)) return null
  if (question.field === 'durationMinutes') {
    if (/小时/.test(text)) return Math.round(number * 60 * 100) / 100
    if (/分钟|分/.test(text)) return number
    return null
  }
  if (question.field === 'hours') return /小时|钟头|h/i.test(text) || /^\d+(?:\.\d+)?$/.test(text) ? number : null
  if (question.field === 'amount') return /元|块/.test(text) || /^\d+(?:\.\d+)?$/.test(text) ? Math.round(number * 100) / 100 : null
  if (question.field === 'weightKg') return /公斤|千克|kg/i.test(text) || /^\d+(?:\.\d+)?$/.test(text) ? number : null
  if (question.field === 'sets' || question.field === 'repsPerSet' || question.field === 'quantity') return Number.isInteger(number) ? number : null
  return null
}

/**
 * Apply one explicit user answer. It validates the resulting LifeRecord with
 * the existing schema before returning a draft that can be persisted.
 */
export function applyFollowUpAnswer(
  record: LifeRecord,
  answer: LifeFollowUpAnswer,
  createdAt = new Date().toISOString(),
  options: FollowUpSupplementOptions = {},
): LifeRecordDraft {
  if (answer.recordIndex < 0) throw new Error('追问关联无效')
  if (record.type !== answer.type) throw new Error('追问与记录分类不一致')
  if (!ALLOWED_FIELDS[answer.type].has(answer.field)) throw new Error('追问字段不适用于该记录')
  const existingSupplements = record.supplements ?? []
  const latestRound = existingSupplements.reduce(
    (latest, supplement) => Math.max(latest, supplement.round ?? 0),
    0,
  )
  if (answer.round < latestRound) throw new Error('这条追问已经过期，请回答最新问题')
  if (existingSupplements.some(supplement => (
    supplement.id === answer.questionId
    || (
      (supplement.round ?? 1) === answer.round
      && supplement.field === answer.field
    )
  ))) {
    throw new Error('这个问题已经回答过，不会重复写入')
  }
  const value = parseFollowUpAnswer(answer.answer, {
    questionId: answer.questionId,
    id: answer.questionId,
    recordIndex: answer.recordIndex,
    type: answer.type,
    recordType: answer.type,
    field: answer.field,
    targetField: answer.field,
    question: answer.question,
    round: answer.round,
    priority: 1,
    origin: options.origin ?? 'rule',
  })
  if (value === null) throw new Error('没有从回答中识别出可保存的有效字段')
  const currentValue = record[answer.field]
  if (currentValue !== undefined && String(currentValue) !== String(value)) {
    throw new Error('回答与已有信息冲突，请直接在记录编辑中确认修改')
  }
  const supplements = [
    ...(record.supplements ?? []),
    {
      id: answer.questionId,
      question: answer.question,
      answer: answer.answer.trim(),
      field: answer.field,
      origin: options.origin ?? 'rule',
      ...(options.provider ? { provider: options.provider } : {}),
      ...(options.model ? { model: options.model } : {}),
      round: answer.round,
      createdAt,
    },
  ].slice(-20)
  return normalizeLifeRecord({
    ...record,
    [answer.field]: value,
    supplements,
  }, record.date)
}

/**
 * Map model questions to records that actually passed validation, duplicate
 * filtering and persistence. The parser's recordIndex is not the saved array
 * index after incomplete or duplicate cards are removed.
 */
export function mapFollowUpsToSavedRecords(
  questions: readonly LifeFollowUpQuestion[],
  originalIndexes: readonly number[],
  skippedPreparedIndexes: readonly number[],
  savedRecords: readonly LifeRecord[],
): Array<{ question: LifeFollowUpQuestion; recordId: string; record: LifeRecord }> {
  const skipped = new Set(skippedPreparedIndexes)
  const createdByOriginal = new Map<number, LifeRecord>()
  let createdCursor = 0
  originalIndexes.forEach((originalIndex, preparedIndex) => {
    if (skipped.has(preparedIndex)) return
    const record = savedRecords[createdCursor]
    createdCursor += 1
    if (record) createdByOriginal.set(originalIndex, record)
  })
  return questions.flatMap(question => {
    const record = createdByOriginal.get(question.recordIndex)
    return record && record.type === question.type
      ? [{ question, recordId: record.id, record }]
      : []
  })
}

function fieldIsKnown(record: LifeRecordDraft | LifeRecord, field: LifeRecordSupplementField): boolean {
  const candidate = QUESTIONS[record.type].find(item => item.field === field)
  return candidate?.isKnown(record) ?? false
}

export function followUpTargetKey(
  targetRecordId: string,
  field: LifeRecordSupplementField,
): string {
  return `${targetRecordId}|${field}`
}

export function normalizeFollowUpHistory(value: unknown): LifeFollowUpHistoryItem[] {
  if (!Array.isArray(value)) return []
  const result: LifeFollowUpHistoryItem[] = []
  const seenQuestionIds = new Set<string>()
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue
    const item = raw as Record<string, unknown>
    const questionId = typeof item.questionId === 'string' ? item.questionId.trim().slice(0, 100) : ''
    const targetRecordId = typeof item.targetRecordId === 'string' ? item.targetRecordId.trim().slice(0, 160) : ''
    const type = item.recordType ?? item.type
    const field = item.targetField ?? item.field
    const question = normalizeQuestion(item.question)
    const roundValue = Number(item.round)
    const round: 1 | 2 | 3 = roundValue === 2 ? 2 : roundValue === 3 ? 3 : 1
    const priorityValue = Number(item.priority)
    const status = item.status === 'answered' || item.status === 'skipped' ? item.status : 'pending'
    if (
      !questionId
      || seenQuestionIds.has(questionId)
      || !targetRecordId
      || !validType(type)
      || typeof field !== 'string'
      || !SUPPLEMENT_FIELDS.has(field as LifeRecordSupplementField)
      || !ALLOWED_FIELDS[type].has(field as LifeRecordSupplementField)
      || !question
    ) continue
    seenQuestionIds.add(questionId)
    result.push({
      questionId,
      targetRecordId,
      recordType: type,
      targetField: field as LifeRecordSupplementField,
      question,
      round,
      priority: Number.isFinite(priorityValue) ? Math.max(1, Math.min(999, Math.round(priorityValue))) : result.length + 1,
      status,
      ...(typeof item.answer === 'string' && item.answer.trim()
        ? { answer: item.answer.trim().slice(0, 500) }
        : {}),
    })
    if (result.length >= 30) break
  }
  return result
}

export function historyFromMappedFollowUps(
  items: ReadonlyArray<{ question: LifeFollowUpQuestion; recordId: string }>,
): LifeFollowUpHistoryItem[] {
  return items.map(({ question, recordId }) => ({
    questionId: question.questionId,
    targetRecordId: recordId,
    recordType: question.recordType,
    targetField: question.targetField,
    question: question.question,
    round: question.round,
    priority: question.priority,
    status: 'pending',
  }))
}

export function updateFollowUpHistoryStatus(
  history: readonly LifeFollowUpHistoryItem[],
  questionId: string,
  status: LifeFollowUpStatus,
  answer?: string,
): LifeFollowUpHistoryItem[] {
  return history.map(item => item.questionId === questionId
    ? {
        ...item,
        status,
        ...(status === 'answered' && answer?.trim() ? { answer: answer.trim().slice(0, 500) } : {}),
      }
    : item)
}

export function canGenerateNextFollowUpRound(
  currentRound: 1 | 2 | 3,
  pendingCurrentRoundCount: number,
  ended: boolean,
): boolean {
  return !ended && currentRound < 3 && pendingCurrentRoundCount === 0
}

export function shouldShowSmartFollowUpPanel(input: {
  hasSession: boolean
  itemCount: number
  canContinue: boolean
  ended: boolean
  hasNotice: boolean
  hasError: boolean
}): boolean {
  if (!input.hasSession) return false
  if (input.itemCount > 0 || input.canContinue || input.ended) return true
  return input.hasNotice || input.hasError
}

export const SMART_FOLLOW_UP_COMPLETION_TEXT =
  '本轮没有新的有效补充问题，智能补充已完成。'

export function smartFollowUpZeroQuestionMessage(input: {
  ended: boolean
  currentRound: 1 | 2 | 3
  hasNotice: boolean
  hasError: boolean
}): string | null {
  if (input.hasError) {
    return '本轮智能评估未完成；已保存记录保持不变，可稍后重试。'
  }
  if (input.ended) {
    return input.hasNotice ? null : SMART_FOLLOW_UP_COMPLETION_TEXT
  }
  if (input.currentRound < 3) {
    return `本轮问题已回答或跳过完毕。只有你主动点击下方按钮，才会为第 ${input.currentRound + 1} 轮发起一次新的 AI 评估。`
  }
  return '已达到三轮补充上限，不会发起第四轮。'
}

/**
 * Validate a second/third-round model response against the exact records in
 * the active follow-up session. Questions may target different records, but
 * they may not target records outside the session, ask for known values, or
 * repeat fields already answered/skipped in earlier rounds.
 */
export function normalizeSavedRecordFollowUpQuestions(
  value: unknown,
  records: readonly LifeRecord[],
  round: 1 | 2 | 3,
  history: readonly LifeFollowUpHistoryItem[],
): LifeFollowUpQuestion[] {
  if (!Array.isArray(value)) return []
  const recordById = new Map(records.map(record => [record.id, record]))
  const exhaustedFields = new Set(
    history
      .filter(item => item.status === 'answered' || item.status === 'skipped')
      .map(item => followUpTargetKey(item.targetRecordId, item.targetField)),
  )
  const seenQuestions = new Set(
    history
      .filter(item => item.status === 'answered' || item.status === 'skipped')
      .map(item => item.question.toLocaleLowerCase('zh-CN')),
  )
  const seenIds = new Set(
    history
      .filter(item => item.status === 'answered' || item.status === 'skipped')
      .map(item => item.questionId),
  )
  const candidates = value.flatMap((raw, inputIndex) => {
    if (!raw || typeof raw !== 'object') return []
    const item = raw as Record<string, unknown>
    const targetRecordId = typeof (item.targetRecordId ?? item.recordId) === 'string'
      ? String(item.targetRecordId ?? item.recordId).trim()
      : ''
    const record = recordById.get(targetRecordId)
    const type = item.recordType ?? item.type ?? record?.type
    const field = item.targetField ?? item.field
    const question = normalizeQuestion(item.question)
    if (
      !record
      || !validType(type)
      || type !== record.type
      || typeof field !== 'string'
      || !SUPPLEMENT_FIELDS.has(field as LifeRecordSupplementField)
      || !ALLOWED_FIELDS[type].has(field as LifeRecordSupplementField)
      || fieldIsKnown(record, field as LifeRecordSupplementField)
      || exhaustedFields.has(followUpTargetKey(targetRecordId, field as LifeRecordSupplementField))
      || seenQuestions.has(question)
      || !question
    ) return []
    const priorityValue = Number(item.priority)
    const requestedIdValue = item.questionId ?? item.id
    const requestedId = typeof requestedIdValue === 'string' && requestedIdValue.trim()
      ? requestedIdValue.trim().slice(0, 100)
      : `followup-${round}-${targetRecordId}-${field}`
    return [{
      requestedId,
      targetRecordId,
      recordIndex: records.indexOf(record),
      type,
      field: field as LifeRecordSupplementField,
      question,
      round,
      priority: Number.isFinite(priorityValue)
        ? Math.max(1, Math.min(999, Math.round(priorityValue)))
        : inputIndex + 1,
      inputIndex,
      origin: item.origin === 'rule' ? 'rule' : 'ai',
      reason: typeof item.reason === 'string' ? item.reason.trim().slice(0, 240) || undefined : undefined,
    } as const]
  }).sort((left, right) => left.priority - right.priority || left.inputIndex - right.inputIndex)

  const seenFields = new Set<string>()
  const result: LifeFollowUpQuestion[] = []
  for (const candidate of candidates) {
    const fieldKey = followUpTargetKey(candidate.targetRecordId, candidate.field)
    const questionKey = candidate.question.toLocaleLowerCase('zh-CN')
    if (seenFields.has(fieldKey) || seenQuestions.has(questionKey)) continue
    seenFields.add(fieldKey)
    seenQuestions.add(questionKey)
    let questionId = candidate.requestedId
    let suffix = 2
    while (seenIds.has(questionId)) {
      questionId = `${candidate.requestedId}-${suffix}`
      suffix += 1
    }
    seenIds.add(questionId)
    result.push({
      questionId,
      id: questionId,
      recordIndex: candidate.recordIndex,
      targetRecordId: candidate.targetRecordId,
      type: candidate.type,
      recordType: candidate.type,
      field: candidate.field,
      targetField: candidate.field,
      question: candidate.question,
      round,
      priority: candidate.priority,
      origin: candidate.origin,
      reason: candidate.reason,
    })
    if (result.length === 3) break
  }
  return result
}

/**
 * Subsequent rounds are deterministic and local, so saving a record never
 * depends on a second model call. Already supplied fields are not asked again.
 */
export function nextFollowUpRound(
  record: LifeRecord,
  recordIndex: number,
  previousRound: 1 | 2 | 3,
): LifeFollowUpQuestion[] {
  if (previousRound >= 3) return []
  const next = (previousRound + 1) as 2 | 3
  return deriveRuleFollowUpQuestions([record], next).map(question => ({
    ...question,
    recordIndex,
  }))
}

export function followUpsFromModelOutput(
  raw: string,
  drafts: readonly LifeRecordDraft[],
): LifeFollowUpQuestion[] {
  const clean = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
  try {
    const parsed = JSON.parse(clean) as { followUps?: unknown }
    return filterKnownFollowUps(normalizeFollowUpQuestions(parsed.followUps, drafts), drafts)
  } catch {
    return []
  }
}
