/**
 * Affree AI Agentic Orchestrator Gateway
 * Listens on port 8080 (or PORT) and spawns a Docker container dynamically
 * for each incoming WebSocket connection (using sessionId).
 * 
 * Comments and logs in Vietnamese.
 */

const fs = require("fs");
const path = require("path");
const net = require("net");
const crypto = require("crypto");
const { exec, execFile } = require("child_process");
const WebSocket = require("ws");

// Load cấu hình từ file .env
function loadEnvFile(envPath) {
  try {
    if (fs.existsSync(envPath)) {
      const envConfig = fs.readFileSync(envPath, "utf-8");
      envConfig.split("\n").forEach((line) => {
        const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
        if (match) {
          const key = match[1];
          let value = match[2] || "";
          if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
          if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
          if (!process.env[key]) process.env[key] = value.trim();
        }
      });
      console.log(`[Orchestrator] Đã tải cấu hình từ: ${envPath}`);
    }
  } catch (e) {
    console.log(`[Orchestrator] Không đọc được ${envPath}:`, e.message);
  }
}

// Tải từ cả thư mục agent-server và thư mục gốc của dự án
loadEnvFile(path.join(__dirname, ".env"));
loadEnvFile(path.join(__dirname, "..", ".env"));

const PORT = process.env.PORT || 8080;
const wss = new WebSocket.Server({ port: PORT });

console.log(`[Orchestrator] Cổng chính đang lắng nghe tại: ${PORT}...`);

// Các cổng đã được "giữ chỗ" cho một session khác nhưng container có thể
// chưa kịp bind xong (docker run chạy bất đồng bộ). Không dùng Set này thì
// 2 kết nối đến gần nhau sẽ cùng thấy một cổng "trống" (do lúc kiểm tra
// server test đã đóng lại ngay) rồi cùng chọn nó, gây lỗi "port is already
// allocated" ở lần docker run thứ hai.
const reservedPorts = new Set();

// Hàm tìm cổng trống khả dụng trên host bắt đầu từ port 9000
function getFreePort(startPort = 9001) {
  return new Promise((resolve) => {
    function checkPort(port) {
      if (reservedPorts.has(port)) {
        checkPort(port + 1);
        return;
      }
      const server = net.createServer();
      server.once("error", () => {
        // Cổng đã bận, kiểm tra cổng tiếp theo
        checkPort(port + 1);
      });
      server.once("listening", () => {
        server.close(() => {
          resolve(port);
        });
      });
      // Docker publish cổng trên mọi interface; kiểm tra cùng phạm vi để không
      // chọn nhầm cổng đang bị Docker chiếm nhưng 127.0.0.1 vẫn báo trống.
      server.listen(port, "0.0.0.0");
    }
    checkPort(startPort);
  });
}

// Hàm kiểm tra khi nào cổng của container sẵn sàng kết nối
function waitPortReady(port, timeoutMs = 25000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    function check() {
      const socket = new net.Socket();
      socket.setTimeout(400);
      socket.on("connect", () => {
        socket.destroy();
        resolve();
      });
      socket.on("error", () => {
        socket.destroy();
        if (Date.now() - start > timeoutMs) {
          reject(new Error(`Hết thời gian chờ cổng container: ${port}`));
        } else {
          setTimeout(check, 250);
        }
      });
      socket.connect(port, "127.0.0.1");
    }
    check();
  });
}

