/**
 * Playbook for www.pnj.com.vn (PNJ – Vàng Bạc Đá Quý Phú Nhuận)
 *
 * Flow thực tế (cập nhật – bỏ click danh mục, dùng tìm kiếm nhanh):
 * Bước 1: Mở https://www.pnj.com.vn/ → đóng popup
 * Bước 2: Click icon "Tìm kiếm nhanh" trên header → nhập tên sản phẩm
 *         → chọn sản phẩm có tên giống nhất trong dropdown / trang kết quả
 * Bước 3: Trên trang sản phẩm → chọn size (theo payload.size)
 * Bước 4: Click "Thêm vào giỏ hàng"
 * Bước 5: Click icon giỏ hàng → tick chọn sản phẩm → click "Tiếp tục"
 * Bước 6: Điền họ tên + SĐT người mua
 *
 * Nếu không truyền "size", bước chọn size sẽ bỏ qua.
 * ─────────────────────────────────────────────────────────────────────
 *
 * DOM Reference: agent-server/playbooks/pnj.html (snapshot 2026-06-25)
 */

// ═══════════════════════════════════════════════════════════════════
// ⏱  TIMING CONSTANTS — Chỉnh ở đây để thay đổi tốc độ toàn playbook
// ═══════════════════════════════════════════════════════════════════
const T = {
  // ── Popup / Page load ──────────────────────────────────────────
  POPUP_WAIT:         800,  // chờ popup PNJ render trước khi dismiss (ms)
  POPUP_AFTER_CLICK:  250,  // chờ sau mỗi lần click đóng popup
  PAGE_AFTER_LOAD:    800,  // chờ sau khi domcontentloaded

  // ── Tìm kiếm sản phẩm ──────────────────────────────────────────────
  SEARCH_AFTER_TYPE: 2000,  // chờ sau khi nhập tên vào ô search (dropdown hiện — Next.js cần ~1-2s)
  SEARCH_SCROLL:      400,  // chờ giữa các lần scroll trang kết quả
  PRODUCT_AFTER_CLICK:1500, // chờ sau khi click vào sản phẩm

  // ── Trang sản phẩm ─────────────────────────────────────────────
  SIZE_SCROLL:        400,  // chờ sau khi scroll xuống khu vực size
  SIZE_AFTER_CLICK:   400,  // chờ sau khi chọn size
  ADD_TO_CART_SCROLL: 500,  // chờ sau khi scroll xuống nút "Thêm vào giỏ"
  ADD_TO_CART_AFTER: 1200,  // chờ sau khi click "Thêm vào giỏ hàng"

  // ── Giỏ hàng ───────────────────────────────────────────────────
  CART_AFTER_NAV:    1200,  // chờ sau khi vào trang /site/cart
  CART_AFTER_TICK:    500,  // chờ sau khi tick checkbox sản phẩm
  CART_SCROLL_BOTTOM: 400,  // chờ sau khi scroll xuống cuối giỏ hàng
  CART_AFTER_CONTINUE:1500, // chờ sau khi click "Tiếp tục"

  // ── Trang checkout (điền form) ──────────────────────────────────
  CHECKOUT_AFTER_NAV: 1200, // chờ sau khi trang checkout load
  FORM_FIELD_AFTER:    300, // chờ giữa các field khi điền form
  DROPDOWN_TYPE_DELAY:  50, // delay giữa các ký tự khi gõ dropdown tỉnh/xã
  DROPDOWN_WAIT_RESULT: 500, // chờ sau khi gõ để kết quả dropdown hiện ra

  // ── Chung ──────────────────────────────────────────────────────
  STEP_PAUSE:         300,  // chờ nhỏ giữa các bước phụ (scroll → action)
  SCROLL_WAIT:        500,  // chờ sau mỗi lần scroll trong vòng lặp
  SCROLL_TO_TOP_WAIT: 200,  // chờ sau scrollTo(0,0)
  KEY_TYPE_DELAY:      30,  // delay giữa các phím khi gõ text vào input
};
// ═══════════════════════════════════════════════════════════════════

async function waitForVisible(locator, timeoutMs = 7000) {
  try {
    await locator.waitFor({ state: "visible", timeout: timeoutMs });
    return true;
  } catch {
    return false;
  }
}

/**
 * Đóng popup / banner quảng cáo thường xuất hiện trên PNJ khi vào trang chủ.
 * Popup thường là OptinMonster hoặc custom PNJ modal với nút X tròn.
 */
async function dismissPopups(page, sendLog) {
  // Chờ đủ để popup kịp render (PNJ popup thường xuất hiện sau 1-3s)
  await page.waitForTimeout(T.POPUP_WAIT);

  const closeSelectors = [
    // ── PNJ Mix & Shine / promotional overlay (nút ⊗ tròn góc popup) ──
    // Selector cụ thể quan sát được từ screenshot thực tế:
    'button.om-closeform',
    '[class="om-closeform"]',
    '[class*="om-closeform"]',
    '[class*="om-close"]',
    '[class*="om-popup-close"]',
    '.om-icon-times',
    '[data-omcloseform]',
    // PNJ overlay thường wrap trong div.om-popup hoặc tương tự
    '.om-popup .om-close',
    '[class*="om-"] [class*="close"]',
    // Nút X tròn nằm ngoài popup (vị trí fixed, z-index cao)
    '[style*="position: fixed"] [class*="close"]',
    '[style*="position:fixed"] [class*="close"]',
    // PNJ custom popup close button
    'button[class*="close"]',
    'span[class*="close"]',
    'div[class*="close"]',
    '[aria-label="Close"]',
    '[aria-label="close"]',
    '[aria-label="Đóng"]',
    '[aria-label*="close"]',
    // GTM banner close
    '[id*="gtm-freezing-banner"] .close-btn',
    '#gtm-freezing-banner .close-btn',
    // Generic modal close
    '.modal-close',
    '.popup-close',
    '[class*="popup"] [class*="close"]',
    '[class*="modal"] [class*="close"]',
    '[class*="overlay"] [class*="close"]',
    '[class*="banner"] [class*="close"]',
    // Nút text
    'button:has-text("Bỏ qua")',
    'button:has-text("Đóng")',
    'button:has-text("×")',
    'button:has-text("✕")',
    'button:has-text("✖")',
  ];

  let closedCount = 0;

  // Vòng lặp đóng: thử đóng tối đa 3 popup liên tiếp
  for (let round = 0; round < 3; round++) {
    let closedThisRound = false;

    for (const sel of closeSelectors) {
      try {
        const btn = page.locator(sel).first();
        const visible = await btn.isVisible().catch(() => false);
        if (visible) {
          await btn.click({ force: true });
          closedCount++;
          closedThisRound = true;
          sendLog(`PNJ: Đã đóng popup (${sel}).`, "info");
          await page.waitForTimeout(T.POPUP_AFTER_CLICK);
          break;
        }
      } catch { }
    }

    if (!closedThisRound) break; // không còn popup nào nữa
  }

  // Fallback evaluate mạnh hơn: quét toàn bộ DOM tìm overlay + nút X
  if (closedCount === 0) {
    const clicked = await page.evaluate(() => {
      // 1) Thử tìm overlay/modal có z-index cao (popup che toàn màn hình)
      const allEls = Array.from(document.querySelectorAll('*'));
      const overlays = allEls.filter(el => {
        const style = window.getComputedStyle(el);
        const zIndex = parseInt(style.zIndex || '0', 10);
        const pos = style.position;
        const rect = el.getBoundingClientRect();
        // Overlay thường: fixed/absolute, z-index > 100, kích thước lớn
        return (pos === 'fixed' || pos === 'absolute')
          && zIndex > 100
          && rect.width > 200
          && rect.height > 200;
      });

      // Trong mỗi overlay, tìm nút X
      for (const overlay of overlays) {
        const candidates = Array.from(overlay.querySelectorAll(
          'button, span, div, a, svg, [role="button"], img'
        ));
        for (const el of candidates) {
          const rect = el.getBoundingClientRect();
          const text = (el.textContent || '').trim();
          const cls = (el.className || '').toString().toLowerCase();
          const aria = (el.getAttribute('aria-label') || '').toLowerCase();
          const isSmall = rect.width > 0 && rect.width < 70 && rect.height < 70;
          const isCloseText = ['×', '✕', 'x', '✖', 'close'].includes(text.toLowerCase());
          const isCloseClass = cls.includes('close') || cls.includes('dismiss') || cls.includes('times');
          const isCloseAria = aria.includes('close') || aria.includes('đóng');
          if (isSmall && (isCloseText || isCloseClass || isCloseAria)) {
            if (rect.top >= 0 && rect.top < window.innerHeight) {
              el.click();
              return true;
            }
          }
        }
      }

      // 2) Fallback: quét toàn bộ DOM tìm nút X nhỏ bất kỳ
      const globalCandidates = Array.from(document.querySelectorAll(
        'button, span, div, a, svg, [role="button"]'
      ));
      for (const el of globalCandidates) {
        const rect = el.getBoundingClientRect();
        const text = (el.textContent || '').trim();
        const cls = (el.className || '').toString().toLowerCase();
        const aria = (el.getAttribute('aria-label') || '').toLowerCase();
        const isSmall = rect.width > 0 && rect.width < 60 && rect.height < 60;
        const isCloseText = ['×', '✕', 'x', '✖', 'close'].includes(text.toLowerCase());
        const isCloseClass = cls.includes('close') || cls.includes('dismiss') || cls.includes('times');
        const isCloseAria = aria.includes('close') || aria.includes('đóng');
        if (isSmall && (isCloseText || isCloseClass || isCloseAria)) {
          if (rect.top >= 0 && rect.top < window.innerHeight) {
            el.click();
            return true;
          }
        }
      }
      return false;
    });

    if (clicked) {
      sendLog("PNJ: Đã đóng popup qua evaluate fallback.", "info");
      closedCount++;
      await page.waitForTimeout(T.POPUP_AFTER_CLICK);
    }
  }

  // Nhấn Escape thêm để đảm bảo modal đóng
  try { await page.keyboard.press("Escape"); } catch { }
  await page.waitForTimeout(T.STEP_PAUSE);

  if (closedCount === 0) {
    sendLog("PNJ: Không tìm thấy popup cần đóng.", "info");
  }
  return closedCount > 0;
}
/**
 * Phên bản nhanh của dismissPopups — không có wait đầu 2000ms.
 * Dùng trong các vòng lặp để đóng popup PNJ xuất hiện khi đang thực thi.
 */
