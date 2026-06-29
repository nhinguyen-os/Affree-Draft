/**
 * Affree AI Agentic — Tool Definitions & Executor
 *
 * Định nghĩa tools AI có thể gọi và executor chạy chúng với Playwright.
 * Hỗ trợ 3 format API: Gemini Function Calling, Anthropic Tool Use, OpenAI/Qwen.
 *
 * Quy định ngôn ngữ: Comments và log tiếng Việt, biến/hàm tiếng Anh.
 */

const { readSkillByName, listSkillFiles, writeSkillByName } = require("./skill-store");

// ═══════════════════════════════════════════════════════════════════════════
// TOOL DEFINITIONS — format-agnostic specs
// ═══════════════════════════════════════════════════════════════════════════

const TOOLS = [
  {
    name: "get_dom",
    description:
      "Lấy thông tin trang hiện tại: URL, tiêu đề, nội dung text, danh sách phần tử tương tác (buttons, inputs, links). " +
      "Gọi đầu tiên sau mỗi điều hướng hoặc khi cần biết trạng thái trang trước khi hành động.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "screenshot",
    description:
      "Chụp ảnh màn hình trình duyệt. Dùng khi DOM không đủ thông tin, trang có nhiều animation/canvas, " +
      "hoặc cần thấy giao diện thực tế để quyết định bước tiếp theo. Kết quả trả về hình ảnh.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "dismiss_popups",
    description:
      "CẢNH BÁO: Hạn chế tối đa dùng tool này. Chỉ dùng khi có popup quảng cáo/thông báo thông thường cản trở mà bạn không thể tự click nút tắt (X, Close) bằng công cụ click. " +
      "TUYỆT ĐỐI KHÔNG dùng khi gặp popup yêu cầu tương tác (như chọn địa chỉ, đăng nhập, hoặc điền form). Khi gặp popup yêu cầu tương tác, hãy tự click/type trực tiếp lên các phần tử của popup đó.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "click",
    description:
      "Click vào một phần tử trên trang. Ưu tiên dùng selector CSS. " +
      "Tọa độ (x, y) chỉ dùng làm fallback khi không có selector phù hợp.",
    parameters: {
      type: "object",
      properties: {
        selector: {
          type: "string",
          description: "CSS selector của phần tử (ví dụ: button.submit, #add-to-cart, .btn-checkout)",
        },
        x: { type: "number", description: "Tọa độ X pixel (fallback khi không có selector)" },
        y: { type: "number", description: "Tọa độ Y pixel (fallback khi không có selector)" },
        reason: { type: "string", description: "Mô tả ngắn lý do click" },
      },
    },
  },
  {
    name: "type",
    description:
      "Gõ văn bản vào ô nhập liệu. Tự động click vào ô trước khi gõ, mặc định xóa nội dung cũ trước.",
    parameters: {
      type: "object",
      properties: {
        selector: { type: "string", description: "CSS selector của input/textarea" },
        text: { type: "string", description: "Văn bản cần gõ" },
        clearFirst: {
          type: "boolean",
          description: "Xóa nội dung cũ trước khi gõ (mặc định true)",
        },
        reason: { type: "string", description: "Mô tả lý do điền field này" },
      },
      required: ["text"],
    },
  },
  {
    name: "keypress",
    description:
      "Nhấn một phím bàn phím. Thường dùng: Enter (submit form/tìm kiếm), Escape (đóng popup), Tab (chuyển field).",
    parameters: {
      type: "object",
      properties: {
        key: {
          type: "string",
          description: "Tên phím Playwright: Enter, Escape, Tab, ArrowDown, ArrowUp, Backspace...",
        },
      },
      required: ["key"],
    },
  },
  {
    name: "scroll",
    description:
      "Cuộn trang để xem thêm nội dung. Dùng khi cần tìm phần tử nằm ngoài viewport hiện tại.",
    parameters: {
      type: "object",
      properties: {
        direction: {
          type: "string",
          enum: ["down", "up"],
          description: "Hướng cuộn",
        },
        amount: {
          type: "number",
          description: "Số pixel cuộn (mặc định 400)",
        },
      },
      required: ["direction"],
    },
  },
  {
    name: "navigate",
    description:
      "Điều hướng trình duyệt tới URL khác. Dùng khi bị redirect sai (ví dụ: bay sang Zalo) " +
      "hoặc cần quay về trang sản phẩm/tìm kiếm.",
    parameters: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "URL đích đầy đủ (bắt đầu bằng https://)",
        },
      },
      required: ["url"],
    },
  },
  {
    name: "select_option",
    description:
      "Chọn một option trong <select> dropdown. Thử theo label text trước, sau đó theo value.",
    parameters: {
      type: "object",
      properties: {
        selector: { type: "string", description: "CSS selector của <select> element" },
        value: { type: "string", description: "Label text hoặc value của option cần chọn" },
      },
      required: ["selector", "value"],
    },
  },
  {
    name: "wait",
    description:
      "Chờ một khoảng thời gian để trang tải xong, animation kết thúc, hoặc dữ liệu async được render.",
    parameters: {
      type: "object",
      properties: {
        ms: { type: "number", description: "Số milliseconds cần chờ (tối đa 5000)" },
      },
      required: ["ms"],
    },
  },
  {
    name: "pause_for_human",
    description:
      "TERMINAL ACTION: Tạm dừng và yêu cầu người dùng can thiệp thủ công. " +
      "Dùng khi: (1) cần nhập mã OTP, (2) giải CAPTCHA, (3) chọn địa chỉ dropdown đa tầng phức tạp, " +
      "(4) cần chọn phương thức thanh toán không phải COD, (5) tất cả thông tin đã điền xong và cần review trước khi đặt. " +
      "KHÔNG tự click nút Đặt hàng/Xác nhận cuối cùng — đây là bước cần người dùng duyệt.",
    parameters: {
      type: "object",
      properties: {
        reason: {
          type: "string",
          enum: ["otp", "captcha", "address", "payment", "review", "stuck", "other"],
          description: "Loại can thiệp cần từ người dùng",
        },
        message: {
          type: "string",
          description: "Hướng dẫn cụ thể cho người dùng cần làm gì",
        },
      },
      required: ["reason", "message"],
    },
  },
  {
    name: "complete_success",
    description:
      "TERMINAL ACTION: Báo cáo đặt hàng thành công. " +
      "Chỉ gọi khi đã thấy màn hình xác nhận đơn hàng (thank-you page, mã đơn hàng hiển thị rõ ràng).",
    parameters: {
      type: "object",
      properties: {
        orderId: { type: "string", description: "Mã đơn hàng nếu hiển thị trên trang" },
        message: { type: "string", description: "Mô tả ngắn trạng thái thành công" },
      },
    },
  },
  // ── Skill Tools ──────────────────────────────────────────────────
  {
    name: "list_skills",
    description:
      "Liệt kê tất cả skill files có sẵn trong thư mục skills. " +
      "Gọi ở đầu phiên để biết domain nào đã có skill instruction.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "read_skill",
    description:
      "Dọc nội dung một skill file theo tên. " +
      "Ví dụ: read_skill(name='cooponline.vn') hoặc read_skill(name='_master') để đọc master skill. " +
      "Dùng khi cần biết hướng dẫn chi tiết cho domain đang làm việc.",
    parameters: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Tên skill file (ví dụ: 'cooponline.vn', 'pnj.com.vn', '_master'). Đuôi .md có thể bỏ qua.",
        },
      },
      required: ["name"],
    },
  },
  {
    name: "update_skill",
    description:
      "Thêm thông tin mới vào cuối skill file. Dùng khi phát hiện pattern mới, selector mới, " +
      "hoặc vấn đề chưa được ghi nhận trong skill hiện tại. " +
      "KHÔNG được ghi vào _master.md.",
    parameters: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Tên skill file cần cập nhật (ví dụ: 'cooponline.vn').",
        },
        content: {
          type: "string",
          description: "Nội dung markdown cần thêm vào cuối file. Dùng cấu trúc ## heading + bullet points.",
        },
      },
      required: ["name", "content"],
    },
  },
  {
    name: "run_subagent",
    description:
      "Chạy một subagent độc lập để xử lý một subtask phức tạp. " +
      "Subagent có context riêng biệt, gọi tools rồi trả kết quả tóm tắt ngắn gọn. " +
      "Dùng cho: chọn địa chỉ dropdown đa tầng, điền form phức tạp, xử lý popup đặc biệt. " +
      "KHÔNG dùng cho các bước đơn giản — chỉ khi task thực sự phức tạp hoặc bị stuck.",
    parameters: {
      type: "object",
      properties: {
        task: {
          type: "string",
          description: "Mô tả rõ ràng nhiệm vụ subagent cần thực hiện (ví dụ: 'Chọn tỉnh/quận/phường trong popup địa chỉ')",
        },
        context: {
          type: "string",
          description: "Thông tin cần thiết cho subagent: selectors, giá trị cần điền, trạng thái hiện tại. Tối đa 500 ký tự.",
        },
        maxTurns: {
          type: "number",
          description: "Số lượt tối đa cho subagent (mặc định 25, tối đa 40)",
        },
      },
      required: ["task", "context"],
    },
  },
];


