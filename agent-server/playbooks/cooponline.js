const { createHash, randomBytes } = require("node:crypto");

/**
 * Playbook for cooponline.vn (Co.opmart Online)
 * Xử lý các bước đặc thù của trang cooponline.vn:
 * 1. Popup chọn địa chỉ giao hàng (bắt buộc, không thể đóng)
 * 2. Tìm kiếm sản phẩm + thêm vào giỏ
 * 3. Checkout + điền thông tin người mua
 *
 * Trả về:
 * - { done: true }  : playbook đã hoàn thành toàn bộ, không cần AI tiếp
 * - { done: false } : đã xử lý bootstrap xong, nhường lại cho AI tiếp
 */

const {
  safeGoto,
  clickFirstVisible,
  fillFirstVisible,
  notifyWaitingForUser,
  waitForSuccessUrl,
} = require("./css-helpers");

const CHECKOUT_SELECTORS = [
  'button:has-text("Thanh toán")',
  'button:has-text("Tiến hành thanh toán")',
  'button:has-text("Đặt hàng")',
  'a:has-text("Thanh toán")',
  'a[href*="checkout"]',
  'button[class*="checkout"]',
];

const NAME_SELECTORS = [
  'input[name="fullName"]',
  'input[name*="name"]',
  'input[placeholder*="họ tên" i]',
  'input[placeholder*="người nhận" i]',
];

const PHONE_SELECTORS = [
  'input[name="phone"]',
  'input[name*="phone"]',
  'input[name*="mobile"]',
  'input[placeholder*="điện thoại" i]',
  'input[placeholder*="số điện thoại" i]',
];

const ADDRESS_SELECTORS = [
  'textarea[name*="address"]',
  'input[name*="address"]',
  'input#address',
  'input[placeholder*="địa chỉ" i]',
  'input[placeholder*="số nhà" i]',
];

const SUCCESS_URL_KEYWORDS = ["thank-you", "success", "don-hang", "checkout/complete", "cooponline.vn/account/orders"];

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "d")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeProvinceName(value) {
  const normalized = normalizeText(value);
  if (
    normalized === "tphcm" ||
    normalized === "tp.hcm" ||
    normalized === "tp hcm" ||
    normalized.includes("ho chi minh")
  ) {
    return "Thành phố Hồ Chí Minh";
  }
  return value;
}

function inferDistrictFromWard(ward) {
  const normalized = normalizeText(ward);
  if (normalized.includes("tan son hoa")) return "Quận Tân Bình";
  if (normalized === "phuong 2" || normalized === "p 2") return "Quận Tân Bình";
  return "";
}

function normalizeWardName(value) {
  const normalized = normalizeText(value);
  if (normalized.includes("tan son hoa")) return "Phường 2";
  return value;
}

function looksLikeWard(value) {
  const normalized = normalizeText(value);
  return normalized.startsWith("phuong ") || normalized.startsWith("xa ") || normalized.startsWith("thi tran ");
}

function looksLikeDistrict(value) {
  const normalized = normalizeText(value);
  return normalized.startsWith("quan ") || normalized.startsWith("huyen ") || normalized.startsWith("tp ") || normalized.startsWith("thanh pho ");
}

/**
 * Phân tích địa chỉ đầy đủ thành các thành phần riêng biệt.
 * Ví dụ: "123 Nguyễn Huệ, Phường Bến Nghé, Quận 1, TP. Hồ Chí Minh"
 * → { street: "123 Nguyễn Huệ", ward: "Phường Bến Nghé", district: "Quận 1", province: "Thành phố Hồ Chí Minh" }
 */
function parseAddress(fullAddress) {
  const parts = String(fullAddress || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) return { street: "", ward: "", district: "", province: "" };

  const province = normalizeProvinceName(parts.at(-1) || "");
  let district = parts.length >= 4 ? parts.at(-2) || "" : "";
  let ward = "";
  let street = "";

  if (parts.length >= 4) {
    ward = normalizeWardName(parts.at(-3) || "");
    street = parts.slice(0, -3).join(", ") || parts[0] || "";
  } else if (parts.length === 3) {
    const middle = parts[1] || "";
    if (looksLikeWard(middle)) {
      ward = normalizeWardName(middle);
      district = inferDistrictFromWard(ward);
      street = parts[0] || "";
    } else if (looksLikeDistrict(middle)) {
      district = middle;
      street = parts[0] || "";
    } else {
      street = parts[0] || "";
      ward = normalizeWardName(middle);
    }
  } else if (parts.length === 2) {
    street = parts[0] || "";
  } else {
    street = parts[0] || "";
  }

  return { street, ward, district, province };
}

async function hasAddressInput(page, placeholders) {
  const list = Array.isArray(placeholders) ? placeholders : [placeholders];
  for (const placeholder of list) {
    const exact = page.locator(`input[placeholder="${placeholder}"]`).first();
    if (await exact.isVisible({ timeout: 300 }).catch(() => false)) return true;
    const partial = page.locator(`input[placeholder*="${placeholder}" i]`).first();
    if (await partial.isVisible({ timeout: 300 }).catch(() => false)) return true;
  }
  return false;
}

function buildStreetDetail(addr, hasWardField) {
  if (hasWardField || !addr.ward) return addr.street;
  return [addr.street, addr.ward].filter(Boolean).join(", ");
}

function getPayloadAddressParts(payload) {
  const fallbackAddress = String(payload.address || payload.browserSession?.address || payload.fullAddress || "").trim();
  const parsed = parseAddress(fallbackAddress);
  return {
    street: String(payload.addressLine || payload.streetAddress || parsed.street || "").trim(),
    province: String(payload.provinceName || payload.browserSession?.provinceName || parsed.province || "").trim(),
    district: String(payload.districtName || payload.browserSession?.districtName || parsed.district || "").trim(),
    ward: String(payload.wardName || payload.browserSession?.wardName || parsed.ward || "").trim(),
  };
}

