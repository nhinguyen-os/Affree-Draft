# Sử dụng image Node.js chính thức
FROM node:20-bookworm-slim

# Thiết lập thư mục làm việc
WORKDIR /app

# Sao chép package.json và cài đặt dependencies
COPY package.json ./
RUN npm install

# Cài đặt Playwright Chromium và các thư viện hệ thống cần thiết (bao gồm Xvfb)
RUN npx playwright install chromium --with-deps

# Cài đặt thêm xvfb (để giả lập display server)
RUN apt-get update && apt-get install -y xvfb && rm -rf /var/lib/apt/lists/*

# Sao chép toàn bộ mã nguồn
COPY server.js ./

# Mở cổng kết nối WebSocket
EXPOSE 8080

# Chạy server thông qua xvfb-run để hỗ trợ khởi động trình duyệt có đồ họa trên Linux Headless (không màn hình)
CMD ["xvfb-run", "--server-args=-screen 0 1024x768x24 -ac", "node", "server.js"]
