/**
 * Affree AI Agentic Web Server
 * Sử dụng Playwright + WebSockets để truyền phát màn hình (CDP Screencast)
 * và nhận tương tác (chuột/phím) từ Client để tự động đặt hàng.
 * 
 * Quy định ngôn ngữ: Comments và chuỗi log tiếng Việt, biến/hàm tiếng Anh.
 */

const fs = require("fs");
const path = require("path");
const { spawn, execFileSync } = require("child_process");

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
const premiumOutletsPlaybook = require("./playbooks/premiumoutlets");
const walmartPlaybook = require("./playbooks/walmart");
const { getWalmartAccount } = require("./account-sheet");
const { updateSkillFromSession } = require("./skill-updater");
const { domainFromUrl } = require("./skill-store");

const PROXY_CONFIG = {
  bhx: {
    server: process.env.PROXY_SERVER,
    username: process.env.PROXY_USERNAME,
    password: process.env.PROXY_PASSWORD,
  },
  costco: {
    server: process.env.COSTCO_PROXY_SERVER,
    username: process.env.COSTCO_PROXY_USERNAME,
    password: process.env.COSTCO_PROXY_PASSWORD,
  }
}

const HAS_LLM_API_KEY = Boolean(
  process.env.QWEN_API_KEY || process.env.ANTHROPIC_API_KEY || process.env.GEMINI_API_KEY
);
const RUN_TXNN_AGENTIC = process.env.RUN_TXNN_AGENTIC === "true";

const PORT = process.env.PORT || 8080;
const wss = new WebSocket.Server({ port: PORT });
const DEFAULT_GEO_LAT = Number(process.env.AGENT_GEO_LAT || "10.8050");
const DEFAULT_GEO_LON = Number(process.env.AGENT_GEO_LON || "106.6650");
let managedXvfbProcess = null;

