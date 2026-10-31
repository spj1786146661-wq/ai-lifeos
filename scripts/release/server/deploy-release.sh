#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="${AIOS_ROOT:-/srv/ai-lifeos}"
CONFIG_FILE="${AIOS_DEPLOY_CONFIG:-/etc/ai-lifeos/deploy.conf}"
if [[ -r "${CONFIG_FILE}" ]]; then
  # shellcheck disable=SC1090
  source "${CONFIG_FILE}"
fi

SERVICE_NAME="${AIOS_SERVICE_NAME:-ai-lifeos.service}"
SERVICE_USER="${AIOS_SERVICE_USER:-aios}"
SERVICE_GROUP="${AIOS_SERVICE_GROUP:-aios}"
SERVICE_HOME="${AIOS_SERVICE_HOME:-/var/lib/ai-lifeos}"
DEPLOY_USER="${AIOS_DEPLOY_USER:-deploy}"
DEPLOY_GROUP="${AIOS_DEPLOY_GROUP:-deploy}"
SHARED_ENV_FILE="${AIOS_SHARED_ENV_FILE:-${ROOT}/shared/public-beta.env}"
PUBLIC_PORT="${AIOS_PUBLIC_PORT:-3000}"
CANDIDATE_PORT="${AIOS_CANDIDATE_PORT:-3001}"
HEALTH_PATH="${AIOS_HEALTH_PATH:-/}"
NODE_VERSION="${AIOS_NODE_VERSION:-v24.22.2}"
NODE_ROOT="${AIOS_NODE_ROOT:-/opt/ai-lifeos/node}"
NODE_BIN="${AIOS_NODE_BIN:-${NODE_ROOT}/bin/node}"
NPM_CLI="${AIOS_NPM_CLI:-${NODE_ROOT}/lib/node_modules/npm/bin/npm-cli.js}"
LEGACY_MIGRATION="${AIOS_LEGACY_MIGRATION:-0}"
SYSTEMD_ROOT="${AIOS_SYSTEMD_ROOT:-/etc/systemd/system}"
LEGACY_ROOT="${AIOS_LEGACY_ROOT:-/etc/ai-lifeos/legacy}"
SYSTEMD_UNIT_FILE="${AIOS_SYSTEMD_UNIT_FILE:-${SYSTEMD_ROOT}/ai-lifeos.service}"
SYSTEMD_DROPIN_DIR="${AIOS_SYSTEMD_DROPIN_DIR:-${SYSTEMD_UNIT_FILE}.d}"
SYSTEMD_DROPIN_FILE="${AIOS_SYSTEMD_DROPIN_FILE:-${SYSTEMD_DROPIN_DIR}/10-public-beta.conf}"
LEGACY_UNIT_BACKUP="${AIOS_LEGACY_UNIT_BACKUP:-${LEGACY_ROOT}/ai-lifeos.service}"
LEGACY_DROPIN_BACKUP="${AIOS_LEGACY_DROPIN_BACKUP:-${LEGACY_ROOT}/10-public-beta.conf}"
LEGACY_RETIRED_DROPIN_ROOT="${AIOS_LEGACY_RETIRED_DROPIN_ROOT:-${LEGACY_ROOT}/retired}"
INCOMING="${ROOT}/incoming"
RELEASES="${ROOT}/releases"
STATE="${ROOT}/state"
ARTIFACTS="${ROOT}/artifacts"
ARCHIVE="${INCOMING}/release.tar.gz"
MANIFEST="${INCOMING}/release.json"

fail() {
  printf 'release failed: %s\n' "$*" >&2
  exit 1
}

require_runtime_commands() {
  [[ "${EUID}" -eq 0 ]] || fail "run as root"
  command -v flock >/dev/null || fail "flock is required"
  command -v sha256sum >/dev/null || fail "sha256sum is required"
  command -v systemd-run >/dev/null || fail "systemd-run is required"
  command -v systemctl >/dev/null || fail "systemctl is required"
  command -v curl >/dev/null || fail "curl is required"
  command -v runuser >/dev/null || fail "runuser is required"
  command -v ss >/dev/null || fail "ss is required"
  command -v stat >/dev/null || fail "stat is required"
  command -v install >/dev/null || fail "install is required"
  command -v cmp >/dev/null || fail "cmp is required"
  command -v grep >/dev/null || fail "grep is required"
  command -v find >/dev/null || fail "find is required"
  command -v basename >/dev/null || fail "basename is required"
  command -v dirname >/dev/null || fail "dirname is required"
}

