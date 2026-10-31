#!/usr/bin/env bash
set -Eeuo pipefail

NODE_VERSION="v24.22.2"
NODE_ARCHIVE_NAME="node-${NODE_VERSION}-linux-x64.tar.xz"
NODE_ARCHIVE_SHA256="48cc0e21e048790e54c0cf5749c2725005313d652651c40b7a21feb9697aaf75"
INSTALL_ROOT="${AIOS_NODE_INSTALL_ROOT:-/opt/ai-lifeos}"
VERSION_ROOT="${INSTALL_ROOT}/node-${NODE_VERSION}-linux-x64"
ACTIVE_ROOT="${INSTALL_ROOT}/node"
DOWNLOAD_URL="https://nodejs.org/dist/${NODE_VERSION}/${NODE_ARCHIVE_NAME}"

fail() {
  printf 'Node.js runtime installation failed: %s\n' "$*" >&2
  exit 1
}

[[ "${EUID}" -eq 0 ]] || fail "run as root"
[[ "${NODE_ARCHIVE_SHA256}" =~ ^[0-9a-f]{64}$ ]] || fail "invalid archive SHA-256"
[[ "${INSTALL_ROOT}" == "/opt/ai-lifeos" ]] \
  || fail "the reviewed runtime root is /opt/ai-lifeos"

command -v curl >/dev/null || fail "curl is required"
command -v sha256sum >/dev/null || fail "sha256sum is required"
command -v tar >/dev/null || fail "tar with xz support is required"

install -d -o root -g root -m 0755 "${INSTALL_ROOT}"
TEMP_ROOT="$(mktemp -d)"
cleanup() {
  rm -rf "${TEMP_ROOT}"
}
trap cleanup EXIT

ARCHIVE_PATH="${TEMP_ROOT}/${NODE_ARCHIVE_NAME}"
curl --fail --location --silent --show-error --proto '=https' --tlsv1.2 \
  --output "${ARCHIVE_PATH}" \
  "${DOWNLOAD_URL}"
printf '%s  %s\n' "${NODE_ARCHIVE_SHA256}" "${ARCHIVE_PATH}" | sha256sum --check --status \
  || fail "official Node.js archive checksum mismatch"

if [[ ! -d "${VERSION_ROOT}" ]]; then
  tar -xJf "${ARCHIVE_PATH}" -C "${TEMP_ROOT}"
  EXTRACTED_ROOT="${TEMP_ROOT}/node-${NODE_VERSION}-linux-x64"
  [[ -x "${EXTRACTED_ROOT}/bin/node" ]] || fail "archive is missing the Node.js executable"
  [[ -r "${EXTRACTED_ROOT}/lib/node_modules/npm/bin/npm-cli.js" ]] \
    || fail "archive is missing the npm CLI"
  mv "${EXTRACTED_ROOT}" "${VERSION_ROOT}"
fi

chown -R root:root "${VERSION_ROOT}"
chmod -R go-w "${VERSION_ROOT}"
find "${VERSION_ROOT}" -type d -exec chmod a+rx {} +
ln -sfn "${VERSION_ROOT}" "${ACTIVE_ROOT}.next"
mv -Tf "${ACTIVE_ROOT}.next" "${ACTIVE_ROOT}"

NODE_BIN="${ACTIVE_ROOT}/bin/node"
NPM_CLI="${ACTIVE_ROOT}/lib/node_modules/npm/bin/npm-cli.js"
[[ "$("${NODE_BIN}" --version)" == "${NODE_VERSION}" ]] || fail "installed Node.js version mismatch"
"${NODE_BIN}" "${NPM_CLI}" --version >/dev/null

printf 'installed Node.js %s at %s\n' "${NODE_VERSION}" "${ACTIVE_ROOT}"
