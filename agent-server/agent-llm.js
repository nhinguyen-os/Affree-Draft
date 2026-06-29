/**
 * Affree AI Agentic — Tool-Use Engine (v4)
 *
 * Kiến trúc mới (Tool-Use Mode):
 * 1. Playbook-first: thử CSS/click playbook trước nếu có
 * 2. Nếu playbook không có hoặc thất bại → Agentic Tool-Use Loop
 * 3. True multi-turn conversation với function calling (get_dom, click, type, screenshot, ...)
 * 4. Anti-stuck: phát hiện lặp tool và tự chụp screenshot để quan sát
 * 5. Skill `.md` auto-update: ghi nhận kinh nghiệm sau mỗi session
 *
 * Quy định ngôn ngữ: Comments và log tiếng Việt, biến/hàm tiếng Anh.
 */

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || "claude-haiku-4-5-20251001";
const QWEN_API_KEY = process.env.QWEN_API_KEY;
const QWEN_MODEL = process.env.QWEN_MODEL || "qwen3.5-flash";
const QWEN_API_URL = process.env.QWEN_API_URL || "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";
const { buildSkillContext, domainFromUrl } = require("./skill-store");
const { createSessionTracer } = require("./session-tracer");
const { createSessionLogger } = require("./session-logger");


// ═══════════════════════════════════════════════════════════════════════════
// AGENTIC TOOL-USE LOOP — True multi-turn conversation với function calling
// ═══════════════════════════════════════════════════════════════════════════

const {
  getToolsForGemini,
  getToolsForAnthropic,
  getToolsForOpenAI,
  buildGeminiContents,
  buildAnthropicMessages,
  buildOpenAIMessages,
  executeTool,
} = require("./agent-tools");

const { loadSkillInstruction } = require("./skill-store");

const MAX_TOOL_TURNS = 100;        // Tổng số lượt AI gọi tool tối đa
const MAX_CONSECUTIVE_FAILS = 5;  // Số lần tool liên tiếp thất bại trước khi pause

/**
 * Xây dựng System Prompt cho chế độ Tool-Use.
 * Skills là instruction file domain-specific (plain text/markdown).
 */
function buildToolUseSystemPrompt(payload, skillInstruction) {
  const { productName, qty, buyerName, buyerPhone, buyerAddress, buyerNote, slot, chain } = payload;
  const noteStr = buyerNote ? `\n- Ghi chú: "${buyerNote}"` : "";
  const slotStr = slot ? `\n- Khung giờ giao: "${slot}"` : "";

  return `Bạn là AI Agent điều khiển trình duyệt web để đặt hàng tự động cho khách hàng.

## THÔNG TIN ĐƠN HÀNG
- Sản phẩm: "${productName}" | Số lượng: ${qty}
- Người nhận: "${buyerName}" | SĐT: "${buyerPhone}"
- Địa chỉ giao hàng: "${buyerAddress}"${noteStr}${slotStr}
- Cửa hàng: ${chain.toUpperCase()}

## CHIẾN LƯỢC HOẠT ĐỘNG
1. Luôn gọi get_dom() hoặc screenshot() để quan sát trang trước khi hành động
2. Nếu có popup cản trở → gọi dismiss_popups() ngay
3. Nếu bị redirect sai trang (ví dụ: bay sang Zalo, mạng xã hội) → gọi navigate() để quay về
4. Nếu DOM không đủ thông tin để quyết định → gọi screenshot() để thấy giao diện thực tế
5. Điền thông tin người nhận TỪNG FIELD MỘT, chỉ điền field còn trống
6. KHÔNG tự click nút "Đặt hàng" / "Xác nhận" cuối cùng — gọi pause_for_human(reason="review")
7. Nếu cần OTP, CAPTCHA, chọn địa chỉ dropdown phức tạp, thanh toán không phải COD → gọi pause_for_human()
8. Khi thấy màn hình xác nhận đơn thành công → gọi complete_success()

## KHI BỊ STUCK
Nếu tool trả về thất bại nhiều lần liên tiếp → đừng lặp lại cùng hành động.
Thay vào đó: (1) gọi screenshot() để quan sát, (2) thử cách tiếp cận khác, (3) nếu không được → pause_for_human(reason="stuck").

${skillInstruction ? `## HƯỚNG DẪN ĐẶC THÙ CHO ${chain.toUpperCase()}\n${skillInstruction}` : ""}`;
}

