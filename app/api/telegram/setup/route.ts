import { NextRequest, NextResponse } from 'next/server'
import {
  LEGACY_TELEGRAM_API_FLAG,
  isLegacyApiEnabled,
  verifyBearerSecret,
} from '@/lib/api-security'

// One-time endpoint to register the webhook URL with Telegram.
// Hit this once after deploying: GET /api/telegram/setup
export async function GET(req: NextRequest) {
  if (!isLegacyApiEnabled(LEGACY_TELEGRAM_API_FLAG)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const auth = verifyBearerSecret(
    req.headers.get('authorization'),
    process.env.TELEGRAM_SETUP_SECRET,
  )
  if (!auth.ok) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: auth.status })
  }

  const token = process.env.TELEGRAM_BOT_TOKEN
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET
  const appUrl = process.env.NEXT_PUBLIC_APP_URL

  if (!token) {
    return NextResponse.json({ error: 'TELEGRAM_BOT_TOKEN not set' }, { status: 500 })
  }
  if (!secret) {
    return NextResponse.json({ error: 'TELEGRAM_WEBHOOK_SECRET not set' }, { status: 503 })
  }
  if (!appUrl || !appUrl.startsWith('https://')) {
    return NextResponse.json({ error: 'NEXT_PUBLIC_APP_URL must be an HTTPS URL' }, { status: 503 })
  }

  const webhookUrl = `${appUrl}/api/telegram/webhook`

  const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: webhookUrl,
      secret_token: secret,
      allowed_updates: ['message'],
    }),
  })

  const data = await res.json()
  return NextResponse.json({ ok: res.ok, webhookUrl, telegram: data })
}
