import { NextRequest, NextResponse } from 'next/server'
import { openrouter } from '@/lib/ai/client'
import { PlanNotAuthorizedError, PlanUsageError, resolveAiProviderState, runChatgptPlanImage } from '@/lib/ai/chatgpt-plan-provider'
import { parseModelMealRecords, validLifeDate } from '@/lib/life-records'
import { isLanAllowedApi, LAN_VERIFIED_HEADER, requestHostname } from '@/lib/lan-access'

export const runtime = 'nodejs'

const imageTypes = new Set(['image/jpeg', 'image/png', 'image/webp'])

const IMAGE_SIGNATURES: ReadonlyArray<{ mimeType: string; bytes: readonly number[] }> = [
  { mimeType: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
  { mimeType: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47] },
  { mimeType: 'image/webp', bytes: [0x52, 0x49, 0x46, 0x46] },
]

/** The declared MIME type must match the real file header, so a renamed text file is refused. */
function matchesImageSignature(bytes: Uint8Array, declaredType: string): boolean {
  const signature = IMAGE_SIGNATURES.find(candidate => candidate.mimeType === declaredType)
  if (!signature) return false
  return signature.bytes.every((byte, index) => bytes[index] === byte)
}

export async function POST(req: NextRequest) {
  const hostname = requestHostname(req.headers.get('host'))
  if (!['localhost', '127.0.0.1', '::1'].includes(hostname)
    && !isLanAllowedApi(hostname, req.nextUrl.pathname, req.headers.get(LAN_VERIFIED_HEADER))) {
    return NextResponse.json({ error: '仅供本机使用' }, { status: 403 })
  }
  if (Number(req.headers.get('content-length') ?? 0) > 7_000_000) return NextResponse.json({ error: '图片请求超过大小限制' }, { status: 413 })
  let form: FormData
  try { form = await req.formData() } catch { return NextResponse.json({ error: '图片请求格式无效' }, { status: 400 }) }
  const file = form.get('image')
  const date = form.get('date')
  const text = form.get('text')
  // Read the bytes once: the payload check below needs the real file header.
  const declaredBytes: Uint8Array | null = file instanceof File && imageTypes.has(file.type) && file.size > 0 && file.size <= 5_000_000
    ? new Uint8Array(await file.arrayBuffer())
    : null
  if (!(file instanceof File) || !imageTypes.has(file.type) || file.size === 0 || file.size > 5_000_000) {
    return NextResponse.json({ error: '请选择不超过 5 MB 的 JPG、PNG 或 WebP 图片' }, { status: 400 })
  }
  if (declaredBytes && !matchesImageSignature(declaredBytes, file.type)) {
    return NextResponse.json({ error: '请选择不超过 5 MB 的 JPG、PNG 或 WebP 图片' }, { status: 400 })
  }
  if (!validLifeDate(date)) return NextResponse.json({ error: '日期格式无效' }, { status: 400 })
  if (typeof text !== 'string' || text.length > 500) return NextResponse.json({ error: '文字超过 500 字' }, { status: 400 })
  const dataUrl = `data:${file.type};base64,${Buffer.from(declaredBytes ?? new Uint8Array(await file.arrayBuffer())).toString('base64')}`
  const asksCalories = /卡路里|热量|大卡|千卡/.test(text)
  const instructions = asksCalories
    ? '你是饮食图片问答助手。根据可见食物回答用户的热量问题，只能给粗略范围并说明图片无法确定份量、配料和做法；不要输出医疗建议。只返回自然中文回答，不保存热量。'
    : `你是饮食图片信息提取器。今天日期为 ${date}。只识别图片中可见的食物或饮料；看不清时不猜测。用户附言仅用于澄清图片。输出纯 JSON：{"records":[{"type":"meal","date":"${date}","food":"食物名称，用顿号分隔","note":""}]}。无法可靠识别时返回 {"records":[]}。不得估算卡路里、重量或营养数值。`

  const providerState = resolveAiProviderState({
    openRouterConfigured: Boolean(process.env.OPENROUTER_API_KEY),
    openRouterModel: process.env.OPENROUTER_VISION_MODEL,
  })
  if (!providerState.remoteAvailable) {
    // The client keeps the image and asks the user to label it by hand. Nothing
    // is recognised and nothing is stored here.
    return NextResponse.json({
      mode: 'unavailable',
      visionConfigured: false,
      error: `图片识别尚未配置：${providerState.reason ?? '没有可用的视觉模型'}。当前未调用 AI，也未保存图片`,
    }, { status: 503 })
  }

  let raw: string
  try {
    if (providerState.kind === 'chatgpt') {
      // The user's own ChatGPT plan through the official OAuth path.
      const result = await runChatgptPlanImage({ instructions, text: typeof text === 'string' ? text : '', imageUrl: dataUrl })
      raw = result.text
    } else {
      const response = await openrouter.chat.completions.create({
        model: process.env.OPENROUTER_VISION_MODEL ?? '',
        messages: [
          { role: 'system', content: instructions },
          { role: 'user', content: [
            { type: 'text', text: text || '请识别这张图片里的饮食信息。' },
            { type: 'image_url', image_url: { url: dataUrl } },
          ] },
        ],
        temperature: 0.2,
        max_tokens: 500,
      })
      raw = response.choices[0]?.message?.content?.trim() ?? ''
    }
    if (!raw) throw new Error('模型未返回内容')
  } catch (error) {
    if (error instanceof PlanNotAuthorizedError || error instanceof PlanUsageError) {
      return NextResponse.json({
        mode: 'unavailable',
        visionConfigured: false,
        error: 'ChatGPT 套餐授权不可用，本次未调用 AI，也没有保存图片。请重新授权，或手动为图片选择分类。',
      }, { status: 503 })
    }
    console.error('Life image understanding failed:', error)
    return NextResponse.json({ error: 'AI 图片识别失败；图片和记录均未保存' }, { status: 502 })
  }
  if (asksCalories) return NextResponse.json({ intent: 'analysis', mode: 'ai', periodLabel: '图片问答', answer: raw })
  return NextResponse.json({
    intent: 'record',
    mode: 'ai',
    provider: providerState.kind,
    model: providerState.model ?? process.env.OPENROUTER_VISION_MODEL ?? null,
    records: parseModelMealRecords(raw, date),
    image: true,
  })
}
