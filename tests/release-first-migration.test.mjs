import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test, { after } from 'node:test'

const root = path.resolve(import.meta.dirname, '..')
const deployScriptPath = path.join(root, 'scripts/release/server/deploy-release.sh')
const temporaryRoots = []
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

function shellQuote(value) {
  return `'${value.replaceAll("'", "'\\''")}'`
}

function bashPath(windowsPath) {
  if (process.platform !== 'win32') return windowsPath
  const result = spawnSync(
    bashExecutable,
    ['-c', 'cygpath -u -- "$1"', 'bash', windowsPath],
    { encoding: 'utf8' },
  )
  assert.equal(result.status, 0, result.stderr)
  return result.stdout.trim()
}

function runHarness(body) {
  const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aios-first-migration-'))
  temporaryRoots.push(testRoot)
  const systemdRoot = path.join(testRoot, 'etc/systemd/system')
  const legacyRoot = path.join(testRoot, 'etc/ai-lifeos/legacy')
  const serviceRoot = path.join(testRoot, 'srv/ai-lifeos')
  const harnessPath = path.join(testRoot, 'harness.sh')
  const env = {
    AIOS_RELEASE_TEST_LIBRARY_ONLY: '1',
    AIOS_DEPLOY_CONFIG: bashPath(path.join(testRoot, 'missing.conf')),
    AIOS_ROOT: bashPath(serviceRoot),
    AIOS_SYSTEMD_ROOT: bashPath(systemdRoot),
    AIOS_LEGACY_ROOT: bashPath(legacyRoot),
    AIOS_SYSTEMD_UNIT_FILE: bashPath(path.join(systemdRoot, 'ai-lifeos.service')),
    AIOS_SYSTEMD_DROPIN_DIR: bashPath(
      path.join(systemdRoot, 'ai-lifeos.service.d'),
    ),
    AIOS_SYSTEMD_DROPIN_FILE: bashPath(
      path.join(systemdRoot, 'ai-lifeos.service.d/10-public-beta.conf'),
    ),
    AIOS_LEGACY_UNIT_BACKUP: bashPath(
      path.join(legacyRoot, 'ai-lifeos.service'),
    ),
    AIOS_LEGACY_DROPIN_BACKUP: bashPath(
      path.join(legacyRoot, '10-public-beta.conf'),
    ),
    AIOS_LEGACY_RETIRED_DROPIN_ROOT: bashPath(path.join(legacyRoot, 'retired')),
  }

  const harness = `
set -Eeuo pipefail
export AIOS_RELEASE_TEST_LIBRARY_ONLY=1
export AIOS_DEPLOY_CONFIG=${shellQuote(env.AIOS_DEPLOY_CONFIG)}
export AIOS_ROOT=${shellQuote(env.AIOS_ROOT)}
export AIOS_SYSTEMD_ROOT=${shellQuote(env.AIOS_SYSTEMD_ROOT)}
export AIOS_LEGACY_ROOT=${shellQuote(env.AIOS_LEGACY_ROOT)}
export AIOS_SYSTEMD_UNIT_FILE=${shellQuote(env.AIOS_SYSTEMD_UNIT_FILE)}
export AIOS_SYSTEMD_DROPIN_DIR=${shellQuote(env.AIOS_SYSTEMD_DROPIN_DIR)}
export AIOS_SYSTEMD_DROPIN_FILE=${shellQuote(env.AIOS_SYSTEMD_DROPIN_FILE)}
export AIOS_LEGACY_UNIT_BACKUP=${shellQuote(env.AIOS_LEGACY_UNIT_BACKUP)}
export AIOS_LEGACY_DROPIN_BACKUP=${shellQuote(env.AIOS_LEGACY_DROPIN_BACKUP)}
export AIOS_LEGACY_RETIRED_DROPIN_ROOT=${shellQuote(env.AIOS_LEGACY_RETIRED_DROPIN_ROOT)}
source ${shellQuote(bashPath(deployScriptPath))}

install() {
  local mode="" source_path="" destination="" create_directory=0
  while [[ "$#" -gt 0 ]]; do
    case "$1" in
      -d) create_directory=1; shift ;;
      -o|-g) shift 2 ;;
      -m) mode="$2"; shift 2 ;;
      *)
        if [[ "\${create_directory}" == "1" ]]; then
          destination="$1"
        elif [[ -z "\${source_path}" ]]; then
          source_path="$1"
        else
          destination="$1"
        fi
        shift
        ;;
    esac
  done
  if [[ "\${create_directory}" == "1" ]]; then
    mkdir -p -- "\${destination}"
    chmod "\${mode:-755}" -- "\${destination}"
  else
    mkdir -p -- "$(dirname "\${destination}")"
    cp -- "\${source_path}" "\${destination}"
    chmod "\${mode:-755}" -- "\${destination}"
  fi
}

stat() {
  [[ "\${1:-}" == "-Lc" ]] || { printf 'unsupported stat invocation\\n' >&2; return 2; }
  local format="\${2:-}"
  local target="\${3:-}"
  case "\${format}" in
    %u) printf '0\\n' ;;
    %a)
      case "\${target}" in
        "\${LEGACY_ROOT}"|"\${LEGACY_RETIRED_DROPIN_ROOT}") printf '700\\n' ;;
        "\${LEGACY_ROOT}"/*.service|"\${LEGACY_ROOT}"/*.conf) printf '600\\n' ;;
        "\${SYSTEMD_DROPIN_DIR}") printf '755\\n' ;;
        "\${SYSTEMD_UNIT_FILE}"|"\${SYSTEMD_DROPIN_FILE}") printf '644\\n' ;;
        *) printf '755\\n' ;;
      esac
      ;;
    *) printf 'unsupported stat format: %s\\n' "\${format}" >&2; return 2 ;;
  esac
}

systemctl() {
  local command_name="\${1:-}"
  case "\${command_name}" in
    daemon-reload)
      [[ "\${FAIL_DAEMON_RELOAD:-0}" != "1" ]]
      ;;
    show)
      case "$*" in
        *DropInPaths*)
          [[ -f "\${SYSTEMD_DROPIN_FILE}" ]] && printf '%s\\n' "\${SYSTEMD_DROPIN_FILE}"
          ;;
        *FragmentPath*)
          printf '%s\\n' "\${SYSTEMD_UNIT_FILE}"
          ;;
        *) return 2 ;;
      esac
      ;;
    is-active) return 0 ;;
    restart) [[ "\${FAIL_RESTART:-0}" != "1" ]] ;;
    stop|reset-failed) return 0 ;;
    *) return 2 ;;
  esac
}

wait_for_health() {
  local counter_file="\${TEST_ROOT}/health-count"
  local count=0
  [[ -f "\${counter_file}" ]] && count="$(cat "\${counter_file}")"
  count=$((count + 1))
  printf '%s\\n' "\${count}" >"\${counter_file}"
  [[ "\${FAIL_HEALTH_ONCE:-0}" != "1" || "\${count}" -ne 1 ]]
}

TEST_ROOT=${shellQuote(bashPath(testRoot))}
mkdir -p "\${SYSTEMD_DROPIN_DIR}" "\${LEGACY_ROOT}" "\${ROOT}/state"
cat >"\${SYSTEMD_UNIT_FILE}" <<'UNIT'
[Service]
WorkingDirectory=/srv/ai-lifeos/current
ExecStart=/opt/ai-lifeos/node/bin/node /srv/ai-lifeos/current/node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3000
UNIT
cat >"\${LEGACY_UNIT_BACKUP}" <<'UNIT'
[Service]
ExecStart=/usr/local/bin/legacy-ai-lifeos
UNIT
cat >"\${SYSTEMD_DROPIN_FILE}" <<'DROPIN'
[Service]
Environment="LEGACY_ONLY=1"
DROPIN
cp -- "\${SYSTEMD_DROPIN_FILE}" "\${LEGACY_DROPIN_BACKUP}"
chmod 700 "\${LEGACY_ROOT}"
chmod 600 "\${LEGACY_UNIT_BACKUP}" "\${LEGACY_DROPIN_BACKUP}"
RELEASE_ID="test-release"

${body}
`

  after(() => {
    for (const testRoot of temporaryRoots) {
      fs.rmSync(testRoot, { recursive: true, force: true })
    }
  })

  fs.writeFileSync(harnessPath, harness.replaceAll('\r\n', '\n'), 'utf8')
  const result = spawnSync(bashExecutable, [bashPath(harnessPath)], {
    cwd: testRoot,
    encoding: 'utf8',
    env: { ...process.env, TEST_ROOT: bashPath(testRoot) },
    timeout: 15_000,
  })
  return {
    ...result,
    testRoot,
    paths: {
      systemdUnit: path.join(systemdRoot, 'ai-lifeos.service'),
      dropinDirectory: path.join(systemdRoot, 'ai-lifeos.service.d'),
      dropinFile: path.join(systemdRoot, 'ai-lifeos.service.d/10-public-beta.conf'),
      legacyUnit: path.join(legacyRoot, 'ai-lifeos.service'),
      legacyDropin: path.join(legacyRoot, '10-public-beta.conf'),
      retiredRoot: path.join(legacyRoot, 'retired'),
    },
  }
}

