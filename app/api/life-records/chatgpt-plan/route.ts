import { NextRequest, NextResponse } from 'next/server'
import { credentialSummary, defaultCredentialsPath, planAccountLabel, readPlanCredentials } from '@/lib/ai/chatgpt-plan-credentials'
import { revokePlanCredentials } from '@/lib/ai/chatgpt-plan-oauth'
import { isTrustedLocalRequest } from '@/lib/ai/local-request-security'
import { resolveLifeAiProviderState } from '@/lib/life-parse-server'

export const runtime = 'nodejs'

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

/**
 * Report the current AI source without calling any model.
 * Never returns a token; only the account label and granted scopes.
 */
export async function GET(req: NextRequest) {
  if (!trusted(req)) return NextResponse.json({ error: '仅供本机同源页面使用' }, { status: 403 })
  const credentialsPath = defaultCredentialsPath()
  const credentials = readPlanCredentials(credentialsPath)
  const state = resolveLifeAiProviderState()
  const summary = credentials ? credentialSummary(credentials) : null
  return NextResponse.json({
    mode: state.kind,
    label: state.label,
    remoteAvailable: state.remoteAvailable,
    reason: state.reason,
    model: state.model,
    authorized: Boolean(credentials),
    account: credentials ? planAccountLabel(credentials) : null,
    scopes: summary?.scopes ?? [],
    planUsageGranted: summary?.planUsageGranted ?? false,
    expiresAt: summary?.expiresAt ?? null,
    expired: summary?.expired ?? false,
    // True when the access token is expired but a refresh token exists, so the
    // next real call refreshes instead of degrading to rules.
    needsRefresh: state.needsRefresh ?? false,
  })
}

/** Disconnect: revoke the renewable session, then remove local credentials. */
export async function DELETE(req: NextRequest) {
  if (!trusted(req, true)) return NextResponse.json({ error: '仅供本机同源页面使用' }, { status: 403 })
  try {
    const result = await revokePlanCredentials(defaultCredentialsPath())
    return NextResponse.json(result)
  } catch {
    return NextResponse.json({ error: '断开 ChatGPT 授权失败' }, { status: 500 })
  }
}