async function dismissPopupsQuick(page, sendLog) {
  const closeSelectors = [
    'button.om-closeform',
    '[class="om-closeform"]',
    '[class*="om-closeform"]',
    '[class*="om-close"]',
    '[class*="om-popup-close"]',
    '.om-icon-times',
    '[data-omcloseform]',
    '.om-popup .om-close',
    '[class*="om-"] [class*="close"]',
    '[style*="position: fixed"] [class*="close"]',
    '[style*="position:fixed"] [class*="close"]',
    'button[class*="close"]',
    'span[class*="close"]',
    'div[class*="close"]',
    '[aria-label="Close"]',
    '[aria-label="close"]',
    '[aria-label="Đóng"]',
    '[aria-label*="close"]',
    '.modal-close',
    '.popup-close',
    '[class*="popup"] [class*="close"]',
    '[class*="modal"] [class*="close"]',
    '[class*="overlay"] [class*="close"]',
    '[class*="banner"] [class*="close"]',
    'button:has-text("×")',
    'button:has-text("✕")',
    'button:has-text("✖")',
    'button:has-text("Bỏ qua")',
    'button:has-text("Đóng")',
  ];

  let closedCount = 0;
  for (const sel of closeSelectors) {
    try {
      const btn = page.locator(sel).first();
      const visible = await btn.isVisible().catch(() => false);
      if (visible) {
        await btn.click({ force: true });
        closedCount++;
        sendLog(`PNJ: [Quick] Đã đóng popup (${sel}).`, "info");
        await page.waitForTimeout(T.POPUP_AFTER_CLICK);
        break;
      }
    } catch { }
  }

  // Fallback evaluate: quét overlay có z-index cao
  if (closedCount === 0) {
    const clicked = await page.evaluate(() => {
      const allEls = Array.from(document.querySelectorAll('*'));
      const overlays = allEls.filter(el => {
        const style = window.getComputedStyle(el);
        const zIndex = parseInt(style.zIndex || '0', 10);
        const pos = style.position;
        const rect = el.getBoundingClientRect();
        return (pos === 'fixed' || pos === 'absolute')
          && zIndex > 100
          && rect.width > 200 && rect.height > 200
          && style.display !== 'none'
          && style.visibility !== 'hidden';
      });
      for (const overlay of overlays) {
        const candidates = Array.from(overlay.querySelectorAll(
          'button, span, div, a, svg, [role="button"]'
        ));
        for (const el of candidates) {
          const rect = el.getBoundingClientRect();
          const text = (el.textContent || '').trim();
          const cls = (el.className || '').toString().toLowerCase();
          const aria = (el.getAttribute('aria-label') || '').toLowerCase();
          const isSmall = rect.width > 0 && rect.width < 70 && rect.height < 70;
          const isCloseText = ['×', '✕', 'x', '✖', 'close'].includes(text.toLowerCase());
          const isCloseClass = cls.includes('close') || cls.includes('dismiss') || cls.includes('times');
          const isCloseAria = aria.includes('close') || aria.includes('đóng');
          if (isSmall && (isCloseText || isCloseClass || isCloseAria)) {
            if (rect.top >= 0 && rect.top < window.innerHeight) {
              el.click();
              return true;
            }
          }
        }
      }
      // Fallback toàn bộ DOM
      const globals = Array.from(document.querySelectorAll('button, span, div, a, [role="button"]'));
      for (const el of globals) {
        const rect = el.getBoundingClientRect();
        const text = (el.textContent || '').trim();
        const cls = (el.className || '').toString().toLowerCase();
        const aria = (el.getAttribute('aria-label') || '').toLowerCase();
        const isSmall = rect.width > 0 && rect.width < 60 && rect.height < 60;
        const isCloseText = ['×', '✕', 'x', '✖', 'close'].includes(text.toLowerCase());
        const isCloseClass = cls.includes('close') || cls.includes('dismiss') || cls.includes('times');
        const isCloseAria = aria.includes('close') || aria.includes('đóng');
        if (isSmall && (isCloseText || isCloseClass || isCloseAria)) {
          if (rect.top >= 0 && rect.top < window.innerHeight) {
            el.click();
            return true;
          }
        }
      }
      return false;
    });
    if (clicked) {
      sendLog("PNJ: [Quick] Đã đóng popup (evaluate fallback).", "info");
      closedCount++;
      await page.waitForTimeout(T.POPUP_AFTER_CLICK);
    }
  }

  try { await page.keyboard.press('Escape'); } catch { }
  return closedCount > 0;
}


async function gotoHomepage(page, sendLog) {
  const currentUrl = page.url();
  if (currentUrl.includes("pnj.com.vn") && !currentUrl.includes("?")) {
    sendLog("PNJ: Đang ở trang chủ PNJ rồi.", "info");
    await dismissPopups(page, sendLog);
    return;
  }
  sendLog("PNJ: Đang mở trang chủ www.pnj.com.vn...", "info");
  await page.goto("https://www.pnj.com.vn/", { waitUntil: "domcontentloaded", timeout: 25000 });
  sendLog("PNJ: Đã load trang chủ. Kiểm tra popup...", "info");

  // ── Dùng Promise.race: chạy song song tất cả selectors, ai hiện trước click trước ──
  const popupCloseSelectors = [
    'button.om-closeform',
    '[class*="om-closeform"]',
    '[class*="om-close"]',
    '.om-icon-times',
    '[data-omcloseform]',
    'button[class*="close"]',
    '[aria-label="Close"]',
    '[aria-label="close"]',
    '[aria-label="Đóng"]',
  ];

  let popupClosed = false;
  // Chạy song song: ai hiện ra trong T.POPUP_WAIT ms thì click ngay
  const POPUP_RACE_TIMEOUT = T.POPUP_WAIT;
  try {
    const winner = await Promise.race([
      ...popupCloseSelectors.map(sel =>
        page.waitForSelector(sel, { state: 'visible', timeout: POPUP_RACE_TIMEOUT })
          .then(el => ({ sel, el }))
          .catch(() => null)
      ),
      new Promise(res => setTimeout(() => res(null), POPUP_RACE_TIMEOUT + 100))
    ]);
    if (winner?.el) {
      await winner.el.click({ force: true }).catch(() => {});
      sendLog(`PNJ: Đã đóng popup nhanh (${winner.sel}).`, "info");
      popupClosed = true;
      await page.waitForTimeout(T.POPUP_AFTER_CLICK);
    }
  } catch { }

  // Fallback nếu chưa đóng được
  if (!popupClosed) {
    await dismissPopups(page, sendLog);
  }

  sendLog("PNJ: Trang chủ sẵn sàng.", "success");
}

/**
 * Bước 2 (mới): Click "Tìm kiếm nhanh" → nhập tên sản phẩm → chọn kết quả khớp.
 *
 * PNJ Next.js: ô "Tìm kiếm nhanh" là <div id="search-box"> (KHÔNG phải input).
 * Click vào đó → mở modal/overlay chứa input thật → type → Enter hoặc click gợi ý.
 */
async function searchProductQuick(page, productName, sendLog) {
  sendLog(`PNJ: [Tìm kiếm nhanh] Bắt đầu tìm "${productName}"...`, "info");

  // Trích SKU từ tên sản phẩm
  // Hỗ trợ: PFXMW060023 (chữ+số), 0000W061015 (số+chữ+số), DD00C000081 (hỗn hợp)
  let searchTerm = productName;
  const skuMatch = productName.match(/\b([A-Z]{2,}\d{4,}[A-Z0-9]*|\d{3,}[A-Z]\d{3,}[A-Z0-9]*)\b/i);
  if (skuMatch) {
    searchTerm = skuMatch[0].toUpperCase();
    sendLog(`PNJ: [Tìm kiếm nhanh] Dùng mã SKU: "${searchTerm}"`, "info");
  } else {
    sendLog(`PNJ: [Tìm kiếm nhanh] Không tách được SKU, dùng tên đầy đủ.`, "warning");
  }

  // ── Bước 1: Click vào div#search-box (PNJ Next.js) hoặc icon kính lúp ──
  // PNJ Next.js: "Tìm kiếm nhanh" là <div id="search-box"> — click nó mở modal overlay với input thật
  sendLog("PNJ: [Tìm kiếm nhanh] Click vào ô tìm kiếm...", "info");

  // Selectors theo thứ tự ưu tiên (Next.js PNJ trước, CS-Cart sau)
  const searchBoxSelectors = [
    '#search-box',                         // PNJ Next.js — div trigger chính
    '[class*="search-box"]',               // PNJ Next.js variant
    'a.ty-search-block__loupe',            // CS-Cart
    '.ty-search-block__loupe',
    '[class*="loupe"]',
    'button.ty-search-block__loupe',
    '[aria-label*="ìm kiếm"]',
    '[aria-label*="earch"]',
  ];

  let triggerClicked = false;
  for (const sel of searchBoxSelectors) {
    try {
      const el = page.locator(sel).first();
      if (await el.count() > 0) {
        await el.click({ timeout: 3000 });
        triggerClicked = true;
        sendLog(`PNJ: [Tìm kiếm nhanh] Đã click trigger (${sel}).`, "info");
        break;
      }
    } catch { }
  }
  if (!triggerClicked) {
    await page.evaluate(() => {
      const el = document.querySelector('#search-box, [class*="search-box"], .ty-search-block__loupe, [class*="loupe"], a[class*="search"]');
      if (el) el.click();
    });
    sendLog("PNJ: [Tìm kiếm nhanh] Fallback evaluate click.", "info");
  }
  await page.waitForTimeout(1000); // đợi modal/overlay animation xong

  // ── Bước 2: Tìm input thật trong modal/overlay và type ─────────────────
  // PNJ Next.js: sau khi click #search-box → xuất hiện modal overlay chứa input thật
  // CS-Cart: input#search_input với class cm-hint
  let searchInput = null;
  const inputSelectors = [
    // ✅ PNJ Next.js modal — selectors chính xác từ DevTools
    'input#search',                          // id="search" — chính xác nhất
    'input[name="search"]',                  // name="search"
    'input[placeholder="Tìm kiếm nhanh"]',  // placeholder chính xác
    'input[aria-label="Search"]',            // aria-label="Search"
    // PNJ Next.js fallback (class-based)
    'input.search-class',                    // class="search-class outline-none..."
    '[class*="modal"] input',
    '[class*="overlay"] input',
    '[class*="search"] input[type="text"]',
    '[class*="search"] input[type="search"]',
    'input[type="search"]',
    // CS-Cart selectors (fallback cũ)
    'input#search_input',
    'input.ty-search-block__input',
    // Placeholder-based fallback
    'input[placeholder*="nhanh"]',
    'input[placeholder*="Tìm kiếm"]',
    // Generic last resort
    'input[type="text"]',
  ];

  for (const sel of inputSelectors) {
    try {
      await page.waitForSelector(sel, { state: 'visible', timeout: 1500 });
      const candidate = page.locator(sel).first();
      if (await candidate.count() > 0) {
        searchInput = candidate;
        sendLog(`PNJ: [Tìm kiếm nhanh] Thấy input (${sel}).`, "info");
        break;
      }
    } catch { }
  }

  if (searchInput) {
    try {
      // Click vào input để focus
      await searchInput.click();
      await page.waitForTimeout(300);

      // Clear bất kỳ text nào đang có (CS-Cart hint value, placeholder text...)
      await searchInput.fill('');
      await page.waitForTimeout(100);

      // Type từng ký tự để trigger React/Next.js onChange events
      await page.keyboard.type(searchTerm, { delay: 80 });
      sendLog(`PNJ: [Tìm kiếm nhanh] ✅ Đã gõ "${searchTerm}".`, "info");

      // Đợi autocomplete PNJ xuất hiện (Next.js cần ~1-2s)
      await page.waitForTimeout(T.SEARCH_AFTER_TYPE);

      // ── Ưu tiên 1: Click autocomplete item chứa đúng SKU ─────────────
      // Dùng evaluate để tìm link trong modal chứa searchTerm
      // PNJ autocomplete links có thể là /site/san-pham/... hoặc /search?keyword=...
      const autoClicked = await page.evaluate((term) => {
        // Tìm trong vùng modal/form search, không lấy link ngoài trang
        const modal = document.querySelector('[class*="modal"], [class*="overlay"], [class*="popup"], form');
        const searchIn = modal || document.body;

        // Tất cả link <a> trong modal (không giới hạn href pattern)
        const links = Array.from(searchIn.querySelectorAll('a[href]'));
        const termLower = term.toLowerCase();

        for (const link of links) {
          const href = (link.getAttribute('href') || '').toLowerCase();
          const text = (link.textContent || '').toLowerCase();
          // Khớp chính xác theo SKU trong href hoặc text
          if (href.includes(termLower) || text.includes(termLower)) {
            link.setAttribute('data-pnj-autocomplete-target', 'true');
            return { found: true, text: link.textContent?.trim().slice(0, 100), href: link.getAttribute('href') };
          }
        }
        return { found: false };
      }, searchTerm.toLowerCase());

      if (autoClicked.found) {
        sendLog(`PNJ: [Tìm kiếm nhanh] ✅ Tìm thấy gợi ý chứa SKU: "${autoClicked.text?.slice(0, 80)}"`, "success");
        const target = page.locator('[data-pnj-autocomplete-target="true"]').first();
        try {
          await target.scrollIntoViewIfNeeded();
          await target.click({ timeout: 5000 });
          await page.evaluate(() => {
            const el = document.querySelector('[data-pnj-autocomplete-target]');
            if (el) el.removeAttribute('data-pnj-autocomplete-target');
          });
          await page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});
          await page.waitForTimeout(T.PRODUCT_AFTER_CLICK);
          if (page.url().includes('/san-pham/')) {
            sendLog("PNJ: [Tìm kiếm nhanh] ✅ Đã vào trang sản phẩm.", "success");
            return true;
          }
        } catch (clickErr) {
          sendLog(`PNJ: [Tìm kiếm nhanh] Click autocomplete lỗi: ${clickErr.message}`, "warning");
        }
      } else {
        sendLog("PNJ: [Tìm kiếm nhanh] Không có gợi ý khớp SKU → nhấn Enter...", "info");
      }

      // ── Ưu tiên 2: Nhấn Enter → vào trang kết quả tìm kiếm ──────────
      sendLog("PNJ: [Tìm kiếm nhanh] Nhấn Enter...", "info");
      await page.keyboard.press('Enter');
      await page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(T.PAGE_AFTER_LOAD);

      const currentUrl = page.url();
      // PNJ search URL: /search?keyword=... hoặc /site/san-pham?q=...
      if (currentUrl.includes('/site/san-pham/') || currentUrl.includes('/san-pham/')) {
        sendLog("PNJ: [Tìm kiếm nhanh] ✅ Đã vào trang sản phẩm.", "success");
        return true;
      }
      if (currentUrl.includes('search?keyword=') || currentUrl.includes('?q=') || currentUrl.includes('/san-pham')) {
        sendLog(`PNJ: [Tìm kiếm nhanh] Vào trang kết quả: ${currentUrl}`, "info");
        const found = await clickProductInListing(page, productName, sendLog);
        return found;
      }
    } catch (err) {
      sendLog(`PNJ: [Tìm kiếm nhanh] Type lỗi: ${err.message}`, "warning");
    }
  } else {
    sendLog("PNJ: [Tìm kiếm nhanh] Không thấy input sau click icon.", "warning");
  }


  // ── Fallback: Navigate thẳng URL search ────────────────────────────────
  // PNJ Next.js dùng /search?keyword= (không phải /site/san-pham?q=)
  sendLog("PNJ: [Tìm kiếm nhanh] Fallback → navigate thẳng URL search.", "info");
  const q = encodeURIComponent(searchTerm);
  await page.goto(`https://www.pnj.com.vn/search?keyword=${q}`, { waitUntil: 'domcontentloaded', timeout: 25000 });
  await page.waitForTimeout(T.PAGE_AFTER_LOAD);
  await dismissPopupsQuick(page, sendLog);
  sendLog(`PNJ: [Tìm kiếm nhanh] URL: ${page.url()}`, "info");

  const found = await clickProductInListing(page, productName, sendLog);
  return found;
}