wait_for_health() {
  local port="$1"
  local require_service="${2:-0}"
  local attempts=30
  local index
  for ((index = 1; index <= attempts; index += 1)); do
    if [[ "${require_service}" == "1" ]] && ! systemctl is-active --quiet "${SERVICE_NAME}"; then
      sleep 1
      continue
    fi
    if curl --fail --silent --show-error --max-time 5 \
      "http://127.0.0.1:${port}${HEALTH_PATH}" >/dev/null; then
      return 0
    fi
    sleep 1
  done
  return 1
}

FIRST_MANAGED_RELEASE=0
RESTORE_LEGACY_ON_FAILURE=0
DROPIN_QUARANTINED=0
DROPIN_QUARANTINE=""
CANDIDATE_UNIT=""
STAGING_RELEASE=""
DEPLOY_SUCCEEDED=0

assert_secure_root_directory() {
  local directory="$1"
  local label="$2"
  local expected_mode="$3"
  local owner
  local mode
  [[ -d "${directory}" && ! -L "${directory}" ]] \
    || fail "${label} is missing or unsafe"
  owner="$(stat -Lc '%u' "${directory}")"
  mode="$(stat -Lc '%a' "${directory}")"
  [[ "${owner}" == "0" ]] || fail "${label} must be owned by root"
  [[ "${mode}" == "${expected_mode}" ]] \
    || fail "${label} must use mode ${expected_mode}"
}

assert_secure_legacy_backup_file() {
  local file="$1"
  local label="$2"
  local owner
  local mode
  [[ -f "${file}" && ! -L "${file}" ]] || fail "${label} is missing or unsafe"
  owner="$(stat -Lc '%u' "${file}")"
  mode="$(stat -Lc '%a' "${file}")"
  [[ "${owner}" == "0" ]] || fail "${label} must be owned by root"
  [[ "${mode}" == "600" ]] || fail "${label} must use mode 600"
}