test('first migration validates, retires, and preserves the reviewed legacy drop-in', t => {
  if (!bashExecutable) return t.skip('bash is not installed in this environment')
  const result = runHarness(`
validate_legacy_migration_inputs
retire_legacy_dropin
printf 'quarantine=%s\\n' "\${DROPIN_QUARANTINE}"
`)
  assert.equal(result.status, 0, result.stderr)
  assert.equal(fs.existsSync(result.paths.dropinDirectory), false)
  assert.equal(fs.existsSync(result.paths.legacyUnit), true)
  assert.equal(fs.existsSync(result.paths.legacyDropin), true)
  assert.match(fs.readFileSync(result.paths.legacyUnit, 'utf8'), /legacy-ai-lifeos/)
  assert.match(fs.readFileSync(result.paths.legacyDropin, 'utf8'), /LEGACY_ONLY=1/)
  const retiredEntries = fs.readdirSync(result.paths.retiredRoot)
  assert.equal(retiredEntries.length, 1)
  assert.match(retiredEntries[0], /^test-release-ai-lifeos\.service\.d-/)
})

test('candidate failure restores the legacy unit while the live drop-in is intact', t => {
  if (!bashExecutable) return t.skip('bash is not installed in this environment')
  const result = runHarness(`
RESTORE_LEGACY_ON_FAILURE=1
(
  set +e
  false
  cleanup
)
`)
  assert.equal(result.status, 1, result.stderr)
  assert.match(result.stderr, /legacy service restored after failed first migration/)
  assert.match(fs.readFileSync(result.paths.systemdUnit, 'utf8'), /legacy-ai-lifeos/)
  assert.match(fs.readFileSync(result.paths.dropinFile, 'utf8'), /LEGACY_ONLY=1/)
  assert.match(fs.readFileSync(result.paths.legacyUnit, 'utf8'), /legacy-ai-lifeos/)
  assert.match(fs.readFileSync(result.paths.legacyDropin, 'utf8'), /LEGACY_ONLY=1/)
})

