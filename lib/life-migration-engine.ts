import type { LifeRecord } from './life-records.ts'
import {
  validateLocalSource,
  type MigrationValidationError,
  type UnknownFieldNote,
} from './life-migration-validation.ts'

/**
 * 独立迁移复制与校验 v1。
 *
 * 只证明「一批生活记录能否从旧数据结构完整复制到显式指定的目标存储，并能
 * 准确发现任何字段差异」。状态机、并发锁和中断恢复由迁移服务层负责；
 * 本模块本身不读取 localStorage，也不连接默认 IndexedDB 数据库。
 *
 * 导入本模块不执行任何操作，所有副作用只发生在显式调用 migrateLifeRecords()
 * 之后，并且只作用于调用方传入的 target。
 */

export type MigrationStage =
  | 'source_validation'
  | 'unsafe_value'
  | 'target_not_empty'
  | 'interrupted'
  | 'write'
  | 'read_back'
  | 'verify'

export type MigrationDifferenceKind = 'count' | 'id_missing' | 'id_extra' | 'field'

export interface MigrationDifference {
  kind: MigrationDifferenceKind
  /** 0 起的来源下标；不属于单条记录时为 null。 */
  index: number | null
  /** 记录 ID；数量差异时为 null。 */
  id: string | null
  /** 字段路径，例如 note、legacyBlob.tags[1]；整条差异时为 null。 */
  field: string | null
  /** 确定性序列化后的来源值；不适用时为 null。 */
  expected: string | null
  /** 确定性序列化后的目标值；不适用时为 null。 */
  actual: string | null
}

/**
 * 迁移目标需要的最小能力。现有 `createIndexedDBAdapter()` 同时具备这两个方法。
 * 刻意不暴露 create/update/remove：那些接口会改写 ID 或时间戳，不能用于无损复制。
 */
export interface MigrationTarget {
  load(userId: null): Promise<LifeRecord[]>
  /**
   * 原样迁移写入。必须在不调用 normalizeLifeRecord()、保留原始 ID 与
   * createdAt、且在同一事务内完成目标判空与批量写入的前提下实现。
   * 刻意不用 restoreBackup()：那条路径会重建记录并 clear() 目标库。
   */
  importRawRecordsForMigration(records: readonly unknown[]): Promise<{ written: number }>
}

export interface MigrateLifeRecordsOptions {
  /** 原始记录数据：JSON 字符串、`{ records, corruptedRaw }` 或记录数组。 */
  source: unknown
  /** 显式指定的目标适配器；本模块从不自行创建或选择数据库。 */
  target: MigrationTarget
  /** 可选的中断标记，在两个阶段之间检查。 */
  signal?: { readonly aborted: boolean }
}

export interface MigrationRunResult {
  ok: boolean
  /** 失败时所处阶段；成功时为 null。 */
  stage: MigrationStage | null
  recordCount: number | null
  /** 迁移前校验错误；仅 source_validation 阶段可能非空。 */
  sourceErrors: readonly MigrationValidationError[]
  /** 无法可靠写入或比较的值路径；仅 unsafe_value 阶段可能非空。 */
  unsafeValues: readonly string[]
  /** 回读比对发现的差异；仅 verify 阶段可能非空。 */
  differences: readonly MigrationDifference[]
  unknownFields: readonly UnknownFieldNote[]
  message: string
}

function errorText(cause: unknown): string {
  return cause instanceof Error ? `（${cause.message}）` : ''
}

/**
 * 识别「目标库非空」类错误。按错误名判断而不是按 instanceof，这样引擎
 * 不依赖具体适配器的类，换一个实现同样能正确分流到 target_not_empty。
 */
function isTargetNotEmpty(cause: unknown): boolean {
  return cause instanceof Error && cause.name === 'MigrationTargetNotEmptyError'
}

/**
 * 确定性序列化：对象键排序、数组保留顺序，并给每个值带上类型前缀，
 * 因此 1 与 "1"、null 与 undefined、缺失键与显式 undefined 都不会混为一谈。
 */
