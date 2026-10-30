import { PlanNotAuthorizedError, PlanUsageError, resolveAiProviderState, runChatgptPlanText } from './ai/chatgpt-plan-provider.ts'
import { parseMessageCandidates } from './life-intent-parse.ts'
import {
  parseModelRecordPayload,
  type LifeRecordDraft,
  type LifeRecordSourceRef,
} from './life-records.ts'
import { locateDraftInSource } from './life-source-fragments.ts'
import {
  deriveRuleFollowUpQuestions,
  filterKnownFollowUps,
  normalizeFollowUpQuestions,
  type LifeFollowUpQuestion,
} from './life-follow-up.ts'
import { ModelTestUpstreamError } from './tokenhub-model-test.ts'
import {
  resolveTokenHubModelId,
} from './tokenhub-model-test-shared.ts'
import type { ValidatedByokConnection } from './ai/byok-connection.ts'
import { ProviderRequestError } from './ai/provider-error.ts'
import { getProviderDefinition, providerDisplayName } from './ai/provider-registry.ts'
import { isByokProviderId, type LifeRecordProvider } from './ai/provider-types.ts'
import { runProviderText } from './ai/run-provider-text.ts'

/**
 * Three states, never collapsed into two:
 *  demo          → local rule parsing, no network call.
 *  ai            → a real remote model produced the result.
 *  unconfigured  → a model was expected but nothing is usable.
 * The UI must show the difference, because rule output is not AI output.
 */
export type LifeParseMode = 'demo' | 'ai' | 'fallback-rule' | 'unconfigured'

export interface ParsedLifeRecord {
  draft: LifeRecordDraft
  needsFields: boolean
  missingReason?: string
}

function withCandidateMarker<T extends ParsedLifeRecord>(record: T): T & { candidate: true } {
  return {
    ...record,
    candidate: true,
    draft: { ...record.draft, candidate: true },
  }
}

export interface LifeParseResult {
  mode: LifeParseMode
  records: ParsedLifeRecord[]
  provider?: LifeRecordProvider
  model?: string
  notice?: string
  followUps?: LifeFollowUpQuestion[]
}

type LifeRemoteProvider = Exclude<LifeRecordProvider, 'rule'>
type LifeAiProviderKind = LifeRemoteProvider | 'rule' | 'unconfigured'

export interface LifeAiProviderState {
  kind: LifeAiProviderKind
  label: string
  remoteAvailable: boolean
  reason?: string
  model?: string
  needsRefresh?: boolean
}

const TOKENHUB_LIFE_DEFAULT_OUTPUT_TOKENS = 900
const TOKENHUB_LIFE_MIN_OUTPUT_TOKENS = 128
const TOKENHUB_LIFE_MAX_OUTPUT_TOKENS = 2_000

export interface LifeParseOptions {
  byokConnection?: ValidatedByokConnection
  requireByok?: boolean
}

/**
 * Keep telemetry correlation identifiers bounded and printable. The client
 * generates a UUID, but this module is also called by tests and older clients,
 * so untrusted values must not be able to inject log lines.
 */
function safeCorrelationId(value: unknown): string {
  if (typeof value !== 'string') return 'unknown'
  const cleaned = value.replace(/[^A-Za-z0-9._:-]/g, '').slice(0, 96)
  return cleaned || 'unknown'
}

export function tokenHubLifeOutputBudget(
  raw = process.env.TENCENT_TOKENHUB_LIFE_MAX_OUTPUT_TOKENS,
  ceiling = TOKENHUB_LIFE_MAX_OUTPUT_TOKENS,
): number {
  const parsed = Number.parseInt(raw ?? '', 10)
  if (!Number.isFinite(parsed)) return TOKENHUB_LIFE_DEFAULT_OUTPUT_TOKENS
  return Math.max(
    TOKENHUB_LIFE_MIN_OUTPUT_TOKENS,
    Math.min(TOKENHUB_LIFE_MAX_OUTPUT_TOKENS, ceiling, parsed),
  )
}

