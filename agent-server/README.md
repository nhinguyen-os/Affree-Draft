# AI Agent Server for Affree

Đây là mã nguồn phía máy chủ AI Agentic (chạy Linux) để nhận lệnh đặt hàng tự động từ ứng dụng Web Affree, khởi chạy trình duyệt Chromium cô lập bằng Playwright, và truyền phát màn hình đồ họa (Screencast) kèm theo khả năng nhận điều khiển (click chuột, gõ phím) ngược lại từ người dùng.

## Kiến trúc & Cách thức hoạt động

1. **Truyền phát màn hình (Screencast)**: Sử dụng giao thức Chrome DevTools Protocol (CDP) thông qua hàm `Page.startScreencast` để bắt luồng hình ảnh JPEG nén từ Chromium và truyền phát trực tiếp qua WebSocket về Canvas phía Client (Next.js).
2. **Nhận điều khiển từ xa (Remote Input Control)**: Người dùng có thể click chuột, rê chuột hoặc gõ phím trực tiếp lên khung Canvas của Next.js Web App. Sự kiện này được chuyển thành tin nhắn JSON gửi qua WebSocket và giả lập lại bằng API `page.mouse` và `page.keyboard` của Playwright.
3. **Môi trường ảo (Headless display)**: Trên máy chủ Linux không có màn hình vật lý (VPS/Server), Docker sử dụng `xvfb-run` để tạo ra một máy chủ đồ họa ảo trong bộ nhớ (virtual framebuffer). Playwright sẽ khởi chạy Chromium đồ họa kết nối vào màn hình ảo này, giúp hỗ trợ tốt mọi trang thương mại điện tử chống bot hoặc yêu cầu xử lý đồ họa nâng cao.

---

## Hướng dẫn cài đặt & Chạy cục bộ (Local Run)

Để chạy thử nghiệm trực tiếp trên máy của bạn (không qua Docker):

1. **Cài đặt thư viện**:
   ```bash
   cd agent-server
   npm install
   npx playwright install chromium
   ```

2. **Khởi chạy Server**:
   ```bash
   node server.js
   ```
   Server sẽ lắng nghe trên cổng `8080` (hoặc cấu hình cổng thông qua biến môi trường `PORT`).

---

## Đóng gói bằng Docker (Khuyên dùng cho Production)

### 1. Build Docker Image
Chạy lệnh sau tại thư mục `agent-server`:
```bash
docker build -t affree-agent .
```

### 2. Khởi chạy một Container
Khởi chạy thử nghiệm một phiên kết nối tại cổng `8080` của host:
```bash
docker run -d --name my-agent -p 8080:8080 affree-agent
```

---

## Cơ chế Cô lập Phiên & Hỗ trợ Nhiều Người dùng Đồng thời (Concurrency)

Để hỗ trợ hàng trăm người dùng cùng đặt hàng đồng thời, hệ thống Next.js Orchestrator (Backend) sẽ sinh container động trên mỗi yêu cầu:

1. **Khởi chạy container động**: Khi user bấm đặt hàng, Next.js server sẽ kết nối tới Docker Daemon (ở máy Linux) để kích hoạt container mới cho session đó:
   ```bash
   # Gán một cổng ngẫu nhiên khả dụng trên host (ví dụ: 9001)
   docker run -d --rm --name agent-[session-id] -p 9001:8080 affree-agent
   ```
2. **Proxy WebSocket**: Next.js hoặc một Gateway (như Nginx/Traefik) sẽ nhận diện đường dẫn `/ws/agent/[session-id]` và proxy ngược vào cổng tương ứng (`9001`) của Container đó.
3. **Tự hủy để tiết kiệm tài nguyên**:
   * Cờ `--rm` đảm bảo container sẽ bị xóa sạch khỏi đĩa cứng sau khi dừng.
   * Khi client ngắt kết nối WebSocket (do hoàn tất đặt hàng hoặc tắt trình duyệt), node server của container sẽ gọi dọn dẹp tài nguyên (`cleanup()`). Chúng ta có thể cấu hình thêm để container tự động thoát (`process.exit(0)`) khi client đóng kết nối, từ đó kích hoạt Docker tự hủy container.

---

## Các lệnh giao tiếp qua WebSocket (JSON)

### Client gửi lên Server:
* **Mở trang**: `{"type": "navigate", "url": "https://..."}`
* **Click chuột**: `{"type": "click", "x": 100, "y": 200}`
* **Di chuyển chuột**: `{"type": "move", "x": 100, "y": 200}`
* **Nhấn phím xuống**: `{"type": "keydown", "key": "Enter"}`
* **Thả phím**: `{"type": "keyup", "key": "Enter"}`
* **Gõ một chuỗi văn bản**: `{"type": "type", "text": "Họ và tên..."}`
* **Đặt hàng tự động**: 
  ```json
  {
    "type": "run_order",
    "payload": {
      "url": "https://...",
      "productName": "Sữa bỉm...",
      "qty": 2,
      "buyerName": "Nguyễn Văn A",
      "buyerPhone": "0912345678",
      "buyerAddress": "123 Đường ABC...",
      "chain": "concung"
    }
  }
  ```

### Server gửi về Client:
* **Khung hình màn hình**: `{"type": "screencast", "data": "base64...", "width": 1024, "height": 768}`
* **Log hoạt động**: `{"type": "log", "message": "Đang điền địa chỉ...", "status": "info"|"success"|"warning"|"error"}`
* **Trạng thái quy trình**: `{"type": "status", "phase": "running"|"waiting_user_input"|"completed"|"failed"}`
