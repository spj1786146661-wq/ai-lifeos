import {
  isLifeRecordProvider,
  type LifeRecordProvider,
} from './ai/provider-types.ts'

export type LifeRecordType = 'exercise' | 'sleep' | 'expense' | 'mood' | 'learning' | 'meal'

export interface LifeRecordAttachmentRef {
  id: string
  name: string
  mimeType: string
  size: number
  sha256: string
}

export interface LifeRecordSourceRef {
  messageId: string
  start: number
  end: number
  text: string
  /**
   * The parser that produced this fragment. `fallback-rule` means the remote
   * model omitted an explicit fact and the deterministic parser recovered it.
   * Older records with only `ai` or `user` remain valid.
   */
  origin: 'ai' | 'rule' | 'fallback-rule' | 'user'
  /** Provider/model are optional diagnostics, never credentials. */
  provider?: LifeRecordProvider
  model?: string
  /** The type proposed by the parser, retained when the user corrects it. */
  candidateType?: LifeRecordType
  /** The user's confirmed type, used for refresh-safe duplicate detection. */
  confirmedType?: LifeRecordType
  userEdited?: boolean
}

export type LifeRecordSupplementField =
  | 'activity'
  | 'durationMinutes'
  | 'weightKg'
  | 'sets'
  | 'repsPerSet'
  | 'hours'
  | 'wakeFeeling'
  | 'amount'
  | 'score'
  | 'subject'
  | 'quantity'
  | 'unit'
  | 'food'

/**
 * Optional provenance for a user answer that filled a missing field on an
 * existing record. Supplements never replace the original message source.
 */
export interface LifeRecordSupplement {
  id: string
  question: string
  answer: string
  field: LifeRecordSupplementField
  origin: 'ai' | 'rule'
  provider?: LifeRecordProvider
  model?: string
  /** One of the three voluntary follow-up rounds. Older supplements omit it. */
  round?: 1 | 2 | 3
  createdAt: string
}

export interface LifeRecordDraft {
  type: LifeRecordType
  date: string
  note: string
  activity?: string
  durationMinutes?: number
  weightKg?: number
  sets?: number
  repsPerSet?: number
  hours?: number
  wakeFeeling?: string
  amount?: number
  currency?: 'CNY'
  score?: number
  subject?: string
  quantity?: number
  unit?: string
  food?: string
  /** Optional metadata keeps old records and pure text backups unchanged. */
  sourceRef?: LifeRecordSourceRef
  attachments?: LifeRecordAttachmentRef[]
  /** User-confirmed additions linked to the original record. */
  supplements?: LifeRecordSupplement[]
  /** Review-only hint. It is not persisted into the saved LifeRecord. */
  candidate?: boolean
  /** Review-only hint: a required field is still missing. */
  needsFields?: boolean
  /** Review-only hint: what the user has to fill in. */
  missingReason?: string
}

export interface LifeRecord extends LifeRecordDraft {
  id: string
  sourceText: string
  createdAt?: string
}

export const LIFE_RECORD_TYPES: LifeRecordType[] = ['exercise', 'sleep', 'learning', 'meal', 'expense', 'mood']

export const LIFE_RECORD_LABELS: Record<LifeRecordType, string> = {
  exercise: '运动', sleep: '睡眠', learning: '学习', meal: '饮食', expense: '消费', mood: '心情',
}

export function validLifeDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T12:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

function boundedNumber(value: unknown, min: number, max: number): number | null {
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) && number >= min && number <= max ? number : null
}

