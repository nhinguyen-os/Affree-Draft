/**
 * Affree AI Agentic Web Server
 * Sử dụng Playwright + WebSockets để truyền phát màn hình (CDP Screencast)
 * và nhận tương tác (chuột/phím) từ Client để tự động đặt hàng.
 * 
 * Quy định ngôn ngữ: Comments và chuỗi log tiếng Việt, biến/hàm tiếng Anh.
 */

const fs = require("fs");
const path = require("path");

// Hàm đọc và tải file .env
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
      console.log(`[Agent Server] Đã tải cấu hình từ: ${envPath}`);
    }
  } catch (e) {
    console.log(`[Agent Server] Không đọc được ${envPath}:`, e.message);
  }
}

// Tải từ cả thư mục agent-server và thư mục gốc của dự án
loadEnvFile(path.join(__dirname, ".env"));
loadEnvFile(path.join(__dirname, "..", ".env"));

const { chromium } = require("playwright");
const WebSocket = require("ws");
const { runAgenticLoop } = require("./agent-llm");

const PORT = process.env.PORT || 8080;
const wss = new WebSocket.Server({ port: PORT });

console.log(`[Agent Server] Đang chạy tại cổng ${PORT}...`);

wss.on("connection", async (ws) => {
  console.log("[Agent Server] Client mới đã kết nối. Đang khởi tạo trình duyệt...");
  
  let browser = null;
  let context = null;
  let page = null;
  let cdpSession = null;
  let isAutomating = false;

  // Gửi log về client
  function sendLog(message, status = "info") {
    console.log(`[LOG - ${status}] ${message}`);
    try {
      ws.send(JSON.stringify({ type: "log", message, status }));
    } catch (e) {
      // client disconnected
    }
  }

  // Gửi cập nhật trạng thái đặt hàng về client
  function sendStatus(phase, details = {}) {
    try {
      ws.send(JSON.stringify({ type: "status", phase, ...details }));
    } catch (e) {}
  }

  try {
    // Khởi động trình duyệt Chromium. 
    // Trong môi trường Docker cần --no-sandbox và --disable-setuid-sandbox
    browser = await chromium.launch({
      headless: process.env.HEADLESS !== "false", // Chạy headless theo biến môi trường
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-blink-features=AutomationControlled" // Né tránh phát hiện bot cơ bản
      ]
    });

    // Tạo context trình duyệt với viewport cố định để chuẩn hóa tọa độ tương tác
    context = await browser.newContext({
      viewport: { width: 1024, height: 768 },
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      deviceScaleFactor: 1
    });

    page = await context.newPage();
    sendLog("Đã khởi tạo trình duyệt thành công.", "success");

    // Khởi tạo CDP (Chrome DevTools Protocol) session để bắt luồng Screencast
    cdpSession = await context.newCDPSession(page);
    
    // Bắt đầu screencast gửi ảnh JPEG nén qua WebSocket
    await cdpSession.send("Page.startScreencast", {
      format: "jpeg",
      quality: 60,
      maxWidth: 1024,
      maxHeight: 768,
      everyNthFrame: 1 // Gửi mọi khung hình thay đổi
    });

    cdpSession.on("Page.screencastFrame", ({ data, sessionId, metadata }) => {
      // Gửi base64 frame và metadata về cho React Client
      try {
        ws.send(JSON.stringify({
          type: "screencast",
          data: data, // string base64
          width: 1024,
          height: 768
        }));
      } catch (err) {}

      // Xác nhận đã nhận khung hình (Acknowledge) để CDP gửi khung tiếp theo
      cdpSession.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
    });

  } catch (err) {
    sendLog(`Lỗi khởi tạo trình duyệt: ${err.message}`, "error");
    cleanup();
    return;
  }

  // Nhận thông điệp từ Client
  ws.on("message", async (messageStr) => {
    try {
      const msg = JSON.parse(messageStr);

      switch (msg.type) {
        case "navigate":
          sendLog(`Đang điều hướng tới: ${msg.url}...`);
          await page.goto(msg.url, { waitUntil: "domcontentloaded" });
          sendLog(`Đã tải xong trang: ${msg.url}`, "success");
          break;

        case "click":
          // Tọa độ click được chuẩn hóa theo tỷ lệ khung hình viewport (1024x768)
          if (!isAutomating) {
            await page.mouse.click(msg.x, msg.y);
          }
          break;

        case "move":
        case "mousemove":
          // Di chuyển chuột
          if (!isAutomating) {
            await page.mouse.move(msg.x, msg.y);
          }
          break;

        case "mousedown":
          if (!isAutomating) {
            await page.mouse.move(msg.x, msg.y);
            await page.mouse.down();
          }
          break;

        case "mouseup":
          if (!isAutomating) {
            await page.mouse.move(msg.x, msg.y);
            await page.mouse.up();
          }
          break;

        case "keydown":
          if (!isAutomating) {
            try {
              await page.keyboard.down(msg.key);
            } catch (err) {
              // Bỏ qua lỗi phím không hợp lệ (ví dụ: chữ có dấu tiếng Việt 'Đ', 'á'...)
            }
          }
          break;

        case "keyup":
          if (!isAutomating) {
            try {
              await page.keyboard.up(msg.key);
            } catch (err) {
              // Bỏ qua
            }
          }
          break;

        case "keypress":
          if (!isAutomating) {
            try {
              await page.keyboard.press(msg.key);
            } catch (err) {
              // Bỏ qua
            }
          }
          break;

        case "type":
          if (!isAutomating) {
            await page.keyboard.type(msg.text);
          }
          break;

        case "run_order":
          // Kích hoạt chu trình đặt hàng tự động mô phỏng bằng Playwright
          if (isAutomating) {
            sendLog("Hiện đang chạy một quy trình đặt hàng tự động khác.", "warning");
            break;
          }
          runAutomatedOrder(msg.payload);
          break;

        default:
          console.log(`[Agent Server] Lệnh không xác định: ${msg.type}`);
      }
    } catch (e) {
      console.error("[Agent Server] Lỗi xử lý message:", e);
    }
  });

  // Tự động hóa tiến trình mua hàng
  async function runAutomatedOrder(payload) {
    isAutomating = true;
    
    try {
      sendStatus("running");
      
      // Gọi AI Agentic Loop điều khiển bằng thị giác LLM
      const aiHandled = await runAgenticLoop(page, payload, sendLog, sendStatus);
      if (aiHandled) {
        isAutomating = false;
        return;
      }

      // Fallback kịch bản CSS selectors cũ khi không có API key
      const { url, productName, qty, buyerName, buyerPhone, buyerAddress, chain } = payload;
      sendLog(`BẮT ĐẦU TỰ ĐỘNG ĐẶT HÀNG (CSS FALLBACK): ${productName} (SL: ${qty}) tại ${chain.toUpperCase()}`);

      // Bước 1: Mở trang sản phẩm
      sendLog(`Đang truy cập trang sản phẩm: ${url}...`);
      await page.goto(url, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(1500);

      // Bước 2: Nhấp thêm vào giỏ / Mua ngay
      sendLog(`Tìm và thêm sản phẩm "${productName}" vào giỏ hàng...`);
      
      // Tìm các nút mua hàng phổ biến ở Việt Nam
      const buySelectors = [
        "text=Mua ngay", "text=MUA NGAY", "text=Thêm vào giỏ hàng", "text=THÊM VÀO GIỎ",
        "button:has-text('Mua')", "button:has-text('Đặt')", ".btn-buy", ".add-to-cart",
        "a:has-text('Mua')"
      ];
      
      let clickedBuy = false;
      for (const selector of buySelectors) {
        try {
          const btn = page.locator(selector).first();
          if (await btn.isVisible()) {
            await btn.scrollIntoViewIfNeeded();
            await btn.click();
            clickedBuy = true;
            sendLog(`Đã click nút mua hàng bằng selector: "${selector}"`, "success");
            break;
          }
        } catch (e) {}
      }

      if (!clickedBuy) {
        // Nếu không tìm thấy, giả lập click vào vị trí phỏng đoán ở giữa màn hình
        sendLog("Không phát hiện nút mua tự động bằng chữ. Vui lòng click trực tiếp vào nút mua trên màn hình truyền phát.", "warning");
        await page.waitForTimeout(3000); // Chờ user click
      }

      await page.waitForTimeout(2000);

      // Bước 3: Điền thông tin giao hàng
      sendLog("Đang tiến hành điền thông tin người mua...");
      
      // Tìm các input họ tên, số điện thoại, địa chỉ
      const nameSelectors = ["input[placeholder*='tên']", "input[placeholder*='Name']", "input[name*='name']", "input[name*='fullname']"];
      const phoneSelectors = ["input[placeholder*='thoại']", "input[placeholder*='Phone']", "input[name*='phone']", "input[name*='tel']"];
      const addressSelectors = ["input[placeholder*='địa chỉ']", "input[placeholder*='Address']", "textarea[placeholder*='chỉ']", "input[name*='address']"];

      // Điền họ tên
      let filledName = false;
      for (const sel of nameSelectors) {
        try {
          const el = page.locator(sel).first();
          if (await el.isVisible()) {
            await el.fill(buyerName);
            filledName = true;
            break;
          }
        } catch (e) {}
      }
      if (filledName) sendLog(`Đã điền họ tên: ${buyerName}`, "success");

      // Điền SĐT
      let filledPhone = false;
      for (const sel of phoneSelectors) {
        try {
          const el = page.locator(sel).first();
          if (await el.isVisible()) {
            await el.fill(buyerPhone);
            filledPhone = true;
            break;
          }
        } catch (e) {}
      }
      if (filledPhone) sendLog(`Đã điền SĐT: ${buyerPhone}`, "success");

      // Điền địa chỉ
      let filledAddress = false;
      for (const sel of addressSelectors) {
        try {
          const el = page.locator(sel).first();
          if (await el.isVisible()) {
            await el.fill(buyerAddress);
            filledAddress = true;
            break;
          }
        } catch (e) {}
      }
      if (filledAddress) sendLog(`Đã điền địa chỉ giao hàng: ${buyerAddress}`, "success");

      await page.waitForTimeout(1500);

      // Bước 4: Chờ OTP / Đăng nhập / Thanh toán (Yêu cầu con người can thiệp)
      sendStatus("waiting_user_input");
      sendLog("⚠️ AGENT TẠM DỪNG: Cần khách hàng thực hiện OTP hoặc thanh toán trực tiếp trên màn hình!");
      sendLog("Mẹo: Bạn có thể click chuột và gõ phím trực tiếp lên ô màn hình trình duyệt ở Web App để nhập OTP/thẻ ngân hàng.");

      // Trả lại quyền tương tác tự do cho user
      isAutomating = false;

      // Đợi xem user có hoàn thành không (chờ tối đa 5 phút)
      let isDone = false;
      for (let i = 0; i < 300; i++) {
        // Kiểm tra xem trang có chuyển hướng sang trang cảm ơn/thành công không
        const currentUrl = page.url();
        if (currentUrl.includes("thank-you") || currentUrl.includes("success") || currentUrl.includes("don-hang") || currentUrl.includes("checkout/complete")) {
          sendLog(`Phát hiện đặt hàng thành công! URL hiện tại: ${currentUrl}`, "success");
          sendStatus("completed", { orderUrl: currentUrl });
          isDone = true;
          break;
        }
        await page.waitForTimeout(1000);
      }

      if (!isDone) {
        sendLog("Hết thời gian chờ (Timeout). Vui lòng kiểm tra lại đơn hàng.", "warning");
      }

    } catch (err) {
      sendLog(`Lỗi trong tiến trình tự động đặt hàng: ${err.message}`, "error");
      sendStatus("failed", { error: err.message });
      isAutomating = false;
    }
  }

  // Dọn dẹp tài nguyên khi ngắt kết nối
  async function cleanup() {
    console.log("[Agent Server] Đang dọn dẹp tài nguyên phiên...");
    try {
      if (cdpSession) await cdpSession.detach().catch(() => {});
      if (context) await context.close().catch(() => {});
      if (browser) await browser.close().catch(() => {});
    } catch (e) {
      console.error("[Agent Server] Lỗi dọn dẹp:", e);
    }
    console.log("[Agent Server] Đã giải phóng phiên.");
  }

  ws.on("close", () => {
    console.log("[Agent Server] Client đã đóng kết nối.");
    cleanup();
  });

  ws.on("error", (err) => {
    console.error("[Agent Server] Lỗi kết nối WebSocket:", err);
    cleanup();
  });
});
