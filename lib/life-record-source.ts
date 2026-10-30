import type { LifeRecordSourceRef } from './life-records.ts'
import { providerDisplayName } from './ai/provider-registry.ts'

/** A user-facing label that never upgrades rule output into a model claim. */
export function lifeRecordSourceLabel(sourceRef: LifeRecordSourceRef | undefined, confirmed = false): string {
  if (!sourceRef) return confirmed ? '手动确认' : ''
  if (sourceRef.origin === 'ai') {
    // Old records may have origin=ai from the rule era. Without a confirmed
    // provider they must not be relabelled as a real model result.
    if (!sourceRef.provider || sourceRef.provider === 'rule') {
      return confirmed ? '来源未标注后已确认' : '来源未标注 · 待你确认'
    }
    const provider = providerDisplayName(sourceRef.provider)
    return confirmed ? `${provider}提取后已确认` : `${provider}提取 · 待你确认`
  }
  if (sourceRef.origin === 'fallback-rule') return confirmed ? '本地规则补回后已确认 · 未调用 AI' : '本地规则补回 · 未冒充 AI · 待你确认'
  if (sourceRef.origin === 'rule') return confirmed ? '本地规则解析后已确认 · 未调用 AI' : '本地规则解析 · 未调用 AI · 待你确认'
  return confirmed ? '你手动确认' : '你手动添加 · 待你确认'
}
