import type { DemoBackup } from './life-demo-store.ts'
import {
  addDemoRecords,
  deleteDemoRecord,
  exportDemoBackup,
  isDemoStorageCorrupted,
  readDemoRecords,
  restoreDemoBackup,
  updateDemoRecord,
  type LifeStorage,
} from './life-demo-store.ts'
import type { LifeRecord, LifeRecordDraft } from './life-records.ts'

/**
 * StorageAdapter v1.1 — the single seam between the record UI and any backend.
 * All methods are Promise-based so a future IndexedDB (or desktop SQLite)
 * adapter can implement the same interface without touching callers.
 * `userId === null` means local/guest mode; adapters decide what that means.
 */
export interface LifeRecordStorage {
  load(userId: string | null): Promise<LifeRecord[]>
  /** Saves confirmed drafts and returns the created records. */
  create(userId: string | null, drafts: LifeRecordDraft[], sourceText: string): Promise<LifeRecord[]>
  update(userId: string | null, id: string, draft: LifeRecordDraft): Promise<void>
  remove(userId: string | null, id: string): Promise<void>
  /**
   * Data-integrity check for local-mode storage (writes are blocked while true).
   * Deliberately independent from any future migration status, which should be
   * a separate getMigrationStatus() concern, not mixed into this method.
   */
  isLocalDataCorrupted(userId: string | null): Promise<boolean>
  /** JSON backup v1; cloud-backed adapters may reject for unsupported modes. */
  exportBackup(userId: string | null): Promise<DemoBackup>
  /** Validates the whole backup before writing; returns restored record count. */
  restoreBackup(userId: string | null, backup: unknown): Promise<number>
}

/**
 * Wraps the existing localStorage safety net (no 500-record truncation,
 * corrupted-data write blocking, quota errors, JSON backup v1) without
 * changing its storage key or on-disk format.
 */
export function createLocalStorageAdapter(storage: LifeStorage): LifeRecordStorage {
  return {
    async load() {
      return readDemoRecords(storage).sort((a, b) => b.date.localeCompare(a.date))
    },
    async create(_userId, drafts, sourceText) {
      return addDemoRecords(storage, drafts, sourceText)
    },
    async update(_userId, id, draft) {
      updateDemoRecord(storage, id, draft)
    },
    async remove(_userId, id) {
      deleteDemoRecord(storage, id)
    },
    isLocalDataCorrupted() {
      return Promise.resolve(isDemoStorageCorrupted(storage))
    },
    async exportBackup() {
      return exportDemoBackup(storage)
    },
    async restoreBackup(_userId, backup) {
      return restoreDemoBackup(storage, backup)
    },
  }
}
