'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { notFound } from 'next/navigation'
import { createIndexedDBAdapter, type MigrationCapableStorage } from '@/lib/indexeddb-adapter'
import { createLocalStorageAdapter } from '@/lib/storage-adapter'
import { migrateLifeRecords } from '@/lib/life-migration-engine'
import {
  MIGRATION_LOCK_NAME,
  activateMigration,
  prepareMigration,
  readMigrationStatus,
  recoverInterruptedMigration,
  resetFailedMigration,
} from '@/lib/life-migration-service'
import { MIGRATION_STATE_KEY, fingerprintRecords, type MigrationState } from '@/lib/life-migration-state'

/**
 * 仅开发环境的隔离迁移验收入口。
 *
 * 硬边界：
 * - 使用自己的内存 localStorage 模拟对象，从不触碰 window.localStorage；
 * - 使用独立测试数据库名，从不打开正式库 life-tracker-life-records；
 * - 数据全部为合成记录。
 */

const TEST_DB_NAME = 'ai-lifeos-migration-browser-test-v1'
const PRODUCTION_DB_NAME = 'life-tracker-life-records'
const STORAGE_KEY = 'life-tracker:life-records:demo:v1'
const TWO_TAB_MESSAGE = 'ai-lifeos-two-tab-lock-probe'

interface CheckResult {
  name: string
  ok: boolean
  detail: string
}

function createMemoryStorage() {
  const map = new Map<string, string>()
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => { map.set(key, value) },
    raw: () => map.get(STORAGE_KEY) ?? null,
  }
}

const synthetic = () => [
  {
    id: 'test-ex-1',
    type: 'exercise',
    date: '2026-10-22',
    note: '卧推进步了',
    sourceText: '今天练了胸，卧推60公斤做了4组',
    createdAt: '2026-10-22T13:00:00.000Z',
    activity: '卧推',
    weightKg: 60,
    sets: 4,
    moodTag: 'positive',
    legacyBlob: { nested: [1, 2], tags: ['a', 'b'] },
  },
  {
    id: 'test-sl-1',
    type: 'sleep',
    date: '2026-10-22',
    note: '',
    sourceText: '睡了7小时',
    createdAt: '2026-10-22T13:00:00.000Z',
    hours: 7,
  },
]

/**
 * 浏览器失败注入只包在隔离测试适配器外层，仍调用真实 Adapter 的事务路径。
 * 生产 Adapter 和正式数据库不包含这些故障开关。
 */
function createFailureInjectedTarget(
  base: MigrationCapableStorage,
  mode: 'write' | 'read_back',
): MigrationCapableStorage {
  let failReadBack = false
  return {
    ...base,
    async importRawRecordsForMigration(records) {
      if (mode === 'write') throw new Error('模拟 IndexedDB 写入失败')
      const result = await base.importRawRecordsForMigration(records)
      failReadBack = true
      return result
    },
    async load(userId) {
      if (failReadBack) throw new Error('模拟 IndexedDB 回读校验失败')
      return base.load(userId)
    },
  }
}

