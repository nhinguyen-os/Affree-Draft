/**
 * Provider-aware bootstrap cho tuoixanhnhanhngon.timdaythay.com.
 *
 * Mục tiêu V1:
 * - đảm bảo page đã tải xong catalog/home hoặc product landing
 * - đóng các overlay/banner gây cản trở
 * - nếu đang ở catalog/home thì cố mở đúng card sản phẩm theo tên
 * - sau đó nhường lại cho DOM-first loop xử lý add-to-cart / checkout
 */
const {
  safeGoto,
} = require("./css-helpers");

const SUCCESS_URL_KEYWORDS = ["thank-you", "success", "don-hang", "checkout/complete", "cam-on"];

const TXNN_MODAL_NAME_SELECTORS = [
  'input[placeholder*="tên" i]',
  'input[placeholder*="họ" i]',
  'input[name*="name" i]',
  'input[name*="fullname" i]',
];

const TXNN_MODAL_PHONE_SELECTORS = [
  'input[placeholder*="thoại" i]',
  'input[placeholder*="điện thoại" i]',
  'input[placeholder*="số điện thoại" i]',
  'input[name*="phone" i]',
  'input[name*="tel" i]',
];

const TXNN_BUYER_NAME_SELECTORS = [
  'input[placeholder*="tên người đặt hàng" i]',
  'input[placeholder*="tên người đặt" i]',
  'input[placeholder*="người đặt hàng" i]',
  ...TXNN_MODAL_NAME_SELECTORS,
];

const TXNN_BUYER_PHONE_SELECTORS = [
  'input[placeholder*="số điện thoại" i]',
  'input[placeholder*="0901234567" i]',
  'input[type="tel"]',
  ...TXNN_MODAL_PHONE_SELECTORS,
];

const TXNN_BUYER_ADDRESS_SELECTORS = [
  'textarea[placeholder*="địa chỉ" i]',
  'textarea[placeholder*="nhận quà" i]',
  'textarea[placeholder*="giao sau" i]',
  'input[placeholder*="địa chỉ" i]',
  'input[placeholder*="nhận quà" i]',
  'input[placeholder*="giao sau" i]',
  'textarea[name*="address" i]',
  'input[name*="address" i]',
];