function base64Url(buffer) {
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function buildCoopAuthorizeUrl() {
  const verifier = base64Url(randomBytes(48));
  const challenge = base64Url(createHash("sha256").update(verifier).digest());
  const url = new URL("https://oauth-saigoncoop.oauth.teko.vn/oauth/authorize");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", "a58f641112ee4d198dc6db4d90bc5cfa");
  url.searchParams.set("redirect_uri", "https://cooponline.vn/kirin-brand.kirin");
  url.searchParams.set("scope", "openid profile us om ppm loyalty-consumer-bff payment-consumer-bff staff-bff");
  url.searchParams.set("state", base64Url(randomBytes(24)));
  url.searchParams.set("nonce", base64Url(randomBytes(24)));
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

/**
 * Chờ phần tử xuất hiện và hiển thị trong khoảng thời gian timeout.
 * Trả về true nếu hiển thị, false nếu timeout hoặc lỗi.
 */
async function waitForVisible(locator, timeoutMs = 5000) {
  try {
    await locator.waitFor({ state: "visible", timeout: timeoutMs });
    return true;
  } catch {
    return false;
  }
}

/**
 * Lấy danh sách tất cả phần tử tương tác trong modal (trừ checkbox/radio).
 * Dùng để debug và xác định selector chính xác.
 */
async function dumpModalElements(page, sendLog) {
  const elements = await page.evaluate(() => {
    const modal = document.querySelector(".teko-modal-show") ||
      document.querySelector('[class*="teko-modal"]') ||
      document.querySelector(".modal.show");
    if (!modal) return [];
    const result = [];
    const nodes = modal.querySelectorAll('button, input, select, [role="combobox"], [role="button"], [role="listbox"], div[tabindex], span[tabindex]');
    for (const el of nodes) {
      const rect = el.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) continue;
      result.push({
        tag: el.tagName.toLowerCase(),
        type: el.getAttribute("type") || "",
        role: el.getAttribute("role") || "",
        class: (el.className || "").toString().trim().slice(0, 80),
        text: (el.textContent || "").trim().slice(0, 50),
        placeholder: el.getAttribute("placeholder") || "",
        ariaLabel: el.getAttribute("aria-label") || "",
      });
    }
    return result;
  });
  sendLog(`Co.opmart DOM modal dump (${elements.length} elements):`);
  for (const el of elements.slice(0, 20)) {
    sendLog(`  [${el.tag}] type="${el.type}" role="${el.role}" class="${el.class.slice(0, 60)}" text="${el.text.slice(0, 30)}" ph="${el.placeholder}"`);
  }
  return elements;
}

/**
 * Điền vào ô autocomplete địa chỉ Teko UI.
 * Luồng: click input → gõ → chờ dropdown (id=provinceCode/districtCode/wardCode) → click item đầu tiên.
 * @param {string} inputPlaceholder - placeholder của input cần điền
 * @param {string} dropdownId       - id của container chứa kết quả dropdown (provinceCode, districtCode, wardCode)
 * @param {string} valueText        - giá trị cần tìm (vd: "Thành phố Hồ Chí Minh")
 */
async function fillAddressAutocomplete(page, sendLog, inputPlaceholder, dropdownId, valueText) {
  if (!valueText) return false;

  const inputPlaceholders = Array.isArray(inputPlaceholder) ? inputPlaceholder : [inputPlaceholder];

  try {
    let input = null;
    for (const placeholder of inputPlaceholders) {
      const exact = page.locator(`input[placeholder="${placeholder}"]`).first();
      if (await waitForVisible(exact, 600)) {
        input = exact;
        break;
      }
      const partial = page.locator(`input[placeholder*="${placeholder}" i]`).first();
      if (await waitForVisible(partial, 600)) {
        input = partial;
        break;
      }
    }
    if (!input) {
      const markedByLabel = await page.evaluate((labels) => {
        const normalize = (value) => String(value || "")
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .replace(/đ/g, "d")
          .replace(/Đ/g, "d")
          .toLowerCase()
          .replace(/\s+/g, " ")
          .trim();
        const targets = labels.map(normalize).filter(Boolean);
        const visible = (el) => {
          if (!el) return false;
          const rect = el.getBoundingClientRect();
          const style = window.getComputedStyle(el);
          return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
        };
        document.querySelectorAll("[data-coop-autocomplete-input]").forEach((el) => el.removeAttribute("data-coop-autocomplete-input"));
        const modal = Array.from(document.querySelectorAll(".teko-modal-show, [class*='teko-modal'], [role='dialog'], body"))
          .filter(visible)
          .sort((a, b) => {
            const ar = a.getBoundingClientRect();
            const br = b.getBoundingClientRect();
            return (ar.width * ar.height) - (br.width * br.height);
          })[0] || document;
        const labelsEls = Array.from(modal.querySelectorAll("label, div, span, p"))
          .filter((el) => visible(el) && targets.some((target) => normalize(el.textContent).includes(target)));
        const inputs = Array.from(modal.querySelectorAll("input, [role='combobox'], [class*='select']"))
          .filter((el) => visible(el) && !el.disabled);
        for (const label of labelsEls) {
          const lr = label.getBoundingClientRect();
          const ranked = inputs
            .map((el) => {
              const rect = el.getBoundingClientRect();
              const sameColumn = Math.abs(rect.left - lr.left) < 90 || (rect.left >= lr.left - 20 && rect.left <= lr.right + 260);
              const below = rect.top >= lr.bottom - 8 && rect.top <= lr.bottom + 95;
              const distance = Math.abs(rect.top - lr.bottom) + Math.abs(rect.left - lr.left) / 4;
              return { el, ok: sameColumn && below, distance };
            })
            .filter((item) => item.ok)
            .sort((a, b) => a.distance - b.distance);
          const target = ranked[0]?.el;
          if (target) {
            target.setAttribute("data-coop-autocomplete-input", "true");
            return true;
          }
        }
        return false;
      }, inputPlaceholders);
      if (markedByLabel) {
        input = page.locator('[data-coop-autocomplete-input="true"]').first();
      } else {
        const labelText = inputPlaceholders.join(" / ");
        sendLog(`Co.opmart: Không thấy input "${labelText}".`, "warning");
        return false;
      }
    }
    if (!(await waitForVisible(input, 3000))) {
      sendLog(`Co.opmart: Không thấy input "${inputPlaceholders.join(" / ")}".`, "warning");
      return false;
    }

    const enabled = await input.isEnabled().catch(() => false);
    if (!enabled) {
      sendLog(`Co.opmart: Input "${inputPlaceholders.join(" / ")}" đang bị khóa.`, "warning");
      return false;
    }

    // Click vào input, xóa nội dung cũ và gõ giá trị mới từng ký tự
    await input.click({ timeout: 2500, force: true });
    await page.waitForTimeout(200);
    await input.fill("").catch(async () => {
      await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A").catch(() => null);
      await page.keyboard.press("Backspace").catch(() => null);
    });
    await input.type(valueText, { delay: 60 }).catch(async () => {
      await page.keyboard.type(valueText, { delay: 60 });
    });
    await page.waitForTimeout(900); // Chờ autocomplete render

    // Thực hiện tìm kiếm và gán cờ phần tử khớp nhất bên trong dropdown bằng page.evaluate
    const marked = await page.evaluate(({ dropdownId, valueText }) => {
      const container = document.getElementById(dropdownId);
      if (!container) return { success: false, reason: `Container #${dropdownId} không tìm thấy` };

      // Hàm so sánh text hỗ trợ chuẩn hóa số (ví dụ: "Phường 2" khớp với "Phường 02")
      function matchOptionText(optionText, targetText) {
        const normOption = optionText.toLowerCase().replace(/\s+/g, ' ').trim();
        const normTarget = targetText.toLowerCase().replace(/\s+/g, ' ').trim();

        if (normOption.includes(normTarget) || normTarget.includes(normOption)) {
          return true;
        }

        const optNumbers = normOption.match(/\d+/g) || [];
        const targetNumbers = normTarget.match(/\d+/g) || [];

        if (optNumbers.length > 0 && targetNumbers.length > 0) {
          const optInts = optNumbers.map(n => parseInt(n, 10));
          const targetInts = targetNumbers.map(n => parseInt(n, 10));

          const numbersMatch = targetInts.every(num => optInts.includes(num));

          const optWords = normOption.replace(/\d+/g, '').split(/\s+/).filter(w => w.length > 1);
          const targetWords = normTarget.replace(/\d+/g, '').split(/\s+/).filter(w => w.length > 1);

          const wordsMatch = targetWords.every(tw => optWords.some(ow => ow.includes(tw) || tw.includes(ow)));

          if (numbersMatch && wordsMatch) {
            return true;
          }
        }

        const words = normTarget.split(/\s+/).filter(w => w.length > 1);
        if (words.length > 0) {
          const allWordsMatch = words.every(w => {
            if (/^\d+$/.test(w)) {
              const numVal = parseInt(w, 10);
              const optNums = normOption.match(/\d+/g) || [];
              return optNums.some(on => parseInt(on, 10) === numVal);
            }
            return normOption.includes(w);
          });
          if (allWordsMatch) return true;
        }

        return false;
      }

      // Tìm tất cả phần tử bên trong container trừ phần tử chứa thẻ input (wrapper)
      const allElements = Array.from(container.querySelectorAll('div, span, li, p, [role="option"]'));

      const candidates = [];
      for (const el of allElements) {
        if (el.querySelector('input')) continue;

        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;

        const text = (el.textContent || '').trim();
        if (!text) continue;
        if (/không có dữ liệu|khong co du lieu|no data/i.test(text)) continue;

        candidates.push({ element: el, text: text });
      }

      // Tìm ứng viên khớp nhất
      let bestMatch = null;
      for (const cand of candidates) {
        if (matchOptionText(cand.text, valueText)) {
          // Ưu tiên phần tử con sâu nhất (leaf element) để tránh click nhầm container to
          if (!bestMatch || cand.element.contains(bestMatch.element)) {
            if (!bestMatch) {
              bestMatch = cand;
            }
          } else if (bestMatch.element.contains(cand.element)) {
            bestMatch = cand;
          }
        }
      }

      // Nếu tìm thấy, đánh dấu phần tử đó
      if (bestMatch) {
        const existing = document.querySelectorAll('[data-antigravity-target]');
        existing.forEach(el => el.removeAttribute('data-antigravity-target'));

        bestMatch.element.setAttribute('data-antigravity-target', 'true');
        return { success: true, text: bestMatch.text, tag: bestMatch.element.tagName.toLowerCase() };
      }

      // Fallback 1: Lấy item đầu tiên có class .css-6sgxfm hoặc tương đương
      const genericOptions = container.querySelectorAll('.css-6sgxfm, [class*="-option"], li');
      if (genericOptions.length > 0) {
        const firstOpt = Array.from(genericOptions).find((el) => {
          const text = (el.textContent || '').trim();
          return text && !/không có dữ liệu|khong co du lieu|no data/i.test(text);
        });
        if (!firstOpt) return { success: false, reason: 'Dropdown chỉ có trạng thái không có dữ liệu' };
        firstOpt.setAttribute('data-antigravity-target', 'true');
        return { success: true, text: firstOpt.textContent.trim(), tag: firstOpt.tagName.toLowerCase(), isFallback: true };
      }

      // Fallback 2: Lấy phần tử lá đầu tiên có chứa text
      const leafElements = candidates.filter(cand => !cand.element.querySelector('div'));
      if (leafElements.length > 0) {
        const firstLeaf = leafElements[0];
        firstLeaf.setAttribute('data-antigravity-target', 'true');
        return { success: true, text: firstLeaf.text, tag: firstLeaf.element.tagName.toLowerCase(), isLeafFallback: true };
      }

      return { success: false, reason: 'Không tìm thấy phần tử khả dụng trong candidates: ' + candidates.map(c => c.text).slice(0, 5).join(', ') };
    }, { dropdownId, valueText });

    if (marked.success) {
      const target = page.locator('[data-antigravity-target="true"]').first();
      await target.click();
      sendLog(`Co.opmart: Đã chọn "${marked.text}" từ #${dropdownId}.`, "success");

      // Xóa thuộc tính tạm thời
      await page.evaluate(() => {
        const el = document.querySelector('[data-antigravity-target]');
        if (el) el.removeAttribute('data-antigravity-target');
      });
      await page.waitForTimeout(600);
      return true;
    } else {
      sendLog(`Co.opmart: Không tìm được option cho "${valueText}" trong #${dropdownId}. Chi tiết: ${marked.reason}`, "warning");
      return false;
    }
  } catch (err) {
    sendLog(`Co.opmart: Lỗi fillAddressAutocomplete: ${err.message}`, "warning");
    return false;
  }
}


async function enableCoopGeolocationToggle(page, sendLog) {
  const switched = await page.evaluate(() => {
    const modal = document.querySelector(".teko-modal-show") ||
      document.querySelector('[class*="teko-modal"]') ||
      document.querySelector(".modal.show") ||
      document;
    const isVisible = (el) => {
      if (!el) return false;
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    };
    const candidates = Array.from(modal.querySelectorAll('button, input[type="checkbox"], [role="switch"], [class*="switch"], [class*="toggle"]'));
    const toggle = candidates.find((el) => {
      if (!isVisible(el)) return false;
      const rect = el.getBoundingClientRect();
      return rect.width >= 24 && rect.width <= 80 && rect.height >= 16 && rect.height <= 48;
    });
    if (!toggle) return false;
    const checked =
      toggle.checked === true ||
      toggle.getAttribute("aria-checked") === "true" ||
      /checked|active|on/i.test(String(toggle.className || ""));
    if (checked) return "already-on";
    toggle.click();
    toggle.dispatchEvent(new Event("input", { bubbles: true }));
    toggle.dispatchEvent(new Event("change", { bubbles: true }));
    return "turned-on";
  });

  if (switched === "already-on") {
    sendLog("Co.opmart: Toggle định vị đã bật sẵn.", "success");
    return true;
  }
  if (switched === "turned-on") {
    sendLog("Co.opmart: Đã bật toggle định vị.", "success");
    await page.waitForTimeout(1000);
    return true;
  }
  sendLog("Co.opmart: Không thấy toggle định vị, sẽ thử xác nhận popup hiện tại.", "warning");
  return false;
}

async function confirmCoopAddressPopup(page, sendLog) {
  const clicked = await page.evaluate(() => {
    const modal = document.querySelector(".teko-modal-show") ||
      document.querySelector('[class*="teko-modal"]') ||
      document.querySelector(".modal.show") ||
      document;
    const isVisible = (el) => {
      if (!el) return false;
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    };
    const buttons = Array.from(modal.querySelectorAll("button"));
    const target = buttons.find((button) => {
      if (!isVisible(button)) return false;
      const text = (button.textContent || "").trim().toLowerCase();
      return text.includes("xác nhận") || text.includes("xac nhan") || text.includes("tiếp tục") || text.includes("tiep tuc");
    }) || buttons.find((button) => isVisible(button) && button.type === "submit");
    if (!target) return false;
    target.click();
    return true;
  }).catch(() => false);

  if (clicked) {
    sendLog("Co.opmart: Đã bấm xác nhận popup địa chỉ.", "success");
    await page.waitForTimeout(1500);
    return true;
  }
  sendLog("Co.opmart: Không tìm thấy nút xác nhận trên popup địa chỉ.", "warning");
  return false;
}

async function handleAddressPopup(page, sendLog) {
  sendLog("Co.opmart: Chờ popup địa chỉ xuất hiện (tối đa 15 giây)...");

  // Scroll xuống để kích hoạt popup địa chỉ
  await page.waitForTimeout(1000);
  await page.evaluate(() => window.scrollBy(0, 300));
  await page.waitForTimeout(500);
  await page.evaluate(() => window.scrollBy(0, 300));
  await page.waitForTimeout(500);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(500);

  // Chờ popup Teko xuất hiện
  let popupFound = false;
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline && !popupFound) {
    try {
      const el = page.locator(".teko-modal-show").first();
      if (await el.isVisible()) {
        sendLog("Co.opmart: Phát hiện popup địa chỉ (Teko UI).", "success");
        popupFound = true;
      }
    } catch { }
    if (!popupFound) {
      // Fallback: thử selector rộng hơn
      try {
        const el = page.locator('[class*="teko-modal"]:visible, .modal.show:visible').first();
        if (await el.isVisible()) {
          sendLog("Co.opmart: Phát hiện popup địa chỉ (fallback selector).", "success");
          popupFound = true;
        }
      } catch { }
    }
    if (!popupFound) await page.waitForTimeout(500);
  }

  if (!popupFound) {
    sendLog("Co.opmart: Không thấy popup địa chỉ sau 15 giây, tiếp tục...", "warning");
    return;
  }

  await page.waitForTimeout(500);
  await enableCoopGeolocationToggle(page, sendLog);
  const addressConfirmed = await confirmCoopAddressPopup(page, sendLog);

  if (addressConfirmed) {
    // Bước tiếp theo: Chọn siêu thị gần bạn
    sendLog("Co.opmart: Đang chờ danh sách siêu thị gần bạn xuất hiện...");

    let storeMarked = { success: false };
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline && !storeMarked.success) {
      storeMarked = await page.evaluate(() => {
        const modal = document.querySelector('.teko-modal-show') || document.querySelector('[class*="teko-modal"]') || document;
        if (!modal) return { success: false };

        function rectVisible(el) {
          const rect = el.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        }

        // Tìm tất cả các div, span, p, li trong modal
        const allElements = Array.from(modal.querySelectorAll('div, span, p, li'));
        const candidates = [];

        for (const el of allElements) {
          if (!rectVisible(el)) continue;
          const text = (el.textContent || '').trim();
          const hasKm = /\d+(\.\d+)?\s*km/i.test(text);
          const hasStoreName = /co\.?opmart|co\.?opxtra|finelife/i.test(text);
          if (hasKm && hasStoreName) {
            // Loại bỏ phần text km để xem có chứa store name / address khác không
            const remainingText = text.replace(/\d+(\.\d+)?\s*km/i, '').trim();
            if (remainingText.length > 5) {
              candidates.push(el);
            }
          }
        }

        if (candidates.length > 0) {
          // Tìm card nhỏ nhất (các phần tử lá không chứa candidate nào khác)
          const leafCandidates = candidates.filter(cand1 => {
            return !candidates.some(cand2 => cand2 !== cand1 && cand1.contains(cand2));
          });

          if (leafCandidates.length > 0) {
            const bestCard = leafCandidates[0];
            bestCard.setAttribute('data-antigravity-store-target', 'true');
            return { success: true, text: bestCard.textContent.trim().slice(0, 100) };
          }
        }
        return { success: false };
      });

      if (!storeMarked.success) {
        await page.waitForTimeout(500);
      }
    }

    if (storeMarked.success) {
      sendLog("Co.opmart: Phát hiện danh sách siêu thị gần bạn.", "success");
      const targetStore = page.locator('[data-antigravity-store-target="true"]').first();
      await targetStore.click();
      sendLog(`Co.opmart: Đã chọn siêu thị "${storeMarked.text}".`, "success");

      // Xóa thuộc tính tạm thời
      await page.evaluate(() => {
        const el = document.querySelector('[data-antigravity-store-target]');
        if (el) el.removeAttribute('data-antigravity-store-target');
      });
      await page.waitForTimeout(1000);

      // Bấm nút "Mua sắm ngay" để hoàn tất thiết lập địa chỉ/siêu thị
      let shopNowClicked = false;

      // 1. Thử click trực tiếp qua evaluate (cực kỳ chính xác cho các phần tử phức tạp)
      try {
        shopNowClicked = await page.evaluate(() => {
          const modal = document.querySelector('.teko-modal-show') || document.querySelector('[class*="teko-modal"]') || document;
          if (!modal) return false;

          const buttons = Array.from(modal.querySelectorAll('button'));
          const targetBtn = buttons.find(btn => {
            const text = (btn.textContent || "").toLowerCase().trim();
            const rect = btn.getBoundingClientRect();
            const isVisible = rect.width > 0 && rect.height > 0;
            return isVisible && (text.includes("mua sắm") || text.includes("xác nhận"));
          });

          if (targetBtn) {
            targetBtn.click();
            return true;
          }
          return false;
        });
      } catch (err) {
        sendLog(`Co.opmart: evaluate click 'Mua sắm ngay' lỗi: ${err.message}`, "warning");
      }

      // 2. Fallback qua Playwright locator nếu evaluate không click được hoặc trả về false
      if (!shopNowClicked) {
        const shopNowSelectors = [
          'button:has-text("Mua sắm ngay")',
          'button:has-text("Mua sắm")',
          'button:has-text("Xác nhận")',
        ];

        for (const sel of shopNowSelectors) {
          try {
            const btn = page.locator(sel).first();
            if (await waitForVisible(btn, 1500)) {
              await btn.click({ timeout: 3000 });
              shopNowClicked = true;
              break;
            }
          } catch (err) {
            sendLog(`Co.opmart: Thử click locator "${sel}" thất bại: ${err.message}`, "warning");
          }
        }
      }

      if (shopNowClicked) {
        sendLog("Co.opmart: Đã hoàn tất bước chọn siêu thị (Mua sắm ngay).", "success");
        await page.waitForTimeout(1500);
      } else {
        sendLog("Co.opmart: Không tìm thấy hoặc không click được nút 'Mua sắm ngay'.", "warning");
      }
    } else {
      sendLog("Co.opmart: Không hiển thị hoặc không nhận diện được danh sách siêu thị gần bạn.", "warning");
    }
  }
}

