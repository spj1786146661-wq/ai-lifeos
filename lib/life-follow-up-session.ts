import {
  isSupportedFollowUpField,
  normalizeFollowUpHistory,
  type LifeFollowUpHistoryItem,
  type LifeFollowUpQuestion,
} from './life-follow-up.ts'
import { LIFE_RECORD_TYPES, type LifeRecordType } from './life-records.ts'

export const FOLLOW_UP_SESSION_STORAGE_KEY = 'ai-lifeos:follow-up-session:v1'

export interface PersistedFollowUpItem {
  question: LifeFollowUpQuestion
  recordId: string
}

export interface FollowUpSessionSnapshot {
  version: 1
  messageId: string
  round: 1 | 2 | 3
  ended: boolean
  recordIds: string[]
  items: PersistedFollowUpItem[]
  history: LifeFollowUpHistoryItem[]
}

function validType(value: unknown): value is LifeRecordType {
  return typeof value === 'string' && LIFE_RECORD_TYPES.includes(value as LifeRecordType)
}

function normalizeRecordIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.flatMap(item => {
    if (typeof item !== 'string') return []
    const id = item.trim().slice(0, 160)
    return id ? [id] : []
  }))].slice(0, 200)
}

function normalizePersistedQuestion(value: unknown): LifeFollowUpQuestion | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const questionId = typeof raw.questionId === 'string'
    ? raw.questionId.trim().slice(0, 100)
    : typeof raw.id === 'string'
      ? raw.id.trim().slice(0, 100)
      : ''
  const type = raw.recordType ?? raw.type
  const field = raw.targetField ?? raw.field
  const question = typeof raw.question === 'string'
    ? raw.question.normalize('NFKC').replace(/\s+/g, ' ').trim().slice(0, 160)
    : ''
  const recordIndex = Number(raw.recordIndex)
  const roundValue = Number(raw.round)
  const round: 1 | 2 | 3 = roundValue === 2 ? 2 : roundValue === 3 ? 3 : 1
  const priorityValue = Number(raw.priority)
  if (
    !questionId
    || !validType(type)
    || !isSupportedFollowUpField(type, field)
    || !question
    || !Number.isInteger(recordIndex)
    || recordIndex < 0
  ) return null
  const targetRecordId = typeof raw.targetRecordId === 'string'
    ? raw.targetRecordId.trim().slice(0, 160)
    : ''
  return {
    questionId,
    id: questionId,
    recordIndex,
    ...(targetRecordId ? { targetRecordId } : {}),
    type,
    recordType: type,
    field,
    targetField: field,
    question,
    round,
    priority: Number.isFinite(priorityValue) ? Math.max(1, Math.min(999, Math.round(priorityValue))) : 1,
    origin: raw.origin === 'rule' ? 'rule' : 'ai',
    ...(typeof raw.reason === 'string' && raw.reason.trim()
      ? { reason: raw.reason.trim().slice(0, 240) }
      : {}),
  }
}

export function parseFollowUpSessionSnapshot(raw: string | null): FollowUpSessionSnapshot | null {
  if (!raw) return null
  try {
    const value = JSON.parse(raw) as Record<string, unknown>
    if (!value || value.version !== 1 || typeof value.messageId !== 'string' || !value.messageId.trim()) return null
    const roundValue = Number(value.round)
    const round: 1 | 2 | 3 = roundValue === 2 ? 2 : roundValue === 3 ? 3 : 1
    const items = Array.isArray(value.items)
      ? value.items.flatMap(item => {
          if (!item || typeof item !== 'object') return []
          const candidate = item as Record<string, unknown>
          const question = normalizePersistedQuestion(candidate.question)
          const recordId = typeof candidate.recordId === 'string'
            ? candidate.recordId.trim().slice(0, 160)
            : ''
          return question && recordId ? [{ question, recordId }] : []
        }).slice(0, 3)
      : []
    const history = normalizeFollowUpHistory(value.history)
    const persistedRecordIds = normalizeRecordIds(value.recordIds)
    const legacyRecordIds = [
      ...items.map(item => item.recordId),
      ...history.map(item => item.targetRecordId),
    ]
    const recordIds = [...new Set([
      ...persistedRecordIds,
      ...legacyRecordIds,
    ])]
    return {
      version: 1,
      messageId: value.messageId.trim().slice(0, 160),
      round,
      ended: value.ended === true,
      recordIds,
      items,
      history,
    }
  } catch {
    return null
  }
}

export function followUpSessionRecordIds(snapshot: FollowUpSessionSnapshot): string[] {
  return [...new Set([
    ...snapshot.recordIds,
    ...snapshot.items.map(item => item.recordId),
    ...snapshot.history.map(item => item.targetRecordId),
  ])].filter(Boolean).slice(0, 200)
}

export function serializeFollowUpSessionSnapshot(
  snapshot: FollowUpSessionSnapshot,
): string {
  return JSON.stringify(snapshot)
}
