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
import { parsePublicBetaAuthority } from '../scripts/release/public-beta-authority.mjs'

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
const installNodeScriptPath = path.join(
  root,
  'scripts/release/server/install-node-runtime.sh',
)
const deployScript = fs.readFileSync(deployScriptPath, 'utf8')
const rollbackScript = fs.readFileSync(rollbackScriptPath, 'utf8')
const installNodeScript = fs.readFileSync(installNodeScriptPath, 'utf8')
const bashExecutable = (() => {
  const candidates = ['bash']
  if (process.platform === 'win32') {
    candidates.push('C:\\Program Files\\Git\\bin\\bash.exe')
  }
  for (const candidate of candidates) {
    if (candidate.includes('\\') && !fs.existsSync(candidate)) continue
    const probe = spawnSync(candidate, ['--version'], { encoding: 'utf8' })
    if (!probe.error && probe.status === 0) return candidate
  }
  return null
})()
const deployConfig = fs.readFileSync(
  path.join(root, 'scripts/release/deploy.conf.example'),
  'utf8',
)
const serviceUnit = fs.readFileSync(
  path.join(root, 'scripts/release/ai-lifeos.service.example'),
  'utf8',
)

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

test('first migration validates and restores the legacy unit and reviewed drop-in', () => {
  assert.match(deployConfig, /AIOS_LEGACY_MIGRATION=0/)
  assert.match(
    deployConfig,
    /AIOS_SYSTEMD_UNIT_FILE=\/etc\/systemd\/system\/ai-lifeos\.service/,
  )
  assert.match(
    deployConfig,
    /AIOS_SYSTEMD_DROPIN_FILE=\/etc\/systemd\/system\/ai-lifeos\.service\.d\/10-public-beta\.conf/,
  )
  assert.match(
    deployConfig,
    /AIOS_LEGACY_UNIT_BACKUP=\/etc\/ai-lifeos\/legacy\/ai-lifeos\.service/,
  )
  assert.match(
    deployConfig,
    /AIOS_LEGACY_DROPIN_BACKUP=\/etc\/ai-lifeos\/legacy\/10-public-beta\.conf/,
  )
  assert.match(
    deployConfig,
    /AIOS_LEGACY_RETIRED_DROPIN_ROOT=\/etc\/ai-lifeos\/legacy\/retired/,
  )
  assert.match(deployScript, /an active unmanaged service exists/)
  assert.match(deployScript, /legacy unit backup must differ from the new managed unit/)
  assert.match(deployScript, /legacy drop-in backup does not match the live drop-in/)
  assert.match(deployScript, /! -L "\$\{SYSTEMD_DROPIN_FILE\}"/)
  assert.match(
    deployScript,
    /legacy migration requires a complete backup for every live systemd drop-in/,
  )
  assert.match(deployScript, /retire_legacy_dropin/)
  assert.match(deployScript, /DropInPaths/)
  assert.match(deployScript, /RESTORE_LEGACY_ON_FAILURE=1/)
  assert.match(deployScript, /restore_legacy_service/)
  assert.match(deployScript, /install -o root -g root -m 0644/)
  assert.match(deployScript, /systemctl daemon-reload/)
  assert.match(deployScript, /legacy service restored after failed first migration/)
  assert.match(deployScript, /critical: automatic legacy service restoration failed/)
  assert.match(deployScript, /DEPLOY_SUCCEEDED=1/)
})

