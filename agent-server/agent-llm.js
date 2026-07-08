/**
 * Affree AI Agentic — Tool-Use Engine (v4)
 *
 * Kiến trúc mới (Tool-Use Mode):
 * 1. Agentic Tool-Use là bộ điều phối chính cho các flow agentic
 * 2. Playbook chỉ hỗ trợ chain deterministic hoặc cung cấp helper đọc DOM
 * 3. True multi-turn conversation với function calling (get_dom, click, type, screenshot, ...)
 * 4. Anti-stuck: phát hiện lặp tool và yêu cầu quan sát lại trạng thái trang
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
const QWEN_MODELS = (process.env.QWEN_MODELS || QWEN_MODEL)
  .split(",")
  .map((model) => model.trim())
  .filter(Boolean)
  .filter((model, index, models) => models.indexOf(model) === index);
const QWEN_API_URL = process.env.QWEN_API_URL || "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";
const { loadMasterInstruction, loadSkillInstruction, domainFromUrl } = require("./skill-store");
const { createSessionTracer } = require("./session-tracer");
const { createSessionLogger } = require("./session-logger");
const walmartPlaybook = require("./playbooks/walmart");
const { getToolsForGemini, getToolsForAnthropic, getToolsForOpenAI, buildGeminiContents, buildAnthropicMessages, buildOpenAIMessages, executeTool } = require("./agent-tools");


const MAX_TOOL_TURNS = 100;        // Tổng số lượt AI gọi tool tối đa
const MAX_CONSECUTIVE_FAILS = 5;  // Số lần tool liên tiếp thất bại trước khi pause
let qwenModelCursor = 0;

function isRetryableQwenModelError(status, responseText) {
  if (status === 401) return false;
  if ([402, 403, 408, 409, 429, 500, 502, 503, 504].includes(Number(status))) return true;
  // 400 invalid_parameter_error về content field — thường do null content, đã fix nhưng retry sang model khác
  if (status === 400 && /content.*field.*required|invalid_parameter/i.test(String(responseText || ""))) return true;
  return /quota|credit|balance|limit|rate|throttle|insufficient|unpurchased|accessdenied|model.*denied|temporar/i.test(String(responseText || ""));
}

function buildQwenModelAttemptOrder() {
  const models = QWEN_MODELS.length > 0 ? QWEN_MODELS : [QWEN_MODEL];
  return models.map((_, offset) => models[(qwenModelCursor + offset) % models.length]);
}

async function postQwenChatCompletion(buildBody) {
  const models = buildQwenModelAttemptOrder();
  let lastError = null;

  for (const model of models) {
    const body = JSON.stringify(buildBody(model));
    const res = await fetch(QWEN_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${QWEN_API_KEY}` },
      body,
    });
    const text = await res.text();

    if (res.ok) {
      const nextCursor = QWEN_MODELS.indexOf(model);
      if (nextCursor >= 0) qwenModelCursor = nextCursor;
      try {
        return { model, result: JSON.parse(text) };
      } catch (error) {
        throw new Error(`Qwen (${model}) trả JSON không hợp lệ: ${error.message}`);
      }
    }

    lastError = new Error(`Qwen ${res.status} (${model}): ${text}`);
    if (!isRetryableQwenModelError(res.status, text)) throw lastError;
  }

  throw lastError || new Error("Qwen: chưa cấu hình model nào để gọi");
}

/**
 * Xây dựng System Prompt cho chế độ Tool-Use.
 * Inject master skill (stable) + domain-specific skill (có thể thay đổi) vào prompt.
 */
