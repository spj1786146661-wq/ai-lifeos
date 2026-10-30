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

[[ "${EUID}" -eq 0 ]] || fail "run as root"
command -v flock >/dev/null || fail "flock is required"
command -v node >/dev/null || fail "node is required"
command -v npm >/dev/null || fail "npm is required"
command -v sha256sum >/dev/null || fail "sha256sum is required"
command -v systemd-run >/dev/null || fail "systemd-run is required"
command -v curl >/dev/null || fail "curl is required"
command -v runuser >/dev/null || fail "runuser is required"
command -v ss >/dev/null || fail "ss is required"

exec 9>"/run/lock/ai-lifeos-release.lock"
flock -n 9 || fail "another AI-LifeOS deployment or rollback is running"

[[ -f "${ARCHIVE}" ]] || fail "missing ${ARCHIVE}"
[[ -f "${MANIFEST}" ]] || fail "missing ${MANIFEST}"
[[ -f "${SHARED_ENV_FILE}" ]] || fail "missing server environment file ${SHARED_ENV_FILE}"
id "${SERVICE_USER}" >/dev/null 2>&1 || fail "service user ${SERVICE_USER} does not exist"
id "${DEPLOY_USER}" >/dev/null 2>&1 || fail "deployment user ${DEPLOY_USER} does not exist"
getent group "${DEPLOY_GROUP}" >/dev/null || fail "deployment group ${DEPLOY_GROUP} does not exist"

readarray -t manifest_values < <(
  node - "${MANIFEST}" <<'NODE'
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
cleanup() {
  systemctl stop "${CANDIDATE_UNIT}" >/dev/null 2>&1 || true
  systemctl reset-failed "${CANDIDATE_UNIT}" >/dev/null 2>&1 || true
  rm -rf "${STAGING_RELEASE}"
}
trap cleanup EXIT

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
  npm --prefix "${APP_STAGING}" ci \
  --omit=dev --no-audit --no-fund

chmod -R u=rwX,g=rX,o= "${APP_STAGING}"

mv "${APP_STAGING}" "${FINAL_RELEASE}"
rmdir "${STAGING_RELEASE}"

wait_for_health() {
  local port="$1"
  local attempts=30
  local index
  for ((index = 1; index <= attempts; index += 1)); do
    if curl --fail --silent --show-error --max-time 5 \
      "http://127.0.0.1:${port}${HEALTH_PATH}" >/dev/null; then
      return 0
    fi
    sleep 1
  done
  return 1
}

if ss -H -ltn "sport = :${CANDIDATE_PORT}" | grep -q .; then
  fail "candidate port ${CANDIDATE_PORT} is already in use"
fi

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
  /usr/bin/npm run start -- --hostname 127.0.0.1 --port "${CANDIDATE_PORT}"

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
systemctl restart "${SERVICE_NAME}"

if ! wait_for_health "${PUBLIC_PORT}"; then
  if [[ -n "${OLD_CURRENT}" && -d "${RELEASES}/${OLD_CURRENT}" ]]; then
    ln -s "${RELEASES}/${OLD_CURRENT}" "${ROOT}/current.rollback.$$"
    mv -Tf "${ROOT}/current.rollback.$$" "${ROOT}/current"
    printf '%s\n' "${OLD_CURRENT}" > "${STATE}/current"
    printf '%s\n' "${OLD_PREVIOUS}" > "${STATE}/previous"
    systemctl restart "${SERVICE_NAME}"
    wait_for_health "${PUBLIC_PORT}" || true
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

trap - EXIT
printf 'deployed %s (%s); previous=%s\n' "${RELEASE_ID}" "${TAG}" "${OLD_CURRENT:-none}"