test('new managed health failure restores the quarantined drop-in before restarting', t => {
  if (!bashExecutable) return t.skip('bash is not installed in this environment')
  const result = runHarness(`
RESTORE_LEGACY_ON_FAILURE=1
validate_legacy_migration_inputs
retire_legacy_dropin
(
  set +e
  FAIL_HEALTH_ONCE=1 wait_for_health 3000 1
  false
  cleanup
)
`)
  assert.equal(result.status, 1, result.stderr)
  assert.match(result.stderr, /legacy service restored after failed first migration/)
  assert.match(fs.readFileSync(result.paths.systemdUnit, 'utf8'), /legacy-ai-lifeos/)
  assert.match(fs.readFileSync(result.paths.dropinFile, 'utf8'), /LEGACY_ONLY=1/)
  assert.equal(fs.existsSync(result.paths.retiredRoot), true)
  assert.deepEqual(fs.readdirSync(result.paths.retiredRoot), [])
})

test('legacy restoration failure is reported as critical', t => {
  if (!bashExecutable) return t.skip('bash is not installed in this environment')
  const result = runHarness(`
RESTORE_LEGACY_ON_FAILURE=1
validate_legacy_migration_inputs
retire_legacy_dropin
(
  set +e
  FAIL_RESTART=1
  false
  cleanup
)
`)
  assert.equal(result.status, 1, result.stderr)
  assert.match(result.stderr, /critical: automatic legacy service restoration failed/)
  assert.match(fs.readFileSync(result.paths.systemdUnit, 'utf8'), /legacy-ai-lifeos/)
  assert.match(fs.readFileSync(result.paths.dropinFile, 'utf8'), /LEGACY_ONLY=1/)
  assert.match(fs.readFileSync(result.paths.legacyUnit, 'utf8'), /legacy-ai-lifeos/)
  assert.match(fs.readFileSync(result.paths.legacyDropin, 'utf8'), /LEGACY_ONLY=1/)
})

test('incomplete legacy backups fail before the live systemd files are changed', t => {
  if (!bashExecutable) return t.skip('bash is not installed in this environment')
  const result = runHarness(`
rm -f "\${LEGACY_DROPIN_BACKUP}"
validate_legacy_migration_inputs
`)
  assert.equal(result.status, 1, result.stderr)
  assert.match(result.stderr, /legacy drop-in backup is missing or unsafe/)
  assert.match(fs.readFileSync(result.paths.systemdUnit, 'utf8'), /ai-lifeos\/current/)
  assert.match(fs.readFileSync(result.paths.dropinFile, 'utf8'), /LEGACY_ONLY=1/)
})
