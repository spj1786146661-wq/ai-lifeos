export class ProviderRequestError extends Error {
  readonly status: number
  readonly code: string
  readonly upstreamCode: string | null
  readonly requestId: string | null

  constructor(
    message: string,
    status: number,
    code: string,
    requestId: string | null = null,
    upstreamCode: string | null = null,
  ) {
    super(message)
    this.name = 'ProviderRequestError'
    this.status = status
    this.code = code
    this.requestId = requestId
    this.upstreamCode = upstreamCode
  }
}

export function providerErrorHttpStatus(error: ProviderRequestError): number {
  if (error.code === 'upstream_401' || error.code === 'provider_401') return 401
  if (error.code === 'upstream_403' || error.code === 'provider_403') return 403
  if (error.code === 'upstream_429' || error.code === 'provider_429') return 429
  if (error.code.includes('timeout')) return 504
  return error.status >= 400 && error.status <= 599 ? error.status : 502
}
