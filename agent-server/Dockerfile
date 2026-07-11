# Sử dụng image Node.js chính thức
FROM node:20-bookworm-slim

# Thiết lập thư mục làm việc
WORKDIR /app

# Sao chép package.json và cài đặt dependencies
COPY package.json ./
RUN npm install

# Cài đặt Playwright Chromium và các thư viện hệ thống cần thiết (bao gồm Xvfb)
RUN npx playwright install chromium --with-deps

# Google Chrome Linux chỉ được Playwright cung cấp trên amd64. Trên arm64
# (Apple Silicon/Docker ARM) dùng Chromium bundled, vẫn chạy headed trong Xvfb.
RUN if [ "$(dpkg --print-architecture)" = "amd64" ]; then \
      npx playwright install chrome --with-deps; \
    else \
      echo "Google Chrome không hỗ trợ architecture này; dùng Playwright Chromium headed."; \
    fi

# Cài đặt thêm xvfb và xauth (để giả lập display server, cần cho chế độ headed)
# libgl1/libegl1/libvulkan1: cần để nạp driver Mesa D3D12 khi container được
# mount /dev/dxg + /usr/lib/wsl (GPU passthrough WSL2, xem orchestrator.js).
# Không có các lib loader này thì dù có mount GPU, Chrome vẫn rơi về
# software rendering (SwiftShader) như cũ.
RUN apt-get update && apt-get install -y xvfb xauth x11-utils libgl1 libegl1 libvulkan1 && rm -rf /var/lib/apt/lists/*

# Playwright --with-deps chỉ cài bộ font tối thiểu (~51 font: freefont,
# liberation, noto-color-emoji, japanese-gothic) trong khi máy host thật có
# hàng nghìn font (Noto đầy đủ...). Canvas fingerprint (dùng để render text)
# phụ thuộc trực tiếp vào bộ font cài sẵn — đã đo được hash Canvas khác nhau
# rõ rệt giữa container và local dù cùng WebGL renderer/timezone, đây là một
# tín hiệu "thiết bị nghèo font" điển hình của môi trường server/bot mà các
# hệ thống chống bot như PerimeterX (Walmart "nhấn và giữ") có thể dùng để
# chấm điểm rủi ro. Cài thêm bộ font Noto đầy đủ + Liberation + DejaVu để
# canvas render gần với một máy desktop thật hơn.
RUN apt-get update && apt-get install -y fonts-noto-core fonts-noto-color-emoji fonts-liberation fonts-dejavu-core && rm -rf /var/lib/apt/lists/*

# Sao chép toàn bộ module JavaScript runtime. server.js/agent-llm.js require nhiều
# module cùng thư mục; chỉ copy hai file entrypoint sẽ làm container crash lúc boot.
COPY *.js ./
COPY docker-entrypoint.sh ./docker-entrypoint.sh
COPY playbooks ./playbooks
COPY skills ./skills
RUN chmod +x ./docker-entrypoint.sh

# Mở cổng kết nối WebSocket
EXPOSE 8080

# Node là PID chính; healthcheck này xác nhận display headed vẫn còn hoạt động.
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD xdpyinfo -display "${DISPLAY:-:99}" >/dev/null 2>&1 || exit 1

# Mặc định chạy ở chế độ headless (không cần display server)
ENV HEADLESS=true

# Entry point tự khởi động Xvfb, đợi display thật sự ready bằng xdpyinfo rồi
# mới chạy Node. Dùng ENTRYPOINT để production/K8s/Docker Compose không vô tình
# bypass Xvfb khi override command/args.
ENTRYPOINT ["./docker-entrypoint.sh"]
