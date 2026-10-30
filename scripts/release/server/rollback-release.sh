#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="${AIOS_ROOT:-/srv/ai-lifeos}"
CONFIG_FILE="${AIOS_DEPLOY_CONFIG:-/etc/ai-lifeos/deploy.conf}"
if [[ -r "${CONFIG_FILE}" ]]; then
  # shellcheck disable=SC1090
  source "${CONFIG_FILE}"
fi

SERVICE_NAME="${AIOS_SERVICE_NAME:-ai-lifeos.service}"
PUBLIC_PORT="${AIOS_PUBLIC_PORT:-3000}"
HEALTH_PATH="${AIOS_HEALTH_PATH:-/}"
RELEASES="${ROOT}/releases"
STATE="${ROOT}/state"

fail() {
  printf 'rollback failed: %s\n' "$*" >&2
  exit 1
}

[[ "${EUID}" -eq 0 ]] || fail "run as root"
command -v flock >/dev/null || fail "flock is required"
command -v curl >/dev/null || fail "curl is required"

exec 9>"/run/lock/ai-lifeos-release.lock"
flock -n 9 || fail "another AI-LifeOS deployment or rollback is running"

[[ -L "${ROOT}/current" ]] || fail "current release symlink is missing"
[[ -f "${STATE}/previous" ]] || fail "no previous release is recorded"

CURRENT_ID="$(basename "$(readlink -f "${ROOT}/current")")"
PREVIOUS_ID="$(<"${STATE}/previous")"
[[ -n "${PREVIOUS_ID}" ]] || fail "previous release ID is empty"
[[ -d "${RELEASES}/${PREVIOUS_ID}" ]] || fail "previous release directory does not exist"
[[ -f "${RELEASES}/${PREVIOUS_ID}/release.env" ]] || fail "previous release metadata is incomplete"

wait_for_health() {
  local attempts=30
  local index
  for ((index = 1; index <= attempts; index += 1)); do
    if systemctl is-active --quiet "${SERVICE_NAME}" \
      && curl --fail --silent --show-error --max-time 5 \
      "http://127.0.0.1:${PUBLIC_PORT}${HEALTH_PATH}" >/dev/null; then
      return 0
    fi
    sleep 1
  done
  return 1
}

ln -s "${RELEASES}/${PREVIOUS_ID}" "${ROOT}/current.rollback.$$"
mv -Tf "${ROOT}/current.rollback.$$" "${ROOT}/current"
systemctl restart "${SERVICE_NAME}"

if ! wait_for_health; then
  ln -s "${RELEASES}/${CURRENT_ID}" "${ROOT}/current.restore.$$"
  mv -Tf "${ROOT}/current.restore.$$" "${ROOT}/current"
  systemctl restart "${SERVICE_NAME}"
  wait_for_health || true
  fail "previous release failed health checks; original release was restored"
fi

printf '%s\n' "${PREVIOUS_ID}" > "${STATE}/current"
printf '%s\n' "${CURRENT_ID}" > "${STATE}/previous"
chmod 0644 "${STATE}/current" "${STATE}/previous"
ln -s "${RELEASES}/${CURRENT_ID}" "${ROOT}/previous.rollback.$$"
mv -Tf "${ROOT}/previous.rollback.$$" "${ROOT}/previous"

printf 'rolled back from %s to %s\n' "${CURRENT_ID}" "${PREVIOUS_ID}"
