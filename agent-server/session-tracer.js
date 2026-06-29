/**
 * Affree AI Agentic — Session Tracer
 * Ghi lại chi tiết từng bước AI thực hiện trong một phiên đặt hàng.
 * Trace này được dùng bởi Skill Updater để extract pattern và update skill.
 *
 * Quy định ngôn ngữ: Comments và log tiếng Việt, biến/hàm tiếng Anh.
 */

/**
 * Tạo một Session Tracer mới cho một phiên đặt hàng.
 * @param {string} domain - Domain của trang đặt hàng (ví dụ: "lazada.vn")
 * @param {object} payload - Thông tin đơn hàng (productName, buyerName, ...)
 */
function createSessionTracer(domain, payload) {
  const sessionId = `${domain}-${Date.now()}`;
  const startTime = Date.now();

  const trace = {
    sessionId,
    domain,
    startTime: new Date().toISOString(),
    endTime: null,
    durationMs: null,
    success: null,           // true/false/null (null = chưa kết thúc)
    finalUrl: null,
    steps: [],               // Danh sách các bước đã thực hiện
    pauseReasons: [],        // Lý do AI phải dừng lại (OTP, CAPTCHA, ...)
    errors: [],              // Các lỗi gặp phải
    payload: {               // Thông tin đơn hàng (không log thông tin nhạy cảm)
      productName: payload?.productName,
      chain: payload?.chain,
      url: payload?.url,
    },
    usage: {
      apiCallsCount: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      calls: [],
    },
  };

  let stepCounter = 0;

  /**
   * Ghi lại một lượt gọi API AI và token usage.
   */
  function recordApiCall(apiType, model, inputTokens, outputTokens) {
    trace.usage.apiCallsCount++;
    trace.usage.totalInputTokens += inputTokens || 0;
    trace.usage.totalOutputTokens += outputTokens || 0;
    trace.usage.calls.push({
      timestamp: new Date().toISOString(),
      apiType,
      model,
      inputTokens,
      outputTokens,
    });
  }

  /**
   * Ghi lại một bước AI vừa thực hiện.
   * @param {object} stepInfo
   */
  function recordStep(stepInfo) {
    stepCounter++;
    const step = {
      stepIndex: stepCounter,
      timestamp: new Date().toISOString(),
      url: stepInfo.url || null,
      pageTitle: stepInfo.pageTitle || null,
      action: stepInfo.action || null,        // "click", "type", "scroll", etc.
      selector: stepInfo.selector || null,    // CSS selector đã dùng
      text: stepInfo.text || null,            // Nội dung đã gõ (nếu là type)
      x: stepInfo.x || null,
      y: stepInfo.y || null,
      success: stepInfo.success !== false,    // Mặc định coi là thành công
      durationMs: stepInfo.durationMs || null,
      aiReason: stepInfo.aiReason || null,    // Giải thích từ AI
      errorMessage: stepInfo.errorMessage || null,
    };
    trace.steps.push(step);
    return step;
  }

  /**
   * Ghi lại khi AI phải dừng để chờ user (OTP, CAPTCHA...).
   * @param {string} reason - Lý do dừng
   */
  function recordPause(reason) {
    trace.pauseReasons.push({
      stepIndex: stepCounter,
      reason,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Ghi lại lỗi xảy ra trong phiên.
   * @param {string} message - Thông báo lỗi
   */
  function recordError(message) {
    trace.errors.push({
      stepIndex: stepCounter,
      message,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Kết thúc phiên và tính toán các số liệu tổng hợp.
   * @param {boolean} success - Phiên có thành công không
   * @param {string} finalUrl - URL cuối cùng khi kết thúc
   */
  function finalize(success, finalUrl = null) {
    trace.success = success;
    trace.finalUrl = finalUrl;
    trace.endTime = new Date().toISOString();
    trace.durationMs = Date.now() - startTime;
    trace.totalSteps = stepCounter;

    // Tóm tắt nhanh
    const successfulSteps = trace.steps.filter((s) => s.success).length;
    const failedSteps = trace.steps.filter((s) => !s.success).length;
    trace.summary = {
      totalSteps: stepCounter,
      successfulSteps,
      failedSteps,
      pauseCount: trace.pauseReasons.length,
      errorCount: trace.errors.length,
    };

    return trace;
  }

  /**
   * Xuất trace thành text ngắn gọn để đưa vào AI prompt.
   * Chỉ bao gồm các bước quan trọng (không phải debug log đầy đủ).
   */
  function toPromptSummary() {
    const lines = trace.steps
      .filter((s) => s.action && s.action !== "wait") // Bỏ các bước chờ
      .map((s) => {
        let line = `Step ${s.stepIndex}: [${s.action?.toUpperCase()}]`;
        if (s.selector) line += ` selector="${s.selector}"`;
        if (s.text) line += ` text="${s.text.slice(0, 50)}"`;
        if (s.aiReason) line += ` | reason="${s.aiReason}"`;
        line += ` | ${s.success ? "✓" : "✗"}`;
        return line;
      });
    return lines.join("\n");
  }

  return {
    trace,
    recordStep,
    recordPause,
    recordError,
    finalize,
    toPromptSummary,
    getStepCount: () => stepCounter,
    recordApiCall,
  };
}

module.exports = { createSessionTracer };
