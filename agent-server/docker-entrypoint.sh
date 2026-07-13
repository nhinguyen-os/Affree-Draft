#!/bin/sh
set -eu

DISPLAY_NUMBER="${XVFB_DISPLAY_NUMBER:-99}"
export DISPLAY=":${DISPLAY_NUMBER}"

echo "[Container] Đang khởi động Xvfb tại DISPLAY=${DISPLAY}..."
Xvfb "${DISPLAY}" \
  -screen 0 "${XVFB_SCREEN:-1920x1080x24}" \
  -nolisten tcp \
  -ac &
XVFB_PID=$!

cleanup() {
  kill "${XVFB_PID}" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

attempt=0
until xdpyinfo -display "${DISPLAY}" >/dev/null 2>&1; do
  attempt=$((attempt + 1))
  if [ "${attempt}" -ge 50 ]; then
    echo "[Container] LỖI: Xvfb không sẵn sàng tại ${DISPLAY}." >&2
    exit 1
  fi
  sleep 0.1
done

echo "[Container] Xvfb đã sẵn sàng. Khởi động agent-server với Chrome headed support."
if [ "$#" -gt 0 ]; then
  exec "$@"
fi
exec node server.js