// ─── LLM callers với Tool-Use ─────────────────────────────────────────────

/**
 * Gọi Gemini với function calling.
 * Trả về: { toolCalls: [{id, name, args}], text: string, done: boolean }
 */
async function callGeminiWithTools(history, systemPrompt, tracer = null) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
  const contents = buildGeminiContents(history);

  const body = {
    system_instruction: { parts: [{ text: systemPrompt }] },
    tools: getToolsForGemini(),
    contents,
    generationConfig: { temperature: 0.1 },
  };

  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`Gemini Tool-Use ${res.status}: ${await res.text()}`);

  const result = await res.json();
  const inputTokens = result.usageMetadata?.promptTokenCount || 0;
  const outputTokens = result.usageMetadata?.candidatesTokenCount || 0;
  if (tracer && typeof tracer.recordApiCall === "function") {
    tracer.recordApiCall("gemini_tools", GEMINI_MODEL, inputTokens, outputTokens);
  }

  const candidate = result.candidates?.[0];
  if (!candidate) throw new Error("Gemini: không có candidates trong response");

  const parts = candidate.content?.parts || [];
  const toolCalls = parts
    .filter((p) => p.functionCall)
    .map((p, i) => ({ id: `${p.functionCall.name}_${Date.now()}_${i}`, name: p.functionCall.name, args: p.functionCall.args || {} }));
  const text = parts.filter((p) => p.text).map((p) => p.text).join("");

  return { toolCalls, text, done: candidate.finishReason === "STOP" && toolCalls.length === 0 };
}

/**
 * Gọi Anthropic Claude với tool use.
 */
async function callAnthropicWithTools(history, systemPrompt, tracer = null) {
  const messages = buildAnthropicMessages(history);

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 4096,
      system: systemPrompt,
      tools: getToolsForAnthropic(),
      messages,
    }),
  });
  if (!res.ok) throw new Error(`Anthropic Tool-Use ${res.status}: ${await res.text()}`);

  const result = await res.json();
  const inputTokens = result.usage?.input_tokens || 0;
  const outputTokens = result.usage?.output_tokens || 0;
  if (tracer && typeof tracer.recordApiCall === "function") {
    tracer.recordApiCall("anthropic_tools", ANTHROPIC_MODEL, inputTokens, outputTokens);
  }

  const content = result.content || [];
  const toolCalls = content
    .filter((c) => c.type === "tool_use")
    .map((c) => ({ id: c.id, name: c.name, args: c.input || {} }));
  const text = content.filter((c) => c.type === "text").map((c) => c.text).join("");

  return { toolCalls, text, done: result.stop_reason === "end_turn" && toolCalls.length === 0 };
}

/**
 * Gọi Qwen (OpenAI-compatible) với function calling.
 */
