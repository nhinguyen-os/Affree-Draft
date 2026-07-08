#!/usr/bin/env bash
# start-local.sh — Chạy một instance agent đơn (server.js) trực tiếp trên máy local.
#
# Script này KHÔNG dùng Docker hay Orchestrator. Nó chạy thẳng server.js,
# phù hợp để phát triển, debug, hoặc test nhanh một session duy nhất.
#
# Yêu cầu:
#   - Node.js đã được cài đặt
#   - Playwright đã được cài đặt (npx playwright install chromium)
#   - File .env hoặc biến môi trường đã cấu hình (API key, v.v.)
#
# Quy định: Logs tiếng Việt.

set -euo pipefail

# Di chuyển vào thư mục chứa script này
cd "$(dirname "$0")"

echo "=========================================================="
echo "▶ Affree AI Agentic — Local Single Instance (server.js)"
echo "=========================================================="

# --- 1. Kiểm tra Node.js ---
if ! command -v node &> /dev/null; then
  echo "✗ LỖI: Không tìm thấy Node.js. Vui lòng cài đặt Node.js (>= 18)." >&2
  exit 1
fi
echo "✓ Node.js: $(node --version)"

# --- 2. Kiểm tra node_modules ---
if [ ! -d "node_modules" ]; then
  echo "⚠ Chưa cài đặt thư viện. Đang chạy npm install..."
  npm install
  echo "✓ Đã cài đặt thư viện."
fi

# --- 3. Kiểm tra Playwright browsers ---
# Playwright cần browser binaries. Nếu chưa có, tự động install.
if ! node -e "require('playwright')" &> /dev/null; then
  echo "⚠ Playwright chưa được cài đặt đúng. Đang chạy npm install..."
  npm install
fi

PLAYWRIGHT_BROWSERS_PATH=$(node -e "try { const {chromium} = require('playwright'); console.log('ok'); } catch(e) { console.log('missing'); }" 2>/dev/null || true)
if [ "$PLAYWRIGHT_BROWSERS_PATH" = "missing" ]; then
  echo "⚠ Chưa tìm thấy Playwright browsers. Đang cài đặt Chromium..."
  npx playwright install chromium
  echo "✓ Đã cài đặt Chromium."
fi

# --- 4. Kiểm tra file .env ---
if [ ! -f ".env" ]; then
  if [ -f ".env.example" ]; then
    echo ""
    echo "⚠ CẢNH BÁO: Không tìm thấy file .env." >&2
    echo "  → Copy từ .env.example và điền API key của bạn:"
    echo "    cp .env.example .env && nano .env"
    echo ""
  else
    echo "⚠ CẢNH BÁO: Không tìm thấy file .env. Đảm bảo biến môi trường đã được set." >&2
  fi
fi

# --- 5. Hiển thị cấu hình ---
PORT="${PORT:-8080}"
HEADLESS="${HEADLESS:-true}"
echo ""
echo "  Cổng WebSocket : $PORT"
echo "  Headless mode  : $HEADLESS"
echo "  Chế độ         : Local (single instance)"
echo ""
echo "  Để kết nối: ws://localhost:$PORT"
echo ""

# --- 6. Khởi động server ---
echo "▶ Đang khởi động server.js..."
echo "  (Nhấn Ctrl+C để dừng)"
echo "=========================================================="

# Export để server.js đọc được
export PORT
export HEADLESS

node server.js