// ═══════════════════════════════════════════════════════════════════════════
// FORMAT CONVERTERS — chuyển đổi TOOLS sang format của từng LLM API
// ═══════════════════════════════════════════════════════════════════════════

/** Gemini Function Declarations format */
function getToolsForGemini() {
  return [{ functionDeclarations: TOOLS.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters })) }];
}

/** Anthropic Tool Use format */
function getToolsForAnthropic() {
  return TOOLS.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }));
}

/** OpenAI / Qwen compatible format */
function getToolsForOpenAI() {
  return TOOLS.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } }));
}

// ═══════════════════════════════════════════════════════════════════════════
// CONVERSATION HISTORY BUILDERS
// Internal format:
// { role: "user", content: string, imageBase64?: string }
// { role: "assistant", content?: string, toolCalls?: [{id, name, args}] }
// { role: "tool_result", toolCallId: string, toolName: string, content: string, imageBase64?: string }
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Convert internal history sang Gemini contents format.
 */
function buildGeminiContents(history) {
  const contents = [];
  let i = 0;
  while (i < history.length) {
    const msg = history[i];

    if (msg.role === "user") {
      const parts = [];
      if (msg.content) parts.push({ text: msg.content });
      if (msg.imageBase64) parts.push({ inlineData: { mimeType: "image/jpeg", data: msg.imageBase64 } });
      if (parts.length > 0) contents.push({ role: "user", parts });
      i++;
    } else if (msg.role === "assistant") {
      const parts = [];
      if (msg.content) parts.push({ text: msg.content });
      if (msg.toolCalls) {
        for (const tc of msg.toolCalls) {
          parts.push({ functionCall: { name: tc.name, args: tc.args || {} } });
        }
      }
      if (parts.length > 0) contents.push({ role: "model", parts });
      i++;

      // Thu thập tất cả tool_result liên tiếp vào 1 user turn
      const resultParts = [];
      while (i < history.length && history[i].role === "tool_result") {
        const tr = history[i];
        resultParts.push({ functionResponse: { name: tr.toolName, response: { result: tr.content } } });
        // Thêm ảnh vào cùng turn nếu là screenshot
        if (tr.imageBase64) {
          resultParts.push({ inlineData: { mimeType: "image/jpeg", data: tr.imageBase64 } });
        }
        i++;
      }
      if (resultParts.length > 0) {
        contents.push({ role: "user", parts: resultParts });
      }
    } else {
      i++; // skip unknown
    }
  }
  return contents;
}

