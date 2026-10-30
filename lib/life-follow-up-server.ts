import { runChatgptPlanText } from './ai/chatgpt-plan-provider.ts'
import {
  deriveRuleFollowUpQuestions,
  normalizeSavedRecordFollowUpQuestions,
  type LifeFollowUpHistoryItem,
  type LifeFollowUpQuestion,
} from './life-follow-up.ts'
import {
  resolveLifeAiProviderState,
  tokenHubLifeOutputBudget,
  type LifeAiProviderState,
} from './life-parse-server.ts'
import type { LifeRecord } from './life-records.ts'
import { ModelTestUpstreamError } from './tokenhub-model-test.ts'
import type { ValidatedByokConnection } from './ai/byok-connection.ts'
import { ProviderRequestError } from './ai/provider-error.ts'
import { getProviderDefinition } from './ai/provider-registry.ts'
import { isByokProviderId } from './ai/provider-types.ts'
import { runProviderText } from './ai/run-provider-text.ts'

export interface FollowUpGenerationInput {
  records: LifeRecord[]
  history: LifeFollowUpHistoryItem[]
  round: 2 | 3
  messageId: string
  byokConnection?: ValidatedByokConnection
  requireByok?: boolean
}

export interface FollowUpGenerationResult {
  mode: 'ai' | 'fallback-rule'
  provider: string
  model: string
  notice: string
  followUps: LifeFollowUpQuestion[]
  latencyMs: number
  usage: unknown
}

function safeCorrelationId(value: unknown): string {
  if (typeof value !== 'string') return 'unknown'
  const cleaned = value.replace(/[^A-Za-z0-9._:-]/g, '').slice(0, 96)
  return cleaned || 'unknown'
}

function recordForPrompt(record: LifeRecord) {
  return {
    id: record.id,
    type: record.type,
    date: record.date,
    sourceText: record.sourceText,
    note: record.note,
    activity: record.activity,
    durationMinutes: record.durationMinutes,
    weightKg: record.weightKg,
    sets: record.sets,
    repsPerSet: record.repsPerSet,
    hours: record.hours,
    wakeFeeling: record.wakeFeeling,
    amount: record.amount,
    score: record.score,
    subject: record.subject,
    quantity: record.quantity,
    unit: record.unit,
    food: record.food,
    supplements: (record.supplements ?? []).map(supplement => ({
      field: supplement.field,
      answer: supplement.answer,
      round: supplement.round,
    })),
  }
}

function historyForPrompt(history: readonly LifeFollowUpHistoryItem[]) {
  return history.map(item => ({
    questionId: item.questionId,
    targetRecordId: item.targetRecordId,
    recordType: item.recordType,
    targetField: item.targetField,
    question: item.question,
    round: item.round,
    status: item.status,
    answer: item.answer,
  }))
}

export function followUpRoundPrompt(round: 2 | 3): string {
  return `你是 AI-LifeOS 的生活记录补充问题规划器。当前是第 ${round} 轮，最多三轮。你会收到本次消息产生的全部相关记录、当前已保存字段，以及之前问题的回答或跳过状态。请联合检查全部记录，而不是只检查一条记录。找出对未来趋势分析有真实价值、且当前仍缺失或含糊的信息，按重要性统一排序。最多返回三个问题；可以关联不同记录，也可以在同一记录确有多个高价值缺口时返回多个，但应优先兼顾其他重要记录。不得重复询问已有字段、已回答或已跳过的问题，不得为了凑满数量而追问，不得过度收集个人信息，不得把猜测写成事实。若没有值得补充的信息，返回空数组。只输出纯 JSON：{"followUps":[{"questionId":"唯一短ID","targetRecordId":"输入中的记录ID","recordType":"记录类型","targetField":"可补充字段","question":"简短自然的问题","round":${round},"priority":1到3的整数,"reason":"可选简短原因"}]}。priority 越小越重要。targetField 必须属于该记录类型允许的 activity、durationMinutes、weightKg、sets、repsPerSet、hours、wakeFeeling、amount、score、subject、quantity、unit、food。`
}

function extractJsonObject(raw: string): unknown {
  const clean = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
  try {
    return JSON.parse(clean)
  } catch {
    const start = clean.indexOf('{')
    const end = clean.lastIndexOf('}')
    if (start < 0 || end <= start) throw new Error('模型未返回 JSON 对象')
    return JSON.parse(clean.slice(start, end + 1))
  }
}

