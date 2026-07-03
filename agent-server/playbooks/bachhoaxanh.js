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
 * → { street: "123 Nguyễn Huệ", ward: "Phường Bến Nghé", province: "TP. Hồ Chí Minh" }
 */
function parseAddress(fullAddress) {
  const parts = fullAddress.split(",").map((s) => s.trim()).filter(Boolean);
  // Chiết xuất theo thứ tự từ cuối
  const province = parts.slice(-1)[0] || "";
  const ward = parts.slice(-2, -1)[0] || "";
  const street = parts.slice(-3, -2)[0] || "";
  return { street, ward, province };
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

async function login(page, payload, sendLog, sendMessage) {
  const url = 'https://www.bachhoaxanh.com/dang-nhap'
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(10000);

  const { buyerPhone } = payload;
  sendMessage('Tiến hành đăng nhập.')

  try {
    const phoneInput = page.locator('input#phone, input[placeholder*="Nhập số điện thoại"], input[name*="phone"]').first();
    if (await waitForVisible(phoneInput, 1500)) {
      await phoneInput.click();
      await phoneInput.fill(buyerPhone);
      sendLog(`Bach Hoa Xanh: Đã nhập số điện thoại: "${buyerPhone}".`, "success");
      sendMessage(`Đã nhập số điện thoại ${buyerPhone}.`)
      await page.waitForTimeout(1000);
    }
  } catch { }

  const continueSelector = [
    'button:has-text("Tiếp tục")',
    'button:has-text("TIẾP TỤC")',
  ];

  for (const selector of continueSelector) {
    try {
      const element = await page.locator(selector).first();
      await waitForVisible(element, 10000);
      if (await element.isVisible({ timeout: 3000 })) {
        await element.click({ timeout: 5000 });
        sendLog(`Bach Hoa Xanh: Đã click nút "${selector}"`, "success");
        sendMessage(`Vui lòng nhập mã OTP đã nhận được qua số điện thoại ${buyerPhone}.`, 'input_otp')
        break;
      }
    } catch (e) {
      continue;
    }
  }

  await page.waitForTimeout(500);

  const checkbox = page.locator('#policy-accept-all');

  await waitForVisible(checkbox, 5000);
  if (await checkbox.isVisible()) {
    if (!(await checkbox.isChecked())) {
      await checkbox.check();
      sendLog(`Bach Hoa Xanh: Đã click checkbox "${checkbox}"`, "success");
    }
  }

  await page.waitForTimeout(500);

  const policyContinueSelector = [
    'button:type="button"]:has-text("Xác nhận")',
    'button:has-text("Xác nhận")',
  ];

  for (const selector of policyContinueSelector) {
    try {
      const element = await page.locator(selector).first();
      await waitForVisible(element, 10000);
      if (await element.isVisible({ timeout: 3000 })) {
        await element.click({ timeout: 5000 });
        sendLog(`Bach Hoa Xanh: Đã click nút "${selector}"`, "success");
        sendMessage('Đã đồng ý với điều khoản và điều kiện.');
        break;
      }
    } catch (e) {
      continue;
    }
  }

  return { done: true };
}

async function searchAndAddToCart(page, payload, sendLog, sendMessage) {

  sendMessage("Thêm sản phẩm vào giỏ hàng.");

  const buySelector = [
    'button.cursor-pointer.gap-2:has-text("Mua")',
    'button.cursor-pointer.gap-2:has-text("MUA")',
  ];

  for (const selector of buySelector) {
    try {
      const element = await page.locator(selector).first();
      await waitForVisible(element, 10000);
      if (await element.isVisible({ timeout: 3000 })) {
        await element.click({ timeout: 5000 });
        sendLog(`Bach Hoa Xanh: Đã click nút "${selector}"`, "success");
        break;
      }
    } catch (e) {
      continue;
    }
  }

  await page.waitForTimeout(5000);

  sendLog("Bach Hoa Xanh: Hoàn tất thêm sản phẩm vào giỏ hàng");

  const completeSelector = [
    'button:has-text("hoàn tất")',
    'button:has-text("HOÀN TẤT")',
  ];

  for (const selector of completeSelector) {
    try {
      const element = await page.locator(selector).first();
      await waitForVisible(element, 3000);
      if (await element.isVisible({ timeout: 3000 })) {
        await element.click({ timeout: 5000 });
        sendLog(`Bach Hoa Xanh: Đã click nút "${selector}"`, "success");
        break;
      }
    } catch (e) {
      continue;
    }
  }

  await page.waitForTimeout(500);

  if (payload.qty > 1) {
    try {
      const qtyInput = page.locator('input[type*="number"], input[value*="1"]').first();
      if (await waitForVisible(qtyInput, 1500)) {
        await qtyInput.click();
        await qtyInput.fill(payload.qty.toString());
        sendLog(`Bach Hoa Xanh: Đã nhập số lượng: "${payload.qty}".`, "success");
        await page.waitForTimeout(400);
      }
    } catch { }
  }

  sendMessage(`Đã thêm sản phẩm ${payload.productName} với số lượng ${payload.qty} vào giỏ hàng.`);

  await page.waitForTimeout(1000);

  await page.goto('https://www.bachhoaxanh.com/gio-hang', { waitUntil: "load", timeout: 30000 });

  sendMessage("Đi tới trang giỏ hàng.");
}

async function handleAddressPopup(page, payload, sendLog, sendMessage) {
  const { buyerAddress } = payload;

  await page.goto(payload.url, { waitUntil: "load", timeout: 30000 });
  sendMessage("Đi tới trang sản phẩm.");

  await page.waitForTimeout(10000);

  const addressSelector = [
    'div:has-id("btn_choose_location")',
    'i[class*="icon__location"]',
    'span:has-text("Chọn vị trí giao gần bạn")',
    'span:has-text("Xác nhận địa chỉ nhận hàng")',
  ];

  for (const selector of addressSelector) {
    try {
      const element = await page.locator(selector).first();
      if (await element.isVisible({ timeout: 3000 })) {
        await element.click({ timeout: 5000 });
        sendLog(`Bach Hoa Xanh: Đã click nút chọn địa chỉ "${selector}"`, "success");
        break;
      }
    } catch (e) {
      continue;
    }
  
  }
  await page.waitForTimeout(1000);

  const deleteSelector = [
    'button:text-is("xóa")',
    'button:text-is("Xóa")',
  ];

  for (const selector of deleteSelector) {
    try {
      const element = await page.locator(selector).first();
      if (await element.isVisible({ timeout: 3000 })) {
        await element.click({ timeout: 5000 });
        sendLog(`Bach Hoa Xanh: Đã click nút xóa địa chỉ "${selector}"`, "success");
        break;
      }
    } catch (e) {
      continue;
    }
  }

  await page.waitForTimeout(100);

  const okSelector = [
    'button:has-text("đồng ý")',
    'button:has-text("Đồng ý")',
  ];

  for (const selector of okSelector) {
    try {
      const element = await page.locator(selector).first();
      if (await element.isVisible({ timeout: 3000 })) {
        await element.click({ timeout: 5000 });
        sendLog(`Bach Hoa Xanh: Đã click nút chọn đồng ý xóa địa chỉ "${selector}"`, "success");
        break;
      }
    } catch (e) {
      continue;
    }
  }

  await page.waitForTimeout(1000);

  // Phân tích địa chỉ thành các thành phần
  const addr = parseAddress(buyerAddress);
  sendLog(`Bach Hoa Xanh: Điền địa chỉ: Tỉnh="${addr.province}" | Phường="${addr.ward}" | Đường="${addr.street}"`);
  sendMessage(`Đang điền địa chỉ giao hàng: ${addr.street}, ${addr.ward}, ${addr.province}.`);

  const provinceSelector = [
    `p:has-text("${addr.province}")`,
  ];

  for (const selector of provinceSelector) {
    try {
      const element = await page.locator(selector).first();
      if (await element.isVisible({ timeout: 3000 })) {
        await element.click({ timeout: 5000 });
        sendLog(`Bach Hoa Xanh: Đã click nút chọn tỉnh "${selector}"`, "success");
        sendMessage(`Đã chọn tỉnh ${addr.province}`)
        break;
      }
    } catch (e) {
      continue;
    }
  }

  await page.waitForTimeout(700);

  const wardSelector = [
    `p:has-text("${addr.ward}")`,
  ];

  for (const selector of wardSelector) {
    try {
      const element = await page.locator(selector).first();
      if (await element.isVisible({ timeout: 3000 })) {
        await element.click({ timeout: 5000 });
        sendLog(`Bach Hoa Xanh: Đã click nút chọn phường "${selector}"`, "success");
        sendMessage(`Đã chọn phường/xã ${addr.ward}`)
        break;
      }
    } catch (e) {
      continue;
    }
  }

  await page.waitForTimeout(700);


  // Điền số nhà, tên đường vào input cuối cùng
  try {
    const streetInput = page.locator('input#address, input[placeholder*="Số nhà, tên đường" i], input[name*="address"]').first();
    if (await waitForVisible(streetInput, 1500)) {
      await streetInput.click();
      await streetInput.fill(addr.street);
      sendLog(`Bach Hoa Xanh: Đã nhập địa chỉ chi tiết: "${addr.street}".`, "success");
      sendMessage(`Đã nhập địa chỉ ${addr.street}.`)
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
    'button[type="submit"]',
  ];

  for (const sel of confirmSelectors) {
    try {
      const btn = page.locator(sel).first();
      if (await waitForVisible(btn, 1000)) {
        await btn.click();
        sendLog("Bach Hoa Xanh: Tiếp tục chọn địa chỉ giao hàng.", "success");
        break;
      }
    } catch { }
  }

  await page.waitForTimeout(1000);

  const completeSelectors = [
    'button:has-text("Xác nhận")',
    'button:has-text("Lưu địa chỉ")',
    'button:has-text("Lưu")',
    'button:has-text("Tiếp tục")',
    'button:has-text("Đồng ý")',
    'button:has-text("OK")',
    'button:has-text("Hoàn tất")',
    'button[type="submit"]',
  ];

  for (const sel of completeSelectors) {
    try {
      const btn = page.locator(sel).first();
      if (await waitForVisible(btn, 1000)) {
        await btn.click();
        sendLog("Bach Hoa Xanh: Đã xác nhận địa chỉ giao hàng.", "success");
        sendMessage("Xác nhận địa chỉ giao hàng.");
        break;
      }
    } catch { }
  }
  await page.waitForTimeout(1000);

  sendMessage("Đã hoàn tất chọn địa chỉ giao hàng.");
}

async function checkout(page, payload, sendLog, sendStatus, sendMessage) {
  sendLog("Bach Hoa Xanh: Click Đặt hàng");

  const buySelectors = [
    ".icon__cart-footer",
    'span:has-text("Đặt hàng")',
  ];

  let buyBtn = null;

  for (const sel of buySelectors) {
    try {
      const btn = page.locator(sel).first();

      if (await waitForVisible(btn, 2000)) {
        buyBtn = btn;

        await btn.scrollIntoViewIfNeeded();
        await btn.click();

        sendLog(
          "Bach Hoa Xanh: Click vào nút Đặt hàng.",
          "success"
        );

        break;
      }
    } catch {}
  }

  if (!buyBtn) {
    sendLog(
      "Bach Hoa Xanh: Không tìm thấy nút Đặt hàng.",
      "warning"
    );

    return false;
  }

  await page.waitForTimeout(1000);

  sendMessage("Chọn khung giờ nhận hàng.");

  const popupSelectors = [
    'div:has-text("Tuỳ chọn khung giờ nhận hàng")',
    'div:has-text("Giao ngay")',
    'p:has-text("Giao hàng tiết kiệm (trong 24h)")',
    'input[type="radio"][name="time"]',
  ];

  for (const sel of popupSelectors) {
    try {
      const popup = page.locator(sel).first();

      if (await waitForVisible(popup, 1500)) {
        sendLog(
          "Bach Hoa Xanh: Phát hiện popup chọn thời gian nhận hàng.",
          "info"
        );

        const div = page.locator('div.w-full.bg-white.rounded-lg').first();

        await div.waitFor({
          state: 'visible',
          timeout: 10000
        });

        const html = await div.evaluate(el => el.outerHTML);
        sendMessage(html, "popup_delivery_time");

        break;
      }
    } catch {}
  }
}

/**
 * Entry point của playbook Bach Hoa Xanh
 */
async function run(page, payload, sendLog, sendStatus, sendMessage = null, sendScreenshotFrame = null) {
  // Bước 1: Login
  if (payload?.step === 'otp') {
    try {
      const otpInput = page.locator('input#otp-input').first();
      if (await waitForVisible(otpInput, 1500)) {
        await otpInput.click();
        await otpInput.fill(payload.otp);
        await page.keyboard.press("Enter");
        await page.waitForTimeout(200);
        sendLog(`Bach Hoa Xanh: Đã nhập otp: "${payload.otp}".`, "success");
        sendMessage(`Đã nhập OTP ${payload.otp}.`)
        sendMessage('Đăng nhập thành công.')
        await page.waitForTimeout(2000);
        if (sendScreenshotFrame) await sendScreenshotFrame();
      }
    } catch { }
  } else {
    const loginRes = await login(page, payload, sendLog, sendMessage);
    if (sendScreenshotFrame) await sendScreenshotFrame();
    return loginRes;
  }

  // Bước 2: Xử lý popup địa chỉ giao hàng
  await handleAddressPopup(page, payload, sendLog, sendMessage);
  await page.waitForTimeout(1000);
  if (sendScreenshotFrame) await sendScreenshotFrame();

  // Bước 3: Thêm sản phẩm vào giỏ hàng
  await searchAndAddToCart(page, payload, sendLog, sendMessage);
  await page.waitForTimeout(1000);
  if (sendScreenshotFrame) await sendScreenshotFrame();

  // Bước 4: Tiến hành checkout
  await checkout(page, payload, sendLog, sendStatus, sendMessage);
  if (sendScreenshotFrame) await sendScreenshotFrame();

  sendLog("Bach Hoa Xanh Playbook: Hoàn thành bootstrap. Chuyển sang AI DOM Agent...", "success");
  return { done: true }; // Để AI DOM loop tiếp tục phần checkout
}

module.exports = { run };