/**
 * Convert internal history sang Anthropic messages format.
 */
function buildAnthropicMessages(history) {
  const messages = [];
  let i = 0;
  while (i < history.length) {
    const msg = history[i];

    if (msg.role === "user") {
      const content = [];
      if (msg.content) content.push({ type: "text", text: msg.content });
      if (msg.imageBase64) {
        content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: msg.imageBase64 } });
      }
      // Nếu chỉ có 1 text part → shorthand string
      messages.push({
        role: "user",
        content: content.length === 1 && content[0].type === "text" ? content[0].text : content,
      });
      i++;
    } else if (msg.role === "assistant") {
      const content = [];
      if (msg.content) content.push({ type: "text", text: msg.content });
      if (msg.toolCalls) {
        for (const tc of msg.toolCalls) {
          content.push({ type: "tool_use", id: tc.id, name: tc.name, input: tc.args || {} });
        }
      }
      messages.push({ role: "assistant", content });
      i++;

      // Thu thập tool results
      const toolResults = [];
      while (i < history.length && history[i].role === "tool_result") {
        const tr = history[i];
        if (tr.imageBase64) {
          toolResults.push({
            type: "tool_result",
            tool_use_id: tr.toolCallId,
            content: [{ type: "image", source: { type: "base64", media_type: "image/jpeg", data: tr.imageBase64 } }],
          });
        } else {
          toolResults.push({ type: "tool_result", tool_use_id: tr.toolCallId, content: tr.content });
        }
        i++;
      }
      if (toolResults.length > 0) {
        messages.push({ role: "user", content: toolResults });
      }
    } else {
      i++;
    }
  }
  return messages;
}

