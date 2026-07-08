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
const url = require("url");
const crypto = require("crypto");
const { exec } = require("child_process");
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

// Hàm tìm cổng trống khả dụng trên host bắt đầu từ port 9000
function getFreePort(startPort = 9001) {
  return new Promise((resolve) => {
    function checkPort(port) {
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
      server.listen(port, "127.0.0.1");
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
  const parsedUrl = url.parse(req.url, true);
  const sessionIdRaw = parsedUrl.query.sessionId;
  const tokenRaw = parsedUrl.query.token;
  const timestampRaw = parsedUrl.query.timestamp;
  const chainRaw = parsedUrl.query.chain;

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
  console.log(`[Orchestrator] Nhận yêu cầu kết nối hợp lệ. SessionID: ${sessionId}`);

  // Tìm cổng trống
  const hostPort = await getFreePort();
  console.log(`[Orchestrator] Đã tìm thấy cổng trống cho session: ${hostPort}`);

  // Chuẩn bị biến môi trường để truyền qua container docker
  const passthroughEnvs = [
    "GEMINI_API_KEY",
    "GEMINI_MODEL",
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_MODEL",
    "QWEN_API_KEY",
    "QWEN_MODEL",
    "QWEN_API_URL",
    "HEADLESS",
    "AGENT_GEO_LAT",
    "AGENT_GEO_LON"
  ];

  let envArgs = "";
  passthroughEnvs.forEach((envName) => {
    if (process.env[envName] !== undefined) {
      // Escape ký tự dấu nháy đơn để tránh shell injection
      const escapedVal = process.env[envName].replace(/'/g, "'\\''");
      envArgs += ` -e ${envName}='${escapedVal}'`;
    }
  });

  // Chạy docker container ở chế độ nền (-d), tự xóa khi tắt (--rm), giới hạn tài nguyên nếu cần
  const dockerCmd = `docker run -d --rm --name ${containerName}${envArgs} -e EXIT_ON_CLOSE=true -p ${hostPort}:8080 affree-agent`;

  console.log(`[Orchestrator] Khởi chạy container: docker run -d --rm --name ${containerName} -p ${hostPort}:8080 ...`);

  exec(dockerCmd, async (err, stdout, stderr) => {
    if (err) {
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
    let targetWs = null;
    let isTargetConnected = false;

    function connectAndProxy() {
      if (cleanedUp) return;

      const targetWsUrl = `ws://127.0.0.1:${hostPort}${chainRaw ? `?chain=${encodeURIComponent(chainRaw)}` : ''}`;
      console.log(`[Orchestrator] Đang thử kết nối tới container [${containerName}] tại ${targetWsUrl}...`);

      targetWs = new WebSocket(targetWsUrl);

      targetWs.on("open", () => {
        isTargetConnected = true;
        console.log(`[Orchestrator] Đã kết nối thành công tới container [${containerName}]. Bắt đầu proxy...`);

        // Proxy tin nhắn: Client -> Container (giữ nguyên loại frame text/binary)
        clientWs.on("message", (data, isBinary) => {
          if (targetWs && targetWs.readyState === WebSocket.OPEN) {
            targetWs.send(data, { binary: isBinary });
          }
        });

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