function tokenHubState(env: NodeJS.ProcessEnv): LifeAiProviderState {
  const configured = Boolean(env.TENCENT_TOKENHUB_API_KEY?.trim())
  const model = resolveTokenHubModelId(env.TENCENT_TOKENHUB_MODEL_ID)
  return configured
    ? {
        kind: 'tokenhub',
        label: `腾讯云 TokenHub · ${model}`,
        remoteAvailable: true,
        model,
      }
    : {
        kind: 'unconfigured',
        label: '腾讯云 TokenHub 未配置',
        remoteAvailable: false,
        reason: '未配置 TENCENT_TOKENHUB_API_KEY，未调用 TokenHub',
      }
}

/**
 * Resolve the provider for formal life-record parsing.
 *
 * `auto` prefers TokenHub when its server-side key is configured. A failed
 * remote request degrades only to labelled local rules; it never cascades to a
 * second potentially paid provider.
 */
export function resolveLifeAiProviderState(
  env: NodeJS.ProcessEnv = process.env,
): LifeAiProviderState {
  const requested = (env.LIFE_AI_PROVIDER ?? 'auto').trim().toLowerCase()
  if (!['auto', 'tokenhub', 'chatgpt', 'openrouter'].includes(requested)) {
    return {
      kind: 'unconfigured',
      label: 'AI Provider 配置无效',
      remoteAvailable: false,
      reason: 'LIFE_AI_PROVIDER 只能是 auto、tokenhub、chatgpt 或 openrouter',
    }
  }

  if (requested === 'tokenhub') return tokenHubState(env)

  if (requested === 'openrouter') {
    return env.OPENROUTER_API_KEY?.trim()
      ? {
          kind: 'openrouter',
          label: `OpenRouter（${env.OPENROUTER_DEFAULT_MODEL ?? '默认模型'}）`,
          remoteAvailable: true,
          model: env.OPENROUTER_DEFAULT_MODEL,
        }
      : {
          kind: 'unconfigured',
          label: 'OpenRouter 未配置',
          remoteAvailable: false,
          reason: '未配置 OPENROUTER_API_KEY，未调用 OpenRouter',
        }
  }

  if (requested === 'chatgpt') {
    const state = resolveAiProviderState({
      credentialsPath: env.CHATGPT_PLAN_CREDENTIALS_FILE,
      openRouterConfigured: false,
      openRouterModel: env.OPENROUTER_DEFAULT_MODEL,
    })
    return state.kind === 'chatgpt'
      ? state
      : {
          kind: 'unconfigured',
          label: 'ChatGPT 套餐不可用',
          remoteAvailable: false,
          reason: state.reason ?? '没有可用的 ChatGPT 套餐授权',
        }
  }

  if (env.TENCENT_TOKENHUB_API_KEY?.trim()) return tokenHubState(env)
  return resolveAiProviderState({
    credentialsPath: env.CHATGPT_PLAN_CREDENTIALS_FILE,
    openRouterConfigured: Boolean(env.OPENROUTER_API_KEY),
    openRouterModel: env.OPENROUTER_DEFAULT_MODEL,
  })
}

export function lifeAiMode(): LifeParseMode {
  const state = resolveLifeAiProviderState()
  if (state.kind !== 'rule' && state.kind !== 'unconfigured') return 'ai'
  return state.kind === 'rule' ? 'demo' : 'unconfigured'
}

/** Human-readable reason shown when the AI path is not usable. */
export function lifeAiUnavailableReason(): string | undefined {
  return resolveLifeAiProviderState().reason
}

const RECORD_INSTRUCTIONS = '你是生活记录的信息提取器。只提取用户明确说出的运动、睡眠、学习、饮食、消费、心情事实，不猜测、不补齐缺失数值。'