test('release runtime is fixed, root-managed, and independent of NVM and /usr/bin npm', () => {
  assert.match(deployConfig, /AIOS_NODE_VERSION=v24\.22\.2/)
  assert.match(deployConfig, /AIOS_NODE_ROOT=\/opt\/ai-lifeos\/node/)
  assert.match(deployConfig, /AIOS_NODE_BIN=\/opt\/ai-lifeos\/node\/bin\/node/)
  assert.match(
    deployConfig,
    /AIOS_NPM_CLI=\/opt\/ai-lifeos\/node\/lib\/node_modules\/npm\/bin\/npm-cli\.js/,
  )
  assert.match(deployScript, /Node\.js \$\{NODE_VERSION\} is required/)
  assert.match(deployScript, /Node\.js runtime version must remain v24\.22\.2/)
  assert.match(deployScript, /runtime path must be owned by root/)
  assert.match(deployScript, /runtime path must not be writable by group or other/)
  assert.match(deployScript, /service user \$\{SERVICE_USER\} cannot execute/)
  assert.match(deployScript, /service user \$\{SERVICE_USER\} cannot read/)
  assert.match(deployScript, /"\$\{NODE_BIN\}" "\$\{NPM_CLI\}" --prefix/)
  assert.match(deployScript, /"\$\{NODE_BIN\}" "\$\{NEXT_CLI\}" start/)
  assert.doesNotMatch(deployScript, /command -v (?:node|npm)/)
  assert.doesNotMatch(deployScript, /\/usr\/bin\/npm/)
  assert.doesNotMatch(deployScript, /^\s*(?:node|npm)\b/m)
  assert.match(
    serviceUnit,
    /ExecStart=\/opt\/ai-lifeos\/node\/bin\/node \/srv\/ai-lifeos\/current\/node_modules\/next\/dist\/bin\/next start --hostname 127\.0\.0\.1 --port 3000/,
  )
  assert.doesNotMatch(serviceUnit, /\/usr\/bin\/(?:node|npm)/)
})

test('pinned Node.js installer verifies the official archive and publishes a stable path', () => {
  assert.match(installNodeScript, /NODE_VERSION="v24\.22\.2"/)
  assert.doesNotMatch(installNodeScript, /AIOS_NODE_ARCHIVE_SHA256/)
  assert.match(
    installNodeScript,
    /48cc0e21e048790e54c0cf5749c2725005313d652651c40b7a21feb9697aaf75/,
  )
  assert.match(installNodeScript, /https:\/\/nodejs\.org\/dist\/\$\{NODE_VERSION\}/)
  assert.match(installNodeScript, /sha256sum --check --status/)
  assert.match(installNodeScript, /chown -R root:root/)
  assert.match(installNodeScript, /chmod -R go-w/)
  assert.match(installNodeScript, /ACTIVE_ROOT="\$\{INSTALL_ROOT\}\/node"/)
})

test('public beta authority separates build hostname from HTTPS health origin', () => {
  assert.deepEqual(parsePublicBetaAuthority('beta.example.com:8443'), {
    hostname: 'beta.example.com',
    origin: 'https://beta.example.com:8443',
  })
  assert.deepEqual(parsePublicBetaAuthority('BETA.EXAMPLE.COM'), {
    hostname: 'beta.example.com',
    origin: 'https://beta.example.com',
  })
  for (const invalid of [
    '',
    'https://beta.example.com:8443',
    'beta.example.com/path',
    '*.example.com',
    'localhost:8443',
    'beta.example.com:0',
    'beta.example.com:65536',
  ]) {
    assert.throws(() => parsePublicBetaAuthority(invalid), invalid)
  }
})

test('release workflow builds with a hostname and verifies the exact port-bearing origin', () => {
  assert.match(releaseWorkflow, /NODE_VERSION: "24\.22\.2"/)
  assert.match(
    releaseWorkflow,
    /node scripts\/release\/public-beta-authority\.mjs[\s\S]*--github-output >> "\$GITHUB_OUTPUT"/,
  )
  assert.match(
    releaseWorkflow,
    /AIOS_PUBLIC_BETA_HOSTS: \$\{\{ steps\.public\.outputs\.hostname \}\}/,
  )
  assert.match(
    releaseWorkflow,
    /public_origin: \$\{\{ steps\.public\.outputs\.origin \}\}/,
  )
  assert.match(
    releaseWorkflow,
    /PUBLIC_BETA_ORIGIN: \$\{\{ needs\.build\.outputs\.public_origin \}\}/,
  )
  assert.match(releaseWorkflow, /"\$\{PUBLIC_BETA_ORIGIN\}\/source"/)
  assert.doesNotMatch(
    releaseWorkflow,
    /AIOS_PUBLIC_BETA_HOSTS: \$\{\{ vars\.PUBLIC_BETA_HOST \}\}/,
  )
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
  if (!bashExecutable) {
    t.skip('bash is not installed in this environment')
    return
  }
  for (const scriptPath of [deployScriptPath, rollbackScriptPath, installNodeScriptPath]) {
    const result = spawnSync(bashExecutable, ['-n', scriptPath], { encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
  }
})
