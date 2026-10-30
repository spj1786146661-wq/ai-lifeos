import test from 'node:test'
import assert from 'node:assert/strict'
import 'fake-indexeddb/auto'
import {
  AttachmentStorageError,
  attachmentSha256,
  collectReferencedAttachmentIds,
  createIndexedDBAttachmentStorage,
  createMemoryAttachmentStorage,
  validateAttachmentBackup,
  validateAttachmentFile,
} from '../lib/life-attachments.ts'

function pngFile(name = 'meal.png', bytes = [137, 80, 78, 71, 1, 2, 3]) {
  return new File([new Uint8Array(bytes)], name, { type: 'image/png' })
}

test('attachment files are type and size validated before storage', () => {
  assert.throws(() => validateAttachmentFile({ name: 'x.gif', type: 'image/gif', size: 10 }), /JPG/)
  assert.throws(() => validateAttachmentFile({ name: 'x.png', type: 'image/png', size: 0 }), /为空/)
  assert.throws(() => validateAttachmentFile({ name: 'x.png', type: 'image/png', size: 5_000_001 }), /5 MB/)
  assert.doesNotThrow(() => validateAttachmentFile(pngFile()))
})

test('the same image content is stored once and returns a reusable attachment ref', async () => {
  const storage = createMemoryAttachmentStorage()
  const first = await storage.save(pngFile('one.png'))
  const second = await storage.save(pngFile('two.png'))
  assert.equal(first.id, second.id)
  assert.equal(first.sha256, await attachmentSha256(pngFile()))
  assert.ok(await storage.load(first.id))
})

test('memory attachment backup validates and restores the original bytes', async () => {
  const source = createMemoryAttachmentStorage()
  const ref = await source.save(pngFile())
  const backup = await source.exportBackup([ref.id])
  const target = createMemoryAttachmentStorage()
  assert.equal(await target.restoreBackup(backup), 1)
  const restored = await target.load(ref.id)
  assert.ok(restored)
  assert.equal(restored.sha256, ref.sha256)
  assert.deepEqual([...new Uint8Array(await restored.blob.arrayBuffer())], [137, 80, 78, 71, 1, 2, 3])
})

test('invalid or conflicting attachment backups are rejected', async () => {
  const storage = createMemoryAttachmentStorage()
  const ref = await storage.save(pngFile())
  const backup = await storage.exportBackup([ref.id])
  await assert.rejects(() => validateAttachmentBackup({ ...backup, version: 99 }), /版本/)
  await assert.rejects(() => validateAttachmentBackup({ ...backup, attachments: [backup.attachments[0], backup.attachments[0]] }), /重复/)
  const corrupt = structuredClone(backup)
  corrupt.attachments[0].sha256 = 'b'.repeat(64)
  await assert.rejects(() => validateAttachmentBackup(corrupt), /校验值|大小|字段/i)
})

test('unreferenced attachments can be removed while shared attachments remain', async () => {
  const storage = createMemoryAttachmentStorage()
  const shared = await storage.save(pngFile('shared.png'))
  assert.equal(await storage.removeUnreferenced(shared.id, new Set([shared.id])), false)
  assert.equal(await storage.removeUnreferenced(shared.id, new Set()), true)
  assert.equal(await storage.load(shared.id), null)
})

test('record references are deduplicated for backup and cleanup', () => {
  assert.deepEqual([...collectReferencedAttachmentIds([
    { attachments: [{ id: 'a' }, { id: 'b' }] },
    { attachments: [{ id: 'b' }] },
    {},
  ])].sort(), ['a', 'b'])
})

test('isolated IndexedDB attachment storage persists blobs across adapter instances', async () => {
  const databaseName = `attachment-test-${crypto.randomUUID()}`
  const first = createIndexedDBAttachmentStorage({ databaseName })
  const ref = await first.save(pngFile())
  const second = createIndexedDBAttachmentStorage({ databaseName })
  const loaded = await second.load(ref.id)
  assert.ok(loaded)
  assert.equal(loaded.sha256, ref.sha256)
  assert.equal(loaded.blob.type, 'image/png')
})

test('IndexedDB attachment restore is transactional and rejects a conflicting id', async () => {
  const sourceName = `attachment-source-${crypto.randomUUID()}`
  const targetName = `attachment-target-${crypto.randomUUID()}`
  const source = createIndexedDBAttachmentStorage({ databaseName: sourceName })
  const target = createIndexedDBAttachmentStorage({ databaseName: targetName })
  const ref = await source.save(pngFile())
  const backup = await source.exportBackup([ref.id])
  assert.equal(await target.restoreBackup(backup), 1)
  const corrupt = structuredClone(backup)
  corrupt.attachments[0].sha256 = 'b'.repeat(64)
  corrupt.attachments[0].dataUrl = corrupt.attachments[0].dataUrl.slice(0, -4) + 'AAAA'
  await assert.rejects(() => target.restoreBackup(corrupt), AttachmentStorageError)
})
