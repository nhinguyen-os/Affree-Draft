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
const cooponlinePlaybook = require("./playbooks/cooponline");

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
  let lastOrderPayload = null;
  let cancelledByUser = false;

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

  async function sendScreenshotFrame() {
    if (!page || ws.readyState !== WebSocket.OPEN) return;
    try {
      const viewport = page.viewportSize() || { width: 1024, height: 768 };
      const data = await page.screenshot({ type: "jpeg", quality: 62 });
      ws.send(JSON.stringify({
        type: "screencast",
        data: data.toString("base64"),
        width: viewport.width,
        height: viewport.height
      }));
    } catch (e) {
      sendLog(`Không gửi được ảnh màn hình: ${e.message}`, "warning");
    }
  }

  try {
    browser = await chromium.launch({
      headless: process.env.HEADLESS !== "false",
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-blink-features=AutomationControlled"
      ]
    });

    context = await browser.newContext({
      viewport: { width: 1024, height: 768 },
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      deviceScaleFactor: 1
    });

    page = await context.newPage();
    sendLog("Đã khởi tạo trình duyệt thành công.", "success");

    // Bước 1: Mở trang giữ chỗ để có DOM trước
    await page.setContent(`
      <html><body style="margin:0;background:#f8fafc;display:flex;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;color:#64748b;font-size:14px;">
        <div>Đang chờ lệnh từ Affree...</div>
      </body></html>
    `);

    // Bước 2: Khởi tạo CDP và bắt đầu screencast
    cdpSession = await context.newCDPSession(page);
    await cdpSession.send("Page.startScreencast", {
      format: "jpeg",
      quality: 60,
      maxWidth: 1024,
      maxHeight: 768,
      everyNthFrame: 1
    });

    cdpSession.on("Page.screencastFrame", ({ data, sessionId }) => {
      try {
        ws.send(JSON.stringify({
          type: "screencast",
          data: data,
          width: 1024,
          height: 768
        }));
      } catch (err) {}
      cdpSession.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
    });

    // Bước 3: Gửi 1 screenshot ngay lập tức để client không phải chờ frame CDP đầu tiên
    await sendScreenshotFrame();

  } catch (err) {
    sendLog(`Lỗi khởi tạo trình duyệt: ${err.message}`, "error");
    cleanup();
    return;
  }

  async function resumeAgenticLoop(reason, extraAction) {
    if (!lastOrderPayload) {
      sendLog("Không có payload đơn hàng trước đó để tiếp tục.", "warning");
      return;
    }
    if (isAutomating) {
      sendLog("Agent đang bận, chưa thể tiếp tục phiên hiện tại.", "warning");
      return;
    }

    isAutomating = true;
    cancelledByUser = false;
    try {
      if (typeof extraAction === "function") {
        await extraAction();
      }
      sendLog(`Đang tiếp tục quy trình sau bước: ${reason}`, "info");
      sendStatus("running", { reason: `resume:${reason}` });
      const aiHandled = await runAgenticLoop(page, lastOrderPayload, sendLog, sendStatus, { skipInitialGoto: true });
      if (!aiHandled) {
        sendLog("AI loop không xử lý được tiếp; giữ nguyên màn hình để user tự thao tác.", "warning");
      }
    } catch (err) {
      sendLog(`Lỗi khi tiếp tục quy trình: ${err.message}`, "error");
      sendStatus("failed", { error: err.message });
    } finally {
      isAutomating = false;
    }
  }

  // Nhận thông điệp từ Client
  ws.on("message", async (messageStr) => {
    try {
      const msg = JSON.parse(typeof messageStr === "string" ? messageStr : messageStr.toString());

      switch (msg.type) {
        case "navigate":
          sendLog(`Đang điều hướng tới: ${msg.url}...`);
          await page.goto(msg.url, { waitUntil: "commit", timeout: 20000 });
          await page.waitForLoadState("domcontentloaded", { timeout: 8000 }).catch(() => {
            sendLog("Trang đã bắt đầu tải nhưng chưa báo domcontentloaded, vẫn hiển thị màn hình hiện tại.", "warning");
          });
          if (ws.readyState !== WebSocket.OPEN || page.isClosed()) break;
          await page.waitForTimeout(500).catch(() => {});
          if (ws.readyState !== WebSocket.OPEN || page.isClosed()) break;
          await sendScreenshotFrame();
          sendLog(`Đã tải xong trang: ${msg.url}`, "success");
          break;

        case "click":
          if (!isAutomating) {
            await page.mouse.click(msg.x, msg.y);
            await page.waitForTimeout(120);
            await sendScreenshotFrame();
          }
          break;

        case "move":
        case "mousemove":
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
            await page.waitForTimeout(120);
            await sendScreenshotFrame();
          }
          break;

        case "keydown":
          if (!isAutomating) {
            try { await page.keyboard.down(msg.key); } catch (err) {}
          }
          break;

        case "keyup":
          if (!isAutomating) {
            try { await page.keyboard.up(msg.key); } catch (err) {}
          }
          break;

        case "keypress":
          if (!isAutomating) {
            try {
              await page.keyboard.press(msg.key);
              await page.waitForTimeout(120);
              await sendScreenshotFrame();
            } catch (err) {}
          }
          break;

        case "type":
          if (!isAutomating) {
            await page.keyboard.type(msg.text);
            await page.waitForTimeout(120);
            await sendScreenshotFrame();
          }
          break;

        case "wheel":
          if (!isAutomating) {
            const deltaX = Number.isFinite(Number(msg.deltaX)) ? Number(msg.deltaX) : 0;
            const deltaY = Number.isFinite(Number(msg.deltaY)) ? Number(msg.deltaY) : 0;
            if (Number.isFinite(Number(msg.x)) && Number.isFinite(Number(msg.y))) {
              await page.mouse.move(Number(msg.x), Number(msg.y));
            }
            await page.mouse.wheel(deltaX, deltaY);
            await page.waitForTimeout(160);
            await sendScreenshotFrame();
          }
          break;

        case "run_order":
          sendLog(`Đã nhận lệnh run_order cho: ${msg.payload?.productName || 'unknown product'}`, "info");
          // Kích hoạt chu trình đặt hàng tự động mô phỏng bằng Playwright
          if (isAutomating) {
            sendLog("Hiện đang chạy một quy trình đặt hàng tự động khác.", "warning");
            break;
          }
          lastOrderPayload = msg.payload;
          cancelledByUser = false;
          runAutomatedOrder(msg.payload);
          break;

        case "submit_otp":
          await resumeAgenticLoop("otp", async () => {
            if (msg.otp) {
              await page.keyboard.type(String(msg.otp), { delay: 30 });
              await page.keyboard.press("Enter");
              sendLog("Đã nhận OTP từ orchestrator và điền vào trang.", "success");
            }
          });
          break;

        case "captcha_completed":
          await resumeAgenticLoop("captcha_completed", async () => {
            sendLog("Đã nhận tín hiệu CAPTCHA hoàn tất từ orchestrator.", "success");
          });
          break;

        case "confirm_final_action":
          await resumeAgenticLoop("confirm_final_action", async () => {
            try {
              await page.getByText(/đặt hàng|xác nhận|mua ngay|hoàn tất/i).first().click({ timeout: 3000 });
              sendLog("Đã thử click nút xác nhận cuối cùng trên trang.", "success");
            } catch (err) {
              sendLog("Không tìm thấy nút xác nhận cuối cùng bằng matcher tổng quát, AI sẽ tự tiếp tục.", "warning");
            }
          });
          break;

        case "payment_submitted":
          await resumeAgenticLoop("payment_submitted", async () => {
            sendLog("Đã nhận tín hiệu người dùng báo thanh toán xong, bắt đầu xác minh lại trang.", "info");
          });
          break;

        case "choose_handoff":
          cancelledByUser = true;
          isAutomating = false;
          sendStatus("failed", { error: "handoff_to_user", orderUrl: page.url() });
          sendLog("Phiên này đã được chuyển sang thao tác thủ công theo yêu cầu orchestrator.", "warning");
          break;

        case "cancel_order":
          cancelledByUser = true;
          isAutomating = false;
          sendStatus("cancelled", { error: "cancelled_by_user", orderUrl: page.url() });
          sendLog("Phiên đặt hàng đã bị hủy từ orchestrator.", "warning");
          break;

        case "coop_show_cart":
          if (isAutomating) {
            sendLog("Hiện đang chạy một quy trình tự động khác.", "warning");
            break;
          }
          isAutomating = true;
          cooponlinePlaybook
            .showCartPreview(page, msg.payload || msg, sendLog, sendStatus, sendScreenshotFrame)
            .then(() => sendScreenshotFrame())
            .catch((err) => {
              sendLog(`Co.opmart màn hình thao tác lỗi: ${err.message}`, "error");
              sendStatus("failed", { error: err.message });
            })
            .finally(() => {
              isAutomating = false;
            });
          break;

        case "coop_profile_setup":
          if (isAutomating) {
            sendLog("Hiện đang chạy một quy trình tự động khác.", "warning");
            break;
          }
          isAutomating = true;
          cooponlinePlaybook
            .showProfileSetup(page, msg.payload || msg, sendLog, sendStatus, sendScreenshotFrame)
            .then(() => sendScreenshotFrame())
            .catch((err) => {
              sendLog(`Co.opmart cập nhật hồ sơ lỗi: ${err.message}`, "error");
              sendStatus("failed", { error: err.message });
            })
            .finally(() => {
              isAutomating = false;
            });
          break;

        default:
          console.log(`[Agent Server] Lệnh không xác định: ${msg.type}`);
      }
    } catch (e) {
      console.error("[Agent Server] Lỗi xử lý message:", e);
    }
  });

  try {
    ws.send(JSON.stringify({ type: "ready" }));
  } catch (e) {}

  // Tự động hóa tiến trình mua hàng
  async function runAutomatedOrder(payload) {
    isAutomating = true;
    try {
      sendStatus("running");
      const aiHandled = await runAgenticLoop(page, payload, sendLog, sendStatus);
      if (aiHandled) { isAutomating = false; return; }

      const { url, productName, qty, buyerName, buyerPhone, buyerAddress, chain } = payload;
      sendLog(`BẮT ĐẦU TỰ ĐỘNG ĐẶT HÀNG (CSS FALLBACK): ${productName} (SL: ${qty}) tại ${chain.toUpperCase()}`);
      sendLog(`Đang truy cập trang sản phẩm: ${url}...`);
      await page.goto(url, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(1500);

      const buySelectors = [
        "text=Mua ngay", "text=MUA NGAY", "text=Thêm vào giỏ hàng", "text=THÊM VÀO GIỎ",
        "button:has-text('Mua')", "button:has-text('Đặt')", ".btn-buy", ".add-to-cart", "a:has-text('Mua')"
      ];
      let clickedBuy = false;
      for (const selector of buySelectors) {
        try {
          const btn = page.locator(selector).first();
          if (await btn.isVisible()) {
            await btn.scrollIntoViewIfNeeded();
            await btn.click();
            clickedBuy = true;
            sendLog(`Đã click nút mua hàng: "${selector}"`, "success");
            break;
          }
        } catch (e) {}
      }
      if (!clickedBuy) {
        sendLog("Không phát hiện nút mua tự động. Vui lòng click trực tiếp trên màn hình.", "warning");
        await page.waitForTimeout(3000);
      }
      await page.waitForTimeout(2000);
      sendStatus("waiting_user_input");
      sendLog("⚠️ AGENT TẠM DỪNG: Cần khách hàng thực hiện OTP hoặc thanh toán trực tiếp trên màn hình!");
      isAutomating = false;

      let isDone = false;
      for (let i = 0; i < 300; i++) {
        const currentUrl = page.url();
        if (currentUrl.includes("thank-you") || currentUrl.includes("success") || currentUrl.includes("don-hang") || currentUrl.includes("checkout/complete")) {
          sendLog(`Phát hiện đặt hàng thành công! URL: ${currentUrl}`, "success");
          sendStatus("completed", { orderUrl: currentUrl });
          isDone = true;
          break;
        }
        await page.waitForTimeout(1000);
      }
      if (!isDone) sendLog("Hết thời gian chờ. Vui lòng kiểm tra lại đơn hàng.", "warning");

    } catch (err) {
      sendLog(`Lỗi tiến trình đặt hàng: ${err.message}`, "error");
      sendStatus("failed", { error: err.message });
      isAutomating = false;
    }
  }

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
