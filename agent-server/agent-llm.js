/**
 * Affree AI Agentic DOM-First Driver (Agent Brain)
 * Thay vì gửi ảnh chụp màn hình (chậm, đắt), ta trích xuất cây DOM tương tác
 * trực tiếp từ Playwright rồi gửi văn bản cấu trúc lên Claude để quyết định.
 * 
 * Kiến trúc:
 * 1. Per-site Playbook: mỗi chuỗi có script riêng xử lý các bước đặc thù (popup, checkout)
 * 2. AI DOM Loop: phần còn lại do Claude phân tích DOM và ra lệnh
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
const { runPlaybook } = require("./playbooks");

/**
 * Trích xuất toàn bộ các phần tử tương tác (input, button, a, select, textarea)
 * từ DOM của trình duyệt Playwright. Trả về mảng JSON mô tả phần tử.
 */
async function extractInteractiveElements(page) {
  return page.evaluate(() => {
    const els = [];
    const selectors = "button, a[href], input, select, textarea, [role='button'], [onclick]";
    const nodes = document.querySelectorAll(selectors);

    for (const el of nodes) {
      const rect = el.getBoundingClientRect();
      // Bỏ qua phần tử ẩn hoặc quá nhỏ (không có giao diện thực sự)
      if (rect.width < 4 || rect.height < 4 || rect.top < 0) continue;
      // Bỏ qua phần tử nằm ngoài tầm nhìn hiện tại (scrolled past viewport)
      if (rect.top > window.innerHeight + 200) continue;

      // Xác định nhãn hiển thị dễ đọc nhất
      const label =
        el.getAttribute("aria-label") ||
        el.getAttribute("placeholder") ||
        el.getAttribute("title") ||
        el.getAttribute("name") ||
        el.getAttribute("id") ||
        el.textContent?.trim().slice(0, 80) ||
        "";

      // Tạo CSS selector đơn giản
      let selector = el.tagName.toLowerCase();
      if (el.id) selector += `#${el.id}`;
      else if (el.className && typeof el.className === "string") {
        const cn = el.className.trim().split(/\s+/).slice(0, 2).join(".");
        if (cn) selector += "." + cn;
      }
      if (el.getAttribute("name")) selector += `[name="${el.getAttribute("name")}"]`;
      if (el.getAttribute("type")) selector += `[type="${el.getAttribute("type")}"]`;

      els.push({
        tag: el.tagName.toLowerCase(),
        type: el.getAttribute("type") || null,
        label: label.replace(/\s+/g, " ").trim(),
        selector: selector,
        value: el.value || null,
        href: el.getAttribute("href") || null,
        disabled: el.disabled || false,
        x: Math.round(rect.left + rect.width / 2),
        y: Math.round(rect.top + rect.height / 2),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      });
    }

    return els.slice(0, 60); // Giới hạn tối đa 60 phần tử để tránh prompt quá dài
  });
}

/**
 * Lấy nội dung text tóm tắt của trang (title + headings + body text 500 ký tự đầu)
 */
async function extractPageSummary(page) {
  return page.evaluate(() => {
    const title = document.title || "";
    const h1 = [...document.querySelectorAll("h1, h2")].map((h) => h.textContent?.trim()).filter(Boolean).join(" | ");
    const bodyText = (document.body?.innerText || "").replace(/\s+/g, " ").slice(0, 600);
    return { title, headings: h1, bodyText };
  });
}

/**
 * Gọi Claude Text API (không dùng Vision) với DOM context để ra quyết định hành động.
 */
async function callClaudeDOM(domContext, promptText) {
  if (!ANTHROPIC_API_KEY) throw new Error("Chưa cấu hình ANTHROPIC_API_KEY");

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 600,
      messages: [
        {
          role: "user",
          content: promptText
        }
      ]
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Claude API Error: ${response.status} - ${errText}`);
  }

  const result = await response.json();
  let textResponse = result.content?.[0]?.text || "";

  // Trích xuất JSON sạch nếu bị bọc bởi markdown
  const jsonMatch = textResponse.match(/\{[\s\S]*\}/);
  if (jsonMatch) textResponse = jsonMatch[0];

  return JSON.parse(textResponse);
}

/**
 * Gọi Gemini Text API (không Vision) với DOM context
 */
async function callGeminiDOM(promptText) {
  if (!GEMINI_API_KEY) throw new Error("Chưa cấu hình GEMINI_API_KEY");

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: promptText }] }],
      generationConfig: { responseMimeType: "application/json" }
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Gemini API Error: ${response.status} - ${errText}`);
  }

  const result = await response.json();
  const textResponse = result.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!textResponse) throw new Error("Không nhận được phản hồi từ Gemini");

  const jsonMatch = textResponse.match(/\{[\s\S]*\}/);
  return JSON.parse(jsonMatch ? jsonMatch[0] : textResponse.trim());
}

