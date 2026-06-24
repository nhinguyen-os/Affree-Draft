/**
 * Playbook for cooponline.vn (Co.opmart Online)
 * Xử lý các bước đặc thù của trang cooponline.vn:
 * 1. Popup chọn địa chỉ giao hàng (bắt buộc, không thể đóng)
 * 2. Tìm kiếm sản phẩm + thêm vào giỏ
 * 3. Checkout + điền thông tin người mua
 *
 * Trả về:
 * - { done: true }  : playbook đã hoàn thành toàn bộ, không cần AI tiếp
 * - { done: false } : đã xử lý bootstrap xong, nhường lại cho AI DOM loop
 */

/**
 * Phân tích địa chỉ đầy đủ thành các thành phần riêng biệt.
 * Ví dụ: "123 Nguyễn Huệ, Phường Bến Nghé, Quận 1, TP. Hồ Chí Minh"
 * → { street: "123 Nguyễn Huệ", ward: "Phường Bến Nghé", district: "Quận 1", province: "TP. Hồ Chí Minh" }
 */
function parseAddress(fullAddress) {
  const parts = fullAddress.split(",").map((s) => s.trim()).filter(Boolean);
  // Chiết xuất theo thứ tự từ cuối
  const province = parts.slice(-1)[0] || "";
  const district = parts.slice(-2, -1)[0] || "";
  const ward = parts.slice(-3, -2)[0] || "";
  const street = parts.slice(0, -3).join(", ") || parts[0] || "";
  return { street, ward, district, province };
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

  const inputSel = `input[placeholder="${inputPlaceholder}"]`;

  try {
    const input = page.locator(inputSel).first();
    if (!(await waitForVisible(input, 3000))) {
      sendLog(`Co.opmart: Không thấy input "${inputPlaceholder}".`, "warning");
      return false;
    }

    // Click vào input, xóa nội dung cũ và gõ giá trị mới từng ký tự
    await input.click();
    await page.waitForTimeout(200);
    await input.fill("");
    await input.type(valueText, { delay: 60 });
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
        const firstOpt = genericOptions[0];
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


async function handleAddressPopup(page, payload, sendLog) {
  const { buyerAddress } = payload;

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

  // Phân tích địa chỉ thành các thành phần
  const addr = parseAddress(buyerAddress);
  sendLog(`Co.opmart: Điền địa chỉ: Tỉnh="${addr.province}" | Quận="${addr.district}" | Phường="${addr.ward}" | Đường="${addr.street}"`);

  // Điền từng cấp theo placeholder và id container dropdown thực tế
  await fillAddressAutocomplete(page, sendLog,
    "Chọn tỉnh/thành phố", "provinceCode", addr.province);
  await page.waitForTimeout(700);

  await fillAddressAutocomplete(page, sendLog,
    "Chọn quận/ huyện", "districtCode", addr.district);
  await page.waitForTimeout(700);

  await fillAddressAutocomplete(page, sendLog,
    "Chọn phường/xã", "wardCode", addr.ward);
  await page.waitForTimeout(700);


  // Điền số nhà, tên đường vào input cuối cùng
  try {
    const streetInput = page.locator('input#address, input[placeholder*="Số nhà" i], input[placeholder*="tên đường" i]').first();
    if (await waitForVisible(streetInput, 1500)) {
      await streetInput.click();
      await streetInput.fill(addr.street);
      sendLog(`Co.opmart: Đã nhập địa chỉ chi tiết: "${addr.street}".`, "success");
      await page.waitForTimeout(400);
    }
  } catch { }


  // Bấm nút xác nhận — dùng selector chính xác từ DOM dump (button[type=submit] text="Xác nhận")

  const confirmSelectors = [
    'button:has-text("Xác nhận")',
    'button:has-text("Lưu địa chỉ")',
    'button:has-text("Lưu")',
    'button:has-text("Tiếp tục")',
    'button:has-text("Đồng ý")',
    'button:has-text("OK")',
    '.teko-modal-show button[class*="primary"]',
    '.teko-modal-show button[type="submit"]',
  ];

  let addressConfirmed = false;
  for (const sel of confirmSelectors) {
    try {
      const btn = page.locator(sel).first();
      if (await waitForVisible(btn, 1000)) {
        await btn.click();
        sendLog("Co.opmart: Đã xác nhận địa chỉ giao hàng.", "success");
        addressConfirmed = true;
        await page.waitForTimeout(1500);
        break;
      }
    } catch { }
  }

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
          if (hasKm) {
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
async function run(page, payload, sendLog, sendStatus) {
  sendLog("Co.opmart Playbook: Bắt đầu...", "success");

  // Bước 1: Xử lý popup địa chỉ nếu có
  await handleAddressPopup(page, payload, sendLog);
  await page.waitForTimeout(1000);

  // Bước 2: Thử thêm vào giỏ hàng trực tiếp
  await searchAndAddToCart(page, payload, sendLog);

  // Bước 3: Kiểm tra đã có sản phẩm trong giỏ chưa, nếu chưa thì trả về AI xử lý
  sendLog("Co.opmart Playbook: Hoàn thành bootstrap. Chuyển sang AI DOM Agent...", "success");
  return { done: false }; // Để AI DOM loop tiếp tục phần checkout
}

module.exports = { run };
