/**
 * Agent Session File Logger
 * Ghi log chi tiết từng session vào file để debug luồng AI.
 *
 * File log: agent-server/logs/session-<timestamp>-<domain>.jsonl
 * Format: JSONL, mỗi dòng là một event (metadata | step | ai_prompt | ai_response | error)
 */

const fs = require("fs");
const path = require("path");

const LOG_DIR = path.join(__dirname, "logs");

// Đảm bảo thư mục logs tồn tại
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

/**
 * Tạo một session logger mới.
 * @param {string} domain - Tên miền đang mua hàng (vd: cooponline.vn)
 * @param {object} payload - Payload đặt hàng gốc
 * @returns {object} logger instance
 */
function createSessionLogger(domain, payload) {
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const safeDomain = (domain || "unknown").replace(/[^a-zA-Z0-9.-]/g, "_").slice(0, 40);
  const filename = `session-${ts}-${safeDomain}.jsonl`;
  const filepath = path.join(LOG_DIR, filename);

  // Giữ lại tối đa 50 file log, xóa cũ nhất nếu vượt
  _cleanOldLogs(50);

  // Ghi metadata phiên
  _appendLine(filepath, {
    type: "session_start",
    timestamp: new Date().toISOString(),
    domain,
    payload: {
      productName: payload.productName,
      qty: payload.qty,
      chain: payload.chain,
      url: payload.url,
      buyerName: payload.buyerName,
      buyerPhone: payload.buyerPhone,
      buyerAddress: payload.buyerAddress,
    },
  });

  console.log(`[AgentLogger] Session log: logs/${filename}`);

  return {
    filepath,

    /** Ghi log từ sendLog/sendStatus thông thường */
    log(level, message) {
      _appendLine(filepath, {
        type: "log",
        timestamp: new Date().toISOString(),
        level,
        message,
      });
    },

    /** Ghi thông tin trang và DOM trước khi gọi AI */
    logPageState(step, { url, phase, title, bodyText, elements, activePopup, actionHistory, filledFields }) {
      _appendLine(filepath, {
        type: "page_state",
        timestamp: new Date().toISOString(),
        step,
        url,
        phase,
        title,
        bodyText: bodyText ? bodyText.slice(0, 800) : "",
        elementCount: elements ? elements.length : 0,
        elements: elements ? elements.slice(0, 60) : [],
        activePopup: activePopup || null,
        actionHistory: actionHistory || [],
        filledFields: filledFields ? [...filledFields] : [],
      });
    },

    /** Ghi prompt gửi lên AI (để kiểm tra AI thấy gì) */
    logPrompt(step, promptText) {
      _appendLine(filepath, {
        type: "ai_prompt",
        timestamp: new Date().toISOString(),
        step,
        prompt: promptText,
      });
    },

    /** Ghi response từ AI */
    logDecision(step, decision) {
      _appendLine(filepath, {
        type: "ai_decision",
        timestamp: new Date().toISOString(),
        step,
        decision,
      });
    },

    /** Ghi kết quả thực thi action */
    logActionResult(step, { action, selector, text, success, errorMessage, durationMs }) {
      _appendLine(filepath, {
        type: "action_result",
        timestamp: new Date().toISOString(),
        step,
        action,
        selector: selector || null,
        text: text ? text.slice(0, 100) : null,
        success,
        errorMessage: errorMessage || null,
        durationMs,
      });
    },

    /** Ghi khi kết thúc phiên */
    logSessionEnd({ success, finalUrl, totalSteps, reason, tracer = null }) {
      const usage = tracer?.trace?.usage || null;
      _appendLine(filepath, {
        type: "session_end",
        timestamp: new Date().toISOString(),
        success,
        finalUrl,
        totalSteps,
        reason: reason || null,
        usage,
      });
      console.log(`[AgentLogger] Session ended → ${filepath}`);

      // Ghi thống kê chung vào file logs/usage-summary.jsonl để dễ dàng tổng hợp chi phí
      if (usage && tracer) {
        const summaryFilepath = path.join(LOG_DIR, "usage-summary.jsonl");
        _appendLine(summaryFilepath, {
          sessionId: tracer.trace.sessionId,
          timestamp: new Date().toISOString(),
          domain: tracer.trace.domain,
          chain: tracer.trace.payload?.chain || null,
          productName: tracer.trace.payload?.productName || null,
          success,
          totalSteps,
          apiCallsCount: usage.apiCallsCount,
          totalInputTokens: usage.totalInputTokens,
          totalOutputTokens: usage.totalOutputTokens,
          calls: usage.calls,
        });
        console.log(`[AgentLogger] Usage summary recorded in logs/usage-summary.jsonl`);
      }
    },

    /** Ghi screenshot base64 (chỉ khi dùng vision fallback) */
    logScreenshot(step, screenshotBase64) {
      // Chỉ ghi path reference, không ghi base64 vào JSONL (quá lớn)
      const imgFilename = `screenshot-step${step}-${ts}.jpg`;
      const imgPath = path.join(LOG_DIR, imgFilename);
      try {
        fs.writeFileSync(imgPath, Buffer.from(screenshotBase64, "base64"));
        _appendLine(filepath, {
          type: "screenshot",
          timestamp: new Date().toISOString(),
          step,
          file: imgFilename,
        });
      } catch (e) {
        // Bỏ qua nếu lỗi ghi ảnh
      }
    },

    filepath,
  };
}

