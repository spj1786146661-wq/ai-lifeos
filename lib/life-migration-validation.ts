import { LIFE_RECORD_LABELS, LIFE_RECORD_TYPES, validLifeDate, type LifeRecord, type LifeRecordType } from './life-records.ts'

/**
 * 迁移前数据校验 v1。
 *
 * 只回答一个问题：给定来源数据是否满足安全迁移到 IndexedDB 的条件。
 * 它不读取 localStorage、不写入任何数据库、不启动迁移，也不调用 AI。
 *
 * 三条硬约束：
 * 1. 不修改输入对象。records 以只读引用返回，未知字段和用户原话全部保留。
 * 2. 不自动修复。缺失 ID、重复 ID、非法日期只报告，不补 UUID、不改日期、不删记录。
 * 3. 不用 normalizeLifeRecord 的结果代替原始记录。normalize 会丢弃未知字段，
 *    把它当成迁移结果会让校验「看起来通过」却悄悄丢数据。
 */

export type MigrationValidationErrorCode =
  | 'JSON_PARSE_FAILED'
  | 'ROOT_NOT_ARRAY'
  | 'RECORD_NOT_OBJECT'
  | 'ID_MISSING'
  | 'ID_EMPTY'
  | 'ID_NOT_STRING'
  | 'ID_DUPLICATE'
  | 'DATE_INVALID'
  | 'TYPE_INVALID'
  | 'REQUIRED_FIELD_MISSING'
  | 'FIELD_TYPE_INVALID'

export interface MigrationValidationError {
  code: MigrationValidationErrorCode
  message: string
  /** 0 起的记录下标；失败原因不对应单条记录时为 null。 */
  index: number | null
  /** 记录 ID；无法取得时为 null。 */
  id: string | null
}

export interface UnknownFieldNote {
  index: number
  id: string
  fields: string[]
}

export interface MigrationValidationSuccess {
  valid: true
  recordCount: number
  /** 原始记录引用，未做 normalize，因此不丢字段。 */
  records: readonly LifeRecord[]
  /** 不在当前 LifeRecord 模型中的字段；只提示，不阻断迁移。 */
  unknownFields: readonly UnknownFieldNote[]
}

export interface MigrationValidationFailure {
  valid: false
  /** 能确定记录总数时给出数组长度；来源不是数组时为 null。 */
  recordCount: number | null
  errors: readonly MigrationValidationError[]
  unknownFields: readonly UnknownFieldNote[]
}

export type MigrationValidationResult = MigrationValidationSuccess | MigrationValidationFailure

export interface LocalSourceParseSuccess {
  ok: true
  value: unknown
}

export interface LocalSourceParseFailure {
  ok: false
  error: MigrationValidationError
}

export type LocalSourceParseResult = LocalSourceParseSuccess | LocalSourceParseFailure

/** 已存储记录允许携带的字段，与 LifeRecord / LifeRecordDraft 一致。 */
const KNOWN_RECORD_FIELDS: ReadonlySet<string> = new Set([
  'id', 'type', 'date', 'note', 'sourceText', 'createdAt',
  'activity', 'durationMinutes', 'weightKg', 'sets', 'repsPerSet',
  'hours', 'wakeFeeling',
  'amount', 'currency',
  'score',
  'subject', 'quantity', 'unit',
  'food',
  'sourceRef', 'attachments',
])

const CORRUPTED_SOURCE_MESSAGE =
  '本地数据不是合法 JSON，与现有 isDemoStorageCorrupted() 的判断一致；请先在「我的」页导出备份或导入有效备份，再执行迁移。'