/**
 * Bước 2: Scroll xuống và click vào danh mục phù hợp.
 * ƪu tiên dùng payload.category nếu có, fallback tự tính từ tên sản phẩm.
 *
 * DOM: Trang chủ PNJ có grid "Bạn đang tìm gì hôm nay?" với các link hình + text
 * Selector: thẻ <a> hoặc <div> chứa text category
 */
async function clickCategory(page, payload, sendLog) {
  sendLog("PNJ: Đang scroll trang chủ để tìm danh mục...", "info");

  // Chờ thêm 2s rồi dismiss: popup "Mix & Shine" xuất hiện muộn sau khi homepage load
  await page.waitForTimeout(T.POPUP_WAIT);
  await dismissPopupsQuick(page, sendLog);

  // ── Xác định danh mục ──────────────────────────────────────────────────
  let targetCategoryLabel;

  if (payload.category && payload.category.trim()) {
    // ƪu tiên: dùng category từ payload JSON (do người dùng chỉ định)
    targetCategoryLabel = payload.category.trim();
    sendLog(`PNJ: Dùng category từ JSON: "${targetCategoryLabel}"`, "info");
  } else {
    // Fallback: tự tính từ tên sản phẩm
    const categoryMap = [
      { keywords: ["nhẫn kim cương", "nhan kim cuong"], label: "Nhẫn Kim cương" },
      { keywords: ["nhẫn cưới", "nhan cuoi"], label: "Nhẫn Cưới" },
      { keywords: ["nhẫn cầu hôn", "nhan cau hon"], label: "Nhẫn Cầu hôn" },
      { keywords: ["bông tai", "bong tai", "hoa tai"], label: "Bông tai ECZ" },
      { keywords: ["dây cổ", "day co", "dây chuyền vàng", "day chuyen vang"], label: "Dây chuyền Vàng" },
      { keywords: ["đồng hồ", "dong ho"], label: "Đồng hồ Kim cương" },
      { keywords: ["trang sức mới", "trang suc moi"], label: "Trang sức mới" },
      { keywords: ["trang sức cưới", "trang suc cuoi"], label: "Trang sức Cưới" },
      { keywords: ["trang sức nam", "trang suc nam"], label: "Trang sức Nam" },
      { keywords: ["trang sức vàng", "trang suc vang"], label: "Trang sức Vàng" },
      { keywords: ["trang sức bạc", "trang suc bac"], label: "Trang sức Bạc" },
      { keywords: ["nhẫn", "nhan"], label: "Nhẫn Kim cương" },
    ];
    const normalizedName = (payload.productName || "").toLowerCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    targetCategoryLabel = "Nhẫn Kim cương";
    for (const cat of categoryMap) {
      const match = cat.keywords.some(kw => {
        const normKw = kw.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
        return normalizedName.includes(normKw);
      });
      if (match) { targetCategoryLabel = cat.label; break; }
    }
    sendLog(`PNJ: Tự tính category từ tên sản phẩm: "${targetCategoryLabel}"`, "info");
  }

  sendLog(`PNJ: Danh mục mục tiêu: "${targetCategoryLabel}"`, "info");

  // Scroll dần để tìm grid danh mục
  for (let scrollTry = 0; scrollTry < 5; scrollTry++) {
    // 1) Scroll xuống trước
    await page.evaluate(() => window.scrollBy(0, 350));
    await page.waitForTimeout(T.SCROLL_WAIT);

    // 2) Sau khi scroll: tắt popup nếu xuất hiện (popup PNJ hay trigger sau scroll)
    await dismissPopupsQuick(page, sendLog);

    // 3) Tìm phần tử chứa text danh mục trong grid homepage
    const found = await page.evaluate((targetLabel) => {
      // Tìm tất cả text node trùng với label danh mục
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        const text = (node.textContent || "").trim();
        if (text === targetLabel || text.includes(targetLabel)) {
          // Leo lên tổ tiên clickable
          let el = node.parentElement;
          for (let i = 0; i < 5; i++) {
            if (!el) break;
            const rect = el.getBoundingClientRect();
            const tag = el.tagName.toLowerCase();
            if ((tag === "a" || tag === "button" || el.onclick) && rect.width > 0 && rect.height > 0) {
              el.setAttribute("data-pnj-cat-target", "true");
              return { found: true, text };
            }
            el = el.parentElement;
          }
          // Fallback: đánh dấu parent gần nhất có rect
          el = node.parentElement;
          for (let i = 0; i < 8; i++) {
            if (!el) break;
            const rect = el.getBoundingClientRect();
            if (rect.width > 50 && rect.height > 50) {
              el.setAttribute("data-pnj-cat-target", "true");
              return { found: true, text };
            }
            el = el.parentElement;
          }
        }
      }
      return { found: false };
    }, targetCategoryLabel);

    if (found.found) {
      sendLog(`PNJ: Tìm thấy danh mục "${found.text}". Đang click...`, "success");
      const target = page.locator('[data-pnj-cat-target="true"]').first();
      try {
        await target.scrollIntoViewIfNeeded();
        await page.waitForTimeout(T.STEP_PAUSE);
        await target.click();
        // Cleanup attribute
        await page.evaluate(() => {
          const el = document.querySelector('[data-pnj-cat-target]');
          if (el) el.removeAttribute('data-pnj-cat-target');
        });
        await page.waitForLoadState("domcontentloaded", { timeout: 15000 }).catch(() => {});
        await page.waitForTimeout(T.PAGE_AFTER_LOAD);
        sendLog(`PNJ: Đã vào trang danh mục "${targetCategoryLabel}".`, "success");
        return true;
      } catch (err) {
        sendLog(`PNJ: Click danh mục lỗi: ${err.message}`, "warning");
      }
    }
  }

  // Fallback: dùng URL danh mục trực tiếp
  sendLog(`PNJ: Không tìm thấy danh mục qua scroll, thử URL trực tiếp...`, "warning");
  const catUrlMap = {
    "Nhẫn Kim cương": "/site/danh-muc/nhan/nhan-kim-cuong-pnj",
    "Nhẫn Cưới": "/site/danh-muc/nhan/nhan-cuoi-pnj",
    "Nhẫn Cầu hôn": "/site/danh-muc/nhan/nhan-cau-hon-pnj",
  };
  const catPath = catUrlMap[targetCategoryLabel] || "/site/danh-muc/nhan/nhan-kim-cuong-pnj";
  await page.goto(`https://www.pnj.com.vn${catPath}`, { waitUntil: "domcontentloaded", timeout: 20000 });
  await page.waitForTimeout(T.PAGE_AFTER_LOAD);
  sendLog(`PNJ: Đã vào danh mục qua URL: ${catPath}`, "info");
  return true;
}

/**
 * Bước 3: Trên trang danh mục → scroll để tìm sản phẩm và click vào
 * Tìm thẻ <a> chứa text trùng với productName (hoặc SKU code nếu có)
 */