// ── Internal helpers ──────────────────────────────────────────────────────

function _appendLine(filepath, obj) {
  try {
    fs.appendFileSync(filepath, JSON.stringify(obj) + "\n", "utf8");
  } catch (e) {
    // Không để lỗi logger crash agent
    console.warn("[AgentLogger] Write error:", e.message);
  }
}

function _cleanOldLogs(maxFiles) {
  try {
    const files = fs.readdirSync(LOG_DIR)
      .filter((f) => f.startsWith("session-") && f.endsWith(".jsonl"))
      .map((f) => ({ name: f, mtime: fs.statSync(path.join(LOG_DIR, f)).mtimeMs }))
      .sort((a, b) => a.mtime - b.mtime); // cũ nhất trước

    while (files.length >= maxFiles) {
      const old = files.shift();
      fs.unlinkSync(path.join(LOG_DIR, old.name));
    }
  } catch (e) {
    // Bỏ qua lỗi cleanup
  }
}

/**
 * Đọc và in tóm tắt một session log ra console (tiện debug).
 * Dùng: node -e "require('./session-logger').printSummary('logs/session-xxx.jsonl')"
 */
function printSummary(filepath) {
  try {
    const lines = fs.readFileSync(filepath, "utf8").trim().split("\n");
    const events = lines.map((l) => JSON.parse(l));

    const meta = events.find((e) => e.type === "session_start");
    const end = events.find((e) => e.type === "session_end");
    const steps = events.filter((e) => e.type === "page_state");
    const decisions = events.filter((e) => e.type === "ai_decision");

    console.log("═══════ SESSION SUMMARY ═══════");
    if (meta) {
      console.log(`Domain: ${meta.domain}`);
      console.log(`Product: ${meta.payload.productName} x${meta.payload.qty}`);
      console.log(`Started: ${meta.timestamp}`);
    }
    if (end) {
      console.log(`Result: ${end.success ? "✅ SUCCESS" : "❌ FAILED"}`);
      console.log(`Steps: ${end.totalSteps}`);
      console.log(`Final URL: ${end.finalUrl}`);
      if (end.reason) console.log(`Reason: ${end.reason}`);
    }
    console.log("─── Phases ───");
    steps.forEach((s) => {
      const d = decisions.find((dec) => dec.step === s.step);
      console.log(`  Step ${s.step}: [${s.phase}] ${s.url.slice(0, 70)}`);
      if (d) console.log(`    AI → ${d.decision.action.toUpperCase()}: ${d.decision.reason || ""}`);
    });
    console.log("═══════════════════════════════");
  } catch (e) {
    console.error("Error reading log:", e.message);
  }
}

module.exports = { createSessionLogger, printSummary };