export function canonicalize(value: unknown): string {
  if (value === null) return 'null'
  if (value === undefined) return 'undefined'
  if (typeof value === 'string') return `s:${JSON.stringify(value)}`
  if (typeof value === 'number') return `n:${String(value)}`
  if (typeof value === 'boolean') return `b:${String(value)}`
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    const keys = Object.keys(record).sort()
    return `{${keys.map(key => `${JSON.stringify(key)}:${canonicalize(record[key])}`).join(',')}}`
  }
  return `x:${String(value)}`
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * 结构化克隆能写入、但无法用确定性序列化可靠比较或已经不属于记录数据类型的值，
 * 在写入前直接拒绝，避免「写进去了但比对不出差异」。
 */
function findUnsafeValues(records: readonly unknown[]): string[] {
  const problems: string[] = []

  const walk = (value: unknown, path: string): void => {
    if (value === null || value === undefined) return
    const type = typeof value
    if (type === 'string' || type === 'boolean') return
    if (type === 'number') {
      if (!Number.isFinite(value as number)) problems.push(`${path} 不是有限数字`)
      return
    }
    if (type === 'bigint' || type === 'function' || type === 'symbol') {
      problems.push(`${path} 是 ${type}，无法可靠写入或比较`)
      return
    }
    if (Array.isArray(value)) {
      value.forEach((item, index) => walk(item, `${path}[${index}]`))
      return
    }
    const tag = Object.prototype.toString.call(value)
    if (tag !== '[object Object]') {
      problems.push(`${path} 是 ${tag}，无法可靠写入或比较`)
      return
    }
    const record = value as Record<string, unknown>
    for (const key of Object.keys(record)) {
      walk(record[key], path === '' ? key : `${path}.${key}`)
    }
  }

  records.forEach((record, index) => walk(record, `[${index}]`))
  return problems
}

function diffValues(
  expected: unknown,
  actual: unknown,
  path: string,
  out: MigrationDifference[],
  index: number,
  id: string,
): void {
  if (canonicalize(expected) === canonicalize(actual)) return

  if (isPlainObject(expected) && isPlainObject(actual)) {
    const keys = new Set([...Object.keys(expected), ...Object.keys(actual)])
    for (const key of [...keys].sort()) {
      diffValues(expected[key], actual[key], path === '' ? key : `${path}.${key}`, out, index, id)
    }
    return
  }

  if (Array.isArray(expected) && Array.isArray(actual)) {
    const length = Math.max(expected.length, actual.length)
    for (let position = 0; position < length; position += 1) {
      diffValues(expected[position], actual[position], `${path}[${position}]`, out, index, id)
    }
    return
  }

  out.push({
    kind: 'field',
    index,
    id,
    field: path,
    expected: canonicalize(expected),
    actual: canonicalize(actual),
  })
}

/** 比较数量、ID 集合和每条记录的完整内容；不只看数量或少数字段。 */
export function collectMigrationDifferences(
  expected: readonly Record<string, unknown>[],
  actual: readonly Record<string, unknown>[],
): MigrationDifference[] {
  const differences: MigrationDifference[] = []

  if (expected.length !== actual.length) {
    differences.push({
      kind: 'count',
      index: null,
      id: null,
      field: null,
      expected: String(expected.length),
      actual: String(actual.length),
    })
  }

  const expectedById = new Map<string, { record: Record<string, unknown>; index: number }>()
  expected.forEach((record, index) => {
    if (typeof record.id === 'string') expectedById.set(record.id, { record, index })
  })
  const actualById = new Map<string, Record<string, unknown>>()
  actual.forEach(record => {
    if (typeof record.id === 'string') actualById.set(record.id, record)
  })

  for (const [id, entry] of expectedById) {
    const got = actualById.get(id)
    if (got === undefined) {
      differences.push({
        kind: 'id_missing',
        index: entry.index,
        id,
        field: null,
        expected: canonicalize(entry.record),
        actual: null,
      })
      continue
    }
    diffValues(entry.record, got, '', differences, entry.index, id)
  }

  for (const [id, record] of actualById) {
    if (!expectedById.has(id)) {
      differences.push({
        kind: 'id_extra',
        index: null,
        id,
        field: null,
        expected: null,
        actual: canonicalize(record),
      })
    }
  }

  return differences
}

/**
 * 把一批生活记录复制到显式指定的目标存储，并回读比对。
 *
 * 流程：迁移前校验 → 不可比较值检查 → 目标必须为空 → 单事务写入 → 回读 →
 * 数量/ID 集合/逐字段一致性比对。任一步失败都会返回可判读的 stage，
 * 不会把失败写成成功，也不会在失败后清空或覆盖目标数据。
 */