async function clickProductInListing(page, productName, sendLog) {
  sendLog(`PNJ: Đang tìm sản phẩm "${productName}" trong danh sách...`, "info");

  // Trích mã SKU từ tên sản phẩm
  // Hỗ trợ: PFXMW060023 (chữ+số), 0000W061015 (số+chữ+số), DD00C000081 (hỗn hợp)
  const skuMatch = productName.match(/\b([A-Z]{2,}\d{4,}[A-Z0-9]*|\d{3,}[A-Z]\d{3,}[A-Z0-9]*)\b/i);
  const sku = skuMatch ? skuMatch[0].toUpperCase() : null;
  if (sku) sendLog(`PNJ: Tìm theo mã SKU: ${sku}`, "info");

  for (let scrollTry = 0; scrollTry < 10; scrollTry++) {
    if (scrollTry > 0) {
      await page.evaluate(() => window.scrollBy(0, 500));
      await page.waitForTimeout(T.SEARCH_SCROLL);
    }

    const found = await page.evaluate(({ targetName, targetSku }) => {
      // PNJ Next.js dùng /site/san-pham/ cho link sản phẩm
      // Tìm cả hai pattern để tương thích
      const allLinks = Array.from(document.querySelectorAll(
        'a[href*="/site/san-pham/"], a[href*="/san-pham/"]'
      ));

      function normalize(s) {
        return (s || "").toLowerCase()
          .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
          .replace(/\s+/g, " ").trim();
      }

      const normTarget = normalize(targetName);
      const skuLower = targetSku ? targetSku.toLowerCase() : null;

      for (const link of allLinks) {
        const rect = link.getBoundingClientRect();
        if (rect.width < 10 || rect.height < 10) continue;

        const linkText = normalize(link.textContent || "");
        const href = (link.getAttribute("href") || "").toLowerCase();

        // Ưu tiên khớp SKU trong href (chính xác nhất)
        if (skuLower && href.includes(skuLower)) {
          link.setAttribute("data-pnj-product-target", "true");
          return { found: true, text: link.textContent?.trim().slice(0, 80), bysku: true, method: "href" };
        }
        // Khớp SKU trong text
        if (skuLower && linkText.includes(skuLower)) {
          link.setAttribute("data-pnj-product-target", "true");
          return { found: true, text: link.textContent?.trim().slice(0, 80), bysku: true, method: "text" };
        }
        // Fallback: khớp tên sản phẩm
        if (normTarget.length > 5 && linkText.includes(normTarget.slice(0, 20))) {
          link.setAttribute("data-pnj-product-target", "true");
          return { found: true, text: link.textContent?.trim().slice(0, 80), bysku: false, method: "name" };
        }
      }
      return { found: false };
    }, { targetName: productName, targetSku: sku });


    if (found.found) {
      const method = found.bysku ? `SKU [${sku}]` : "tên sản phẩm";
      sendLog(`PNJ: Tìm thấy sản phẩm qua ${method}: "${found.text}". Click...`, "success");
      const target = page.locator('[data-pnj-product-target="true"]').first();
      try {
        await target.scrollIntoViewIfNeeded();
        await page.waitForTimeout(T.STEP_PAUSE);
        await target.click();
        await page.evaluate(() => {
          const el = document.querySelector('[data-pnj-product-target]');
          if (el) el.removeAttribute('data-pnj-product-target');
        });
        await page.waitForLoadState("domcontentloaded", { timeout: 15000 }).catch(() => {});
        await page.waitForTimeout(T.PRODUCT_AFTER_CLICK);
        sendLog("PNJ: Đã vào trang chi tiết sản phẩm.", "success");
        return true;
      } catch (err) {
        sendLog(`PNJ: Click sản phẩm lỗi: ${err.message}`, "warning");
      }
    }
  }

  sendLog(`PNJ: Không tìm thấy sản phẩm "${productName}" trong danh sách.`, "warning");
  return false;
}

/**
 * Bước 4a: Chọn size trước khi thêm vào giỏ hàng.
 * Size được truyền qua payload.size (ví dụ: "17").
 * Nếu không có payload.size, bước này bỏ qua.
 * DOM PNJ: các nút size là button hoặc span trong .product-size, chứa text số.
 */
async function selectSize(page, payload, sendLog) {
  const size = (payload.size || "").toString().trim();
  if (!size) {
    sendLog("PNJ: [Size] Không có size trong payload, bỏ qua bước chọn size.", "info");
    return false;
  }

  sendLog(`PNJ: [Size] Đang chọn size "${size}"...`, "info");

  // Scroll xuống để hiện khu vực size
  await page.evaluate(() => window.scrollBy(0, 200));
  await page.waitForTimeout(T.SIZE_SCROLL);

  // Cách 1: Playwright selector — tìm button/span/li chứa đúng text size
  // PNJ dùng các nút size dạng: <button>17</button> hoặc <span>17</span>
  const sizeSelectors = [
    `button:has-text("${size}")`,
    `[class*="size"] button:has-text("${size}")`,
    `[class*="size"] span:has-text("${size}")`,
    `[class*="size"] li:has-text("${size}")`,
    `[class*="option"] button:has-text("${size}")`,
    `[class*="variant"] button:has-text("${size}")`,
    `label:has-text("${size}")`,
  ];

  for (const sel of sizeSelectors) {
    try {
      const btn = page.locator(sel).first();
      if (await waitForVisible(btn, 2000)) {
        await btn.scrollIntoViewIfNeeded();
        await page.waitForTimeout(T.STEP_PAUSE);
        await btn.click();
        sendLog(`PNJ: [Size] ✅ Đã chọn size "${size}" (selector: ${sel}).`, "success");
        await page.waitForTimeout(T.SIZE_AFTER_CLICK);
        return true;
      }
    } catch { }
  }

  // Cách 2: evaluate — tìm chính xác text = size trong khu vực chọn size
  const clicked = await page.evaluate((targetSize) => {
    // Tìm tất cả phần tử đang visible
    const candidates = Array.from(document.querySelectorAll(
      'button, span, li, div, label, [role="option"], [role="button"]'
    ));
    for (const el of candidates) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;

      const text = (el.textContent || "").trim();
      // Khớp chính xác với size (tránh nhầm 7 với 17)
      if (text === targetSize) {
        const cls = (el.className || "").toString().toLowerCase();
        // ƪu tiên phần tử có class liên quan size
        const isSize = cls.includes("size") || cls.includes("option") ||
          cls.includes("variant") || cls.includes("swatch") || cls.includes("kićh");
        if (isSize) {
          el.click();
          return { clicked: true, by: "size-class" };
        }
      }
    }
    // Fallback: click bất kỳ phần tử nào có text = size
    for (const el of candidates) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      const text = (el.textContent || "").trim();
      if (text === targetSize) {
        el.click();
        return { clicked: true, by: "text-exact" };
      }
    }
    return { clicked: false };
  }, size);

  if (clicked.clicked) {
    sendLog(`PNJ: [Size] ✅ Đã chọn size "${size}" qua evaluate (${clicked.by}).`, "success");
    await page.waitForTimeout(T.SIZE_AFTER_CLICK);
    return true;
  }

  sendLog(`PNJ: [Size] Không tìm thấy nút size "${size}" — nhường AI.`, "warning");
  return false;
}

/**
 * Bước 4b: Trên trang sản phẩm → click "Thêm vào giỏ hàng"
 */
async function addToCart(page, sendLog) {
  sendLog("PNJ: Đang tìm nút 'Thêm vào giỏ hàng'...", "info");

  // Scroll xuống để hiện nút
  await page.evaluate(() => window.scrollBy(0, 300));
  await page.waitForTimeout(T.ADD_TO_CART_SCROLL);

  // Selector theo DOM thực tế của PNJ (từ screenshot: button text "Thêm vào giỏ hàng")
  const addToCartSelectors = [
    'button:has-text("Thêm vào giỏ hàng")',
    'button:has-text("THÊM VÀO GIỎ HÀNG")',
    'button:has-text("Thêm vào giỏ")',
    '[class*="add-to-cart"]',
    '[class*="addToCart"]',
  ];

  for (const sel of addToCartSelectors) {
    try {
      const btn = page.locator(sel).first();
      if (await waitForVisible(btn, 2500)) {
        await btn.scrollIntoViewIfNeeded();
        await page.waitForTimeout(T.STEP_PAUSE);
        await btn.click();
        sendLog("PNJ: ✅ Đã thêm vào giỏ hàng!", "success");
        await page.waitForTimeout(T.ADD_TO_CART_AFTER);
        return true;
      }
    } catch { }
  }

  // Fallback evaluate: tìm button chứa "giỏ"
  const clicked = await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll("button"));
    const target = buttons.find(btn => {
      const text = (btn.textContent || "").toLowerCase();
      const rect = btn.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && !btn.disabled && text.includes("giỏ");
    });
    if (target) { target.click(); return true; }
    return false;
  });

  if (clicked) {
    sendLog("PNJ: ✅ Đã thêm vào giỏ hàng (fallback)!", "success");
    await page.waitForTimeout(T.ADD_TO_CART_AFTER);
    return true;
  }

  sendLog("PNJ: Không tìm thấy nút thêm vào giỏ — nhường AI.", "warning");
  return false;
}

/**
 * Bước 5: Vào trang giỏ hàng → tick checkbox sản phẩm → click "Tiếp tục"
 * Dựa trên screenshot: URL /site/cart, checkbox từng sản phẩm, nút "Tiếp tục" cuối trang.
 */
