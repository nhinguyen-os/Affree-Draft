# Sử dụng image Node.js chính thức
FROM node:20-bookworm-slim

# Thiết lập thư mục làm việc
WORKDIR /app

# Sao chép package.json và cài đặt dependencies
COPY package.json ./
RUN npm install

# Cài đặt Playwright Chromium và các thư viện hệ thống cần thiết (bao gồm Xvfb)
RUN npx playwright install chromium --with-deps

# Cài đặt thêm xvfb và xauth (để giả lập display server)
RUN apt-get update && apt-get install -y xvfb xauth && rm -rf /var/lib/apt/lists/*

# Sao chép toàn bộ mã nguồn
COPY server.js agent-llm.js ./
COPY playbooks ./playbooks

# Mở cổng kết nối WebSocket
EXPOSE 8080

# Mặc định chạy ở chế độ headless (không cần display server)
ENV HEADLESS=true

# Chạy thẳng node server.js - Playwright chạy headless nên không cần xvfb-run
# (xvfb-run gây crash silent trong Docker do vấn đề sandbox WSL)
CMD ["node", "server.js"]
