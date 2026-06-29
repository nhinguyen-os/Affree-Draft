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
const { runPlaybook, resolvePlaybook } = require("./playbooks");
const { runAgenticToolUseLoop } = require("./agent-llm");
const cooponlinePlaybook = require("./playbooks/cooponline");
const { updateSkillFromSession } = require("./skill-updater");
const { domainFromUrl } = require("./skill-store");

const HAS_LLM_API_KEY = Boolean(
  process.env.QWEN_API_KEY || process.env.ANTHROPIC_API_KEY || process.env.GEMINI_API_KEY
);
const RUN_TXNN_AGENTIC = process.env.RUN_TXNN_AGENTIC === "true";

const PORT = process.env.PORT || 8080;
const wss = new WebSocket.Server({ port: PORT });
const DEFAULT_GEO_LAT = Number(process.env.AGENT_GEO_LAT || "10.8050");
const DEFAULT_GEO_LON = Number(process.env.AGENT_GEO_LON || "106.6650");

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
  let popupFocusState = null;
  let popupFrameInterval = null;
  let completionMonitor = null;
  let completionSent = false;
  let paymentFailureSent = false;
  let lastPaymentOrderCode = null;
  let lastGatewayPaymentResult = null;
  let browserReady = false;
  let isBachHoaXanhFlow = false;
  const queuedClientMessages = [];
  const boundPaymentPages = new WeakSet();

  let activeTracer = null; // Tracer cho phiên hiện tại (Self-Learning)
  let activeFilledFields = []; // Lưu lại danh sách field đã điền giữa các phiên pause/resume
  let activeActionHistory = []; // Lưu lại lịch sử hành động giữa các phiên pause/resume
  let activeResumeHistory = []; // Lưu conversation history cho Tool-Use mode

  // Gửi log về client
  function sendLog(message, status = "info") {
    console.log(`[LOG - ${status}] ${message}`);
    try {
      ws.send(JSON.stringify({ type: "log", message, status }));
    } catch (e) {
      // client disconnected
    }
  }

  function sendPopupState(popup) {
    popupFocusState = popup || null;
    try {
      ws.send(JSON.stringify({
        type: "popup_state",
        open: Boolean(popup),
        popup: popup
          ? {
              kind: popup.kind,
              title: popup.title,
              text: popup.text,
              actions: popup.actions,
              bounds: popup.bounds,
            }
          : undefined,
      }));
    } catch (e) { }
  }

  function clearPopupFrameInterval() {
    if (popupFrameInterval) {
      clearInterval(popupFrameInterval);
      popupFrameInterval = null;
    }
  }

  function startPopupFrameInterval() {
    clearPopupFrameInterval();
    if (!popupFocusState) return;
    popupFrameInterval = setInterval(() => {
      void sendScreenshotFrame({ clip: popupFocusState.bounds, mode: "popup-focus" });
    }, 1200);
  }

  function normalizeClip(clip) {
    const viewport = page?.viewportSize?.() || { width: 1024, height: 768 };
    if (!clip) {
      return {
        x: 0,
        y: 0,
        width: viewport.width,
        height: viewport.height,
      };
    }

    const x = Math.max(0, Math.floor(Number(clip.x) || 0));
    const y = Math.max(0, Math.floor(Number(clip.y) || 0));
    const maxWidth = Math.max(1, viewport.width - x);
    const maxHeight = Math.max(1, viewport.height - y);
    const width = Math.max(1, Math.min(maxWidth, Math.floor(Number(clip.width) || 0)));
    const height = Math.max(1, Math.min(maxHeight, Math.floor(Number(clip.height) || 0)));
    return { x, y, width, height };
  }

  // Gửi message tự do về client (BHX dùng để gửi popup chọn giờ/OTP).
  function sendMessage(content, type = "message") {
    try {
      ws.send(JSON.stringify({ type, content }));
      if (type === "message") sendLog(content);
    } catch (e) {
      // client disconnected
    }
  }

  // Gửi cập nhật trạng thái đặt hàng về client
  function sendStatus(phase, details = {}) {
    try {
      ws.send(JSON.stringify({ type: "status", phase, ...details }));
    } catch (e) { }

    if (phase === "waiting_user_input" && details?.requiredInput === "qr_payment") {
      void refreshTxnnPopupFocus("waiting_for_qr_payment").then((popup) => {
        if (!popup) {
          sendLog("TXNN: chưa detect được popup thanh toán thật, tạm giữ fallback hiện có.", "warning");
        }
      });
      return;
    }

    if (phase === "running" || phase === "completed" || phase === "failed" || phase === "cancelled") {
      clearPopupFrameInterval();
      sendPopupState(null);
    }
  }

  async function handleClientMessage(messageStr) {
    if (!browserReady) {
      queuedClientMessages.push(messageStr);
      return;
    }
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
          await page.waitForTimeout(500).catch(() => { });
          if (ws.readyState !== WebSocket.OPEN || page.isClosed()) break;
          await sendScreenshotFrame();
          sendLog(`Đã tải xong trang: ${msg.url}`, "success");
          break;

        case "click":
          if (!isAutomating) {
            await page.mouse.click(msg.x, msg.y);
            await page.waitForTimeout(120);
            await sendScreenshotFrame();
            {
              const done = await emitCompletionIfDetected("screen_share_click");
              if (!done) await emitPaymentFailureIfDetected();
            }
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

        case "scroll":
        case "wheel":
          if (!isAutomating) {
            const deltaX = Number.isFinite(Number(msg.deltaX)) ? Number(msg.deltaX) : 0;
            const deltaY = Number.isFinite(Number(msg.deltaY)) ? Number(msg.deltaY) : 0;
            const x = Number.isFinite(Number(msg.x)) ? Number(msg.x) : 512;
            const y = Number.isFinite(Number(msg.y)) ? Number(msg.y) : 384;
            await page.mouse.move(x, y);
            await page.mouse.wheel(deltaX, deltaY);
            await page.waitForTimeout(160);
            await sendScreenshotFrame();
          }
          break;

        case "type":
          if (!isAutomating && msg.text) {
            await page.keyboard.type(msg.text);
            await page.waitForTimeout(120);
            await sendScreenshotFrame();
          }
          break;

        case "key":
        case "keypress":
          if (!isAutomating && msg.key) {
            await page.keyboard.press(msg.key);
            await page.waitForTimeout(120);
            await sendScreenshotFrame();
          }
          break;

        case "keydown":
          if (!isAutomating && msg.key) {
            try { await page.keyboard.down(msg.key); } catch (err) { }
          }
          break;

        case "keyup":
          if (!isAutomating && msg.key) {
            try { await page.keyboard.up(msg.key); } catch (err) { }
          }
          break;

        case "order":
        case "run_order":
          if (isAutomating) {
            sendLog("Đã có quy trình đang chạy, vui lòng chờ...", "warning");
            return;
          }
          sendLog(`Đã nhận lệnh đặt hàng cho: ${msg.payload?.productName || msg.productName || "unknown product"}`, "info");
          lastOrderPayload = msg.payload || msg;
          isBachHoaXanhFlow = lastOrderPayload?.chain === "bhx";
          runAutomatedOrder(lastOrderPayload);
          break;

        case "delivery_time_selected":
          sendLog(
            `Bach Hoa Xanh: Người dùng chọn thời gian giao hàng: ${msg.deliveryDate} ${msg.selectedText || "không rõ"}`,
            "success",
          );
          try {
            if (msg.kind === "date" && msg.deliveryDate) {
              const dateOption = page.locator(`[data-delivery-date="${msg.deliveryDate}"]`).first();
              await dateOption.click({ timeout: 3000 });
              await page.waitForTimeout(2000);

              const div = page.locator("div.w-full.bg-white.rounded-lg").first();
              await div.waitFor({ state: "visible", timeout: 10000 });

              const html = await div.evaluate((el) => el.outerHTML);
              sendMessage(html, "popup_delivery_time");
            } else if (msg.selectedText) {
              const optionText = String(msg.selectedText).replace(/\s+/g, " ").trim();
              const option = page.locator("label.radio-wrapper").filter({ hasText: optionText }).first();
              await option.click({ timeout: 3000 });

              sendLog(`Bach Hoa Xanh: Đã click lựa chọn giao hàng: ${optionText}`, "success");
              await page.mouse.click(0, 0);
              await resumeAgenticLoopBHX("submit");
            }
            sendLog("Bach Hoa Xanh: Đã click lựa chọn giao hàng trên trang thật.", "success");
          } catch (err) {
            sendLog(`Bach Hoa Xanh: Không click được lựa chọn giao hàng trên trang thật: ${err.message}`, "warning");
          }
          break;

        case "user_confirmed":
          await resumeAgenticLoop("user_confirmed");
          break;

        case "submit_otp":
          if (isBachHoaXanhFlow) {
            await resumeAgenticLoopBHX("otp", msg.otp);
          } else {
            await resumeAgenticLoop("otp", async () => {
              if (msg.otp) {
                await page.keyboard.type(String(msg.otp), { delay: 30 });
                await page.keyboard.press("Enter");
                sendLog("Đã nhận OTP từ orchestrator và điền vào trang.", "success");
              }
            });
          }
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

        case "payment_submitted": {
          try {
            sendLog("Đã nhận tín hiệu người dùng báo thanh toán xong, bắt đầu xác minh lại trang.", "info");
            sendStatus("running", { reason: "resume:payment_submitted" });
            const confirmSelectors = [
              'button:has-text("✅ Xác nhận")',
              'button:has-text("Xác nhận")',
              'button:has-text("OK")',
            ];
            let clicked = false;
            for (const selector of confirmSelectors) {
              const locator = page.locator(selector).last();
              if (await locator.isVisible({ timeout: 600 }).catch(() => false)) {
                await locator.click({ timeout: 3000 });
                sendLog(`Đã click nút xác nhận cuối sau thanh toán bằng selector: ${selector}`, "success");
                clicked = true;
                break;
              }
            }
            if (clicked && await completeTxnnAfterFinalConfirmation()) {
              isAutomating = false;
              break;
            }
            if (!clicked) {
              sendLog("Không thấy nút xác nhận cuối sau khi user báo thanh toán; sẽ tiếp tục bằng AI loop để tự dò lại trang.", "warning");
            }
            await resumeAgenticLoop("payment_submitted");
          } catch (err) {
            sendLog(`Lỗi khi thử click nút xác nhận cuối sau thanh toán: ${err.message}`, "warning");
            await resumeAgenticLoop("payment_submitted");
          }
          break;
        }

        case "popup_click": {
          if (!popupFocusState || isAutomating) break;
          const bounds = popupFocusState.bounds;
          const xRatio = Math.min(1, Math.max(0, Number(msg.xRatio) || 0));
          const yRatio = Math.min(1, Math.max(0, Number(msg.yRatio) || 0));
          const x = Math.round(bounds.x + bounds.width * xRatio);
          const y = Math.round(bounds.y + bounds.height * yRatio);
          await page.mouse.click(x, y);
          await page.waitForTimeout(900);
          const popup = await refreshTxnnPopupFocus("popup_click");
          if (!popup) {
            sendLog("Popup thanh toán đã đóng sau thao tác của user; vẫn chờ user bấm xác nhận đã thanh toán để bắt đầu verify.", "info");
            sendStatus("waiting_user_input", {
              reason: "Popup thanh toán đã đóng. Hệ thống vẫn chờ user xác nhận đã thanh toán xong trước khi kiểm tra hoàn tất.",
              requiredInput: "qr_payment",
            });
            await sendScreenshotFrame();
          }
          break;
        }

        case "user_cancelled":
        case "cancel_order":
          cancelledByUser = true;
          clearPopupFrameInterval();
          sendPopupState(null);
          sendLog("Người dùng đã hủy quy trình.", "warning");
          sendStatus("cancelled");
          break;

        case "choose_handoff":
          cancelledByUser = true;
          isAutomating = false;
          clearPopupFrameInterval();
          sendPopupState(null);
          sendStatus("failed", { error: "handoff_to_user", orderUrl: page.url() });
          sendLog("Phiên này đã được chuyển sang thao tác thủ công theo yêu cầu orchestrator.", "warning");
          break;

        case "resume_agent":
          // Người dùng bấm "Tiếp tục đặt hàng" trên GUI sau khi hoàn thành bước thủ công
          await resumeAgenticLoop(msg.reason || "manual_resume", async () => {
            const note = msg.note || "";
            if (note) sendLog(`Ghi chú người dùng: ${note}`, "info");
            sendLog("Người dùng đã xác nhận hoàn thành bước thủ công. Tiếp tục...", "success");
          });
          break;

        case "coop_show_cart":
          if (isAutomating) {
            sendLog("Hiện đang chạy một quy trình tự động khác.", "warning");
            break;
          }
          isAutomating = true;
          cooponlinePlaybook
            .showCartPreview(page, msg.payload || msg, sendLog, sendStatus, sendScreenshotFrame)
            .then(async () => {
              await sendScreenshotFrame();
              startCompletionMonitor("coop_checkout");
            })
            .catch((err) => {
              sendLog(`Co.opmart màn hình thao tác lỗi: ${err.message}`, "error");
              sendStatus("failed", { error: err.message });
            })
            .finally(() => {
              isAutomating = false;
            });
          break;

        case "coop_payment_screen":
          if (isAutomating) {
            sendLog("Hiện đang chạy một quy trình tự động khác.", "warning");
            break;
          }
          if (!msg.paymentUrl || typeof msg.paymentUrl !== "string") {
            sendStatus("failed", { error: "missing_payment_url" });
            sendLog("Co.opmart: Thiếu URL thanh toán để mở màn hình.", "error");
            break;
          }
          isAutomating = true;
          lastPaymentOrderCode = typeof msg.orderCode === "string" && msg.orderCode ? msg.orderCode : null;
          lastGatewayPaymentResult = null;
          paymentFailureSent = false;
          try {
            sendLog(`Co.opmart: Đang mở màn hình thanh toán ${msg.paymentMethodName || msg.paymentMethodCode || ""}...`, "info");
            await page.goto(msg.paymentUrl, { waitUntil: "commit", timeout: 30000 });
            await page.waitForLoadState("domcontentloaded", { timeout: 15000 }).catch(() => {
              sendLog("Trang thanh toán đã bắt đầu tải nhưng chưa báo domcontentloaded.", "warning");
            });
            await page.waitForTimeout(800);
            await sendScreenshotFrame();
            sendStatus("coop_payment_ready", {
              provider: "coop",
              paymentUrl: msg.paymentUrl,
              orderCode: msg.orderCode,
              paymentMethodCode: msg.paymentMethodCode,
            });
            sendLog("Co.opmart: Màn hình thanh toán đã sẵn sàng, đang theo dõi kết quả giao dịch.", "success");
            startCompletionMonitor("coop_payment");
          } catch (err) {
            sendLog(`Co.opmart mở màn hình thanh toán lỗi: ${err.message}`, "error");
            sendStatus("failed", { error: err.message });
          } finally {
            isAutomating = false;
          }
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
  }

  ws.on("message", handleClientMessage);

  // Đọc kết quả giao dịch từ query của trang cổng thanh toán (VNPAY/MoMo).
  // VNPAY trả vnp_ResponseCode/vnp_TransactionStatus = "00" khi thành công;
  // MoMo trả resultCode = "0". Param chỉ xuất hiện ở URL trả về sau khi giao dịch
  // đã kết thúc, nên đây là tín hiệu chắc chắn (success/fail), không phải đoán theo text.
  function parseGatewayPaymentResult(rawUrl) {
    let url;
    try {
      url = new URL(rawUrl);
    } catch {
      return null;
    }
    const params = url.searchParams;
    const getCI = (key) => {
      const lower = key.toLowerCase();
      for (const [k, v] of params.entries()) {
        if (k.toLowerCase() === lower) return v;
      }
      return null;
    };
    const vnpResponse = getCI("vnp_ResponseCode");
    const vnpStatus = getCI("vnp_TransactionStatus");
    const momoResult = getCI("resultCode");
    if (vnpResponse != null || vnpStatus != null) {
      const paid = vnpResponse === "00" && (vnpStatus == null || vnpStatus === "00");
      return { gateway: "vnpay", paid, code: getCI("vnp_TxnRef") || "", rawCode: vnpResponse ?? vnpStatus };
    }
    if (momoResult != null) {
      return { gateway: "momo", paid: momoResult === "0", code: getCI("orderId") || getCI("requestId") || "", rawCode: momoResult };
    }
    return null;
  }

  function rememberGatewayPaymentResult(rawUrl) {
    const gateway = parseGatewayPaymentResult(rawUrl);
    if (!gateway) return null;
    lastGatewayPaymentResult = {
      ...gateway,
      paymentUrl: rawUrl,
      seenAt: Date.now(),
    };
    return lastGatewayPaymentResult;
  }

  async function detectOrderCompletion(label = "checkout") {
    if (!page || page.isClosed()) return null;
    const currentUrl = page.url();
    // 1) Tín hiệu chắc chắn từ cổng thanh toán (ưu tiên cao nhất).
    const gateway = rememberGatewayPaymentResult(currentUrl) || lastGatewayPaymentResult;
    if (gateway) {
      if (!gateway.paid) return null; // đã kết thúc nhưng KHÔNG thành công → để failure monitor xử lý
      return {
        orderUrl: gateway.paymentUrl || currentUrl,
        orderCode: gateway.code || `COOP-${Date.now().toString().slice(-6)}`,
        totalText: undefined,
      };
    }
    const isPaymentMonitor = label === "coop_payment";
    if (isPaymentMonitor) {
      const host = (() => {
        try {
          return new URL(currentUrl).hostname;
        } catch {
          return "";
        }
      })();
      const isCoopResultPage = host.includes("cooponline.vn") && /order-result|payment-result|transaction\/result/i.test(currentUrl);
      if (!isCoopResultPage) return null;
    }
    // 2) Fallback: nhận diện theo URL/nội dung trang xác nhận của Co.op.
    const urlLooksDone = /thank-you|success|dat-hang-thanh-cong|checkout\/complete|order-success|order-complete|transaction\/result|payment-result/i.test(currentUrl);
    const details = await page.evaluate(() => {
      const text = document.body?.innerText || "";
      const normalized = text.replace(/\s+/g, " ").trim();
      const orderSuccessText = /đặt hàng thành công|dat hang thanh cong|order successful|thank you/i.test(normalized);
      const paymentSuccessText =
        /giao dịch thành công|giao dich thanh cong|thanh toán thành công|thanh toan thanh cong|payment successful|transaction successful/i.test(normalized);
      const orderCodeMatch =
        normalized.match(/(?:mã đơn hàng|ma don hang|mã giao dịch|ma giao dich|đơn hàng|don hang|order|transaction)\s*[:#]?\s*([A-Z0-9][A-Z0-9._-]{5,})/i) ||
        normalized.match(/(SGC|COOP|COOPMART|DH|OD)[-_]?[A-Z0-9]{5,}/i);
      const totalMatch = normalized.match(/(?:thành tiền|thanh tien|tổng cộng|tong cong|total)\s*[: ]\s*([0-9.,]+\s*đ?)/i);
      return {
        orderSuccessText,
        paymentSuccessText,
        orderCode: orderCodeMatch?.[1] || orderCodeMatch?.[0] || "",
        totalText: totalMatch?.[1] || "",
      };
    }).catch(() => ({ orderSuccessText: false, paymentSuccessText: false, orderCode: "", totalText: "" }));

    const hasSuccessText = isPaymentMonitor ? details.paymentSuccessText : details.orderSuccessText || details.paymentSuccessText;
    if (!urlLooksDone && !hasSuccessText) return null;
    return {
      orderUrl: currentUrl,
      orderCode: details.orderCode || `COOP-${Date.now().toString().slice(-6)}`,
      totalText: details.totalText || undefined,
    };
  }

  // Phát hiện giao dịch KHÔNG thành công / bị hủy từ cổng thanh toán để báo cho người dùng,
  // tránh treo màn hình mà không có phản hồi. Không đánh dấu hoàn tất đơn.
  async function emitPaymentFailureIfDetected() {
    if (completionSent || paymentFailureSent || !page || page.isClosed() || ws.readyState !== WebSocket.OPEN) return false;
    const gateway = rememberGatewayPaymentResult(page.url()) || lastGatewayPaymentResult;
    if (!gateway || gateway.paid) return false;
    paymentFailureSent = true;
    sendLog(`Co.opmart: Giao dịch thanh toán chưa thành công hoặc đã hủy (mã ${gateway.rawCode || "?"}).`, "warning");
    sendStatus("coop_payment_failed", {
      provider: "coop",
      gateway: gateway.gateway,
      rawCode: gateway.rawCode,
      paymentUrl: gateway.paymentUrl || page.url(),
      orderCode: lastPaymentOrderCode || gateway.code || undefined,
    });
    await sendScreenshotFrame();
    return true;
  }

  function stopCompletionMonitor() {
    if (completionMonitor) clearInterval(completionMonitor);
    completionMonitor = null;
  }

  async function emitCompletionIfDetected(source = "screen_share_monitor") {
    if (completionSent || !page || page.isClosed() || ws.readyState !== WebSocket.OPEN) return false;
    const completion = await detectOrderCompletion(source);
    if (!completion) return false;
    completionSent = true;
    stopCompletionMonitor();
    const resolvedOrderCode = lastPaymentOrderCode || completion.orderCode;
    sendLog(`Co.opmart: Phát hiện đặt hàng thành công${resolvedOrderCode ? ` (${resolvedOrderCode})` : ""}.`, "success");
    sendStatus("completed", {
      provider: "coop",
      source,
      ...completion,
      orderCode: resolvedOrderCode,
    });
    await sendScreenshotFrame();
    return true;
  }

  function startCompletionMonitor(label = "checkout") {
    stopCompletionMonitor();
    completionSent = false;
    paymentFailureSent = false;
    const startedAt = Date.now();
    completionMonitor = setInterval(async () => {
      if (completionSent || !page || page.isClosed() || ws.readyState !== WebSocket.OPEN) {
        stopCompletionMonitor();
        return;
      }
      if (Date.now() - startedAt > 20 * 60 * 1000) {
        sendLog(`Co.opmart: Hết thời gian theo dõi kết quả đặt hàng (${label}).`, "warning");
        stopCompletionMonitor();
        return;
      }
      const done = await emitCompletionIfDetected(label);
      if (!done) await emitPaymentFailureIfDetected();
    }, 1500);
  }

  function isPaymentGatewayUrl(rawUrl) {
    try {
      const url = new URL(rawUrl);
      return /(^|\.)pay\.vnpay\.vn$/i.test(url.hostname) || /momo|payment|transaction/i.test(url.href);
    } catch {
      return false;
    }
  }

  function bindPaymentPageEvents(targetPage) {
    if (boundPaymentPages.has(targetPage)) return;
    boundPaymentPages.add(targetPage);
    targetPage.on("framenavigated", async (frame) => {
      if (frame !== targetPage.mainFrame()) return;
      const url = frame.url();
      rememberGatewayPaymentResult(url);
      if (targetPage !== page && isPaymentGatewayUrl(url)) {
        await switchScreencastPage(targetPage, "payment-navigation");
        return;
      }
      if (targetPage === page && isPaymentGatewayUrl(url)) {
        await targetPage.waitForLoadState("domcontentloaded", { timeout: 8000 }).catch(() => { });
        await sendScreenshotFrame();
      }
    });
    targetPage.on("request", (request) => {
      rememberGatewayPaymentResult(request.url());
    });
  }

  async function startScreencastForCurrentPage() {
    if (!context || !page || page.isClosed()) return;
    if (cdpSession) await cdpSession.detach().catch(() => { });
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
        if (!popupFocusState) {
          ws.send(JSON.stringify({
            type: "screencast",
            data: data,
            width: 1024,
            height: 768
          }));
        }
      } catch (err) { }
      cdpSession.send("Page.screencastFrameAck", { sessionId }).catch(() => { });
    });
  }

  async function switchScreencastPage(nextPage, reason = "payment-page") {
    if (!nextPage || nextPage.isClosed() || nextPage === page || ws.readyState !== WebSocket.OPEN) return;
    page = nextPage;
    bindPaymentPageEvents(page);
    await page.bringToFront().catch(() => { });
    await startScreencastForCurrentPage();
    await page.waitForLoadState("domcontentloaded", { timeout: 8000 }).catch(() => { });
    await page.waitForTimeout(300).catch(() => { });
    await sendScreenshotFrame();
    sendLog("Co.opmart: Đã chuyển stream sang màn hình thanh toán mới.", "info");
    sendStatus("coop_payment_ready", {
      provider: "coop",
      paymentUrl: page.url(),
      orderCode: lastPaymentOrderCode || undefined,
      source: reason,
    });
  }

  async function sendScreenshotFrame(options = {}) {
    if (!page || ws.readyState !== WebSocket.OPEN) return;
    try {
      const clip = normalizeClip(options.clip);
      const data = await page.screenshot({ type: "jpeg", quality: 62, clip });
      ws.send(JSON.stringify({
        type: "screencast",
        data: data.toString("base64"),
        width: clip.width,
        height: clip.height,
        sourceX: clip.x,
        sourceY: clip.y,
        sourceWidth: clip.width,
        sourceHeight: clip.height,
        mode: options.mode || (options.clip ? "partial" : "full"),
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
      deviceScaleFactor: 1,
      geolocation: { latitude: DEFAULT_GEO_LAT, longitude: DEFAULT_GEO_LON },
    });
    await context.grantPermissions(["geolocation"]);
    context.on("page", async (newPage) => {
      bindPaymentPageEvents(newPage);
      await newPage.waitForLoadState("domcontentloaded", { timeout: 8000 }).catch(() => { });
      if (isPaymentGatewayUrl(newPage.url())) {
        await switchScreencastPage(newPage, "payment-popup");
      }
    });

    page = await context.newPage();
    bindPaymentPageEvents(page);
    sendLog("Đã khởi tạo trình duyệt thành công.", "success");

    // Bước 1: Mở trang giữ chỗ để có DOM trước
    await page.setContent(`
      <html><body style="margin:0;background:#f8fafc;display:flex;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;color:#64748b;font-size:14px;">
        <div>Đang chờ lệnh từ Affree...</div>
      </body></html>
    `);

    // Bước 2: Khởi tạo CDP và bắt đầu screencast
    await startScreencastForCurrentPage();

    // Bước 3: Gửi 1 screenshot ngay lập tức để client không phải chờ frame CDP đầu tiên
    await sendScreenshotFrame();
    browserReady = true;
    while (queuedClientMessages.length > 0 && ws.readyState === WebSocket.OPEN) {
      await handleClientMessage(queuedClientMessages.shift());
    }

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
    clearPopupFrameInterval();
    sendPopupState(null);
    try {
      if (typeof extraAction === "function") {
        await extraAction();
      }
      sendLog(`Đang tiếp tục quy trình sau bước: ${reason}`, "info");
      sendStatus("running", { reason: `resume:${reason}` });

      const resumeOpts = { skipInitialGoto: true, existingTracer: activeTracer, resumeHistory: activeResumeHistory };
      const result = await runAgenticToolUseLoop(page, lastOrderPayload, sendLog, sendStatus, resumeOpts, sendMessage);
      
      if (result?.tracer) activeTracer = result.tracer;
      if (result?.filledFields) activeFilledFields = result.filledFields;
      if (result?.actionHistory) activeActionHistory = result.actionHistory;
      if (result?.resumeHistory) activeResumeHistory = result.resumeHistory;

      const aiHandled = result?.handled ?? result;
      if (!aiHandled) {
        sendLog("AI loop không xử lý được tiếp; giữ nguyên màn hình để user tự thao tác.", "warning");
      }
      // Trigger skill update nếu phiên đã kết thúc hoàn toàn
      if (activeTracer?.trace?.endTime) {
        const domain = domainFromUrl(lastOrderPayload.url || "");
        updateSkillFromSession(domain, activeTracer, activeTracer.trace.success || false, activeResumeHistory).catch(console.error);
      }
    } catch (err) {
      sendLog(`Lỗi khi tiếp tục quy trình: ${err.message}`, "error");
      sendStatus("failed", { error: err.message });
    } finally {
      isAutomating = false;
    }
  }

  async function detectTxnnPaymentPopup() {
    if (!page || page.isClosed()) return null;
    try {
      return await page.evaluate(() => {
        const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();
        const normalizeLower = (value) => normalize(value).toLowerCase();
        const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 1024;
        const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 768;
        const nodes = Array.from(document.querySelectorAll('div, section, article, aside, [role="dialog"]'));
        const candidates = nodes.map((node) => {
          const text = normalize(node.textContent || "");
          if (!text) return null;
          const textLower = normalizeLower(text);
          const style = window.getComputedStyle(node);
          if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity || '1') === 0) return null;
          const rect = node.getBoundingClientRect();
          if (rect.width < 180 || rect.height < 160) return null;
          const inViewport = rect.bottom > 0 && rect.right > 0 && rect.top < viewportHeight && rect.left < viewportWidth;
          if (!inViewport) return null;
          const buttons = Array.from(node.querySelectorAll('button, [role="button"]'))
            .map((el) => normalize(el.textContent || el.getAttribute('aria-label') || el.getAttribute('title') || ''))
            .filter(Boolean);
          const actionText = buttons.join(' | ');
          const actionLower = normalizeLower(actionText);
          const isInvoiceDetails =
            /hóa đơn chi tiết|hoa don chi tiet|chi tiết hóa đơn|chi tiet hoa don/.test(textLower) ||
            ((/thông tin đặt hàng|thong tin dat hang|tên người đặt|ten nguoi dat|số điện thoại|so dien thoai/.test(textLower)) &&
              (/xác nhận|xac nhan|đóng|dong|ok|xong/.test(actionLower) || /xác nhận|xac nhan/.test(textLower)));
          const isPaymentPopup = /qr|thanh toán|thanh toan|chuyển khoản|chuyen khoan/.test(textLower);
          const score =
            ((isPaymentPopup || isInvoiceDetails || /xác nhận|xac nhan|đặt hàng|dat hang/.test(textLower)) ? 5 : 0) +
            ((style.position === 'fixed' || style.position === 'absolute') ? 3 : 0) +
            ((Number(style.zIndex || '0') >= 10) ? 2 : 0) +
            (buttons.length ? 2 : 0);
          if (score < 5) return null;
          return {
            kind: isInvoiceDetails ? 'invoice_details' : isPaymentPopup ? 'payment' : 'dialog',
            title: buttons.find((item) => /xác nhận thanh toán|xác nhận|đặt hàng/i.test(item)) || text.slice(0, 120),
            text: text.slice(0, 1200),
            actions: buttons.filter((item, index, arr) => arr.indexOf(item) === index).slice(0, 6),
            bounds: {
              x: Math.max(0, Math.floor(rect.left)),
              y: Math.max(0, Math.floor(rect.top)),
              width: Math.min(viewportWidth, Math.ceil(rect.width)),
              height: Math.min(viewportHeight, Math.ceil(rect.height)),
            },
            score,
          };
        }).filter(Boolean);

        candidates.sort((a, b) => b.score - a.score);
        return candidates[0] || null;
      });
    } catch (err) {
      sendLog(`TXNN: lỗi khi detect popup thanh toán: ${err.message}`, "warning");
      return null;
    }
  }

  async function refreshTxnnPopupFocus(reason = "refresh") {
    const popup = await detectTxnnPaymentPopup();
    if (!popup) {
      clearPopupFrameInterval();
      if (popupFocusState) {
        sendLog(`TXNN: popup-focus đã đóng (${reason}).`, "info");
      }
      sendPopupState(null);
      return null;
    }
    sendPopupState(popup);
    await sendScreenshotFrame({ clip: popup.bounds, mode: "popup-focus" });
    startPopupFrameInterval();
    return popup;
  }

  async function detectTxnnCompletion() {
    try {
      await page.waitForTimeout(1200);
      const result = await page.evaluate(() => {
        const bodyText = (document.body.innerText || "").replace(/\s+/g, " ").trim();
        const popupRoot = Array.from(document.querySelectorAll('div, section, article, [role="dialog"]')).find((el) => {
          const text = (el.textContent || "").replace(/\s+/g, " ").trim();
          if (!text) return false;
          const style = window.getComputedStyle(el);
          return style.visibility !== 'hidden' && style.display !== 'none' && /đặt hàng thành công|mã đơn hàng/i.test(text);
        });
        const popupText = ((popupRoot?.textContent || bodyText) || "").replace(/\s+/g, " ").trim();
        const success = /đặt hàng thành công|mã đơn hàng/i.test(popupText);
        const orderCode = popupText.match(/Mã đơn hàng\s*:?\s*([A-Z0-9\-]+)/i)?.[1] || bodyText.match(/Mã đơn hàng\s*:?\s*([A-Z0-9\-]+)/i)?.[1] || null;
        return { success, orderCode, popupText };
      });
      if (result?.success) {
        clearPopupFrameInterval();
        sendPopupState(null);
        sendLog(`TXNN: phát hiện trạng thái completed${result.orderCode ? ` với mã đơn ${result.orderCode}` : ""}.`, "success");
        sendStatus("completed", {
          orderUrl: page.url(),
          orderCode: result.orderCode || undefined,
          successMessage: result.popupText || undefined,
        });
        return true;
      }
    } catch (err) {
      sendLog(`TXNN: lỗi khi dò completed state: ${err.message}`, "warning");
    }
    return false;
  }

  async function closeTxnnPopupByKeywords(keywords, popupLabel) {
    try {
      const closed = await page.evaluate(({ keywords }) => {
        const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
        const nodes = Array.from(document.querySelectorAll('div, section, article, [role="dialog"]'));
        const target = nodes.find((node) => {
          const text = normalize(node.textContent || "");
          if (!text) return false;
          const style = window.getComputedStyle(node);
          if (style.visibility === 'hidden' || style.display === 'none') return false;
          return keywords.some((keyword) => text.includes(normalize(keyword)));
        });
        if (!target) return false;

        const buttonCandidates = Array.from(target.querySelectorAll('button, [role="button"], .close, [aria-label], [title]'));
        const closeButton = buttonCandidates.find((button) => {
          const text = normalize(button.textContent || button.getAttribute('aria-label') || button.getAttribute('title') || '');
          return text === '×' || text === 'x' || /đóng|close|tắt|ok|xong|bỏ qua/.test(text);
        });
        if (closeButton) {
          closeButton.click();
          return true;
        }
        return false;
      }, { keywords });
      if (closed) {
        sendLog(`TXNN: đã đóng popup ${popupLabel}.`, "success");
        await page.waitForTimeout(900);
        return true;
      }
    } catch (err) {
      sendLog(`TXNN: lỗi khi đóng popup ${popupLabel}: ${err.message}`, "warning");
    }

    try {
      await page.keyboard.press("Escape");
      await page.waitForTimeout(500);
    } catch { }
    return false;
  }

  async function completeTxnnAfterFinalConfirmation() {
    await page.waitForTimeout(1200);
    await closeTxnnPopupByKeywords(["print hóa đơn", "in hóa đơn"], "print hóa đơn");
    await closeTxnnPopupByKeywords(["hóa đơn chi tiết", "hoa don chi tiet", "chi tiết hóa đơn"], "hóa đơn chi tiết");
    return detectTxnnCompletion();
  }

  async function resumeAgenticLoopBHX(reason, content = null) {
    try {
      if (reason === 'otp') {
        lastOrderPayload.step = 'otp'
        lastOrderPayload.otp = content
        sendLog(`Đã nhận được OTP ${content}`)
        
        isAutomating = true;
        const aiResult = await runAgenticToolUseLoop(page, lastOrderPayload, sendLog, sendStatus, { skipInitialGoto: true, resumeHistory: activeResumeHistory }, sendMessage);
        if (aiResult?.resumeHistory) activeResumeHistory = aiResult.resumeHistory;
        if (aiResult?.tracer) activeTracer = aiResult.tracer;
        if (aiResult?.handled) { isAutomating = false; return; }
      } else {
        const buySelectors = [
          ".icon__cart-footer",
          'span:has-text("Đặt hàng")',
        ];

        for (const sel of buySelectors) {
          try {
            let result = false;
            const btn = page.locator(sel).first();
            try {
              await btn.waitFor({ state: "visible", timeout: 3000 });
              result = true;
            } catch { }

            if (result) {
              await btn.scrollIntoViewIfNeeded();
              await btn.click();
              sendLog("Bach Hoa Xanh: Click lại nút Đặt hàng sau khi chọn giờ giao.", "success");
              sendMessage("Đã đặt hàng thành công.", "order_success");
              break;
            }
          } catch (err) {
            sendLog(`Lỗi khi kiểm tra selector ${sel}: ${err.message}`, "error");
          }
        }
      }
    } catch (err) {
      sendLog(`Lỗi khi tiếp tục quy trình: ${err.message}`, "error");
      sendStatus("failed", { error: err.message });
    } finally {
      sendLog("Bach Hoa Xanh: Kết thúc quy trình tự động hóa.", "info");
      isAutomating = false;
    }
  }

  // Tự động hóa tiến trình mua hàng
  // Chiến lược: Playbook-first → nếu playbook fail hoặc không xử lý xong → Tool-Use AI loop
  async function runAutomatedOrder(payload) {
    isAutomating = true;
    activeTracer = null;
    activeResumeHistory = null;
    try {
      sendStatus("running");
      const { chain } = payload;
      isBachHoaXanhFlow = chain === "bhx";

      if (isBachHoaXanhFlow) {
        sendMessage("Mở website Bách Hóa Xanh.");
      }

      const resolvedPlaybook = resolvePlaybook(payload);

      // ── Bước 1: Thử Playbook ────────────────────────────────────────────────
      let playbookResult = null;
      try {
        sendLog(`[Playbook] Kiểm tra playbook cho chain: ${chain.toUpperCase()}`, "info");
        playbookResult = await runPlaybook(page, payload, sendLog, sendStatus, sendMessage);
      } catch (playbookErr) {
        sendLog(`[Playbook] Thất bại: ${playbookErr.message} → chuyển sang AI Tool-Use`, "warning");
        playbookResult = null;
      }

      // Nếu playbook xử lý hoàn toàn (done: true) → kết thúc
      if (playbookResult?.done === true) {
        sendLog(`[Playbook] Đã xử lý xong đơn hàng.`, "success");
        isAutomating = false;
        return;
      }

      const shouldRunTxnnCssFallback =
        chain === "tuoixanhnhanhngon" &&
        !RUN_TXNN_AGENTIC &&
        typeof resolvedPlaybook?.playbook?.runCss === "function";

      if (shouldRunTxnnCssFallback) {
        sendLog(`[Playbook] RUN_TXNN_AGENTIC=false, chuyển sang CSS fallback của ${chain.toUpperCase()}.`, "warning");
        const cssFallbackResult = await resolvedPlaybook.playbook.runCss(page, payload, sendLog, sendStatus, sendMessage);
        if (cssFallbackResult?.done === true) {
          sendLog(`[Playbook] CSS fallback đã tiếp quản phiên hiện tại.`, "success");
          isAutomating = false;
          return;
        }
      }

      if (!HAS_LLM_API_KEY) {
        sendLog("⚠️ Chưa cấu hình API Key (QWEN/GEMINI/ANTHROPIC).", "error");
      }

      // ── Bước 2: AI Tool-Use Loop ────────────────────────────────────────────
      if (playbookResult === null) {
        sendLog(`[AI] Không có playbook phù hợp, dùng Agentic Tool-Use Loop.`, "info");
      } else {
        sendLog(`[AI] Playbook đã bootstrap, tiếp tục với Agentic Tool-Use Loop.`, "info");
      }

      const skipGoto = playbookResult !== null;
      const result = await runAgenticToolUseLoop(page, payload, sendLog, sendStatus, { skipInitialGoto: skipGoto }, sendMessage);

      if (result?.tracer) activeTracer = result.tracer;
      if (result?.resumeHistory) activeResumeHistory = result.resumeHistory;

      // Trigger skill update bất đồng bộ
      if (activeTracer) {
        const domain = domainFromUrl(payload.url || "");
        const isSuccess = activeTracer.trace?.success === true;
        updateSkillFromSession(domain, activeTracer, isSuccess, activeResumeHistory).catch((e) => {
          console.error("[Server] Skill update lỗi:", e.message);
        });
      }

    } catch (err) {
      sendLog(`Lỗi tiến trình đặt hàng: ${err.message}`, "error");
      sendStatus("failed", { error: err.message });
    } finally {
      isAutomating = false;
    }
  }

  async function cleanup() {
    console.log("[Agent Server] Đang dọn dẹp tài nguyên phiên...");
    clearPopupFrameInterval();
    try {
      stopCompletionMonitor();
      if (cdpSession) await cdpSession.detach().catch(() => { });
      if (context) await context.close().catch(() => { });
      if (browser) await browser.close().catch(() => { });
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
