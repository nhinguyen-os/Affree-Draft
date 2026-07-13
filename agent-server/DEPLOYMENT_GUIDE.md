# HƯỚNG DẪN DEPLOY PRODUCTION — AFFREE AI AGENTIC SERVER

Tài liệu này hướng dẫn chi tiết cho DevOps cách cấu hình, xây dựng và triển khai **agent-server** (bao gồm Gateway Orchestrator và các container Playwright cô lập) để tích hợp với Web App Affree đang chạy tại `https://affree.timdaythay.com/`.

---

## 1. Kiến trúc tích hợp giữa Web App & Agent Server

Hệ thống hoạt động theo mô hình lai (Hybrid) gồm kết nối từ Backend và kết nối trực tiếp từ trình duyệt Client:

```
+-------------------------------------------------------+
|                 User Browser (Client)                 |
|             (https://affree.timdaythay.com)           |
+---------------------------+---------------------------+
                            |
                            | (3) Direct WebSocket Connect (wss://)
                            | Stream Screencast & Mouse/Keyboard Events
                            v
+-------------------------------------------------------+
|               Reverse Proxy (Nginx/SSL)               |
|            - Port 443 (wss://) -> Port 8080 (ws://)    |
+---------------------------+---------------------------+
                            |
                            | (Forward WS)
                            v
+-------------------------------------------------------+
|               Orchestrator Gateway                    |
|           (Node.js server - Port 8080)                |
+-------------------+-------------------+---------------+
                    |                   |
 (1) Create Session |                   | (4) Proxy WebSocket
 (ws:// from NextJS)|                   | Traffic
                    v                   v
+-------------------+---+       +-------+---------------+
| Next.js Server        |       | Docker Container Agent|
| (Backend App)         |       |   (affree-agent)      |
+-----------------------+       +-----------------------+
```

### Các luồng kết nối chính:
1. **Kết nối từ Server-to-Server (Next.js Backend ➔ Orchestrator)**:
   - Khi đơn hàng được tạo, Next.js server kết nối trực tiếp tới Orchestrator qua WebSocket để kích hoạt phiên làm việc (Session).
   - Sử dụng biến môi trường bảo mật `ORDER_AGENT_SERVER_SECRET_TOKEN` để ký mã HMAC SHA256 xác thực kết nối.
2. **Kết nối trực tiếp từ Browser Client (Browser User ➔ Orchestrator)**:
   - Khi người dùng đặt hàng bằng kịch bản tự động (như Bách Hóa Xanh), hoặc khi dùng tính năng trợ giúp trình duyệt (Coop Browser Assist), trình duyệt của người dùng sẽ **kết nối WebSocket trực tiếp** tới Agent Server.
   - Kết nối này dùng để stream luồng hình ảnh JPEG màn hình trình duyệt của Agent (`screencast`) và gửi ngược lại các sự kiện click chuột, gõ phím của người dùng.
   - **⚠️ YÊU CẦU BẮT BUỘC (HTTPS/WSS)**: Vì Web App chạy trên HTTPS (`https://affree.timdaythay.com/`), trình duyệt sẽ chặn hoàn toàn các kết nối WebSocket không mã hoá (`ws://`). Do đó, **Agent Server bắt buộc phải được expose ra Internet qua giao thức bảo mật `wss://` (WebSocket Secure)**.

---

## 2. Các yêu cầu về hạ tầng & mạng (Network & Infrastructure)

Để hệ thống hoạt động bình thường, DevOps cần cấu hình các thành phần sau:

1. **Domain & SSL**:
   - Cần cấp một subdomain cho agent-server, ví dụ: `https://agent-server.timdaythay.com/` (hoặc cấu hình routing path phù hợp).
   - Cần cấu hình SSL/TLS certificate (ví dụ Let's Encrypt).
2. **Cấu hình Reverse Proxy (Nginx / Ingress / Cloudflare)**:
   - Proxy chịu trách nhiệm lắng nghe cổng HTTPS (`443`), giải mã SSL (SSL Termination) và chuyển tiếp kết nối dưới dạng HTTP/WebSocket không mã hoá (`ws://127.0.0.1:8080`) vào Orchestrator.
   - **Ví dụ cấu hình Nginx**:
     ```nginx
     server {
         listen 443 ssl;
         server_name agent-server.timdaythay.com;

         ssl_certificate /etc/letsencrypt/live/agent-server.timdaythay.com/fullchain.pem;
         ssl_certificate_key /etc/letsencrypt/live/agent-server.timdaythay.com/privkey.pem;

         location / {
             proxy_pass http://127.0.0.1:8080; # Cổng chạy Orchestrator
             proxy_http_version 1.1;
             proxy_set_header Upgrade $http_upgrade;
             proxy_set_header Connection "Upgrade";
             proxy_set_header Host $host;
             proxy_set_header X-Real-IP $remote_addr;
             proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
             proxy_set_header X-Forwarded-Proto $scheme;
             
             # WebSocket timeouts quan trọng
             proxy_read_timeout 600s;
             proxy_send_timeout 600s;
         }
     }
     ```

---

## 3. Các bước deploy & build lần đầu trên Server

### Bước 1: Clone source code & cài đặt môi trường máy chủ
Đảm bảo máy chủ cài đặt đầy đủ:
- **Node.js**: Phiên bản `>= 18`
- **Docker Engine**: Đang hoạt động và chạy bình thường.

### Bước 2: Build Docker Image cho Agent
Trong thư mục chứa source code, di chuyển vào `agent-server` và chạy script thiết lập:
```bash
cd agent-server
bash setup.sh
```
*Script này sẽ thực hiện:*
- Kiểm tra kết nối với Docker daemon.
- Chạy `npm install` để cài thư viện cho Orchestrator trên host.
- Build Docker Image với tag `affree-agent` dựa trên file `Dockerfile` có sẵn (chứa môi trường Chromium/Playwright cô lập).

### Bước 3: Cấu hình biến môi trường
Tạo file cấu hình `.env` cho `agent-server`:
```bash
cp .env.example .env
```
Cập nhật các giá trị cấu hình phù hợp với môi trường Production:
```ini
PORT=8080
DOCKER_IMAGE=affree-agent
HEADLESS=true

# Khóa bí mật dùng để ký token bảo mật (phải khớp hoàn toàn với config phía Web App)
ORDER_AGENT_SERVER_SECRET_TOKEN=thay_the_bang_token_ngau_nhien_bao_mat_cua_ban

# Các API Key kết nối với LLM để xử lý kịch bản AI
GEMINI_API_KEY=your_gemini_api_key
GEMINI_MODEL=gemini-3.5-flash
# ANTHROPIC_API_KEY=...
# QWEN_API_KEY=...
```

### Bước 4: Chạy Orchestrator ở chế độ Production
Chạy lệnh khởi động:
```bash
bash start.sh
```
*(Hoặc dùng lệnh npm script: `npm run start:prod`)*

Script sẽ khởi động tiến trình Node.js chạy `orchestrator.js` ở chế độ foreground giúp các công cụ quản lý process (như PM2, Systemd) hoặc Docker/Kubernetes nhận biết và quản lý vòng đời đúng cách (bao gồm nhận tín hiệu `SIGTERM` để tắt container an toàn).

---

## 4. Ghi chú vô cùng quan trọng đối với DevOps (Crucial DevOps Notes)

### 🚨 Quyền hạn Docker Socket (Docker Socket Permission)
Khi Orchestrator chạy, nó sẽ tự động điều khiển Docker Engine trên host để spawn các container con (`docker run -d --rm --name agent-[sessionId] ...`) phục vụ cho từng phiên đặt hàng độc lập của khách hàng.

* **Nếu chạy Orchestrator trực tiếp trên máy chủ vật lý / VM**:
  Tài khoản Linux thực thi lệnh `bash start.sh` phải thuộc group `docker` để có quyền ghi đọc `/var/run/docker.sock` mà không cần quyền `sudo`.
  ```bash
  sudo usermod -aG docker $USER
  # Đăng nhập lại session shell để cập nhật quyền
  ```

* **Nếu chạy Orchestrator bên trong một Container khác (hoặc Kubernetes Pod)**:
  Phải mount Docker socket của máy host vào bên trong container chạy Orchestrator:
  * **Chạy docker CLI**: `-v /var/run/docker.sock:/var/run/docker.sock`
  * **Cấu hình Kubernetes YAML**:
    ```yaml
    volumes:
      - name: docker-sock
        hostPath:
          path: /var/run/docker.sock
    containers:
      - name: orchestrator
        image: <your-registry>/affree-orchestrator
        volumeMounts:
          - name: docker-sock
            mountPath: /var/run/docker.sock
    ```

### 🔐 Cấu hình phía Web App (Next.js)
Để Web App có thể kết nối với Agent Server, DevOps cần khai báo 2 biến môi trường sau trong cấu hình build/chạy của Next.js:
1. `NEXT_PUBLIC_ORDER_AGENT_SERVER_URL`: Địa chỉ public WebSocket của Agent Server (phải dùng giao thức `wss://`).
   * Ví dụ: `NEXT_PUBLIC_ORDER_AGENT_SERVER_URL=wss://agent-server.timdaythay.com`
2. `ORDER_AGENT_SERVER_SECRET_TOKEN`: Khóa bảo mật trùng khớp với khóa đã cấu hình ở bước 3 trên Agent Server.
   * Ví dụ: `ORDER_AGENT_SERVER_SECRET_TOKEN=thay_the_bang_token_ngau_nhien_bao_mat_cua_ban`