export function lifeRecordPrompt(date: string): string {
  return `${RECORD_INSTRUCTIONS}今天日期为 ${date}。输出纯 JSON，格式为 {"records":[...],"followUps":[...]}，records 最多六条，每种类型最多一条；没有可提取事实时返回空数组。字段要求：运动 {"type":"exercise","date":"YYYY-MM-DD","activity":"名称","durationMinutes":数字,"weightKg":数字,"sets":整数,"repsPerSet":整数,"note":""}，保留用户明确说出的活动、时长、重量、组数和每组次数；活动明确时，即使未提供时长或组数也可以形成记录；睡眠 {"type":"sleep","date":"YYYY-MM-DD","hours":数字,"wakeFeeling":"用户明确描述的醒来感受","note":""}；学习 {"type":"learning","date":"YYYY-MM-DD","subject":"学习内容","durationMinutes":数字,"quantity":整数,"unit":"题或页等单位","note":""}，至少有时长或完成数量；饮食 {"type":"meal","date":"YYYY-MM-DD","food":"吃或喝的食物","note":""}；消费 {"type":"expense","date":"YYYY-MM-DD","amount":人民币数字,"note":"消费内容"}；心情 {"type":"mood","date":"YYYY-MM-DD","note":"用户原词"}。心情必须提取，即使没有数字评分。只有用户明确说“心情3分/情绪4分”等数字时才允许输出 score 1–5；其他情绪词一律省略 score，绝不推断评分。未提及的字段省略，不要编造时长、次数、数量、卡路里、金额或评分。没有足够事实的类别不要输出。只用用户文本及今天日期判断“昨天”等日期。生成 followUps 前必须联合检查本次 records 的全部记录：判断每条记录已有字段、含糊信息和最值得补充的分析字段，再从全部记录中统一排序。最多三条，可以是不同记录，也可以在同一记录确有多个高价值缺口时出现多条；应先兼顾不同记录，不要机械地每类问一条，也不要为凑满三条而追问。不得询问已有字段或已回答内容。没有值得补充的信息时允许返回空数组。每条格式为 {"questionId":"唯一短ID","recordIndex":记录数组从0开始的索引,"recordType":"记录类型","targetField":"该类型可补充字段","question":"一个简短自然的问题","round":1,"priority":1到3的整数,"reason":"可选的简短推荐原因"}。priority 数字越小越重要。targetField 只能取 activity、durationMinutes、weightKg、sets、repsPerSet、hours、wakeFeeling、amount、score、subject、quantity、unit、food 中适合该类型的字段。`
}

function attachRemoteSource(
  text: string,
  date: string,
  messageId: string,
  records: LifeRecordDraft[],
  provider: LifeRemoteProvider,
  model: string,
) {
  return records.map(record => {
    const span = locateDraftInSource(text, record)
    const sourceRef: LifeRecordSourceRef | undefined = span ? {
      messageId,
      start: span.start,
      end: span.end,
      text: span.text,
      origin: 'ai',
      provider,
      model,
    } : undefined
    return {
      draft: {
        ...record,
        ...(sourceRef ? { sourceRef } : {}),
      },
      needsFields: record.needsFields === true,
      ...(record.missingReason ? { missingReason: record.missingReason } : {}),
    } satisfies ParsedLifeRecord
  })
}