async function searchAndAddToCart(page, payload, sendLog) {
  const { productName, qty } = payload;
  const currentUrl = page.url();

  // Nếu đang ở trang sản phẩm cụ thể, không cần tìm kiếm
  if (!currentUrl.includes("cooponline.vn") && !currentUrl.includes("search")) {
    sendLog("Co.opmart: Đang ở trang sản phẩm, tiếp tục...");
  }

  // Tìm nút "Thêm vào giỏ" / "Mua ngay"
  const addToCartSelectors = [
    'button:has-text("Thêm vào giỏ hàng")',
    'button:has-text("Thêm vào giỏ")',
    'button:has-text("THÊM VÀO GIỎ")',
    'button:has-text("Mua ngay")',
    'button:has-text("MUA NGAY")',
    '.btn-add-to-cart',
    '[class*="add-to-cart"] button',
    '[class*="addtocart"] button',
    'button[class*="cart"]',
  ];

  for (const sel of addToCartSelectors) {
    try {
      const btn = page.locator(sel).first();
      if (await waitForVisible(btn, 2000)) {
        await btn.scrollIntoViewIfNeeded();
        await btn.click();
        sendLog(`Co.opmart: Đã thêm sản phẩm vào giỏ hàng.`, "success");
        await page.waitForTimeout(1500);
        return true;
      }
    } catch { }
  }

  sendLog("Co.opmart: Không tìm thấy nút thêm giỏ hàng, nhường AI xử lý.", "warning");
  return false;
}