/**
 * Convert internal history sang OpenAI/Qwen messages format.
 */
function buildOpenAIMessages(history, systemPrompt) {
  const messages = [{ role: "system", content: systemPrompt }];
  for (const msg of history) {
    if (msg.role === "user") {
      messages.push({ role: "user", content: msg.content || "" });
    } else if (msg.role === "assistant") {
      const m = { role: "assistant", content: msg.content || null };
      if (msg.toolCalls && msg.toolCalls.length > 0) {
        m.tool_calls = msg.toolCalls.map((tc) => ({
          id: tc.id,
          type: "function",
          function: { name: tc.name, arguments: JSON.stringify(tc.args || {}) },
        }));
      }
      messages.push(m);
    } else if (msg.role === "tool_result") {
      // Qwen không hỗ trợ ảnh trong tool result — chỉ gửi text
      messages.push({ role: "tool", tool_call_id: msg.toolCallId, content: msg.imageBase64 ? "[Screenshot captured]" : msg.content });
    }
  }
  return messages;
}

// ═══════════════════════════════════════════════════════════════════════════
// DOM HELPERS — trích xuất phần tử từ trang
// ═══════════════════════════════════════════════════════════════════════════

async function extractInteractiveElements(page) {
  return page.evaluate(() => {
    const els = [];
    const nodes = document.querySelectorAll(
      "button, a[href], input, select, textarea, [role='button'], [onclick], [role='tab'], [role='menuitem']"
    );
    for (const el of nodes) {
      const rect = el.getBoundingClientRect();
      if (rect.width < 4 || rect.height < 4 || rect.top < 0) continue;
      if (rect.top > window.innerHeight + 200) continue;
      const label =
        el.getAttribute("aria-label") ||
        el.getAttribute("placeholder") ||
        el.getAttribute("title") ||
        el.getAttribute("name") ||
        el.getAttribute("id") ||
        el.textContent?.trim().slice(0, 80) ||
        "";
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
        selector,
        value: el.value || null,
        disabled: el.disabled || false,
        x: Math.round(rect.left + rect.width / 2),
        y: Math.round(rect.top + rect.height / 2),
      });
    }
    return els.slice(0, 60);
  });
}

