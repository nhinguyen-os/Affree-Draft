#!/usr/bin/env bash
# Script cài đặt và cấu hình môi trường chạy nhiều session (orchestrator) cho Affree AI Agentic.
# Quy định: Logs tiếng Việt.

set -euo pipefail

# Di chuyển vào thư mục agent-server của script này
cd "$(dirname "$0")"

echo "=========================================================="
echo "▶ Bắt đầu cấu hình Affree AI Agentic Server Orchestrator..."
echo "=========================================================="

# 1. Kiểm tra Docker
echo "▶ 1. Kiểm tra Docker..."
if ! command -v docker &> /dev/null; then
  echo "✗ LỖI: Không tìm thấy lệnh 'docker'. Vui lòng cài đặt Docker trước khi tiếp tục." >&2
  exit 1
fi

if ! docker info &> /dev/null; then
  echo "✗ LỖI: Docker daemon chưa chạy. Vui lòng khởi động Docker Service (hoặc Docker Desktop)." >&2
  exit 1
fi
echo "✓ Docker đang hoạt động bình thường."

# 2. Cài đặt các thư viện Node.js cần thiết (ví dụ: ws)
echo "▶ 2. Cài đặt thư viện Node.js tại máy host..."
npm install
echo "✓ Đã cài đặt xong thư viện Node.js."

# 3. Build Docker Image cho agent
DOCKER_IMAGE="${DOCKER_IMAGE:-affree-agent}"
echo "▶ 3. Đang xây dựng Docker Image '$DOCKER_IMAGE'..."
docker build -t "$DOCKER_IMAGE" .
echo "✓ Đã xây dựng Docker Image '$DOCKER_IMAGE' thành công."

# 4. Smoke test image: entrypoint phải khởi động được Xvfb trước khi chạy Node/Playwright.
echo "▶ 4. Kiểm tra Docker Image '$DOCKER_IMAGE' có Xvfb/entrypoint sẵn sàng..."
ENTRYPOINT_JSON="$(docker image inspect "$DOCKER_IMAGE" --format '{{json .Config.Entrypoint}}')"
if [[ "$ENTRYPOINT_JSON" != *"docker-entrypoint.sh"* ]]; then
  echo "✗ LỖI: Docker image '$DOCKER_IMAGE' không dùng docker-entrypoint.sh." >&2
  echo "  → Image này có thể bypass Xvfb và gây lỗi Missing X server khi chạy Walmart headed." >&2
  exit 1
fi
docker run --rm "$DOCKER_IMAGE" sh -lc 'test -n "${DISPLAY:-}" && xdpyinfo -display "$DISPLAY" >/dev/null && echo "✓ Xvfb OK tại DISPLAY=$DISPLAY"'
echo "✓ Docker Image '$DOCKER_IMAGE' đã sẵn sàng cho browser headed qua Xvfb."

echo "=========================================================="
echo "✓ CÀI ĐẶT HOÀN TẤT!"
echo "=========================================================="
echo "Để chạy hệ thống ở chế độ hỗ trợ nhiều session (Concurrency):"
echo "  Chạy lệnh: npm run start:orchestrator"
echo "  Hoặc:      node orchestrator.js"
echo ""
echo "Orchestrator sẽ lắng nghe trên cổng 8080. Khi có client kết nối,"
echo "nó sẽ tự động tạo một docker container cô lập cho session đó."
echo "=========================================================="