function buildToolUseSystemPrompt(payload, skillInstruction) {
  const { productName, qty, buyerName, buyerPhone, buyerAddress, buyerNote, slot, chain } = payload;
  const noteStr = buyerNote ? `\n- Ghi chú: "${buyerNote}"` : "";
  const slotStr = slot ? `\n- Khung giờ giao: "${slot}"` : "";
  const isWalmart = String(chain || "").toLowerCase() === "walmart";
  const walmartSection = isWalmart
    ? `\n## THÔNG TIN WALMART AGENTIC
- Product URL thật: "${payload.productUrl || payload.url || ""}"
- Account email: "${payload.account?.email || payload.customer?.email || ""}"
- Account password: "${payload.account?.password || ""}"
- Customer: ${JSON.stringify(payload.customer || {}, null, 2)}
- Address: ${JSON.stringify(payload.address || {}, null, 2)}
- Cart ready: ${Boolean(payload.cartReady)}
- Variant confirmed: ${Boolean(payload.variantConfirmed)}
- Resume stage: "${payload.resumeStage || ""}"

Quy tắc Walmart:
- Bắt buộc bắt đầu tại https://www.walmart.com/orders, rồi đi thẳng https://www.walmart.com/login để đăng nhập trước khi mở product URL.
- Chỉ dùng product URL thật sau khi đã login; không search lại bằng keyword trong mọi trường hợp.
- Ưu tiên get_dom() để quan sát trang. Không gọi screenshot() cùng lúc hoặc sau mỗi bước.
- Chỉ gọi screenshot() khi get_dom() không đủ thông tin, hoặc khi gặp CAPTCHA/popup cần nhìn trực quan.
- Nếu chưa login, dùng account email/password ở trên.
- Khi Walmart hỏi phương thức đăng nhập/xác minh, luôn chọn Password/Use password/Use your password trước. Nếu thấy Email code, Text me, SMS, Call me, Send code, One-time code và Password cùng xuất hiện thì bắt buộc đổi sang Password rồi Continue; tuyệt đối không chọn email code/SMS/OTP khi còn Password.
- Nếu thiếu email/password và chưa login, gọi pause_for_human(reason="credentials") ngay; không guest checkout, không search.
- Nếu Variant confirmed=true: người dùng ĐÃ chọn màu và size xong, TUYỆT ĐỐI không gọi pause_for_human(reason="variant") nữa. Hãy click Add to cart ngay lập tức.
- Nếu Variant confirmed=false và PDP có nhiều màu hoặc size bắt buộc, gọi pause_for_human(reason="variant") trước khi Add to cart; không tự chọn thay người dùng.
- Sau khi add cart thành công, tự click Buy now hoặc vào cart và click Checkout; không gọi pause reason address và không thu địa chỉ bằng form Affree.
- Nếu Cart ready=true, sản phẩm đã có trong giỏ: tuyệt đối không mở PDP hay Add to cart lần nữa.
- Nút "Continue to checkout" trên trang cart có aria-label="Continue to checkout button" — dùng selector: button[aria-label="Continue to checkout button"] hoặc click trực tiếp bằng tọa độ nếu selector fail.
- Không chọn hình thức vận chuyển, pickup/shipping, khung giờ, phương thức thanh toán hoặc nhập thẻ thay người dùng.
- Nếu Walmart hiện form địa chỉ hoặc đã vào checkout, dừng reason review để stream trang thật cho người dùng nhập và tự chọn các mục còn lại.
- Nếu gặp OTP/CAPTCHA/thanh toán nhạy cảm/review cuối, gọi pause_for_human đúng reason.
`
    : "";

  const masterInstruction = loadMasterInstruction();
  const masterSection = masterInstruction
    ? `\n## HƯỚNG DẪN CHUNG (Master Skill)\n${masterInstruction}\n`
    : "";

  const domainSection = skillInstruction
    ? `\n## HƯỚNG DẪN ĐẶC THÙ CHO ${chain.toUpperCase()}\n${skillInstruction}\n`
    : "";

  return `Bạn là AI Agent điều khiển trình duyệt web để đặt hàng tự động cho khách hàng.

## THÔNG TIN ĐƠN HÀNG
- Sản phẩm: "${productName}" | Số lượng: ${qty}
- Người nhận: "${buyerName}" | SĐT: "${buyerPhone}"
- Địa chỉ giao hàng: "${buyerAddress}"${noteStr}${slotStr}
- Cửa hàng: ${chain.toUpperCase()}
${walmartSection}
${masterSection}${domainSection}`;
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
  const { model, result } = await postQwenChatCompletion((attemptModel) => ({
    model: attemptModel,
    messages,
    tools: getToolsForOpenAI(),
    tool_choice: "auto",
  }));
  const inputTokens = result.usage?.prompt_tokens || 0;
  const outputTokens = result.usage?.completion_tokens || 0;
  if (tracer && typeof tracer.recordApiCall === "function") {
    tracer.recordApiCall("qwen_tools", model, inputTokens, outputTokens);
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

async function walmartPageHasCaptcha(page) {
  return page.evaluate(() => {
    const text = document.body?.innerText || "";
    return /robot or human|press\s*&\s*hold|activate and hold|verify you are human/i.test(text);
  }).catch(() => false);
}

async function walmartPageIsSignedIn(page) {
  return page.evaluate(() => {
    const text = (document.body?.innerText || "").replace(/\s+/g, " ");
    return /\bSign Out\b/i.test(text) || /\bHi,\s*[^\n]+\b/i.test(text);
  }).catch(() => false);
}

async function firstVisibleLocator(page, selectors) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if (await locator.isVisible().catch(() => false)) return locator;
  }
  return null;
}

async function waitForFirstVisibleLocator(page, selectors, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const locator = await firstVisibleLocator(page, selectors);
    if (locator) return locator;
    if (await walmartPageHasCaptcha(page)) return null;
    await page.waitForTimeout(200);
  }
  return null;
}

async function waitForWalmartLoginResult(page, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await walmartPageHasCaptcha(page)) return "captcha";
    if (await walmartPageIsSignedIn(page)) return "signed_in";
    if (await walmartPageHasOtpChallenge(page)) {
      const passwordMethod = await firstVisibleLocator(page, walmartPlaybook.SELECTORS.passwordMethod || []);
      const selectedPassword = Boolean(passwordMethod) || await clickWalmartPasswordMethod(page);
      if (selectedPassword) {
        await page.waitForTimeout(250);
        continue;
      }
      return "otp";
    }
    await page.waitForTimeout(150);
  }
  return "timeout";
}

async function clickWalmartPasswordMethod(page) {
  const knownSelector = await firstVisibleLocator(page, walmartPlaybook.SELECTORS.passwordMethod || []);
  if (knownSelector) {
    await knownSelector.click();
    return true;
  }

  const passwordRole = page.getByRole("radio", { name: /password/i }).first();
  if (await passwordRole.isVisible().catch(() => false)) {
    await passwordRole.click();
    return true;
  }

  const passwordLabel = page.getByText(/^(?:use\s+)?password(?:\s+instead)?$/i).first();
  if (await passwordLabel.isVisible().catch(() => false)) {
    await passwordLabel.click();
    return true;
  }

  return page.evaluate(() => {
    const visible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    };
    const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
    const candidates = Array.from(document.querySelectorAll('input[type="radio"], [role="radio"], label, button, a, [data-testid], [class]'));
    const passwordCandidate = candidates.find((element) => {
      if (!visible(element)) return false;
      const id = element.getAttribute("id");
      const labelText = id
        ? clean(document.querySelector(`label[for="${CSS.escape(id)}"]`)?.textContent)
        : "";
      const text = clean([
        element.getAttribute("aria-label"),
        element.getAttribute("name"),
        element.getAttribute("value"),
        element.textContent,
        labelText,
        element.closest("label")?.textContent,
      ].filter(Boolean).join(" "));
      return /\bpassword\b/i.test(text) && !/email\s+code|text\s+code|sms|one-time|otp/i.test(text);
    });
    if (!passwordCandidate) return false;
    const target =
      passwordCandidate.closest('label, button, [role="radio"], [data-testid], .flex, .pa3, .ba') ||
      passwordCandidate;
    target.click();
    return true;
  }).catch(() => false);
}

async function walmartPageHasOtpChallenge(page) {
  return page.evaluate(() => {
    const text = (document.body?.innerText || "").replace(/\s+/g, " ");
    return /text me|call me instead|enter (?:the )?(?:verification )?code|code (?:was )?sent|send (?:a )?code|verify.*(?:phone|mobile)/i.test(text);
  }).catch(() => false);
}

