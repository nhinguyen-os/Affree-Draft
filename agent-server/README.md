# AI Agentic Server for Affree

Đây là máy chủ AI Agentic (chạy Linux) để nhận lệnh đặt hàng tự động từ ứng dụng Web Affree, khởi chạy trình duyệt Chromium cô lập bằng Playwright, và truyền phát màn hình đồ họa (Screencast) kèm khả năng nhận điều khiển ngược lại từ người dùng (click chuột, gõ phím).

---

## Kiến trúc & Cách thức hoạt động

1. **Truyền phát màn hình (Screencast)**: Dùng Chrome DevTools Protocol (CDP) — `Page.startScreencast` — để bắt luồng hình ảnh JPEG từ Chromium và truyền qua WebSocket về Canvas phía Client (Next.js).
2. **Nhận điều khiển từ xa**: Click, rê chuột, gõ phím từ Canvas của Web App → JSON qua WebSocket → giả lập lại bằng `page.mouse` / `page.keyboard` của Playwright.
3. **Headless display**: Docker chạy Playwright ở chế độ headless, không cần màn hình vật lý.

---

## Cấu trúc thư mục

```
agent-server/
├── server.js          # Agent đơn — 1 session / 1 tiến trình
├── orchestrator.js    # Gateway — spawn container Docker cho mỗi session
├── agent-llm.js       # Logic AI (Gemini / Claude / Qwen)
├── Dockerfile         # Image Docker cho agent đơn
├── setup.sh           # Cài đặt môi trường lần đầu (build image, npm install)
├── start.sh           # Khởi động Orchestrator cho production / Docker pod
├── start-local.sh     # Khởi động 1 instance đơn để phát triển local
├── playbooks/         # Kịch bản đặt hàng theo từng sàn TMĐT
├── .env.example       # Mẫu biến môi trường
└── package.json
```

---

## Cài đặt lần đầu

Chạy một lần để cài thư viện Node.js và build Docker image:

```bash
cd agent-server
bash setup.sh
```

Script sẽ:
- Kiểm tra Docker đang hoạt động
- Chạy `npm install`
- Build Docker image `affree-agent`

---

## Chạy trên Local (phát triển / debug)

Dùng `start-local.sh` để chạy **1 instance đơn** (`server.js`) trực tiếp, **không cần Docker**:

```bash
# Cách 1 — script trực tiếp
bash start-local.sh

# Cách 2 — npm script
npm run start:local
```

Script tự động:
- Kiểm tra `node_modules`, cài nếu thiếu
- Nhắc copy `.env.example` → `.env` nếu chưa có file cấu hình
- Chạy `server.js` và in địa chỉ kết nối: `ws://localhost:8080`

> **Yêu cầu**: Node.js ≥ 18, file `.env` đã cấu hình API key.

---

## Chạy trên Production / Docker Pod

> 📄 **Xem chi tiết:** Hướng dẫn đầy đủ và các lưu ý cấu hình Reverse Proxy, bảo mật token, và cấp quyền Docker socket tại [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md).

Dùng `start.sh` để khởi động **Orchestrator** — tự động tạo Docker container độc lập cho mỗi session:

```bash
# Cách 1 — script trực tiếp
bash start.sh

# Cách 2 — npm script
npm run start:prod
```

Script sẽ kiểm tra Docker daemon, image `affree-agent`, rồi khởi động `orchestrator.js` bằng `exec` (PID 1) để nhận đúng tín hiệu `SIGTERM` từ Kubernetes/Docker.

### Deploy lên Kubernetes Pod

Nếu Orchestrator chạy **trong** một Pod và cần tạo container Docker trên host, cần mount Docker socket:

```yaml
# deployment.yaml (ví dụ)
volumes:
  - name: docker-sock
    hostPath:
      path: /var/run/docker.sock
containers:
  - name: orchestrator
    image: <your-registry>/affree-orchestrator
    command: ["bash", "start.sh"]
    volumeMounts:
      - name: docker-sock
        mountPath: /var/run/docker.sock
    env:
      - name: NODE_ENV
        value: production
      - name: PORT
        value: "8080"
      - name: DOCKER_IMAGE
        value: affree-agent
```

> ⚠️ Biến `DOCKER_IMAGE` (mặc định: `affree-agent`) phải tồn tại trên Docker daemon của host.

---

## Biến môi trường

Copy `.env.example` và điền giá trị phù hợp:

```bash
cp .env.example .env
```

| Biến              | Mô tả                              | Mặc định               |
|-------------------|------------------------------------|------------------------|
| `PORT`            | Cổng WebSocket server lắng nghe    | `8080`                 |
| `DOCKER_IMAGE`    | Tên image Docker dùng cho agent    | `affree-agent`         |
| `HEADLESS`        | Chạy Chromium ở chế độ headless    | `true`                 |
| `GEMINI_API_KEY`  | API key Gemini                     | —                      |
| `GEMINI_MODEL`    | Model Gemini sử dụng               | `gemini-3.5-flash`     |
| `ANTHROPIC_API_KEY` | API key Anthropic Claude         | —                      |
| `QWEN_API_KEY`    | API key Alibaba Qwen               | —                      |
| `QWEN_MODEL`      | Model Qwen mặc định                | `qwen3.5-flash`        |
| `QWEN_MODELS`     | Danh sách model Qwen tự xoay khi hết quota/credit | `QWEN_MODEL` |
| `QWEN_API_URL`    | Endpoint OpenAI-compatible của Qwen | DashScope mặc định     |

---

## Cơ chế Cô lập Phiên & Đồng thời (Concurrency)

Khi nhiều người dùng đặt hàng cùng lúc, **Orchestrator** (`orchestrator.js`) xử lý như sau:

1. Client kết nối WebSocket tới Orchestrator kèm `sessionId`.
2. Orchestrator tìm cổng host trống (bắt đầu từ `9001`) rồi spawn container:
   ```bash
   docker run -d --rm --name agent-[sessionId] -p 9001:8080 affree-agent
   ```
3. Orchestrator **proxy** lưu lượng WebSocket từ client vào container tương ứng.
4. Khi client ngắt kết nối, container bị `docker stop` và tự xóa (cờ `--rm`).

---

## WebSocket API

### Client → Server

| Loại tin nhắn | Payload | Mô tả |
|---|---|---|
| `navigate` | `{ url }` | Mở URL trong trình duyệt |
| `click` | `{ x, y }` | Click chuột tại tọa độ |
| `move` | `{ x, y }` | Di chuyển chuột |
| `keydown` | `{ key }` | Nhấn phím |
| `keyup` | `{ key }` | Thả phím |
| `type` | `{ text }` | Gõ chuỗi văn bản |
| `run_order` | xem bên dưới | Chạy kịch bản đặt hàng tự động |

**Payload `run_order`:**
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

### Server → Client

| Loại tin nhắn | Payload | Mô tả |
|---|---|---|
| `screencast` | `{ data, width, height }` | Khung hình base64 JPEG |
| `log` | `{ message, status }` | Log hoạt động (`info` / `success` / `warning` / `error`) |
| `status` | `{ phase }` | Trạng thái (`running` / `waiting_user_input` / `completed` / `failed`) |
