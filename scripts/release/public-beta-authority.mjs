#!/usr/bin/env node

import path from 'node:path'
import { pathToFileURL } from 'node:url'

const PUBLIC_DNS_NAME =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i

export function parsePublicBetaAuthority(value) {
  if (typeof value !== 'string') {
    throw new Error('PUBLIC_BETA_HOST must be a public DNS hostname with an optional port.')
  }
  const authority = value.trim().toLowerCase()
  if (
    !authority
    || authority.includes('://')
    || /[/?#@\s]/.test(authority)
    || authority.includes('*')
  ) {
    throw new Error('PUBLIC_BETA_HOST must contain only hostname[:port].')
  }

  const match = /^([^:]+)(?::([0-9]{1,5}))?$/.exec(authority)
  if (!match || !PUBLIC_DNS_NAME.test(match[1])) {
    throw new Error('PUBLIC_BETA_HOST must use a valid public DNS hostname.')
  }

  const hostname = match[1]
  const portText = match[2] ?? ''
  if (portText) {
    const port = Number(portText)
    if (!Number.isInteger(port) || port < 1 || port > 65_535) {
      throw new Error('PUBLIC_BETA_HOST port must be between 1 and 65535.')
    }
  }

  return {
    hostname,
    origin: `https://${hostname}${portText ? `:${portText}` : ''}`,
  }
}

function parseArgs(argv) {
  const result = {}
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index]
    if (key !== '--authority' && key !== '--github-output') {
      throw new Error(`Unknown argument: ${key}`)
    }
    if (key === '--github-output') {
      result.githubOutput = true
      continue
    }
    const value = argv[index + 1]
    if (!value) throw new Error(`${key} requires a value.`)
    result.authority = value
    index += 1
  }
  return result
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (!args.authority) throw new Error('--authority is required.')
  const result = parsePublicBetaAuthority(args.authority)
  if (args.githubOutput) {
    process.stdout.write(`hostname=${result.hostname}\norigin=${result.origin}\n`)
    return
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : ''
if (import.meta.url === invokedPath) {
  try {
    main()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