async function dismissPopupsHelper(page) {
  const result = await page.evaluate(() => {
    // 1. Tìm các popup/modal đang hiển thị
    const popups = [];
    const allElements = document.querySelectorAll('*');
    for (const el of allElements) {
      try {
        const rect = el.getBoundingClientRect();
        if (rect.width > 150 && rect.height > 100 && rect.top >= 0 && rect.top < window.innerHeight) {
          const className = typeof el.className === "string" ? el.className.toLowerCase() : "";
          const role = el.getAttribute("role") || "";
          const id = el.id ? el.id.toLowerCase() : "";
          
          const isPopupClass = className.includes("modal") || className.includes("popup") || className.includes("dialog") || className.includes("overlay") || className.includes("lightbox");
          const isPopupRole = role === "dialog" || role === "alertdialog";
          const isPopupId = id.includes("modal") || id.includes("popup") || id.includes("dialog");
          
          if (isPopupClass || isPopupRole || isPopupId) {
            if (el !== document.body && el !== document.documentElement) {
              popups.push(el);
            }
          }
        }
      } catch (e) {}
    }
    
    // Hàm kiểm tra nút đóng popup
    const isCloseElement = (el) => {
      try {
        const ariaLabel = el.getAttribute("aria-label") || "";
        const className = typeof el.className === "string" ? el.className : "";
        const text = el.textContent || "";
        const id = el.id || "";
        
        const closeRegex = /close|đóng|bỏ qua|dismiss/i;
        if (closeRegex.test(ariaLabel) || closeRegex.test(id)) return true;
        if (className.toLowerCase().includes("close") || className.toLowerCase().includes("btn-close")) return true;
        
        const tagName = el.tagName.toLowerCase();
        if ((tagName === "button" || tagName === "a" || el.onclick) && closeRegex.test(text.trim())) {
          if (text.trim().length <= 15) return true;
        }
      } catch (e) {}
      return false;
    };
    
    // Nếu phát hiện có popup hiển thị
    if (popups.length > 0) {
      let hasCloseButton = false;
      let requireAction = false;
      const closeButtonsToClick = [];
      
      for (const popup of popups) {
        const children = popup.querySelectorAll('*');
        let popupCloseButtons = [];
        let hasInputOrSelect = false;
        
        for (const child of children) {
          try {
            const r = child.getBoundingClientRect();
            if (r.width > 0 && r.height > 0) {
              const tagName = child.tagName.toLowerCase();
              if (tagName === "input" || tagName === "select" || (tagName === "button" && !isCloseElement(child) && child.textContent.trim().length > 0)) {
                hasInputOrSelect = true;
              }
              if (isCloseElement(child)) {
                popupCloseButtons.push(child);
              }
            }
          } catch (e) {}
        }
        
        if (popupCloseButtons.length > 0) {
          hasCloseButton = true;
          closeButtonsToClick.push(...popupCloseButtons);
        } else if (hasInputOrSelect) {
          requireAction = true;
        }
      }
      
      // Nếu có popup yêu cầu tương tác và hoàn toàn không có nút đóng
      if (requireAction && closeButtonsToClick.length === 0) {
        return {
          status: "require_action",
          dismissed: 0,
          message: "Phát hiện popup yêu cầu tương tác (như điền form/địa chỉ) và không tìm thấy nút đóng khả dụng. AI không được dùng dismiss_popups mà hãy tự tương tác trực tiếp lên popup này."
        };
      }
      
      // Click nút đóng
      let clickedCount = 0;
      closeButtonsToClick.forEach((btn) => {
        try {
          btn.click();
          clickedCount++;
        } catch (e) {}
      });
      
      if (clickedCount > 0) {
        // Chỉ ẩn overlay/backdrop sau khi click đóng thành công
        const overlaySelectors = ["[class*='backdrop']", "[class*='overlay']", "[class*='mask']", ".modal-backdrop"];
        overlaySelectors.forEach((sel) => {
          document.querySelectorAll(sel).forEach((el) => {
            try {
              const r = el.getBoundingClientRect();
              if (r.width > 200 && r.height > 200) {
                el.style.display = "none";
                el.style.pointerEvents = "none";
              }
            } catch (e) {}
          });
        });
        document.body.classList.remove("modal-open", "overflow-hidden", "noscroll");
        document.documentElement.classList.remove("modal-open", "overflow-hidden");
        return { status: "success", dismissed: clickedCount };
      }
    }
    
    // Fallback cách cũ nếu không phát hiện popup rõ ràng nhưng vẫn thử đóng bằng selector đóng chung
    let dismissedFallback = 0;
    const closeSelectors = [
      'button[aria-label*="close" i]', 'button[aria-label*="đóng" i]',
      'button[aria-label*="bỏ qua" i]', '[aria-label*="dismiss" i]',
      '.modal .btn-close', '.modal .close', '.modal [class*="close"]',
      '.popup .close', '.popup__close', '[class*="popup"] [class*="close"]',
      '[class*="overlay"] [class*="close"]', '[class*="dialog"] [class*="close"]',
      '[data-dismiss="modal"]', '[data-bs-dismiss="modal"]',
    ];
    for (const sel of closeSelectors) {
      try {
        document.querySelectorAll(sel).forEach((el) => {
          const rect = el.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0 && rect.top >= 0 && rect.top < window.innerHeight) {
            el.click(); dismissedFallback++;
          }
        });
      } catch (e) {}
    }
    
    if (dismissedFallback > 0) {
      const overlaySelectors = ["[class*='backdrop']", "[class*='overlay']", "[class*='mask']", ".modal-backdrop"];
      overlaySelectors.forEach((sel) => {
        document.querySelectorAll(sel).forEach((el) => {
          try {
            const r = el.getBoundingClientRect();
            if (r.width > 200 && r.height > 200) {
              el.style.display = "none";
              el.style.pointerEvents = "none";
            }
          } catch (e) {}
        });
      });
      document.body.classList.remove("modal-open", "overflow-hidden", "noscroll");
      document.documentElement.classList.remove("modal-open", "overflow-hidden");
    }
    
    return { status: dismissedFallback > 0 ? "success" : "none", dismissed: dismissedFallback };
  });
  
  try { await page.keyboard.press("Escape"); } catch (e) {}
  return result;
}

