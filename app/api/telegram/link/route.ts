import { NextRequest, NextResponse } from 'next/server'
import {
  LEGACY_TELEGRAM_API_FLAG,
  isLegacyApiEnabled,
  requestedUserMatches,
  verifyFirebaseBearer,
} from '@/lib/api-security'
import { adminAuth, adminDb } from '@/lib/firebase/admin'

async function authenticate(req: NextRequest) {
  return verifyFirebaseBearer(
    req.headers.get('authorization'),
    token => adminAuth().verifyIdToken(token),
  )
}

// Server-side endpoint to write telegram_links/{chatId} using Admin SDK.
// Called from the Settings page after the user saves their Chat ID.
export async function POST(req: NextRequest) {
  if (!isLegacyApiEnabled(LEGACY_TELEGRAM_API_FLAG)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const auth = await authenticate(req)
  if (!auth.ok) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: auth.status })
  }

  let body: { userId?: string; chatId: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { userId: requestedUserId, chatId } = body
  if (!chatId) {
    return NextResponse.json({ error: 'Missing chatId' }, { status: 400 })
  }
  if (requestedUserId && !requestedUserMatches(requestedUserId, auth.uid)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const db = adminDb()
    const ref = db.collection('telegram_links').doc(String(chatId))
    const result = await db.runTransaction(async transaction => {
      const existing = await transaction.get(ref)
      if (existing.exists && existing.data()?.userId !== auth.uid) {
        return 'conflict'
      }

      transaction.set(ref, {
        userId: auth.uid,
        chatId: String(chatId),
        linkedAt: new Date().toISOString(),
      })
      return 'linked'
    })

    if (result === 'conflict') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    return NextResponse.json({ ok: true })
  } catch {
    console.error('/api/telegram/link POST failed')
    return NextResponse.json({ error: 'Link failed' }, { status: 500 })
  }
}

// Allow removing the link when user disconnects
export async function DELETE(req: NextRequest) {
  if (!isLegacyApiEnabled(LEGACY_TELEGRAM_API_FLAG)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const auth = await authenticate(req)
  if (!auth.ok) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: auth.status })
  }

  let body: { chatId: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { chatId } = body
  if (!chatId) {
    return NextResponse.json({ error: 'Missing chatId' }, { status: 400 })
  }

  try {
    const db = adminDb()
    const ref = db.collection('telegram_links').doc(String(chatId))
    const result = await db.runTransaction(async transaction => {
      const existing = await transaction.get(ref)
      if (!existing.exists || existing.data()?.userId !== auth.uid) {
        return 'not_found'
      }
      transaction.delete(ref)
      return 'deleted'
    })

    if (result === 'not_found') {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    return NextResponse.json({ ok: true })
  } catch {
    console.error('/api/telegram/link DELETE failed')
    return NextResponse.json({ error: 'Unlink failed' }, { status: 500 })
  }
}