async function callQwenWithTools(history, systemPrompt, tracer = null) {
  const messages = buildOpenAIMessages(history, systemPrompt);
  const safeBody = JSON.stringify({ model: QWEN_MODEL, messages, tools: getToolsForOpenAI(), tool_choice: "auto" });

  const res = await fetch(QWEN_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${QWEN_API_KEY}` },
    body: safeBody,
  });
  if (!res.ok) throw new Error(`Qwen Tool-Use ${res.status}: ${await res.text()}`);

  const result = await res.json();
  const inputTokens = result.usage?.prompt_tokens || 0;
  const outputTokens = result.usage?.completion_tokens || 0;
  if (tracer && typeof tracer.recordApiCall === "function") {
    tracer.recordApiCall("qwen_tools", QWEN_MODEL, inputTokens, outputTokens);
  }

  const msg = result.choices?.[0]?.message;
  if (!msg) throw new Error("Qwen: không có message trong response");

  const toolCalls = (msg.tool_calls || []).map((tc) => ({
    id: tc.id,
    name: tc.function.name,
    args: JSON.parse(tc.function.arguments || "{}"),
  }));
  const text = msg.content || "";

  return { toolCalls, text, done: result.choices?.[0]?.finish_reason === "stop" && toolCalls.length === 0 };
}

/**
 * Dispatch gọi LLM phù hợp.
 */
async function callLLMWithTools(history, systemPrompt, tracer = null) {
  if (QWEN_API_KEY) return callQwenWithTools(history, systemPrompt, tracer);
  if (ANTHROPIC_API_KEY) return callAnthropicWithTools(history, systemPrompt, tracer);
  if (GEMINI_API_KEY) return callGeminiWithTools(history, systemPrompt, tracer);
  throw new Error("Chưa cấu hình API Key (QWEN/ANTHROPIC/GEMINI)");
}

/**
 * Vòng lặp Agentic Tool-Use — multi-turn conversation thực sự.
 * AI có full history, tự quyết định dùng tool nào và khi nào.
 */
async function runAgenticToolUseLoop(page, payload, sendLog, sendStatus, options = {}) {
  const hasKey = QWEN_API_KEY || GEMINI_API_KEY || ANTHROPIC_API_KEY;
  if (!hasKey) {
    sendLog("⚠️ Chưa cấu hình API Key (QWEN/GEMINI/ANTHROPIC).", "error");
    return { handled: false, tracer: null };
  }

  const engineLabel = QWEN_API_KEY ? `Qwen (${QWEN_MODEL})` : ANTHROPIC_API_KEY ? `Claude (${ANTHROPIC_MODEL})` : `Gemini (${GEMINI_MODEL})`;
  sendLog(`🧠 Khởi động AI Tool-Use Mode (${engineLabel})...`, "success");

  // ── Setup ─────────────────────────────────────────────────────────────
  const domain = domainFromUrl(payload.url || "");
  const tracer = options.existingTracer || createSessionTracer(domain, payload);
  const sessionLogger = createSessionLogger(domain, payload);

  // Tải skill instruction cho domain (markdown text)
  const skillInstruction = loadSkillInstruction(domain);
  if (skillInstruction) {
    sendLog(`🧠 Đã tải skill instruction cho ${domain}.`, "info");
  } else {
    sendLog(`🔍 Chưa có skill instruction cho ${domain} — chạy chế độ khám phá.`, "info");
  }

  const systemPrompt = buildToolUseSystemPrompt(payload, skillInstruction);

  // Điều hướng ban đầu
  if (!options.skipInitialGoto) {
    sendLog(`Đang mở: ${payload.url}...`);
    try {
      await page.goto(payload.url, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForTimeout(2000);
      sendLog("Đã tải xong trang.", "success");
    } catch (gotoErr) {
      sendLog(`Lỗi điều hướng: ${gotoErr.message}`, "error");
    }
  }

  // Kế thừa history từ phiên resume (nếu có)
  const history = options.resumeHistory ? [...options.resumeHistory] : [];

  // Thêm user message khởi đầu hoặc resume
  if (history.length === 0) {
    history.push({ role: "user", content: `Bắt đầu đặt hàng. Hãy gọi get_dom() để xem trạng thái trang hiện tại trước khi hành động.` });
  } else {
    history.push({ role: "user", content: `Người dùng đã hoàn thành thao tác yêu cầu. Hãy gọi get_dom() để tiếp tục từ trạng thái hiện tại.` });
  }

  // ── Anti-stuck state ──────────────────────────────────────────────────
  let consecutiveFails = 0;
  let lastToolName = "";
  let lastToolArgsStr = "";
  let sameToolCount = 0;

  // ── Main loop ─────────────────────────────────────────────────────────
  for (let turn = 1; turn <= MAX_TOOL_TURNS; turn++) {
    sendLog(`[Turn ${turn}/${MAX_TOOL_TURNS}] Gọi AI...`, "info");

    // Gọi LLM
    let response;
    try {
      response = await callLLMWithTools(history, systemPrompt, tracer);
    } catch (apiErr) {
      sendLog(`Lỗi API: ${apiErr.message}`, "error");
      consecutiveFails++;
      if (consecutiveFails > 3) {
        sendStatus("failed", { error: apiErr.message });
        return { handled: true, tracer };
      }
      await page.waitForTimeout(2000);
      continue;
    }

    // AI kết thúc không gọi tool nào (hiếm gặp)
    if (response.done) {
      sendLog("AI hoàn thành mà không gọi thêm tool nào.", "info");
      break;
    }

    if (response.text) {
      sendLog(`AI: ${response.text.slice(0, 120)}`, "info");
    }

    // Không có tool calls → AI đang text-only (không mong muốn)
    if (!response.toolCalls || response.toolCalls.length === 0) {
      sendLog("⚠️ AI không gọi tool nào — thêm nhắc nhở tiếp tục.", "warning");
      history.push({ role: "assistant", content: response.text || "" });
      history.push({ role: "user", content: "Hãy gọi một tool để tiếp tục. Nếu không biết làm gì tiếp → gọi get_dom() hoặc screenshot()." });
      consecutiveFails++;
      if (consecutiveFails >= MAX_CONSECUTIVE_FAILS) {
        sendLog("⚠️ AI không chịu gọi tool — dừng để user can thiệp.", "warning");
        sendStatus("waiting_user_input", { reason: "AI không tiến triển", pauseReason: "stuck" });
        return { handled: true, tracer, resumeHistory: history };
      }
      continue;
    }

    // Thêm assistant message với tool calls vào history
    history.push({ role: "assistant", content: response.text || null, toolCalls: response.toolCalls });

    // ── Thực thi từng tool call ──────────────────────────────────────
    let hasTerminal = false;
    for (const toolCall of response.toolCalls) {
      sendLog(`🔧 Tool: ${toolCall.name}${toolCall.args && Object.keys(toolCall.args).length ? ` | ${JSON.stringify(toolCall.args).slice(0, 80)}` : ""}`, "info");

      // Anti-stuck: phát hiện gọi cùng tool + cùng args liên tiếp
      const argsStr = JSON.stringify(toolCall.args || {});
      if (toolCall.name === lastToolName && argsStr === lastToolArgsStr) {
        sameToolCount++;
        if (sameToolCount >= 3) {
          sendLog(`⚠️ AI gọi ${toolCall.name} lặp lại ${sameToolCount} lần — ép chụp ảnh để thay đổi context.`, "warning");
          // Ép AI nhìn screenshot thay vì lặp tool cũ
          history.push({
            role: "tool_result", toolCallId: toolCall.id, toolName: toolCall.name,
            content: `{"error": "Tool này đã thất bại ${sameToolCount} lần liên tiếp. KHÔNG gọi lại. Hãy gọi screenshot() để quan sát trang, hoặc thử chiến lược khác."}`,
          });
          sameToolCount = 0;
          consecutiveFails++;
          continue;
        }
      } else {
        sameToolCount = 0;
        lastToolName = toolCall.name;
        lastToolArgsStr = argsStr;
      }

      // Ghi log session
      sessionLogger.logPrompt(turn, `Tool call: ${toolCall.name} | ${argsStr}`);

      // Thực thi tool
      const startMs = Date.now();
      const toolResult = await executeTool(toolCall.name, toolCall.args, page, { sendLog });
      const durationMs = Date.now() - startMs;

      sessionLogger.logActionResult(turn, { action: toolCall.name, selector: toolCall.args?.selector || null, success: !toolResult.content?.includes('"success":false'), durationMs });

      // Handle terminal tools ngay
      if (toolResult.terminal) {
        hasTerminal = true;
        if (toolResult.terminalAction === "success") {
          sendLog("🎉 Đặt hàng thành công!", "success");
          sendStatus("completed", { orderUrl: toolResult.finalUrl, orderId: toolResult.orderId });
          tracer.finalize(true, toolResult.finalUrl || page.url());
          sessionLogger.logSessionEnd({ success: true, finalUrl: page.url(), totalSteps: turn, reason: "success", tracer });
          return { handled: true, tracer };
        } else if (toolResult.terminalAction === "pause") {
          const pauseMessages = {
            otp: "📱 Cần nhập mã OTP từ SMS.",
            captcha: "🤖 Hoàn thành CAPTCHA rồi bấm Tiếp tục.",
            address: "📍 Chọn địa chỉ giao hàng (tỉnh/quận/phường) trên màn hình.",
            payment: "💳 Chọn phương thức thanh toán phù hợp.",
            review: "✅ Kiểm tra đơn hàng và nhấn 'Đặt hàng' khi đã đồng ý.",
            stuck: "🤔 AI không xử lý được — vui lòng thao tác thủ công.",
            other: "👉 Vui lòng thao tác trực tiếp trên màn hình.",
          };
          sendLog(`⚠️ ${pauseMessages[toolResult.pauseReason] || pauseMessages.other}`, "warning");
          sendLog(`Lý do AI dừng: ${toolResult.pauseMessage}`, "info");
          sendStatus("waiting_user_input", { reason: toolResult.pauseMessage, pauseReason: toolResult.pauseReason });
          tracer.recordPause(toolResult.pauseMessage);
          tracer.finalize(false, page.url());
          sessionLogger.logSessionEnd({ success: false, finalUrl: page.url(), totalSteps: turn, reason: `pause:${toolResult.pauseReason}`, tracer });
          // Trả về history để resume kế thừa
          return { handled: true, tracer, resumeHistory: history };
        }
        break;
      }

      // Thêm tool result vào history
      history.push({
        role: "tool_result",
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        content: toolResult.content,
        imageBase64: toolResult.imageBase64 || null,
      });

      // Reset fail counter nếu tool thành công
      if (!toolResult.content?.includes('"success":false') && !toolResult.content?.includes('"error"')) {
        consecutiveFails = 0;
      } else {
        consecutiveFails++;
      }

      // Ghi trace
      tracer.recordStep({
        url: page.url(), pageTitle: "", action: toolCall.name,
        selector: toolCall.args?.selector || null, text: toolCall.args?.text || null,
        success: !toolResult.content?.includes('"success":false'), durationMs,
        aiReason: toolCall.args?.reason || "",
      });
    }

    if (hasTerminal) break;

    // Quá nhiều lỗi liên tiếp → pause
    if (consecutiveFails >= MAX_CONSECUTIVE_FAILS) {
      sendLog(`⚠️ ${MAX_CONSECUTIVE_FAILS} tool thất bại liên tiếp — dừng để user can thiệp.`, "warning");
      sendStatus("waiting_user_input", { reason: "AI gặp nhiều lỗi liên tiếp", pauseReason: "stuck" });
      tracer.finalize(false, page.url());
      sessionLogger.logSessionEnd({ success: false, finalUrl: page.url(), totalSteps: turn, reason: "consecutive_fails", tracer });
      return { handled: true, tracer, resumeHistory: history };
    }
  }

  sendLog(`⚠️ Đã đạt giới hạn ${MAX_TOOL_TURNS} lượt. Dừng.`, "warning");
  sendStatus("failed", { error: "Max tool turns reached" });
  sessionLogger.logSessionEnd({ success: false, finalUrl: page.url(), totalSteps: MAX_TOOL_TURNS, reason: "max_turns", tracer });
  tracer.finalize(false, page.url());
  return { handled: true, tracer, resumeHistory: history };
}


module.exports = {
  runAgenticToolUseLoop,
};