export async function migrateLifeRecords(options: MigrateLifeRecordsOptions): Promise<MigrationRunResult> {
  const { source, target, signal } = options

  const failure = (
    stage: MigrationStage,
    message: string,
    extra: Partial<MigrationRunResult> = {},
  ): MigrationRunResult => ({
    ok: false,
    stage,
    recordCount: null,
    sourceErrors: [],
    unsafeValues: [],
    differences: [],
    unknownFields: [],
    message,
    ...extra,
  })

  const validation = validateLocalSource(source)
  if (!validation.valid) {
    return failure(
      'source_validation',
      `来源数据未通过迁移前校验，共 ${validation.errors.length} 处问题；目标存储未被写入。`,
      {
        recordCount: validation.recordCount,
        sourceErrors: validation.errors,
        unknownFields: validation.unknownFields,
      },
    )
  }

  // 保留校验返回的原始引用，不做 normalize、不复制、不重建记录。
  const records = validation.records as unknown as readonly Record<string, unknown>[]

  const unsafeValues = findUnsafeValues(records)
  if (unsafeValues.length > 0) {
    return failure(
      'unsafe_value',
      `来源数据含 ${unsafeValues.length} 个无法可靠写入或比较的值；目标存储未被写入。`,
      { recordCount: records.length, unsafeValues, unknownFields: validation.unknownFields },
    )
  }

  if (signal?.aborted) {
    return failure('interrupted', '迁移在写入前被中断；目标存储未被写入。', {
      recordCount: records.length,
      unknownFields: validation.unknownFields,
    })
  }

  let written: number
  try {
    // 判空与写入在目标适配器的同一个事务内完成，因此「先读到空、再被别人写入」
    // 的竞态由目标端的事务保证，而不是由引擎预先判断。
    const result = await target.importRawRecordsForMigration(records)
    written = result.written
  } catch (cause) {
    if (isTargetNotEmpty(cause)) {
      return failure(
        'target_not_empty',
        `目标存储已有记录，迁移导入要求目标为空，已拒绝写入；未写入、未删除、未覆盖任何记录${errorText(cause)}。`,
        { recordCount: records.length, unknownFields: validation.unknownFields },
      )
    }
    return failure(
      'write',
      `写入目标存储失败，写入事务已整体回滚；未宣称迁移成功${errorText(cause)}。`,
      { recordCount: records.length, unknownFields: validation.unknownFields },
    )
  }

  if (written !== records.length) {
    return failure(
      'write',
      `目标适配器只报告写入 ${written} 条，与来源 ${records.length} 条不一致；本次迁移不算成功。`,
      { recordCount: records.length, unknownFields: validation.unknownFields },
    )
  }

  if (signal?.aborted) {
    return failure(
      'interrupted',
      '迁移在写入提交后被中断，尚未完成回读校验；不得视为迁移成功，也不会自动清理已写入的数据。',
      { recordCount: records.length, unknownFields: validation.unknownFields },
    )
  }

  let after: LifeRecord[]
  try {
    after = await target.load(null)
  } catch (cause) {
    return failure(
      'read_back',
      `写入已提交，但回读目标存储失败，无法确认数据一致性；未宣称迁移成功，也未清理已写入的数据${errorText(cause)}。`,
      { recordCount: records.length, unknownFields: validation.unknownFields },
    )
  }

  const differences = collectMigrationDifferences(records, after as unknown as readonly Record<string, unknown>[])
  if (differences.length > 0) {
    const fieldDifferences = differences.filter(difference => difference.kind === 'field').length
    return failure(
      'verify',
      `写入已提交，但回读比对发现 ${differences.length} 处差异（其中字段差异 ${fieldDifferences} 处）；迁移不算成功，也未自动清理已写入的数据。`,
      {
        recordCount: records.length,
        differences,
        unknownFields: validation.unknownFields,
      },
    )
  }

  return {
    ok: true,
    stage: null,
    recordCount: records.length,
    sourceErrors: [],
    unsafeValues: [],
    differences: [],
    unknownFields: validation.unknownFields,
    message: `已把 ${records.length} 条记录完整复制到目标存储，数量、ID 集合和每条记录的完整字段内容均一致。`,
  }
}