function commandExists(commandName) {
  try {
    execFileSync("sh", ["-lc", `command -v ${commandName}`], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function isDisplayReady(display) {
  if (!display || !commandExists("xdpyinfo")) return false;
  try {
    execFileSync("xdpyinfo", ["-display", display], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

async function ensureVirtualDisplayForHeadedBrowser(sendLog = () => { }) {
  if (process.platform !== "linux") return;
  if (isDisplayReady(process.env.DISPLAY)) return;

  if (!commandExists("Xvfb") || !commandExists("xdpyinfo")) {
    throw new Error(
      "Thiếu Xvfb/xdpyinfo để chạy browser headed trên Linux. Hãy chạy qua docker-entrypoint.sh hoặc cài: apt-get install -y xvfb x11-utils"
    );
  }

  if (process.env.DISPLAY) {
    sendLog(`[Agent Server] DISPLAY=${process.env.DISPLAY} không sẵn sàng; tự khởi động Xvfb thay thế.`, "warning");
  }
  const displayNumber = process.env.XVFB_DISPLAY_NUMBER || "99";
  const display = `:${displayNumber}`;
  process.env.DISPLAY = display;

  if (!managedXvfbProcess || managedXvfbProcess.killed) {
    sendLog(`[Agent Server] Không thấy DISPLAY; tự khởi động Xvfb tại ${display}.`, "info");
    managedXvfbProcess = spawn("Xvfb", [
      display,
      "-screen",
      "0",
      process.env.XVFB_SCREEN || "1920x1080x24",
      "-nolisten",
      "tcp",
      "-ac",
    ], {
      detached: false,
      stdio: ["ignore", "ignore", "pipe"],
    });

    managedXvfbProcess.stderr.on("data", (chunk) => {
      const text = String(chunk || "").trim();
      if (text) console.warn(`[Xvfb] ${text}`);
    });

    const cleanupXvfb = () => {
      if (managedXvfbProcess && !managedXvfbProcess.killed) {
        managedXvfbProcess.kill("SIGTERM");
      }
    };
    process.once("exit", cleanupXvfb);
    process.once("SIGINT", () => { cleanupXvfb(); process.exit(130); });
    process.once("SIGTERM", () => { cleanupXvfb(); process.exit(143); });
  }

  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (isDisplayReady(display)) {
      sendLog(`[Agent Server] Xvfb đã sẵn sàng tại DISPLAY=${display}.`, "success");
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(`Xvfb không sẵn sàng tại DISPLAY=${display}.`);
}

console.log(`[Agent Server] Đang chạy tại cổng ${PORT}...`);

wss.on("connection", async (ws, req) => {
  console.log("[Agent Server] Client mới đã kết nối. Đang khởi tạo trình duyệt...");
  const connectionUrl = new URL(req?.url || "/", `ws://localhost:${PORT}`);
  const connectionChain = String(connectionUrl.searchParams.get("chain") || "").toLowerCase();
  const isWalmartConnection = connectionChain === "walmart";
  const isPremiumOutletsConnection = connectionChain === "premiumoutlets";

  let browser = null;
  let context = null;
  let page = null;
  let cdpSession = null;
  let isAutomating = false;
  let lastOrderPayload = null;
  let cancelledByUser = false;
  let popupFocusState = null;
  let popupFrameInterval = null;
  let premiumOutletsVerifyMonitorToken = 0;
  let completionMonitor = null;
  let walmartCaptchaMonitor = null;
  let completionSent = false;
  let paymentFailureSent = false;
  let walmartFinalSubmitInFlight = false;
  let lastPaymentOrderCode = null;
  let lastGatewayPaymentResult = null;
  let browserReady = false;
  let isBachHoaXanhFlow = false;
  const queuedClientMessages = [];
  const boundPaymentPages = new WeakSet();
  // ws.on("message", ...) gọi handleClientMessage cho MỌI message tới mà
  // không chờ message trước xử lý xong — khi client bắn mousemove dồn dập
  // lúc giữ chuột (thao tác "nhấn và giữ" của Walmart), nhiều lệnh
  // page.mouse.move()/down()/up() có thể chạy chồng lấn và hoàn tất KHÔNG
  // đúng thứ tự gửi đi (do độ trễ CDP round-trip khác nhau), khiến con trỏ
  // di chuyển giật/lộn xộn thay vì một đường mượt — rõ hơn khi qua thêm một
  // hop WebSocket của orchestrator. Xâu chuỗi các lệnh qua messageQueue để
  // đảm bảo xử lý tuần tự, đúng thứ tự gửi.
  let messageQueue = Promise.resolve();

  let activeTracer = null; // Tracer cho phiên hiện tại (Self-Learning)
  let activeFilledFields = []; // Lưu lại danh sách field đã điền giữa các phiên pause/resume
  let activeActionHistory = []; // Lưu lại lịch sử hành động giữa các phiên pause/resume
  let activeResumeHistory = []; // Lưu conversation history cho Tool-Use mode

  // Gửi log qua bridge; chỉ log có audience="client" mới nên hiện ra UI client.
  function sendLog(message, status = "info", options = {}) {
    console.log(`[LOG - ${status}] ${message}`);
    try {
      ws.send(JSON.stringify({
        type: "log",
        message,
        status,
        audience: options.audience === "client" ? "client" : "internal",
      }));
    } catch (e) {
      // client disconnected
    }
  }

  function sendClientLog(message, status = "info") {
    sendLog(message, status, { audience: "client" });
  }

  function stopPremiumOutletsVerifyMonitor() {
    premiumOutletsVerifyMonitorToken += 1;
  }

  function updatePremiumOutletsVerifyPopupState(verifyState, verifyHint, popupOverride = null) {
    const popup = popupOverride || popupFocusState;
    if (!popup || popup.kind !== "human_verify" || !isPremiumOutletsPayload(lastOrderPayload || {})) {
      return;
    }
    sendPopupState({
      ...popup,
      verifyState,
      verifyHint,
    });
  }

  async function startPremiumOutletsVerifyMonitor() {
    if (!popupFocusState || popupFocusState.kind !== "human_verify" || !isPremiumOutletsPayload(lastOrderPayload || {})) return;
    const monitorToken = ++premiumOutletsVerifyMonitorToken;
    while (!page?.isClosed() && monitorToken === premiumOutletsVerifyMonitorToken) {
      const popup = await premiumOutletsPlaybook.detectPremiumOutletsVerifyFocus(page, { timeoutMs: 0 }).catch(() => null);
      if (monitorToken !== premiumOutletsVerifyMonitorToken) return;
      if (!popup) {
        updatePremiumOutletsVerifyPopupState("passed", "Widget đã pass, thả chuột ngay.");
        return;
      }
      if (popupFocusState?.verifyState !== "holding") {
        updatePremiumOutletsVerifyPopupState("holding", "Đang giữ verify… Worker sẽ báo ngay khi widget pass để bạn thả chuột.");
      }
      await page.waitForTimeout(250).catch(() => { });
    }
  }

  function sendPopupState(popup) {
    if (!popup || popup.kind !== "human_verify") {
      stopPremiumOutletsVerifyMonitor();
    }
    popupFocusState = popup || null;
    try {
      ws.send(JSON.stringify({
        type: "popup_state",
        open: Boolean(popup),
        popup: popup
          ? {
              mode: popup.mode,
              kind: popup.kind,
              view: popup.view,
              verifyState: popup.verifyState,
              verifyHint: popup.verifyHint,
              interaction: popup.interaction,
              holdDurationMs: popup.holdDurationMs,
              title: popup.title,
              text: popup.text,
              actions: popup.actions,
              scrollHint: popup.scrollHint,
              bounds: popup.bounds,
              qrBounds: popup.qrBounds,
              confirmBounds: popup.confirmBounds,
            }
          : undefined,
      }));
    } catch (e) { }
  }

  function getCurrentViewportBounds() {
    const viewport = page?.viewportSize?.() || { width: 1024, height: 768 };
    return {
      x: 0,
      y: 0,
      width: viewport.width,
      height: viewport.height,
      sourceX: 0,
      sourceY: 0,
    };
  }

  function getPopupFrameBounds(popup) {
    if (!popup) return null;
    if (popup.view === "qr" && popup.qrBounds) return popup.qrBounds;
    // Ở view confirm vẫn chụp toàn bộ popup sau khi đã scroll xuống cuối,
    // để user nhìn lại đúng ngữ cảnh như trước thay vì chỉ thấy riêng nút xác nhận.
    if (popup.view === "confirm") return popup.bounds;
    return popup.bounds;
  }

  function getInteractionFrameBounds(popup) {
    if (!popup) return null;
    if (popup.mode === "full-viewport") return getCurrentViewportBounds();
    return getPopupFrameBounds(popup) || popup.confirmBounds || popup.bounds || null;
  }

  function resolveInteractionFramePoint(popup, xRatio, yRatio) {
    const bounds = getInteractionFrameBounds(popup);
    if (!bounds) return null;
    return {
      bounds,
      x: Math.round(bounds.x + bounds.width * xRatio),
      y: Math.round(bounds.y + bounds.height * yRatio),
    };
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
    popupFrameInterval = setInterval(async () => {
      if (popupFocusState?.kind === "walmart_variant" && !popupFocusState.freezeBounds) {
        const nextBounds = await detectWalmartVariantBounds();
        if (nextBounds) popupFocusState.bounds = nextBounds;
      }
      const clip = getInteractionFrameBounds(popupFocusState);
      if (!clip) return;
      void sendScreenshotFrame({ clip, mode: `${popupFocusState.mode || "popup-focus"}-${popupFocusState.view || "full"}` });
    }, 1200);
  }

  async function detectWalmartVariantBounds() {
    if (!page || page.isClosed()) return null;
    const clip = await page.evaluate(() => {
      const viewportWidth = window.innerWidth || 1024;
      const viewportHeight = window.innerHeight || 768;
      const visible = (node) => {
        const rect = node.getBoundingClientRect();
        const style = window.getComputedStyle(node);
        return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
      };
      const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
      const candidates = Array.from(document.querySelectorAll(
        '[data-testid="variant-tile-chip"], [aria-label*="Color" i], [aria-label*="Size" i], button[data-automation-id*="variant" i]'
      )).filter((node) => {
        const rect = node.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < viewportHeight;
      });
      if (!candidates.length) return null;
      const title = Array.from(document.querySelectorAll('h1')).find((node) => {
        const rect = node.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      });
      const headings = Array.from(document.querySelectorAll("h1, h2, h3, h4, div, span, p")).filter((node) => {
        if (!visible(node)) return false;
        const ownText = clean(Array.from(node.childNodes)
          .filter((child) => child.nodeType === Node.TEXT_NODE)
          .map((child) => child.textContent)
          .join(" "));
        return /^(?:color|colour|clothing size|shoe size|size)\s*:/i.test(ownText);
      });
      const rects = [...candidates, title, ...headings].filter(Boolean).map((node) => node.getBoundingClientRect());
      const minTop = Math.min(...rects.map((rect) => rect.top).filter(Number.isFinite));
      const maxBottom = Math.max(...rects.map((rect) => rect.bottom).filter(Number.isFinite));
      const titleTop = title?.getBoundingClientRect().top;
      const top = Math.max(0, Math.min(Number.isFinite(titleTop) ? titleTop - 28 : minTop - 28, minTop - 28));
      const bottom = Math.min(viewportHeight, Math.max(maxBottom + 28, top + 360));
      return {
        x: 0,
        y: top,
        width: Math.max(420, Math.min(Math.round(viewportWidth * 0.76), viewportWidth - 8)),
        height: Math.max(320, bottom - top),
      };
    }).catch(() => null);
    return clip ? normalizeClip(clip) : null;
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
    return {
      ...clip,
      x,
      y,
      width,
      height,
      sourceX: Number.isFinite(Number(clip.sourceX)) ? Number(clip.sourceX) : x,
      sourceY: Number.isFinite(Number(clip.sourceY)) ? Number(clip.sourceY) : y,
    };
  }

  // Gửi message tự do về client (BHX dùng để gửi popup chọn giờ/OTP).
  function sendMessage(content, type = "message") {
    try {
      ws.send(JSON.stringify({ type, content }));
      if (type === "message") sendClientLog(content);
    } catch (e) {
      // client disconnected
    }
  }

  async function focusWalmartVariantArea() {
    if (!page || page.isClosed()) return;
    const clip = await detectWalmartVariantBounds() || normalizeClip({ x: 0, y: 120, width: 780, height: 648 });

    popupFocusState = {
      kind: "walmart_variant",
      view: "variant",
      title: "Chọn màu và size",
      text: "Chọn biến thể sản phẩm trước khi thêm vào giỏ.",
      actions: [],
      freezeBounds: true,
      bounds: normalizeClip(clip),
    };
    sendPopupState(popupFocusState);
    startPopupFrameInterval();
    await sendScreenshotFrame({ clip: popupFocusState.bounds, mode: "walmart-variant" });
  }

  function isPremiumOutletsPayload(payload = {}) {
    if (String(payload.chain || "").toLowerCase() === "premiumoutlets") return true;
    try {
      const hostname = new URL(payload.url || "").hostname.replace(/^www\./, "");
      return hostname === "premiumoutlets.com" || hostname === "shop.simon.com" || hostname.endsWith(".premiumoutlets.com");
    } catch {
      return false;
    }
  }

  async function detectPremiumOutletsFinalConfirmState() {
    if (!page || page.isClosed()) return null;
    return page.evaluate(() => {
      const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();
      const lower = (value) => normalize(value).toLowerCase();
      const isVisible = (node) => {
        if (!(node instanceof Element)) return false;
        const rect = node.getBoundingClientRect();
        const style = window.getComputedStyle(node);
        return rect.width > 48 && rect.height > 20 && style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || "1") > 0.01;
      };
      const action = Array.from(document.querySelectorAll('button, [role="button"], input[type="submit"]')).find((node) => {
        if (!isVisible(node)) return false;
        const text = lower(node.textContent || node.getAttribute?.("value") || node.getAttribute?.("aria-label") || "");
        return /pay now|place order|review order|xác nhận|xac nhan|đặt hàng|dat hang/.test(text);
      });
      if (!action) return null;
      return {
        label: normalize(action.textContent || action.getAttribute?.("value") || action.getAttribute?.("aria-label") || ""),
      };
    }).catch(() => null);
  }

  async function refreshPremiumOutletsPopupFocus(reason = "refresh", mode = "verify", preferredView = "full") {
    const detector = mode === "payment"
      ? premiumOutletsPlaybook.detectPremiumOutletsPaymentSection
      : premiumOutletsPlaybook.detectPremiumOutletsVerifyFocus;
    if (typeof detector !== "function") return null;
    const popup = await detector(page);
    if (!popup) {
      clearPopupFrameInterval();
      sendPopupState(null);
      return null;
    }
    popup.mode = mode === "verify" ? "full-viewport" : (popup.mode || "popup-focus");
    popup.view = preferredView || popup.view || "full";
    if (mode === "verify") {
      popup.verifyState = "idle";
      popup.verifyHint = "Giữ chuột trên nút Press & Hold. Khi worker báo pass thì thả chuột ngay.";
    }
    sendLog(`Premium Outlets: popup-focus ${reason} -> kind=${popup.kind}, view=${popup.view}`, "info");
    if (popup.mode === "full-viewport") {
      await page.bringToFront().catch(() => { });
    }
    sendPopupState(popup);
    const clip = getInteractionFrameBounds(popup);
    if (clip) {
      await sendScreenshotFrame({ clip, mode: `premiumoutlets-${popup.kind}-${popup.view || "full"}` });
    }
    startPopupFrameInterval();
    return popup;
  }

  async function advancePremiumOutletsPaymentState(source = "payment_selection") {
    const popup = await refreshPremiumOutletsPopupFocus(source, "payment", "full");
    if (popup) {
      if (popup.selectionComplete && popup.finalConfirmVisible) {
        clearPopupFrameInterval();
        sendPopupState(null);
        sendStatus("waiting_user_input", {
          reason: `Premium Outlets: đã chọn phương thức thanh toán${popup.finalConfirmLabel ? ` (${popup.finalConfirmLabel})` : ""}. Kiểm tra lại rồi bấm xác nhận bước cuối.`,
          requiredInput: "final_confirmation",
          orderUrl: page.url(),
        });
        return;
      }
      sendStatus("waiting_user_input", {
        reason: popup.text || "Premium Outlets: vùng payment vẫn đang mở, tiếp tục chọn phương thức thanh toán trên website thật.",
        requiredInput: "payment_selection",
        orderUrl: page.url(),
      });
      return;
    }

    const finalAction = await detectPremiumOutletsFinalConfirmState();
    if (finalAction) {
      sendStatus("waiting_user_input", {
        reason: `Premium Outlets: payment section đã xong. Kiểm tra lại rồi bấm ${finalAction.label || "nút xác nhận cuối"}.`,
        requiredInput: "final_confirmation",
        orderUrl: page.url(),
      });
      return;
    }

    sendLog("Premium Outlets: không còn detect được payment section; tiếp tục AI loop để đọc lại checkout state.", "warning");
    await resumeAgenticLoop(source);
  }

  async function waitForPremiumOutletsVerifyResolution(options = {}) {
    const timeoutMs = Math.max(1000, Number(options.timeoutMs) || 7000);
    const pollMs = Math.max(150, Number(options.pollMs) || 350);
    const deadline = Date.now() + timeoutMs;
    let lastPopup = null;

    while (!page?.isClosed() && Date.now() <= deadline) {
      const popup = await premiumOutletsPlaybook.detectPremiumOutletsVerifyFocus(page, { timeoutMs: 0 });
      if (!popup) {
        return { resolved: true, popup: null };
      }
      lastPopup = popup;
      await page.waitForTimeout(Math.min(pollMs, Math.max(0, deadline - Date.now()))).catch(() => { });
    }

    return { resolved: false, popup: lastPopup };
  }

  // Gửi cập nhật trạng thái đặt hàng về client
  function sendStatus(phase, details = {}) {
    if (
      phase === "waiting_user_input"
      && isWalmartPayload(lastOrderPayload || {})
      && ["address", "payment", "checkout_options"].includes(details?.pauseReason)
    ) {
      details = {
        ...details,
        pauseReason: "review",
        nativeForm: false,
      };
    }

    try {
      ws.send(JSON.stringify({ type: "status", phase, ...details }));
    } catch (e) { }

    if (phase === "waiting_user_input" && details?.requiredInput === "qr_payment") {
      void refreshTxnnPopupFocus("waiting_for_qr_payment", "qr").then((popup) => {
        if (!popup) {
          sendLog("TXNN: chưa detect được popup thanh toán thật, tạm giữ fallback hiện có.", "warning");
        }
      });
      return;
    }

    if (phase === "waiting_user_input" && details?.pauseReason === "premiumoutlets_verify" && isPremiumOutletsPayload(lastOrderPayload || {})) {
      void refreshPremiumOutletsPopupFocus("premiumoutlets_verify", "verify", "full").then((popup) => {
        if (!popup) {
          sendLog("Premium Outlets: chưa detect được vùng human verification để cast riêng.", "warning");
        }
      });
      return;
    }

    if (phase === "waiting_user_input" && details?.pauseReason === "payment_selection" && isPremiumOutletsPayload(lastOrderPayload || {})) {
      void refreshPremiumOutletsPopupFocus("payment_selection", "payment", "full").then((popup) => {
        if (!popup) {
          sendLog("Premium Outlets: chưa detect được vùng payment method để cast riêng.", "warning");
        }
      });
      return;
    }

    if (phase === "waiting_user_input" && details?.pauseReason === "variant" && isWalmartPayload(lastOrderPayload || {})) {
      if (details?.nativeForm && Array.isArray(details?.optionGroups) && details.optionGroups.length > 0) {
        clearPopupFrameInterval();
        sendPopupState(null);
        return;
      }
      void focusWalmartVariantArea();
      return;
    }

    if (phase === "waiting_user_input" && details?.pauseReason === "captcha" && isWalmartPayload(lastOrderPayload || {})) {
      clearPopupFrameInterval();
      sendPopupState(null);
      void page?.bringToFront().catch(() => { });
      void sendScreenshotFrame({ mode: "walmart-captcha" });
      startWalmartCaptchaMonitor();
      return;
    }

    if (phase === "waiting_user_input" && details?.pauseReason === "review" && isWalmartPayload(lastOrderPayload || {})) {
      clearPopupFrameInterval();
      sendPopupState(null);
      void page?.bringToFront().catch(() => { });
      void sendScreenshotFrame({ mode: "walmart-review" });
      return;
    }

    if (phase === "running" || phase === "completed" || phase === "failed" || phase === "cancelled") {
      stopWalmartCaptchaMonitor();
      clearPopupFrameInterval();
      sendPopupState(null);
    }
  }

  function isWalmartPayload(payload = {}) {
    if (String(payload.chain || "").toLowerCase() === "walmart") return true;
    try {
      const hostname = new URL(payload.url || "").hostname.replace(/^www\./, "");
      return hostname === "walmart.com" || hostname.endsWith(".walmart.com");
    } catch {
      return false;
    }
  }

  function bindContextPageEvents(targetContext) {
    targetContext.on("page", async (newPage) => {
      bindPaymentPageEvents(newPage);
      await newPage.waitForLoadState("domcontentloaded", { timeout: 8000 }).catch(() => { });
      if (isPaymentGatewayUrl(newPage.url())) {
        await switchScreencastPage(newPage, "payment-popup");
      }
    });
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
          sendClientLog(`Đã nhận lệnh đặt hàng cho: ${msg.payload?.productName || msg.productName || "unknown product"}`, "info");
          lastOrderPayload = msg.payload || msg;
          if (isWalmartPayload(lastOrderPayload) && !lastOrderPayload.account?.email) {
            try {
              const account = await getWalmartAccount();
              lastOrderPayload = {
                ...lastOrderPayload,
                account,
                customer: { ...(lastOrderPayload.customer || {}), email: lastOrderPayload.customer?.email || "" },
              };
              sendLog("Walmart: Đã lấy tài khoản đặt hộ từ sheet.", "success");
            } catch (error) {
              sendStatus("failed", { error: error.message });
              break;
            }
          }
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
              await page.waitForTimeout(100);

              sendLog(`Bach Hoa Xanh: Đã click lựa chọn giao hàng: ${optionText}`, "success");
              sendMessage("Đã hoàn tất chọn thời gian giao hàng.");
              await page.mouse.click(0, 0);
              await page.waitForTimeout(100);
              await resumeAgenticLoopBHX("submit");
            }
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
          if (isBachHoaXanhFlow) {
            await resumeAgenticLoopBHX("submit");
          } else if (isWalmartPayload(lastOrderPayload || {})) {
            if (walmartFinalSubmitInFlight || completionSent) break;
            walmartFinalSubmitInFlight = true;
            isAutomating = true;
            try {
              const selectors = [
                'button[type="submit"]:has-text("Continue")',
                'button.Button_primary___r9Bd:has-text("Continue")',
                'button[data-dca-intent="select"]:has-text("Continue")',
                'button:has-text("Continue")',
                'button:has-text("Place order")',
                'button:has-text("Submit order")',
                'button:has-text("Confirm order")',
              ];
              const readVisibleAlerts = async () => {
                const messages = [];
                for (const frame of [page.mainFrame(), ...page.frames().filter((candidate) => candidate !== page.mainFrame())]) {
                  const frameAlerts = await frame.locator('[role="alert"]').evaluateAll((alerts) => alerts
                    .filter((node) => {
                      const text = String(node.textContent || "").replace(/\s+/g, " ").trim();
                      const style = window.getComputedStyle(node);
                      const rect = node.getBoundingClientRect();
                      return Boolean(text)
                        && style.display !== "none"
                        && style.visibility !== "hidden"
                        && style.opacity !== "0"
                        && rect.width > 0
                        && rect.height > 0;
                    })
                    .map((node) => String(node.textContent || "").replace(/\s+/g, " ").trim()))
                    .catch(() => []);
                  messages.push(...frameAlerts);
                }
                return messages;
              };
              let clicked = false;
              for (const selector of selectors) {
                const button = page.locator(selector).first();
                if (!await button.isVisible({ timeout: 1200 }).catch(() => false)) continue;
                const disabled = await button.evaluate((el) => Boolean(el.disabled || el.getAttribute("aria-disabled") === "true")).catch(() => false);
                if (disabled) continue;
                await button.scrollIntoViewIfNeeded().catch(() => { });
                await page.waitForTimeout(250);
                await button.click({ timeout: 4000 }).catch(async () => button.click({ force: true, timeout: 4000 }));
                clicked = true;
                sendLog("Walmart: Đã bấm Continue cuối cùng sau khi người dùng xác nhận.", "success");
                break;
              }
              if (!clicked) {
                sendStatus("waiting_user_input", {
                  pauseReason: "post_payment",
                  reason: "Walmart chưa sẵn sàng nút Continue. Vui lòng kiểm tra lại form thanh toán.",
                });
                sendLog("Walmart: Không tìm thấy nút Continue cuối cùng.", "warning");
                break;
              }
              await page.waitForLoadState("domcontentloaded", { timeout: 10000 }).catch(() => { });
              // Walmart giữ nguyên trang khi payment có lỗi và render role=alert.
              // Quét cả main frame lẫn iframe; bất kỳ alert visible có text nào
              // sau submit đều là lỗi thật, không phụ thuộc câu chữ cụ thể.
              const alertDeadline = Date.now() + 6500;
              let walmartPaymentError = "";
              while (Date.now() < alertDeadline && !walmartPaymentError) {
                const visibleAlerts = await readVisibleAlerts();
                walmartPaymentError = visibleAlerts[0] || "";
                if (!walmartPaymentError) await page.waitForTimeout(250);
              }
              if (walmartPaymentError) {
                sendStatus("waiting_user_input", {
                  pauseReason: "review",
                  reason: `Walmart báo lỗi thanh toán: ${walmartPaymentError.replace(/^error:\s*/i, "").trim()}`,
                });
                sendLog(`Walmart: Form thanh toán báo lỗi: ${walmartPaymentError.replace(/\s+/g, " ").trim()}`, "warning");
                await sendScreenshotFrame({ mode: "walmart-payment-error" }).catch(() => { });
                break;
              }
              completionSent = true;
              sendStatus("completed", {
                provider: "walmart",
                source: "confirm_final_action",
                orderUrl: page.url(),
                successMessage: "Đặt hàng Walmart thành công.",
              });
              await sendScreenshotFrame({ mode: "walmart-order-completed" }).catch(() => { });
            } catch (error) {
              sendStatus("waiting_user_input", {
                pauseReason: "post_payment",
                reason: `Walmart chưa hoàn tất đặt hàng: ${error.message}`,
              });
            } finally {
              isAutomating = false;
              if (!completionSent) walmartFinalSubmitInFlight = false;
            }
          } else {
            await resumeAgenticLoop("confirm_final_action", async () => {
              try {
                await page.getByText(/đặt hàng|xác nhận|mua ngay|hoàn tất/i).first().click({ timeout: 3000 });
                sendLog("Đã thử click nút xác nhận cuối cùng trên trang.", "success");
              } catch (err) {
                sendLog("Không tìm thấy nút xác nhận cuối cùng bằng matcher tổng quát, AI sẽ tự tiếp tục.", "warning");
              }
            });
          }
          break;

        case "payment_submitted": {
          await handleTxnnPaymentSubmitted({
            source: "payment_submitted",
            logMessage: "Đã nhận tín hiệu người dùng báo thanh toán xong, bắt đầu xác minh lại trang.",
            resumeReason: "payment_submitted",
            clickConfirmButton: true,
            missingConfirmLog: "Không thấy nút xác nhận cuối sau khi user báo thanh toán; sẽ tiếp tục bằng AI loop để tự dò lại trang.",
            errorLogPrefix: "Lỗi khi thử click nút xác nhận cuối sau thanh toán",
          });
          break;
        }

        case "coop_payment_scanned": {
          sendLog("Co.opmart: Người dùng đã quét QR, kiểm tra trạng thái giao dịch ngay.", "info");
          const completed = await emitCompletionIfDetected("coop_payment");
          if (!completed) {
            sendStatus("coop_payment_verifying", { provider: "coop" });
            startCompletionMonitor("coop_payment");
          }
          break;
        }

        case "popup_switch_view": {
          if (isAutomating) break;
          const nextView = msg.view === "confirm" || msg.view === "full" ? msg.view : "qr";
          const popup = await refreshTxnnPopupFocus(`popup_switch_view:${nextView}`, nextView);
          if (!popup) {
            sendLog("TXNN: không chuyển được popup view vì popup thanh toán không còn hiển thị.", "warning");
          }
          break;
        }

        case "popup_click": {
          if (!popupFocusState || isAutomating) break;
          const clickedPopupView = popupFocusState.view;
          const bounds = getPopupFrameBounds(popupFocusState) || popupFocusState.confirmBounds || popupFocusState.bounds;
          const xRatio = Math.min(1, Math.max(0, Number(msg.xRatio) || 0));
          const yRatio = Math.min(1, Math.max(0, Number(msg.yRatio) || 0));
          const x = Math.round(bounds.x + bounds.width * xRatio);
          const y = Math.round(bounds.y + bounds.height * yRatio);
          await page.mouse.click(x, y);
          await page.waitForTimeout(900);

          if (popupFocusState.kind === "payment_selection" && isPremiumOutletsPayload(lastOrderPayload || {})) {
            await advancePremiumOutletsPaymentState("payment_selection_click");
            break;
          }

          const popup = await refreshTxnnPopupFocus("popup_click", popupFocusState?.view);
          if (clickedPopupView === "confirm") {
            await handleTxnnPaymentSubmitted({
              source: "popup_click_confirm",
              logMessage: "User đã click nút xác nhận trong popup; tự chuyển sang bước verify thanh toán.",
              resumeReason: "popup_click_confirm",
              clickConfirmButton: false,
              missingConfirmLog: "Popup xác nhận đã đóng sau khi user click; không cần click lại nút xác nhận, tiếp tục verify luôn.",
              errorLogPrefix: "Lỗi khi tự verify sau popup click xác nhận",
            });
          } else {
            sendLog("Popup thanh toán đã đóng sau thao tác của user; vẫn chờ user bấm xác nhận đã thanh toán để bắt đầu verify.", "info");
            sendStatus("waiting_user_input", {
              reason: "Popup thanh toán đã đóng. Hệ thống vẫn chờ user xác nhận đã thanh toán xong trước khi kiểm tra hoàn tất.",
              requiredInput: "qr_payment",
            });
            await sendScreenshotFrame();
          }
          break;
        }

        case "frame_click": {
          if (!popupFocusState || isAutomating) break;
          const point = resolveInteractionFramePoint(
            popupFocusState,
            Math.min(1, Math.max(0, Number(msg.xRatio) || 0)),
            Math.min(1, Math.max(0, Number(msg.yRatio) || 0)),
          );
          if (!point) break;
          await page.mouse.click(point.x, point.y);
          await page.waitForTimeout(150);
          await sendScreenshotFrame({ clip: point.bounds, mode: `interaction-click-${popupFocusState.mode || "popup-focus"}` });
          break;
        }

        case "frame_mousedown": {
          if (!popupFocusState || isAutomating) break;
          const point = resolveInteractionFramePoint(
            popupFocusState,
            Math.min(1, Math.max(0, Number(msg.xRatio) || 0)),
            Math.min(1, Math.max(0, Number(msg.yRatio) || 0)),
          );
          if (!point) break;
          await page.mouse.move(point.x, point.y);
          await page.mouse.down();
          if (popupFocusState.kind === "human_verify" && isPremiumOutletsPayload(lastOrderPayload || {})) {
            updatePremiumOutletsVerifyPopupState("holding", "Đang giữ verify… Worker sẽ báo ngay khi widget pass để bạn thả chuột.");
            void startPremiumOutletsVerifyMonitor();
          }
          break;
        }

        case "frame_mousemove": {
          if (!popupFocusState || isAutomating) break;
          const point = resolveInteractionFramePoint(
            popupFocusState,
            Math.min(1, Math.max(0, Number(msg.xRatio) || 0)),
            Math.min(1, Math.max(0, Number(msg.yRatio) || 0)),
          );
          if (!point) break;
          await page.mouse.move(point.x, point.y);
          break;
        }

        case "frame_mouseup": {
          if (!popupFocusState || isAutomating) break;
          const point = resolveInteractionFramePoint(
            popupFocusState,
            Math.min(1, Math.max(0, Number(msg.xRatio) || 0)),
            Math.min(1, Math.max(0, Number(msg.yRatio) || 0)),
          );
          if (!point) break;
          await page.mouse.move(point.x, point.y);
          await page.mouse.up();
          await page.waitForTimeout(600);
          if (popupFocusState.kind === "human_verify" && isPremiumOutletsPayload(lastOrderPayload || {})) {
            stopPremiumOutletsVerifyMonitor();
            updatePremiumOutletsVerifyPopupState("checking", "Đã thả chuột. Worker đang kiểm tra verify để tự tiếp tục mua hàng.");
            const verifyResult = await waitForPremiumOutletsVerifyResolution();
            if (verifyResult.resolved) {
              clearPopupFrameInterval();
              sendPopupState(null);
              sendLog("Premium Outlets: human verification đã biến mất sau thao tác người dùng; tiếp tục lại playbook Premium Outlets.", "success");
              await page.waitForLoadState("domcontentloaded", { timeout: 8000 }).catch(() => { });
              await page.waitForTimeout(600);
              const continueResult = await premiumOutletsPlaybook.continueAfterVerify(page, lastOrderPayload, sendLog, sendStatus);
              if (continueResult?.needsAgentic) {
                await resumeAgenticLoop(`premiumoutlets_verify_resolved:${continueResult.resumedPath || "fallback"}`);
              }
            } else {
              const popup = verifyResult.popup;
              if (popup) {
                popup.mode = "full-viewport";
                popup.view = "full";
                popup.verifyState = "failed";
                popup.verifyHint = "Verify chưa pass / đã reset, vui lòng giữ lại hoặc thử lại.";
                sendPopupState(popup);
                const clip = getInteractionFrameBounds(popup);
                if (clip) {
                  await sendScreenshotFrame({ clip, mode: `premiumoutlets-${popup.kind}-${popup.view || "full"}` });
                }
                startPopupFrameInterval();
              }
              sendLog("Premium Outlets: human verification vẫn còn hiển thị sau khi thả chuột; tiếp tục giữ fullscreen interaction frame để người dùng thao tác thêm.", "info");
            }
            break;
          }
          await sendScreenshotFrame({ clip: point.bounds, mode: `interaction-mouseup-${popupFocusState.mode || "popup-focus"}` });
          break;
        }

        case "frame_wheel": {
          if (!popupFocusState || isAutomating) break;
          const point = resolveInteractionFramePoint(
            popupFocusState,
            Math.min(1, Math.max(0, Number(msg.xRatio) || 0)),
            Math.min(1, Math.max(0, Number(msg.yRatio) || 0)),
          );
          if (!point) break;
          await page.mouse.move(point.x, point.y);
          await page.mouse.wheel(Number(msg.deltaX) || 0, Number(msg.deltaY) || 0);
          await page.waitForTimeout(160);
          await sendScreenshotFrame({ clip: point.bounds, mode: `interaction-wheel-${popupFocusState.mode || "popup-focus"}` });
          break;
        }

        case "frame_keypress":
          if (!popupFocusState || isAutomating || !msg.key) break;
          await page.keyboard.press(String(msg.key));
          await page.waitForTimeout(120);
          await sendScreenshotFrame({ clip: getInteractionFrameBounds(popupFocusState), mode: `interaction-keypress-${popupFocusState.mode || "popup-focus"}` });
          break;

        case "popup_hold": {
          if (!popupFocusState || isAutomating) break;
          const xRatio = Math.min(1, Math.max(0, Number(msg.xRatio) || 0));
          const yRatio = Math.min(1, Math.max(0, Number(msg.yRatio) || 0));
          const holdMs = Math.max(250, Math.min(10000, Number(msg.durationMs) || popupFocusState.holdDurationMs || 1800));

          const performHold = async (focusState) => {
            const bounds = focusState.confirmBounds || getPopupFrameBounds(focusState) || focusState.bounds;
            const x = Math.round(bounds.x + bounds.width * xRatio);
            const y = Math.round(bounds.y + bounds.height * yRatio);
            await page.mouse.move(x, y);
            await page.mouse.down();
            await page.waitForTimeout(holdMs);
            await page.mouse.up();
            await page.waitForTimeout(900);
          };

          if (popupFocusState.kind === "human_verify" && isPremiumOutletsPayload(lastOrderPayload || {})) {
            sendLog("Premium Outlets: bỏ nhánh auto popup_hold; chờ người dùng thao tác trực tiếp trên fullscreen interaction frame.", "info");
            sendStatus("waiting_user_input", {
              reason: popupFocusState.text || "Premium Outlets: hãy nhấn và giữ trực tiếp trên fullscreen interaction frame để hoàn tất human verification.",
              requiredInput: "captcha",
              orderUrl: page.url(),
            });
            break;
          }

          await performHold(popupFocusState);
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
          if (msg.reason === "variant" && lastOrderPayload && isWalmartPayload(lastOrderPayload)) {
            lastOrderPayload = { ...lastOrderPayload, variantConfirmed: true };
          }
          await resumeAgenticLoop(msg.reason || "manual_resume", async () => {
            const note = msg.note || "";
            if (note) sendLog(`Ghi chú người dùng: ${note}`, "info");
            sendLog("Người dùng đã xác nhận hoàn thành bước thủ công. Tiếp tục...", "success");
          });
          break;

        case "walmart_submit_credentials": {
          if (!lastOrderPayload || !isWalmartPayload(lastOrderPayload)) {
            sendStatus("failed", { error: "Không có phiên Walmart để cập nhật tài khoản." });
            break;
          }
          const email = String(msg.account?.email || "").trim();
          const password = String(msg.account?.password || "");
          if (!email || !password) {
            sendStatus("waiting_user_input", {
              reason: "Vui lòng nhập email và mật khẩu Walmart.",
              pauseReason: "credentials",
            });
            break;
          }
          lastOrderPayload = {
            ...lastOrderPayload,
            account: { email, password },
            customer: { ...(lastOrderPayload.customer || {}), email },
          };
          sendLog("Walmart: Đã nhận tài khoản, bắt đầu đăng nhập.", "success");
          await resumeAgenticLoop("credentials_submitted");
          break;
        }

        case "walmart_submit_options": {
          if (!lastOrderPayload || !isWalmartPayload(lastOrderPayload)) {
            sendStatus("failed", { error: "Không có phiên Walmart để cập nhật lựa chọn." });
            break;
          }
          const stage = String(msg.stage || "");
          const selections = msg.selections || {};
          try {
            if (await walmartBlockingOverlayVisible()) {
              const modalResult = await walmartPlaybook.handleKnownModal(page);
              if (modalResult.handled) {
                sendLog(`Walmart: Playwright đã xử lý popup ${modalResult.action}.`, "success");
              } else {
                await pauseForWalmartCaptcha("Walmart đang yêu cầu xác minh trước khi chọn biến thể. Vui lòng xử lý trực tiếp trên màn hình.");
                break;
              }
            }

            // ── stage: color_preview — click màu trên Walmart thật, re-extract size mới ──
            if (stage === "color_preview") {
              const colorSelection = selections.color;
              if (!colorSelection) break;
              try {
                await walmartPlaybook.applyOptions(page, { color: colorSelection });
                sendLog(`Walmart: Đã click màu ${colorSelection.label || colorSelection}, đang đọc lại size...`, "info");
                await page.waitForTimeout(700);
                const freshGroups = await walmartPlaybook.extractVariantGroups(page);
                // Đánh dấu đang trong quá trình chọn variant để AI không hỏi lại
                lastOrderPayload = { ...lastOrderPayload, _colorSelected: colorSelection.label || colorSelection };
                sendStatus("waiting_user_input", {
                  reason: "Vui lòng chọn màu và kích thước.",
                  pauseReason: "variant",
                  optionGroups: freshGroups,
                  nativeForm: true,
                });
              } catch (colorErr) {
                sendLog(`Walmart: Không click được màu (${colorErr.message}), giữ nguyên UI.`, "warning");
                sendStatus("waiting_user_input", {
                  reason: "Không click được màu trên Walmart. Vui lòng chọn lại hoặc thử màu khác.",
                  pauseReason: "variant",
                  optionGroups: await walmartPlaybook.extractVariantGroups(page).catch(() => []),
                  nativeForm: true,
                });
              }
              break;
            }

            const applied = await walmartPlaybook.applyOptions(page, selections);
            sendLog(`Walmart: Đã áp dụng lựa chọn ${applied.join(", ") || stage}.`, "success");
            if (stage === "variant") {
              lastOrderPayload = { ...lastOrderPayload, variantConfirmed: true };
              const cartResult = await walmartPlaybook.addProductToCart(page, lastOrderPayload);
              if (cartResult.success) {
                lastOrderPayload = { ...lastOrderPayload, cartReady: true };

                // Tự động fill địa chỉ giao hàng từ Affree vào Walmart cart
                if (lastOrderPayload.addressSynced) {
                  sendLog("Walmart: Địa chỉ đã được đồng bộ sau login, không mở panel địa chỉ lần hai.", "info");
                } else {
                  sendLog("Walmart: Đang cập nhật địa chỉ giao hàng...", "info");
                  const addrResult = await walmartPlaybook.fillAddressInCart(page, lastOrderPayload);
                  if (addrResult.skipped) {
                    sendLog("Walmart: Địa chỉ đã đúng, bỏ qua cập nhật.", "info");
                  } else if (addrResult.success) {
                    lastOrderPayload = { ...lastOrderPayload, addressSynced: true };
                    sendLog("Walmart: Đã cập nhật địa chỉ giao hàng thành công.", "success");
                  } else {
                    sendLog(`Walmart: Không cập nhật được địa chỉ (${addrResult.reason}), tiếp tục checkout.`, "warning");
                  }
                }

                const checkoutResult = await walmartPlaybook.advanceCheckoutToPayment(page);
                if (!checkoutResult.success) {
                  sendLog(`Walmart: Chưa mở được phần thanh toán (${checkoutResult.reason || "unknown"}), chuyển AI fallback.`, "warning");
                  await resumeAgenticLoop("variant_selected");
                  break;
                }

                isAutomating = false;
                await sendScreenshotFrame({ mode: "walmart-payment" });
                sendStatus("waiting_user_input", {
                  reason: "Walmart đã xác nhận địa chỉ và mở phần thanh toán. Vui lòng xác nhận thông tin thẻ trên Affree để tiếp tục.",
                  pauseReason: "review",
                  checkoutUrl: page.url(),
                  nativeForm: false,
                });
              } else {
                await resumeAgenticLoop("variant_selected");
              }
              break;
            }

            await sendScreenshotFrame({ mode: "walmart-review" }).catch(() => { });
            sendStatus("waiting_user_input", {
              reason: "Walmart đã mở màn hình cần thao tác. Vui lòng tiếp tục trực tiếp trên màn hình Walmart.",
              pauseReason: "review",
              checkoutUrl: page.url(),
              nativeForm: false,
            });
          } catch (error) {
            const message = String(error?.message || error || "");
            const blockedByOverlay = /intercepts pointer events|OverlayScrim|ModalPortal|robot or human|captcha|press\s*&?\s*hold|nhấn\s+và\s+giữ|vui lòng thử lại/i.test(message)
              || await walmartBlockingOverlayVisible();
            if (blockedByOverlay) {
              await pauseForWalmartCaptcha("Walmart đang có màn hình xác minh/lớp phủ che lựa chọn. Vui lòng xử lý trực tiếp trên màn hình.");
              break;
            }
            sendLog(`Walmart: Không áp dụng được lựa chọn (${message}), mở màn hình dự phòng.`, "warning");
            sendStatus("waiting_user_input", {
              reason: "Walmart đã cập nhật giao diện. Vui lòng chọn trực tiếp trên màn hình.",
              pauseReason: stage === "variant" ? "variant" : "review",
              nativeForm: false,
            });
          }
          break;
        }

        case "walmart_confirm_order": {
          if (!lastOrderPayload || !isWalmartPayload(lastOrderPayload)) {
            sendStatus("failed", { error: "Không có phiên Walmart để xác nhận đơn." });
            break;
          }
          if (walmartFinalSubmitInFlight) break;
          const payment = msg.payment || {};
          const cardNumber = String(payment.cardNumber || "").replace(/\D/g, "");
          const cvv = String(payment.cvv || "").replace(/\D/g, "");
          if (cardNumber.length < 12 || cvv.length < 3 || !payment.expiryMonth || !payment.expiryYear) {
            sendStatus("waiting_user_input", { pauseReason: "review", reason: "Thông tin thẻ chưa hợp lệ." });
            break;
          }
          walmartFinalSubmitInFlight = true;
          isAutomating = true;
          try {
            sendLog("Walmart: Đã nhận thông tin thẻ, đang điền form thanh toán.", "info");
            const result = await walmartPlaybook.fillPaymentAndContinue(page, {
              cardNumber,
              expiryMonth: String(payment.expiryMonth),
              expiryYear: String(payment.expiryYear),
              cvv,
              cardholderName: String(payment.cardholderName || ""),
              phone: String(lastOrderPayload.address?.phone || lastOrderPayload.buyerPhone || ""),
            });
            if (!result.success) {
              sendStatus("waiting_user_input", { pauseReason: "review", reason: `Walmart chưa gửi được đơn (${result.reason}).` });
              break;
            }
            await sendScreenshotFrame({ mode: "walmart-after-payment" });
            sendStatus("waiting_user_input", { pauseReason: "post_payment", reason: "Walmart đã điền đủ thông tin thẻ. Vui lòng kiểm tra và xác nhận đặt hàng trên Affree." });
            sendLog("Walmart: Đã điền đủ thông tin thẻ và dừng trước nút Continue thanh toán.", "success");
          } catch (error) {
            sendStatus("waiting_user_input", { pauseReason: "review", reason: `Walmart chưa hoàn tất thanh toán: ${error.message}` });
          } finally {
            walmartFinalSubmitInFlight = false;
            isAutomating = false;
          }
          break;
        }

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
            const paymentCard = normalizeCoopPaymentCard(msg.paymentCard);
            if (paymentCard) {
              const gatewaySelection = await selectCoopVnpayCardGateway(paymentCard);
              if (gatewaySelection.selected) {
                sendLog(`Co.opmart: Đã chọn cổng thẻ ${gatewaySelection.brandLabel} trên VNPay.`, "success");
              } else if (gatewaySelection.reason !== "already_on_card_form") {
                sendLog(`Co.opmart: Chưa tự chọn được logo thẻ trên VNPay (${gatewaySelection.reason}). Sẽ thử fill trực tiếp nếu form đã mở.`, "warning");
              }
              const fillResult = await fillCoopGatewayCardAndSubmit(paymentCard);
              if (fillResult.success) {
                sendLog(`Co.opmart: Đã auto-fill thẻ ****${paymentCard.cardNumber.slice(-4)} trên VNPay và bấm nút thanh toán.`, "success");
              } else {
                sendLog(`Co.opmart: Chưa auto-fill/xác nhận được VNPay (${fillResult.reason}). Bạn có thể thao tác trực tiếp trên màn hình stream.`, "warning");
              }
            }
            sendStatus("coop_payment_ready", {
              provider: "coop",
              paymentUrl: msg.paymentUrl,
              orderCode: msg.orderCode,
              paymentMethodCode: msg.paymentMethodCode,
            });
            await page.waitForTimeout(800);
            await sendScreenshotFrame();
            sendLog("Co.opmart: Màn hình thanh toán đã sẵn sàng, đang theo dõi kết quả giao dịch.", "success");
            startCompletionMonitor("coop_payment");
          } catch (err) {
            sendLog(`Co.opmart mở màn hình thanh toán lỗi: ${err.message}`, "error");
            sendStatus("failed", { error: err.message });
          } finally {
            isAutomating = false;
          }
          break;

        case "coop_payment_qr_snapshot":
          if (isAutomating) {
            sendLog("Hiện đang chạy một quy trình tự động khác.", "warning");
            break;
          }
          if (!msg.paymentUrl || typeof msg.paymentUrl !== "string") {
            sendStatus("failed", { error: "missing_payment_url" });
            sendLog("Co.opmart: Thiếu URL thanh toán để lấy mã QR.", "error");
            break;
          }
          isAutomating = true;
          lastPaymentOrderCode = typeof msg.orderCode === "string" && msg.orderCode ? msg.orderCode : null;
          lastGatewayPaymentResult = null;
          paymentFailureSent = false;
          try {
            sendLog(`Co.opmart: Đang mở trang thanh toán ${msg.paymentMethodName || msg.paymentMethodCode || ""} để lấy mã QR...`, "info");
            await page.goto(msg.paymentUrl, { waitUntil: "commit", timeout: 30000 });
            await page.waitForLoadState("domcontentloaded", { timeout: 15000 }).catch(() => {
              sendLog("Trang thanh toán đã bắt đầu tải nhưng chưa báo domcontentloaded.", "warning");
            });
            const qrImage = await capturePaymentQrImage();
            sendStatus("coop_payment_qr_ready", {
              provider: "coop",
              paymentUrl: msg.paymentUrl,
              orderCode: msg.orderCode,
              paymentMethodCode: msg.paymentMethodCode,
              qrImageBase64: qrImage.base64,
              qrContentType: qrImage.contentType,
              qrClipFound: qrImage.clipFound,
              qrSource: qrImage.source,
            });
            sendLog("Co.opmart: Đã lấy mã QR thanh toán, đang theo dõi kết quả giao dịch.", "success");
            startCompletionMonitor("coop_payment");
          } catch (err) {
            sendLog(`Co.opmart lấy mã QR thanh toán lỗi: ${err.message}`, "error");
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

  ws.on("message", (data) => {
    messageQueue = messageQueue.then(() => handleClientMessage(data)).catch((e) => {
      console.error("[Agent Server] Lỗi xử lý message (queue):", e);
    });
  });

  function normalizeCoopPaymentCard(raw) {
    if (!raw || typeof raw !== "object") return null;
    const toVnpayAscii = (value) => String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/đ/g, "d")
      .replace(/Đ/g, "D")
      .replace(/[^\x20-\x7E]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    const cardNumber = String(raw.cardNumber || "").replace(/\D/g, "");
    const cvv = String(raw.cvv || "").replace(/\D/g, "");
    const expiryMonth = String(raw.expiryMonth || "").replace(/\D/g, "").padStart(2, "0").slice(0, 2);
    const expiryYearRaw = String(raw.expiryYear || "").replace(/\D/g, "");
    const expiryYear = expiryYearRaw.length === 2 ? `20${expiryYearRaw}` : expiryYearRaw.slice(0, 4);
    if (cardNumber.length < 12 || cvv.length < 3 || !expiryMonth || expiryYear.length < 4) return null;
    const inferredBrand =
      /^9704/.test(cardNumber) ? "napas" :
        /^4/.test(cardNumber) ? "visa" :
          /^(5[1-5]|2[2-7])/.test(cardNumber) ? "mastercard" :
            /^35/.test(cardNumber) ? "jcb" :
              /^(34|37)/.test(cardNumber) ? "amex" :
                "";
    const brand = String(raw.brand || inferredBrand).trim().toLowerCase();
    return {
      cardNumber,
      cvv,
      expiryMonth,
      expiryYear,
      expiryShort: `${expiryMonth}/${expiryYear.slice(-2)}`,
      cardholderName: toVnpayAscii(raw.cardholderName).toUpperCase(),
      email: String(raw.email || "").trim(),
      billingAddress: toVnpayAscii(raw.billingAddress || raw.address),
      addressLine: toVnpayAscii(raw.addressLine),
      city: toVnpayAscii(raw.city),
      district: toVnpayAscii(raw.district),
      ward: toVnpayAscii(raw.ward),
      brand: brand.includes("master") ? "mastercard" :
        brand.includes("visa") ? "visa" :
          brand.includes("jcb") ? "jcb" :
            brand.includes("amex") || brand.includes("american") ? "amex" :
              brand.includes("napas") ? "napas" :
                inferredBrand,
    };
  }

  async function selectCoopVnpayCardGateway(payment) {
    if (!page || page.isClosed()) return { selected: false, reason: "payment_page_closed" };
    const brand = payment.brand || "";
    const alreadyOnCardForm = await page.evaluate(() => {
      const text = String(document.body?.innerText || "").replace(/\s+/g, " ");
      const hasCardNumberInput = Array.from(document.querySelectorAll("input")).some((input) => {
        const info = [
          input.name,
          input.id,
          input.getAttribute("autocomplete"),
          input.getAttribute("placeholder"),
          input.getAttribute("aria-label"),
        ].filter(Boolean).join(" ").toLowerCase();
        const rect = input.getBoundingClientRect();
        const style = window.getComputedStyle(input);
        return rect.width > 0
          && rect.height > 0
          && style.display !== "none"
          && style.visibility !== "hidden"
          && /cc-number|cardnumber|card-number|card_number|\bpan\b|số thẻ|so the|card no|card number/.test(info);
      });
      return hasCardNumberInput || /số thẻ|so the|card number|cardholder|cvv|cvc/i.test(text) && !/chọn phương thức thanh toán/i.test(text);
    }).catch(() => false);
    if (alreadyOnCardForm) return { selected: false, reason: "already_on_card_form" };

    const brandMatchers = {
      visa: [/visa/i],
      mastercard: [/master\s*card/i, /mastercard/i, /\bmc\b/i],
      jcb: [/\bjcb\b/i],
      amex: [/amex/i, /american\s*express/i],
      napas: [/napas/i, /thẻ nội địa/i, /the noi dia/i, /tài khoản ngân hàng/i, /tai khoan ngan hang/i],
      unknown: [/thẻ thanh toán quốc tế/i, /the thanh toan quoc te/i, /international card/i, /card/i],
    };
    const selectedBrand = brand && brandMatchers[brand] ? brand : "unknown";
    const exactPaymethod = {
      visa: "VISA",
      mastercard: "MASTERCARD",
      jcb: "JCB",
      amex: "AMEX",
    }[selectedBrand];
    if (exactPaymethod) {
      const clickedExact = await page.evaluate((value) => {
        const button = document.querySelector(`button[name="paymethod"][value="${value}"], #${value}`);
        if (!button) return false;
        button.click();
        return true;
      }, exactPaymethod).catch(() => false);
      if (clickedExact) {
        await page.waitForLoadState("domcontentloaded", { timeout: 15000 }).catch(() => { });
        await page.waitForTimeout(1200).catch(() => { });
        await sendScreenshotFrame({ mode: `coop-vnpay-selected-${selectedBrand}` }).catch(() => { });
        return {
          selected: true,
          brand: selectedBrand,
          brandLabel: selectedBrand === "mastercard" ? "Mastercard" :
            selectedBrand === "amex" ? "Amex" :
              selectedBrand.toUpperCase(),
        };
      }
    }

    const patterns = (brandMatchers[selectedBrand] || []).map((item) => item.source);
    const clicked = await page.evaluate(({ sources, brandName }) => {
      const regexes = sources.map((source) => new RegExp(source, "i"));
      const isVisible = (el) => {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        return rect.width > 0
          && rect.height > 0
          && style.display !== "none"
          && style.visibility !== "hidden"
          && Number(style.opacity || "1") > 0.01;
      };
      const scoreElement = (el) => {
        const imageText = Array.from(el.querySelectorAll?.("img") || [])
          .map((img) => [img.alt, img.title, img.src, img.getAttribute("data-src")].filter(Boolean).join(" "))
          .join(" ");
        const closestCardText = String(el.closest?.("a, button, [onclick], [role='button'], li, .card, .payment-method, div")?.textContent || "");
        const haystack = [
          el.textContent,
          closestCardText,
          el.getAttribute?.("aria-label"),
          el.getAttribute?.("title"),
          el.getAttribute?.("href"),
          el.getAttribute?.("src"),
          el.getAttribute?.("alt"),
          el.getAttribute?.("class"),
          imageText,
        ].filter(Boolean).join(" ").replace(/\s+/g, " ");
        if (!regexes.some((regex) => regex.test(haystack))) return 0;
        const rect = el.getBoundingClientRect();
        const tag = el.tagName.toLowerCase();
        let score = 1;
        if (/button|a/.test(tag)) score += 4;
        if (el.getAttribute?.("onclick")) score += 3;
        if (rect.width >= 48 && rect.height >= 32) score += 2;
        if (/chọn phương thức thanh toán|the thanh toan quoc te|thẻ thanh toán quốc tế/i.test(document.body?.innerText || "")) score += 1;
        if (brandName === "napas" && /thẻ nội địa|the noi dia|tài khoản ngân hàng|tai khoan ngan hang/i.test(haystack)) score += 8;
        if (brandName === "unknown" && /thẻ thanh toán quốc tế|the thanh toan quoc te|international card/i.test(haystack)) score += 8;
        if (brandName !== "unknown" && brandName !== "napas" && /visa|master|jcb|amex|american/i.test(haystack)) score += 4;
        return score;
      };
      const candidates = [];
      for (const node of Array.from(document.querySelectorAll("a, button, img, [onclick], [role='button'], div, li, span"))) {
        if (!isVisible(node)) continue;
        const interactive = node.closest("a, button, [onclick], [role='button']") || node.closest("div, li") || node;
        if (!interactive || !isVisible(interactive)) continue;
        const score = Math.max(scoreElement(node), scoreElement(interactive));
        if (score > 0) candidates.push({ el: interactive, score });
      }
      candidates.sort((a, b) => b.score - a.score);
      const target = candidates[0]?.el;
      if (!target) return false;
      target.scrollIntoView({ block: "center", inline: "center" });
      target.click();
      return true;
    }, { sources: patterns, brandName: selectedBrand }).catch(() => false);

    if (!clicked) {
      await sendScreenshotFrame({ mode: `coop-vnpay-select-${selectedBrand}-missing` }).catch(() => { });
      return { selected: false, reason: `brand_button_not_found:${selectedBrand}` };
    }

    await page.waitForLoadState("domcontentloaded", { timeout: 10000 }).catch(() => { });
    await page.waitForTimeout(1000).catch(() => { });
    await sendScreenshotFrame({ mode: `coop-vnpay-selected-${selectedBrand}` }).catch(() => { });
    return {
      selected: true,
      brand: selectedBrand,
      brandLabel: selectedBrand === "mastercard" ? "Mastercard" :
        selectedBrand === "amex" ? "Amex" :
          selectedBrand === "napas" ? "Napas / thẻ nội địa" :
            selectedBrand === "unknown" ? "Thẻ thanh toán quốc tế" :
              selectedBrand.toUpperCase(),
    };
  }

  async function fillCoopGatewayCardAndSubmit(payment) {
    if (!page || page.isClosed()) return { success: false, reason: "payment_page_closed" };

    const fillResult = await page.evaluate((card) => {
      const isVisible = (el) => {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        return rect.width > 0
          && rect.height > 0
          && style.display !== "none"
          && style.visibility !== "hidden"
          && Number(style.opacity || "1") > 0.01
          && !el.disabled
          && !el.readOnly;
      };
      const textFor = (el) => {
        const parts = [
          el.name,
          el.id,
          el.getAttribute("autocomplete"),
          el.getAttribute("aria-label"),
          el.getAttribute("placeholder"),
          el.getAttribute("data-testid"),
          el.getAttribute("class"),
        ];
        if (el.id) {
          const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
          if (label) parts.push(label.textContent || "");
        }
        const wrap = el.closest("label, .form-group, .form-item, .input-group, div");
        if (wrap) parts.push(wrap.textContent || "");
        return parts.filter(Boolean).join(" ").replace(/\s+/g, " ").toLowerCase();
      };
      const textInputs = Array.from(document.querySelectorAll("input, textarea")).filter(isVisible);
      const selects = Array.from(document.querySelectorAll("select")).filter(isVisible);
      const setNativeValue = (el, value) => {
        const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
        if (setter) setter.call(el, value);
        else el.value = value;
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        el.dispatchEvent(new Event("blur", { bubbles: true }));
      };
      const fillInput = (patterns, value, exclude = []) => {
        const input = textInputs.find((candidate) => {
          const haystack = textFor(candidate);
          return patterns.some((pattern) => pattern.test(haystack)) && !exclude.some((pattern) => pattern.test(haystack));
        });
        if (!input) return false;
        input.focus();
        setNativeValue(input, value);
        return true;
      };
      const chooseSelect = (patterns, values) => {
        const select = selects.find((candidate) => {
          const haystack = textFor(candidate);
          return patterns.some((pattern) => pattern.test(haystack));
        });
        if (!select) return false;
        const option = Array.from(select.options).find((item) => {
          const optionText = `${item.value} ${item.textContent || ""}`.toLowerCase();
          return values.some((value) => optionText.includes(value.toLowerCase()));
        });
        if (!option) return false;
        select.value = option.value;
        select.dispatchEvent(new Event("input", { bubbles: true }));
        select.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      };

      const filled = {
        number: fillInput([/cc-number|cardnumber|card-number|card_number|\bpan\b|so the|số thẻ|card no|card number|napas/], card.cardNumber, [/otp|pin|cvv|cvc|security/]),
        name: card.cardholderName
          ? fillInput([/cc-name|cardholder|card-holder|holder|chu the|chủ thẻ|name/], card.cardholderName, [/otp|pin|cvv|cvc|security/])
          : false,
        cvv: fillInput([/cc-csc|cvv|cvc|security|bao mat|bảo mật/], card.cvv, [/otp|pin/]),
        expiry: fillInput([/cc-exp|expiry|expire|expiration|carddate|ngày hết hạn|ngay het han|hạn thẻ|han the|valid thru/], card.expiryShort, [/cvv|cvc|security|otp|pin/]),
        email: card.email ? fillInput([/email|mail/], card.email, [/promo/]) : false,
        billingAddress: card.billingAddress
          ? fillInput([/address|billing|street|địa chỉ|dia chi|đường|duong|nhập địa chỉ|nhap dia chi/], card.billingAddress, [/email|promo/])
          : false,
        addressLine: card.addressLine
          ? fillInput([/street|address line|line 1|số nhà|so nha|đường|duong|địa chỉ|dia chi|nhập địa chỉ|nhap dia chi/], card.addressLine, [/email|promo/])
          : false,
        city: card.city ? fillInput([/city|tỉnh|thành phố|tinh|thanh pho/], card.city, [/promo/]) : false,
        district: card.district ? fillInput([/district|quận|huyện|quan|huyen/], card.district, [/promo/]) : false,
        ward: card.ward ? fillInput([/ward|phường|xã|phuong|xa/], card.ward, [/promo/]) : false,
        month: false,
        year: false,
      };
      if (!filled.expiry) {
        filled.month = fillInput([/cc-exp-month|expirymonth|expiry-month|month|tháng|thang/], card.expiryMonth, [/cvv|cvc|security|otp|pin/])
          || chooseSelect([/cc-exp-month|expirymonth|expiry-month|month|tháng|thang/], [card.expiryMonth, String(Number(card.expiryMonth))]);
        filled.year = fillInput([/cc-exp-year|expiryyear|expiry-year|year|năm|nam/], card.expiryYear, [/cvv|cvc|security|otp|pin/])
          || chooseSelect([/cc-exp-year|expiryyear|expiry-year|year|năm|nam/], [card.expiryYear, card.expiryYear.slice(-2)]);
      }
      return filled;
    }, payment).catch((err) => ({ error: err.message }));

    if (fillResult.error) return { success: false, reason: fillResult.error };
    if (!fillResult.number || !fillResult.cvv || (!fillResult.expiry && (!fillResult.month || !fillResult.year))) {
      await sendScreenshotFrame({ mode: "coop-vnpay-card-fill-partial" }).catch(() => { });
      return { success: false, reason: `fields:${JSON.stringify(fillResult)}` };
    }

    await page.waitForTimeout(400).catch(() => { });
    const submitPatterns = [
      /thanh\s*to[aá]n/i,
      /pay(?!ment method)/i,
      /ti[eế]p\s*t[uụ]c/i,
      /x[aá]c\s*nh[aậ]n/i,
      /continue/i,
      /submit/i,
    ];
    for (const pattern of submitPatterns) {
      const button = page.getByRole("button", { name: pattern }).first();
      if (!await button.isVisible({ timeout: 700 }).catch(() => false)) continue;
      const disabled = await button.evaluate((el) => Boolean(el.disabled || el.getAttribute("aria-disabled") === "true")).catch(() => false);
      if (disabled) continue;
      await button.scrollIntoViewIfNeeded().catch(() => { });
      await button.click({ timeout: 3000 }).catch(async () => button.click({ force: true, timeout: 3000 }));
      await page.waitForLoadState("domcontentloaded", { timeout: 8000 }).catch(() => { });
      await sendScreenshotFrame({ mode: "coop-vnpay-after-card-submit" }).catch(() => { });
      return { success: true };
    }

    const clickedByText = await page.evaluate((patterns) => {
      const regexes = patterns.map((source) => new RegExp(source, "i"));
      const candidates = Array.from(document.querySelectorAll("button, input[type='submit'], input[type='button'], a"));
      const target = candidates.find((el) => {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        const text = String(el.textContent || el.value || el.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim();
        return rect.width > 0
          && rect.height > 0
          && style.display !== "none"
          && style.visibility !== "hidden"
          && Number(style.opacity || "1") > 0.01
          && regexes.some((regex) => regex.test(text));
      });
      if (!target) return false;
      target.click();
      return true;
    }, submitPatterns.map((item) => item.source)).catch(() => false);
    if (!clickedByText) return { success: false, reason: "submit_button_not_found" };
    await page.waitForLoadState("domcontentloaded", { timeout: 8000 }).catch(() => { });
    await sendScreenshotFrame({ mode: "coop-vnpay-after-card-submit" }).catch(() => { });
    return { success: true };
  }

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

  function stopWalmartCaptchaMonitor() {
    if (walmartCaptchaMonitor) clearInterval(walmartCaptchaMonitor);
    walmartCaptchaMonitor = null;
  }

  async function walmartCaptchaStillVisible() {
    if (!page || page.isClosed()) return false;
    return page.evaluate(() => {
      const bodyText = String(document.body?.innerText || "").replace(/\s+/g, " ");
      const dialogText = Array.from(document.querySelectorAll("iframe, [role='dialog'], div, main"))
        .slice(0, 300)
        .map((node) => String(node.getAttribute?.("title") || node.getAttribute?.("aria-label") || node.textContent || ""))
        .join(" ")
        .replace(/\s+/g, " ");
      const text = `${bodyText} ${dialogText}`;
      return /robot or human|press\s*&\s*hold|activate and hold|confirm that you'?re human|please try again|nhấn\s+và\s+giữ|nhan\s+va\s+giu|vui lòng thử lại|vui long thu lai/i.test(text);
    }).catch(() => false);
  }

  async function walmartBlockingOverlayVisible() {
    if (!page || page.isClosed()) return false;
    if (await walmartCaptchaStillVisible()) return true;
    return page.evaluate(() => {
      const captchaPattern = /robot or human|press\s*&\s*hold|activate and hold|confirm that you'?re human|please try again|nhấn\s+và\s+giữ|nhan\s+va\s+giu|vui lòng thử lại|vui long thu lai/i;
      const selectors = [
        '[class*="OverlayScrim_scrim"]',
        '[class*="ModalPortal_scrim"]',
        '.OverlayScrim_scrim__x5LLJ',
        '.ModalPortal_scrim__jLfxn',
        '[aria-modal="true"]',
        '[role="dialog"]',
      ];

      return selectors.some((selector) => {
        const node = document.querySelector(selector);
        if (!node) return false;
        const rect = node.getBoundingClientRect();
        const style = window.getComputedStyle(node);
        if (rect.width <= 0 || rect.height <= 0) return false;
        if (style.display === "none" || style.visibility === "hidden") return false;
        if (Number(style.opacity || "1") <= 0.01) return false;
        if (style.pointerEvents === "none") return false;

        const text = String(node.textContent || node.getAttribute?.("aria-label") || "");
        const className = String(node.className || "");
        return captchaPattern.test(text) || /OverlayScrim|ModalPortal/.test(className);
      });
    }).catch(() => false);
  }

  async function pauseForWalmartCaptcha(reason = "Walmart đang yêu cầu xác minh. Vui lòng thao tác trên màn hình rồi Affree sẽ tự tiếp tục.") {
    if (!page || page.isClosed()) {
      sendStatus("failed", { error: "Trình duyệt Walmart đã đóng." });
      return;
    }
    isAutomating = false;
    clearPopupFrameInterval();
    sendPopupState(null);
    sendLog("Walmart: CAPTCHA hoặc lớp xác minh đang che màn hình. Chuyển sang stream để người dùng xử lý.", "warning");
    await page.bringToFront().catch(() => { });
    sendStatus("waiting_user_input", {
      reason,
      pauseReason: "captcha",
      nativeForm: false,
    });
  }

  function startWalmartCaptchaMonitor() {
    stopWalmartCaptchaMonitor();
    if (!lastOrderPayload || !isWalmartPayload(lastOrderPayload) || !page || page.isClosed()) return;

    const startedAt = Date.now();
    const startUrl = page.url();
    let sawCaptchaText = false;

    walmartCaptchaMonitor = setInterval(async () => {
      if (
        !lastOrderPayload ||
        !isWalmartPayload(lastOrderPayload) ||
        !page ||
        page.isClosed() ||
        ws.readyState !== WebSocket.OPEN
      ) {
        stopWalmartCaptchaMonitor();
        return;
      }
      if (isAutomating) return;

      if (Date.now() - startedAt > 10 * 60 * 1000) {
        stopWalmartCaptchaMonitor();
        return;
      }

      const currentUrl = page.url();
      const urlChanged = currentUrl !== startUrl;
      const leftBlockedPage = /walmart\.com\/blocked/i.test(startUrl) && !/walmart\.com\/blocked/i.test(currentUrl);
      const stillVisible = await walmartCaptchaStillVisible();
      if (stillVisible) {
        sawCaptchaText = true;
        return;
      }

      const waitedLongEnough = Date.now() - startedAt > 1200;
      if (!leftBlockedPage && !urlChanged && (!sawCaptchaText || !waitedLongEnough)) return;

      stopWalmartCaptchaMonitor();
      sendLog("Walmart: CAPTCHA đã được xử lý, tự tiếp tục luồng.", "success");
      await resumeAgenticLoop("captcha_auto_resolved", async () => {
        await page.waitForLoadState("domcontentloaded", { timeout: 8000 }).catch(() => { });
        await page.waitForTimeout(600);
      });
    }, 1000);
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

  async function capturePaymentQrImage() {
    if (!page || page.isClosed()) throw new Error("Trang thanh toán chưa sẵn sàng.");

    const parseDataImage = (src) => {
      if (typeof src !== "string") return null;
      const match = /^data:(image\/[a-z0-9.+-]+);base64,([\s\S]+)$/i.exec(src.trim());
      if (!match) return null;
      return {
        base64: match[2].replace(/\s/g, ""),
        contentType: match[1],
        clipFound: true,
        source: "data-url",
      };
    };

    await page.waitForSelector(".qr-section img.qrcodeimg-modal[src^='data:image/png;base64'], img.qrcodeimg-modal[src^='data:image/png;base64']", {
      state: "attached",
      timeout: 15000,
    }).catch(() => { });

    const findQrDataImageInFrame = (frame) => frame.evaluate(() => {
      const preferredSelectors = [
        ".qr-section img.qrcodeimg-modal[src^='data:image/png;base64']",
        "img.qrcodeimg-modal[src^='data:image/png;base64']",
        "img.qrcodeimg-modal",
        ".qr img[src^='data:image']",
        "img[alt='QR CODE']",
        "img[alt*='QR']",
        "img[src^='data:image/png;base64']",
      ];
      const readSrc = (img) => img?.getAttribute("src") || img?.currentSrc || img?.src || "";
      const visibleScore = (node) => {
        const rect = node?.getBoundingClientRect?.();
        if (!rect || rect.width < 80 || rect.height < 80) return 0;
        const ratio = rect.width / rect.height;
        if (ratio < 0.7 || ratio > 1.35) return 0;
        const text = (node.closest?.("section, div, main, body")?.textContent || "").slice(0, 800).toLowerCase();
        let score = Math.min(rect.width, rect.height);
        if (/qr|qrcode|quét mã|quet ma|vnpay|thanh toán|thanh toan/.test(text)) score += 260;
        if (Math.abs(rect.width - rect.height) < 24) score += 120;
        return score;
      };
      for (const selector of preferredSelectors) {
        const src = readSrc(document.querySelector(selector));
        if (src.startsWith("data:image/")) return src;
      }
      const canvas = Array.from(document.querySelectorAll("canvas"))
        .map((node) => ({ node, score: visibleScore(node) }))
        .filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score)[0]?.node;
      if (canvas && typeof canvas.toDataURL === "function") {
        const src = canvas.toDataURL("image/png");
        if (src.startsWith("data:image/")) return src;
      }
      const images = Array.from(document.querySelectorAll("img"));
      const dataImageCandidates = [];
      for (const img of images) {
        const src = readSrc(img);
        if (!src.startsWith("data:image/")) continue;
        const label = [
          img.getAttribute("alt"),
          img.getAttribute("class"),
          img.getAttribute("id"),
          img.closest(".qr, [class*='qr'], [id*='qr']")?.getAttribute("class"),
          img.closest(".qr, [class*='qr'], [id*='qr']")?.getAttribute("id"),
        ].filter(Boolean).join(" ").toLowerCase();
        if (/qr|qrcode|vnpay|momo/.test(label)) return src;
        const score = visibleScore(img);
        if (score > 0) dataImageCandidates.push({ src, score });
      }
      dataImageCandidates.sort((a, b) => b.score - a.score);
      if (dataImageCandidates[0]?.src) return dataImageCandidates[0].src;
      return "";
    });
    const findQrDataImage = async () => {
      for (const frame of page.frames()) {
        const src = await findQrDataImageInFrame(frame).catch(() => "");
        if (src) return src;
      }
      return "";
    };

    await page.waitForTimeout(800).catch(() => { });
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const dataImage = parseDataImage(await findQrDataImage().catch(() => ""));
      if (dataImage) return dataImage;
      await page.waitForTimeout(500).catch(() => { });
    }

    const findQrClip = () => page.evaluate(() => {
      const viewportWidth = window.innerWidth || 1024;
      const viewportHeight = window.innerHeight || 768;
      const nodes = Array.from(document.querySelectorAll("img, canvas, svg"));
      let best = null;
      for (const node of nodes) {
        const rect = node.getBoundingClientRect();
        const width = rect.width;
        const height = rect.height;
        if (width < 90 || height < 90) continue;
        const ratio = width / height;
        if (ratio < 0.65 || ratio > 1.55) continue;
        const attrs = [
          node.getAttribute("src"),
          node.getAttribute("alt"),
          node.getAttribute("aria-label"),
          node.getAttribute("class"),
          node.id,
        ].filter(Boolean).join(" ").toLowerCase();
        const text = (node.closest("section, div, main, body")?.textContent || "").slice(0, 700).toLowerCase();
        let score = Math.min(width, height);
        if (/qr|qrcode|vietqr|vnpay|momo/.test(attrs)) score += 220;
        if (/qr|quét mã|quet ma|thanh toán|thanh toan|vnpay|momo/.test(text)) score += 160;
        if (Math.abs(width - height) < 45) score += 80;
        if (rect.top >= -20 && rect.left >= -20 && rect.top < viewportHeight && rect.left < viewportWidth) score += 40;
        if (!best || score > best.score) {
          best = { score, x: rect.left + window.scrollX, y: rect.top + window.scrollY, width, height };
        }
      }
      if (best) {
        const padding = 32;
        return {
          x: Math.max(0, best.x - padding),
          y: Math.max(0, best.y - padding),
          width: Math.min(viewportWidth, best.width + padding * 2),
          height: Math.min(viewportHeight, best.height + padding * 2),
          clipFound: true,
        };
      }
      const side = Math.min(640, viewportWidth, viewportHeight);
      return {
        x: Math.max(0, (viewportWidth - side) / 2),
        y: Math.max(0, (viewportHeight - side) / 2),
        width: side,
        height: side,
        clipFound: false,
      };
    });
    let rawClip = await findQrClip();
    for (let attempt = 0; attempt < 6 && !rawClip?.clipFound; attempt += 1) {
      await page.waitForTimeout(800).catch(() => { });
      rawClip = await findQrClip();
    }

    await page.evaluate((clip) => {
      window.scrollTo({ top: Math.max(0, Number(clip.y) - 80), left: 0, behavior: "instant" });
    }, rawClip).catch(() => { });
    await page.waitForTimeout(250).catch(() => { });

    const adjustedClip = await page.evaluate((clip) => {
      return {
        x: Number(clip.x) || 0,
        y: Math.max(0, (Number(clip.y) || 0) - window.scrollY),
        width: Number(clip.width) || 640,
        height: Number(clip.height) || 640,
      };
    }, rawClip).catch(() => rawClip);
    const clip = normalizeClip(adjustedClip);
    const buffer = await page.screenshot({ type: "jpeg", quality: 82, clip });
    return {
      base64: buffer.toString("base64"),
      contentType: "image/jpeg",
      clipFound: Boolean(rawClip?.clipFound),
      source: "screenshot",
    };
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
        sourceX: Number.isFinite(Number(options.sourceX)) ? Number(options.sourceX) : (Number.isFinite(Number(clip.sourceX)) ? Number(clip.sourceX) : clip.x),
        sourceY: Number.isFinite(Number(options.sourceY)) ? Number(options.sourceY) : (Number.isFinite(Number(clip.sourceY)) ? Number(clip.sourceY) : clip.y),
        sourceWidth: clip.width,
        sourceHeight: clip.height,
        mode: options.mode || (options.clip ? "partial" : "full"),
      }));
    } catch (e) {
      sendLog(`Không gửi được ảnh màn hình: ${e.message}`, "warning");
    }
  }

  try {
    const requestedChain = (() => {
      try {
        if (!req?.url) return null;
        const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
        return url.searchParams.get("chain")?.toLowerCase() || null;
      } catch {
        return null;
      }
    })();

    const proxyConfig = PROXY_CONFIG[requestedChain] && PROXY_CONFIG[requestedChain].server ? PROXY_CONFIG[requestedChain] : null;
    const isCostCoConnection = requestedChain === "costco";
    let options;
    const shouldUseRealChrome = isWalmartConnection || isPremiumOutletsConnection;
    if (shouldUseRealChrome) {
      // Walmart/Premium Outlets: dùng Chrome thật, headed, --start-maximized
      const walmartArgs = [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-blink-features=AutomationControlled",
        "--start-maximized",
      ];
      // Chẩn đoán tạm: bật WALMART_FORCE_SOFTWARE_GPU=true để ép Chrome local
      // render bằng SwiftShader (giống hệt trạng thái GPU trong Docker/Xvfb
      // hiện tại) — dùng để xác nhận fingerprint GPU có phải nguyên nhân
      // chặn bước "nhấn và giữ" hay không trước khi đầu tư thay Xvfb bằng
      // compositor hỗ trợ DRI (weston). Xoá cờ này sau khi kết luận xong.
      if (process.env.WALMART_FORCE_SOFTWARE_GPU === "true") {
        walmartArgs.push("--disable-gpu", "--use-gl=swiftshader", "--use-angle=swiftshader");
        sendLog("[Agent Server] Walmart: ép SwiftShader (chẩn đoán GPU fingerprint).", "warning");
      }
      const configuredWalmartChannel = String(process.env.WALMART_BROWSER_CHANNEL || "auto").toLowerCase();
      const googleChromeAvailable = process.platform === "darwin"
        || [
          "/usr/bin/google-chrome",
          "/usr/bin/google-chrome-stable",
          "/opt/google/chrome/chrome",
        ].some((candidate) => fs.existsSync(candidate));
      const walmartChannel = configuredWalmartChannel === "chromium"
        ? null
        : configuredWalmartChannel === "chrome"
          ? "chrome"
          : googleChromeAvailable ? "chrome" : null;
      options = {
        headless: false,
        ...(walmartChannel ? { channel: walmartChannel } : {}),
        slowMo: Math.max(0, Number(process.env.WALMART_PLAYWRIGHT_SLOW_MO_MS || "250")),
        args: walmartArgs,
      };
      const browserLabel = isPremiumOutletsConnection ? "Premium Outlets" : "Walmart";
      sendLog(
        `[Agent Server] ${browserLabel}: mở ${walmartChannel === "chrome" ? "Google Chrome" : "Playwright Chromium"} ở chế độ headed (headless=false).`,
        "info"
      );
    } else if (isCostCoConnection) {
      const { launch } = await import("cloakbrowser");
      const normalizedProxyUrl = (() => {
        if (!proxyConfig?.server) return undefined;
        const server = proxyConfig.server.trim();
        if (!server) return undefined;
        const prefix = /^https?:\/\//i.test(server) ? "" : "http://";
        const auth = proxyConfig.username ? `${encodeURIComponent(proxyConfig.username)}:${encodeURIComponent(proxyConfig.password)}@` : "";
        return `${prefix}${auth}${server}`;
      })();

      browser = await launch({
        ...(normalizedProxyUrl ? { proxy: normalizedProxyUrl } : {}),
        geoip: true,
        humanize: true,
        headless: true,
      });

      context = await browser.newContext({
        viewport: { width: 1024, height: 768 },
        deviceScaleFactor: 1,
      });
    } else {
      options = {
        headless: process.env.HEADLESS !== "false",
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-blink-features=AutomationControlled",
        ],
      };
      sendLog(`[Agent Server] Khởi tạo trình duyệt Chromium với chain ${requestedChain}`, "info");
      const proxyConfig = PROXY_CONFIG[requestedChain] && PROXY_CONFIG[requestedChain].server ? PROXY_CONFIG[requestedChain] : null;
      sendLog(`[Agent Server] Proxy config: ${JSON.stringify(proxyConfig)}`, "info");
      if (proxyConfig) {
        options.proxy = proxyConfig;
        sendLog(`Sử dụng proxy cho chain ${requestedChain}: ${proxyConfig.server}`, "info");
      }
    }

    if (options.headless === false) {
      await ensureVirtualDisplayForHeadedBrowser(sendLog);
    }

    if (!isCostCoConnection) {
      browser = await chromium.launch(options);

      const contextOptions = {
        viewport: { width: 1024, height: 768 },
        deviceScaleFactor: 1,
        geolocation: { latitude: DEFAULT_GEO_LAT, longitude: DEFAULT_GEO_LON },
      };
      if (!isWalmartConnection) {
        contextOptions.userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
      }
      context = await browser.newContext(contextOptions);
      await context.grantPermissions(["geolocation"]);
    }

    bindContextPageEvents(context);

    page = await context.newPage();
    bindPaymentPageEvents(page);
    sendLog("Đã khởi tạo trình duyệt thành công.", "success");
    sendStatus('ready')

    // Bước 1: Mở trang giữ chỗ để có DOM trước
    try {
      await page.goto("about:blank", { waitUntil: "domcontentloaded", timeout: 10000 }).catch(() => { });
      await page.setContent(`
        <html><body style="margin:0;background:#f8fafc;display:flex;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;color:#64748b;font-size:14px;">
          <div>Đang chờ lệnh từ Affree...</div>
        </body></html>
      `, { waitUntil: "domcontentloaded", timeout: 10000 });
    } catch (err) {
      sendLog(`Cảnh báo: setContent không thành công, dùng fallback ` + err.message, "warning");
      await page.goto("about:blank", { waitUntil: "domcontentloaded", timeout: 10000 }).catch(() => { });
      await page.evaluate(() => {
        document.documentElement.innerHTML = `
          <body style="margin:0;background:#f8fafc;display:flex;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;color:#64748b;font-size:14px;">
            <div>Đang chờ lệnh từ Affree...</div>
          </body>`;
      }).catch(() => { });
    }

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
    stopWalmartCaptchaMonitor();
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

  async function detectTxnnPaymentPopup(preferredView) {
    if (!page || page.isClosed()) return null;
    try {
      return await page.evaluate(({ preferredView }) => {
        const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();
        const normalizeLower = (value) => normalize(value).toLowerCase();
        const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 1024;
        const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 768;
        const clampBounds = (rect) => ({
          x: Math.max(0, Math.floor(rect.left)),
          y: Math.max(0, Math.floor(rect.top)),
          width: Math.max(1, Math.min(viewportWidth, Math.ceil(rect.width))),
          height: Math.max(1, Math.min(viewportHeight, Math.ceil(rect.height))),
        });
        const pickScrollableContainer = (root) => {
          const nodes = [root, ...Array.from(root.querySelectorAll('*'))];
          let best = null;
          for (const node of nodes) {
            if (!(node instanceof HTMLElement)) continue;
            const style = window.getComputedStyle(node);
            const overflowY = style.overflowY || style.overflow;
            const scrollable = /(auto|scroll|overlay)/.test(overflowY) && node.scrollHeight > node.clientHeight + 24;
            if (!scrollable) continue;
            if (!best || node.scrollHeight - node.clientHeight > best.scrollHeight - best.clientHeight) {
              best = node;
            }
          }
          return best;
        };
        const findBoundsForElement = (element) => {
          if (!(element instanceof Element)) return undefined;
          const rect = element.getBoundingClientRect();
          if (rect.width < 20 || rect.height < 20) return undefined;
          return clampBounds(rect);
        };
        const findConfirmButton = (root) => {
          const candidates = Array.from(root.querySelectorAll('button, [role="button"], a')).filter((node) => {
            const text = normalizeLower(node.textContent || node.getAttribute('aria-label') || node.getAttribute('title') || '');
            return /xác nhận|xac nhan|ok|đặt hàng|dat hang|hoàn tất|hoan tat/.test(text);
          });
          return candidates.at(-1) || null;
        };
        const findQrElement = (root) => {
          const imageCandidate = root.querySelector('img[alt*="QR" i], img[src^="data:image"], canvas');
          if (imageCandidate) return imageCandidate;
          const semanticBlock = Array.from(root.querySelectorAll('div, section, article, p, span')).find((node) => {
            const text = normalizeLower(node.textContent || '');
            return /qr|thanh toán|thanh toan|chuyển khoản|chuyen khoan/.test(text);
          });
          return semanticBlock || null;
        };
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
          return { node, score, text, buttons, isInvoiceDetails, isPaymentPopup };
        }).filter(Boolean);

        candidates.sort((a, b) => b.score - a.score);
        const selected = candidates[0];
        if (!selected) return null;

        const root = selected.node;
        const scrollContainer = pickScrollableContainer(root);
        if (scrollContainer) {
          if (preferredView === 'qr') {
            scrollContainer.scrollTop = 0;
          } else if (preferredView === 'confirm') {
            scrollContainer.scrollTop = scrollContainer.scrollHeight;
          }
        }

        const rootRect = root.getBoundingClientRect();
        const qrElement = findQrElement(root);
        const confirmButton = findConfirmButton(root);
        const qrBounds = findBoundsForElement(qrElement);
        const confirmBounds = findBoundsForElement(confirmButton);
        const view =
          preferredView === 'qr' && qrBounds ? 'qr'
            : preferredView === 'confirm' && confirmBounds ? 'confirm'
              : qrBounds ? 'qr'
                : confirmBounds ? 'confirm'
                  : 'full';

        return {
          kind: selected.isInvoiceDetails ? 'invoice_details' : selected.isPaymentPopup ? 'payment' : 'dialog',
          view,
          title: selected.buttons.find((item) => /xác nhận thanh toán|xác nhận|đặt hàng/i.test(item)) || selected.text.slice(0, 120),
          text: selected.text.slice(0, 1200),
          actions: selected.buttons.filter((item, index, arr) => arr.indexOf(item) === index).slice(0, 6),
          bounds: clampBounds(rootRect),
          qrBounds,
          confirmBounds,
          scrollHint: view === 'confirm' ? 'bottom' : 'top',
          debug: scrollContainer
            ? {
              scrollTop: scrollContainer.scrollTop,
              scrollHeight: scrollContainer.scrollHeight,
              clientHeight: scrollContainer.clientHeight,
            }
            : undefined,
        };
      }, { preferredView });
    } catch (err) {
      sendLog(`TXNN: lỗi khi detect popup thanh toán: ${err.message}`, "warning");
      return null;
    }
  }

  async function refreshTxnnPopupFocus(reason = "refresh", preferredView) {
    const desiredView = preferredView || popupFocusState?.view || "qr";
    const popup = await detectTxnnPaymentPopup(desiredView);
    if (!popup) {
      clearPopupFrameInterval();
      if (popupFocusState) {
        sendLog(`TXNN: popup-focus đã đóng (${reason}).`, "info");
      }
      sendPopupState(null);
      return null;
    }
    sendLog(
      `TXNN: popup-focus ${reason} -> view=${popup.view}, scrollHint=${popup.scrollHint}, scrollTop=${popup.debug?.scrollTop ?? "n/a"}`,
      "info"
    );
    sendPopupState(popup);
    const clip = getPopupFrameBounds(popup);
    if (clip) {
      await sendScreenshotFrame({ clip, mode: `popup-focus-${popup.view || "full"}` });
    }
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

  async function waitForTxnnPostOrderPopups(options = {}) {
    const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : 12000;
    const pollMs = Number(options.pollMs) > 0 ? Number(options.pollMs) : 700;
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
      if (await detectTxnnCompletion()) {
        return true;
      }

      const closedPrintPopup = await closeTxnnPopupByKeywords(["print hóa đơn", "in hóa đơn"], "print hóa đơn");
      if (closedPrintPopup) {
        continue;
      }

      const closedInvoicePopup = await closeTxnnPopupByKeywords(
        ["hóa đơn chi tiết", "hoa don chi tiet", "chi tiết hóa đơn"],
        "hóa đơn chi tiết"
      );
      if (closedInvoicePopup) {
        continue;
      }

      await page.waitForTimeout(pollMs);
    }

    return detectTxnnCompletion();
  }

  async function completeTxnnAfterFinalConfirmation() {
    await page.waitForTimeout(1200);
    return waitForTxnnPostOrderPopups();
  }

  async function handleTxnnPaymentSubmitted(options = {}) {
    const {
      source = "payment_submitted",
      logMessage = "Đang xác minh lại trạng thái thanh toán.",
      resumeReason = source,
      clickConfirmButton = true,
      missingConfirmLog = "Không thấy nút xác nhận cuối; sẽ tiếp tục bằng AI loop để tự dò lại trang.",
      errorLogPrefix = "Lỗi khi xác minh thanh toán",
    } = options;

    try {
      sendLog(logMessage, "info");
      sendStatus("running", { reason: `resume:${resumeReason}` });

      let clicked = !clickConfirmButton;
      if (clickConfirmButton) {
        const confirmSelectors = [
          'button:has-text("✅ Xác nhận")',
          'button:has-text("Xác nhận")',
          'button:has-text("OK")',
        ];
        for (const selector of confirmSelectors) {
          const locator = page.locator(selector).last();
          if (await locator.isVisible({ timeout: 600 }).catch(() => false)) {
            await locator.click({ timeout: 3000 });
            sendLog(`Đã click nút xác nhận cuối sau thanh toán bằng selector: ${selector}`, "success");
            clicked = true;
            break;
          }
        }
      }

      if (clicked && await completeTxnnAfterFinalConfirmation()) {
        isAutomating = false;
        return;
      }

      if (!clickConfirmButton || !clicked) {
        sendLog(missingConfirmLog, "warning");
      }
      await resumeAgenticLoop(resumeReason);
    } catch (err) {
      sendLog(`${errorLogPrefix}: ${err.message}`, "warning");
      await resumeAgenticLoop(resumeReason);
    }
  }

  async function resumeAgenticLoopBHX(reason, content = null) {
    try {
      if (reason === 'otp') {
        lastOrderPayload.step = 'otp'
        lastOrderPayload.otp = content
        sendLog(`Đã nhận được OTP ${content}`)

        isAutomating = true;
        let playbookResult = null;
        try {
          sendLog(`[Playbook] Kiểm tra playbook cho chain: ${lastOrderPayload.chain.toUpperCase()}`, "info");
          playbookResult = await runPlaybook(page, lastOrderPayload, sendLog, sendStatus, sendMessage, sendScreenshotFrame);
        } catch (playbookErr) {
          sendLog(`[Playbook] Thất bại: ${playbookErr.message} → chuyển sang AI Tool-Use`, "warning");
          playbookResult = null;
        }

        if (playbookResult?.done === true) {
          sendLog(`[Playbook] Đã xử lý xong đơn hàng.`, "success");
          isAutomating = false;
          return;
        }
      } else {
        sendMessage("Tiến hành đặt hàng.");
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

              let html = "";
              if (lastOrderPayload.paymentMethod === 'qr') {
                const img = page.locator("img[alt='qr bank']").first();
                await img.waitFor({ state: "visible", timeout: 30000 });
                html = await img.evaluate((el) => el.outerHTML);
              } else if (lastOrderPayload.paymentMethod === 'card' && lastOrderPayload.cardInfo) {
                const cardNumber = page.locator('input#card_number, input[name*="card_number"]').first();
                await cardNumber.waitFor({ state: "visible", timeout: 60000 });
                await cardNumber.fill(lastOrderPayload.cardInfo.number);

                const expDate = page.locator('input#exp_date, input[name*="exp_date"]').first();
                await expDate.fill(lastOrderPayload.cardInfo.exp);

                const csc = page.locator('input#csc, input[name*="csc"], input[maxlength*="3"]').first();
                await csc.fill(lastOrderPayload.cardInfo.cvv);

                const onepayPolicy = page.locator('span:has-text("Tôi đã đọc")').first();
                await onepayPolicy.click();

                await page.waitForTimeout(1000);

                const submit = page.locator('button[type="submit"]').first();
                //wait for enable
                await submit.waitFor({ state: "visible", timeout: 1000 });
                await submit.click();
                sendLog('Đã click Thanh toán thẻ');
              }

              const detail = page.locator("p:has-text('Xem chi tiết đơn hàng')").first();
              await detail.waitFor({ state: "visible", timeout: 60000 });
              await detail.click();
              sendLog('Tới trang chi tiết đơn hàng');

              const orderCode = page.locator("span:has-text('Đơn hàng #')").first();
              let orderCodeText = "";
              for (let i = 0; i < 30; i++) {
                orderCodeText = (await orderCode.textContent())?.trim() || "";

                if (/Đơn hàng #\d+/.test(orderCodeText)) {
                  break;
                }

                await page.waitForTimeout(1000);
              }

              sendMessage(orderCodeText.split('Đơn hàng #')[1].trim(), "order_code");
              sendLog(`Bach Hoa Xanh: Đơn hàng thành công với mã ${orderCodeText}`, "success");
              sendMessage(html, "order_success");
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

      if (isWalmartPayload(payload)) {
        sendLog("Walmart: dùng luồng agentic click ban đầu, bắt đầu từ /orders rồi vào Sign In.", "info");
      }

      const resolvedPlaybook = resolvePlaybook(payload);

      // ── Bước 1: Thử Playbook ────────────────────────────────────────────────
      let playbookResult = null;
      try {
        if (isWalmartPayload(payload)) {
          playbookResult = null;
        } else {
          sendLog(`[Playbook] Kiểm tra playbook cho chain: ${chain.toUpperCase()}`, "info");
          playbookResult = await runPlaybook(page, payload, sendLog, sendStatus, sendMessage, sendScreenshotFrame);
        }
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

      if (!HAS_LLM_API_KEY && !isWalmartPayload(payload)) {
        sendLog("⚠️ Chưa cấu hình API Key (QWEN/GEMINI/ANTHROPIC).", "error");
      }

      // ── Bước 2: AI Tool-Use Loop ────────────────────────────────────────────
      if (isWalmartPayload(payload)) {
        sendLog("[AI] Walmart dùng Qwen Tool-Use làm bộ điều phối chính; playbook chỉ hỗ trợ đọc trạng thái.", "info");
      } else if (playbookResult === null) {
        sendLog(`[AI] Không có playbook phù hợp, dùng Agentic Tool-Use Loop.`, "info");
      } else {
        sendLog(`[AI] Playbook đã bootstrap, tiếp tục với Agentic Tool-Use Loop.`, "info");
      }

      const skipGoto = !isWalmartPayload(payload) && playbookResult !== null;
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
      stopWalmartCaptchaMonitor();
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
