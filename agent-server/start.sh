#!/usr/bin/env bash
# start.sh — Khởi động Affree AI Agentic Orchestrator cho môi trường production (Docker pod).
#
# Script này được thiết kế để chạy bên trong một Docker pod/container hoặc
# trên một máy chủ Linux có sẵn Docker. Nó sẽ:
#   1. Kiểm tra các điều kiện cần thiết (Docker, Node.js, file .env, Docker image).
#   2. Khởi động orchestrator.js và forward tín hiệu hệ thống đúng cách (graceful shutdown).
#
# Quy định: Logs tiếng Việt.

set -euo pipefail

# Di chuyển vào thư mục chứa script này
cd "$(dirname "$0")"

echo "=========================================================="
echo "▶ Affree AI Agentic — Orchestrator Start (Production)"
echo "=========================================================="

# --- 1. Kiểm tra Node.js ---
if ! command -v node &> /dev/null; then
  echo "✗ LỖI: Không tìm thấy Node.js. Vui lòng chạy setup.sh trước." >&2
  exit 1
fi
echo "✓ Node.js: $(node --version)"

# --- 2. Kiểm tra Docker ---
if ! command -v docker &> /dev/null; then
  echo "✗ LỖI: Không tìm thấy Docker. Orchestrator cần Docker để tạo các container agent." >&2
  exit 1
fi

if ! docker info &> /dev/null; then
  echo "✗ LỖI: Docker daemon chưa chạy hoặc không có quyền truy cập." >&2
  echo "  → Nếu đang chạy trong Pod, hãy đảm bảo đã mount Docker socket:" >&2
  echo "    volumes: [{name: docker-sock, hostPath: /var/run/docker.sock}]" >&2
  exit 1
fi
echo "✓ Docker: $(docker version --format '{{.Server.Version}}' 2>/dev/null || echo 'OK')"

# --- 3. Kiểm tra Docker image ---
DOCKER_IMAGE="${DOCKER_IMAGE:-affree-agent}"
if ! docker image inspect "$DOCKER_IMAGE" &> /dev/null; then
  echo "✗ LỖI: Docker image '$DOCKER_IMAGE' chưa được build." >&2
  echo "  → Chạy setup.sh trước để build image, hoặc pull từ registry:" >&2
  echo "    docker pull <your-registry>/$DOCKER_IMAGE" >&2
  exit 1
fi
echo "✓ Docker image '$DOCKER_IMAGE' đã sẵn sàng."

# --- 3.1. Kiểm tra image có entrypoint Xvfb thật sự ---
ENTRYPOINT_JSON="$(docker image inspect "$DOCKER_IMAGE" --format '{{json .Config.Entrypoint}}' 2>/dev/null || true)"
if [[ "$ENTRYPOINT_JSON" != *"docker-entrypoint.sh"* ]]; then
  echo "✗ LỖI: Docker image '$DOCKER_IMAGE' không dùng docker-entrypoint.sh." >&2
  echo "  → Đây thường là image cũ hoặc image build sai, dễ gây lỗi Missing X server khi Walmart chạy headed." >&2
  echo "  → Chạy lại: bash setup.sh" >&2
  exit 1
fi

echo "▶ Kiểm tra Xvfb trong image '$DOCKER_IMAGE'..."
if ! docker run --rm "$DOCKER_IMAGE" sh -lc 'test -n "${DISPLAY:-}" && xdpyinfo -display "$DISPLAY" >/dev/null'; then
  echo "✗ LỖI: Image '$DOCKER_IMAGE' không khởi động được Xvfb." >&2
  echo "  → Chạy lại: bash setup.sh" >&2
  exit 1
fi
echo "✓ Xvfb trong image '$DOCKER_IMAGE' hoạt động bình thường."

# --- 4. Kiểm tra node_modules ---
if [ ! -d "node_modules" ]; then
  echo "⚠ Chưa cài đặt thư viện Node.js. Đang chạy npm install..."
  npm install --omit=dev
  echo "✓ Đã cài đặt thư viện."
fi

# --- 5. Kiểm tra file .env ---
if [ ! -f ".env" ]; then
  echo "⚠ CẢNH BÁO: Không tìm thấy file .env trong thư mục agent-server." >&2
  echo "  → Các biến môi trường cần được thiết lập thủ công hoặc qua Kubernetes Secret/ConfigMap."
fi

# --- 6. Hiển thị cấu hình ---
PORT="${PORT:-8080}"
echo ""
echo "  Cổng lắng nghe : $PORT"
echo "  Docker image   : $DOCKER_IMAGE"
echo "  Môi trường     : ${NODE_ENV:-production}"
echo ""

# --- 7. Khởi động Orchestrator ---
echo "▶ Đang khởi động Orchestrator..."
echo "=========================================================="

# Chạy node trực tiếp (foreground) để Docker/Kubernetes có thể quản lý tiến trình.
# Tín hiệu SIGTERM sẽ được truyền thẳng vào Node.js để xử lý graceful shutdown.
exec node orchestrator.js
