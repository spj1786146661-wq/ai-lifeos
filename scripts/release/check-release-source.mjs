#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const ALLOWED_ENV_FILES = new Set([
  '.env.example',
  '.env.public-beta.example',
])

const ALLOWED_SOURCE_HOSTS = new Set(['github.com'])

const SECRET_PATTERNS = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /AIza[0-9A-Za-z_-]{35}/,
  /sk-(?:proj-)?[A-Za-z0-9_-]{32,}/,
  /gh[pousr]_[A-Za-z0-9]{30,}/,
  /xox[baprs]-[A-Za-z0-9-]{20,}/,
  /AKIA[0-9A-Z]{16}/,
]

const SECRET_ASSIGNMENT_PATTERN =
  /(?:^|\n)[ \t]*(?:export[ \t]+)?([A-Z][A-Z0-9_]*)[ \t]*=[ \t]*(['"]?)([^\s'"#]{16,})\2(?=[ \t]*(?:\r?\n|$))/g

const SECRET_VARIABLE_PATTERN =
  /(?:^|_)(?:API_KEY|SECRET|TOKEN|PASSWORD|PRIVATE_KEY)(?:_|$)/

const SYNTHETIC_VALUE_PATTERN =
  /(?:\$\{|replace|example|placeholder|dummy|fake|test|synthetic|redacted|not-a-|your[-_]?(?:api[-_]?)?key)/i

export function validateReleaseTag(tag) {
  if (
    typeof tag !== 'string'
    || !/^v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/.test(tag)
  ) {
    throw new Error('Release tag must be an annotated semantic version tag such as v0.2.0 or v0.2.0-beta.1.')
  }
  return tag
}

export function validateSourceUrl(sourceUrl, tag) {
  let parsed
  try {
    parsed = new URL(sourceUrl)
  } catch {
    throw new Error('Corresponding Source URL is not a valid URL.')
  }
  if (parsed.protocol !== 'https:' || !ALLOWED_SOURCE_HOSTS.has(parsed.hostname)) {
    throw new Error('Corresponding Source URL must use https://github.com.')
  }
  const segments = parsed.pathname.split('/').filter(Boolean)
  if (
    segments.length !== 4
    || segments[2] !== 'tree'
    || segments[3] !== tag
    || parsed.search
    || parsed.hash
  ) {
    throw new Error('Corresponding Source URL must point directly to the exact tag tree.')
  }
  return sourceUrl
}

export function forbiddenPathReason(filePath) {
  const normalized = filePath.replaceAll('\\', '/')
  if (normalized === '$null') return 'reserved local file must never enter a release'
  if (normalized === 'tools-build-stage' || normalized.startsWith('tools-build-stage/')) {
    return 'temporary build directory must never enter a release'
  }
  if (
    normalized === '.git'
    || normalized.startsWith('.git/')
    || normalized === 'node_modules'
    || normalized.startsWith('node_modules/')
    || normalized === '.next'
    || normalized.startsWith('.next/')
    || normalized.startsWith('.next-')
    || normalized === 'coverage'
    || normalized.startsWith('coverage/')
    || normalized === 'test-results'
    || normalized.startsWith('test-results/')
    || normalized === 'playwright-report'
    || normalized.startsWith('playwright-report/')
  ) {
    return 'generated dependency, build, or test output is not source input'
  }
  if (
    normalized === '.env'
    || (normalized.startsWith('.env.') && !ALLOWED_ENV_FILES.has(normalized))
  ) {
    return 'real environment files are forbidden; only committed example templates are allowed'
  }
  if (
    /(^|\/)(?:backups?|exports?|browser-data|user-data|attachments)(?:\/|$)/i.test(normalized)
    || /\.(?:sqlite|sqlite3|db|bak|backup|dump)$/i.test(normalized)
    || /(?:^|\/)(?:firebase-admin-key\.json|[^/]*-admin-key\.json)$/i.test(normalized)
    || /(?:^|\/)\.config\/ai-lifeos(?:\/|$)/i.test(normalized)
  ) {
    return 'user data, backups, credentials, or attachment stores are forbidden'
  }
  if (
    /(?:^|\/)(?:dev-|npm-debug|yarn-debug|yarn-error|pnpm-debug).+\.log$/i.test(normalized)
    || /(?:^|\/)[^/]+\.(?:pem|key|p12|pfx)$/i.test(normalized)
  ) {
    return 'runtime logs and private-key containers are forbidden'
  }
  return null
}

export function sensitiveContentReason(content, filePath) {
  for (const pattern of SECRET_PATTERNS) {
    if (pattern.test(content)) return `high-confidence secret pattern in ${filePath}`
  }
  SECRET_ASSIGNMENT_PATTERN.lastIndex = 0
  for (const match of content.matchAll(SECRET_ASSIGNMENT_PATTERN)) {
    const variableName = match[1] ?? ''
    if (!SECRET_VARIABLE_PATTERN.test(variableName)) continue
    const value = match[3] ?? ''
    if (!SYNTHETIC_VALUE_PATTERN.test(value)) {
      return `non-synthetic secret assignment in ${filePath}`
    }
  }
  return null
}

function git(args, options = {}) {
  return execFileSync('git', args, {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    ...options,
  })
}

export function auditTagSource(tag) {
  validateReleaseTag(tag)
  const ref = `refs/tags/${tag}`
  let tagType
  try {
    tagType = git(['cat-file', '-t', ref]).trim()
  } catch {
    throw new Error(`Release tag ${tag} does not exist locally.`)
  }
  if (tagType !== 'tag') throw new Error(`Release tag ${tag} must be annotated.`)

  const commit = git(['rev-parse', `${tag}^{commit}`]).trim()
  const output = git(['ls-tree', '-r', '--name-only', tag])
  const files = output.split(/\r?\n/).filter(Boolean)
  if (files.length === 0) throw new Error('The release tag contains no files.')

  for (const filePath of files) {
    const forbidden = forbiddenPathReason(filePath)
    if (forbidden) throw new Error(`${forbidden}: ${filePath}`)
    if (/\.(?:png|jpe?g|gif|webp|ico|woff2?|ttf|otf|mp4|mov|zip|gz|tgz)$/i.test(filePath)) {
      continue
    }
    const size = Number(git(['cat-file', '-s', `${tag}:${filePath}`]).trim())
    if (!Number.isFinite(size) || size > 5 * 1024 * 1024) continue
    const content = git(['show', `${tag}:${filePath}`])
    const sensitive = sensitiveContentReason(content, filePath)
    if (sensitive) throw new Error(sensitive)
  }

  return { tag, commit, fileCount: files.length, files }
}

function parseArgs(argv) {
  const result = {}
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index]
    if (key !== '--tag') throw new Error(`Unknown argument: ${key}`)
    const value = argv[index + 1]
    if (!value) throw new Error('--tag requires a value.')
    result.tag = value
    index += 1
  }
  return result
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const audit = auditTagSource(args.tag)
  process.stdout.write(
    `Release source audit passed: ${audit.tag} ${audit.commit} (${audit.fileCount} files).\n`,
  )
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
