/**
 * Provider-aware bootstrap cho tuoixanhnhanhngon.timdaythay.com.
 *
 * Mục tiêu V1:
 * - đảm bảo page đã tải xong catalog/home hoặc product landing
 * - đóng các overlay/banner gây cản trở
 * - nếu đang ở catalog/home thì cố mở đúng card sản phẩm theo tên
 * - sau đó nhường lại cho DOM-first loop xử lý add-to-cart / checkout
 */

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
    } catch {}
  }

  try {
    await page.keyboard.press("Escape");
  } catch {}
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
    } catch {}
  }
}

async function openProductCardByName(page, productName, sendLog) {
  if (!productName) return false;

  const target = normalize(productName);
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
      } catch {}
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
    } catch {}

    await page.mouse.wheel(0, 700);
    await page.waitForTimeout(500);
  }

  sendLog(`TXNN: chưa tìm thấy card sản phẩm khớp với "${productName}" trên catalog hiện tại.`, "warning");
  return false;
}

async function run(page, payload, sendLog, sendStatus = null, sendMessage = null, sendScreenshotFrame = null) {
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

module.exports = { run };