wss.on("connection", async (clientWs, req) => {
  const connectionUrl = new URL(req.url || "/", `ws://localhost:${PORT}`);
  const sessionIdRaw = connectionUrl.searchParams.get("sessionId");
  const tokenRaw = connectionUrl.searchParams.get("token");
  const timestampRaw = connectionUrl.searchParams.get("timestamp");
  const chainRaw = connectionUrl.searchParams.get("chain");

  // Kiểm tra token bảo mật bằng HMAC SHA256 nếu cấu hình ORDER_AGENT_SERVER_SECRET_TOKEN tồn tại
  const secretToken = process.env.ORDER_AGENT_SERVER_SECRET_TOKEN;
  if (secretToken && secretToken.trim() !== "") {
    if (!tokenRaw || !timestampRaw || !sessionIdRaw) {
      console.warn(`[Orchestrator] Từ chối kết nối do thiếu tham số bảo mật (sessionId, timestamp, token).`);
      try {
        clientWs.send(JSON.stringify({
          type: "log",
          message: "Lỗi bảo mật: Thiếu thông tin xác thực.",
          status: "error"
        }));
      } catch (err) { }
      clientWs.close(4001, "Unauthorized");
      return;
    }

    // 1. Kiểm tra thời gian hết hạn của token (giới hạn 5 phút = 300,000ms để chống replay attack)
    const timeDiff = Math.abs(Date.now() - Number(timestampRaw));
    if (isNaN(timeDiff) || timeDiff > 5 * 60 * 1000) {
      console.warn(`[Orchestrator] Từ chối kết nối do token đã hết hạn (chênh lệch: ${timeDiff}ms).`);
      try {
        clientWs.send(JSON.stringify({
          type: "log",
          message: "Lỗi bảo mật: Phiên làm việc đã hết hạn. Vui lòng thử lại.",
          status: "error"
        }));
      } catch (err) { }
      clientWs.close(4001, "Token Expired");
      return;
    }

    // 2. Kiểm tra chữ ký HMAC
    const hmac = crypto.createHmac("sha256", secretToken);
    hmac.update(`${sessionIdRaw}:${timestampRaw}`);
    const expectedSignature = hmac.digest("hex");

    if (tokenRaw !== expectedSignature) {
      console.warn(`[Orchestrator] Từ chối kết nối do chữ ký token không chính xác.`);
      try {
        clientWs.send(JSON.stringify({
          type: "log",
          message: "Lỗi bảo mật: Token không hợp lệ.",
          status: "error"
        }));
      } catch (err) { }
      clientWs.close(4001, "Unauthorized");
      return;
    }
  }

  // Tạo hoặc lấy session ID hợp lệ
  const sessionId = (sessionIdRaw || `sess-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`)
    .replace(/[^a-zA-Z0-9_-]/g, ""); // Dọn các kí tự đặc biệt để an toàn khi đặt tên container

  const containerName = `agent-${sessionId}`;
  // Client thường gửi lệnh đầu tiên ngay khi WebSocket public vừa mở, trong khi
  // worker Docker cần vài giây để boot. Giữ lệnh trong hàng đợi, nếu không lệnh
  // coop_payment_qr_snapshot sẽ bị mất trước khi proxy được gắn.
  const pendingClientMessages = [];
  let targetWs = null;
  clientWs.on("message", (data, isBinary) => {
    if (targetWs?.readyState === WebSocket.OPEN) {
      targetWs.send(data, { binary: isBinary });
      return;
    }
    pendingClientMessages.push({ data: Buffer.from(data), isBinary });
  });
  console.log(`[Orchestrator] Nhận yêu cầu kết nối hợp lệ. SessionID: ${sessionId}`);

  // Tìm cổng trống
  const hostPort = await getFreePort();
  reservedPorts.add(hostPort); // Giữ chỗ ngay lập tức, giải phóng ở cleanupDocker/lỗi launch
  console.log(`[Orchestrator] Đã tìm thấy cổng trống cho session: ${hostPort}`);

  // Chuẩn bị biến môi trường để truyền qua container docker
  const passthroughEnvs = [
    "GEMINI_API_KEY",
    "GEMINI_MODEL",
    "GEMINI_SKILL_MODEL",
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_MODEL",
    "QWEN_API_KEY",
    "QWEN_MODEL",
    "QWEN_MODELS",
    "QWEN_API_URL",
    "RUN_TXNN_AGENTIC",
    "HEADLESS",
    // TZ + AGENT_GEO_LAT/LON nên đổi cùng nhau khi đổi region proxy (vd.
    // chuyển sang proxy Mỹ) để tránh lệch timezone-vs-geolocation-vs-IP —
    // xem ghi chú GPU/timezone fingerprint ở Dockerfile.
    "TZ",
    "AGENT_GEO_LAT",
    "AGENT_GEO_LON",
    "ACCOUNT_ORDER_WALMART_URL",
    "ACCOUNT_ORDER_COOP_URL",
    "PROXY_SERVER",
    "PROXY_USERNAME",
    "PROXY_PASSWORD",
    "COSTCO_PROXY_SERVER",
    "COSTCO_PROXY_USERNAME",
    "COSTCO_PROXY_PASSWORD",
    "WALMART_PLAYWRIGHT_SLOW_MO_MS",
    "WALMART_BROWSER_CHANNEL"
  ];

  const dockerImage = process.env.DOCKER_IMAGE || "affree-agent";
  const dockerArgs = ["run", "-d", "--rm", "--init", "--shm-size=1g", "--name", containerName];
  passthroughEnvs.forEach((envName) => {
    if (process.env[envName] !== undefined) dockerArgs.push("-e", envName);
  });

  // Trên WSL2, /dev/dxg là thiết bị GPU ảo hoá (dxgkrnl) mà WSLg dùng để
  // Chrome headed local render bằng driver Mesa D3D12 thay vì rơi về
  // software rendering (SwiftShader/llvmpipe). Container Docker mặc định
  // không có quyền này nên Chrome trong container render bằng software,
  // fingerprint WebGL/GPU khác biệt rõ so với phiên chạy local — nghi vấn
  // chính khiến PerimeterX (bước "nhấn và giữ" của Walmart) luôn fail
  // trong Docker dù thao tác chuột relay giống hệt. Chỉ mount khi host là
  // WSL2 thật (có /dev/dxg); trên VPS Linux production thiết bị này không
  // tồn tại nên bỏ qua, tránh làm docker run lỗi ở môi trường đó.
  if (fs.existsSync("/dev/dxg") && fs.existsSync("/usr/lib/wsl/lib")) {
    dockerArgs.push("--device=/dev/dxg", "-v", "/usr/lib/wsl:/usr/lib/wsl:ro", "-e", "LD_LIBRARY_PATH=/usr/lib/wsl/lib");
    console.log("[Orchestrator] Phát hiện WSL2 (/dev/dxg) - bật GPU passthrough cho container.");
  }

  dockerArgs.push("-e", "EXIT_ON_CLOSE=true", "-p", `127.0.0.1:${hostPort}:8080`, dockerImage);

  console.log(`[Orchestrator] Khởi chạy container: docker run -d --rm --name ${containerName} -p 127.0.0.1:${hostPort}:8080 ...`);

  // execFile không dùng shell và chỉ truyền TÊN biến qua -e; giá trị lấy từ env
  // của process nên API key không xuất hiện trong command/error log.
  execFile("docker", dockerArgs, { env: process.env }, async (err, stdout, stderr) => {
    if (err) {
      reservedPorts.delete(hostPort);
      console.error(`[Orchestrator] Không khởi chạy được Docker container cho session ${sessionId}:`, err.message);
      console.error(`[Orchestrator] Docker stderr:`, stderr);
      clientWs.send(JSON.stringify({
        type: "log",
        message: `Lỗi khởi tạo session container: ${err.message}`,
        status: "error"
      }));
      clientWs.close(1011, "Failed to launch worker container");
      return;
    }

    const containerId = stdout.trim().substring(0, 12);
    console.log(`[Orchestrator] Container [${containerName}] đã chạy thành công. ID: ${containerId}`);

    // Thông báo cho client biết container đang khởi động (cần ~15-20 giây)
    try {
      clientWs.send(JSON.stringify({
        type: "log",
        message: "Đang khởi tạo môi trường duyệt web cô lập (khoảng 15-20 giây)...",
        status: "info"
      }));
    } catch (e) { }


    let cleanedUp = false;

    // Hàm dọn dẹp docker container khi kết nối kết thúc
    function cleanupDocker() {
      if (cleanedUp) return;
      cleanedUp = true;
      reservedPorts.delete(hostPort);
      console.log(`[Orchestrator] Đang kết thúc container: ${containerName}`);
      exec(`docker kill ${containerName}`, (killErr) => {
        if (killErr) {
          // Container có thể đã tự thoát trước đó nhờ EXIT_ON_CLOSE
          console.log(`[Orchestrator] Container ${containerName} đã dừng.`);
        } else {
          console.log(`[Orchestrator] Đã dừng và giải phóng container: ${containerName}`);
        }
      });
    }

    const startTime = Date.now();
    let isTargetConnected = false;

    function connectAndProxy() {
      if (cleanedUp) return;

      const targetWsUrl = `ws://127.0.0.1:${hostPort}${chainRaw ? `?chain=${encodeURIComponent(chainRaw)}` : ''}`;
      console.log(`[Orchestrator] Đang thử kết nối tới container [${containerName}] tại ${targetWsUrl}...`);

      targetWs = new WebSocket(targetWsUrl);

      targetWs.on("open", () => {
        isTargetConnected = true;
        console.log(`[Orchestrator] Đã kết nối thành công tới container [${containerName}]. Bắt đầu proxy...`);

        // Chuyển tiếp các lệnh client đã gửi trong lúc worker còn khởi động.
        while (pendingClientMessages.length > 0 && targetWs.readyState === WebSocket.OPEN) {
          const message = pendingClientMessages.shift();
          targetWs.send(message.data, { binary: message.isBinary });
        }

        // Proxy tin nhắn: Container -> Client (giữ nguyên loại frame text/binary)
        targetWs.on("message", (data, isBinary) => {
          if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(data, { binary: isBinary });
          }
        });
      });

      targetWs.on("close", () => {
        if (isTargetConnected) {
          // Chỉ đóng client và dọn dẹp nếu đã từng kết nối thành công
          // (nếu chưa kết nối, close event do error retry → để error handler xử lý)
          console.log(`[Orchestrator] Container [${containerName}] đóng kết nối.`);
          clientWs.close();
          cleanupDocker();
        }
      });

      targetWs.on("error", (targetErr) => {
        if (!isTargetConnected) {
          // Thử kết nối lại sau 500ms nếu chưa hết thời gian timeout (45 giây)
          // xvfb-run + Playwright Chromium cần ~15-20 giây để khởi động trong container
          const elapsed = Date.now() - startTime;
          if (elapsed < 45000) {
            try { targetWs.close(); } catch (e) { }
            // Log tiến trình mỗi 5 giây để dễ theo dõi
            if (Math.floor(elapsed / 5000) > Math.floor((elapsed - 500) / 5000)) {
              console.log(`[Orchestrator] Đang chờ container [${containerName}] sẵn sàng... (${Math.round(elapsed / 1000)}s)`);
            }
            setTimeout(connectAndProxy, 500);
          } else {
            console.error(`[Orchestrator] Hết thời gian chờ khởi động container [${containerName}] sau 45s. Lỗi: ${targetErr.message}`);
            try {
              clientWs.send(JSON.stringify({
                type: "log",
                message: "Không thể kết nối tới môi trường duyệt web cô lập của bạn (timeout 45s).",
                status: "error"
              }));
            } catch (e) { }
            clientWs.close(1011, "Session container ready timeout");
            cleanupDocker();
          }
        } else {
          console.error(`[Orchestrator] Lỗi kết nối tới container [${containerName}]:`, targetErr.message);
          clientWs.close(1011, "Container WebSocket connection error");
          cleanupDocker();
        }
      });
    }

    clientWs.on("close", () => {
      console.log(`[Orchestrator] Client của session ${sessionId} đã ngắt kết nối.`);
      if (targetWs) {
        try { targetWs.close(); } catch (e) { }
      }
      cleanupDocker();
    });

    clientWs.on("error", (clientErr) => {
      console.error(`[Orchestrator] Lỗi WebSocket phía Client (session ${sessionId}):`, clientErr.message);
      if (targetWs) {
        try { targetWs.close(); } catch (e) { }
      }
      cleanupDocker();
    });

    // Chờ 3 giây trước lần thử kết nối đầu tiên (node server.js khởi động nhanh hơn, ~3-5 giây)
    console.log(`[Orchestrator] Container [${containerName}] đang khởi động. Bắt đầu thử kết nối sau 3 giây...`);
    setTimeout(connectAndProxy, 3000);
  });
});