async function goToCartAndProceed(page, sendLog) {
  sendLog("PNJ: [Bước 5] Đang vào trang giỏ hàng...", "info");

  // ── 5a: Click icon giỏ hàng trên header (hoặc navigate thẳng) ──────────
  // Thử click vào icon giỏ hàng trước
  const cartIconSelectors = [
    'a[href*="/site/cart"]',
    '[class*="cart"] a',
    '[class*="gio-hang"] a',
    'a:has-text("Giỏ hàng")',
    '[aria-label*="cart"]',
    '[aria-label*="giỏ"]',
  ];

  let navigatedToCart = false;
  for (const sel of cartIconSelectors) {
    try {
      const el = page.locator(sel).first();
      if (await el.isVisible().catch(() => false)) {
        await el.click();
        await page.waitForLoadState("domcontentloaded", { timeout: 12000 }).catch(() => {});
        await page.waitForTimeout(T.CART_AFTER_NAV);
        if (page.url().includes("/site/cart")) {
          navigatedToCart = true;
          sendLog("PNJ: [Bước 5] Đã vào trang giỏ hàng qua click icon.", "info");
          break;
        }
      }
    } catch { }
  }

  // Fallback: navigate thẳng nếu click icon không thành công
  if (!navigatedToCart) {
    sendLog("PNJ: [Bước 5] Navigate thẳng tới /site/cart...", "info");
    await page.goto("https://www.pnj.com.vn/site/cart", {
      waitUntil: "domcontentloaded",
      timeout: 20000,
    });
    await page.waitForTimeout(T.CART_AFTER_NAV);
  }

  // ── 5b: Tick checkbox từng sản phẩm (nếu chưa được tick) ─────────────
  sendLog("PNJ: [Bước 5] Đang tick chọn sản phẩm trong giỏ hàng...", "info");

  // Thử tick checkbox của từng sản phẩm (không phải "Tất cả")
  // DOM PNJ: input[type="checkbox"] bên cạnh ảnh sản phẩm
  const tickedProduct = await page.evaluate(() => {
    // Lấy tất cả checkbox trong trang giỏ hàng
    const checkboxes = Array.from(document.querySelectorAll('input[type="checkbox"]'));
    let tickedCount = 0;

    for (const cb of checkboxes) {
      const rect = cb.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue; // hidden

      // Bỏ qua checkbox "Tất cả" (thường nằm trên cùng, gần text "Tất cả")
      const parentText = (cb.closest('label, div, td, tr, li')?.textContent || "").toLowerCase();
      const isTatCa = parentText.includes("tất cả") || parentText.includes("tat ca");

      if (!isTatCa && !cb.checked) {
        cb.click();
        tickedCount++;
      }
    }

    // Nếu không tick được sản phẩm riêng lẻ, tick "Tất cả"
    if (tickedCount === 0) {
      for (const cb of checkboxes) {
        const rect = cb.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) continue;
        if (!cb.checked) {
          cb.click();
          tickedCount++;
          break;
        }
      }
    }

    return tickedCount;
  });

  if (tickedProduct > 0) {
    sendLog(`PNJ: [Bước 5] Đã tick ${tickedProduct} sản phẩm.`, "success");
  } else {
    sendLog("PNJ: [Bước 5] Các sản phẩm đã được tick sẵn hoặc không tìm thấy checkbox.", "info");
  }

  // Fallback Playwright selector cho checkbox sản phẩm
  try {
    const productCheckbox = page.locator(
      'input[type="checkbox"]:not([class*="all"]):not([class*="tat-ca"])'
    ).first();
    if (await productCheckbox.isVisible().catch(() => false)) {
      const isChecked = await productCheckbox.isChecked().catch(() => false);
      if (!isChecked) {
        await productCheckbox.check();
        sendLog("PNJ: [Bước 5] Đã check sản phẩm qua Playwright.", "success");
      }
    }
  } catch { }

  await page.waitForTimeout(T.CART_AFTER_TICK);

  // ── 5c: Click nút "Tiếp tục" ──────────────────────────────────────────
  sendLog("PNJ: [Bước 5] Đang tìm nút 'Tiếp tục'...", "info");

  // Scroll xuống cuối trang để nút hiện đầy đủ
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(T.CART_SCROLL_BOTTOM);

  // Cách 1: getByRole button
  try {
    const btn = page.getByRole("button", { name: /tiếp tục/i });
    if (await waitForVisible(btn.first(), 3000)) {
      await btn.first().scrollIntoViewIfNeeded();
      await page.waitForTimeout(T.STEP_PAUSE);
      await btn.first().click();
      sendLog("PNJ: [Bước 5] ✅ Đã click 'Tiếp tục' (getByRole)!", "success");
      await page.waitForLoadState("domcontentloaded", { timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(T.CART_AFTER_CONTINUE);
      return true;
    }
  } catch { }

  // Cách 2: getByText
  try {
    const btn = page.getByText(/^tiếp tục$/i);
    if (await waitForVisible(btn.first(), 2000)) {
      await btn.first().scrollIntoViewIfNeeded();
      await page.waitForTimeout(T.STEP_PAUSE);
      await btn.first().click();
      sendLog("PNJ: [Bước 5] ✅ Đã click 'Tiếp tục' (getByText)!", "success");
      await page.waitForLoadState("domcontentloaded", { timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(T.CART_AFTER_CONTINUE);
      return true;
    }
  } catch { }

  // Cách 3: Playwright selector với nhiều variant
  const continueSelectors = [
    'button:has-text("Tiếp tục")',
    'button:has-text("Tiếp Tục")',
    'button:has-text("TIẾP TỤC")',
    'a:has-text("Tiếp tục")',
    '[class*="btn"]:has-text("Tiếp tục")',
    '[class*="continue"]',
    '[class*="checkout"]',
  ];

  for (const sel of continueSelectors) {
    try {
      const btn = page.locator(sel).first();
      if (await waitForVisible(btn, 2000)) {
        await btn.scrollIntoViewIfNeeded();
        await page.waitForTimeout(T.STEP_PAUSE);
        await btn.click({ force: true });
        sendLog(`PNJ: [Bước 5] ✅ Đã click 'Tiếp tục' (${sel})!`, "success");
        await page.waitForLoadState("domcontentloaded", { timeout: 15000 }).catch(() => {});
        await page.waitForTimeout(T.CART_AFTER_CONTINUE);
        return true;
      }
    } catch { }
  }

  // Cách 4: evaluate — tìm theo text contains (không phụ thuộc encoding)
  const clickedContinue = await page.evaluate(() => {
    const allEls = Array.from(document.querySelectorAll("button, a, [role='button'], div, span"));
    for (const el of allEls) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      // Normalize text: bỏ dấu, lowercase
      const raw = (el.textContent || "").trim();
      const norm = raw.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ");
      if (norm === "tiep tuc" || raw === "Tiếp tục" || norm.startsWith("tiep tuc")) {
        el.click();
        return { clicked: true, tag: el.tagName, text: raw.slice(0, 30) };
      }
    }
    return { clicked: false };
  });

  if (clickedContinue.clicked) {
    sendLog(`PNJ: [Bước 5] ✅ Đã click 'Tiếp tục' (evaluate: <${clickedContinue.tag}> "${clickedContinue.text}")!`, "success");
    await page.waitForLoadState("domcontentloaded", { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(T.CART_AFTER_CONTINUE);
    return true;
  }

  sendLog("PNJ: [Bước 5] Không tìm thấy nút 'Tiếp tục' — nhường AI.", "warning");
  return false;
}


/**
 * Bước 6: Trang checkout PNJ → điền "Họ và tên" + "Số điện thoại"
 * URL dạng: /site/checkout?type=pnj
 * DOM: input "Họ và tên *" + input "Số điện thoại *"
 */
async function fillCheckoutInfo(page, payload, sendLog) {
  const name  = (payload.buyerName  || "").trim();
  const phone = (payload.buyerPhone || "").trim();
  const email = (payload.buyerEmail || "").trim();
  // Chấp nhận cả buyerDob lẫn buyerBirthdate; convert YYYY-MM-DD → DD/MM/YYYY nếu cần
  const rawDob = (payload.buyerDob || payload.buyerBirthdate || "").trim();
  const birthdate = (() => {
    if (!rawDob) return "";
    // Nếu đã là DD/MM/YYYY thì giữ nguyên
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(rawDob)) return rawDob;
    // Nếu là YYYY-MM-DD → đổi sang DD/MM/YYYY
    if (/^\d{4}-\d{2}-\d{2}$/.test(rawDob)) {
      const [y, m, d] = rawDob.split("-");
      return `${d}/${m}/${y}`;
    }
    return rawDob;
  })();

  if (!name && !phone) {
    sendLog("PNJ: [Bước 6] Không có thông tin người mua trong payload, bỏ qua.", "info");
    return false;
  }

  sendLog(`PNJ: [Bước 6] Điền thông tin người mua: "${name}" / "${phone}" / "${email}" / "${birthdate}"`, "info");

  // Chờ trang checkout load (URL phải chứa checkout)
  try {
    await page.waitForURL(/checkout/, { timeout: 12000 });
  } catch {
    // Nếu URL chưa đổi, thử waitForSelector form
  }
  await page.waitForTimeout(T.PAGE_AFTER_LOAD);

  // ── Setup route intercept payment API sớm ─────────────────────────────────
  // PNJ gọi get-list-payment khi checkout load / địa chỉ thay đổi.
  // Intercept sớm để force is_available=true cho mọi phương thức.
  if (payload.paymentMethod || payload.buyerPayment) {
    try {
      await page.route('**/get-list-payment**', async (route) => {
        try {
          const resp = await route.fetch();
          const json = await resp.json();
          if (json && Array.isArray(json.data)) {
            json.data = json.data.map(function(item) {
              var key = Object.keys(item)[0];
              return { [key]: Object.assign({}, item[key], { is_available: true }) };
            });
          }
          await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(json) });
        } catch (_) { await route.continue(); }
      });
    } catch (_) {}
  }

  // ── Điền Họ và tên ──────────────────────────────────────────────────────
  if (name) {
    const nameSelectors = [
      'input[placeholder*="Họ và tên"]',
      'input[placeholder*="ho va ten"]',
      'input[name*="name"]',
      'input[name*="fullname"]',
      'input[name*="full_name"]',
      'input[id*="name"]',
      // Fallback: input đầu tiên trong section "Thông tin người mua"
      'form input[type="text"]:first-of-type',
    ];

    let filledName = false;
    for (const sel of nameSelectors) {
      try {
        const el = page.locator(sel).first();
        if (await waitForVisible(el, 2000)) {
          await el.scrollIntoViewIfNeeded();
          await el.click({ clickCount: 3 }); // select all
          await el.type(name, { delay: T.KEY_TYPE_DELAY });
          sendLog(`PNJ: [Bước 6] ✅ Đã điền họ tên: "${name}"`, "success");
          filledName = true;
          break;
        }
      } catch { }
    }

    // Fallback evaluate
    if (!filledName) {
      filledName = await page.evaluate((n) => {
        const inputs = Array.from(document.querySelectorAll('input[type="text"], input:not([type])'));
        for (const inp of inputs) {
          const ph = (inp.placeholder || "").toLowerCase();
          const rect = inp.getBoundingClientRect();
          if (rect.width > 0 && (ph.includes("họ") || ph.includes("ho") || ph.includes("name"))) {
            inp.focus();
            inp.value = n;
            inp.dispatchEvent(new Event("input", { bubbles: true }));
            inp.dispatchEvent(new Event("change", { bubbles: true }));
            return true;
          }
        }
        return false;
      }, name);
      if (filledName) sendLog(`PNJ: [Bước 6] ✅ Đã điền họ tên (evaluate): "${name}"`, "success");
    }
  }

  await page.waitForTimeout(T.STEP_PAUSE);

  // ── Điền Số điện thoại ───────────────────────────────────────────────────
  if (phone) {
    const phoneSelectors = [
      'input[placeholder*="Số điện thoại"]',
      'input[placeholder*="so dien thoai"]',
      'input[type="tel"]',
      'input[name*="phone"]',
      'input[name*="mobile"]',
      'input[id*="phone"]',
    ];

    let filledPhone = false;
    for (const sel of phoneSelectors) {
      try {
        const el = page.locator(sel).first();
        if (await waitForVisible(el, 2000)) {
          await el.scrollIntoViewIfNeeded();
          await el.click({ clickCount: 3 });
          await el.type(phone, { delay: T.KEY_TYPE_DELAY });
          sendLog(`PNJ: [Bước 6] ✅ Đã điền SĐT: "${phone}"`, "success");
          filledPhone = true;
          break;
        }
      } catch { }
    }

    // Fallback evaluate
    if (!filledPhone) {
      filledPhone = await page.evaluate((p) => {
        const inputs = Array.from(document.querySelectorAll('input'));
        for (const inp of inputs) {
          const ph = (inp.placeholder || "").toLowerCase();
          const type = (inp.type || "").toLowerCase();
          const rect = inp.getBoundingClientRect();
          if (rect.width > 0 && (type === "tel" || ph.includes("điện thoại") || ph.includes("phone") || ph.includes("mobile"))) {
            inp.focus();
            inp.value = p;
            inp.dispatchEvent(new Event("input", { bubbles: true }));
            inp.dispatchEvent(new Event("change", { bubbles: true }));
            return true;
          }
        }
        return false;
      }, phone);
      if (filledPhone) sendLog(`PNJ: [Bước 6] ✅ Đã điền SĐT (evaluate): "${phone}"`, "success");
    }
  }

  await page.waitForTimeout(T.STEP_PAUSE);

  // ── Điền Email ──────────────────────────────────────────────────────────
  if (email) {
    try {
      const emailInp = page.locator('input[placeholder*="Email"], input[name*="email"]').first();
      if (await waitForVisible(emailInp, 2000)) {
        await emailInp.scrollIntoViewIfNeeded();
        await emailInp.click({ clickCount: 3 });
        await emailInp.type(email, { delay: T.KEY_TYPE_DELAY });
        sendLog(`PNJ: [Bước 6] ✅ Đã điền email: ${email}`, "success");
      }
    } catch (e) {
      sendLog(`PNJ: [Bước 6] Lỗi điền email: ${e.message}`, "warning");
    }
  }

  await page.waitForTimeout(T.FORM_FIELD_AFTER);

  // ── Điền Ngày sinh — dùng nativeInputValueSetter để bypass React controlled input ──
  if (birthdate) {
    try {
      // Playwright fill() trực tiếp vào input date
      const dobInp = page.locator('input[placeholder*="DD/MM/YYYY"], input[name*="birthday"], input[name*="dob"]').first();
      if (await waitForVisible(dobInp, 2000)) {
        await dobInp.scrollIntoViewIfNeeded();
        await dobInp.click({ clickCount: 3 });
        await dobInp.fill(birthdate);
        await dobInp.dispatchEvent('input');
        await dobInp.dispatchEvent('change');
        await dobInp.dispatchEvent('blur');
        sendLog(`PNJ: [Bước 6] ✅ Đã điền ngày sinh: ${birthdate}`, 'success');
      } else {
        // Fallback evaluate với nativeInputValueSetter trick
        const filled = await page.evaluate((b) => {
          const inp = document.querySelector('input[placeholder*="DD/MM/YYYY"]') ||
                      document.querySelector('input[name*="birthday"]');
          if (!inp) return false;
          try {
            const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
            if (setter) setter.call(inp, b);
            else inp.value = b;
          } catch { inp.value = b; }
          ['input', 'change', 'blur'].forEach(t => inp.dispatchEvent(new Event(t, { bubbles: true })));
          return true;
        }, birthdate);
        if (filled) sendLog(`PNJ: [Bước 6] ✅ Đã điền ngày sinh (evaluate): ${birthdate}`, 'success');
        else sendLog('PNJ: [Bước 6] Không tìm thấy ô ngày sinh, bỏ qua.', 'warning');
      }
    } catch (e) {
      sendLog(`PNJ: [Bước 6] Lỗi điền ngày sinh: ${e.message}`, "warning");
    }
  }

  await page.waitForTimeout(T.FORM_FIELD_AFTER);

  // ── Tick các điều khoản ──────────────────────────────────────────────────
  try {
    // Checkbox 1: Khuyến mãi
    if (payload.agreeMarketing) {
      const marketingCb = page.locator('label:has-text("Đồng ý nhận các thông tin và chương trình khuyến mãi")').first();
      if (await marketingCb.isVisible()) {
        const isChecked = await marketingCb.locator('input[type="checkbox"]').isChecked().catch(() => false);
        if (!isChecked) {
          await marketingCb.click();
          sendLog("PNJ: [Bước 6] ✅ Đã tick chọn Nhận thông tin khuyến mãi", "success");
        }
      }
    }
    
    // Checkbox 2: Xuất hoá đơn
    if (payload.agreeInvoice) {
      const invoiceCb = page.locator('label:has-text("Xuất hóa đơn công ty")').first();
      if (await invoiceCb.isVisible()) {
        const isChecked = await invoiceCb.locator('input[type="checkbox"]').isChecked().catch(() => false);
        if (!isChecked) {
          await invoiceCb.click();
          sendLog("PNJ: [Bước 6] ✅ Đã tick chọn Xuất hóa đơn công ty", "success");
        }
      }
    }

    // Checkbox 3: Điều khoản bảo mật (Bắt buộc — luôn tự động tick)
    // PNJ dùng MUI Checkbox: input bị ẩn → click vào span MUI cha.
    // ID xác định từ DevTools: input#checkboxMaterial
    // KHÔNG dùng "đồng ý" — checkbox khuyến mãi đầu cũng có chữ "Đồng ý"!
    let privacyTicked = false;

    // ── Cách 1: Playwright dùng ID cụ thể từ DevTools ──────────────────────
    // input#checkboxMaterial → lấy span MUI cha → click
    try {
      const privacyInput = page.locator('input#checkboxMaterial').first();
      if (await privacyInput.count() > 0) {
        const isChecked = await privacyInput.isChecked().catch(() => false);
        if (!isChecked) {
          // Click vào span MUI cha (không click input ẩn)
          await privacyInput.evaluate(inp => {
            const muiSpan = inp.closest('span[class*="MuiCheckbox"], span[class*="MuiButtonBase"], span[class*="PrivateSwitchBase"]')
                         || inp.closest('span')
                         || inp.parentElement;
            if (muiSpan) muiSpan.click();
            else inp.click();
          });
          await page.waitForTimeout(300);
        }
        privacyTicked = true;
        sendLog("PNJ: [Bước 6] ✅ Đã tick Điều khoản bảo mật (ID checkboxMaterial)", "success");
      }
    } catch (e) {
      sendLog(`PNJ: [Bước 6] Cách 1 lỗi: ${e.message}`, "info");
    }

    // ── Cách 2: Playwright locator label[for="checkboxMaterial"] ─────────────
    if (!privacyTicked) {
      try {
        const lbl = page.locator('label[for="checkboxMaterial"]').first();
        if (await lbl.isVisible({ timeout: 2000 })) {
          await lbl.scrollIntoViewIfNeeded();
          await page.waitForTimeout(200);
          await lbl.click({ force: true });
          await page.waitForTimeout(300);
          privacyTicked = true;
          sendLog("PNJ: [Bước 6] ✅ Đã tick Điều khoản bảo mật (label[for=checkboxMaterial])", "success");
        }
      } catch (e) {
        sendLog(`PNJ: [Bước 6] Cách 2 lỗi: ${e.message}`, "info");
      }
    }

    // ── Cách 3: Playwright label text chứa "pháp luật" (duy nhất cho privacy) ─
    if (!privacyTicked) {
      const privacySelectors = [
        'label:has-text("pháp luật")',
        'label:has-text("thu thập")',
        'label:has-text("Tôi đồng ý cho PNJ thu thập")',
        'label:has-text("Thông báo này")',
        '[class*="FormControlLabel"]:has-text("pháp luật")',
      ];
      for (const sel of privacySelectors) {
        try {
          const lbl = page.locator(sel).first();
          if (await lbl.isVisible({ timeout: 1000 })) {
            await lbl.scrollIntoViewIfNeeded();
            await page.waitForTimeout(150);
            // Click span MUI bên trong
            const muiSpan = lbl.locator('span.MuiCheckbox-root, span.MuiButtonBase-root, span[class*="Checkbox"]').first();
            if (await muiSpan.count() > 0) {
              await muiSpan.click({ force: true });
            } else {
              await lbl.click({ force: true });
            }
            await page.waitForTimeout(300);
            privacyTicked = true;
            sendLog(`PNJ: [Bước 6] ✅ Đã tick Điều khoản bảo mật (${sel})`, "success");
            break;
          }
        } catch { }
      }
    }

    // ── Cách 4: evaluate — tìm input theo text "pháp luật" / "thu thập" ──────
    // (KHÔNG dùng "đồng ý" — checkbox 1 cũng có!)
    if (!privacyTicked) {
      privacyTicked = await page.evaluate(() => {
        // Tìm theo ID cụ thể trước
        const byId = document.querySelector('input#checkboxMaterial');
        if (byId && !byId.checked) {
          const muiSpan = byId.closest('span[class*="Mui"], span[class*="Private"]') || byId.parentElement;
          if (muiSpan) { muiSpan.click(); return true; }
        }
        // Tìm theo text gần checkbox — chỉ các từ duy nhất của privacy
        const allInputs = Array.from(document.querySelectorAll('input[type="checkbox"]'));
        for (const inp of allInputs) {
          if (inp.checked) continue;
          // Lấy text từ label hoặc các phần tử anh chị em (siblings)
          const label = document.querySelector(`label[for="${inp.id}"]`);
          const labelText = (label?.textContent || '').toLowerCase();
          const parentText = (inp.closest('label')?.textContent || inp.closest('li, div')?.textContent || '').toLowerCase();
          const combinedText = labelText + ' ' + parentText;
          const isPrivacy =
            combinedText.includes('pháp luật') ||
            combinedText.includes('thu thập') ||
            combinedText.includes('thông báo này') ||
            inp.id === 'checkboxMaterial' ||
            inp.name?.toLowerCase().includes('privacy');
          if (!isPrivacy) continue;
          // Click span MUI cha
          const muiSpan = inp.closest('span[class*="Mui"], span[class*="Private"], span[class*="Checkbox"]') || inp.parentElement;
          if (muiSpan) { muiSpan.click(); return true; }
        }
        return false;
      });
      if (privacyTicked) sendLog("PNJ: [Bước 6] ✅ Đã tick Điều khoản bảo mật (evaluate ID/text)", "success");
    }

    // ── Cách 5 (nuclear): Dùng Playwright check() trực tiếp vào input ẩn ─────
    if (!privacyTicked) {
      try {
        const inp = page.locator('input#checkboxMaterial, input[name*="privacy"], input[name*="agree"]').first();
        if (await inp.count() > 0) {
          await inp.evaluate(el => {
            if (!el.checked) {
              // React synthetic event trick
              const nativeSet = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'checked')?.set;
              if (nativeSet) nativeSet.call(el, true);
              else el.checked = true;
              el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
              ['input', 'change'].forEach(t => el.dispatchEvent(new Event(t, { bubbles: true })));
            }
          });
          await page.waitForTimeout(300);
          privacyTicked = true;
          sendLog("PNJ: [Bước 6] ✅ Đã tick Điều khoản bảo mật (React event trick)", "success");
        }
      } catch (e) {
        sendLog(`PNJ: [Bước 6] Cách 5 lỗi: ${e.message}`, "info");
      }
    }

    if (!privacyTicked) {
      sendLog("PNJ: [Bước 6] ⚠️ Không tick được checkbox Điều khoản bảo mật — nhường AI.", "warning");
    }
  } catch (e) {
    sendLog(`PNJ: [Bước 6] Lỗi tick điều khoản: ${e.message}`, "warning");
  }

  await page.waitForTimeout(T.STEP_PAUSE);

  // ── Chọn Giới tính / Danh xưng (Anh / Chị) ───────────────────────────────
  // DevTools thực tế: input[name="gender-female"] value="female", input[name="gender-male"] value="male"
  // Mặc định tick "Anh" nếu không truyền gender
  {
    const gender = (payload.buyerGender || 'anh').toLowerCase().trim();
    // female = Chị, male = Anh
    const isChị = gender === 'chị' || gender === 'chi' || gender === 'female';
    const inputName = isChị ? 'gender-female' : 'gender-male';
    const labelText = isChị ? 'Chị' : 'Anh';

    let genderDone = false;

    // Cách 1: Playwright click label của radio button
    try {
      const lbl = page.locator(`label[for="${inputName}"]`).first();
      if (await lbl.isVisible({ timeout: 2000 })) {
        await lbl.click({ force: true });
        genderDone = true;
        sendLog(`PNJ: [Bước 6] ✅ Đã chọn danh xưng: "${labelText}" (label[for])`, "success");
      }
    } catch { }

    // Cách 2: Click trực tiếp vào input radio
    if (!genderDone) {
      try {
        const radio = page.locator(`input[name="${inputName}"]`).first();
        if (await radio.count() > 0) {
          await radio.evaluate(el => el.click());
          genderDone = true;
          sendLog(`PNJ: [Bước 6] ✅ Đã chọn danh xưng: "${labelText}" (radio click)`, "success");
        }
      } catch { }
    }

    // Cách 3: Playwright label text fallback
    if (!genderDone) {
      try {
        const lbl = page.locator(`label:has-text("${labelText}")`).first();
        if (await waitForVisible(lbl, 1500)) {
          await lbl.click({ force: true });
          genderDone = true;
          sendLog(`PNJ: [Bước 6] ✅ Đã chọn danh xưng: "${labelText}" (label text)`, "success");
        }
      } catch { }
    }

    if (!genderDone) {
      sendLog(`PNJ: [Bước 6] ⚠️ Không chọn được danh xưng "${labelText}" — nhường AI.`, "warning");
    }
  }

  await page.waitForTimeout(T.STEP_PAUSE);

  // ── Chọn Tỉnh/Thành (React Select) — dùng Playwright locator ────────────────
  if (payload.buyerProvince) {
    try {
      sendLog(`PNJ: [Bước 6] Chọn Tỉnh/Thành: "${payload.buyerProvince}"`, 'info');

      // Click vào control chứa hidden input[name="province"]
      // React Select render: div.control > input[type=text ẩn] + div.placeholder
      const provinceControl = page.locator('input[name="province"]').locator('..').locator('..').first();
      const altControl = page.locator('[class*="select"]').filter({ hasText: 'tỉnh' }).first();

      let opened = false;
      for (const ctrl of [provinceControl, altControl]) {
        try {
          if (await ctrl.isVisible({ timeout: 1500 })) {
            await ctrl.click();
            opened = true;
            break;
          }
        } catch { }
      }

      if (!opened) {
        await page.evaluate(() => {
          const all = Array.from(document.querySelectorAll('*'));
          const el = all.find(e => e.children.length < 5 && (e.textContent || '').trim() === 'Chọn tỉnh/thành');
          if (el) el.click();
        });
        opened = true;
      }

      if (opened) {
        await page.waitForTimeout(600);
        const keyword = payload.buyerProvince
          .replace(/^THÀNH PHỐ /i, '')
          .replace(/^TỈNH /i, '')
          .trim()
          .slice(0, 10);
        await page.keyboard.type(keyword, { delay: 60 });
        await page.waitForTimeout(800);
        const opt = page.locator('[class*="option"]:visible').first();
        if (await opt.count() > 0) {
          await opt.click();
          sendLog(`PNJ: [Bước 6] ✅ Đã chọn Tỉnh/Thành: ${payload.buyerProvince}`, 'success');
        } else {
          await page.keyboard.press('Enter');
          sendLog(`PNJ: [Bước 6] ✅ Đã chọn Tỉnh/Thành (Enter): ${payload.buyerProvince}`, 'success');
        }
      } else {
        sendLog('PNJ: [Bước 6] Không tìm thấy dropdown Tỉnh/Thành, bỏ qua.', 'warning');
      }
    } catch (e) {
      sendLog(`PNJ: [Bước 6] Lỗi chọn Tỉnh/Thành: ${e.message}`, 'warning');
    }
  }

  await page.waitForTimeout(T.STEP_PAUSE);

  if (payload.buyerWard) {
    try {
      sendLog(`PNJ: [Bước 6] Chọn Phường/Xã: "${payload.buyerWard}"`, 'info');
      await page.waitForTimeout(1000);

      const wardControl = page.locator('input[name="ward"]').locator('..').locator('..').first();
      const altWardCtrl = page.locator('[class*="select"]').filter({ hasText: /phường|xã/i }).first();

      let wOpened = false;
      for (const ctrl of [wardControl, altWardCtrl]) {
        try {
          if (await ctrl.isVisible({ timeout: 1500 })) {
            await ctrl.click();
            wOpened = true;
            break;
          }
        } catch { }
      }

      if (!wOpened) {
        await page.evaluate(() => {
          const all = Array.from(document.querySelectorAll('*'));
          const el = all.find(e => e.children.length < 5 && /phường\/xã|chọn phường/i.test((e.textContent || '').trim()));
          if (el) el.click();
        });
        wOpened = true;
      }

      if (wOpened) {
        await page.waitForTimeout(600);
        const wardKeyword = payload.buyerWard
          .replace(/^PHƯỜNG /i, '')
          .replace(/^XÃ /i, '')
          .replace(/^THỊ TRẤN /i, '')
          .trim()
          .slice(0, 10);
        await page.keyboard.type(wardKeyword, { delay: 60 });
        await page.waitForTimeout(800);
        const wOpt = page.locator('[class*="option"]:visible').first();
        if (await wOpt.count() > 0) {
          await wOpt.click();
          sendLog(`PNJ: [Bước 6] ✅ Đã chọn Phường/Xã: ${payload.buyerWard}`, 'success');
        } else {
          await page.keyboard.press('Enter');
          sendLog(`PNJ: [Bước 6] ✅ Đã chọn Phường/Xã (Enter): ${payload.buyerWard}`, 'success');
        }
      } else {
        sendLog('PNJ: [Bước 6] Không tìm thấy dropdown Phường/Xã, bỏ qua.', 'warning');
      }
    } catch (e) {
      sendLog(`PNJ: [Bước 6] Lỗi chọn Phường/Xã: ${e.message}`, 'warning');
    }
  }

  await page.waitForTimeout(T.STEP_PAUSE);

  // Nhập địa chỉ chi tiết
  const fullAddress = payload.buyerAddress || '';
  if (fullAddress) {
    try {
      const addressInp = page.locator('input[placeholder*="Nhập địa chỉ"], input[placeholder*="địa chỉ"]').first();
      if (await waitForVisible(addressInp, 2000)) {
        await addressInp.scrollIntoViewIfNeeded();
        await addressInp.click({ clickCount: 3 });
        await addressInp.type(fullAddress, { delay: T.KEY_TYPE_DELAY });
        sendLog(`PNJ: [Bước 6] ✅ Đã điền địa chỉ chi tiết: ${fullAddress}`, "success");
      } else {
        await page.evaluate((addr) => {
          const inp = document.querySelector('input[placeholder*="địa chỉ"]') || document.querySelector('input[name*="address"]');
          if (inp) {
            inp.focus();
            inp.value = addr;
            ['input', 'change'].forEach(evt => inp.dispatchEvent(new Event(evt, { bubbles: true })));
          }
        }, fullAddress);
        sendLog(`PNJ: [Bước 6] ✅ Đã điền địa chỉ chi tiết (evaluate): ${fullAddress}`, "success");
      }
    } catch (e) {
      sendLog(`PNJ: [Bước 6] Lỗi nhập địa chỉ: ${e.message}`, "warning");
    }
  }

  await page.waitForTimeout(T.STEP_PAUSE);

  // ── Chọn Phương thức thanh toán ───────────────────────────────────────────
  const rawPayment = (payload.paymentMethod || payload.buyerPayment || '').toLowerCase();
  if (rawPayment) {
    try {
      // Dùng img[alt] direct-child (>) để match CHÍNH XÁC payment item div
      // không match outer wrapper vì img là direct child của payment-item div
      const PAYMENT_SELECTORS = {
        qr:       ['div:has(> img[alt="PAYOO_QRCODE"])', 'div:has-text("Quét mã QR"):has(img)'],
        card:     ['div:has(> img[alt="PAYOO_CC"])',     'div:has-text("Thẻ quốc tế"):has(img)'],
        cod:      ['div:has(> img[alt="COD"])',          'div:has-text("tiền mặt khi nhận"):has(img)'],
        transfer: ['div:has(> img[alt="BANK_TRANS"])',   'div:has-text("chuyển khoản"):has(img)'],
      };
      let matchKey = rawPayment;
      if (rawPayment === 'qr' || rawPayment.includes('payoo_qrcode')) matchKey = 'qr';
      else if (rawPayment === 'card' || rawPayment.includes('payoo_cc')) matchKey = 'card';
      else if (rawPayment === 'cod') matchKey = 'cod';
      else if (rawPayment === 'transfer' || rawPayment.includes('bank_trans')) matchKey = 'transfer';

      const selectors = PAYMENT_SELECTORS[matchKey] || [];

      await page.evaluate(() => window.scrollBy(0, 500));
      await page.waitForTimeout(600);

      let paymentDone = false;
      for (const sel of selectors) {
        if (paymentDone) break;
        try {
          const count = await page.locator(sel).count();
          if (count === 0) continue;
          const el = page.locator(sel).first();
          await el.scrollIntoViewIfNeeded();
          await page.waitForTimeout(200);
          await el.click({ force: true });
          await page.waitForTimeout(500);
          paymentDone = true;
          sendLog(`PNJ: [Bước 6] ✅ Đã chọn thanh toán: ${matchKey} ("${sel}")`, 'success');
        } catch (_) { /* thử selector tiếp theo */ }
      }

      if (!paymentDone) {
        sendLog(`PNJ: [Bước 6] ⚠️ Không tìm thấy phương thức "${matchKey}" — nhường AI.`, 'warning');
      }

      // Dọn route intercept
      try { await page.unroute('**/get-list-payment**'); } catch (_) {}
    } catch (e) {
      sendLog(`PNJ: [Bước 6] Lỗi chọn phương thức thanh toán: ${e.message}`, 'warning');
    }
  }

  await page.waitForTimeout(T.FORM_FIELD_AFTER);

  // ── Điền Ghi chú đơn hàng ─────────────────────────────────────────────────
  // PNJ: textarea placeholder "Vui lòng ghi chú thêm để PNJ có thể hỗ trợ tốt nhất cho Quý khách!"
  const buyerNote = (payload.buyerNote || '').trim();
  if (buyerNote) {
    try {
      const noteSelectors = [
        'textarea[placeholder*="ghi chú"]',
        'textarea[placeholder*="Ghi chú"]',
        'textarea[placeholder*="Quý khách"]',
        'textarea[placeholder*="hỗ trợ"]',
        'textarea[name*="note"]',
        'textarea[name*="comment"]',
        'textarea[name*="ghi"]',
      ];

      let filledNote = false;
      for (const sel of noteSelectors) {
        try {
          const ta = page.locator(sel).first();
          if (await waitForVisible(ta, 1500)) {
            await ta.scrollIntoViewIfNeeded();
            await ta.click({ clickCount: 3 });
            await ta.fill('');
            await ta.type(buyerNote, { delay: T.KEY_TYPE_DELAY });
            sendLog(`PNJ: [Bước 6] ✅ Đã điền ghi chú: "${buyerNote.slice(0, 40)}..."`, "success");
            filledNote = true;
            break;
          }
        } catch { }
      }

      // Fallback evaluate
      if (!filledNote) {
        filledNote = await page.evaluate((note) => {
          const candidates = Array.from(document.querySelectorAll('textarea'));
          for (const ta of candidates) {
            const ph = (ta.placeholder || '').toLowerCase();
            const rect = ta.getBoundingClientRect();
            if (rect.width > 0 && (ph.includes('ghi chú') || ph.includes('quý khách') || ph.includes('hỗ trợ') || ph.includes('note'))) {
              ta.focus();
              const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
              if (nativeSetter) nativeSetter.call(ta, note);
              else ta.value = note;
              ['input', 'change'].forEach(t => ta.dispatchEvent(new Event(t, { bubbles: true })));
              return true;
            }
          }
          return false;
        }, buyerNote);
        if (filledNote) sendLog(`PNJ: [Bước 6] ✅ Đã điền ghi chú (evaluate): "${buyerNote.slice(0, 40)}"`, "success");
        else sendLog("PNJ: [Bước 6] ⚠️ Không tìm thấy ô ghi chú, bỏ qua.", "warning");
      }
    } catch (e) {
      sendLog(`PNJ: [Bước 6] Lỗi điền ghi chú: ${e.message}`, "warning");
    }
  }

  await page.waitForTimeout(T.FORM_FIELD_AFTER);
  sendLog("PNJ: [Bước 6] Hoàn tất điền thông tin. Nhường AI DOM xử lý tiếp.", "success");
  return true;
}