function normalize(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

async function closeCommonOverlays(page, sendLog) {
  const selectors = [
    'button[aria-label*="đóng" i]',
    'button[aria-label*="close" i]',
    'button[title*="đóng" i]',
    'button[title*="close" i]',
    '[class*="modal"] button',
    '[class*="popup"] button',
    '[class*="dialog"] button',
  ];

  for (const selector of selectors) {
    try {
      const locator = page.locator(selector).first();
      if (await locator.isVisible({ timeout: 300 })) {
        const text = ((await locator.textContent()) || "").trim();
        if (!text || /^x|đóng|close|bỏ qua|skip$/i.test(text)) {
          await locator.click({ timeout: 1000 });
          sendLog(`TXNN: đã đóng overlay bằng selector ${selector}`, "info");
          await page.waitForTimeout(300);
        }
      }
    } catch { }
  }

  try {
    await page.keyboard.press("Escape");
  } catch { }
}

async function ensureCatalogMode(page, sendLog) {
  const catalogTabs = ["🏠 Tất cả", "Tất cả", "Quà Tặng", "Túi Đơn Ghép"];
  for (const label of catalogTabs) {
    try {
      const btn = page.getByRole("button", { name: label }).first();
      if (await btn.isVisible({ timeout: 400 })) {
        await btn.click({ timeout: 1500 });
        sendLog(`TXNN: đã chuyển về catalog tab "${label}"`, "info");
        await page.waitForTimeout(500);
        return;
      }
    } catch { }
  }
}

async function openProductCardByName(page, productName, sendLog) {
  if (!productName) return false;

  const variants = Array.from(
    new Set(
      [
        productName,
        productName.split("(")[0].trim(),
        productName.split("-")[0].trim(),
        productName.split(",")[0].trim(),
      ].filter(Boolean)
    )
  );

  for (let attempt = 0; attempt < 5; attempt++) {
    for (const variant of variants) {
      try {
        const heading = page.getByRole("heading", { name: new RegExp(variant.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") }).first();
        if (await heading.isVisible({ timeout: 600 })) {
          await heading.scrollIntoViewIfNeeded();
          const clickable = heading.locator("xpath=ancestor::*[@onclick or @role='button' or contains(@style,'cursor')][1]").first();
          if (await clickable.count()) {
            await clickable.click({ timeout: 1500 });
          } else {
            await heading.click({ timeout: 1500 });
          }
          sendLog(`TXNN: đã mở card sản phẩm gần khớp "${variant}"`, "success");
          await page.waitForTimeout(900);
          return true;
        }
      } catch { }
    }

    try {
      const matched = await page.evaluate((wanted) => {
        const norm = (value) => String(value || "")
          .toLowerCase()
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .replace(/[^a-z0-9]+/g, " ")
          .trim();
        const cards = Array.from(document.querySelectorAll("h1, h2, h3, h4, [onclick], [role='button']"));
        const needle = norm(wanted);
        for (const el of cards) {
          const text = norm(el.textContent || "");
          if (text && (text.includes(needle) || needle.includes(text))) {
            const host = el.closest("[onclick]") || el;
            host.scrollIntoView({ block: "center" });
            host.click();
            return true;
          }
        }
        return false;
      }, productName);
      if (matched) {
        sendLog(`TXNN: đã mở card sản phẩm bằng DOM fallback cho "${productName}"`, "success");
        await page.waitForTimeout(900);
        return true;
      }
    } catch { }

    await page.mouse.wheel(0, 700);
    await page.waitForTimeout(500);
  }

  sendLog(`TXNN: chưa tìm thấy card sản phẩm khớp với "${productName}" trên catalog hiện tại.`, "warning");
  return false;
}

async function activateTuiDonGhep(page, sendLog) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const tabs = [
      page.getByRole("button", { name: /Túi Đơn Ghép/i }).first(),
      page.locator('button:has-text("Túi Đơn Ghép")').first(),
      page.locator('text=/Túi Đơn Ghép/i').first(),
    ];

    for (const tab of tabs) {
      try {
        if (await tab.isVisible({ timeout: 1200 })) {
          await tab.scrollIntoViewIfNeeded();
          await tab.click({ timeout: 3000 });
          await page.waitForTimeout(1200);
          sendLog('TXNN: đã chuyển sang tab "Túi Đơn Ghép".', "success");
          return true;
        }
      } catch { }
    }

    const pageReady = await page.evaluate(() => {
      const bodyText = (document.body?.innerText || "").replace(/\s+/g, " ");
      return /túi đơn ghép|giỏ hàng|đặt hàng|quà tặng/i.test(bodyText) || document.querySelectorAll('.product-card').length > 0;
    }).catch(() => false);

    if (pageReady) {
      sendLog(`TXNN: trang đã có nội dung nhưng tab "Túi Đơn Ghép" chưa clickable (lần ${attempt + 1}/8), chờ render thêm...`, "info");
    } else {
      sendLog(`TXNN: đang chờ trang render menu/tab sau khi mở lần đầu (lần ${attempt + 1}/8)...`, "info");
    }

    await page.waitForTimeout(1000 + attempt * 250);
  }

  sendLog('TXNN: không tìm thấy tab "Túi Đơn Ghép".', "warning");
  return false;
}

async function addFirstThreeProducts(page, sendLog) {
  let visibleCount = 0;
  for (let attempt = 0; attempt < 6; attempt++) {
    visibleCount = await page.locator(".product-card").count();
    if (visibleCount > 0) break;
    await page.waitForTimeout(700);
  }

  const cards = page.locator(".product-card");
  if (!visibleCount) {
    sendLog("TXNN: không tìm thấy product-card nào trong tab Túi Đơn Ghép.", "warning");
    return [];
  }

  const picked = [];
  const limit = Math.min(3, visibleCount);
  for (let i = 0; i < limit; i++) {
    const card = cards.nth(i);
    try {
      await card.scrollIntoViewIfNeeded();
      const name = ((await card.textContent()) || "").replace(/\s+/g, " ").trim().slice(0, 120);
      const plusButton = card.locator("button").filter({ hasText: /^\+$/ }).first();
      await plusButton.click({ timeout: 3000 });
      picked.push(name || `Sản phẩm #${i + 1}`);
      sendLog(`TXNN: đã thêm vào giỏ sản phẩm #${i + 1}${name ? ` — ${name}` : ""}.`, "success", { audience: "client" });
      await page.waitForTimeout(700);
    } catch (err) {
      sendLog(`TXNN: lỗi khi cộng sản phẩm #${i + 1} vào giỏ: ${err.message}`, "warning");
    }
  }

  return picked;
}

async function openOrderConfirmationModal(page, sendLog) {
  const selectors = [
    'button:has-text("Đặt Hàng")',
    'button:has-text("Đặt hàng")',
    'button:has-text("Xác Nhận Đơn Hàng")',
  ];

  for (const selector of selectors) {
    try {
      const button = page.locator(selector).last();
      if (await button.isVisible({ timeout: 1500 })) {
        await button.scrollIntoViewIfNeeded();
        await button.click({ timeout: 3000 });
        await page.waitForTimeout(1500);
        const modal = page.locator("text=/Xác Nhận Đơn Hàng/i").first();
        if (await modal.isVisible({ timeout: 3000 })) {
          sendLog('TXNN: đã mở popup bước 1 "Xác Nhận Đơn Hàng".', "success", { audience: "client" });
          return true;
        }
      }
    } catch { }
  }

  sendLog('TXNN: không mở được popup bước 1 "Xác Nhận Đơn Hàng".', "warning", { audience: "client" });
  return false;
}

async function openBuyerInfoPopup(page, sendLog) {
  const selectors = [
    'button:has-text("XÁC NHẬN THANH TOÁN")',
    'button:has-text("✅ XÁC NHẬN THANH TOÁN")',
    'button:has-text("Xác nhận thanh toán")',
  ];

  for (const selector of selectors) {
    try {
      const button = page.locator(selector).last();
      if (await button.isVisible({ timeout: 1500 })) {
        await button.scrollIntoViewIfNeeded();
        await button.click({ timeout: 3000 });
        for (let attempt = 0; attempt < 5; attempt++) {
          await page.waitForTimeout(800);
          const reachedStep2 = await page.evaluate(() => {
            const text = (document.body.innerText || "").replace(/\s+/g, " ");
            const hasBuyerFields = Array.from(document.querySelectorAll("input")).some((input) =>
              /tên người đặt hàng|số điện thoại|người nhận quà/i.test(input.getAttribute("placeholder") || "")
            );
            const hasFinalConfirm = Array.from(document.querySelectorAll("button")).some((btn) =>
              /✅\s*xác nhận|xác nhận$/i.test((btn.innerText || "").trim())
            );
            return hasBuyerFields || hasFinalConfirm || /tên người đặt|thông tin đặt hàng/i.test(text);
          });
          if (reachedStep2) {
            sendLog('TXNN: đã mở popup bước 2 "Thông tin đặt hàng / QR".', "success", { audience: "client" });
            return true;
          }
        }
      }
    } catch { }
  }

  sendLog('TXNN: không mở được popup bước 2 sau nút "Xác nhận thanh toán".', "warning");
  return false;
}

async function fillVisibleFieldIfPresent(page, selectors, value, sendLog, fieldLabel) {
  if (!value) return false;
  for (const selector of selectors) {
    try {
      const locator = page.locator(selector).first();
      if (await locator.isVisible({ timeout: 400 })) {
        await locator.scrollIntoViewIfNeeded();
        await locator.fill(value);
        sendLog(`TXNN: đã điền ${fieldLabel} trong popup.`, "success", { audience: "client" });
        return true;
      }
    } catch { }
  }
  sendLog(`TXNN: popup hiện tại không có ô ${fieldLabel}; bỏ qua bước điền.`, "info");
  return false;
}

async function extractQrFromPaymentPopup(page, sendLog) {
  try {
    const result = await page.evaluate(() => {
      const roots = Array.from(document.querySelectorAll("div, section, article"));
      const root = roots.find((el) => /thông tin đặt hàng|tên người đặt|số điện thoại|xác nhận/i.test(el.textContent || "")) || document.body;

      const img = root.querySelector('img[alt*="QR" i], img[src^="data:image"]');
      if (img) {
        const src = img.getAttribute("src") || "";
        const match = src.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
        if (match) {
          return {
            ok: true,
            qrContentType: match[1],
            qrImageBase64: match[2],
            source: "img:data-url",
          };
        }
      }

      const canvas = root.querySelector("canvas");
      if (canvas && typeof canvas.toDataURL === "function") {
        const dataUrl = canvas.toDataURL("image/png");
        const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
        if (match) {
          return {
            ok: true,
            qrContentType: match[1],
            qrImageBase64: match[2],
            source: "canvas:data-url",
          };
        }
      }

      return { ok: false };
    });

    if (result?.ok && result.qrImageBase64) {
      sendLog(`TXNN: đã trích xuất QR từ popup bước 2 (${result.source}).`, "success");
      return result;
    }
  } catch (err) {
    sendLog(`TXNN: lỗi khi trích xuất QR từ popup bước 2: ${err.message}`, "warning");
  }

  sendLog("TXNN: chưa trích xuất được QR từ popup bước 2.", "warning");
  return { ok: false };
}

async function run(page, payload, sendLog) {
  const { url, productName } = payload;
  sendLog("TXNN: bắt đầu bootstrap provider...");

  if (url) {
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1200);
    if (sendScreenshotFrame) await sendScreenshotFrame();
  }

  await closeCommonOverlays(page, sendLog);
  await ensureCatalogMode(page, sendLog);
  if (sendScreenshotFrame) await sendScreenshotFrame();

  const currentUrl = page.url();
  const onHome = /tuoixanhnhanhngon\.timdaythay\.com\/?(?:#.*)?$/i.test(currentUrl);
  if (onHome) {
    await openProductCardByName(page, productName, sendLog);
    if (sendScreenshotFrame) await sendScreenshotFrame();
  }

  sendLog("TXNN: bootstrap xong, nhường lại cho DOM-first loop.", "success");
  return { done: false };
}

async function runCss(page, payload, sendLog, sendStatus) {
  const { url, productName, chain, buyerName, buyerPhone, buyerAddress } = payload;
  sendLog(`TXNN: bắt đầu fallback riêng cho ${productName} tại ${String(chain || "tuoixanhnhanhngon").toUpperCase()}.`, "info");

  await safeGoto(page, url, sendLog, { waitUntil: "load", settleMs: 3000 });
  await closeCommonOverlays(page, sendLog);
  await ensureCatalogMode(page, sendLog);
  await activateTuiDonGhep(page, sendLog);

  const picked = await addFirstThreeProducts(page, sendLog);
  if (picked.length < 3) {
    sendLog("TXNN: chưa cộng đủ 3 sản phẩm đầu tiên vào giỏ như flow yêu cầu.", "warning");
  }

  const modalOpened = await openOrderConfirmationModal(page, sendLog);
  if (!modalOpened) {
    sendStatus("waiting_user_input", {
      reason: "TXNN không mở được popup bước 1 xác nhận đơn hàng; cần người dùng tiếp tục thủ công.",
      requiredInput: "final_confirmation",
    });
    sendLog("TXNN: đã chuyển sang chờ user vì không mở được popup bước 1.", "warning");
    return { done: true };
  }

  const buyerInfoOpened = await openBuyerInfoPopup(page, sendLog);
  if (!buyerInfoOpened) {
    sendStatus("waiting_user_input", {
      reason: "TXNN đã mở popup đầu nhưng không vào được popup Thông tin đặt hàng/QR; cần người dùng tiếp tục thủ công.",
      requiredInput: "final_confirmation",
    });
    sendLog("TXNN: đã chuyển sang chờ user vì không mở được popup bước 2.", "warning");
    return { done: true };
  }

  const filledName = await fillVisibleFieldIfPresent(page, TXNN_BUYER_NAME_SELECTORS, buyerName, sendLog, "Tên người đặt");
  const filledPhone = await fillVisibleFieldIfPresent(page, TXNN_BUYER_PHONE_SELECTORS, buyerPhone, sendLog, "Số điện thoại");
  const filledAddress = await fillVisibleFieldIfPresent(page, TXNN_BUYER_ADDRESS_SELECTORS, buyerAddress, sendLog, "Địa chỉ nhận quà giao sau");
  if (!filledName || !filledPhone || !filledAddress) {
    sendLog(
      "TXNN: popup bước 2 hiện chưa render đủ các field buyer/address mong muốn; worker sẽ tiếp tục bằng dữ liệu buyer đã gửi từ lúc tạo session.",
      "info"
    );
  }

  const reason = "TXNN đã tới popup Thông tin đặt hàng/QR và sẽ cast popup thanh toán thật để người dùng thao tác trực tiếp.";

  sendStatus("waiting_user_input", {
    reason,
    requiredInput: "qr_payment",
  });
  sendLog("TXNN: đã dừng ở popup bước 2 để chờ user thao tác trực tiếp trên popup thanh toán thật. Nếu detect popup thất bại, user vẫn có thể mở trang nguồn để xử lý thủ công.", "warning");
  return { done: true };
}

module.exports = {
  run,
  runCss,
};