/**
 * Entry point của playbook Co.opmart
 */
async function run(page, payload, sendLog, sendStatus, sendMessage = null, sendScreenshotFrame = null) {
  sendLog("Co.opmart Playbook: Bắt đầu...", "success");

  // Đảm bảo trang đã điều hướng tới URL sản phẩm
  if (payload.url) {
    sendLog(`Co.opmart: Đang mở trang sản phẩm ${payload.url}...`, "info");
    await page.goto(payload.url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(1000);
    if (sendScreenshotFrame) await sendScreenshotFrame();
  }

  // Bước 1: Xử lý popup địa chỉ nếu có
  await handleAddressPopup(page, sendLog);
  await page.waitForTimeout(1000);
  if (sendScreenshotFrame) await sendScreenshotFrame();

  // Bước 2: Thử thêm vào giỏ hàng trực tiếp
  await searchAndAddToCart(page, payload, sendLog);
  if (sendScreenshotFrame) await sendScreenshotFrame();

  // Bước 3: Kiểm tra đã có sản phẩm trong giỏ chưa, nếu chưa thì trả về AI xử lý
  sendLog("Co.opmart Playbook: Hoàn thành bootstrap. Chuyển sang AI DOM Agent...", "success");
  return { done: false }; // Để AI DOM loop tiếp tục phần checkout
}

async function runCss(page, payload, sendLog, sendStatus) {
  const { url, productName, qty, buyerName, buyerPhone, buyerAddress, chain } = payload;
  sendLog(`Co.opmart CSS: bắt đầu fallback riêng cho ${productName} (SL: ${qty}) tại ${String(chain || "cooponline").toUpperCase()}.`, "info");

  await safeGoto(page, url, sendLog, { waitUntil: "load", settleMs: 1500 });
  await handleAddressPopup(page, payload, sendLog);
  await page.waitForTimeout(800);

  await searchAndAddToCart(page, payload, sendLog);
  await page.waitForTimeout(1200);

  await clickFirstVisible(page, CHECKOUT_SELECTORS, sendLog, {
    successMessage: "Co.opmart CSS: đã mở bước checkout",
    failureMessage: "Co.opmart CSS: chưa tìm thấy nút checkout rõ ràng, tiếp tục thử điền trực tiếp nếu form đã mở.",
  });

  await page.waitForTimeout(1200);

  await fillFirstVisible(page, NAME_SELECTORS, buyerName, sendLog, {
    fieldLabel: "họ tên Co.opmart",
    failureMessage: "Co.opmart CSS: chưa tìm thấy ô họ tên checkout.",
  });
  await fillFirstVisible(page, PHONE_SELECTORS, buyerPhone, sendLog, {
    fieldLabel: "SĐT Co.opmart",
    failureMessage: "Co.opmart CSS: chưa tìm thấy ô SĐT checkout.",
  });
  await fillFirstVisible(page, ADDRESS_SELECTORS, buyerAddress, sendLog, {
    fieldLabel: "địa chỉ Co.opmart",
    failureMessage: "Co.opmart CSS: chưa tìm thấy ô địa chỉ checkout.",
  });

  await page.waitForTimeout(1200);

  notifyWaitingForUser(sendStatus, sendLog, {
    reason: "Co.opmart đang chờ khách hàng xác nhận OTP hoặc thanh toán trực tiếp trên website.",
  });

  await waitForSuccessUrl(page, sendLog, sendStatus, {
    successUrlKeywords: SUCCESS_URL_KEYWORDS,
    timeoutMessage: "Co.opmart CSS: hết thời gian chờ xác nhận thành công. Vui lòng kiểm tra lại đơn hàng.",
  });

  return { done: true };
}

async function safeGotoCoop(page, url, sendLog, sendFrame) {
  await page.goto(url, { waitUntil: "commit", timeout: 20000 });
  await page.waitForLoadState("domcontentloaded", { timeout: 8000 }).catch(() => {
    sendLog("Co.opmart: Trang đã bắt đầu tải nhưng chưa báo domcontentloaded, vẫn hiển thị màn hình hiện tại.", "warning");
  });
  await page.waitForTimeout(500).catch(() => {});
  await sendFrame?.();
}

function applyCoopBrowserState(state) {
  const write = (key, value) => {
    if (value == null || value === "") return;
    localStorage.setItem(key, String(value));
  };
  const writeJson = (key, value) => {
    if (value == null) return;
    localStorage.setItem(key, JSON.stringify(value));
  };
  const writeCookie = (key, value, encode = false) => {
    if (value == null || value === "") return;
    const expires = new Date(Date.now() + 63072000000).toUTCString();
    const cookieValue = encode ? encodeURIComponent(String(value)) : String(value);
    document.cookie = `${key}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;Path=/;`;
    document.cookie = `${key}=${cookieValue};expires=${expires};Path=/;SameSite=None;Secure;`;
  };
  const writeSelectedInfo = (key, value, encodeCookie = false) => {
    if (value == null || value === "") return;
    write(key.toUpperCase(), value);
    writeCookie(key, value, encodeCookie);
  };

  write("cart_token", state.cartToken);
  write("cartToken", state.cartToken);
  write("x-cart-token", state.cartToken);

  if (state.accessToken) {
    write("ACCESS_TOKEN", state.accessToken);
    if (state.refreshToken) write("REFRESH_TOKEN", state.refreshToken);
    write("userPhone", state.phone);
    write("userId", state.userId);
    write("userEmail", state.email);
    write("siteId", state.siteId);
  }

  writeSelectedInfo("terminal", state.terminalCode);
  writeSelectedInfo("terminal_id", state.terminalId);
  writeSelectedInfo("terminal_name", state.terminalName, true);
  writeSelectedInfo("isGetGeoLocation", "false");
  writeSelectedInfo("userTerminalCode", state.terminalCode);
  writeSelectedInfo("userTerminalId", state.terminalId);

  const terminal = {
    terminalCode: state.terminalCode,
    code: state.terminalCode,
    terminalId: state.terminalId,
    id: state.terminalId,
    terminalName: state.terminalName,
    name: state.terminalName,
    address: state.terminalAddress,
    fullAddress: state.terminalAddress,
    siteId: state.siteId,
  };
  const location = {
    address: state.address,
    fullAddress: state.address,
  };
  writeJson("TERMINALS", [terminal]);
  writeJson("USER_LOCATION", location);

  write("terminal", state.terminalCode);
  write("terminalCode", state.terminalCode);
  write("currentTerminal", state.terminalCode);

  if (state.accessToken && state.userId) {
    const userInfo = {
      sub: state.userId,
      phone_number: state.phone,
      phoneNumber: state.phone,
      name: state.phone || state.userId,
      email: state.email || "",
    };
    const events = {
      addSilentRenewError() {},
      addAccessTokenExpiring() {},
      addAccessTokenExpired() {},
      removeSilentRenewError() {},
      removeAccessTokenExpiring() {},
      removeAccessTokenExpired() {},
    };
    const fakeUser = {
      events,
      isLoggedIn() {
        return true;
      },
      getAccessToken() {
        return state.accessToken;
      },
      getUserInfo() {
        return userInfo;
      },
      loadUser() {
        return Promise.resolve(userInfo);
      },
      unloadUser() {
        return Promise.resolve();
      },
      login() {
        return Promise.resolve(userInfo);
      },
      loginSilent() {
        return Promise.resolve(userInfo);
      },
      logout() {
        return Promise.resolve();
      },
      signinRedirect() {
        return Promise.resolve();
      },
      signinSilent() {
        return Promise.resolve(userInfo);
      },
      signinSilentCallback() {
        return Promise.resolve(userInfo);
      },
    };
    const patchTekoId = (teko) => {
      if (!teko || typeof teko !== "object") return teko;
      try {
        Object.defineProperty(teko, "user", {
          configurable: true,
          enumerable: true,
          get() {
            return fakeUser;
          },
          set() {},
        });
      } catch {}
      return teko;
    };

    let tekoValue = patchTekoId(window.TekoID && typeof window.TekoID === "object" ? window.TekoID : {});
    try {
      Object.defineProperty(window, "TekoID", {
        configurable: true,
        enumerable: true,
        get() {
          return patchTekoId(tekoValue);
        },
        set(value) {
          tekoValue = patchTekoId(value || {});
        },
      });
    } catch {
      window.TekoID = patchTekoId(tekoValue);
    }

    if (!window.__affreeCoopTekoPatchTimer) {
      const stopAt = Date.now() + 30000;
      window.__affreeCoopTekoPatchTimer = setInterval(() => {
        try {
          patchTekoId(window.TekoID);
          if (Date.now() > stopAt) {
            clearInterval(window.__affreeCoopTekoPatchTimer);
            window.__affreeCoopTekoPatchTimer = null;
          }
        } catch {}
      }, 25);
    }
  }
}

async function seedCartState(page, payload, sendLog, sendFrame) {
  const cartToken = payload.cartToken || payload.cart_token || payload.xCartToken;
  const session = payload.browserSession || {};
  const terminalCode = payload.terminalCode || session.terminalCode || payload.terminal || "";
  const address = payload.address || payload.fullAddress || "";
  if (!cartToken) throw new Error("Thiếu cartToken Co.op để mở màn hình thao tác.");

  const seed = {
    cartToken,
    terminalCode,
    terminalId: payload.terminalId || session.terminalId,
    terminalName: payload.terminalName || session.terminalName || terminalCode,
    terminalAddress: payload.terminalAddress || session.terminalAddress || "",
    siteId: payload.siteId || session.siteId,
    address,
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
    userId: session.userId,
    phone: session.phone,
    email: session.email,
  };
  await page.addInitScript(applyCoopBrowserState, seed);

  sendLog("Co.opmart: Đang mở trang chủ để nạp cart token...");
  await safeGotoCoop(page, "https://cooponline.vn/", sendLog, sendFrame);
  await page.evaluate(applyCoopBrowserState, seed);
}

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

async function acceptCoopLoginTerms(page, sendLog) {
  const checked = await page.evaluate(() => {
    const isVisible = (el) => {
      if (!el) return false;
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    };
    const inputs = Array.from(document.querySelectorAll('input[type="checkbox"]'));
    const checkbox = inputs.reverse().find((input) => isVisible(input) || input.offsetParent !== null);
    if (checkbox) {
      if (!checkbox.checked) {
        checkbox.click();
        checkbox.dispatchEvent(new Event("input", { bubbles: true }));
        checkbox.dispatchEvent(new Event("change", { bubbles: true }));
      }
      return checkbox.checked;
    }

    const labels = Array.from(document.querySelectorAll("label, [role='checkbox'], span, div"));
    const label = labels.find((el) => {
      const text = (el.textContent || "").toLowerCase();
      return isVisible(el) && /đồng ý|chính sách bảo mật|điều khoản/.test(text);
    });
    if (label) {
      label.click();
      const nextCheckbox = document.querySelector('input[type="checkbox"]');
      return nextCheckbox ? nextCheckbox.checked : true;
    }
    return false;
  });

  if (checked) {
    const visibleCheckbox = page.locator('input[type="checkbox"]').last();
    const actualChecked = await visibleCheckbox.isChecked({ timeout: 500 }).catch(() => true);
    if (actualChecked) {
      sendLog("Co.opmart: Đã xác nhận điều khoản đăng nhập.", "success");
      return true;
    }
  }

  const visibleCheckbox = page.locator('input[type="checkbox"]').last();
  if (await visibleCheckbox.isVisible({ timeout: 800 }).catch(() => false)) {
    const box = await visibleCheckbox.boundingBox().catch(() => null);
    if (box) {
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2).catch(() => null);
    } else {
      await visibleCheckbox.click({ force: true }).catch(() => null);
    }
    const nowChecked = await visibleCheckbox.isChecked().catch(() => false);
    if (nowChecked) {
      sendLog("Co.opmart: Đã xác nhận điều khoản đăng nhập.", "success");
      return true;
    }
  }

  sendLog("Co.opmart: Chưa tick được ô điều khoản đăng nhập, vẫn thử gửi form để giữ màn hình cho bạn thao tác.", "warning");
  return false;
}