async function waitForWalmartPasswordEntry(page, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  let methodSelected = false;
  let methodContinueClicked = false;

  while (Date.now() < deadline) {
    if (await walmartPageHasCaptcha(page)) return { state: "captcha", input: null };

    const passwordInput = await firstVisibleLocator(page, walmartPlaybook.SELECTORS.passwordInput);
    if (passwordInput) return { state: "password", input: passwordInput };

    if (!methodSelected || Date.now() + 2500 >= deadline) {
      methodSelected = await clickWalmartPasswordMethod(page) || methodSelected;
    }

    if (methodSelected && !methodContinueClicked) {
      await page.waitForTimeout(150);
      const inputAfterSelection = await firstVisibleLocator(page, walmartPlaybook.SELECTORS.passwordInput);
      if (inputAfterSelection) return { state: "password", input: inputAfterSelection };

      const passwordStillAvailable = await clickWalmartPasswordMethod(page);
      methodSelected = methodSelected || passwordStillAvailable;
      await page.waitForTimeout(150);
      const inputAfterSecondSelection = await firstVisibleLocator(page, walmartPlaybook.SELECTORS.passwordInput);
      if (inputAfterSecondSelection) return { state: "password", input: inputAfterSecondSelection };

      const methodContinue = await firstVisibleLocator(page, walmartPlaybook.SELECTORS.methodContinueButton || []);
      if (methodContinue) {
        await methodContinue.click();
        methodContinueClicked = true;
      }
    }

    await page.waitForTimeout(120);
  }

  return {
    state: await walmartPageHasOtpChallenge(page) ? "otp" : "fallback",
    input: null,
  };
}

