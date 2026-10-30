import { NextRequest, NextResponse } from 'next/server'
import { createServer, type Server } from 'node:http'
import { AddressInfo } from 'node:net'
import { randomUUID } from 'node:crypto'
import {
  CHATGPT_ISSUER,
  CHATGPT_PLAN_SCOPE,
  defaultCredentialsPath,
  getOrCreateExtAgentHostId,
  readPlanCredentials,
  type PlanCredentials,
} from '@/lib/ai/chatgpt-plan-credentials'
import {
  OAuthExchangeError,
  completeAuthorization,
  parseCallback,
  startAuthorization,
  type PendingAuthorization,
  type TokenExchangeDiagnostics,
} from '@/lib/ai/chatgpt-plan-oauth'
import { isTrustedLocalRequest } from '@/lib/ai/local-request-security'

export const runtime = 'nodejs'

const AGENT_NAME = 'AI人生数据库'

interface PendingSession extends PendingAuthorization {
  server: Server
  port: number
  status: 'pending' | 'processing' | 'succeeded' | 'failed'
  error?: string
  /** Redacted, non-secret OAuth diagnostics. Never contains a code or token. */
  diagnostics?: TokenExchangeDiagnostics
}

const pending = new Map<string, PendingSession>()

/** Server-provided text is echoed into a loopback HTML page, so escape it. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function trusted(req: NextRequest, stateChanging = false): boolean {
  return isTrustedLocalRequest({
    protocol: req.nextUrl.protocol,
    hostHeader: req.headers.get('host'),
    originHeader: req.headers.get('origin'),
    refererHeader: req.headers.get('referer'),
    secFetchSite: req.headers.get('sec-fetch-site'),
    stateChanging,
  })
}

function disposeSession(id: string) {
  const session = pending.get(id)
  if (!session) return
  pending.delete(id)
  try { session.server.close() } catch { /* already closed */ }
}

function retainCompletedSession(id: string) {
  const session = pending.get(id)
  if (!session) return
  try { session.server.close() } catch { /* already closed */ }
  setTimeout(() => pending.delete(id), 2 * 60 * 1000).unref()
}

/**
 * Start the official Sign in with ChatGPT flow.
 *
 * POST {} → starts a loopback listener on 127.0.0.1, returns the authorize URL
 * for the user to open in their own browser. The user approves there; nothing
 * is approved on their behalf.
 */