async function ensureCoopPasswordLogin(page, payload, sendLog, sendFrame) {
  const phone = String(payload.phone || payload.browserSession?.phone || "").replace(/\D/g, "");
  const password = String(payload.password || "");
  if (!phone || !password) {
    sendLog("Co.opmart: Thiếu số điện thoại hoặc mật khẩu để đăng nhập hồ sơ.", "warning");
    return false;
  }

  const profileTitle = page.getByText(/Cập nhật thông tin cá nhân/i).first();
  if (await profileTitle.isVisible({ timeout: 1000 }).catch(() => false)) return true;

  sendLog("Co.opmart: Đang mở trang đăng nhập để cập nhật hồ sơ...");
  await safeGotoCoop(page, buildCoopAuthorizeUrl(), sendLog, sendFrame);
  await page.waitForTimeout(1500);
  const locationPopup = page.getByText(/Hoặc nhập địa chỉ|Bật định vị/i).first();
  if (await locationPopup.isVisible({ timeout: 1500 }).catch(() => false)) {
    await handleAddressPopup(page, sendLog);
    await page.waitForTimeout(1500);
    await sendFrame?.();
  }

  const phoneInput = page.locator('input[placeholder*="Nhập số điện thoại" i], input[type="tel"], input[name*="phone" i], input[placeholder*="số điện thoại" i], input[placeholder*="phone" i], input[placeholder*="tài khoản" i]').first();
  const passwordInput = page.locator('input[placeholder*="Nhập mật khẩu" i], input[type="password"], input[name*="password" i], input[placeholder*="mật khẩu" i], input[placeholder*="password" i]').first();
  if (!(await waitForVisible(phoneInput, 8000)) || !(await waitForVisible(passwordInput, 8000))) {
    sendLog("Co.opmart: Chưa thấy form đăng nhập Co.op. Có thể trang đang giữ phiên hoặc đổi giao diện.", "warning");
    return false;
  }

  await phoneInput.fill(phone);
  await passwordInput.fill(password);
  await acceptCoopLoginTerms(page, sendLog);
  const loginButtons = [
    'button:has-text("Đăng nhập")',
    'button:has-text("Tiếp tục")',
    'button[type="submit"]',
  ];
  for (const selector of loginButtons) {
    const button = page.locator(selector).first();
    if (await waitForVisible(button, 1200)) {
      await button.click({ force: true });
      sendLog("Co.opmart: Đã gửi form đăng nhập.", "success");
      await page.waitForTimeout(5000);
      await sendFrame?.();
      const postLoginLocationPopup = page.getByText(/Hoặc nhập địa chỉ|Bật định vị/i).first();
      if (await postLoginLocationPopup.isVisible({ timeout: 1000 }).catch(() => false)) {
        sendLog("Co.opmart: Co.op yêu cầu chọn địa chỉ sau đăng nhập, đang xử lý tiếp...");
        await handleAddressPopup(page, sendLog);
        await page.waitForTimeout(2500);
        if (await phoneInput.isVisible({ timeout: 1000 }).catch(() => false)) {
          await phoneInput.fill(phone);
          await passwordInput.fill(password);
          await acceptCoopLoginTerms(page, sendLog);
          await button.click({ force: true });
          sendLog("Co.opmart: Đã gửi lại form đăng nhập sau khi chọn địa chỉ.", "success");
          await page.waitForTimeout(5000);
        }
        await sendFrame?.();
      }
      const stillOnLogin = await phoneInput.isVisible({ timeout: 500 }).catch(() => false);
      if (stillOnLogin) {
        const pageText = await page.locator("body").innerText({ timeout: 1000 }).catch(() => "");
        const errorHint = pageText
          .split("\n")
          .map((line) => line.trim())
          .find((line) => /vui lòng|không đúng|sai|khóa|captcha|robot|xác minh|điều khoản/i.test(line));
        sendLog(
          errorHint
            ? `Co.opmart: Login chưa đi tiếp: ${errorHint}`
            : "Co.opmart: Login chưa đi tiếp, đang giữ màn hình đăng nhập để bạn thao tác.",
          "warning"
        );
        return false;
      }
      return true;
    }
  }
  sendLog("Co.opmart: Không tìm thấy nút đăng nhập.", "warning");
  return false;
}