async function submitWalmartPassword(page, payload, password, sendLog, passwordInput) {
  await passwordInput.fill(password);
  const signInButton = await firstVisibleLocator(page, walmartPlaybook.SELECTORS.signInButton);
  if (!signInButton) return { state: "fallback" };
  await signInButton.click();

  const loginResult = await waitForWalmartLoginResult(page);
  if (loginResult === "captcha") return { state: "captcha" };
  if (loginResult === "otp") return { state: "otp" };
  if (loginResult !== "signed_in") return { state: "fallback" };

  payload.loginReady = true;
  const productUrl = payload.productUrl || payload.url;
  // Sync địa chỉ giao hàng ngay sau login thành công
  try {
    sendLog("Walmart: Đang đồng bộ địa chỉ giao hàng...", "info");
    const addrResult = await walmartPlaybook.syncDeliveryAddress(page, payload);
    if (addrResult.success) {
      sendLog("Walmart: Đã cập nhật địa chỉ giao hàng thành công.", "success");
    } else {
      sendLog(`Walmart: Không sync được địa chỉ (${addrResult.reason}), tiếp tục.`, "warning");
    }
  } catch (e) {
    sendLog(`Walmart: Lỗi sync địa chỉ: ${e.message}`, "warning");
  }
  // Xóa toàn bộ giỏ hàng cũ trước khi vào sản phẩm mới
  try {
    sendLog("Walmart: Đang xóa giỏ hàng cũ...", "info");
    const clearResult = await walmartPlaybook.clearCart(page);
    if (clearResult.removed > 0) {
      sendLog(`Walmart: Đã xóa ${clearResult.removed} sản phẩm khỏi giỏ hàng.`, "success");
    } else {
      sendLog("Walmart: Giỏ hàng đã trống, không cần xóa.", "info");
    }
  } catch (e) {
    sendLog(`Walmart: Lỗi xóa giỏ hàng: ${e.message}`, "warning");
  }
  if (productUrl) {
    sendLog("Walmart: Đăng nhập thành công bằng Password, mở thẳng sản phẩm.", "success");
    await page.goto(productUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await walmartPlaybook.waitForProductReady(page);
  }
  return { state: "ready" };
}

async function runWalmartLoginPreflight(page, payload, sendLog) {
  if (payload.loginReady || payload.cartReady) {
    return { state: "ready" };
  }

  if (/\/ip\//i.test(page.url())) {
    payload.loginReady = true;
    return { state: "ready" };
  }

  if (await walmartPageHasCaptcha(page)) return { state: "captcha" };

  if (await walmartPageIsSignedIn(page)) {
    payload.loginReady = true;
    const productUrl = payload.productUrl || payload.url;
    // Sync địa chỉ giao hàng ngay sau login
    try {
      sendLog("Walmart: Đang đồng bộ địa chỉ giao hàng...", "info");
      const addrResult = await walmartPlaybook.syncDeliveryAddress(page, payload);
      if (addrResult.success) {
        sendLog("Walmart: Đã cập nhật địa chỉ giao hàng thành công.", "success");
      } else {
        sendLog(`Walmart: Không sync được địa chỉ (${addrResult.reason}), tiếp tục.`, "warning");
      }
    } catch (e) {
      sendLog(`Walmart: Lỗi sync địa chỉ: ${e.message}`, "warning");
    }
    // Xóa toàn bộ giỏ hàng cũ trước khi vào sản phẩm mới
    try {
      sendLog("Walmart: Đang xóa giỏ hàng cũ...", "info");
      const clearResult = await walmartPlaybook.clearCart(page);
      if (clearResult.removed > 0) {
        sendLog(`Walmart: Đã xóa ${clearResult.removed} sản phẩm khỏi giỏ hàng.`, "success");
      } else {
        sendLog("Walmart: Giỏ hàng đã trống, không cần xóa.", "info");
      }
    } catch (e) {
      sendLog(`Walmart: Lỗi xóa giỏ hàng: ${e.message}`, "warning");
    }
    if (productUrl) {
      sendLog("Walmart: Đã đăng nhập, mở thẳng sản phẩm.", "success");
      await page.goto(productUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
      await walmartPlaybook.waitForProductReady(page);
    }
    return { state: "ready" };
  }

  const email = String(payload.account?.email || payload.customer?.email || "").trim();
  const password = String(payload.account?.password || "");
  if (!email || !password) return { state: "credentials" };

  sendLog("Walmart: Mở trang đơn hàng rồi vào trang Login theo luồng chuẩn.", "info");
  if (!/identity\.walmart\.com|\/(?:account\/)?login/i.test(page.url())) {
    if (!/walmart\.com\/orders(?:\/|\?|$)/i.test(page.url())) {
      await page.goto("https://www.walmart.com/orders", {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });
    }
    if (await walmartPageHasCaptcha(page)) return { state: "captcha" };

    await page.goto("https://www.walmart.com/login", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
  }
  if (!/identity\.walmart\.com|\/(?:account\/)?login/i.test(page.url())) {
    await page.waitForURL(/identity\.walmart\.com|\/(?:account\/)?login/i, { timeout: 10000 }).catch(() => { });
  }
  if (!/identity\.walmart\.com|\/(?:account\/)?login/i.test(page.url())) {
    return { state: "fallback" };
  }
  if (await walmartPageHasCaptcha(page)) return { state: "captcha" };

  if (/\/account\/verifyitsyou/i.test(page.url())) {
    const resumedPasswordEntry = await waitForWalmartPasswordEntry(page);
    if (resumedPasswordEntry.state === "captcha") return { state: "captcha" };
    if (resumedPasswordEntry.state === "otp") return { state: "otp" };
    if (!resumedPasswordEntry.input) return { state: "fallback" };
    return submitWalmartPassword(page, payload, password, sendLog, resumedPasswordEntry.input);
  }

  const emailInput = await waitForFirstVisibleLocator(page, walmartPlaybook.SELECTORS.emailInput, 6000);
  if (await walmartPageHasCaptcha(page)) return { state: "captcha" };
  if (!emailInput) return { state: "fallback" };
  await emailInput.fill(email);

  const continueButton = await firstVisibleLocator(page, walmartPlaybook.SELECTORS.continueButton);
  if (!continueButton) return { state: "fallback" };
  await continueButton.click();
  if (await walmartPageHasCaptcha(page)) return { state: "captcha" };

  const passwordEntry = await waitForWalmartPasswordEntry(page);
  if (passwordEntry.state === "captcha") return { state: "captcha" };
  if (passwordEntry.state === "otp") return { state: "otp" };
  const passwordInput = passwordEntry.input;
  if (!passwordInput) return { state: "fallback" };
  return submitWalmartPassword(page, payload, password, sendLog, passwordInput);
}

/**
 * Thử fill địa chỉ tại checkout nếu form đang trống. Silent — không throw.
 */
async function tryFillCheckoutAddress(page, payload, sendLog) {
  try {
    if (!/walmart\.com\/checkout/i.test(page.url())) return;
    const result = await walmartPlaybook.fillAddressInCheckout(page, payload);
    if (result.skipped) {
      sendLog(`Walmart: Địa chỉ checkout đã có, bỏ qua fill (${result.reason}).`, "info");
    } else if (result.success) {
      sendLog("Walmart: Đã fill địa chỉ giao hàng tại checkout.", "success");
    } else {
      sendLog(`Walmart: Không fill được địa chỉ checkout (${result.reason}).`, "warning");
    }
  } catch (e) {
    sendLog(`Walmart: Lỗi fill địa chỉ checkout: ${e.message}`, "warning");
  }
}

function finishWalmartPause({ page, tracer, sessionLogger, history, reason, pauseMessage, sendStatus, totalSteps = 0, details = {} }) {
  sendStatus("waiting_user_input", { reason: pauseMessage, pauseReason: reason, ...details });
  tracer.recordPause(pauseMessage);
  tracer.finalize(false, page.url());
  sessionLogger.logSessionEnd({
    success: false,
    finalUrl: page.url(),
    totalSteps,
    reason: `pause:${reason}`,
    tracer,
  });
  return { handled: true, tracer, resumeHistory: history };
}

async function runWalmartScriptedFastPath(page, payload, sendLog, sendStatus, tracer, sessionLogger, history, totalSteps = 0) {
  if (await walmartPageHasCaptcha(page)) {
    const pauseMessage = "Walmart yêu cầu xác minh người dùng. Vui lòng xử lý CAPTCHA trên màn hình.";
    sendLog("Walmart: Gặp CAPTCHA, dừng để người dùng xử lý.", "warning");
    return finishWalmartPause({ page, tracer, sessionLogger, history, reason: "captcha", pauseMessage, sendStatus, totalSteps });
  }

  if (!payload.loginReady && !payload.cartReady) {
    const loginState = await runWalmartLoginPreflight(page, payload, sendLog);
    if (loginState.state === "captcha") {
      const pauseMessage = "Walmart yêu cầu xác minh người dùng. Vui lòng xử lý CAPTCHA trên màn hình.";
      sendLog("Walmart: Login preflight bị CAPTCHA, chờ người dùng.", "warning");
      return finishWalmartPause({ page, tracer, sessionLogger, history, reason: "captcha", pauseMessage, sendStatus, totalSteps });
    }
    if (loginState.state === "credentials") {
      const pauseMessage = "Vui lòng nhập email và mật khẩu Walmart để tiếp tục.";
      sendLog("Walmart: Thiếu thông tin đăng nhập, chờ Affree form.", "warning");
      return finishWalmartPause({ page, tracer, sessionLogger, history, reason: "credentials", pauseMessage, sendStatus, totalSteps });
    }
    if (loginState.state === "otp") {
      const pauseMessage = "Walmart không còn tùy chọn Password và yêu cầu mã xác minh. Vui lòng nhập OTP để tiếp tục.";
      sendLog("Walmart: Đã ưu tiên Password nhưng tài khoản vẫn bị yêu cầu OTP.", "warning");
      return finishWalmartPause({ page, tracer, sessionLogger, history, reason: "otp", pauseMessage, sendStatus, totalSteps });
    }
    if (loginState.state === "fallback") {
      sendLog("Walmart: Login preflight gặp DOM lạ, chuyển sang đọc DOM và AI fallback.", "warning");
      return null;
    }
  }

  const productUrl = payload.productUrl || payload.url;
  if (!payload.cartReady && productUrl && !/\/ip\//i.test(page.url())) {
    sendLog("Walmart: Fast path mở trực tiếp product URL sau login.", "info");
    await page.goto(productUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await walmartPlaybook.waitForProductReady(page);
    if (await walmartPageHasCaptcha(page)) {
      const pauseMessage = "Walmart yêu cầu xác minh người dùng. Vui lòng xử lý CAPTCHA trên màn hình.";
      return finishWalmartPause({ page, tracer, sessionLogger, history, reason: "captcha", pauseMessage, sendStatus, totalSteps });
    }
  }

  if (!payload.cartReady && /\/ip\//i.test(page.url())) {
    if (!payload.variantConfirmed && !payload._colorSelected) {
      const optionGroups = await walmartPlaybook.extractVariantGroups(page);
      if (optionGroups.length > 0) {
        const pauseMessage = "Vui lòng chọn màu và kích thước trực tiếp trên màn hình Walmart.";
        sendLog("Walmart: Fast path phát hiện màu/size, mở stream crop cho người dùng chọn.", "success");
        return finishWalmartPause({
          page,
          tracer,
          sessionLogger,
          history,
          reason: "variant",
          pauseMessage,
          sendStatus,
          totalSteps,
          details: { optionGroups, nativeForm: true },
        });
      }

      if (await walmartPlaybook.hasVariantControls(page)) {
        const pauseMessage = "Vui lòng chọn màu và kích thước trực tiếp trên màn hình Walmart.";
        sendLog("Walmart: Có vùng màu/size nhưng parser chưa đọc sạch, mở stream crop.", "warning");
        return finishWalmartPause({
          page,
          tracer,
          sessionLogger,
          history,
          reason: "variant",
          pauseMessage,
          sendStatus,
          totalSteps,
          details: { nativeForm: false },
        });
      }
    }

    const cartResult = await walmartPlaybook.addProductToCart(page, payload);
    if (cartResult.success) {
      payload.cartReady = true;
      sendLog("Walmart: Fast path đã thêm sản phẩm vào giỏ, đang mở checkout.", "success");
      const checkoutResult = await walmartPlaybook.openCheckoutFromCart(page);
      if (!checkoutResult.success) return null;
      const pauseMessage = "Walmart đã mở checkout hoặc form địa chỉ. Vui lòng thao tác trực tiếp trên màn hình.";
      await tryFillCheckoutAddress(page, payload, sendLog);
      return finishWalmartPause({ page, tracer, sessionLogger, history, reason: "review", pauseMessage, sendStatus, totalSteps });
    }

    sendLog(`Walmart: Fast path chưa thêm được giỏ (${cartResult.reason || "unknown"}), chuyển sang đọc DOM và AI fallback.`, "warning");
    return null;
  }

  if (payload.cartReady) {
    const checkoutResult = await walmartPlaybook.openCheckoutFromCart(page);
    if (!checkoutResult.success) {
      sendLog(`Walmart: Fast path chưa mở được checkout (${checkoutResult.reason || "unknown"}), chuyển sang đọc DOM và AI fallback.`, "warning");
      return null;
    }

    const pauseMessage = "Walmart đã tới checkout. Vui lòng chọn vận chuyển, giờ nhận, thanh toán và hoàn tất trên màn hình.";
    sendLog("Walmart: Đã tới checkout, dừng cho người dùng thao tác.", "success");
    await tryFillCheckoutAddress(page, payload, sendLog);
    return finishWalmartPause({
      page,
      tracer,
      sessionLogger,
      history,
      reason: "review",
      pauseMessage,
      sendStatus,
      totalSteps,
      details: {
        checkoutUrl: page.url(),
        nativeForm: false,
      },
    });
  }

  return null;
}

/**
 * Vòng lặp Agentic Tool-Use — multi-turn conversation thực sự.
 * AI có full history, tự quyết định dùng tool nào và khi nào.
 */
async function runAgenticToolUseLoop(page, payload, sendLog, sendStatus, options = {}) {
  const isWalmartPayload = String(payload.chain || "").toLowerCase() === "walmart";
  const domain = domainFromUrl(payload.url || "");
  const tracer = options.existingTracer || createSessionTracer(domain, payload);
  const sessionLogger = createSessionLogger(domain, payload);
  const history = options.resumeHistory ? [...options.resumeHistory] : [];

  if (isWalmartPayload && !payload.loginReady && !payload.account?.email) {
    const pauseMessage = "Vui lòng nhập email và mật khẩu Walmart để tiếp tục.";
    sendLog("Walmart: Chờ thông tin đăng nhập trước khi mở website.", "warning");
    sendStatus("waiting_user_input", { reason: pauseMessage, pauseReason: "credentials" });
    tracer.recordPause(pauseMessage);
    tracer.finalize(false, page.url());
    sessionLogger.logSessionEnd({ success: false, finalUrl: page.url(), totalSteps: 0, reason: "pause:credentials", tracer });
    return { handled: true, tracer, resumeHistory: history };
  }

  // Riêng Walmart để Qwen tự gọi navigate từ about:blank. Như vậy mọi thao tác
  // điều hướng/click/type đều thuộc tool history, không bị script chạy trước AI.
  if (!options.skipInitialGoto && !isWalmartPayload) {
    const initialUrl = payload.url;
    sendLog(`Đang mở: ${initialUrl}...`);
    try {
      await page.goto(initialUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForTimeout(4000);
      sendLog("Đã tải xong trang.", "success");
    } catch (gotoErr) {
      sendLog(`Lỗi điều hướng: ${gotoErr.message}`, "error");
    }
  }

  const hasKey = QWEN_API_KEY || GEMINI_API_KEY || ANTHROPIC_API_KEY;
  if (!hasKey) {
    sendLog("Chưa cấu hình API Key để chạy Agentic Tool-Use.", "error");
    sendStatus("failed", { error: "Missing LLM API key" });
    return { handled: true, tracer, resumeHistory: history };
  }

  const engineLabel = QWEN_API_KEY ? `Qwen (${QWEN_MODELS.join(" → ")})` : ANTHROPIC_API_KEY ? `Claude (${ANTHROPIC_MODEL})` : `Gemini (${GEMINI_MODEL})`;
  sendLog(`${isWalmartPayload ? "Walmart: Qwen là bộ điều phối chính" : "Khởi chạy AI Tool-Use"} (${engineLabel}).`, "info");

  const skillInstruction = loadSkillInstruction(domain);
  if (skillInstruction) {
    sendLog(`Đã nạp skill điều khiển cho ${domain}.`, "info");
  } else {
    sendLog(`Chưa có skill fallback cho ${domain}, chạy chế độ khám phá.`, "info");
  }
  const systemPrompt = buildToolUseSystemPrompt(payload, skillInstruction);

  // Thêm user message khởi đầu hoặc resume
  if (history.length === 0) {
    history.push({
      role: "user",
      content: isWalmartPayload
        ? payload.loginReady
          ? `Login preflight đã hoàn tất và trang hiện tại là product URL đúng. Không quay lại /account hoặc /orders. Hãy dùng get_dom() để xử lý biến thể nếu có, rồi thêm đúng sản phẩm vào giỏ.`
          : `Bắt đầu login Walmart từ /orders. Tool đầu tiên phải là navigate(url="https://www.walmart.com/orders"), sau đó nếu chưa đăng nhập thì navigate(url="https://www.walmart.com/login"). Nếu gặp CAPTCHA thì pause_for_human(reason="captcha"). Nếu chưa đăng nhập, dùng credentials trong payload. Nếu gặp màn chọn phương thức đăng nhập/xác minh, phải chọn Password/Use password trước rồi mới Continue; không chọn Email code/Text me/SMS/OTP khi còn Password. Khi thấy Hi hoặc Sign Out, mở product URL thật. Không dùng /blocked hoặc URL Walmart Identity trực tiếp.`
        : `Bắt đầu đặt hàng. Hãy gọi get_dom() và screenshot() cùng lúc để kiểm tra chi tiết trạng thái trang và xem có popup quảng cáo, popup chọn địa chỉ, overlay hay thông báo nào cản trở không. Nếu có, hãy tắt hoặc xử lý chúng trước.`,
    });
  } else {
    history.push({
      role: "user",
      content: isWalmartPayload
        ? payload.loginReady
            ? `Login preflight đã hoàn tất và trang hiện tại là product URL đúng. Không quay lại /account hoặc /orders. Hãy gọi get_dom() và tiếp tục từ sản phẩm hiện tại; chỉ dùng screenshot() nếu DOM không đủ hoặc gặp CAPTCHA/popup.`
          : `Người dùng đã hoàn thành thao tác trong luồng login /orders hoặc /login. Hãy gọi get_dom() và tiếp tục từ trang hiện tại. Nếu màn hình có Password/Use password thì chọn Password trước; không chọn email code/SMS/OTP khi còn Password. Nếu đã đăng nhập, mở product URL thật; nếu chưa đăng nhập thì vào https://www.walmart.com/login, không điều hướng tới /blocked hoặc URL Walmart Identity trực tiếp.`
        : `Người dùng đã hoàn thành thao tác yêu cầu. Hãy gọi get_dom() và screenshot() cùng lúc để kiểm tra trạng thái màn hình hiện tại và tiếp tục.`,
    });
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


    if (response.text) {
      sendLog(`AI: ${response.text.slice(0, 120)}`, "info");
    }

    // Không có tool calls → AI đang text-only (không mong muốn)
    if (!response.toolCalls || response.toolCalls.length === 0) {
      sendLog("⚠️ AI không gọi tool nào — thêm nhắc nhở tiếp tục.", "warning");
      history.push({ role: "assistant", content: response.text || "" });
      history.push({
        role: "user",
        content: isWalmartPayload
          ? "Hãy gọi một tool để tiếp tục. Trước tiên gọi get_dom(); chỉ dùng screenshot() nếu DOM không đủ thông tin hoặc gặp CAPTCHA/popup cần nhìn trực quan."
          : "Hãy gọi một tool để tiếp tục. Nếu không biết làm gì tiếp → gọi get_dom() hoặc screenshot().",
      });
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
          const recoveryTool = isWalmartPayload ? "get_dom()" : "screenshot()";
          sendLog(`⚠️ AI gọi ${toolCall.name} lặp lại ${sameToolCount} lần — yêu cầu ${recoveryTool} để đổi context.`, "warning");
          history.push({
            role: "tool_result", toolCallId: toolCall.id, toolName: toolCall.name,
            content: isWalmartPayload
              ? `{"error": "Tool này đã thất bại ${sameToolCount} lần liên tiếp. KHÔNG gọi lại. Hãy gọi get_dom() để đọc lại trạng thái trang. Chỉ gọi screenshot() nếu DOM không đủ hoặc gặp CAPTCHA/popup cần nhìn trực quan."}`
              : `{"error": "Tool này đã thất bại ${sameToolCount} lần liên tiếp. KHÔNG gọi lại. Hãy gọi screenshot() để quan sát trang, hoặc thử chiến lược khác."}`,
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
            credentials: "🔐 Cần thông tin đăng nhập Walmart.",
            variant: "🎨 Chọn màu và size phù hợp trên màn hình.",
            address: "👉 Walmart cần bạn thao tác trực tiếp trên màn hình.",
            payment: "👉 Walmart cần bạn thao tác trực tiếp trên màn hình.",
            review: "✅ Kiểm tra checkout Walmart và tiếp tục trên màn hình.",
            stuck: "🤔 AI không xử lý được — vui lòng thao tác thủ công.",
            other: "👉 Vui lòng thao tác trực tiếp trên màn hình.",
          };
          sendLog(`⚠️ ${pauseMessages[toolResult.pauseReason] || pauseMessages.other}`, "warning");
          sendLog(`Lý do AI dừng: ${toolResult.pauseMessage}`, "info");
          // Guard: nếu AI muốn dừng variant nhưng user đã chọn xong → inject kết quả giả và tiếp tục
          if (toolResult.pauseReason === "variant" && (payload.variantConfirmed || payload._colorSelected)) {
            sendLog("Walmart: variantConfirmed=true, bỏ qua pause variant của AI, tiếp tục add to cart.", "info");
            history.push({
              role: "tool_result",
              toolCallId: toolCall.id,
              toolName: toolCall.name,
              content: JSON.stringify({ terminal: false, skipped: true, reason: "variant already confirmed by user, proceed to add to cart immediately" }),
              imageBase64: null,
            });
            hasTerminal = false;
            continue;
          }
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

      // Detect vừa login thành công qua AI tool-use (AI tự gõ email/password)
      // → sync địa chỉ ngay trước khi navigate PDP
      if (isWalmartPayload && !payload.loginReady && !payload.cartReady && await walmartPageIsSignedIn(page)) {
        payload.loginReady = true;
        sendLog("Walmart: Phát hiện đã đăng nhập, đồng bộ địa chỉ giao hàng...", "info");
        try {
          const addrResult = await walmartPlaybook.syncDeliveryAddress(page, payload);
          if (addrResult.success) {
            sendLog("Walmart: Đã cập nhật địa chỉ giao hàng thành công.", "success");
          } else {
            sendLog(`Walmart: Không sync được địa chỉ (${addrResult.reason}), tiếp tục.`, "warning");
          }
        } catch (e) {
          sendLog(`Walmart: Lỗi sync địa chỉ: ${e.message}`, "warning");
        }
        // Xóa toàn bộ giỏ hàng cũ trước khi AI navigate sang sản phẩm
        try {
          sendLog("Walmart: Đang xóa giỏ hàng cũ...", "info");
          const clearResult = await walmartPlaybook.clearCart(page);
          if (clearResult.removed > 0) {
            sendLog(`Walmart: Đã xóa ${clearResult.removed} sản phẩm khỏi giỏ hàng.`, "success");
          } else {
            sendLog("Walmart: Giỏ hàng đã trống, không cần xóa.", "info");
          }
        } catch (e) {
          sendLog(`Walmart: Lỗi xóa giỏ hàng: ${e.message}`, "warning");
        }
      }

      if (isWalmartPayload && !payload.variantConfirmed && !payload._colorSelected && /\/ip\//i.test(page.url())) {
        const optionGroups = await walmartPlaybook.extractVariantGroups(page);
        if (optionGroups.length > 0) {
          const pauseMessage = "Sản phẩm có nhiều màu hoặc size. Vui lòng chọn biến thể trực tiếp trên màn hình Walmart rồi tiếp tục.";
          sendLog("Walmart: Đã phát hiện màu/size, chuyển sang stream vùng sản phẩm để người dùng chọn.", "success");
          sendStatus("waiting_user_input", { reason: pauseMessage, pauseReason: "variant", optionGroups, nativeForm: true });
          tracer.recordPause(pauseMessage);
          tracer.finalize(false, page.url());
          sessionLogger.logSessionEnd({ success: false, finalUrl: page.url(), totalSteps: turn, reason: "pause:walmart_variant_stream", tracer });
          return { handled: true, tracer, resumeHistory: history };
        }
        if (await walmartPlaybook.hasVariantControls(page)) {
          const pauseMessage = "Sản phẩm có nhiều màu hoặc size. Vui lòng chọn biến thể trực tiếp trên màn hình Walmart rồi tiếp tục.";
          sendLog("Walmart: Có vùng màu/size nhưng không đọc được option sạch, chuyển sang stream crop.", "warning");
          sendStatus("waiting_user_input", { reason: pauseMessage, pauseReason: "variant", nativeForm: false });
          tracer.recordPause(pauseMessage);
          tracer.finalize(false, page.url());
          sessionLogger.logSessionEnd({ success: false, finalUrl: page.url(), totalSteps: turn, reason: "pause:walmart_variant_stream", tracer });
          return { handled: true, tracer, resumeHistory: history };
        }
      }

      // Walmart chỉ cast khi đã tới checkout hoặc form địa chỉ thật: dừng AI
      // để người dùng tiếp tục trực tiếp trên Walmart.
      if (isWalmartPayload && await walmartPlaybook.checkoutHandoffReady(page)) {
        const isCheckoutUrl = /walmart\.com\/checkout(?:\/|\?|$)/i.test(page.url());
        const pauseMessage = isCheckoutUrl
          ? "Walmart đã tới checkout. Vui lòng kiểm tra thông tin và thao tác trực tiếp trên màn hình."
          : "Walmart đang yêu cầu địa chỉ. Vui lòng nhập trực tiếp trên màn hình Walmart.";
        if (isCheckoutUrl) {
          await walmartPlaybook.waitForCheckoutReady(page);
          await tryFillCheckoutAddress(page, payload, sendLog);
        } else {
          await page.waitForTimeout(500);
        }
        sendLog("Walmart: Đã tới bước cần người dùng thao tác, chuyển màn hình Walmart thật.", "success");
        sendStatus("waiting_user_input", {
          reason: pauseMessage,
          pauseReason: "review",
          checkoutUrl: page.url(),
          nativeForm: false,
        });
        tracer.recordPause(pauseMessage);
        tracer.finalize(false, page.url());
        sessionLogger.logSessionEnd({ success: false, finalUrl: page.url(), totalSteps: turn, reason: "pause:walmart_checkout", tracer });
        return { handled: true, tracer, resumeHistory: history };
      }

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


// ═══════════════════════════════════════════════════════════════════════════
// SUBAGENT LOOP — Mini tool-use loop với context độc lập
// Main agent gọi run_subagent() → runSubagentLoop() → trả kết quả tóm tắt
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Chạy một mini tool-use loop với context riêng biệt để xử lý subtask.
 * Không có session logger, không có tracer — chỉ tập trung vào task được giao.
 *
 * @param {object} page - Playwright page (dùng chung với main agent)
 * @param {string} task - Mô tả nhiệm vụ cần thực hiện
 * @param {string} context - Thông tin bổ sung (selectors, giá trị cần điền...)
 * @param {number} maxTurns - Số lượt tối đa (mặc định 25)
 * @param {{ sendLog }} opts - Options
 * @returns {{ success, summary, turns }}
 */
async function runSubagentLoop(page, task, context = "", maxTurns = 25, opts = {}) {
  const { sendLog } = opts;
  const log = (msg, level = "info") => sendLog ? sendLog(`[Subagent] ${msg}`, level) : console.log(`[Subagent] ${msg}`);

  const systemPrompt = `Bạn là AI Subagent chuyên thực hiện một nhiệm vụ cụ thể trên trình duyệt.
Nhiệm vụ: ${task}
Thông tin bổ sung: ${context || "(không có)"}

Quy tắc:
- Chỉ tập trung vào nhiệm vụ được giao, không làm việc khác
- Luôn gọi get_dom() hoặc screenshot() trước khi hành động
- Khi hoàn thành → trả lời bằng text mô tả kết quả (KHÔNG gọi thêm tool nào)
- Nếu không thể thực hiện → trả lời mô tả lý do thất bại
- Tối đa ${maxTurns} lượt gọi tool`;

  // Subagent dùng subset tools (không có run_subagent, pause_for_human, complete_success)
  const { TOOLS } = require("./agent-tools");
  const BLOCKED = ["run_subagent", "pause_for_human", "complete_success"];
  const subTools = TOOLS.filter(t => !BLOCKED.includes(t.name));
  const subToolsGemini = [{ functionDeclarations: subTools.map(t => ({ name: t.name, description: t.description, parameters: t.parameters })) }];
  const subToolsAnthropic = subTools.map(t => ({ name: t.name, description: t.description, input_schema: t.parameters }));
  const subToolsOpenAI = subTools.map(t => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } }));

  let history = [];

  for (let turn = 0; turn < maxTurns; turn++) {
    let toolCalls = [], textContent = "";

    try {
      if (GEMINI_API_KEY) {
        // Gemini: history format = [{role, parts}]
        const contents = buildGeminiContents(history);
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ system_instruction: { parts: [{ text: systemPrompt }] }, tools: subToolsGemini, contents, generationConfig: { temperature: 0.1 } }),
        });
        if (!res.ok) throw new Error(`Gemini ${res.status}`);
        const data = await res.json();
        const parts = data.candidates?.[0]?.content?.parts || [];
        toolCalls = parts.filter(p => p.functionCall).map((p, i) => ({ id: `${p.functionCall.name}_${i}`, name: p.functionCall.name, args: p.functionCall.args || {} }));
        textContent = parts.filter(p => p.text).map(p => p.text).join("");
        // Push model turn to history
        if (parts.length > 0) history.push({ role: "model", parts });

      } else if (ANTHROPIC_API_KEY) {
        const messages = buildAnthropicMessages(history);
        const res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "content-type": "application/json", "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
          body: JSON.stringify({ model: ANTHROPIC_MODEL, max_tokens: 4096, system: systemPrompt, tools: subToolsAnthropic, messages }),
        });
        if (!res.ok) throw new Error(`Anthropic ${res.status}`);
        const data = await res.json();
        const content = data.content || [];
        toolCalls = content.filter(c => c.type === "tool_use").map(c => ({ id: c.id, name: c.name, args: c.input || {} }));
        textContent = content.filter(c => c.type === "text").map(c => c.text).join("");
        if (content.length > 0) history.push({ role: "assistant", content });

      } else if (QWEN_API_KEY) {
        const messages = buildOpenAIMessages(history, systemPrompt);
        const { result: data } = await postQwenChatCompletion((attemptModel) => ({
          model: attemptModel,
          messages,
          tools: subToolsOpenAI,
          tool_choice: "auto",
        }));
        const msg = data.choices?.[0]?.message;
        toolCalls = (msg?.tool_calls || []).map(tc => ({ id: tc.id, name: tc.function.name, args: JSON.parse(tc.function.arguments || "{}") }));
        textContent = msg?.content || "";
        if (msg) history.push({ role: "assistant", content: msg.content || "", tool_calls: msg.tool_calls });
      } else {
        return { success: false, summary: "Không có API key được cấu hình", turns: turn };
      }
    } catch (e) {
      log(`API lỗi turn ${turn}: ${e.message}`, "warning");
      return { success: false, summary: `API error: ${e.message}`, turns: turn };
    }

    // Nếu AI trả về text mà không gọi tool → đã hoàn thành
    if (toolCalls.length === 0) {
      const summary = textContent.trim() || "Subagent đã hoàn thành.";
      log(`Hoàn thành sau ${turn + 1} lượt.`, "success");
      return { success: true, summary: summary.slice(0, 300), turns: turn + 1 };
    }

    // Thực thi tool calls và thêm results vào history
    const toolResults = [];
    for (const tc of toolCalls) {
      log(`Tool: ${tc.name}(${JSON.stringify(tc.args).slice(0, 80)})`, "info");
      const result = await executeTool(tc.name, tc.args || {}, page, { sendLog });
      toolResults.push({ id: tc.id, name: tc.name, content: result.content });
    }

    // Append tool results vào history theo đúng format
    if (GEMINI_API_KEY) {
      history.push({ role: "user", parts: toolResults.map(r => ({ functionResponse: { name: r.name, response: { result: r.content } } })) });
    } else if (ANTHROPIC_API_KEY) {
      history.push({ role: "user", content: toolResults.map(r => ({ type: "tool_result", tool_use_id: r.id, content: [{ type: "text", text: r.content }] })) });
    } else {
      history.push({ role: "tool", content: toolResults.map(r => ({ tool_call_id: r.id, content: r.content })) });
    }
  }

  log(`Đạt giới hạn ${maxTurns} lượt.`, "warning");
  return { success: false, summary: `Subagent đạt giới hạn ${maxTurns} lượt.`, turns: maxTurns };
}



module.exports = {
  runAgenticToolUseLoop,
  runSubagentLoop,
};
