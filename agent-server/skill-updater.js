/**
 * Affree AI Agentic — Skill Updater (v2, MD-only)
 * Sau khi một phiên đặt hàng kết thúc, phân tích history bằng LLM
 * để extract những pattern/vấn đề mới và cập nhật skill .md của domain đó.
 *
 * Quy định ngôn ngữ: Comments và log tiếng Việt, biến/hàm tiếng Anh.
 */

const { domainFromUrl, loadSkillInstruction, appendToSkillInstruction } = require("./skill-store");

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const QWEN_API_KEY = process.env.QWEN_API_KEY;

// ─── LLM Callers (raw text, không parse JSON) ────────────────────────────────

async function callGeminiRaw(prompt) {
  const GEMINI_MODEL = process.env.GEMINI_SKILL_MODEL || process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
  });
  if (!response.ok) throw new Error(`Gemini raw error ${response.status}`);
  const data = await response.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || null;
}

async function callClaudeRaw(prompt) {
  const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || "claude-haiku-4-5-20251001";
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 500,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!response.ok) throw new Error(`Claude raw error ${response.status}`);
  const data = await response.json();
  return data.content?.[0]?.text || null;
}

async function callQwenRaw(prompt) {
  const QWEN_MODEL = process.env.QWEN_MODEL || "qwen3.5-flash";
  const QWEN_API_URL = process.env.QWEN_API_URL || "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";
  const response = await fetch(QWEN_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${QWEN_API_KEY}`,
    },
    body: JSON.stringify({
      model: QWEN_MODEL,
      messages: [{ role: "user", content: prompt }],
      max_tokens: 500,
    }),
  });
  if (!response.ok) throw new Error(`Qwen raw error ${response.status}`);
  const data = await response.json();
  return data.choices?.[0]?.message?.content || null;
}

async function callLLMRaw(prompt) {
  if (GEMINI_API_KEY) return callGeminiRaw(prompt);
  if (ANTHROPIC_API_KEY) return callClaudeRaw(prompt);
  if (QWEN_API_KEY) return callQwenRaw(prompt);
  throw new Error("Không có API key nào được cấu hình.");
}

// ─── Core: Phân tích history và tạo section mới cho skill .md ───────────────

/**
 * Trích xuất tóm tắt từ conversation history (Tool-Use format).
 * Hỗ trợ cả Gemini format (parts) và Anthropic format (content array).
 */
function summarizeHistory(history) {
  const lines = [];
  for (const turn of history.slice(-40)) {
    // Gemini model turn
    if (turn.role === "model" && Array.isArray(turn.parts)) {
      for (const p of turn.parts) {
        if (p.functionCall) {
          lines.push(`[CALL] ${p.functionCall.name}(${JSON.stringify(p.functionCall.args).slice(0, 120)})`);
        } else if (p.text && p.text.trim()) {
          lines.push(`[AI] ${p.text.trim().slice(0, 200)}`);
        }
      }
    }
    // Gemini user turn (tool results)
    if (turn.role === "user" && Array.isArray(turn.parts)) {
      for (const p of turn.parts) {
        if (p.functionResponse) {
          const res = p.functionResponse.response;
          const hasError = res?.error || (typeof res?.result === "string" && res.result.includes("\"success\":false"));
          lines.push(`[RESULT:${hasError ? "FAIL" : "OK"}] ${p.functionResponse.name}`);
        }
      }
    }
    // Anthropic assistant turn
    if (turn.role === "assistant" && Array.isArray(turn.content)) {
      for (const b of turn.content) {
        if (b.type === "tool_use") {
          lines.push(`[CALL] ${b.name}(${JSON.stringify(b.input).slice(0, 120)})`);
        } else if (b.type === "text" && b.text.trim()) {
          lines.push(`[AI] ${b.text.trim().slice(0, 200)}`);
        }
      }
    }
    // Anthropic user turn (tool results)
    if (turn.role === "user" && Array.isArray(turn.content)) {
      for (const b of turn.content) {
        if (b.type === "tool_result") {
          const content = Array.isArray(b.content) ? b.content.map(c => c.text || "").join("") : String(b.content || "");
          const hasError = content.includes("\"success\":false") || content.includes("error");
          lines.push(`[RESULT:${hasError ? "FAIL" : "OK"}] tool_id=${b.tool_use_id}`);
        }
      }
    }
  }
  return lines.join("\n");
}

/**
 * Gọi LLM để phân tích session và tạo section markdown mới cho skill file.
 * Trả về string markdown hoặc null nếu không có gì mới để ghi.
 */
async function callLLMForInstructionUpdate(domain, historySummary, success, existingInstruction) {
  const statusStr = success ? "THÀNH CÔNG" : "THẤT BẠI/TẠM DỪNG";
  const existingStr = existingInstruction
    ? `=== Instruction hiện tại ===\n${existingInstruction.slice(0, 2000)}\n=== Hết ===`
    : "Chưa có instruction cho domain này.";

  const today = new Date().toISOString().slice(0, 10);

  const prompt = `Bạn là AI phân tích phiên đặt hàng để cải thiện skill instruction cho AI Agent.

Domain: ${domain}
Kết quả phiên: ${statusStr}
${existingStr}

=== Tóm tắt hành động trong phiên ===
${historySummary}
=== Hết ===

Nhiệm vụ: Xác định xem có THÔNG TIN MỚI nào đáng ghi vào skill file không:
- Selectors mới (hoặc selectors cũ không còn hoạt động)
- Popup mới, redirect bất thường
- Luồng đặc biệt chưa được mô tả
- Vấn đề thường gặp mới phát hiện

Quy tắc:
- Nếu CÓ thông tin mới: viết một đoạn markdown ngắn (tối đa 400 ký tự), bắt đầu bằng: "## Cập nhật ${today}"
- Nếu KHÔNG có gì mới hoặc thông tin đã có trong instruction: chỉ trả về: SKIP
- KHÔNG lặp lại những gì đã có trong instruction hiện tại
- Chỉ trả về markdown section hoặc "SKIP", không giải thích thêm`;

  let raw = null;
  try {
    raw = await callLLMRaw(prompt);
  } catch (e) {
    console.warn(`[SkillUpdater] LLM instruction update lỗi: ${e.message}`);
    return null;
  }

  if (!raw || raw.trim().toUpperCase() === "SKIP" || raw.trim() === "") return null;
  return raw.trim();
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Hàm chính: Cập nhật skill .md sau khi một phiên kết thúc.
 * Được gọi bất đồng bộ từ server.js — không block luồng chính.
 *
 * @param {string} urlOrDomain
 * @param {object} sessionTracer - Tracer object từ createSessionTracer()
 * @param {boolean} success
 * @param {Array} [resumeHistory] - Conversation history của Tool-Use loop
 */
async function updateSkillFromSession(urlOrDomain, sessionTracer, success, resumeHistory = null) {
  const domain = domainFromUrl(urlOrDomain);
  console.log(`[SkillUpdater] Bắt đầu cập nhật skill cho ${domain} (success=${success})...`);

  try {
    // Không update nếu session quá ngắn
    const stepCount = sessionTracer?.trace?.steps?.length || 0;
    if (stepCount < 3) {
      console.log(`[SkillUpdater] Session quá ngắn (${stepCount} bước), bỏ qua.`);
      return;
    }

    // Chỉ update nếu có Tool-Use history
    if (!resumeHistory || resumeHistory.length === 0) {
      console.log(`[SkillUpdater] Không có Tool-Use history, bỏ qua cập nhật .md.`);
      return;
    }

    const historySummary = summarizeHistory(resumeHistory);
    if (!historySummary.trim()) {
      console.log(`[SkillUpdater] History summary trống, bỏ qua.`);
      return;
    }

    const existingInstruction = loadSkillInstruction(urlOrDomain);
    console.log(`[SkillUpdater] Đang phân tích ${resumeHistory.length} turns để cập nhật ${domain}.md...`);

    const newSection = await callLLMForInstructionUpdate(domain, historySummary, success, existingInstruction);

    if (newSection) {
      appendToSkillInstruction(urlOrDomain, newSection);
      console.log(`[SkillUpdater] ✅ Đã cập nhật ${domain}.md với thông tin mới.`);
    } else {
      console.log(`[SkillUpdater] Không có thông tin mới, giữ nguyên ${domain}.md.`);
    }
  } catch (e) {
    console.error(`[SkillUpdater] Lỗi cập nhật skill cho ${domain}: ${e.message}`);
  }
}

module.exports = { updateSkillFromSession };