/**
 * Gọi Qwen API (OpenAI-compatible) của Alibaba Cloud với DOM context
 */
async function callQwenDOM(promptText) {
  if (!QWEN_API_KEY) throw new Error("Chưa cấu hình QWEN_API_KEY");

  const response = await fetch(QWEN_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${QWEN_API_KEY}`
    },
    body: JSON.stringify({
      model: QWEN_MODEL,
      messages: [
        {
          role: "user",
          content: promptText
        }
      ],
      response_format: { type: "json_object" }
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Qwen API Error: ${response.status} - ${errText}`);
  }

  const result = await response.json();
  const textResponse = result.choices?.[0]?.message?.content;
  if (!textResponse) throw new Error("Không nhận được phản hồi từ Qwen");

  const jsonMatch = textResponse.match(/\{[\s\S]*\}/);
  return JSON.parse(jsonMatch ? jsonMatch[0] : textResponse.trim());
}

/**
 * Tự động phát hiện và đóng các popup/modal cản trở đặt hàng.
 * Trả về true nếu đã đóng ít nhất một popup.
 */
async function dismissPopups(page) {
  return page.evaluate(() => {
    let dismissed = false;

    // 1. Nhấn nút đóng / X trên modal phổ biến
    const closeSelectors = [
      'button[aria-label*="close" i]',
      'button[aria-label*="đóng" i]',
      'button[aria-label*="bỏ qua" i]',
      '.modal .btn-close', '.modal .close', '.modal [class*="close"]',
      '.popup .btn-close', '.popup .close', '.popup [class*="close"]',
      '[class*="modal"] [class*="close"]',
      '[class*="popup"] [class*="close"]',
      '[class*="overlay"] [class*="close"]',
      '[class*="dialog"] [class*="close"]',
      '.location-popup .close', '.address-popup .close',
      '.modal-header .close', '.modal-header button',
      'button:is([title="Close"], [title="Đóng"], [title="close"])',
    ];

    for (const sel of closeSelectors) {
      try {
        const els = document.querySelectorAll(sel);
        for (const el of els) {
          const rect = el.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0 && rect.top >= 0) {
            el.click();
            dismissed = true;
          }
        }
      } catch (e) { }
    }

    // 2. Nếu có backdrop/overlay tối, click vào để đóng
    if (!dismissed) {
      const backdrops = document.querySelectorAll(
        '.modal-backdrop, .overlay-backdrop, [class*="backdrop"], [class*="mask"]'
      );
      for (const bd of backdrops) {
        const rect = bd.getBoundingClientRect();
        if (rect.width > 200 && rect.height > 200) {
          bd.click();
          dismissed = true;
        }
      }
    }

    return dismissed;
  });
}

/**
 * Kiểm tra xem hiện tại có modal/popup nào đang hiện không để cảnh báo AI.
 */
async function detectActivePopup(page) {
  return page.evaluate(() => {
    const modalSelectors = [
      '.modal.show', '.modal[style*="display: block"]', '.modal[style*="display:block"]',
      '[class*="popup"][style*="display"]', '[class*="overlay"]:not([style*="none"])',
      '[class*="dialog"]:not([aria-hidden="true"])',
    ];
    for (const sel of modalSelectors) {
      try {
        const el = document.querySelector(sel);
        if (el) {
          const rect = el.getBoundingClientRect();
          if (rect.width > 100 && rect.height > 100) {
            return el.className || el.id || sel;
          }
        }
      } catch (e) { }
    }
    return null;
  });
}

/**
 * Vòng lặp điều khiển chính của AI Agent - DOM-first approach
 */