function recordMetadata(input: Record<string, unknown>) {
  const source = input.sourceRef
  let sourceRef: LifeRecordSourceRef | undefined
  if (source && typeof source === 'object') {
    const value = source as Record<string, unknown>
    if (
      typeof value.messageId === 'string' && value.messageId
      && Number.isInteger(value.start) && Number.isInteger(value.end)
      && (value.start as number) >= 0 && (value.end as number) > (value.start as number)
      && typeof value.text === 'string' && value.text
      && (
        value.origin === 'ai'
        || value.origin === 'rule'
        || value.origin === 'fallback-rule'
        || value.origin === 'user'
      )
    ) {
      sourceRef = {
        messageId: value.messageId,
        start: value.start as number,
        end: value.end as number,
        text: value.text,
        origin: value.origin,
        ...(isLifeRecordProvider(value.provider)
          ? { provider: value.provider }
          : {}),
        ...(typeof value.model === 'string' && value.model.trim()
          ? { model: value.model.trim().slice(0, 100) }
          : {}),
        ...(typeof value.candidateType === 'string' && LIFE_RECORD_TYPES.includes(value.candidateType as LifeRecordType)
          ? { candidateType: value.candidateType as LifeRecordType }
          : {}),
        ...(typeof value.confirmedType === 'string' && LIFE_RECORD_TYPES.includes(value.confirmedType as LifeRecordType)
          ? { confirmedType: value.confirmedType as LifeRecordType }
          : {}),
        ...(value.userEdited === true ? { userEdited: true } : {}),
      }
    }
  }
  const attachments = Array.isArray(input.attachments)
    ? input.attachments.flatMap(value => {
      if (!value || typeof value !== 'object') return []
      const item = value as Record<string, unknown>
      if (
        typeof item.id !== 'string' || !item.id
        || typeof item.name !== 'string'
        || typeof item.mimeType !== 'string'
        || typeof item.size !== 'number' || !Number.isFinite(item.size) || item.size <= 0
        || typeof item.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(item.sha256)
      ) return []
      return [{
        id: item.id,
        name: item.name,
        mimeType: item.mimeType,
        size: item.size,
        sha256: item.sha256.toLowerCase(),
      }]
    })
    : []
  const supplementFields = new Set<LifeRecordSupplementField>([
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
  const supplements = Array.isArray(input.supplements)
    ? input.supplements.slice(-20).flatMap(value => {
      if (!value || typeof value !== 'object') return []
      const item = value as Record<string, unknown>
      if (
        typeof item.id !== 'string' || !item.id
        || typeof item.question !== 'string' || !item.question.trim()
        || typeof item.answer !== 'string' || !item.answer.trim()
        || typeof item.field !== 'string' || !supplementFields.has(item.field as LifeRecordSupplementField)
        || (item.origin !== 'ai' && item.origin !== 'rule')
        || (item.round !== undefined && ![1, 2, 3].includes(item.round as number))
        || typeof item.createdAt !== 'string' || Number.isNaN(Date.parse(item.createdAt))
      ) return []
      return [{
        id: item.id,
        question: item.question.trim().slice(0, 160),
        answer: item.answer.trim().slice(0, 300),
        field: item.field as LifeRecordSupplementField,
        origin: item.origin,
        ...(isLifeRecordProvider(item.provider)
          ? { provider: item.provider }
          : {}),
        ...(typeof item.model === 'string' && item.model.trim()
          ? { model: item.model.trim().slice(0, 100) }
          : {}),
        ...(item.round === 1 || item.round === 2 || item.round === 3
          ? { round: item.round }
          : {}),
        createdAt: item.createdAt,
      } satisfies LifeRecordSupplement]
    })
    : []
  return {
    ...(sourceRef ? { sourceRef } : {}),
    ...(attachments.length ? { attachments } : {}),
    ...(supplements.length ? { supplements } : {}),
  }
}

/** Treat all model output and editable form data as untrusted input. */
export function normalizeLifeRecord(value: unknown, fallbackDate: string): LifeRecordDraft {
  if (!value || typeof value !== 'object') throw new Error('记录格式无效')
  const input = value as Record<string, unknown>
  const type = input.type
  if (typeof type !== 'string' || !LIFE_RECORD_TYPES.includes(type as LifeRecordType)) {
    throw new Error('记录类型无效')
  }
  if (input.date !== undefined && !validLifeDate(input.date)) throw new Error('日期无效')
  const date = input.date ?? fallbackDate
  if (!validLifeDate(date)) throw new Error('日期无效')
  const note = typeof input.note === 'string' ? input.note.trim().slice(0, 200) : ''
  const metadata = recordMetadata(input)

  if (type === 'exercise') {
    const durationMinutes = input.durationMinutes === undefined || input.durationMinutes === '' ? undefined : boundedNumber(input.durationMinutes, 1, 1440)
    const weightKg = input.weightKg === undefined || input.weightKg === '' ? undefined : boundedNumber(input.weightKg, 0.1, 1000)
    const sets = input.sets === undefined || input.sets === '' ? undefined : boundedNumber(input.sets, 1, 100)
    const repsPerSet = input.repsPerSet === undefined || input.repsPerSet === '' ? undefined : boundedNumber(input.repsPerSet, 1, 1000)
    if (durationMinutes === null) throw new Error('运动时长须为 1–1440 分钟')
    if (weightKg === null) throw new Error('重量须为 0.1–1000 公斤')
    if (sets === null || (sets !== undefined && !Number.isInteger(sets))) throw new Error('组数须为 1–100 的整数')
    if (repsPerSet === null || (repsPerSet !== undefined && !Number.isInteger(repsPerSet))) throw new Error('每组次数须为 1–1000 的整数')
    const activity = typeof input.activity === 'string' ? input.activity.trim().slice(0, 40) : ''
    if (!activity && durationMinutes === undefined && weightKg === undefined && sets === undefined && repsPerSet === undefined) {
      throw new Error('请填写运动内容')
    }
    return { type, date, note, activity: activity || '运动', ...metadata, ...(durationMinutes === undefined ? {} : { durationMinutes }), ...(weightKg === undefined ? {} : { weightKg }), ...(sets === undefined ? {} : { sets }), ...(repsPerSet === undefined ? {} : { repsPerSet }) }
  }
  if (type === 'sleep') {
    const hours = boundedNumber(input.hours, 0.1, 24)
    if (hours === null) throw new Error('睡眠时长须为 0.1–24 小时')
    const wakeFeeling = typeof input.wakeFeeling === 'string' ? input.wakeFeeling.trim().slice(0, 120) : ''
    return { type, date, note, hours, ...metadata, ...(wakeFeeling ? { wakeFeeling } : {}) }
  }
  if (type === 'expense') {
    const amount = boundedNumber(input.amount, 0.01, 100000000)
    if (amount === null) throw new Error('消费金额须大于 0')
    return { type, date, note, amount: Math.round(amount * 100) / 100, currency: 'CNY', ...metadata }
  }
  if (type === 'learning') {
    const durationMinutes = input.durationMinutes === undefined || input.durationMinutes === '' ? undefined : boundedNumber(input.durationMinutes, 1, 1440)
    const quantity = input.quantity === undefined || input.quantity === '' ? undefined : boundedNumber(input.quantity, 1, 100000)
    if (durationMinutes === null) throw new Error('学习时长须为 1–1440 分钟')
    if (quantity === null || (quantity !== undefined && !Number.isInteger(quantity))) throw new Error('学习数量须为正整数')
    if (durationMinutes === undefined && quantity === undefined) throw new Error('请填写学习时长或完成数量')
    const subject = typeof input.subject === 'string' ? input.subject.trim().slice(0, 40) : ''
    const unit = typeof input.unit === 'string' ? input.unit.trim().slice(0, 8) : ''
    return { type, date, note, subject: subject || '学习', ...metadata, ...(durationMinutes === undefined ? {} : { durationMinutes }), ...(quantity === undefined ? {} : { quantity, unit: unit || '项' }) }
  }
  if (type === 'meal') {
    const food = typeof input.food === 'string' ? input.food.trim().slice(0, 120) : ''
    if (!food) throw new Error('请填写识别或食用的食物')
    return { type, date, note, food, ...metadata }
  }
  const score = input.score === undefined || input.score === null || input.score === ''
    ? undefined
    : boundedNumber(input.score, 1, 5)
  if (score === null || (score !== undefined && !Number.isInteger(score))) {
    throw new Error('心情评分须为 1–5；不评分时请留空')
  }
  return {
    type: 'mood',
    date,
    note,
    ...metadata,
    ...(score === undefined ? {} : { score }),
  }
}

/**
 * Normalize one parser result for review. This is deliberately separate from
 * normalizeLifeRecord(): incomplete review candidates may remain visible, but
 * they still cannot be persisted until the user supplies the required field.
 */
export function normalizeLifeRecordCandidate(
  value: unknown,
  fallbackDate: string,
): { draft: LifeRecordDraft; needsFields: boolean; missingReason?: string } {
  // Mood score is optional. A mood statement is already a complete record,
  // while an explicitly invalid score must still be rejected rather than
  // silently converted into an unscored record.
  return { draft: normalizeLifeRecord(value, fallbackDate), needsFields: false }
}

/** Strip review-only flags and retain attachment/source metadata when saving. */
export function toPersistedLifeRecordDraft(draft: LifeRecordDraft, fallbackDate: string): LifeRecordDraft {
  const normalized = normalizeLifeRecord(draft, fallbackDate)
  return {
    ...normalized,
    ...(draft.sourceRef ? { sourceRef: normalized.sourceRef ?? draft.sourceRef } : {}),
    ...(draft.attachments?.length ? { attachments: normalized.attachments ?? draft.attachments } : {}),
    ...(draft.supplements?.length ? { supplements: normalized.supplements ?? draft.supplements } : {}),
  }
}

/** Explicitly limited rule parser for the no-key demo; it never calls an AI service. */
export function parseDemoLifeText(text: string, date: string): LifeRecordDraft[] {
  const results: LifeRecordDraft[] = []
  const exercise = text.match(/(跑步|散步|走路|健身|力量训练|游泳|骑车|瑜伽|运动|训练)[^，。；,;]{0,20}?(\d+(?:\.\d+)?)\s*(分钟|分|小时)/)
  const strength = text.match(/(卧推|深蹲|硬拉|划船|推举|弯举)[^，。；,;]{0,12}?(\d+(?:\.\d+)?)\s*(?:公斤|千克|kg)[^，。；,;]{0,8}?(\d+)\s*组/i)
  if (exercise || strength) results.push(normalizeLifeRecord({
    type: 'exercise', date, activity: strength?.[1] ?? exercise?.[1],
    ...(exercise ? { durationMinutes: Number(exercise[2]) * (exercise[3] === '小时' ? 60 : 1) } : {}),
    ...(strength ? { weightKg: Number(strength[2]), sets: Number(strength[3]) } : {}),
    note: '',
  }, date))
  const sleep = text.match(/(?:睡了|睡眠|睡觉|睡)\s*(\d+(?:\.\d+)?)\s*(?:个)?(?:小时|h)/i)
  if (sleep) results.push(normalizeLifeRecord({ type: 'sleep', date, hours: Number(sleep[1]), note: '' }, date))
  const learningTime = text.match(/(?:学习|学|看书|阅读|复习|背单词)[^，。；,;]{0,20}?(\d+(?:\.\d+)?)\s*(分钟|分|小时)/)
  const learningCount = text.match(/(?:做了?|完成了?|刷了?)\s*(\d+)\s*(道[^，。；,;]{0,18}?题|题|页|个单词)/)
  if (learningTime || learningCount) {
    const subject = learningTime?.[0].replace(/\d+(?:\.\d+)?\s*(?:分钟|分|小时).*$/, '').trim()
      || (learningCount && /电工/.test(text) ? '电工考试题' : '学习')
    results.push(normalizeLifeRecord({
      type: 'learning', date, subject, note: '',
      ...(learningTime ? { durationMinutes: Number(learningTime[1]) * (learningTime[2] === '小时' ? 60 : 1) } : {}),
      ...(learningCount ? { quantity: Number(learningCount[1]), unit: /题/.test(learningCount[2]) ? '题' : learningCount[2] } : {}),
    }, date))
  }
  const meal = text.match(/(?:早餐|午餐|晚餐|早饭|午饭|晚饭)(?:吃了?|是)?\s*([^，。；,;？?]{2,50})/)
    ?? text.match(/(?:吃了?|喝了?)\s*([^，。；,;？?]{2,50})/)
  const food = meal?.[1]?.trim()
  if (food && !/^(?:花了?|消费|支出|什么|多少|吗\b)/.test(food) && !/^(?:\d+(?:\.\d+)?\s*(?:元|块))$/.test(food)) {
    results.push(normalizeLifeRecord({ type: 'meal', date, food, note: '' }, date))
  }
  const expense = text.match(/(?:花了|消费|支出|买了)[^\d¥￥]{0,12}[¥￥]?\s*(\d+(?:\.\d+)?)\s*(?:元|块)?/)
    ?? text.match(/[¥￥]\s*(\d+(?:\.\d+)?)/)
  if (expense) results.push(normalizeLifeRecord({ type: 'expense', date, amount: Number(expense[1]), note: '' }, date))
  const mood = text.match(/(?:心情|情绪)\s*(?:是|为|打到?|给了?)?\s*[1-5]\s*分|心情(?:很差|不好|一般|不错|很好)|开心|高兴|平静|焦虑|难过|低落/)
  if (mood) {
    const explicit = /(?:心情|情绪)\s*(?:是|为|打到?|给了?)?\s*([1-5])\s*分/.exec(text)
    results.push(normalizeLifeRecord({
      type: 'mood',
      date,
      note: mood[0],
      ...(explicit ? { score: Number(explicit[1]) } : {}),
    }, date))
  }
  return results
}

export function parseModelLifeRecords(raw: string, date: string): LifeRecordDraft[] {
  const clean = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
  let parsed: unknown
  try { parsed = JSON.parse(clean) } catch { throw new Error('模型返回了无法解析的 JSON') }
  const records = Array.isArray(parsed) ? parsed : (parsed as { records?: unknown })?.records
  if (!Array.isArray(records) || records.length > LIFE_RECORD_TYPES.length) throw new Error('模型返回的记录列表无效')
  const normalized = records.map(record => normalizeLifeRecord(record, date))
  if (new Set(normalized.map(record => record.type)).size !== normalized.length) {
    throw new Error('模型返回了重复的记录类型')
  }
  return normalized
}

/**
 * Convert remote-model JSON into review candidates without discarding an
 * otherwise valid mood statement merely because the user did not state a
 * numeric score. No guessed score is ever created here.
 */
export function parseModelLifeCandidates(raw: string, date: string, sourceText = ''): LifeRecordDraft[] {
  const records = parseRawModelCandidates(raw)
  const candidates = records.map(value => {
    if (!value || typeof value !== 'object') throw new Error('模型返回的记录格式无效')
    const input = { ...(value as Record<string, unknown>) }
    if (input.type === 'mood') {
      // The note can be a model paraphrase, while sourceText is the user's
      // untouched message. A score is accepted only when the user stated one.
      const explicitScore = sourceText
        ? explicitMoodScore(sourceText)
        : explicitMoodScore(input.note)
      if (explicitScore === null) {
        delete input.score
      } else {
        input.score = explicitScore
      }
    }
    return normalizeLifeRecordCandidate(input, date).draft
  })
  if (new Set(candidates.map(record => record.type)).size !== candidates.length) {
    throw new Error('模型返回了重复的记录类型')
  }
  return candidates
}

/** Model JSON may include `followUps`; that sibling must never break records. */
export function parseModelRecordPayload(raw: string, date: string, sourceText = ''): {
  records: LifeRecordDraft[]
  followUps: unknown
} {
  const records = parseModelLifeCandidates(raw, date, sourceText)
  const clean = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
  try {
    const parsed = JSON.parse(clean) as { followUps?: unknown }
    return { records, followUps: parsed.followUps }
  } catch {
    return { records, followUps: undefined }
  }
}

/** Read only a score the user explicitly attached to a mood expression. */
export function explicitMoodScore(value: unknown): number | null {
  if (typeof value !== 'string') return null
  const match = /(?:心情|情绪)\s*(?:是|为|打到?|给了?)?\s*([1-5])\s*分/.exec(value.normalize('NFKC'))
  return match ? Number(match[1]) : null
}

export function parseModelMealRecords(raw: string, date: string): LifeRecordDraft[] {
  const records = parseModelLifeRecords(raw, date)
  if (records.length > 1 || records.some(record => record.type !== 'meal')) throw new Error('识图结果不是单条饮食记录')
  return records
}

/** Convert the untouched model JSON into editable candidates before schema validation. */
export function parseRawModelCandidates(raw: string): unknown[] {
  const clean = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
  let parsed: unknown
  try { parsed = JSON.parse(clean) } catch { throw new Error('模型返回了无法解析的 JSON') }
  const records = Array.isArray(parsed) ? parsed : (parsed as { records?: unknown })?.records
  if (!Array.isArray(records) || records.length > LIFE_RECORD_TYPES.length) throw new Error('模型返回的记录列表无效')
  return records
}

export function summarizeLifeRecords(records: readonly LifeRecordDraft[]) {
  const moods = records.filter(record => record.type === 'mood')
  const moodScores = moods.flatMap(record => (
    record.score !== undefined && Number.isInteger(record.score) && record.score >= 1 && record.score <= 5
      ? [record.score]
      : []
  ))
  return {
    exerciseCount: records.filter(r => r.type === 'exercise').length,
    exerciseMinutes: records.filter(r => r.type === 'exercise').reduce((sum, r) => sum + (r.durationMinutes ?? 0), 0),
    learningCount: records.filter(r => r.type === 'learning').length,
    mealCount: records.filter(r => r.type === 'meal').length,
    learningMinutes: records.filter(r => r.type === 'learning').reduce((sum, r) => sum + (r.durationMinutes ?? 0), 0),
    learningQuantities: records.filter(r => r.type === 'learning').reduce((totals: Record<string, number>, record) => {
      if (record.quantity !== undefined) {
        const unit = record.unit || '项'
        totals[unit] = (totals[unit] ?? 0) + record.quantity
      }
      return totals
    }, {}),
    sleepHours: records.filter(r => r.type === 'sleep').reduce((sum, r) => sum + (r.hours ?? 0), 0),
    expenseAmount: records.filter(r => r.type === 'expense').reduce((sum, r) => sum + (r.amount ?? 0), 0),
    /** All mood descriptions, including records the user chose not to rate. */
    moodCount: moods.length,
    /** Only explicit, valid scores participate in the average. */
    ratedMoodCount: moodScores.length,
    moodAverage: moodScores.length
      ? moodScores.reduce((sum, score) => sum + score, 0) / moodScores.length
      : null,
  }
}

export function countRecordedDays(records: LifeRecord[], type: LifeRecordType, dates: string[]) {
  return new Set(records.filter(record => record.type === type && dates.includes(record.date)).map(record => record.date)).size
}

/** 把一条记录压缩成一行可读摘要，只使用真实存在的字段，不编造数据。 */
export function lifeRecordSummary(record: LifeRecordDraft): string {
  if (record.type === 'exercise') return [record.activity ?? '运动', record.weightKg === undefined ? null : `${record.weightKg} 公斤`, record.sets === undefined ? null : `${record.sets} 组`, record.repsPerSet === undefined ? null : `每组 ${record.repsPerSet} 次`, record.durationMinutes === undefined ? null : `${record.durationMinutes} 分钟`].filter(Boolean).join(' · ')
  if (record.type === 'sleep') return [record.hours ? `${record.hours} 小时` : '等待填写睡眠时长', record.wakeFeeling ?? null].filter(Boolean).join(' · ')
  if (record.type === 'expense') return record.amount ? `¥${record.amount.toFixed(2)}${record.note ? ' · ' + record.note : ''}` : '等待填写消费金额'
  if (record.type === 'learning') return [record.subject ?? '学习', record.durationMinutes === undefined ? null : `${record.durationMinutes} 分钟`, record.quantity === undefined ? null : `${record.quantity} ${record.unit ?? '项'}`].filter(Boolean).join(' · ')
  if (record.type === 'meal') return record.food || '等待填写饮食内容'
  return record.score !== undefined
    ? `${record.score} / 5${record.note ? ' · ' + record.note : ''}`
    : `${record.note || '心情'} · 未评分`
}