async function fillCoopProfilePopup(page, payload, sendLog, sendFrame, timeoutMs = 12000) {
  const title = page.getByText(/Cập nhật thông tin cá nhân|Thông tin người nhận hàng/i).first();
  const found = await title.isVisible({ timeout: Math.min(timeoutMs, 3000) }).catch(() => false) ||
    await page
      .locator('input[placeholder*="tên người nhận" i], input[placeholder*="họ tên" i], input[placeholder*="số điện thoại" i]')
      .first()
      .isVisible({ timeout: timeoutMs })
      .catch(() => false);
  if (!found) {
    sendLog("Co.opmart: Không thấy popup cập nhật thông tin cá nhân/người nhận.", "warning");
    return false;
  }

  const profileName = String(payload.name || payload.browserSession?.name || payload.phone || "").trim();
  const profileEmail = String(payload.email || payload.browserSession?.email || "").trim();
  const addr = getPayloadAddressParts(payload);

  sendLog("Co.opmart: Đang điền popup thông tin người nhận/địa chỉ...");
  const nameInput = page.locator('input[placeholder*="họ tên" i], input[placeholder*="họ và tên" i], input[placeholder*="tên người nhận" i]').first();
  if (profileName && await waitForVisible(nameInput, 2500)) {
    await nameInput.fill(profileName);
  }

  const phone = String(payload.phone || payload.browserSession?.phone || "").trim();
  const phoneInput = page.locator('input[placeholder*="số điện thoại" i], input[type="tel"]').first();
  if (phone && await waitForVisible(phoneInput, 1200)) {
    await phoneInput.fill(phone);
  }

  if (validEmail(profileEmail)) {
    const emailInput = page.locator('input[placeholder*="email" i], input[type="email"]').first();
    if (await waitForVisible(emailInput, 1500)) await emailInput.fill(profileEmail);
  }

  await fillAddressAutocomplete(page, sendLog, ["Tỉnh/Thành phố", "Chọn tỉnh/thành phố"], "provinceCode", addr.province);
  await page.waitForTimeout(700);
  await fillAddressAutocomplete(page, sendLog, ["Quận/Huyện", "Chọn quận/ huyện", "Chọn quận/huyện"], "districtCode", addr.district);
  await page.waitForTimeout(700);
  const hasWardField = await hasAddressInput(page, ["Phường/Xã", "Chọn phường/xã", "Chọn phường"]);
  if (hasWardField) {
    await fillAddressAutocomplete(page, sendLog, ["Phường/Xã", "Chọn phường/xã", "Chọn"], "wardCode", addr.ward);
    await page.waitForTimeout(700);
  }

  const streetInput = page.locator('input[placeholder*="Số nhà" i], input[placeholder*="tên đường" i], input#address').last();
  if (addr.street && await waitForVisible(streetInput, 2000)) {
    await streetInput.fill(buildStreetDetail(addr, hasWardField));
  }

  await sendFrame?.();
  const saveButtons = [
    'button:has-text("Lưu thông tin")',
    'button:has-text("Lưu địa chỉ")',
    'button:has-text("Cập nhật")',
    'button:has-text("Xác nhận")',
    'button[type="submit"]',
  ];
  for (const selector of saveButtons) {
    const button = page.locator(selector).last();
    if (await waitForVisible(button, 1500)) {
      await button.click();
      sendLog("Co.opmart: Đã lưu thông tin cá nhân.", "success");
      await page.waitForTimeout(3500);
      await sendFrame?.();
      return true;
    }
  }

  sendLog("Co.opmart: Không tìm thấy nút Lưu thông tin trên popup hồ sơ.", "warning");
  return false;
}

