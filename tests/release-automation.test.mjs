import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  forbiddenPathReason,
  sensitiveContentReason,
  validateReleaseTag,
  validateSourceUrl,
} from '../scripts/release/check-release-source.mjs'

const root = path.resolve(import.meta.dirname, '..')
const releaseWorkflow = fs.readFileSync(
  path.join(root, '.github/workflows/manual-release.yml'),
  'utf8',
)
const rollbackWorkflow = fs.readFileSync(
  path.join(root, '.github/workflows/rollback-public-beta.yml'),
  'utf8',
)
const deployScriptPath = path.join(root, 'scripts/release/server/deploy-release.sh')
const rollbackScriptPath = path.join(root, 'scripts/release/server/rollback-release.sh')
const deployScript = fs.readFileSync(deployScriptPath, 'utf8')
const rollbackScript = fs.readFileSync(rollbackScriptPath, 'utf8')

test('release workflow is manual-only and protected by production approval', () => {
  assert.match(releaseWorkflow, /^on:\s*\n\s+workflow_dispatch:/m)
  assert.doesNotMatch(releaseWorkflow, /^\s{2}(?:push|pull_request|schedule):/m)
  assert.match(releaseWorkflow, /environment: production/)
  assert.match(releaseWorkflow, /group: ai-lifeos-production-release/)
  assert.match(releaseWorkflow, /cancel-in-progress: false/)
  assert.match(releaseWorkflow, /git cat-file -t "refs\/tags\/\$\{RELEASE_TAG\}"/)
  assert.match(releaseWorkflow, /tag_type}" != "tag"/)
})

test('release workflow refuses private AGPL source repositories', () => {
  assert.match(releaseWorkflow, /gh api "repos\/\$\{REPOSITORY\}" --jq \.private/)
  assert.match(releaseWorkflow, /must be public/)
  assert.match(releaseWorkflow, /AIOS_PUBLIC_BETA_SOURCE_URL/)
  assert.match(releaseWorkflow, /github\.com\/\$\{REPOSITORY\}\/tree\/\$\{RELEASE_TAG\}/)
})

test('release and rollback serialize through the same concurrency group', () => {
  assert.match(rollbackWorkflow, /^on:\s*\n\s+workflow_dispatch:/m)
  assert.match(rollbackWorkflow, /environment: production/)
  assert.match(rollbackWorkflow, /group: ai-lifeos-production-release/)
  assert.match(rollbackWorkflow, /cancel-in-progress: false/)
})

test('server scripts use lock, checksum, health checks, and automatic rollback', () => {
  assert.match(deployScript, /flock -n 9/)
  assert.match(deployScript, /sha256sum/)
  assert.match(deployScript, /archive checksum mismatch/)
  assert.match(deployScript, /systemd-run/)
  assert.match(deployScript, /APP_STAGING="\$\{STAGING_RELEASE\}\/release"/)
  assert.match(deployScript, /mv "\$\{APP_STAGING\}" "\$\{FINAL_RELEASE\}"/)
  assert.match(deployScript, /candidate port \$\{CANDIDATE_PORT\} is already in use/)
  assert.match(deployScript, /candidate release failed its health check/)
  assert.match(deployScript, /systemctl is-active --quiet "\$\{CANDIDATE_UNIT\}"/)
  assert.match(deployScript, /systemctl restart "\$\{SERVICE_NAME\}"/)
  assert.match(deployScript, /previous release was restored when available/)
  assert.match(deployScript, /previous\.next/)
  assert.match(deployScript, /STATE\}\/previous/)
  assert.match(rollbackScript, /flock -n 9/)
  assert.match(rollbackScript, /previous\.rollback/)
  assert.match(rollbackScript, /original release was restored/)
})

