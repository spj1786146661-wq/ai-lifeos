import type { MigrationCapableStorage } from './indexeddb-adapter.ts'
import type { DemoBackup } from './life-demo-store.ts'
import type { LifeRecord } from './life-records.ts'
import { migrateLifeRecords, type MigrationRunResult } from './life-migration-engine.ts'
import {
  createInitialMigrationState,
  fingerprintRecords,
  normalizeMigrationState,
  transitionMigrationState,
  type MigrationState,
  type MigrationStatus,
} from './life-migration-state.ts'
import type { LifeRecordStorage } from './storage-adapter.ts'

/**
 * 本地数据库迁移编排 v1。
 *
 * 只协调流程，不重新实现存储或校验：
 * - 来源读取与备份：复用 LifeRecordStorage（localStorage 适配器）；
 * - 数据校验与无损复制：复用 migrateLifeRecords()；
 * - 状态持久化：复用 IndexedDB meta store。
 *
 * 本模块不做任何自动执行；所有入口都必须由用户显式触发。
 */

export { MIGRATION_LOCK_NAME } from './life-migration-routing.ts'
export const MIGRATION_FEATURE_FLAG = 'NEXT_PUBLIC_ENABLE_LOCAL_DB_MIGRATION'

export type MigrationAction =
  | 'prepare'
  | 'activate'
  | 'reset'
  | 'read_status'

export interface MigrationDependencies {
  /** 来源存储：未登录本地路径，实际为 localStorage 适配器。 */
  source: LifeRecordStorage
  /** 目标存储：显式传入的 IndexedDB 适配器，绝不默认连接正式库。 */
  target: MigrationCapableStorage
  now?: () => string
}

export interface MigrationStatusView {
  state: MigrationState
  sourceRecordCount: number | null
  targetRecordCount: number | null
  /** 来源是否与迁移开始时记录的指纹一致；未开始迁移时为 null。 */
  sourceUnchanged: boolean | null
  /** 目标库记录数，无法读取时为 null。 */
  targetCountReadable: boolean
}

export interface MigrationAttemptResult {
  ok: boolean
  state: MigrationState
  /** 复制与校验结果；只有真正尝试过复制时才非 null。 */
  engineResult: MigrationRunResult | null
  /** 迁移前导出的备份，用于让调用方保存到磁盘。 */
  backup: DemoBackup | null
  message: string
  errorCode: string | null
}

export interface MigrationLock {
  release(): void
}

export type LockAcquirer = (name: string, run: () => Promise<void>) => Promise<boolean>