async function closeCoopMarketingPopup(page) {
  const closeCandidates = [
    'button[aria-label*="close" i]',
    'button:has-text("×")',
    '[role="button"]:has-text("×")',
    'svg[class*="close" i]',
  ];
  for (const selector of closeCandidates) {
    const target = page.locator(selector).last();
    if (await target.isVisible({ timeout: 700 }).catch(() => false)) {
      await target.click({ force: true }).catch(() => null);
      await page.waitForTimeout(500);
      return true;
    }
  }
  await page.keyboard.press("Escape").catch(() => null);
  return false;
}

async function showProfileSetup(page, payload, sendLog, sendStatus, sendFrame) {
  sendStatus("coop_assist_opening");
  const loggedIn = await ensureCoopPasswordLogin(page, payload, sendLog, sendFrame);
  if (!loggedIn) {
    sendStatus("coop_assist_manual", { url: page.url(), reason: "login_pending" });
    return { done: true, manual: true };
  }
  const profileHandledBeforeCheckout = await fillCoopProfilePopup(page, payload, sendLog, sendFrame, 6000);
  await closeCoopMarketingPopup(page);
  await safeGotoCoop(page, "https://cooponline.vn/checkout", sendLog, sendFrame);
  await page.waitForTimeout(2500);
  await closeCoopMarketingPopup(page);
  const profileHandled = profileHandledBeforeCheckout || await fillCoopProfilePopup(page, payload, sendLog, sendFrame, 45000);
  if (profileHandled) {
    sendLog("Co.opmart: Đã xử lý popup cập nhật hồ sơ.", "success");
    sendStatus("coop_assist_ready", { url: page.url() });
    return { done: true };
  }
  sendLog("Co.opmart: Chưa thấy popup hồ sơ sau đăng nhập, đang giữ màn hình Co.op hiện tại để bạn kiểm tra.", "warning");
  sendStatus("coop_assist_manual", { url: page.url(), reason: "profile_popup_not_found" });
  return { done: true, manual: true };
}

function formatCoopDisplayDate(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : String(value || "");
}

async function clickCoopCheckoutDate(page, displayDate) {
  const match = String(displayDate || "").match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return false;
  const [, day, month, year] = match;
  const picked = await page.evaluate(({ day, month, year }) => {
    const isVisible = (el) => {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    };
    const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();
    const allNodes = Array.from(document.querySelectorAll("button, td, div, span, [role='button'], [role='gridcell']"));
    const dayNumber = String(Number(day));
    const candidates = allNodes
      .filter((el) => {
        if (!isVisible(el)) return false;
        const text = normalize(el.textContent);
        if (text !== day && text !== dayNumber) return false;
        const rect = el.getBoundingClientRect();
        return rect.width >= 16 && rect.width <= 80 && rect.height >= 16 && rect.height <= 80;
      })
      .map((el) => {
        const rect = el.getBoundingClientRect();
        const scope = el.closest("[class*='calendar'], [class*='datepicker'], [class*='picker'], [role='dialog'], [class*='popover']") || el.parentElement;
        const scopeText = normalize(scope?.textContent);
        const label = normalize(el.getAttribute("aria-label") || el.getAttribute("title") || "");
        const score =
          (scopeText.includes(month) ? 3 : 0) +
          (scopeText.includes(year) ? 3 : 0) +
          (/calendar|picker|date/i.test(String(scope?.className || "")) ? 4 : 0) +
          (label.includes(month) || label.includes(year) ? 4 : 0) +
          (rect.top > 120 ? 1 : 0);
        return { el, score };
      })
      .sort((a, b) => b.score - a.score);

    const target = candidates[0]?.el;
    if (!target) return false;
    target.scrollIntoView({ block: "center", inline: "center" });
    target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
    target.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
    target.click();
    return true;
  }, { day, month, year }).catch(() => false);
  return Boolean(picked);
}