/**
 * Entry point của playbook PNJ.
 * payload.category và payload.size đến từ seed-catalog.ts (pnjCategory / pnjSize)
 * qua UI → WebSocket → server.js → đây.
 */
async function run(page, payload, sendLog, sendStatus) {
  sendLog("💍 PNJ Playbook: Bắt đầu...", "success");
  sendLog(`PNJ: Sản phẩm: "${payload.productName}" | size: "${payload.size || '(bỏ qua)'}"`, "info");

  const url = (payload.url || '').trim();

  // Nếu có URL sản phẩm trực tiếp → vào thẳng, bỏ qua search
  // URL sản phẩm trực tiếp: có pnj.com.vn, có /san-pham/ trong path (slug), không phải URL search ?q=
  const isDirectProductUrl =
    url.includes('pnj.com.vn') &&
    url.includes('/san-pham/') &&       // path chứa /san-pham/ = URL sản phẩm
    !url.includes('?');                 // không có query string = không phải search

  if (isDirectProductUrl) {
    sendLog(`PNJ: Vào thẳng URL sản phẩm: ${url}`, "info");
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });
    await page.waitForTimeout(T.PAGE_AFTER_LOAD);
    await dismissPopupsQuick(page, sendLog);
    sendLog("PNJ: ✅ Đã vào trang sản phẩm.", "success");
  } else {
    // Không có URL trực tiếp → vào trang chủ rồi tìm kiếm
    sendLog("PNJ: Không có URL trực tiếp → vào trang chủ tìm kiếm.", "info");
    await gotoHomepage(page, sendLog);
    await dismissPopups(page, sendLog);
    await page.waitForTimeout(T.FORM_FIELD_AFTER);

    const found = await searchProductQuick(page, payload.productName, sendLog);
    if (!found) {
      sendLog("PNJ: Không tìm được sản phẩm. Nhường AI.", "warning");
      return { done: false };
    }
  }

  await dismissPopups(page, sendLog);
  await page.waitForTimeout(T.FORM_FIELD_AFTER);

  await selectSize(page, payload, sendLog);
  await addToCart(page, sendLog);
  await goToCartAndProceed(page, sendLog);
  await fillCheckoutInfo(page, payload, sendLog);

  // ── Bước 7: Nhấn ĐẶT HÀNG ────────────────────────────────────────────────
  // Đọc chế độ thật/demo từ payload hoặc biến môi trường
  var isRealOrder = payload.isRealOrder === true || process.env.DEMO_ORDER_PNJ === 'true';

  sendLog('PNJ: [Bước 7] Tìm và click nút "ĐẶT HÀNG"...', 'info');
  try {
    var orderBtnSelectors = [
      'button:has-text("ĐẶT HÀNG")',
      'button:has-text("Đặt hàng")',
      'button[type="submit"]:visible',
    ];
    var orderClicked = false;
    for (var si = 0; si < orderBtnSelectors.length; si++) {
      try {
        var obtn = page.locator(orderBtnSelectors[si]).first();
        if (await obtn.isVisible({ timeout: 3000 })) {
          await obtn.scrollIntoViewIfNeeded();
          await obtn.click();
          orderClicked = true;
          sendLog('PNJ: [Bước 7] ✅ Đã click nút ĐẶT HÀNG', 'success');
          break;
        }
      } catch (_) {}
    }
    if (!orderClicked) {
      sendLog('PNJ: [Bước 7] ⚠️ Không tìm thấy nút ĐẶT HÀNG.', 'warning');
    }

    if (orderClicked) {
      // Chờ popup đăng nhập xuất hiện
      await page.waitForTimeout(1800);

      if (isRealOrder) {
        // ── Chế độ REAL: Click "Tiếp tục Đặt hàng không cần đăng nhập" ──────
        sendLog('PNJ: [Bước 7] Chế độ REAL — click "Tiếp tục không cần đăng nhập"...', 'info');
        var guestSelectors = [
          'button:has-text("không cần đăng nhập")',
          'button:has-text("Tiếp tục Đặt hàng")',
          'button:has-text("Đặt hàng không cần")',
          ':text("Tiếp tục Đặt hàng không cần đăng nhập")',
        ];
        var guestClicked = false;
        for (var gi = 0; gi < guestSelectors.length; gi++) {
          try {
            var gbtn = page.locator(guestSelectors[gi]).first();
            if (await gbtn.isVisible({ timeout: 3000 })) {
              await gbtn.scrollIntoViewIfNeeded();
              await gbtn.click({ force: true });
              guestClicked = true;
              sendLog('PNJ: [Bước 7] ✅ Đã click "Tiếp tục Đặt hàng không cần đăng nhập"', 'success');
              break;
            }
          } catch (_) {}
        }
        if (!guestClicked) {
          sendLog('PNJ: [Bước 7] ⚠️ Không tìm thấy nút guest checkout — có thể popup chưa mở.', 'warning');
        }
      } else {
        // ── Chế độ DEMO: Không click, điều hướng đến Payoo demo ──────────────
        sendLog('PNJ: [Bước 7] Chế độ DEMO — bỏ qua popup, chuyển đến Payoo demo.', 'info');
        var demoUrl = 'https://payoo.vn/v2/paynow/detail?_token=4HlDeADuMZU&method_tab=qr-pay';
        await page.goto(demoUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
        sendLog('PNJ: [Bước 7] ✅ Đã chuyển đến Payoo demo: ' + demoUrl, 'success');
      }
    }
  } catch (placeErr) {
    sendLog('PNJ: [Bước 7] Lỗi: ' + placeErr.message, 'warning');
  }

  // ── Bước 8: Detect thất bại + Lấy QR từ Payoo ────────────────────────────
  sendLog('PNJ: [Bước 8] Đọc URL Payoo và lấy QR...', 'info');
  try {
    // ── 8.1: Bắt browser alert/dialog (Hình 1: timeout Payoo) ──────────────
    var paymentFailed = false;
    var failReason = '';
    page.once('dialog', async function(dialog) {
      var dmsg = dialog.message();
      sendLog('PNJ: [Bước 8] Browser dialog: ' + dmsg, 'warning');
      // Payoo timeout: "Thao tác của bạn vượt quá thời gian quy định..."
      if (/th.i gian|vư.t qu.|h.t h.n|quy đ.nh/i.test(dmsg)) {
        paymentFailed = true;
        failReason = dmsg;
      }
      try { await dialog.accept(); } catch (_) {}
    });

    // ── 8.0: Chờ trang navigate đến Payoo (real mode redirect chậm) ───────────
    if (!page.url().includes('payoo.vn')) {
      sendLog('PNJ: [Bước 8] Chưa ở Payoo — đợi redirect (tối đa 20s)...', 'info');
      try {
        await page.waitForURL('**payoo**', { timeout: 20000 });
        sendLog('PNJ: [Bước 8] ✅ Đã redirect đến Payoo.', 'success');
      } catch (_) {
        sendLog('PNJ: [Bước 8] ⚠️ Timeout 20s — dùng URL hiện tại: ' + page.url(), 'warning');
      }
    }

    // Lấy URL hiện tại (cả real lẫn demo đều đã ở trang Payoo)
    var payooUrl = page.url();
    sendLog('PNJ: [Bước 8] Payoo URL: ' + payooUrl, 'info');

    // Chờ trang load + dialog có thể xuất hiện
    await page.waitForTimeout(2500);

    // ── 8.2: Detect modal "THÔNG BÁO" (Hình 2: Payoo xác nhận thanh toán) ──
    if (!paymentFailed) {
      var noticeSelectors = [
        'button:has-text("Chưa hoàn tất")',
        'button:has-text("Chưa hoàn tất & tiếp tục")',
        '#myModalLabel',
      ];
      for (var ni = 0; ni < noticeSelectors.length; ni++) {
        try {
          var nel = page.locator(noticeSelectors[ni]).first();
          if (await nel.count() > 0) {
            var txt = '';
            try { txt = await nel.textContent() || ''; } catch (_) {}
            if (noticeSelectors[ni] === '#myModalLabel') {
              // Chỉ coi là lỗi nếu modal header là "thông báo"
              if (!/th.ng b.o/i.test(txt)) continue;
            }
            paymentFailed = true;
            failReason = 'Payoo hiện thông báo: "' + txt.trim() + '"';
            sendLog('PNJ: [Bước 8] ⚠️ Phát hiện modal THÔNG BÁO Payoo — thanh toán thất bại.', 'warning');
            break;
          }
        } catch (_) {}
      }
    }

    // ── Nếu thất bại → gửi về UI và thoát ────────────────────────────────
    if (paymentFailed) {
      sendLog('PNJ: [Bước 8] ❌ Thanh toán thất bại: ' + failReason, 'error');
      if (typeof sendStatus === 'function') {
        sendStatus('pnj_payment_failed', {
          reason: failReason || 'Payoo báo lỗi',
          payooUrl: payooUrl,
        });
      }
      sendLog('PNJ Playbook: Hoàn tất (thất bại). Vui lòng thử lại.', 'warning');
      if (typeof sendStatus === 'function') {
        sendStatus('waiting_user_input', { pauseReason: 'failed', reason: failReason });
      }
      return { done: false };
    }

    // Trích token từ query string: ?_token=mGu7etiPMXw&...
    var payooToken = null;
    try {
      var urlObj = new URL(payooUrl);
      payooToken = urlObj.searchParams.get('_token');
    } catch (_) {}

    var qrImageUrl = null;

    if (payooToken) {
      sendLog('PNJ: [Bước 8] Token: ' + payooToken, 'info');
      var qrApiUrl = 'https://payoo.vn/v2/qr/image?_id=' + payooToken + '&standard=0&level=L';
      sendLog('PNJ: [Bước 8] QR URL: ' + qrApiUrl, 'info');

      // Fetch QR image qua Playwright (browser context → no CORS) → base64
      try {
        var response = await page.request.get(qrApiUrl, { timeout: 8000 });
        if (response.ok()) {
          var imgBuf = await response.body();
          var contentType = response.headers()['content-type'] || 'image/png';
          qrImageUrl = 'data:' + contentType.split(';')[0] + ';base64,' + imgBuf.toString('base64');
          sendLog('PNJ: [Bước 8] ✅ Lấy QR từ API thành công (' + imgBuf.length + ' bytes).', 'success');
        } else {
          sendLog('PNJ: [Bước 8] ⚠️ API QR trả ' + response.status() + ', thử navigate...', 'warning');
        }
      } catch (fetchErr) {
        sendLog('PNJ: [Bước 8] Lỗi fetch QR: ' + fetchErr.message, 'warning');
      }
    } else {
      sendLog('PNJ: [Bước 8] ⚠️ Không tìm thấy _token trong URL: ' + payooUrl, 'warning');
    }

    // Fallback: navigate đến Payoo page và screenshot QR element
    if (!qrImageUrl) {
      sendLog('PNJ: [Bước 8] Fallback: screenshot QR element trên trang...', 'warning');
      try {
        await page.waitForLoadState('domcontentloaded', { timeout: 6000 });
      } catch (_) {}
      await page.waitForTimeout(2000);

      var fallbackSelectors = [
        'img[class*="qr-iframe"]', 'img[class*="qr"]',
        '.dv-qr-iframe img', '.qr-info img', '.qr-unit img',
        'img[src*="img2.payoo"]', 'img[src*="qr"]',
      ];
      for (var fi = 0; fi < fallbackSelectors.length; fi++) {
        try {
          var fel = page.locator(fallbackSelectors[fi]).first();
          if (await fel.count() > 0) {
            var fbuf = await fel.screenshot({ type: 'png' });
            qrImageUrl = 'data:image/png;base64,' + fbuf.toString('base64');
            sendLog('PNJ: [Bước 8] ✅ Screenshot fallback: ' + fallbackSelectors[fi], 'success');
            break;
          }
        } catch (_) {}
      }
    }

    // Gửi QR + payooUrl + qrApiUrl về UI
    var finalQrApiUrl = (typeof qrApiUrl !== 'undefined') ? qrApiUrl : null;
    if (typeof sendStatus === 'function') {
      sendStatus('pnj_qr_ready', {
        qrImageUrl: qrImageUrl,
        payooUrl: payooUrl,
        qrApiUrl: finalQrApiUrl,
      });
    }
    sendLog(
      qrImageUrl
        ? 'PNJ: [Bước 8] ✅ Đã gửi QR về modal — quét mã để thanh toán.'
        : 'PNJ: [Bước 8] ⚠️ Không lấy được QR — mở link Payoo thủ công.',
      qrImageUrl ? 'success' : 'warning'
    );

  } catch (step8Err) {
    sendLog('PNJ: [Bước 8] Lỗi: ' + step8Err.message, 'warning');
    if (typeof sendStatus === 'function') {
      sendStatus('pnj_qr_ready', { qrImageUrl: null, payooUrl: page.url(), qrApiUrl: null });
    }
  }


  sendLog("PNJ Playbook: Hoàn tất. Bạn có thể tự thao tác để hoàn tất thanh toán.", "success");
  if (typeof sendStatus === 'function') {
    sendStatus("waiting_user_input", {
      pauseReason: "review",
      reason: isRealOrder
        ? "Đã bấm Đặt hàng. Kiểm tra kết quả trên màn hình."
        : "Chế độ Demo: Đang hiển thị Payoo QR demo. Đặt hàng thật bằng cách tick \"Đặt hàng thật\".",
    });
  }
  return { done: true };
}



module.exports = { run };