/** Run the real model, whichever provider is authorized. */
async function runRemoteRecordExtraction(
  text: string,
  date: string,
  messageId: string,
  options: LifeParseOptions = {},
): Promise<LifeParseResult> {
  const instructions = lifeRecordPrompt(date)
  const state: LifeAiProviderState = options.byokConnection
    ? {
        kind: options.byokConnection.provider,
        label: `${providerDisplayName(options.byokConnection.provider)} · ${options.byokConnection.model}`,
        remoteAvailable: true,
        model: options.byokConnection.model,
      }
    : resolveLifeAiProviderState()
  let raw: string
  let provider: LifeRemoteProvider
  let model: string
  if (state.kind === 'chatgpt') {
    // The user's own ChatGPT plan, through the official OAuth path.
    const result = await runChatgptPlanText({ instructions, input: [{ role: 'user', content: text }] })
    raw = result.text
    provider = 'chatgpt'
    model = result.model
  } else if (state.kind === 'openrouter' && !options.byokConnection) {
    // Loaded lazily so the rule/demo path never pulls in the OpenRouter SDK,
    // and so the provider decision can be tested without network dependencies.
    const { aiComplete } = await import('./ai/client')
    raw = await aiComplete(instructions, text, { temperature: 0, maxTokens: 500 })
    provider = 'openrouter'
    model = state.model ?? 'openrouter'
  } else if (isByokProviderId(state.kind)) {
    const startedAt = Date.now()
    const requestModel = state.model
      ?? getProviderDefinition(state.kind).defaultModel
    const apiKey = options.byokConnection?.apiKey
      ?? (state.kind === 'tokenhub' ? process.env.TENCENT_TOKENHUB_API_KEY?.trim() : '')
    if (!apiKey) {
      throw new PlanNotAuthorizedError('没有可用的请求级 AI API Key')
    }
    try {
      const result = await runProviderText({
        connection: {
          provider: state.kind,
          model: requestModel,
          apiKey,
        },
        instructions,
        userText: text,
        maxOutputTokens: tokenHubLifeOutputBudget(
          process.env.TENCENT_TOKENHUB_LIFE_MAX_OUTPUT_TOKENS,
          options.requireByok ? 900 : TOKENHUB_LIFE_MAX_OUTPUT_TOKENS,
        ),
        temperature: 0.1,
        jsonOutput: true,
      })
      raw = result.content
      provider = state.kind
      model = requestModel
      console.info('Life AI provider call', {
        provider,
        model: requestModel,
        correlationId: safeCorrelationId(messageId),
        success: true,
        latencyMs: Date.now() - startedAt,
        usage: result.usage,
        requestId: result.requestId,
      })
    } catch (error) {
      console.warn('Life AI provider call', {
        provider: state.kind,
        model: requestModel,
        correlationId: safeCorrelationId(messageId),
        success: false,
        latencyMs: Date.now() - startedAt,
        code: error instanceof ModelTestUpstreamError
          ? error.code
          : error instanceof ProviderRequestError
            ? error.code
            : 'unknown_error',
        upstreamCode: error instanceof ModelTestUpstreamError
          ? error.upstreamCode
          : error instanceof ProviderRequestError
            ? error.upstreamCode
            : null,
        requestId: error instanceof ModelTestUpstreamError
          ? error.requestId
          : error instanceof ProviderRequestError
            ? error.requestId
            : null,
      })
      throw error
    }
  } else {
    throw new PlanNotAuthorizedError(lifeAiUnavailableReason() ?? '没有可用的模型')
  }
  let payload: ReturnType<typeof parseModelRecordPayload>
  try {
    payload = parseModelRecordPayload(raw, date, text)
  } catch (error) {
    if (provider === 'tokenhub') {
      throw new ModelTestUpstreamError(
        'TokenHub 返回的生活记录 JSON 未通过结构校验。',
        502,
        'tokenhub_invalid_record_payload',
      )
    }
    if (isByokProviderId(provider)) {
      throw new ProviderRequestError(
        `${providerDisplayName(provider)} 返回的生活记录 JSON 未通过结构校验。`,
        502,
        'provider_invalid_record_payload',
      )
    }
    throw error
  }
  const records = payload.records
  const followUps = filterKnownFollowUps(
    normalizeFollowUpQuestions(payload.followUps, records),
    records,
  )
  return {
    mode: 'ai',
    records: attachRemoteSource(text, date, messageId, records, provider, model).map(withCandidateMarker),
    provider,
    model,
    // A valid AI response may intentionally contain zero questions. Do not
    // replace that decision with mechanical rule questions.
    followUps,
  }
}