async function selectCoopCheckoutDate(page, displayDate) {
  if (!displayDate) return false;
  const dateInputs = [
    'input[placeholder*="dd/mm" i]',
    'input[placeholder*="ngày" i]',
    'input[name*="date" i]',
    'input[class*="date" i]',
  ];

  for (const selector of dateInputs) {
    const input = page.locator(selector).first();
    if (!(await input.isVisible({ timeout: 700 }).catch(() => false))) continue;
    await input.scrollIntoViewIfNeeded().catch(() => null);
    await input.click({ force: true }).catch(() => null);
    await page.waitForTimeout(300);
    const clickedPickerDay = await clickCoopCheckoutDate(page, displayDate);
    if (clickedPickerDay) return true;

    await input.fill(displayDate, { force: true }).catch(async () => {
      await input.press(process.platform === "darwin" ? "Meta+A" : "Control+A").catch(() => null);
      await input.type(displayDate, { delay: 20 }).catch(() => null);
    });
    await input.evaluate((el, value) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(el, value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      el.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", bubbles: true }));
      el.dispatchEvent(new Event("blur", { bubbles: true }));
    }, displayDate).catch(() => null);
    await input.press("Enter").catch(() => null);
    await input.press("Tab").catch(() => null);
    await page.waitForTimeout(300);
    const currentValue = await input.inputValue().catch(() => "");
    if (currentValue.includes(displayDate)) return true;
  }

  const openedByLabel = await page.evaluate(() => {
    const labels = Array.from(document.querySelectorAll("label, div, span, p"));
    const target = labels.find((el) => {
      const text = String(el.textContent || "").toLowerCase();
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && text.includes("chọn ngày nhận hàng");
    });
    const clickable = target?.closest("div")?.querySelector("input, button, [role='button']") || target;
    if (!clickable) return false;
    clickable.click();
    return true;
  }).catch(() => false);
  if (openedByLabel) {
    await page.waitForTimeout(300);
    if (await clickCoopCheckoutDate(page, displayDate)) return true;
  }

  const dateButton = page.getByText(displayDate, { exact: true }).first();
  if (await dateButton.isVisible({ timeout: 700 }).catch(() => false)) {
    await dateButton.click({ force: true }).catch(() => null);
    return true;
  }

  return false;
}

async function selectCoopCheckoutSlot(page, slotFrom, slotTo) {
  if (!slotFrom || !slotTo) return false;
  const slotText = `${slotFrom} - ${slotTo}`;
  const pickedByDom = await page.evaluate(({ slotFrom, slotTo, slotText }) => {
    const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();
    const isVisible = (el) => {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    };
    const label = Array.from(document.querySelectorAll("label, div, span, p")).find((el) => {
      if (!isVisible(el)) return false;
      return normalize(el.textContent).toLowerCase() === "chọn khung giờ";
    });
    const labelRect = label?.getBoundingClientRect();
    const nodes = Array.from(document.querySelectorAll("button, label, [role='button'], div, span"));
    const candidates = nodes
      .filter((el) => {
        if (!isVisible(el)) return false;
        const rect = el.getBoundingClientRect();
        if (rect.width < 45 || rect.width > 190 || rect.height < 28 || rect.height > 80) return false;
        if (labelRect && (rect.top < labelRect.bottom - 4 || rect.top > labelRect.bottom + 180)) return false;
        const text = normalize(el.textContent);
        if (!text) return false;
        return text === normalize(slotText) || (text.includes(slotFrom) && text.includes(slotTo) && text.length <= 28);
      })
      .map((el) => {
        const rect = el.getBoundingClientRect();
        const text = normalize(el.textContent);
        const tagScore = el.tagName === "BUTTON" ? 8 : el.getAttribute("role") === "button" ? 6 : 0;
        const exactScore = text === normalize(slotText) ? 6 : 0;
        const distanceScore = labelRect ? Math.max(0, 120 - Math.abs(rect.top - labelRect.bottom)) / 20 : 0;
        const areaPenalty = rect.width * rect.height > 9000 ? 4 : 0;
        return { el, score: tagScore + exactScore + distanceScore - areaPenalty };
      })
      .sort((a, b) => b.score - a.score);

    const target = candidates[0]?.el;
    if (!target) return false;
    target.scrollIntoView({ block: "center", inline: "center" });
    target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
    target.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
    target.click();
    return true;
  }, { slotFrom, slotTo, slotText }).catch(() => false);
  if (pickedByDom) return true;

  const slotCandidates = [
    page.locator(`button:has-text("${slotFrom}")`).filter({ hasText: slotTo }).first(),
    page.locator(`[role="button"]:has-text("${slotFrom}")`).filter({ hasText: slotTo }).first(),
    page.locator(`label:has-text("${slotFrom}")`).filter({ hasText: slotTo }).first(),
  ];
  for (const candidate of slotCandidates) {
    if (!(await candidate.isVisible({ timeout: 700 }).catch(() => false))) continue;
    const box = await candidate.boundingBox().catch(() => null);
    if (!box || box.width > 190 || box.height > 90) continue;
    await candidate.scrollIntoViewIfNeeded().catch(() => null);
    await candidate.click({ force: true }).catch(() => null);
    return true;
  }
  return false;
}

async function selectCoopCheckoutSchedule(page, payload, sendLog, sendFrame) {
  const displayDate = formatCoopDisplayDate(payload.deliveryDate);
  const slotFrom = String(payload.slotFrom || "").trim();
  const slotTo = String(payload.slotTo || "").trim();
  const slotText = slotFrom && slotTo ? `${slotFrom} - ${slotTo}` : "";
  if (!displayDate && !slotText) return false;

  sendLog(`Co.opmart: Đang chọn ngày/khung giờ giao ${displayDate || ""} ${slotText || ""} trên checkout...`);
  let pickedDate = false;
  let pickedSlot = false;
  await page.evaluate(() => window.scrollBy(0, Math.floor(window.innerHeight * 0.45))).catch(() => null);

  if (displayDate) {
    pickedDate = await selectCoopCheckoutDate(page, displayDate);
  }

  if (slotText) {
    pickedSlot = await selectCoopCheckoutSlot(page, slotFrom, slotTo);
  }

  if (pickedDate || pickedSlot) {
    await page.waitForTimeout(700);
    await sendFrame?.();
    sendLog(
      `Co.opmart: ${pickedDate ? "Đã chọn ngày nhận hàng" : "Chưa chọn được ngày tự động"}; ${pickedSlot ? "đã chọn khung giờ" : "chưa chọn được khung giờ tự động"}.`,
      pickedDate && pickedSlot ? "success" : "warning"
    );
    return pickedDate && (!slotText || pickedSlot);
  }

  sendLog("Co.opmart: Chưa tự chọn được ngày/khung giờ trên checkout, bạn có thể chọn trực tiếp trên màn hình stream.", "warning");
  return false;
}

async function selectCoopCheckoutScheduleWithRetry(page, payload, sendLog, sendFrame) {
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const ok = await selectCoopCheckoutSchedule(page, payload, sendLog, sendFrame);
    if (ok) return true;
    await page.waitForTimeout(900);
  }
  return false;
}

async function showCartPreview(page, payload, sendLog, sendStatus, sendFrame) {
  sendStatus("coop_assist_opening");
  sendLog("Co.opmart: Đang nạp cart token vào trình duyệt thao tác...");
  await seedCartState(page, payload, sendLog, sendFrame);
  const checkoutUrl = payload.checkoutUrl || payload.cartUrl || "https://cooponline.vn/checkout";
  sendLog("Co.opmart: Đang mở checkout Co.op...");
  await safeGotoCoop(page, checkoutUrl, sendLog, sendFrame);
  await page.waitForTimeout(1500);
  await fillCoopProfilePopup(page, payload, sendLog, sendFrame, 30000);
  await selectCoopCheckoutScheduleWithRetry(page, payload, sendLog, sendFrame);
  sendLog("Co.opmart: Đã mở màn checkout để người dùng thao tác.", "success");
  sendStatus("coop_assist_ready", { url: page.url() });
  await sendFrame?.();
  return { done: true };
}

module.exports = {
  run,
  runCss,
  showCartPreview,
  showProfileSetup
};
