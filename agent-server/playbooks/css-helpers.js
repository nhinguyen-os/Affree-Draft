async function safeGoto(page, url, sendLog, options = {}) {
  if (!url) return false;
  const { waitUntil = "domcontentloaded", settleMs = 1200, force = false } = options;

  if (!force) {
    try {
      if (page.url() === url) {
        return false;
      }
    } catch {}
  }

  sendLog(`Đang truy cập trang mục tiêu: ${url}...`, "info");
  await page.goto(url, { waitUntil });
  if (settleMs > 0) {
    await page.waitForTimeout(settleMs);
  }
  return true;
}

async function clickFirstVisible(page, selectors, sendLog, options = {}) {
  const {
    timeout = 1500,
    clickTimeout = 3000,
    successMessage = "Đã click thành công",
    failureMessage,
  } = options;

  for (const selector of selectors) {
    try {
      const locator = page.locator(selector).first();
      if (await locator.isVisible({ timeout })) {
        await locator.scrollIntoViewIfNeeded();
        await locator.click({ timeout: clickTimeout });
        sendLog(`${successMessage}: "${selector}"`, "success");
        return { ok: true, selector };
      }
    } catch {}
  }

  if (failureMessage) {
    sendLog(failureMessage, "warning");
  }
  return { ok: false, selector: null };
}

async function fillFirstVisible(page, selectors, value, sendLog, options = {}) {
  const {
    timeout = 1200,
    fieldLabel = "trường dữ liệu",
    successMessage,
    failureMessage,
  } = options;

  if (!value) {
    return { ok: false, selector: null, skipped: true };
  }

  for (const selector of selectors) {
    try {
      const locator = page.locator(selector).first();
      if (await locator.isVisible({ timeout })) {
        await locator.scrollIntoViewIfNeeded();
        await locator.fill(value);
        sendLog(successMessage || `Đã điền ${fieldLabel} bằng selector: "${selector}"`, "success");
        return { ok: true, selector };
      }
    } catch {}
  }

  sendLog(failureMessage || `Không tìm thấy ô ${fieldLabel} phù hợp trong CSS fallback.`, "warning");
  return { ok: false, selector: null, skipped: false };
}

function notifyWaitingForUser(sendStatus, sendLog, options = {}) {
  const {
    reason = "Cần khách hàng tiếp tục OTP / thanh toán / xác nhận trực tiếp trên website.",
    hint = "Mẹo: Bạn có thể click chuột và gõ phím trực tiếp lên ô màn hình trình duyệt ở Web App.",
  } = options;

  sendStatus("waiting_user_input", { reason });
  sendLog(`⚠️ AGENT TẠM DỪNG: ${reason}`, "warning");
  if (hint) {
    sendLog(hint, "info");
  }
}

async function waitForSuccessUrl(page, sendLog, sendStatus, options = {}) {
  const {
    successUrlKeywords = [],
    timeoutMs = 300000,
    intervalMs = 1000,
    timeoutMessage = "Hết thời gian chờ (Timeout). Vui lòng kiểm tra lại đơn hàng.",
  } = options;

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const currentUrl = page.url();
    if (successUrlKeywords.some((keyword) => currentUrl.includes(keyword))) {
      sendLog(`Phát hiện đặt hàng thành công! URL hiện tại: ${currentUrl}`, "success");
      sendStatus("completed", { orderUrl: currentUrl });
      return { ok: true, orderUrl: currentUrl };
    }
    await page.waitForTimeout(intervalMs);
  }

  sendLog(timeoutMessage, "warning");
  return { ok: false, orderUrl: null };
}

module.exports = {
  safeGoto,
  clickFirstVisible,
  fillFirstVisible,
  notifyWaitingForUser,
  waitForSuccessUrl,
};
