import { NextRequest, NextResponse } from 'next/server'
import { validLifeDate } from '@/lib/life-records'
import { lifeAiMode, lifeAiUnavailableReason, parseLifeText } from '@/lib/life-parse-server'
import {
  isLanAllowedApi,
  isPublicBetaApi,
  LAN_VERIFIED_HEADER,
  PUBLIC_BETA_VERIFIED_HEADER,
  requestHostname,
} from '@/lib/lan-access'

export const runtime = 'nodejs'

function localOnly(req: NextRequest) {
  const hostname = requestHostname(req.headers.get('host'))
  return ['localhost', '127.0.0.1', '::1'].includes(hostname)
    || isLanAllowedApi(
      hostname,
      req.nextUrl.pathname,
      req.headers.get(LAN_VERIFIED_HEADER),
    )
}

function publicBeta(req: NextRequest) {
  const hostname = requestHostname(req.headers.get('host'))
  return isPublicBetaApi(
    hostname,
    req.nextUrl.pathname,
    req.headers.get(PUBLIC_BETA_VERIFIED_HEADER),
    process.env.AIOS_PUBLIC_BETA_HOSTS,
  )
}

export async function GET(req: NextRequest) {
  if (publicBeta(req)) {
    return NextResponse.json({
      mode: 'unconfigured',
      reason: '请在“我的 → AI 连接”中选择服务商、模型并连接你自己的 API Key',
      byokRequired: true,
    })
  }
  if (!localOnly(req)) return NextResponse.json({ error: '仅供本机使用' }, { status: 403 })
  // Four visible states so the UI can never present rule parsing as real AI.
  return NextResponse.json({ mode: lifeAiMode(), reason: lifeAiUnavailableReason() ?? null })
}

export async function POST(req: NextRequest) {
  if (!localOnly(req)) return NextResponse.json({ error: '仅供本机使用' }, { status: 403 })
  let body: unknown
  try { body = await req.json() } catch {
    return NextResponse.json({ error: '请求格式无效' }, { status: 400 })
  }
  const { text, date } = (body ?? {}) as { text?: unknown; date?: unknown }
  if (typeof text !== 'string' || !text.trim() || text.length > 500) {
    return NextResponse.json({ error: '请输入 1–500 字的生活记录' }, { status: 400 })
  }
  if (!validLifeDate(date)) {
    return NextResponse.json({ error: '日期格式无效' }, { status: 400 })
  }

  try {
    const result = await parseLifeText(text.trim(), date)
    return NextResponse.json({
      ...result,
      records: result.records.map(record => ({
        ...record.draft,
        ...(record.needsFields ? { needsFields: true, missingReason: record.missingReason } : {}),
      })),
    })
  } catch (error) {
    if (lifeAiMode() === 'demo') return NextResponse.json({ error: error instanceof Error ? error.message : '演示解析失败' }, { status: 422 })
    if (lifeAiMode() === 'unconfigured') {
      return NextResponse.json({
        error: lifeAiUnavailableReason() ?? '没有可用的模型',
        mode: 'unconfigured',
        notice: '未调用任何 AI，也没有保存任何数据。',
      }, { status: 503 })
    }
    console.error('Life record parse failed:', error)
    return NextResponse.json({ error: 'AI 解析失败，请稍后重试；本次没有保存任何数据' }, { status: 502 })
  }
}