async function runRemoteFollowUpPlanning(
  input: FollowUpGenerationInput,
  state: LifeAiProviderState,
): Promise<{ raw: string; provider: string; model: string; usage: unknown }> {
  const instructions = followUpRoundPrompt(input.round)
  const userText = JSON.stringify({
    round: input.round,
    records: input.records.map(recordForPrompt),
    previousQuestions: historyForPrompt(input.history),
  })
  if (state.kind === 'chatgpt') {
    const result = await runChatgptPlanText({
      instructions,
      input: [{ role: 'user', content: userText }],
    })
    return { raw: result.text, provider: 'chatgpt', model: result.model, usage: null }
  }
  if (state.kind === 'openrouter' && !input.byokConnection) {
    const { aiComplete } = await import('./ai/client')
    const raw = await aiComplete(instructions, userText, { temperature: 0, maxTokens: 500 })
    return { raw, provider: 'openrouter', model: state.model ?? 'openrouter', usage: null }
  }
  if (isByokProviderId(state.kind)) {
    const model = state.model ?? getProviderDefinition(state.kind).defaultModel
    const apiKey = input.byokConnection?.apiKey
      ?? (state.kind === 'tokenhub' ? process.env.TENCENT_TOKENHUB_API_KEY?.trim() : '')
    if (!apiKey) throw new Error('没有可用的请求级 AI API Key')
    const result = await runProviderText({
      connection: {
        provider: state.kind,
        model,
        apiKey,
      },
      instructions,
      userText,
      maxOutputTokens: Math.min(tokenHubLifeOutputBudget(), 600),
      temperature: 0.1,
      jsonOutput: true,
    })
    return {
      raw: result.content,
      provider: result.provider,
      model: result.model,
      usage: result.usage,
    }
  }
  throw new Error(state.reason ?? '没有可用的 AI Provider')
}

function ruleFallback(
  input: FollowUpGenerationInput,
  notice: string,
  startedAt: number,
): FollowUpGenerationResult {
  const recordIndexById = new Map(input.records.map((record, index) => [record.id, index]))
  const excludeKeys = input.history
    .filter(item => item.status === 'answered' || item.status === 'skipped')
    .flatMap(item => {
      const index = recordIndexById.get(item.targetRecordId)
      return index === undefined ? [] : [`${index}|${item.recordType}|${item.targetField}`]
    })
  const followUps = deriveRuleFollowUpQuestions(input.records, input.round, { excludeKeys })
    .map(question => ({
      ...question,
      targetRecordId: input.records[question.recordIndex]?.id,
    }))
    .filter(question => Boolean(question.targetRecordId))
  return {
    mode: 'fallback-rule',
    provider: 'rule',
    model: 'deterministic-rule-follow-up',
    notice,
    followUps,
    latencyMs: Date.now() - startedAt,
    usage: null,
  }
}

/**
 * Generate exactly one follow-up round. The caller invokes this only after an
 * explicit user action, and the API route invokes it once per request. There
 * are no automatic retries or provider cascades.
 */
export async function generateFollowUpRound(
  input: FollowUpGenerationInput,
): Promise<FollowUpGenerationResult> {
  const startedAt = Date.now()
  if (input.requireByok && !input.byokConnection) {
    throw new Error('Public Beta 需要先连接你自己的 AI 服务商 API Key')
  }
  const state: LifeAiProviderState = input.byokConnection
    ? {
        kind: input.byokConnection.provider,
        label: input.byokConnection.provider,
        remoteAvailable: true,
        model: input.byokConnection.model,
      }
    : resolveLifeAiProviderState()
  if (state.kind === 'rule' || state.kind === 'unconfigured') {
    return ruleFallback(input, 'AI 追问生成不可用，已明确降级为规则问题', startedAt)
  }
  try {
    const remote = await runRemoteFollowUpPlanning(input, state)
    const parsed = extractJsonObject(remote.raw) as { followUps?: unknown }
    const followUps = normalizeSavedRecordFollowUpQuestions(
      parsed.followUps,
      input.records,
      input.round,
      input.history,
    )
    console.info('Life AI follow-up call', {
      provider: remote.provider,
      model: remote.model,
      correlationId: safeCorrelationId(input.messageId),
      round: input.round,
      success: true,
      questionCount: followUps.length,
      latencyMs: Date.now() - startedAt,
      usage: remote.usage,
    })
    return {
      mode: 'ai',
      provider: remote.provider,
      model: remote.model,
      notice: followUps.length
        ? `第 ${input.round} 轮由真实 AI 基于全部相关记录生成`
        : `第 ${input.round} 轮 AI 检查后没有值得继续补充的问题`,
      followUps,
      latencyMs: Date.now() - startedAt,
      usage: remote.usage,
    }
  } catch (error) {
    console.warn('Life AI follow-up call', {
      provider: state.kind,
      model: state.model ?? null,
      correlationId: safeCorrelationId(input.messageId),
      round: input.round,
      success: false,
      code: error instanceof ModelTestUpstreamError || error instanceof ProviderRequestError
        ? error.code
        : 'follow_up_failed',
      latencyMs: Date.now() - startedAt,
    })
    return ruleFallback(input, '真实 AI 追问生成失败，已明确降级为规则问题', startedAt)
  }
}