assert_safe_live_dropin() {
  local owner
  local mode
  [[ -d "${SYSTEMD_DROPIN_DIR}" && ! -L "${SYSTEMD_DROPIN_DIR}" ]] \
    || fail "legacy systemd drop-in directory is missing or unsafe"
  owner="$(stat -Lc '%u' "${SYSTEMD_DROPIN_DIR}")"
  mode="$(stat -Lc '%a' "${SYSTEMD_DROPIN_DIR}")"
  [[ "${owner}" == "0" ]] || fail "legacy systemd drop-in directory must be owned by root"
  (( (8#${mode} & 8#022) == 0 )) \
    || fail "legacy systemd drop-in directory must not be writable by group or other"

  [[ -f "${SYSTEMD_DROPIN_FILE}" && ! -L "${SYSTEMD_DROPIN_FILE}" ]] \
    || fail "legacy systemd drop-in is missing or unsafe"
  owner="$(stat -Lc '%u' "${SYSTEMD_DROPIN_FILE}")"
  mode="$(stat -Lc '%a' "${SYSTEMD_DROPIN_FILE}")"
  [[ "${owner}" == "0" ]] || fail "legacy systemd drop-in must be owned by root"
  (( (8#${mode} & 8#022) == 0 )) \
    || fail "legacy systemd drop-in must not be writable by group or other"
}

assert_reviewed_dropin_set() {
  local -a entries=()
  mapfile -t entries < <(
    find "${SYSTEMD_DROPIN_DIR}" -mindepth 1 -maxdepth 1 -print
  )
  [[ "${#entries[@]}" -eq 1 && "${entries[0]}" == "${SYSTEMD_DROPIN_FILE}" ]] \
    || fail "legacy migration requires a complete backup for every live systemd drop-in"
}

validate_legacy_migration_inputs() {
  local backup_directory
  if [[ "${AIOS_RELEASE_TEST_LIBRARY_ONLY:-0}" != "1" ]]; then
    [[ "${SYSTEMD_ROOT}" == "/etc/systemd/system" ]] \
      || fail "systemd root must remain /etc/systemd/system"
    [[ "${LEGACY_ROOT}" == "/etc/ai-lifeos/legacy" ]] \
      || fail "legacy backup root must remain /etc/ai-lifeos/legacy"
  fi
  [[ "${SYSTEMD_UNIT_FILE}" == "${SYSTEMD_ROOT}/"*.service ]] \
    || fail "systemd unit file must be an absolute service path under /etc/systemd/system"
  [[ "${SYSTEMD_DROPIN_DIR}" == "${SYSTEMD_UNIT_FILE}.d" ]] \
    || fail "systemd drop-in directory must match the managed service unit"
  [[ "${SYSTEMD_DROPIN_FILE}" == "${SYSTEMD_DROPIN_DIR}/"*.conf ]] \
    || fail "systemd drop-in file must remain inside the managed service drop-in directory"
  [[ "${LEGACY_UNIT_BACKUP}" == "${LEGACY_ROOT}/"*.service ]] \
    || fail "legacy unit backup must remain under /etc/ai-lifeos/legacy"
  [[ "${LEGACY_DROPIN_BACKUP}" == "${LEGACY_ROOT}/"*.conf ]] \
    || fail "legacy drop-in backup must remain under /etc/ai-lifeos/legacy"
  [[ "${LEGACY_RETIRED_DROPIN_ROOT}" == "${LEGACY_ROOT}/"* ]] \
    || fail "retired legacy drop-ins must remain under /etc/ai-lifeos/legacy"

  backup_directory="$(dirname "${LEGACY_UNIT_BACKUP}")"
  [[ "${backup_directory}" == "$(dirname "${LEGACY_DROPIN_BACKUP}")" ]] \
    || fail "legacy unit and drop-in backups must share one protected directory"
  assert_secure_root_directory "${backup_directory}" "legacy backup directory" "700"
  assert_secure_legacy_backup_file "${LEGACY_UNIT_BACKUP}" "legacy unit backup"
  assert_secure_legacy_backup_file "${LEGACY_DROPIN_BACKUP}" "legacy drop-in backup"

  [[ -f "${SYSTEMD_UNIT_FILE}" && ! -L "${SYSTEMD_UNIT_FILE}" ]] \
    || fail "new systemd unit file is missing or unsafe"
  [[ "$(stat -Lc '%u' "${SYSTEMD_UNIT_FILE}")" == "0" ]] \
    || fail "new systemd unit file must be owned by root"
  (( (8#$(stat -Lc '%a' "${SYSTEMD_UNIT_FILE}") & 8#022) == 0 )) \
    || fail "new systemd unit file must not be writable by group or other"
  cmp -s "${SYSTEMD_UNIT_FILE}" "${LEGACY_UNIT_BACKUP}" \
    && fail "legacy unit backup must differ from the new managed unit"
  grep -Eq '^\[Service\]$' "${LEGACY_UNIT_BACKUP}" \
    || fail "legacy unit backup does not contain a Service section"
  grep -Eq '^ExecStart=' "${LEGACY_UNIT_BACKUP}" \
    || fail "legacy unit backup does not contain ExecStart"

  assert_safe_live_dropin
  assert_reviewed_dropin_set
  [[ "$(basename "${LEGACY_DROPIN_BACKUP}")" == "$(basename "${SYSTEMD_DROPIN_FILE}")" ]] \
    || fail "legacy drop-in backup filename does not match the live drop-in"
  cmp -s "${SYSTEMD_DROPIN_FILE}" "${LEGACY_DROPIN_BACKUP}" \
    || fail "legacy drop-in backup does not match the live drop-in"

  grep -Fq 'WorkingDirectory=/srv/ai-lifeos/current' "${SYSTEMD_UNIT_FILE}" \
    || fail "new systemd unit does not use the managed current release"
  grep -Fq 'ExecStart=/opt/ai-lifeos/node/bin/node ' "${SYSTEMD_UNIT_FILE}" \
    || fail "new systemd unit does not use the fixed Node.js runtime"
}

assert_loaded_legacy_dropin() {
  [[ "$(systemctl show --property=DropInPaths --value "${SERVICE_NAME}")" == "${SYSTEMD_DROPIN_FILE}" ]] \
    || fail "systemd did not load the reviewed legacy drop-in"
}

assert_no_loaded_dropins() {
  [[ -z "$(systemctl show --property=DropInPaths --value "${SERVICE_NAME}")" ]] \
    || fail "managed service still loads an unreviewed systemd drop-in"
}

retire_legacy_dropin() {
  install -d -o root -g root -m 0700 "${LEGACY_RETIRED_DROPIN_ROOT}" \
    || return 1
  assert_secure_root_directory \
    "${LEGACY_RETIRED_DROPIN_ROOT}" \
    "retired legacy drop-in directory" \
    "700" \
    || return 1
  DROPIN_QUARANTINE="${LEGACY_RETIRED_DROPIN_ROOT}/${RELEASE_ID}-$(basename "${SYSTEMD_DROPIN_DIR}")-$$"
  [[ ! -e "${DROPIN_QUARANTINE}" ]] \
    || {
      printf 'retired legacy drop-in path already exists: %s\n' "${DROPIN_QUARANTINE}" >&2
      return 1
    }
  mv -T -- "${SYSTEMD_DROPIN_DIR}" "${DROPIN_QUARANTINE}" || return 1
  DROPIN_QUARANTINED=1
  systemctl daemon-reload || return 1
  assert_no_loaded_dropins
}

restore_legacy_service() {
  printf 'first migration failed; restoring the legacy systemd service\n' >&2
  rm -f "${ROOT}/current" "${ROOT}/previous" "${STATE}/current" "${STATE}/previous"
  assert_secure_legacy_backup_file "${LEGACY_UNIT_BACKUP}" "legacy unit backup" \
    || return 1
  assert_secure_legacy_backup_file "${LEGACY_DROPIN_BACKUP}" "legacy drop-in backup" \
    || return 1
  if [[ "${DROPIN_QUARANTINED}" == "1" ]]; then
    [[ -d "${DROPIN_QUARANTINE}" && ! -L "${DROPIN_QUARANTINE}" ]] \
      || return 1
    cmp -s "${DROPIN_QUARANTINE}/$(basename "${SYSTEMD_DROPIN_FILE}")" "${LEGACY_DROPIN_BACKUP}" \
      || return 1
    [[ ! -e "${SYSTEMD_DROPIN_DIR}" ]] || return 1
    mv -T -- "${DROPIN_QUARANTINE}" "${SYSTEMD_DROPIN_DIR}" || return 1
    DROPIN_QUARANTINED=0
  else
    assert_safe_live_dropin
    cmp -s "${SYSTEMD_DROPIN_FILE}" "${LEGACY_DROPIN_BACKUP}" || return 1
  fi
  install -o root -g root -m 0644 "${LEGACY_UNIT_BACKUP}" "${SYSTEMD_UNIT_FILE}" \
    || return 1
  systemctl daemon-reload || return 1
  systemctl restart "${SERVICE_NAME}" || return 1
  wait_for_health "${PUBLIC_PORT}" 1
}

cleanup() {
  local exit_code=$?
  trap - EXIT
  set +e
  if [[ -n "${CANDIDATE_UNIT}" ]]; then
    systemctl stop "${CANDIDATE_UNIT}" >/dev/null 2>&1 || true
    systemctl reset-failed "${CANDIDATE_UNIT}" >/dev/null 2>&1 || true
  fi
  if [[ -n "${STAGING_RELEASE}" ]]; then
    rm -rf "${STAGING_RELEASE}"
  fi
  if [[ "${RESTORE_LEGACY_ON_FAILURE}" == "1" && "${DEPLOY_SUCCEEDED}" != "1" ]]; then
    if restore_legacy_service; then
      printf 'legacy service restored after failed first migration\n' >&2
    else
      printf 'critical: automatic legacy service restoration failed\n' >&2
    fi
  fi
  exit "${exit_code}"
}

if [[ "${BASH_SOURCE[0]}" != "$0" && "${AIOS_RELEASE_TEST_LIBRARY_ONLY:-0}" == "1" ]]; then
  return 0
fi

require_runtime_commands

exec 9>"/run/lock/ai-lifeos-release.lock"
flock -n 9 || fail "another AI-LifeOS deployment or rollback is running"
trap cleanup EXIT

if [[ ! -L "${ROOT}/current" ]]; then
  FIRST_MANAGED_RELEASE=1
fi
if [[ "${LEGACY_MIGRATION}" != "0" && "${LEGACY_MIGRATION}" != "1" ]]; then
  fail "AIOS_LEGACY_MIGRATION must be 0 or 1"
fi
if [[ "${FIRST_MANAGED_RELEASE}" == "1" ]] \
  && systemctl is-active --quiet "${SERVICE_NAME}" \
  && [[ "${LEGACY_MIGRATION}" != "1" ]]; then
  fail "an active unmanaged service exists; create the legacy unit backup and set AIOS_LEGACY_MIGRATION=1"
fi
if [[ "${LEGACY_MIGRATION}" == "1" ]]; then
  [[ "${FIRST_MANAGED_RELEASE}" == "1" ]] \
    || fail "legacy migration mode is only valid before the first managed release"
  validate_legacy_migration_inputs
  RESTORE_LEGACY_ON_FAILURE=1
  systemctl daemon-reload
  [[ "$(systemctl show --property=FragmentPath --value "${SERVICE_NAME}")" == "${SYSTEMD_UNIT_FILE}" ]] \
    || fail "systemd did not load the reviewed unit file"
  assert_loaded_legacy_dropin
  systemctl is-active --quiet "${SERVICE_NAME}" \
    || fail "legacy service is not active before migration"
  wait_for_health "${PUBLIC_PORT}" 1 \
    || fail "legacy service is not healthy before migration"
fi

[[ "${NODE_ROOT}" == "/opt/ai-lifeos/node" ]] \
  || fail "Node.js runtime root must remain /opt/ai-lifeos/node"
[[ "${NODE_VERSION}" == "v24.22.2" ]] \
  || fail "Node.js runtime version must remain v24.22.2"
[[ "${NODE_BIN}" == "${NODE_ROOT}/bin/node" ]] || fail "unexpected Node.js executable path"
[[ "${NPM_CLI}" == "${NODE_ROOT}/lib/node_modules/npm/bin/npm-cli.js" ]] \
  || fail "unexpected npm CLI path"
[[ -x "${NODE_BIN}" ]] || fail "Node.js executable is missing: ${NODE_BIN}"
[[ -r "${NPM_CLI}" ]] || fail "npm CLI is missing: ${NPM_CLI}"

for runtime_path in "$(dirname "${NODE_ROOT}")" "${NODE_ROOT}" "${NODE_BIN}" "${NPM_CLI}"; do
  runtime_owner="$(stat -Lc '%u' "${runtime_path}")"
  runtime_mode="$(stat -Lc '%a' "${runtime_path}")"
  [[ "${runtime_owner}" == "0" ]] || fail "runtime path must be owned by root: ${runtime_path}"
  (( (8#${runtime_mode} & 8#022) == 0 )) \
    || fail "runtime path must not be writable by group or other: ${runtime_path}"
done
[[ "$("${NODE_BIN}" --version)" == "${NODE_VERSION}" ]] \
  || fail "Node.js ${NODE_VERSION} is required at ${NODE_BIN}"
"${NODE_BIN}" "${NPM_CLI}" --version >/dev/null \
  || fail "npm CLI could not be executed with the fixed Node.js runtime"
NODE_PATH="${NODE_ROOT}/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

[[ -f "${ARCHIVE}" ]] || fail "missing ${ARCHIVE}"
[[ -f "${MANIFEST}" ]] || fail "missing ${MANIFEST}"
[[ -f "${SHARED_ENV_FILE}" ]] || fail "missing server environment file ${SHARED_ENV_FILE}"
id "${SERVICE_USER}" >/dev/null 2>&1 || fail "service user ${SERVICE_USER} does not exist"
id "${DEPLOY_USER}" >/dev/null 2>&1 || fail "deployment user ${DEPLOY_USER} does not exist"
getent group "${DEPLOY_GROUP}" >/dev/null || fail "deployment group ${DEPLOY_GROUP} does not exist"
runuser -u "${SERVICE_USER}" -- "${NODE_BIN}" --version >/dev/null \
  || fail "service user ${SERVICE_USER} cannot execute the fixed Node.js runtime"
runuser -u "${SERVICE_USER}" -- test -r "${NPM_CLI}" \
  || fail "service user ${SERVICE_USER} cannot read the fixed npm CLI"

readarray -t manifest_values < <(
  "${NODE_BIN}" - "${MANIFEST}" <<'NODE'
const fs = require('node:fs')
const path = process.argv[2]
const value = JSON.parse(fs.readFileSync(path, 'utf8'))
const fail = message => {
  console.error(message)
  process.exit(1)
}
if (value.schemaVersion !== 1) fail('unsupported release manifest schema')
if (!/^v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/.test(value.tag ?? '')) fail('invalid tag')
if (!/^[A-Za-z0-9._-]{7,120}$/.test(value.releaseId ?? '')) fail('invalid releaseId')
if (!/^[0-9a-f]{40}$/.test(value.commit ?? '')) fail('invalid commit')
if (!/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/tree\/[A-Za-z0-9._-]+$/.test(value.sourceUrl ?? '')) fail('invalid sourceUrl')
if (!/^[0-9a-f]{64}$/.test(value.archiveSha256 ?? '')) fail('invalid archiveSha256')
for (const field of ['tag', 'releaseId', 'commit', 'sourceUrl', 'archiveSha256']) {
  if (/[\r\n]/.test(value[field])) fail(`invalid newline in ${field}`)
  console.log(value[field])
}
NODE
)
[[ "${#manifest_values[@]}" -eq 5 ]] || fail "manifest parser returned an unexpected result"
TAG="${manifest_values[0]}"
RELEASE_ID="${manifest_values[1]}"
COMMIT="${manifest_values[2]}"
SOURCE_URL="${manifest_values[3]}"
EXPECTED_SHA="${manifest_values[4]}"

ACTUAL_SHA="$(sha256sum "${ARCHIVE}" | awk '{print $1}')"
[[ "${ACTUAL_SHA}" == "${EXPECTED_SHA}" ]] || fail "release archive checksum mismatch"

while IFS= read -r entry; do
  [[ "${entry}" == "release" || "${entry}" == release/* ]] || fail "archive path escapes release/: ${entry}"
  [[ "${entry}" != /* && "${entry}" != *"/../"* && "${entry}" != "../"* ]] || fail "unsafe archive entry: ${entry}"
done < <(tar -tzf "${ARCHIVE}")

install -d -m 0755 "${RELEASES}" "${STATE}" "${ARTIFACTS}"
install -d -o "${DEPLOY_USER}" -g "${DEPLOY_GROUP}" -m 0750 "${INCOMING}"

FINAL_RELEASE="${RELEASES}/${RELEASE_ID}"
STAGING_RELEASE="${RELEASES}/.staging-${RELEASE_ID}-$$"
[[ ! -e "${FINAL_RELEASE}" ]] || fail "release directory already exists: ${FINAL_RELEASE}"
rm -rf "${STAGING_RELEASE}"
mkdir -p "${STAGING_RELEASE}"

CANDIDATE_UNIT="aios-candidate-${RELEASE_ID//[^A-Za-z0-9]/_}.service"

tar -xzf "${ARCHIVE}" -C "${STAGING_RELEASE}" --no-same-owner
[[ -d "${STAGING_RELEASE}/release" ]] || fail "archive does not contain release/"
APP_STAGING="${STAGING_RELEASE}/release"

printf '%s\n' \
  "AIOS_PUBLIC_BETA_RELEASE_ID=${RELEASE_ID}" \
  "AIOS_PUBLIC_BETA_SOURCE_URL=${SOURCE_URL}" \
  "AIOS_RELEASE_TAG=${TAG}" \
  "AIOS_RELEASE_COMMIT=${COMMIT}" \
  "AIOS_RELEASE_ARCHIVE_SHA256=${EXPECTED_SHA}" \
  > "${APP_STAGING}/release.env"
chmod 0440 "${APP_STAGING}/release.env"

[[ -f "${APP_STAGING}/.next/BUILD_ID" ]] || fail "production build output is missing"
[[ -f "${APP_STAGING}/package-lock.json" ]] || fail "lock file is missing"
chown -R "${SERVICE_USER}:${SERVICE_GROUP}" "${APP_STAGING}"

runuser -u "${SERVICE_USER}" -- env HOME="${SERVICE_HOME}" \
  PATH="${NODE_PATH}" \
  "${NODE_BIN}" "${NPM_CLI}" --prefix "${APP_STAGING}" ci \
  --omit=dev --no-audit --no-fund

chmod -R u=rwX,g=rX,o= "${APP_STAGING}"

mv "${APP_STAGING}" "${FINAL_RELEASE}"
rmdir "${STAGING_RELEASE}"

if ss -H -ltn "sport = :${CANDIDATE_PORT}" | grep -q .; then
  fail "candidate port ${CANDIDATE_PORT} is already in use"
fi

NEXT_CLI="${FINAL_RELEASE}/node_modules/next/dist/bin/next"
[[ -r "${NEXT_CLI}" ]] || fail "candidate release is missing the Next.js CLI"

systemd-run \
  --unit="${CANDIDATE_UNIT}" \
  --collect \
  --property=Type=simple \
  --property="WorkingDirectory=${FINAL_RELEASE}" \
  --property="EnvironmentFile=${SHARED_ENV_FILE}" \
  --property="EnvironmentFile=${FINAL_RELEASE}/release.env" \
  --property="User=${SERVICE_USER}" \
  --property="Group=${SERVICE_GROUP}" \
  --property=NoNewPrivileges=yes \
  --property=PrivateTmp=yes \
  --setenv=NODE_ENV=production \
  --setenv=PORT="${CANDIDATE_PORT}" \
  --setenv="PATH=${NODE_PATH}" \
  "${NODE_BIN}" "${NEXT_CLI}" start \
  --hostname 127.0.0.1 --port "${CANDIDATE_PORT}"

wait_for_health "${CANDIDATE_PORT}" || fail "candidate release failed its health check"
systemctl is-active --quiet "${CANDIDATE_UNIT}" \
  || fail "candidate systemd unit stopped unexpectedly"
systemctl stop "${CANDIDATE_UNIT}" >/dev/null 2>&1 || true
systemctl reset-failed "${CANDIDATE_UNIT}" >/dev/null 2>&1 || true

OLD_CURRENT=""
OLD_PREVIOUS=""
if [[ -L "${ROOT}/current" ]]; then
  OLD_CURRENT="$(basename "$(readlink -f "${ROOT}/current")")"
fi
if [[ -f "${STATE}/previous" ]]; then
  OLD_PREVIOUS="$(<"${STATE}/previous")"
fi

ln -s "${FINAL_RELEASE}" "${ROOT}/current.next.$$"
mv -Tf "${ROOT}/current.next.$$" "${ROOT}/current"
if [[ "${LEGACY_MIGRATION}" == "1" ]]; then
  retire_legacy_dropin \
    || fail "could not safely retire the legacy systemd drop-in"
fi
systemctl restart "${SERVICE_NAME}"

if ! wait_for_health "${PUBLIC_PORT}" 1; then
  if [[ -n "${OLD_CURRENT}" && -d "${RELEASES}/${OLD_CURRENT}" ]]; then
    ln -s "${RELEASES}/${OLD_CURRENT}" "${ROOT}/current.rollback.$$"
    mv -Tf "${ROOT}/current.rollback.$$" "${ROOT}/current"
    printf '%s\n' "${OLD_CURRENT}" > "${STATE}/current"
    printf '%s\n' "${OLD_PREVIOUS}" > "${STATE}/previous"
    systemctl restart "${SERVICE_NAME}"
    wait_for_health "${PUBLIC_PORT}" 1 || true
  else
    rm -f "${ROOT}/current"
  fi
  fail "new release did not become healthy; previous release was restored when available"
fi

printf '%s\n' "${RELEASE_ID}" > "${STATE}/current"
printf '%s\n' "${OLD_CURRENT}" > "${STATE}/previous"
chmod 0644 "${STATE}/current" "${STATE}/previous"
if [[ -n "${OLD_CURRENT}" && -d "${RELEASES}/${OLD_CURRENT}" ]]; then
  ln -s "${RELEASES}/${OLD_CURRENT}" "${ROOT}/previous.next.$$"
  mv -Tf "${ROOT}/previous.next.$$" "${ROOT}/previous"
else
  rm -f "${ROOT}/previous"
fi

mv "${ARCHIVE}" "${ARTIFACTS}/${RELEASE_ID}.tar.gz"
mv "${MANIFEST}" "${ARTIFACTS}/${RELEASE_ID}.json"
chmod 0640 "${ARTIFACTS}/${RELEASE_ID}.tar.gz" "${ARTIFACTS}/${RELEASE_ID}.json"

DEPLOY_SUCCEEDED=1
trap - EXIT
printf 'deployed %s (%s); previous=%s\n' "${RELEASE_ID}" "${TAG}" "${OLD_CURRENT:-none}"
if [[ "${LEGACY_MIGRATION}" == "1" ]]; then
  printf 'retired legacy drop-in: %s\n' "${DROPIN_QUARANTINE}"
fi