export async function parseLifeText(
  text: string,
  date: string,
  messageId = 'demo',
  options: LifeParseOptions = {},
): Promise<LifeParseResult> {
  if (options.requireByok && !options.byokConnection) {
    throw new PlanNotAuthorizedError('Public Beta 需要先连接你自己的 AI 服务商 API Key')
  }
  const mode: LifeParseMode = options.byokConnection ? 'ai' : lifeAiMode()
  if (mode === 'demo') {
    // Rule path: one message may yield several categories at once.
    const { candidates } = parseMessageCandidates(text, { messageId, date })
    return {
      mode: 'demo',
      provider: 'rule',
      model: 'deterministic-rule-parser',
      records: candidates.map(candidate => withCandidateMarker({
        draft: {
          ...candidate.draft,
          sourceRef: candidate.draft.sourceRef
            ? { ...candidate.draft.sourceRef, origin: 'rule', provider: 'rule', model: 'deterministic-rule-parser' }
            : undefined,
        },
        needsFields: candidate.needsFields,
        ...(candidate.missingReason ? { missingReason: candidate.missingReason } : {}),
      })),
      followUps: deriveRuleFollowUpQuestions(candidates.map(candidate => candidate.draft)),
    }
  }
  try {
    const remote = await runRemoteRecordExtraction(text, date, messageId, options)
    const remoteTypes = new Set(remote.records.map(record => record.draft.type))
    const rule = parseMessageCandidates(text, { messageId, date }).candidates
    const recovered = rule
      .filter(candidate => !remoteTypes.has(candidate.draft.type))
      .map(candidate => withCandidateMarker({
        draft: {
          ...candidate.draft,
          sourceRef: candidate.draft.sourceRef
            ? { ...candidate.draft.sourceRef, origin: 'fallback-rule' as const, provider: 'rule' as const, model: 'deterministic-rule-parser' }
            : undefined,
        },
        needsFields: candidate.needsFields,
        ...(candidate.missingReason ? { missingReason: candidate.missingReason } : {}),
      }))
    return recovered.length
      ? {
          ...remote,
          mode: 'fallback-rule',
          records: [...remote.records, ...recovered],
          followUps: remote.followUps ?? [],
          notice: `真实模型已返回 ${remote.records.length} 类；遗漏的 ${recovered.map(item => item.draft.type).join('、')} 由本地规则补回。保存前请核对来源标记。`,
        }
      : remote
  } catch (error) {
    if (
      !(error instanceof PlanNotAuthorizedError)
      && !(error instanceof PlanUsageError)
      && !(error instanceof ModelTestUpstreamError)
      && !(error instanceof ProviderRequestError)
    ) throw error
    const { candidates } = parseMessageCandidates(text, { messageId, date })
    return {
      mode: 'fallback-rule',
      provider: 'rule',
      model: 'deterministic-rule-parser',
      notice: error instanceof ModelTestUpstreamError
        ? `TokenHub 模型不可用，已退回本地规则；未获得 AI 结果。${error.message}`
        : `真实模型不可用，已退回本地规则；未获得 AI 结果。${error.message}`,
      records: candidates.map(candidate => withCandidateMarker({
        draft: {
          ...candidate.draft,
          sourceRef: candidate.draft.sourceRef
            ? { ...candidate.draft.sourceRef, origin: 'rule', provider: 'rule', model: 'deterministic-rule-parser' }
            : undefined,
        },
        needsFields: candidate.needsFields,
        ...(candidate.missingReason ? { missingReason: candidate.missingReason } : {}),
      })),
      followUps: deriveRuleFollowUpQuestions(candidates.map(candidate => candidate.draft)),
    }
  }
}

// Callers catch these to tell "no model is reachable" apart from "the model failed".
export { PlanNotAuthorizedError, PlanUsageError }