async function runAgenticLoop(page, payload, sendLog, sendStatus, options = {}, sendMessage = null) {
  const { productName, qty, buyerName, buyerPhone, buyerAddress, chain } = payload;

  // Kiểm tra API Key
  const hasKey = QWEN_API_KEY || GEMINI_API_KEY || ANTHROPIC_API_KEY;
  if (!hasKey) {
    sendLog("⚠️ CẢNH BÁO: Chưa cấu hình QWEN_API_KEY, GEMINI_API_KEY hoặc ANTHROPIC_API_KEY.", "error");
    sendLog("Vui lòng gán API Key vào file agent-server/.env của bạn.", "error");
    return false;
  }

  let engineLabel = "";
  if (QWEN_API_KEY) {
    engineLabel = `Qwen (${QWEN_MODEL})`;
  } else if (ANTHROPIC_API_KEY) {
    engineLabel = `Claude (${ANTHROPIC_MODEL})`;
  } else {
    engineLabel = `Gemini (${GEMINI_MODEL})`;
  }
  sendLog(`Khởi động AI Agentic (${engineLabel})...`, "success");

  // Điều hướng tới URL sản phẩm mục tiêu đầu tiên
  const { url } = payload;
  if (!options.skipInitialGoto) {
    sendLog(`Đang mở trang sản phẩm: ${url}...`);
    try {
      // Dùng "load" để đảm bảo JS đã chạy xong (quan trọng cho popup lazy-render)
      await page.goto(url, { waitUntil: "load", timeout: 30000 });
      sendLog("Đã tải xong trang. Bắt đầu xử lý...", "success");
    } catch (gotoErr) {
      sendLog(`Lỗi điều hướng ban đầu: ${gotoErr.message}`, "error");
    }
  } else {
    sendLog("Tiếp tục AI loop trên trang hiện tại sau khi người dùng đã can thiệp.", "info");
  }

  // Chạy Playbook đặc thù của chuỗi cửa hàng (nếu có) trước khi vào AI loop
  try {
    const pbResult = await runPlaybook(page, payload, sendLog, sendStatus, sendMessage);
    if (pbResult) {
      sendLog(`Playbook ${payload.chain}: ${pbResult.done ? "Hoàn tất" : "Bootstrap xong"}.`, "success");
      if (pbResult.done) return true; // Playbook tự hoàn thành hoàn toàn, không cần AI
      await page.waitForTimeout(1000); // Chờ trang ổn định sau bootstrap
    }
  } catch (pbErr) {
    sendLog(`Lỗi trong Playbook: ${pbErr.message}`, "warning");
    // Không ném lỗi — tiếp tục AI loop như thường
  }

  const MAX_STEPS = 25;

  for (let step = 1; step <= MAX_STEPS; step++) {
    const currentUrl = page.url();
    sendLog(`[Step ${step}/${MAX_STEPS}] Đang phân tích DOM...`);

    // 0. Tự động tắt tất cả popup cản trở trước khi phân tích
    try {
      const dismissed = await dismissPopups(page);
      if (dismissed) {
        sendLog("Phát hiện và đã tự động đóng popup cản trở.", "warning");
        await page.waitForTimeout(600);
      }
    } catch (e) { }
    // Thử nhấn Escape để tắt modal nếu còn sót
    try { await page.keyboard.press("Escape"); } catch (e) { }

    // 1. Trích xuất cấu trúc DOM và context trang
    let elements = [];
    let pageSummary = { title: "", headings: "", bodyText: "" };
    let activePopup = null;
    try {
      elements = await extractInteractiveElements(page);
      pageSummary = await extractPageSummary(page);
      activePopup = await detectActivePopup(page);
    } catch (domErr) {
      sendLog(`Lỗi đọc DOM: ${domErr.message}`, "warning");
    }

    // 2. Soạn prompt text gửi lên AI (không cần ảnh)
    const elementsStr = elements
      .map((el, i) =>
        `[${i}] tag=${el.tag} type=${el.type || ""} x=${el.x} y=${el.y} label="${el.label}" selector="${el.selector}" disabled=${el.disabled}`
      )
      .join("\n");

    const popupWarning = activePopup
      ? `- ⚠️ HIỆN CÓ POPUP/MODAL ĐANG MỞ: class="${activePopup}". Hãy ưu tiên tìm nút đóng (X, Close, Đóng, Tiếp tục, Bỏ qua...) trong danh sách phần tử để tắt popup này TRƯỚC KHI làm bất cứ việc gì khác.\n`
      : "";

    const promptText = `Bạn là AI Agent điều khiển trình duyệt để đặt hàng online.
Thông tin đặt hàng:
- Sản phẩm: "${productName}"
- Số lượng: ${qty}
- Họ tên người nhận: "${buyerName}"
- SĐT: "${buyerPhone}"
- Địa chỉ: "${buyerAddress}"
- Chuỗi: "${chain.toUpperCase()}"

Trạng thái trình duyệt hiện tại:
- URL: "${currentUrl}"
- Tiêu đề trang: "${pageSummary.title}"
- Tiêu đề nội dung: "${pageSummary.headings}"
- Nội dung tóm tắt (600 ký tự đầu): "${pageSummary.bodyText}"
${popupWarning}
Danh sách phần tử tương tác trên trang (tối đa 60 phần tử):
${elementsStr || "(Không tìm thấy phần tử nào)"}

Quy tắc xử lý:
1. Nếu bạn thấy nút "Mua ngay", "Thêm vào giỏ", "Đặt hàng" hoặc tương tự → hành động CLICK vào đó
2. Nếu bạn thấy form điền thông tin giao hàng → CLICK vào input tương ứng, sau đó TYPE nội dung
3. Nếu thấy màn hình thành công (URL chứa thank-you, order-complete, hoặc text 'Đặt hàng thành công', 'Cảm ơn') → action "success"
4. Nếu thấy màn hình OTP, mật khẩu, CAPTCHA, hoặc thông tin thẻ ngân hàng → action "pause"
5. Nếu cần cuộn xuống để thấy nút đặt hàng → action "scroll"

Trả về JSON (chỉ JSON, không markdown):
{
  "action": "click" | "type" | "keypress" | "scroll" | "wait" | "pause" | "success",
  "selector": "CSS selector của phần tử cần tương tác (nếu action là click/type)",
  "x": number (tọa độ X từ danh sách phần tử, dùng khi không có selector chính xác),
  "y": number (tọa độ Y từ danh sách phần tử, dùng khi không có selector chính xác),
  "text": "văn bản cần điền (chỉ dùng khi action là type)",
  "key": "tên phím (chỉ dùng khi action là keypress, vd: Enter, Tab)",
  "direction": "down" | "up" (chỉ dùng khi action là scroll),
  "ms": number (thời gian chờ ms, chỉ dùng khi action là wait),
  "reason": "Giải thích ngắn gọn lý do hành động này bằng tiếng Việt"
}`;

    // 3. Gọi AI
    let decision;
    try {
      if (QWEN_API_KEY) {
        decision = await callQwenDOM(promptText);
      } else if (ANTHROPIC_API_KEY) {
        decision = await callClaudeDOM(elementsStr, promptText);
      } else {
        decision = await callGeminiDOM(promptText);
      }
    } catch (apiErr) {
      sendLog(`Lỗi API AI: ${apiErr.message}`, "error");
      throw apiErr;
    }

    sendLog(`AI → ${decision.action.toUpperCase()}: ${decision.reason}`, "info");

    // 4. Thực thi hành động
    try {
      switch (decision.action) {
        case "click": {
          // Ưu tiên dùng CSS selector trực tiếp (nhanh và chính xác)
          if (decision.selector) {
            try {
              const locator = page.locator(decision.selector).first();
              await locator.scrollIntoViewIfNeeded();
              await locator.click({ timeout: 5000 });
              sendLog(`Đã click: ${decision.selector}`, "success");
            } catch {
              // Fallback về tọa độ nếu selector không khớp
              await page.mouse.click(decision.x, decision.y);
              sendLog(`Click tọa độ fallback (${decision.x}, ${decision.y})`, "warning");
            }
          } else {
            await page.mouse.click(decision.x, decision.y);
          }
          await page.waitForTimeout(1200);
          break;
        }

        case "type":
          // Nếu có selector, focus trước rồi gõ
          if (decision.selector) {
            try {
              const locator = page.locator(decision.selector).first();
              await locator.scrollIntoViewIfNeeded();
              await locator.click({ timeout: 5000 });
              await locator.fill(""); // Xóa nội dung cũ trước
              await locator.type(decision.text, { delay: 30 });
              sendLog(`Đã điền "${decision.text}" vào: ${decision.selector}`, "success");
            } catch {
              await page.keyboard.type(decision.text, { delay: 30 });
            }
          } else {
            await page.keyboard.type(decision.text, { delay: 30 });
          }
          await page.waitForTimeout(500);
          break;

        case "keypress":
          await page.keyboard.press(decision.key);
          await page.waitForTimeout(500);
          break;

        case "scroll":
          await page.evaluate((dir) => {
            window.scrollBy(0, dir === "up" ? -400 : 400);
          }, decision.direction || "down");
          await page.waitForTimeout(800);
          break;

        case "wait":
          await page.waitForTimeout(decision.ms || 2000);
          break;

        case "pause":
          sendLog("⚠️ AI Agent dừng lại — cần bạn can thiệp (OTP / CAPTCHA / Mật khẩu / Thẻ thanh toán).", "warning");
          sendLog("👉 Hãy thao tác trực tiếp trên màn hình điều khiển ở Web App.", "info");
          sendStatus("waiting_user_input", {
            reason: decision.reason
          });
          return true;

        case "success":
          sendLog("🎉 Đơn hàng đã được đặt thành công!", "success");
          sendStatus("completed", { orderUrl: currentUrl });
          return true;

        default:
          sendLog(`Hành động không xác định: ${decision.action}`, "warning");
      }
    } catch (actionErr) {
      sendLog(`Lỗi thực thi hành động: ${actionErr.message}`, "warning");
    }

    // Chờ 1s giữa các bước
    await page.waitForTimeout(1000);
  }

  sendLog("⚠️ Đã đạt giới hạn tối đa 25 bước. Dừng AI Agent.", "warning");
  sendStatus("failed", { error: "Max steps reached" });
  return true;
}

module.exports = {
  runAgenticLoop
};