function errorText(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

/**
 * 使用 Web Locks 的协作锁。锁不存在时返回 null，调用方必须据此拒绝执行，
 * 而不是退回到时间戳锁——那会把「没有互斥」伪装成「已经互斥」。
 */
export function createWebLockAcquirer(locks: LockManager | undefined): LockAcquirer | null {
  if (!locks) return null
  return async (name, run) => {
    let acquired = false
    await locks.request(name, { ifAvailable: true }, async lock => {
      if (!lock) return
      acquired = true
      await run()
    })
    return acquired
  }
}

async function readState(deps: MigrationDependencies): Promise<MigrationState> {
  const raw = await deps.target.readMigrationState()
  return normalizeMigrationState(raw, (deps.now ?? (() => new Date().toISOString()))())
}

async function persist(deps: MigrationDependencies, state: MigrationState): Promise<MigrationState> {
  await deps.target.writeMigrationState(state)
  return state
}

async function readTargetRecords(deps: MigrationDependencies): Promise<LifeRecord[] | null> {
  try {
    return await deps.target.load(null)
  } catch {
    return null
  }
}

async function readSourceRecords(deps: MigrationDependencies): Promise<LifeRecord[]> {
  return deps.source.load(null)
}

/**
 * 只读状态视图。不写入任何状态，也不改动任何记录。
 */
export async function readMigrationStatus(deps: MigrationDependencies): Promise<MigrationStatusView> {
  const state = await readState(deps)
  const targetRecords = await readTargetRecords(deps)
  let sourceUnchanged: boolean | null = null
  if (state.sourceFingerprint !== null) {
    try {
      const sourceRecords = await readSourceRecords(deps)
      sourceUnchanged = (await fingerprintRecords(sourceRecords)) === state.sourceFingerprint
    } catch {
      sourceUnchanged = null
    }
  }
  return {
    state,
    sourceRecordCount: state.sourceRecordCount,
    targetRecordCount: targetRecords?.length ?? null,
    sourceUnchanged,
    targetCountReadable: targetRecords !== null,
  }
}

function failState(
  current: MigrationState,
  code: string,
  message: string,
  now: string,
): MigrationState {
  if (current.status === 'SUCCEEDED') return current
  const base = current.status === 'NOT_STARTED' ? transitionMigrationState(current, 'IN_PROGRESS', {}, now) : current
  return transitionMigrationState(base, 'FAILED', {
    errorCode: code,
    errorMessage: message,
    finishedAt: now,
  }, now)
}

/**
 * 执行一次完整迁移：备份 → 校验 → 复制 → 回读校验。
 * 成功只进入 READY_TO_SWITCH，绝不自动激活 IndexedDB。
 *
 * 必须由调用方持有迁移锁；本函数不会自行获取锁，以便调用方能统一控制
 * 锁的作用范围（包含状态读写和页面写入闸门）。
 */
export async function prepareMigration(deps: MigrationDependencies): Promise<MigrationAttemptResult> {
  const now = deps.now ?? (() => new Date().toISOString())
  const stamp = now()
  let state = await readState(deps)

  if (state.status === 'SUCCEEDED') {
    return {
      ok: false,
      state,
      engineResult: null,
      backup: null,
      message: '本地数据库已启用，无需再次迁移。',
      errorCode: 'ALREADY_ENABLED',
    }
  }

  // READY_TO_SWITCH 允许重新校验；其它非初始/失败状态视为已有迁移在进行。
  if (state.status === 'IN_PROGRESS' || state.status === 'VERIFYING') {
    return {
      ok: false,
      state,
      engineResult: null,
      backup: null,
      message: `上一次迁移停在「${state.status}」，可能包含已提交的数据。请先核对状态，不要直接重试覆盖。`,
      errorCode: 'MIGRATION_IN_PROGRESS',
    }
  }

  let sourceRecords: LifeRecord[]
  try {
    sourceRecords = await readSourceRecords(deps)
  } catch (cause) {
    const failed = await persist(deps, failState(state, 'SOURCE_READ_FAILED', errorText(cause), stamp))
    return {
      ok: false, state: failed, engineResult: null, backup: null,
      message: `读取本地记录失败，未执行迁移：${errorText(cause)}`,
      errorCode: 'SOURCE_READ_FAILED',
    }
  }

  // 迁移前备份：在任何写入之前生成并交给调用方保存。
  let backup: DemoBackup | null = null
  try {
    backup = await deps.source.exportBackup(null)
  } catch (cause) {
    const failed = await persist(deps, failState(state, 'BACKUP_FAILED', errorText(cause), stamp))
    return {
      ok: false, state: failed, engineResult: null, backup: null,
      message: `迁移前备份失败，已中止：${errorText(cause)}`,
      errorCode: 'BACKUP_FAILED',
    }
  }
  if (backup.corruptedRaw) {
    const failed = await persist(deps, failState(state, 'SOURCE_CORRUPTED', '本地记录包含无法解析的原始数据', stamp))
    return {
      ok: false, state: failed, engineResult: null, backup,
      message: '本地记录包含无法解析的数据。请先在「我的」页处理，迁移已中止。',
      errorCode: 'SOURCE_CORRUPTED',
    }
  }

  const sourceFingerprint = await fingerprintRecords(sourceRecords)

  // READY_TO_SWITCH 的“重新校验”不能再次调用要求目标为空的迁移导入。
  // 这里只读核对来源和目标是否仍与上次指纹一致；任何变化都保留现场并失败。
  if (state.status === 'READY_TO_SWITCH') {
    if (state.sourceFingerprint === null || sourceFingerprint !== state.sourceFingerprint) {
      const failed = await persist(deps, transitionMigrationState(state, 'FAILED', {
        backupExportedAt: backup.exportedAt,
        errorCode: 'SOURCE_CHANGED',
        errorMessage: '重新校验时来源记录与上次指纹不一致',
        finishedAt: stamp,
      }, stamp))
      return {
        ok: false,
        state: failed,
        engineResult: null,
        backup,
        message: '来源记录在等待启用期间发生变化，已拒绝继续并保留目标现场。请关闭其它页面后人工核查。',
        errorCode: 'SOURCE_CHANGED',
      }
    }

    state = await persist(deps, transitionMigrationState(state, 'VERIFYING', {
      sourceFingerprint,
      sourceRecordCount: sourceRecords.length,
      backupExportedAt: backup.exportedAt,
      finishedAt: null,
      errorCode: null,
      errorMessage: null,
      attempt: state.attempt + 1,
    }, stamp))

    const targetRecords = await readTargetRecords(deps)
    if (targetRecords === null) {
      const failed = await persist(deps, failState(state, 'TARGET_RECHECK_FAILED', '重新校验时无法读取目标库', stamp))
      return {
        ok: false,
        state: failed,
        engineResult: null,
        backup,
        message: '重新校验时无法读取目标数据库，已停止且未切换数据源。',
        errorCode: 'TARGET_RECHECK_FAILED',
      }
    }
    const targetFingerprint = await fingerprintRecords(targetRecords)
    if (targetFingerprint !== sourceFingerprint) {
      const failed = await persist(deps, transitionMigrationState(state, 'FAILED', {
        targetRecordCount: targetRecords.length,
        errorCode: 'TARGET_CHANGED',
        errorMessage: '重新校验时目标库内容与来源不一致',
        finishedAt: stamp,
      }, stamp))
      return {
        ok: false,
        state: failed,
        engineResult: null,
        backup,
        message: '目标数据库内容与来源不一致，已保留现场并拒绝切换。',
        errorCode: 'TARGET_CHANGED',
      }
    }

    const ready = await persist(deps, transitionMigrationState(state, 'READY_TO_SWITCH', {
      sourceRecordCount: sourceRecords.length,
      targetRecordCount: targetRecords.length,
      backupExportedAt: backup.exportedAt,
      finishedAt: stamp,
      errorCode: null,
      errorMessage: null,
    }, stamp))
    return {
      ok: true,
      state: ready,
      engineResult: null,
      backup,
      message: `已重新校验 ${sourceRecords.length} 条记录，来源与目标完整一致；IndexedDB 仍未启用。`,
      errorCode: null,
    }
  }

  // 先进入 IN_PROGRESS 再写入，使中断后刷新也能看到「迁移中」。
  state = await persist(deps, transitionMigrationState(state, 'IN_PROGRESS', {
    sourceFingerprint,
    sourceRecordCount: sourceRecords.length,
    backupExportedAt: backup.exportedAt,
    startedAt: state.startedAt ?? stamp,
    finishedAt: null,
    errorCode: null,
    errorMessage: null,
    attempt: state.attempt + 1,
  }, stamp))

  state = await persist(deps, transitionMigrationState(state, 'VERIFYING', {
    sourceFingerprint,
    sourceRecordCount: sourceRecords.length,
    backupExportedAt: backup.exportedAt,
    startedAt: state.startedAt ?? stamp,
    finishedAt: null,
    errorCode: null,
    errorMessage: null,
    attempt: state.attempt,
  }, now()))

  const engineResult = await migrateLifeRecords({ source: sourceRecords, target: deps.target })

  if (!engineResult.ok) {
    const failed = await persist(deps, failState(state, `ENGINE_${(engineResult.stage ?? 'unknown').toUpperCase()}`, engineResult.message, now()))
    return {
      ok: false,
      state: failed,
      engineResult,
      backup,
      message: engineResult.message,
      errorCode: `ENGINE_${(engineResult.stage ?? 'unknown').toUpperCase()}`,
    }
  }

  // 复制与回读校验都通过，但权威源仍是 localStorage。
  const ready = await persist(deps, transitionMigrationState(state, 'READY_TO_SWITCH', {
    targetRecordCount: engineResult.recordCount,
    finishedAt: now(),
    errorCode: null,
    errorMessage: null,
  }, now()))

  return {
    ok: true,
    state: ready,
    engineResult,
    backup,
    message: `已复制并逐字段校验 ${engineResult.recordCount} 条记录。数据仍以 localStorage 为准，请确认后手动启用。`,
    errorCode: null,
  }
}

/**
 * 显式启用 IndexedDB 作为唯一权威本地数据源。
 *
 * 启用前再次核对来源指纹：如果用户在上次校验后仍在旧页面写了新记录，
 * 这里会拒绝切换，而不是把新记录落在 IndexedDB 之外。
 */
export async function activateMigration(deps: MigrationDependencies): Promise<MigrationAttemptResult> {
  const now = deps.now ?? (() => new Date().toISOString())
  const state = await readState(deps)

  if (state.status === 'SUCCEEDED') {
    return { ok: true, state, engineResult: null, backup: null, message: '本地数据库已经启用。', errorCode: null }
  }
  if (state.status !== 'READY_TO_SWITCH') {
    return {
      ok: false, state, engineResult: null, backup: null,
      message: `当前状态为「${state.status}」，只有校验通过后才能启用。`,
      errorCode: 'NOT_READY',
    }
  }

  let sourceRecords: LifeRecord[]
  try {
    sourceRecords = await readSourceRecords(deps)
  } catch (cause) {
    const failed = await persist(deps, failState(state, 'SOURCE_RECHECK_FAILED', errorText(cause), now()))
    return {
      ok: false, state: failed, engineResult: null, backup: null,
      message: `启用前无法重新读取本地记录：${errorText(cause)}`,
      errorCode: 'SOURCE_RECHECK_FAILED',
    }
  }

  const currentFingerprint = await fingerprintRecords(sourceRecords)
  if (state.sourceFingerprint === null || currentFingerprint !== state.sourceFingerprint) {
    const failed = await persist(deps, transitionMigrationState(state, 'FAILED', {
      errorCode: 'SOURCE_CHANGED',
      errorMessage: '迁移校验后本地记录发生变化',
      finishedAt: now(),
    }, now()))
    return {
      ok: false, state: failed, engineResult: null, backup: null,
      message: '校验后本地记录发生变化（可能有其它标签页仍在写入）。已拒绝启用，请关闭其它页面后重新迁移。',
      errorCode: 'SOURCE_CHANGED',
    }
  }

  // 目标库内容也必须仍与来源一致，防止在 READY 之后被外部改动。
  const targetRecords = await readTargetRecords(deps)
  if (targetRecords === null) {
    const failed = await persist(deps, failState(state, 'TARGET_RECHECK_FAILED', '无法读取目标库', now()))
    return {
      ok: false, state: failed, engineResult: null, backup: null,
      message: '启用前无法读取目标数据库，已拒绝启用。',
      errorCode: 'TARGET_RECHECK_FAILED',
    }
  }
  const targetFingerprint = await fingerprintRecords(targetRecords)
  if (targetFingerprint !== state.sourceFingerprint) {
    const failed = await persist(deps, transitionMigrationState(state, 'FAILED', {
      errorCode: 'TARGET_CHANGED',
      errorMessage: '启用前目标库内容与来源不一致',
      finishedAt: now(),
    }, now()))
    return {
      ok: false, state: failed, engineResult: null, backup: null,
      message: '目标数据库内容与来源不一致，已拒绝启用。请重新迁移。',
      errorCode: 'TARGET_CHANGED',
    }
  }

  const enabled = await persist(deps, transitionMigrationState(state, 'SUCCEEDED', {
    activeStore: 'indexedDB',
    targetRecordCount: targetRecords.length,
    finishedAt: now(),
    errorCode: null,
    errorMessage: null,
  }, now()))

  return {
    ok: true, state: enabled, engineResult: null, backup: null,
    message: `已启用本地数据库，${targetRecords.length} 条记录现在以 IndexedDB 为唯一权威来源。旧 localStorage 数据仍然保留。`,
    errorCode: null,
  }
}

/**
 * 恢复在 IN_PROGRESS / VERIFYING 中断的迁移。
 *
 * 不覆盖目标记录：
 * - 目标内容已与来源完整一致：只补写 READY_TO_SWITCH；
 * - 目标为空：在来源指纹仍一致时重新执行事务化复制；
 * - 目标非空但内容不一致：标记 FAILED，保留现场等待人工处理。
 */
export async function recoverInterruptedMigration(
  deps: MigrationDependencies,
): Promise<MigrationAttemptResult> {
  const now = deps.now ?? (() => new Date().toISOString())
  let state = await readState(deps)
  if (state.status !== 'IN_PROGRESS' && state.status !== 'VERIFYING') {
    return {
      ok: false, state, engineResult: null, backup: null,
      message: `当前状态为「${state.status}」，没有可恢复的中断迁移。`,
      errorCode: 'NOT_INTERRUPTED',
    }
  }

  let sourceRecords: LifeRecord[]
  let backup: DemoBackup
  try {
    sourceRecords = await readSourceRecords(deps)
    backup = await deps.source.exportBackup(null)
  } catch (cause) {
    const failed = await persist(deps, failState(state, 'RECOVERY_SOURCE_FAILED', errorText(cause), now()))
    return {
      ok: false, state: failed, engineResult: null, backup: null,
      message: `恢复前无法读取或备份来源数据：${errorText(cause)}`,
      errorCode: 'RECOVERY_SOURCE_FAILED',
    }
  }
  if (backup.corruptedRaw) {
    const failed = await persist(deps, failState(
      state,
      'SOURCE_CORRUPTED',
      '恢复检查发现本地记录包含无法解析的数据',
      now(),
    ))
    return {
      ok: false, state: failed, engineResult: null, backup,
      message: '恢复检查发现本地记录损坏，已停止且未覆盖目标数据。',
      errorCode: 'SOURCE_CORRUPTED',
    }
  }

  const sourceFingerprint = await fingerprintRecords(sourceRecords)
  if (state.sourceFingerprint === null || sourceFingerprint !== state.sourceFingerprint) {
    const failed = await persist(deps, transitionMigrationState(state, 'FAILED', {
      errorCode: 'SOURCE_CHANGED',
      errorMessage: '中断迁移期间来源记录发生变化',
      finishedAt: now(),
    }, now()))
    return {
      ok: false, state: failed, engineResult: null, backup,
      message: '中断迁移期间来源记录发生变化，已拒绝恢复。目标库未被修改。',
      errorCode: 'SOURCE_CHANGED',
    }
  }

  const targetRecords = await readTargetRecords(deps)
  if (targetRecords === null) {
    const failed = await persist(deps, failState(state, 'TARGET_RECHECK_FAILED', '无法读取目标库', now()))
    return {
      ok: false, state: failed, engineResult: null, backup,
      message: '无法读取目标数据库，已拒绝恢复。',
      errorCode: 'TARGET_RECHECK_FAILED',
    }
  }

  let engineResult: MigrationRunResult | null = null
  if (targetRecords.length === 0) {
    if (state.status === 'IN_PROGRESS') {
      state = await persist(deps, transitionMigrationState(state, 'VERIFYING', {
        finishedAt: null,
        errorCode: null,
        errorMessage: null,
      }, now()))
    }
    engineResult = await migrateLifeRecords({ source: sourceRecords, target: deps.target })
    if (!engineResult.ok) {
      const failed = await persist(deps, failState(
        state,
        `RECOVERY_${(engineResult.stage ?? 'unknown').toUpperCase()}`,
        engineResult.message,
        now(),
      ))
      return {
        ok: false, state: failed, engineResult, backup,
        message: `恢复复制失败：${engineResult.message}`,
        errorCode: `RECOVERY_${(engineResult.stage ?? 'unknown').toUpperCase()}`,
      }
    }
  } else {
    const targetFingerprint = await fingerprintRecords(targetRecords)
    if (targetFingerprint !== sourceFingerprint) {
      const failed = await persist(deps, transitionMigrationState(state, 'FAILED', {
        errorCode: 'TARGET_MISMATCH',
        errorMessage: '中断迁移的目标库内容与来源不一致',
        finishedAt: now(),
      }, now()))
      return {
        ok: false, state: failed, engineResult: null, backup,
        message: '目标数据库已有内容但与来源不一致。已保留现场且未覆盖，请人工核查后再处理。',
        errorCode: 'TARGET_MISMATCH',
      }
    }
    if (state.status === 'IN_PROGRESS') {
      state = await persist(deps, transitionMigrationState(state, 'VERIFYING', {
        finishedAt: null,
        errorCode: null,
        errorMessage: null,
      }, now()))
    }
  }

  const ready = await persist(deps, transitionMigrationState(state, 'READY_TO_SWITCH', {
    targetRecordCount: sourceRecords.length,
    finishedAt: now(),
    errorCode: null,
    errorMessage: null,
  }, now()))
  return {
    ok: true,
    state: ready,
    engineResult,
    backup,
    message: `已安全恢复中断迁移并校验 ${sourceRecords.length} 条记录。IndexedDB 尚未启用，请确认后手动启用。`,
    errorCode: null,
  }
}

/**
 * 把失败状态重置为可重试。只在 FAILED 时生效，且不删除任何记录。
 */
export async function resetFailedMigration(deps: MigrationDependencies): Promise<MigrationAttemptResult> {
  const now = deps.now ?? (() => new Date().toISOString())
  const state = await readState(deps)
  if (state.status !== 'FAILED') {
    return {
      ok: false, state, engineResult: null, backup: null,
      message: `只有失败状态可以重置，当前为「${state.status}」。`,
      errorCode: 'NOT_FAILED',
    }
  }
  const reset: MigrationState = {
    ...createInitialMigrationState(now()),
    attempt: state.attempt,
  }
  const saved = await persist(deps, reset)
  return {
    ok: true, state: saved, engineResult: null, backup: null,
    message: '已重置失败状态，可以重新开始迁移。目标库中的残留记录不会被自动删除。',
    errorCode: null,
  }
}

/** 只用于隔离测试与开发：读取当前状态标签。 */
export function statusLabel(status: MigrationStatus): string {
  const labels: Record<MigrationStatus, string> = {
    NOT_STARTED: '尚未升级',
    IN_PROGRESS: '正在复制数据',
    VERIFYING: '正在校验数据',
    READY_TO_SWITCH: '已校验，等待启用',
    SUCCEEDED: '已启用本地数据库',
    FAILED: '迁移失败',
  }
  return labels[status]
}