export default function MigrationTestPage() {
  if (process.env.NODE_ENV === 'production') notFound()

  const [results, setResults] = useState<CheckResult[]>([])
  const [running, setRunning] = useState(false)
  const [twoTabRunning, setTwoTabRunning] = useState(false)
  const [state, setState] = useState<MigrationState | null>(null)
  const storageRef = useRef(createMemoryStorage())
  const [dbName] = useState(TEST_DB_NAME)

  const add = useCallback((name: string, ok: boolean, detail: string) => {
    setResults(current => [...current, { name, ok, detail }])
  }, [])

  useEffect(() => {
    if (dbName === PRODUCTION_DB_NAME) throw new Error('隔离测试禁止使用正式数据库名')
  }, [dbName])

  // 父页面持有迁移锁时，子标签页会通过 ifAvailable 探测并回传结果。
  useEffect(() => {
    const nonce = new URLSearchParams(window.location.search).get('lockProbe')
    if (!nonce || !window.opener) return
    const targetOrigin = window.location.origin
    window.opener.postMessage({ type: TWO_TAB_MESSAGE, event: 'ready', nonce }, targetOrigin)

    const onMessage = (event: MessageEvent<unknown>) => {
      if (event.origin !== targetOrigin) return
      const message = event.data as { type?: unknown; event?: unknown; nonce?: unknown } | null
      if (message?.type !== TWO_TAB_MESSAGE || message.event !== 'start' || message.nonce !== nonce) return
      void navigator.locks.request(MIGRATION_LOCK_NAME, { ifAvailable: true }, async lock => {
        window.opener?.postMessage({
          type: TWO_TAB_MESSAGE,
          event: 'result',
          nonce,
          acquired: lock !== null,
        }, targetOrigin)
      }).catch((cause: unknown) => {
        window.opener?.postMessage({
          type: TWO_TAB_MESSAGE,
          event: 'result',
          nonce,
          acquired: null,
          error: cause instanceof Error ? cause.message : String(cause),
        }, targetOrigin)
      })
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  async function resetAll() {
    setRunning(true)
    setResults([])
    setState(null)
    storageRef.current = createMemoryStorage()
    try {
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.deleteDatabase(dbName)
        request.onsuccess = () => resolve()
        request.onerror = () => reject(request.error)
        request.onblocked = () => reject(new Error('数据库被占用，请关闭其它测试页'))
      })
      add('删除隔离测试数据库', true, `已删除 ${dbName}`)
    } catch (cause) {
      add('删除隔离测试数据库', false, cause instanceof Error ? cause.message : String(cause))
    } finally {
      setRunning(false)
    }
  }

  async function runAll() {
    setRunning(true)
    setResults([])
    setState(null)
    storageRef.current = createMemoryStorage()

    const deps = () => ({
      source: createLocalStorageAdapter(storageRef.current),
      target: createIndexedDBAdapter({ databaseName: dbName }),
    })

    try {
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.deleteDatabase(dbName)
        request.onsuccess = () => resolve()
        request.onerror = () => reject(request.error)
        request.onblocked = () => reject(new Error('数据库被占用'))
      })

      // 1. 正常迁移 + 自定义字段
      storageRef.current.setItem(STORAGE_KEY, JSON.stringify(synthetic()))
      const prepared = await prepareMigration(deps())
      setState(prepared.state)
      add('正常迁移到 READY_TO_SWITCH', prepared.ok && prepared.state.status === 'READY_TO_SWITCH', prepared.message)

      const target = createIndexedDBAdapter({ databaseName: dbName })
      const stored = await target.load(null)
      add('记录数量一致', stored.length === 2, `目标库 ${stored.length} 条`)
      const exercise = stored.find(record => record.id === 'test-ex-1') as unknown as Record<string, unknown> | undefined
      add('原始 ID 与 createdAt 保留', exercise?.createdAt === '2026-10-22T13:00:00.000Z', '逐字段比对 createdAt')
      add('自定义字段保留', exercise?.moodTag === 'positive', `moodTag=${String(exercise?.moodTag)}`)
      add('嵌套对象与数组保留', JSON.stringify(exercise?.legacyBlob) === JSON.stringify({ nested: [1, 2], tags: ['a', 'b'] }), JSON.stringify(exercise?.legacyBlob))
      add('来源 localStorage 未被修改', (storageRef.current.raw() ?? '').includes('今天练了胸'), '原始字符串仍在')

      // 2. 启用
      const activated = await activateMigration(deps())
      setState(activated.state)
      add('显式启用后 SUCCEEDED', activated.ok && activated.state.activeStore === 'indexedDB', activated.message)

      // 3. 刷新后状态
      const reopened = await readMigrationStatus(deps())
      add('刷新后状态保持 SUCCEEDED', reopened.state.status === 'SUCCEEDED', `status=${reopened.state.status}`)
      add('刷新后记录仍在', reopened.targetRecordCount === 2, `target=${reopened.targetRecordCount}`)

      // 4. 重复迁移被拒绝
      const again = await prepareMigration(deps())
      add('重复迁移被拒绝', !again.ok && again.errorCode === 'ALREADY_ENABLED', again.message)

      // 5. 空数据迁移（独立库）
      const emptyDb = `${dbName}-empty`
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.deleteDatabase(emptyDb)
        request.onsuccess = () => resolve()
        request.onerror = () => reject(request.error)
      })
      const emptyStorage = createMemoryStorage()
      emptyStorage.setItem(STORAGE_KEY, JSON.stringify([]))
      const emptyResult = await prepareMigration({
        source: createLocalStorageAdapter(emptyStorage),
        target: createIndexedDBAdapter({ databaseName: emptyDb }),
      })
      add('空数据迁移', emptyResult.ok && emptyResult.state.status === 'READY_TO_SWITCH', emptyResult.message)

      // 6. 损坏数据拒绝
      const brokenDb = `${dbName}-broken`
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.deleteDatabase(brokenDb)
        request.onsuccess = () => resolve()
        request.onerror = () => reject(request.error)
      })
      const brokenStorage = createMemoryStorage()
      brokenStorage.setItem(STORAGE_KEY, '{"broken":')
      const brokenResult = await prepareMigration({
        source: createLocalStorageAdapter(brokenStorage),
        target: createIndexedDBAdapter({ databaseName: brokenDb }),
      })
      const brokenTarget = createIndexedDBAdapter({ databaseName: brokenDb })
      add('损坏数据被拒绝且目标为空', !brokenResult.ok && (await brokenTarget.load(null)).length === 0, brokenResult.message)

      // 7. 重复 ID 拒绝
      const dupDb = `${dbName}-dup`
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.deleteDatabase(dupDb)
        request.onsuccess = () => resolve()
        request.onerror = () => reject(request.error)
      })
      const dupStorage = createMemoryStorage()
      const base = synthetic()[0]
      dupStorage.setItem(STORAGE_KEY, JSON.stringify([base, { ...base }]))
      const dupResult = await prepareMigration({
        source: createLocalStorageAdapter(dupStorage),
        target: createIndexedDBAdapter({ databaseName: dupDb }),
      })
      add('重复 ID 被拒绝', !dupResult.ok, dupResult.message)

      // 8. 来源在校验后变化 → 拒绝启用
      const changeDb = `${dbName}-change`
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.deleteDatabase(changeDb)
        request.onsuccess = () => resolve()
        request.onerror = () => reject(request.error)
      })
      const changeStorage = createMemoryStorage()
      changeStorage.setItem(STORAGE_KEY, JSON.stringify([synthetic()[0]]))
      const changeDeps = {
        source: createLocalStorageAdapter(changeStorage),
        target: createIndexedDBAdapter({ databaseName: changeDb }),
      }
      await prepareMigration(changeDeps)
      const changed = JSON.parse(changeStorage.raw() ?? '[]')
      changed.push(synthetic()[1])
      changeStorage.setItem(STORAGE_KEY, JSON.stringify(changed))
      const changeActivate = await activateMigration(changeDeps)
      add('来源变化时拒绝启用', !changeActivate.ok && changeActivate.errorCode === 'SOURCE_CHANGED', changeActivate.message)

      // 9. 目标非空拒绝
      const nonEmptyDb = `${dbName}-nonempty`
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.deleteDatabase(nonEmptyDb)
        request.onsuccess = () => resolve()
        request.onerror = () => reject(request.error)
      })
      const nonEmptyTarget = createIndexedDBAdapter({ databaseName: nonEmptyDb })
      await nonEmptyTarget.importRawRecordsForMigration([synthetic()[1]])
      const nonEmptyResult = await migrateLifeRecords({
        source: [synthetic()[0]],
        target: nonEmptyTarget,
      })
      add('目标非空时拒绝写入', !nonEmptyResult.ok && nonEmptyResult.stage === 'target_not_empty', nonEmptyResult.message)
      add('目标原有记录未被覆盖', (await nonEmptyTarget.load(null))[0]?.id === 'test-sl-1', '原记录仍在')

      // 10. JSON 备份仍可用
      const backup = await target.exportBackup(null)
      add('JSON 备份仍可导出', backup.records.length === 2 && backup.version === 1, `${backup.records.length} 条`)
      const restoredCount = await target.restoreBackup(null, backup)
      add('JSON 备份仍可恢复', restoredCount === 2 && (await target.load(null)).length === 2, `恢复 ${restoredCount} 条`)

      // 12. 浏览器失败注入：写入失败不留下记录；回读失败不宣称成功且保留现场。
      const writeFailureDb = `${dbName}-write-failure`
      const readBackFailureDb = `${dbName}-readback-failure`
      await Promise.all([writeFailureDb, readBackFailureDb].map(name => new Promise<void>((resolve, reject) => {
        const request = indexedDB.deleteDatabase(name)
        request.onsuccess = () => resolve()
        request.onerror = () => reject(request.error)
      })))
      const failureStorage = createMemoryStorage()
      failureStorage.setItem(STORAGE_KEY, JSON.stringify(synthetic()))
      const writeFailureBase = createIndexedDBAdapter({ databaseName: writeFailureDb })
      const writeFailure = await prepareMigration({
        source: createLocalStorageAdapter(failureStorage),
        target: createFailureInjectedTarget(writeFailureBase, 'write'),
      })
      add(
        '写入失败时状态为 FAILED 且目标为空',
        !writeFailure.ok && writeFailure.state.status === 'FAILED' && (await writeFailureBase.load(null)).length === 0,
        writeFailure.message,
      )

      const readBackFailureBase = createIndexedDBAdapter({ databaseName: readBackFailureDb })
      const readBackFailure = await prepareMigration({
        source: createLocalStorageAdapter(failureStorage),
        target: createFailureInjectedTarget(readBackFailureBase, 'read_back'),
      })
      add(
        '回读失败不宣称成功且保留已提交现场',
        !readBackFailure.ok
          && readBackFailure.errorCode === 'ENGINE_READ_BACK'
          && readBackFailure.state.status === 'FAILED'
          && readBackFailure.state.activeStore === 'localStorage'
          && (await readBackFailureBase.load(null)).length === 2,
        readBackFailure.message,
      )

      // 13. 状态持久化键
      const rawState = await target.readMigrationState()
      add('迁移状态保存在 meta store', (rawState as { key?: string } | null)?.key === MIGRATION_STATE_KEY, String((rawState as { status?: string } | null)?.status))

      // 14. 中断恢复：完整目标只补状态；不一致目标保留现场。
      const recoveredDb = `${dbName}-recovered`
      const mismatchedDb = `${dbName}-mismatched`
      await Promise.all([recoveredDb, mismatchedDb].map(name => new Promise<void>((resolve, reject) => {
        const request = indexedDB.deleteDatabase(name)
        request.onsuccess = () => resolve()
        request.onerror = () => reject(request.error)
      })))
      const recoveryStorage = createMemoryStorage()
      const recoverySource = createLocalStorageAdapter(recoveryStorage)
      await recoverySource.create(null, [{ type: 'sleep', date: '2026-10-22', hours: 7, note: '' }], '合成睡眠记录')
      const recoveryRecords = await recoverySource.load(null)
      const recoveryFingerprint = await fingerprintRecords(recoveryRecords)
      const recoveredTarget = createIndexedDBAdapter({ databaseName: recoveredDb })
      await recoveredTarget.importRawRecordsForMigration(recoveryRecords)
      await recoveredTarget.writeMigrationState({
        key: MIGRATION_STATE_KEY,
        status: 'VERIFYING',
        activeStore: 'localStorage',
        sourceFingerprint: recoveryFingerprint,
        sourceRecordCount: 1,
        targetRecordCount: null,
        backupExportedAt: null,
        startedAt: '2026-10-22T10:00:00.000Z',
        updatedAt: '2026-10-22T10:00:00.000Z',
        finishedAt: null,
        attempt: 1,
        errorCode: null,
        errorMessage: null,
      })
      const recovered = await recoverInterruptedMigration({ source: recoverySource, target: recoveredTarget })
      add('中断迁移安全恢复到等待启用', recovered.ok && recovered.state.status === 'READY_TO_SWITCH', recovered.message)

      const mismatchedTarget = createIndexedDBAdapter({ databaseName: mismatchedDb })
      await mismatchedTarget.importRawRecordsForMigration([{ ...recoveryRecords[0], id: 'unrelated-target-record' }])
      await mismatchedTarget.writeMigrationState({
        key: MIGRATION_STATE_KEY,
        status: 'VERIFYING',
        activeStore: 'localStorage',
        sourceFingerprint: recoveryFingerprint,
        sourceRecordCount: 1,
        targetRecordCount: null,
        backupExportedAt: null,
        startedAt: '2026-10-22T10:00:00.000Z',
        updatedAt: '2026-10-22T10:00:00.000Z',
        finishedAt: null,
        attempt: 1,
        errorCode: null,
        errorMessage: null,
      })
      const mismatch = await recoverInterruptedMigration({ source: recoverySource, target: mismatchedTarget })
      add(
        '目标不一致时拒绝恢复且保留现场',
        !mismatch.ok && mismatch.errorCode === 'TARGET_MISMATCH' && (await mismatchedTarget.load(null))[0]?.id === 'unrelated-target-record',
        mismatch.message,
      )

      // 15. 同一上下文 Web Locks 协作锁：同一时刻只允许一个持有者。
      let firstAcquired = false
      let secondAcquired = false
      await navigator.locks.request(MIGRATION_LOCK_NAME, async () => {
        firstAcquired = true
        await navigator.locks.request(MIGRATION_LOCK_NAME, { ifAvailable: true }, lock => {
          secondAcquired = lock !== null
        })
      })
      add('同源 Web Lock 阻止并发持有', firstAcquired && !secondAcquired, '第二个 ifAvailable 请求未取得锁')

      // 16. 失败状态可重置，且不删除目标记录。
      const reset = await resetFailedMigration({ source: recoverySource, target: mismatchedTarget })
      add(
        '失败状态可重置且残留记录保留',
        reset.ok && reset.state.status === 'NOT_STARTED' && (await mismatchedTarget.load(null)).length === 1,
        reset.message,
      )
    } catch (cause) {
      add('测试执行异常', false, cause instanceof Error ? cause.message : String(cause))
    } finally {
      setRunning(false)
    }
  }

  async function refreshStatus() {
    try {
      const view = await readMigrationStatus({
        source: createLocalStorageAdapter(storageRef.current),
        target: createIndexedDBAdapter({ databaseName: dbName }),
      })
      setState(view.state)
      add('刷新后状态读取', true, `status=${view.state.status}, target=${view.targetRecordCount}`)
    } catch (cause) {
      add('刷新后状态读取', false, cause instanceof Error ? cause.message : String(cause))
    }
  }

  async function resetFailure() {
    try {
      const result = await resetFailedMigration({
        source: createLocalStorageAdapter(storageRef.current),
        target: createIndexedDBAdapter({ databaseName: dbName }),
      })
      setState(result.state)
      add('重置失败状态', result.ok, result.message)
    } catch (cause) {
      add('重置失败状态', false, cause instanceof Error ? cause.message : String(cause))
    }
  }

  async function runTwoTabLockTest() {
    if (twoTabRunning) return
    setTwoTabRunning(true)
    try {
      if (!navigator.locks) throw new Error('当前浏览器不支持 Web Locks')
      const nonce = crypto.randomUUID()
      const childUrl = `${window.location.pathname}?lockProbe=${encodeURIComponent(nonce)}`
      const child = window.open(childUrl, '_blank', 'popup,width=420,height=360')
      if (!child) throw new Error('浏览器阻止了新标签页，请允许本站弹出窗口后重试')

      const waitFor = (eventName: 'ready' | 'result', timeoutMs: number) => new Promise<{
        acquired?: boolean | null
        error?: string
      }>((resolve, reject) => {
        const timeout = window.setTimeout(() => {
          window.removeEventListener('message', onMessage)
          reject(new Error(`等待子标签页「${eventName}」超时`))
        }, timeoutMs)
        const onMessage = (event: MessageEvent<unknown>) => {
          if (event.origin !== window.location.origin) return
          const message = event.data as {
            type?: unknown
            event?: unknown
            nonce?: unknown
            acquired?: boolean | null
            error?: string
          } | null
          if (message?.type !== TWO_TAB_MESSAGE || message.event !== eventName || message.nonce !== nonce) return
          window.clearTimeout(timeout)
          window.removeEventListener('message', onMessage)
          resolve({ acquired: message.acquired, error: message.error })
        }
        window.addEventListener('message', onMessage)
      })

      await waitFor('ready', 15_000)
      // 用对象持有结果：TypeScript 不会因为回调内赋值而重置 let 的类型收窄。
      const holder: { probe: { acquired?: boolean | null; error?: string } | null } = { probe: null }
      await navigator.locks.request(MIGRATION_LOCK_NAME, async () => {
        child.postMessage({ type: TWO_TAB_MESSAGE, event: 'start', nonce }, window.location.origin)
        holder.probe = await waitFor('result', 10_000)
      })
      const probe = holder.probe
      add(
        '两个真实标签页不能同时取得迁移锁',
        probe !== null && probe.acquired === false && !probe.error,
        probe?.error ?? `子标签页取得锁=${String(probe?.acquired)}`,
      )
    } catch (cause) {
      add('两个真实标签页不能同时取得迁移锁', false, cause instanceof Error ? cause.message : String(cause))
    } finally {
      setTwoTabRunning(false)
    }
  }

  const passed = results.filter(result => result.ok).length
  const failed = results.length - passed

  return <main className="min-h-screen bg-[#070d1b] px-4 py-8 text-slate-100">
    <div className="mx-auto max-w-3xl space-y-5">
      <header>
        <p className="font-mono text-[10px] tracking-[0.25em] text-cyan-300">DEV ONLY / ISOLATED</p>
        <h1 className="mt-2 text-2xl font-black">本地数据库迁移 · 隔离验收</h1>
        <p className="mt-2 text-sm text-muted">IndexedDB 独立测试，不会修改正式生活记录。</p>
      </header>

      <section className="rounded-2xl border border-amber-300/30 bg-amber-950/30 p-4 text-sm leading-6 text-amber-100">
        <p><strong>隔离边界：</strong>本页使用内存中的模拟 localStorage，不读取 window.localStorage。</p>
        <p><strong>测试数据库：</strong><code className="text-amber-200">{dbName}</code></p>
        <p><strong>正式数据库：</strong><code>{PRODUCTION_DB_NAME}</code>（本页从不打开）</p>
      </section>

      <section className="rounded-2xl border border-cyan-300/20 bg-[#0d1a32] p-4">
        <div className="flex flex-wrap gap-2">
          <button disabled={running} onClick={() => void runAll()} className="rounded-xl bg-cyan-300 px-4 py-2 font-bold text-[#071326] disabled:opacity-40">{running ? '运行中…' : '运行完整迁移测试'}</button>
          <button disabled={running} onClick={() => void refreshStatus()} className="rounded-xl border border-cyan-300/30 px-4 py-2 text-sm text-cyan-200 disabled:opacity-40">刷新后读取状态</button>
          <button disabled={running} onClick={() => void resetFailure()} className="rounded-xl border border-cyan-300/30 px-4 py-2 text-sm text-cyan-200 disabled:opacity-40">重置失败状态</button>
          <button disabled={running} onClick={() => void resetAll()} className="rounded-xl border border-red-400/40 px-4 py-2 text-sm text-red-200 disabled:opacity-40">删除隔离测试数据库</button>
          <button disabled={running || twoTabRunning} onClick={() => void runTwoTabLockTest()} className="rounded-xl border border-fuchsia-300/40 px-4 py-2 text-sm text-fuchsia-200 disabled:opacity-40">{twoTabRunning ? '等待子标签页…' : '两个真实标签页锁测试'}</button>
        </div>
        {state && <p className="mt-3 text-xs text-muted">当前状态：{state.status} · activeStore={state.activeStore}</p>}
      </section>

      {results.length > 0 && <section className="rounded-2xl border border-cyan-300/20 bg-[#0d1a32] p-4">
        <div className="flex justify-between text-sm"><span>总计 {results.length}</span><span className="text-emerald-300">通过 {passed}</span><span className="text-red-300">失败 {failed}</span></div>
        <ul className="mt-3 space-y-2">
          {results.map((result, index) => <li key={index} className="rounded-xl border border-white/10 p-3 text-sm">
            <div className="flex justify-between gap-3"><strong>{result.ok ? '✔' : '✖'} {result.name}</strong><span className={result.ok ? 'text-emerald-300' : 'text-red-300'}>{result.ok ? 'PASS' : 'FAIL'}</span></div>
            <p className="mt-1 break-words text-xs text-muted">{result.detail}</p>
          </li>)}
        </ul>
      </section>}
    </div>
  </main>
}