function shortValue(value: unknown): string {
  if (value === undefined) return '缺失'
  if (value === null) return 'null'
  if (typeof value === 'string') return JSON.stringify(value.length > 40 ? `${value.slice(0, 40)}...` : value)
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return Array.isArray(value) ? '数组' : typeof value
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function optionalNumberInRange(value: unknown, min: number, max: number): boolean {
  if (value === undefined) return true
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
}

function optionalIntegerInRange(value: unknown, min: number, max: number): boolean {
  if (value === undefined) return true
  return optionalNumberInRange(value, min, max) && Number.isInteger(value)
}

function optionalString(value: unknown): boolean {
  return value === undefined || typeof value === 'string'
}

/**
 * 把 localStorage 原始字符串解析成待校验值。
 * 空字符串与 null 视为「还没有数据」，对应合法空数据，而不是损坏数据。
 */
export function parseLocalSource(raw: unknown): LocalSourceParseResult {
  if (raw === null || raw === undefined || raw === '') return { ok: true, value: [] }
  if (typeof raw !== 'string') return { ok: true, value: raw }
  try {
    return { ok: true, value: JSON.parse(raw) }
  } catch (cause) {
    return {
      ok: false,
      error: {
        code: 'JSON_PARSE_FAILED',
        message: `本地数据不是合法 JSON：${cause instanceof Error ? cause.message : String(cause)}`,
        index: null,
        id: null,
      },
    }
  }
}

function isRawStorageRead(value: unknown): value is { records: unknown; corruptedRaw: unknown } {
  return isPlainRecord(value) && 'records' in value && 'corruptedRaw' in value
}

function validateRecordFields(
  type: LifeRecordType,
  record: Record<string, unknown>,
  index: number,
  id: string | null,
  errors: MigrationValidationError[],
) {
  const label = LIFE_RECORD_LABELS[type]
  const fail = (code: MigrationValidationErrorCode, message: string) => {
    errors.push({ code, message, index, id })
  }

  if (type === 'exercise') {
    if (!optionalNumberInRange(record.durationMinutes, 1, 1440)) fail('FIELD_TYPE_INVALID', `第 ${index + 1} 条${label}时长须为 1–1440 分钟的数字`)
    if (!optionalNumberInRange(record.weightKg, 0.1, 1000)) fail('FIELD_TYPE_INVALID', `第 ${index + 1} 条${label}重量须为 0.1–1000 公斤的数字`)
    if (!optionalIntegerInRange(record.sets, 1, 100)) fail('FIELD_TYPE_INVALID', `第 ${index + 1} 条${label}组数须为 1–100 的整数`)
    if (!optionalIntegerInRange(record.repsPerSet, 1, 1000)) fail('FIELD_TYPE_INVALID', `第 ${index + 1} 条${label}每组次数须为 1–1000 的整数`)
    if (record.durationMinutes === undefined && record.sets === undefined && record.repsPerSet === undefined) fail('REQUIRED_FIELD_MISSING', `第 ${index + 1} 条${label}记录缺少时长、组数或每组次数`)
    if (!optionalString(record.activity)) fail('FIELD_TYPE_INVALID', `第 ${index + 1} 条${label}项目须为字符串`)
    return
  }
  if (type === 'sleep') {
    if (record.hours === undefined) fail('REQUIRED_FIELD_MISSING', `第 ${index + 1} 条${label}记录缺少 hours 时长`)
    else if (!optionalNumberInRange(record.hours, 0.1, 24)) fail('FIELD_TYPE_INVALID', `第 ${index + 1} 条${label}时长须为 0.1–24 小时的数字`)
    if (!optionalString(record.wakeFeeling)) fail('FIELD_TYPE_INVALID', `第 ${index + 1} 条${label}醒来感受须为字符串`)
    return
  }
  if (type === 'expense') {
    if (record.amount === undefined) fail('REQUIRED_FIELD_MISSING', `第 ${index + 1} 条${label}记录缺少 amount 金额`)
    else if (!optionalNumberInRange(record.amount, 0.01, 100000000)) fail('FIELD_TYPE_INVALID', `第 ${index + 1} 条${label}金额须为大于 0 的数字`)
    if (record.currency !== undefined && record.currency !== 'CNY') fail('FIELD_TYPE_INVALID', `第 ${index + 1} 条${label}币种只支持 CNY`)
    return
  }
  if (type === 'learning') {
    if (!optionalNumberInRange(record.durationMinutes, 1, 1440)) fail('FIELD_TYPE_INVALID', `第 ${index + 1} 条${label}时长须为 1–1440 分钟的数字`)
    if (!optionalIntegerInRange(record.quantity, 1, 100000)) fail('FIELD_TYPE_INVALID', `第 ${index + 1} 条${label}数量须为正整数`)
    if (record.durationMinutes === undefined && record.quantity === undefined) fail('REQUIRED_FIELD_MISSING', `第 ${index + 1} 条${label}记录缺少时长或完成数量`)
    if (!optionalString(record.subject)) fail('FIELD_TYPE_INVALID', `第 ${index + 1} 条${label}科目须为字符串`)
    if (!optionalString(record.unit)) fail('FIELD_TYPE_INVALID', `第 ${index + 1} 条${label}单位须为字符串`)
    return
  }
  if (type === 'meal') {
    if (typeof record.food !== 'string' || record.food.trim() === '') fail('REQUIRED_FIELD_MISSING', `第 ${index + 1} 条${label}记录缺少 food 食物名称`)
    return
  }
  // Mood score is optional. An absent score means "the user did not rate this
  // mood"; it is never treated as 0, 3, or another invented value.
  if (!optionalIntegerInRange(record.score, 1, 5)) fail('FIELD_TYPE_INVALID', `第 ${index + 1} 条${label}评分须为 1–5 的整数`)
}

/**
 * 校验迁移来源。接受三种形态：
 * - 原始 JSON 字符串（localStorage 的取值）；
 * - readRawStorage() 的返回结构（{ records, corruptedRaw }）；
 * - 已经解析好的记录数组。
 */
export function validateLocalSource(input: unknown): MigrationValidationResult {
  const unknownFields: UnknownFieldNote[] = []

  let source: unknown = input
  if (input === null || input === undefined) {
    // localStorage.getItem() 在键不存在时返回 null，这是「还没有数据」，
    // 与损坏数据必须区分开；新用户首次迁移应被判为合法空数据。
    return { valid: true, recordCount: 0, records: [], unknownFields }
  }
  if (typeof input === 'string') {
    const parsed = parseLocalSource(input)
    if (!parsed.ok) {
      return { valid: false, recordCount: null, errors: [parsed.error], unknownFields }
    }
    source = parsed.value
  } else if (isRawStorageRead(input)) {
    if (typeof input.corruptedRaw === 'string' && input.corruptedRaw !== '') {
      return {
        valid: false,
        recordCount: null,
        errors: [{ code: 'JSON_PARSE_FAILED', message: CORRUPTED_SOURCE_MESSAGE, index: null, id: null }],
        unknownFields,
      }
    }
    source = input.records
  }

  if (!Array.isArray(source)) {
    return {
      valid: false,
      recordCount: null,
      errors: [{
        code: 'ROOT_NOT_ARRAY',
        message: `迁移来源必须是记录数组，当前是${shortValue(source)}；合法 JSON 但不是数组时，现有 readRawStorage() 会把它标记为损坏数据。`,
        index: null,
        id: null,
      }],
      unknownFields,
    }
  }

  const errors: MigrationValidationError[] = []
  const seenIds = new Map<string, number>()

  source.forEach((entry, index) => {
    if (!isPlainRecord(entry)) {
      errors.push({ code: 'RECORD_NOT_OBJECT', message: `第 ${index + 1} 条不是记录对象（${shortValue(entry)}）`, index, id: null })
      return
 }

    const extraFields = Object.keys(entry).filter(key => !KNOWN_RECORD_FIELDS.has(key))
    if (extraFields.length > 0) {
      unknownFields.push({ index, id: typeof entry.id === 'string' ? entry.id : '', fields: extraFields })
    }

    let id: string | null = null
    if (!('id' in entry)) {
      errors.push({ code: 'ID_MISSING', message: `第 ${index + 1} 条缺少 id；迁移不会自动生成新 ID`, index, id: null })
    } else if (typeof entry.id !== 'string') {
      errors.push({ code: 'ID_NOT_STRING', message: `第 ${index + 1} 条 id 必须是字符串（${shortValue(entry.id)}）`, index, id: null })
    } else if (entry.id.trim() === '') {
      errors.push({ code: 'ID_EMPTY', message: `第 ${index + 1} 条 id 是空字符串；迁移不会自动生成新 ID`, index, id: null })
    } else {
      id = entry.id
      const firstIndex = seenIds.get(entry.id)
      if (firstIndex === undefined) {
        seenIds.set(entry.id, index)
      } else {
        errors.push({
          code: 'ID_DUPLICATE',
          message: `第 ${index + 1} 条与第 ${firstIndex + 1} 条使用同一个 id（${entry.id}）；重复 ID 会互相覆盖，必须由你决定保留哪一条`,
          index,
          id,
        })
      }
    }

    if (!validLifeDate(entry.date)) {
      errors.push({ code: 'DATE_INVALID', message: `第 ${index + 1} 条日期无效（${shortValue(entry.date)}）；迁移不会自动改正日期`, index, id })
    }

    if (typeof entry.type !== 'string' || !LIFE_RECORD_TYPES.includes(entry.type as LifeRecordType)) {
      errors.push({ code: 'TYPE_INVALID', message: `第 ${index + 1} 条记录类型不受支持（${shortValue(entry.type)}）`, index, id })
    } else {
      validateRecordFields(entry.type as LifeRecordType, entry, index, id, errors)
    }

    if (entry.note !== undefined && typeof entry.note !== 'string') {
      errors.push({ code: 'FIELD_TYPE_INVALID', message: `第 ${index + 1} 条 note 须为字符串（${shortValue(entry.note)}）`, index, id })
    }
    if (entry.sourceText !== undefined && typeof entry.sourceText !== 'string') {
      errors.push({ code: 'FIELD_TYPE_INVALID', message: `第 ${index + 1} 条 sourceText 须为字符串（${shortValue(entry.sourceText)}）`, index, id })
    }
    if (entry.createdAt !== undefined && typeof entry.createdAt !== 'string') {
      errors.push({ code: 'FIELD_TYPE_INVALID', message: `第 ${index + 1} 条 createdAt 须为字符串（${shortValue(entry.createdAt)}）`, index, id })
    }
  })

  if (errors.length > 0) {
    return { valid: false, recordCount: source.length, errors, unknownFields }
  }

  return {
    valid: true,
    recordCount: source.length,
    records: source as unknown as readonly LifeRecord[],
    unknownFields,
  }
}