export async function POST(req: NextRequest) {
  if (!trusted(req, true)) return NextResponse.json({ error: '仅供本机同源页面使用' }, { status: 403 })

  const sessionId = randomUUID()
  const server = createServer()
  let port = 0
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => { server.removeListener('error', reject); resolve() })
    })
    port = (server.address() as AddressInfo).port
  } catch {
    return NextResponse.json({ error: '无法启动本机授权回调端口' }, { status: 500 })
  }
  const redirectUri = `http://127.0.0.1:${port}/auth/callback`
  let hostId: string
  try {
    hostId = getOrCreateExtAgentHostId()
  } catch {
    server.close()
    return NextResponse.json({ error: '无法建立本机授权标识' }, { status: 500 })
  }
  const existing = readPlanCredentials(defaultCredentialsPath())
  const { authorizeUrl, pending: pendingAuth } = startAuthorization({
    extAgentHostId: hostId,
    redirectUri,
    clientId: existing?.clientId,
    agentNameHint: existing ? undefined : AGENT_NAME,
  })

  const session: PendingSession = { ...pendingAuth, server, port, status: 'pending' }
  pending.set(sessionId, session)

  server.on('request', (incoming, outgoing) => {
    if (incoming.method !== 'GET') {
      outgoing.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8', Allow: 'GET' })
      outgoing.end('Method not allowed')
      return
    }
    if (incoming.headers.host !== `127.0.0.1:${port}`) {
      outgoing.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' })
      outgoing.end('Forbidden')
      return
    }
    const url = new URL(incoming.url ?? '/', `http://127.0.0.1:${port}`)
    if (url.pathname !== '/auth/callback') {
      outgoing.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
      outgoing.end('Not found')
      return
    }
    if (session.status !== 'pending') {
      outgoing.writeHead(409, { 'Content-Type': 'text/plain; charset=utf-8' })
      outgoing.end('Authorization attempt already completed')
      return
    }
    const callbackUrl = `http://127.0.0.1:${port}${incoming.url ?? '/'}`
    // Parse and validate the callback first: state, error, client_id.
    let parsed
    try {
      parsed = parseCallback(callbackUrl, session)
    } catch (cause) {
      session.status = 'failed'
      session.error = cause instanceof Error ? cause.message : '回调无效'
      outgoing.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
      outgoing.end(`<html><body style="font-family:sans-serif;padding:2rem"><h2>授权未完成</h2><p>${escapeHtml(session.error ?? '回调无效')}</p><p>可以关闭这个页面，回到 AI人生数据库 重试。</p></body></html>`)
      retainCompletedSession(sessionId)
      return
    }
    session.status = 'processing'
    // Exchange the code, validate the ID token, and confirm plan scopes.
    void (async () => {
      try {
        const credentials: PlanCredentials = await completeAuthorization({
          code: parsed.code,
          pending: session,
          issuedClientId: parsed.clientId,
          credentialsPath: defaultCredentialsPath(),
          expectedIssuer: CHATGPT_ISSUER,
        })
        session.status = 'succeeded'
        outgoing.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        outgoing.end(`<html><body style="font-family:sans-serif;padding:2rem"><h2>授权成功</h2><p>已连接 ChatGPT 套餐账号：${credentials.email ?? '已授权账号'}。</p><p>可以关闭这个页面，回到 AI人生数据库 开始使用真实 AI 解析。</p></body></html>`)
      } catch (cause) {
        session.status = 'failed'
        session.error = cause instanceof Error ? cause.message : '授权失败'
        // Keep only the redacted diagnostic object so the polling UI can show the
        // official error code and request ID without exposing any secret.
        if (cause instanceof OAuthExchangeError) session.diagnostics = cause.diagnostics
        outgoing.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
        outgoing.end(`<html><body style="font-family:sans-serif;padding:2rem"><h2>授权未完成</h2><p>${escapeHtml(session.error)}</p><p>可以关闭这个页面，回到 AI人生数据库 重试。</p></body></html>`)
      } finally {
        retainCompletedSession(sessionId)
      }
    })()
  })

  // Abandon the attempt after 10 minutes, matching the state lifetime.
  const timer = setTimeout(() => disposeSession(sessionId), 10 * 60 * 1000)
  server.on('close', () => clearTimeout(timer))

  return NextResponse.json({
    sessionId,
    authorizeUrl,
    redirectUri,
    scope: CHATGPT_PLAN_SCOPE,
    expiresInSeconds: 600,
  })
}

/** Poll whether the user finished the browser approval. */
export async function GET(req: NextRequest) {
  if (!trusted(req)) return NextResponse.json({ error: '仅供本机同源页面使用' }, { status: 403 })
  const sessionId = req.nextUrl.searchParams.get('sessionId') ?? ''
  const session = pending.get(sessionId)
  if (!session) return NextResponse.json({ status: 'unknown' })
  return NextResponse.json({
    status: session.status,
    error: session.status === 'failed' ? session.error : undefined,
    diagnostics: session.status === 'failed' ? session.diagnostics : undefined,
    callbackUri: `http://127.0.0.1:${session.port}/auth/callback`,
  })
}

export async function DELETE(req: NextRequest) {
  if (!trusted(req, true)) return NextResponse.json({ error: '仅供本机同源页面使用' }, { status: 403 })
  const sessionId = req.nextUrl.searchParams.get('sessionId') ?? ''
  disposeSession(sessionId)
  return NextResponse.json({ status: 'cancelled' })
}