// ═══════════════════════════════════════════════════════════════════════════
// TOOL EXECUTOR — thực thi tool call bằng Playwright
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Thực thi một tool call và trả về kết quả.
 * @returns {{ content: string, imageBase64?: string, terminal?: boolean, action?: string }}
 */
async function executeTool(toolName, toolArgs = {}, page, { sendLog } = {}) {
  const log = (msg, level) => sendLog ? sendLog(msg, level) : console.log(`[Tool:${toolName}] ${msg}`);

  try {
    switch (toolName) {

      case "get_dom": {
        const url = page.url();
        const elements = await extractInteractiveElements(page);
        const info = await page.evaluate(() => ({
          title: document.title || "",
          bodyText: (document.body?.innerText || "").replace(/\s+/g, " ").slice(0, 800),
          headings: [...document.querySelectorAll("h1, h2")]
            .map((h) => h.textContent?.trim()).filter(Boolean).join(" | "),
        }));
        const elemStr = elements
          .map((el, i) => `[${i}] ${el.tag}${el.type ? `[${el.type}]` : ""} x=${el.x} y=${el.y} label="${el.label}" sel="${el.selector}" disabled=${el.disabled}`)
          .join("\n");
        return {
          content: JSON.stringify({
            url, title: info.title, headings: info.headings,
            bodyText: info.bodyText,
            elements: elemStr || "(không có phần tử tương tác)",
            elementCount: elements.length,
          }),
        };
      }

      case "screenshot": {
        const data = await page.screenshot({ type: "jpeg", quality: 65, fullPage: false });
        log("📸 Đã chụp màn hình.", "info");
        return { content: "Screenshot captured successfully.", imageBase64: data.toString("base64") };
      }

      case "dismiss_popups": {
        const result = await dismissPopupsHelper(page);
        await page.waitForTimeout(600);
        if (result.status === "require_action") {
          log(`dismiss_popups: ${result.message}`, "warning");
          return { content: JSON.stringify({ success: false, error: "RequireAction", message: result.message }) };
        }
        const count = result.dismissed || 0;
        const msg = count > 0 ? `Đã đóng/ẩn ${count} popup/overlay.` : "Không tìm thấy popup để đóng.";
        log(msg, count > 0 ? "success" : "info");
        return { content: JSON.stringify({ success: true, dismissedCount: count, message: msg }) };
      }

      case "click": {
        const { selector, x, y, reason } = toolArgs;
        if (selector) {
          try {
            const locator = page.locator(selector).first();
            await locator.scrollIntoViewIfNeeded({ timeout: 3000 });
            await locator.click({ timeout: 5000 });
            await page.waitForTimeout(1000);
            const newUrl = page.url();
            log(`Click: ${selector}${reason ? ` (${reason})` : ""}`, "success");
            return { content: JSON.stringify({ success: true, selector, newUrl }) };
          } catch (err) {
            if (x && y) {
              await page.mouse.click(x, y);
              await page.waitForTimeout(1000);
              log(`Click tọa độ fallback (${x},${y})`, "warning");
              return { content: JSON.stringify({ success: true, method: "coordinate_fallback", x, y, newUrl: page.url() }) };
            }
            return { content: JSON.stringify({ success: false, error: err.message, selector }) };
          }
        } else if (x && y) {
          await page.mouse.click(x, y);
          await page.waitForTimeout(1000);
          return { content: JSON.stringify({ success: true, method: "coordinate", x, y, newUrl: page.url() }) };
        }
        return { content: JSON.stringify({ success: false, error: "Thiếu selector hoặc tọa độ x,y" }) };
      }

      case "type": {
        const { selector, text, clearFirst = true } = toolArgs;
        if (!text) return { content: JSON.stringify({ success: false, error: "Thiếu text" }) };
        if (selector) {
          try {
            const locator = page.locator(selector).first();
            await locator.scrollIntoViewIfNeeded({ timeout: 3000 });
            await locator.click({ timeout: 4000 });
            if (clearFirst) await locator.fill("");
            await locator.type(text, { delay: 20 });
            await page.waitForTimeout(400);
            log(`Type "${text.slice(0, 30)}" → ${selector}`, "success");
            return { content: JSON.stringify({ success: true, selector, text: text.slice(0, 50) }) };
          } catch (err) {
            await page.keyboard.type(text, { delay: 20 });
            return { content: JSON.stringify({ success: true, method: "keyboard_fallback", text: text.slice(0, 50) }) };
          }
        } else {
          await page.keyboard.type(text, { delay: 20 });
          return { content: JSON.stringify({ success: true, method: "keyboard_only", text: text.slice(0, 50) }) };
        }
      }

      case "keypress": {
        const { key = "Enter" } = toolArgs;
        await page.keyboard.press(key);
        await page.waitForTimeout(500);
        return { content: JSON.stringify({ success: true, key }) };
      }

      case "scroll": {
        const { direction = "down", amount = 400 } = toolArgs;
        await page.evaluate(({ dir, amt }) => { window.scrollBy(0, dir === "up" ? -amt : amt); }, { dir: direction, amt: amount });
        await page.waitForTimeout(600);
        return { content: JSON.stringify({ success: true, direction, amount }) };
      }

      case "navigate": {
        const { url } = toolArgs;
        if (!url) return { content: JSON.stringify({ success: false, error: "Thiếu URL" }) };
        log(`Điều hướng tới: ${url}`, "info");
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 25000 });
        await page.waitForTimeout(1500);
        return { content: JSON.stringify({ success: true, newUrl: page.url() }) };
      }

      case "select_option": {
        const { selector, value } = toolArgs;
        if (!selector || !value) return { content: JSON.stringify({ success: false, error: "Thiếu selector hoặc value" }) };
        try {
          await page.locator(selector).first().selectOption({ label: value });
          await page.waitForTimeout(500);
          return { content: JSON.stringify({ success: true, selector, value, method: "label" }) };
        } catch {
          try {
            await page.locator(selector).first().selectOption({ value });
            await page.waitForTimeout(500);
            return { content: JSON.stringify({ success: true, selector, value, method: "value" }) };
          } catch (err) {
            return { content: JSON.stringify({ success: false, error: err.message, selector }) };
          }
        }
      }

      case "wait": {
        const ms = Math.min(toolArgs.ms || 1000, 5000);
        await page.waitForTimeout(ms);
        return { content: JSON.stringify({ success: true, waited: ms }) };
      }

      // ── Terminal tools ────────────────────────────────────────────────
      case "pause_for_human":
        return {
          content: JSON.stringify({ terminal: true, action: "pause", reason: toolArgs.reason, message: toolArgs.message }),
          terminal: true,
          terminalAction: "pause",
          pauseReason: toolArgs.reason,
          pauseMessage: toolArgs.message,
        };

      case "complete_success":
        return {
          content: JSON.stringify({ terminal: true, action: "success", orderId: toolArgs.orderId, message: toolArgs.message }),
          terminal: true,
          terminalAction: "success",
          orderId: toolArgs.orderId,
          finalUrl: page.url(),
        };

      // ── Skill Tools ───────────────────────────────────────────────
      case "list_skills": {
        const files = listSkillFiles();
        const result = files.length > 0
          ? `Có ${files.length} skill files: ${files.join(", ")}`
          : "Chưa có skill file nào trong thư mục skills.";
        log(result, "info");
        return { content: JSON.stringify({ files, count: files.length }) };
      }

      case "read_skill": {
        const { name } = toolArgs;
        if (!name) return { content: JSON.stringify({ success: false, error: "Thiếu name" }) };
        const skill = readSkillByName(name);
        if (!skill) {
          log(`Không tìm thấy skill: ${name}`, "warning");
          return { content: JSON.stringify({ success: false, error: `Không tìm thấy skill '${name}'` }) };
        }
        log(`Đọc skill: ${skill.name} (${skill.content.length} ký tự)`, "info");
        return { content: JSON.stringify({ success: true, name: skill.name, content: skill.content }) };
      }

      case "update_skill": {
        const { name, content: skillContent } = toolArgs;
        if (!name || !skillContent) return { content: JSON.stringify({ success: false, error: "Thiếu name hoặc content" }) };
        if (name.startsWith("_")) {
          return { content: JSON.stringify({ success: false, error: "Không thể cập nhật protected skill (_master)" }) };
        }
        const writeResult = writeSkillByName(name, skillContent, "append");
        if (writeResult.success) {
          log(`Đã cập nhật skill: ${name}`, "success");
        }
        return { content: JSON.stringify(writeResult) };
      }

      case "run_subagent": {
        const { task, context = "", maxTurns = 25 } = toolArgs;
        if (!task) return { content: JSON.stringify({ success: false, error: "Thiếu task" }) };
        log(`▶ Khởi chạy subagent: "${task.slice(0, 80)}..."`, "info");
        try {
          // Lazy require để tránh circular dependency
          const { runSubagentLoop } = require("./agent-llm");
          const result = await runSubagentLoop(page, task, context, Math.min(maxTurns, 40), { sendLog });
          log(`■ Subagent hoàn thành: ${result.success ? "✅" : "❌"} ${result.summary}`, result.success ? "success" : "warning");
          return {
            content: JSON.stringify({
              success: result.success,
              summary: result.summary,
              turns: result.turns,
            }),
          };
        } catch (e) {
          log(`Subagent lỗi: ${e.message}`, "error");
          return { content: JSON.stringify({ success: false, error: e.message }) };
        }
      }

      default:
        return { content: JSON.stringify({ success: false, error: `Tool không xác định: ${toolName}` }) };
    }
  } catch (err) {
    log(`Tool ${toolName} lỗi: ${err.message}`, "warning");
    return { content: JSON.stringify({ success: false, error: err.message, tool: toolName }) };
  }
}

module.exports = {
  TOOLS,
  getToolsForGemini,
  getToolsForAnthropic,
  getToolsForOpenAI,
  buildGeminiContents,
  buildAnthropicMessages,
  buildOpenAIMessages,
  executeTool,
};