test('deployment scripts cannot manage proxy, tunnel, or Xray services', () => {
  const forbiddenCommands = [
    /systemctl\s+(?:restart|reload|stop|start)\s+(?:nginx|tailscaled|tailscale|xray)/i,
    /\bnginx\s+-s\b/i,
    /\btailscale\s+funnel\b/i,
    /\bxray\s+(?:run|restart)\b/i,
  ]
  for (const source of [deployScript, rollbackScript]) {
    for (const pattern of forbiddenCommands) assert.doesNotMatch(source, pattern)
  }
})

test('release tags are exact semantic version tags', () => {
  assert.equal(validateReleaseTag('v0.2.0'), 'v0.2.0')
  assert.equal(validateReleaseTag('v0.2.0-beta.1'), 'v0.2.0-beta.1')
  for (const invalid of ['0.2.0', 'v0.2', 'v0.2.0/evil', 'v01.2.0', 'latest']) {
    assert.throws(() => validateReleaseTag(invalid))
  }
})

test('source URL must point to the exact public tag tree', () => {
  const source = 'https://github.com/example/ai-lifeos/tree/v0.2.0-beta.1'
  assert.equal(validateSourceUrl(source, 'v0.2.0-beta.1'), source)
  assert.throws(() => validateSourceUrl(
    'https://example.com/example/ai-lifeos/tree/v0.2.0-beta.1',
    'v0.2.0-beta.1',
  ))
  assert.throws(() => validateSourceUrl(
    'https://github.com/example/ai-lifeos/tree/v0.2.0-beta.2',
    'v0.2.0-beta.1',
  ))
})

test('release source guard rejects local data, credentials, and generated output', () => {
  const forbidden = [
    '$null',
    'tools-build-stage/output.js',
    '.env.local',
    '.env.production',
    'node_modules/next/package.json',
    '.next/BUILD_ID',
    '.next-alpha-build/app.js',
    'backups/records.json',
    'data/life-records.sqlite',
    'firebase-admin-key.json',
    '.config/ai-lifeos/chatgpt-plan.json',
    'dev-3000.err.log',
    'deploy/private-key.pem',
  ]
  for (const filePath of forbidden) assert.ok(forbiddenPathReason(filePath), filePath)
  assert.equal(forbiddenPathReason('.env.example'), null)
  assert.equal(forbiddenPathReason('.env.public-beta.example'), null)
  assert.equal(forbiddenPathReason('app/page.tsx'), null)
})

test('sensitive scanner catches high-confidence secrets and permits synthetic fixtures', () => {
  const privateHeader = ['-----BEGIN ', 'PRIVATE KEY-----'].join('')
  assert.ok(sensitiveContentReason(privateHeader, 'secret.pem'))
  assert.ok(sensitiveContentReason(
    `TENCENT_TOKENHUB_API_KEY=${'A'.repeat(40)}`,
    '.env.production',
  ))
  assert.equal(sensitiveContentReason(
    `TENCENT_TOKENHUB_API_KEY=${'replace-with-test-placeholder'.repeat(2)}`,
    '.env.public-beta.example',
  ), null)
  assert.equal(sensitiveContentReason(
    'NEXT_PUBLIC_FIREBASE_API_KEY=your-api-key-here',
    '.env.example',
  ), null)
  assert.equal(sensitiveContentReason(
    'TENCENT_TOKENHUB_MODEL_ID=deepseek-v4.1-flash-1017',
    '.env.public-beta.example',
  ), null)
  assert.equal(sensitiveContentReason(
    'TENCENT_TOKENHUB_API_KEY=\nOPENROUTER_API_KEY=\n',
    '.env.public-beta.example',
  ), null)
})

test('shell scripts parse with bash when available', t => {
  const probe = spawnSync('bash', ['--version'], { encoding: 'utf8' })
  if (probe.error?.code === 'ENOENT') {
    t.skip('bash is not installed in this environment')
    return
  }
  for (const scriptPath of [deployScriptPath, rollbackScriptPath]) {
    const result = spawnSync('bash', ['-n', scriptPath], { encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
  }
})
