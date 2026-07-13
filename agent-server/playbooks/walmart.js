function normalizeLabel(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

const SELECTORS = {
  accountTrigger: [
    'a[aria-label*="Sign In" i]',
    'a[href*="signin" i]',
    'a[href*="account" i]',
    'button[aria-label*="Account" i]',
    'button:has-text("Account")',
  ],
  signInLink: [
    'a:has-text("Sign in or create account")',
    'button:has-text("Sign in or create account")',
    'a[href*="signin" i]',
  ],
  emailInput: [
    'input[name="Phone number or email (required)"]',
    'input[type="email"]',
    'input[autocomplete="username"]',
  ],
  continueButton: [
    'button#login-continue-button',
    'button[type="submit"]',
  ],
  passwordMethod: [
    'label:has-text("Password")',
    'label:has-text("Use password")',
    'label:has-text("Use your password")',
    'label:has-text("Sign in with password")',
    '[role="radio"]:has-text("Password")',
    '[role="radio"][aria-label*="password" i]',
    'button:has-text("Password")',
    'button:has-text("Use password")',
    'button:has-text("Use your password")',
    'input[type="radio"][value*="password" i]',
    'input[type="radio"][aria-label*="password" i]',
  ],
  methodContinueButton: [
    'button:has-text("Continue")',
    'button#login-continue-button',
    'button[type="submit"]',
  ],
  passwordInput: [
    'input#sign-in-password-no-otp',
    'input[autocomplete="current-password"]',
    'input[name="password"][type="password"]',
    'input[type="password"]',
  ],
  signInButton: [
    'button#withpassword-sign-in-button',
    'button[type="submit"]',
  ],
  addToCart: [
    'button[data-automation-id="add-to-cart"]',
    'button[data-testid="add-to-cart"]',
    'button[aria-label^="Add to cart -" i]',
    'button:has-text("Add to cart")',
  ],
  checkout: [
    'button[data-automation-id="checkout"]',
    'button[data-testid="checkout"]',
    'button:has-text("Continue to checkout")',
    'button[aria-label="Continue to checkout button"]',
    'button:has-text("Check out")',
    'button:has-text("Checkout")',
    'a:has-text("Checkout")',
  ],
};

function cssAttr(value) {
  return String(value || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

async function firstVisible(page, selectors) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if (await locator.isVisible().catch(() => false)) return locator;
  }
  return null;
}

async function waitForFirstVisible(page, selectors, timeoutMs = 5000, pollMs = 120) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const locator = await firstVisible(page, selectors);
    if (locator) return locator;
    await page.waitForTimeout(pollMs);
  }
  return null;
}

function humanDelay(min = 450, max = 1100) {
  return Math.floor(min + Math.random() * Math.max(1, max - min));
}

async function humanPause(page, min = 450, max = 1100) {
  await page.waitForTimeout(humanDelay(min, max));
}

async function humanClick(page, locator, options = {}) {
  await locator.scrollIntoViewIfNeeded().catch(() => { });
  await humanPause(page, options.beforeMin ?? 350, options.beforeMax ?? 950);
  await locator.click({ timeout: options.timeout ?? 5000 }).catch(async () => {
    await humanPause(page, 250, 650);
    await locator.click({ force: true, timeout: options.timeout ?? 5000 });
  });
  await humanPause(page, options.afterMin ?? 650, options.afterMax ?? 1400);
}

async function humanFill(page, locator, value, options = {}) {
  await locator.scrollIntoViewIfNeeded().catch(() => { });
  await humanPause(page, options.beforeMin ?? 250, options.beforeMax ?? 700);
  await locator.click({ timeout: 4000 }).catch(async () => locator.click({ force: true, timeout: 4000 }));
  await humanPause(page, 120, 320);
  await locator.press("Control+A").catch(() => { });
  await locator.press("Meta+A").catch(() => { });
  await locator.press("Backspace").catch(() => { });
  await humanPause(page, 120, 300);
  await locator.type(String(value), { delay: options.delay ?? humanDelay(55, 105) }).catch(async () => locator.fill(String(value)));
  await humanPause(page, options.afterMin ?? 250, options.afterMax ?? 700);
}

/** Xử lý các modal Walmart đã biết bằng Playwright, không gọi AI. */
async function handleKnownModal(page) {
  const dialog = page.locator('[role="dialog"]').last();
  if (!await dialog.isVisible().catch(() => false)) return { handled: false, reason: "no_dialog" };
  const text = normalizeLabel(await dialog.innerText().catch(() => ""));

  if (/remove address\?|remove this address from your account/i.test(text)) {
    const removeButton = dialog.locator([
      'button[data-dca-intent="deselect"]:has-text("Remove")',
      'button:has-text("Remove")',
    ].join(", ")).last();
    if (!await removeButton.isVisible().catch(() => false)) return { handled: false, reason: "remove_address_button_not_found" };
    await humanClick(page, removeButton, { beforeMin: 700, beforeMax: 1500, afterMin: 700, afterMax: 1400 });
    await dialog.waitFor({ state: "hidden", timeout: 5000 }).catch(() => { });
    return { handled: true, action: "remove_address_confirmed" };
  }

  if (/remove item\?|remove this item|are you sure.*remove/i.test(text)) {
    const removeButton = dialog.locator('button:has-text("Remove")').last();
    if (await removeButton.isVisible().catch(() => false)) {
      await humanClick(page, removeButton, { beforeMin: 700, beforeMax: 1500, afterMin: 700, afterMax: 1400 });
      await dialog.waitFor({ state: "hidden", timeout: 5000 }).catch(() => { });
      return { handled: true, action: "remove_item_confirmed" };
    }
  }

  if (/unable to verify address|couldn'?t verify your address/i.test(text)) {
    const saveAddressButton = dialog.locator([
      'button:has-text("No, save this address")',
      'a:has-text("No, save this address")',
      '[role="button"]:has-text("No, save this address")',
    ].join(", ")).last();
    if (!await saveAddressButton.isVisible().catch(() => false)) return { handled: false, reason: "save_unverified_address_button_not_found" };
    await humanClick(page, saveAddressButton, { beforeMin: 900, beforeMax: 1800, afterMin: 1000, afterMax: 1800 });
    await dialog.waitFor({ state: "hidden", timeout: 7000 }).catch(() => { });
    return { handled: true, action: "unverified_address_saved" };
  }

  if (/having trouble with your request|please wait a moment and then try again/i.test(text)) {
    const okButton = dialog.locator([
      'button:has-text("Okay")',
      'button:has-text("OK")',
      'button[aria-label*="Close" i]',
    ].join(", ")).last();
    if (!await okButton.isVisible().catch(() => false)) return { handled: false, reason: "trouble_request_button_not_found" };
    await humanClick(page, okButton, { beforeMin: 1200, beforeMax: 2400, afterMin: 2000, afterMax: 3800 });
    await dialog.waitFor({ state: "hidden", timeout: 7000 }).catch(() => { });
    return { handled: true, action: "trouble_request_dismissed" };
  }

  return { handled: false, reason: "unknown_dialog", text: text.slice(0, 240) };
}

async function productDomSignature(page) {
  return page.evaluate(() => {
    const visible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    };
    const title = Array.from(document.querySelectorAll("h1")).find(visible)?.textContent || "";
    const variants = Array.from(document.querySelectorAll(
      '[data-testid="variant-tile-chip"], [data-testid^="variant-tile-chip"]'
    )).filter(visible);
    const addButton = Array.from(document.querySelectorAll("button")).find((button) => {
      if (!visible(button)) return false;
      const label = `${button.getAttribute("aria-label") || ""} ${button.textContent || ""}`;
      return /add to cart/i.test(label);
    });
    return `${title.replace(/\s+/g, " ").trim()}|${variants.length}|${Boolean(addButton)}`;
  }).catch(() => "");
}

async function waitForProductReady(page, timeoutMs = 7000) {
  const deadline = Date.now() + timeoutMs;
  let lastSignature = "";
  let stableSince = 0;

  while (Date.now() < deadline) {
    const signature = await productDomSignature(page);
    if (signature && signature !== "||false") {
      if (signature === lastSignature) {
        if (!stableSince) stableSince = Date.now();
        if (Date.now() - stableSince >= 300) return true;
      } else {
        lastSignature = signature;
        stableSince = Date.now();
      }
    }
    await page.waitForTimeout(120);
  }

  return Boolean(await firstVisible(page, ["h1", ...SELECTORS.addToCart]));
}

async function cartIsReady(page) {
  return page.evaluate(() => {
    const text = document.body?.innerText || "";
    const cartLabel = Array.from(document.querySelectorAll('[aria-label*="Cart contains" i]'))
      .map((node) => node.getAttribute("aria-label") || "")
      .join(" ");
    return /added to cart/i.test(text)
      || /cart contains\s+[1-9]\d*\s+item/i.test(cartLabel)
      || /\/cart(?:\/|\?|$)/i.test(location.pathname);
  }).catch(() => false);
}

async function waitForCartReady(page, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await cartIsReady(page)) return true;
    await page.waitForTimeout(140);
  }
  return false;
}

async function checkoutDomSignature(page) {
  return page.evaluate(() => {
    const text = String(document.body?.innerText || "").replace(/\s+/g, " ");
    const headings = Array.from(document.querySelectorAll("h1, h2, h3"))
      .map((node) => String(node.textContent || "").replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .slice(0, 8)
      .join("|");
    const optionCount = document.querySelectorAll(
      'input[type="radio"], [role="radio"], button[data-automation-id], button[data-testid]'
    ).length;
    const hasCheckoutCopy = /checkout|shipping address|delivery|pickup|payment|review order/i.test(text);
    return `${location.pathname}|${headings}|${optionCount}|${hasCheckoutCopy}`;
  }).catch(() => "");
}

async function waitForCheckoutReady(page, timeoutMs = 7000) {
  const deadline = Date.now() + timeoutMs;
  let lastSignature = "";
  let stableSince = 0;

  while (Date.now() < deadline) {
    if (!/walmart\.com\/checkout(?:\/|\?|$)/i.test(page.url())) {
      await page.waitForTimeout(120);
      continue;
    }

    const signature = await checkoutDomSignature(page);
    if (signature && !signature.endsWith("|0|false")) {
      if (signature === lastSignature) {
        if (!stableSince) stableSince = Date.now();
        if (Date.now() - stableSince >= 240) return true;
      } else {
        lastSignature = signature;
        stableSince = Date.now();
      }
    }
    await page.waitForTimeout(120);
  }

  return /walmart\.com\/checkout(?:\/|\?|$)/i.test(page.url());
}

async function checkoutHandoffReady(page) {
  if (/walmart\.com\/checkout(?:\/|\?|$)/i.test(page.url())) return true;
  return page.evaluate(() => {
    const visible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    };
    const text = String(document.body?.innerText || "").replace(/\s+/g, " ");
    const hasAddressForm = Array.from(document.querySelectorAll('input, form, [role="dialog"]'))
      .filter(visible)
      .some((element) => /street address|shipping address|add address|delivery address|address line/i.test(
        `${element.getAttribute("aria-label") || ""} ${element.getAttribute("placeholder") || ""} ${element.textContent || ""}`
      ));
    return hasAddressForm || /select or add an address|where should we deliver|add a delivery address/i.test(text);
  }).catch(() => false);
}

async function enrichVariantPreviews(page, groups) {
  const colorGroup = groups.find((group) => group.key === "color");
  if (!colorGroup || colorGroup.options.length > 14) return groups;

  const getMainImage = () => page.evaluate(() => {
    const visible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 60 && rect.height > 60 && style.display !== "none" && style.visibility !== "hidden";
    };
    return Array.from(document.images)
      .map((image) => {
        const rect = image.getBoundingClientRect();
        return {
          src: image.currentSrc || image.src,
          area: rect.width * rect.height,
          top: rect.top,
          left: rect.left,
          visible: visible(image),
        };
      })
      .filter((image) => image.visible && /walmartimages\.com/i.test(image.src))
      .sort((a, b) => b.area - a.area || a.top - b.top || a.left - b.left)[0]?.src || "";
  }).catch(() => "");

  for (const option of colorGroup.options) {
    if (!option.id || option.disabled) continue;
    const locator = page.locator(`[data-affree-option-id="${cssAttr(option.id)}"]`).first();
    if (!await locator.isVisible().catch(() => false)) continue;
    await locator.hover({ timeout: 700 }).catch(() => {});
    await page.waitForTimeout(90);
    const previewImage = await getMainImage();
    if (previewImage) option.previewImage = previewImage;
  }

  return groups;
}

async function extractOptionGroupsStable(page, mode = "variant", retries = 3, delayMs = 400) {
  let groups = [];
  for (let attempt = 0; attempt < retries; attempt++) {
    groups = await extractOptionGroups(page, mode);
    const hasDisabledInfo = groups.some((g) => g.options.some((o) => o.disabled));
    if (hasDisabledInfo || attempt === retries - 1) break;
    await page.waitForTimeout(delayMs);
  }
  return groups;
}

async function extractOptionGroups(page, mode = "variant") {
  const groups = await page.evaluate(({ mode }) => {
    const visible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    };
    const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
    const lower = (value) => clean(value).toLowerCase();
    const sizePattern = /^(?:xxxs|xxs|xs|s|m|l|xl|xxl|xxxl|[0-9]{1,3}(?:\.[0-9])?|[0-9]{1,3}x[0-9]{1,3}|[0-9]{1,3}\s*[-–]\s*[0-9]{1,3})$/i;
    const paymentPattern = /paypal|credit|debit|visa|mastercard|amex|gift card|affirm|onepay|ebt/i;
    const deliveryPattern = /shipping|delivery|pickup|store pickup|curbside/i;
    const slotPattern = /(?:today|tomorrow|mon|tue|wed|thu|fri|sat|sun).*(?:am|pm)|\d{1,2}:\d{2}\s*(?:am|pm)/i;
    const candidates = Array.from(document.querySelectorAll(
      'button, [role="button"], [role="radio"], input[type="radio"], label, [data-testid="variant-tile-chip"]'
    )).filter(visible);
    const groups = new Map();
    let sequence = 0;

    const add = (group, element, label, description = "") => {
      const text = clean(label);
      if (!text || text.length > 120) return;
      const id = `affree-${mode}-${group}-${sequence++}`;
      element.setAttribute("data-affree-option-id", id);
      const disabled = element.matches(':disabled, [aria-disabled="true"]') || Boolean(element.closest(':disabled, [aria-disabled="true"]'));
      const selected = element.matches(':checked, [aria-checked="true"], [aria-pressed="true"], [data-selected="true"]') || Boolean(element.querySelector(':checked'));
      const option = { id, label: text, description: clean(description), disabled, selected };
      const existing = groups.get(group) || [];
      if (!existing.some((item) => lower(item.label) === lower(text))) existing.push(option);
      groups.set(group, existing);
    };

    if (mode === "variant") {
      const cssUrl = (value) => {
        const match = String(value || "").match(/url\(["']?(.+?)["']?\)/i);
        return match?.[1] || "";
      };
      const classText = (element) => [
        element.className,
        ...Array.from(element.querySelectorAll("*")).map((node) => node.className || ""),
      ].join(" ");
      const dataLabel = (element) => {
        const node = element.querySelector('[data-testid^="desktop-variant-label-"]');
        const testId = node?.getAttribute("data-testid") || "";
        const fromId = testId.replace(/^desktop-variant-label-/, "").replace(/[-_]+/g, " ");
        return clean(fromId || node?.textContent || "");
      };
      const priceInfo = (element) => {
        const text = clean(element.textContent);
        const normalizePrice = (value) => clean(value).match(/\$\d[\d,]*(?:\.\d{2})?/)?.[0] || "";
        const nodePrice = normalizePrice(element.querySelector('[data-testid^="variant-tile-price-text-"]')?.textContent);
        const prices = text.match(/\$\d[\d,]*(?:\.\d{2})?/g) || [];
        const price = nodePrice || prices[0] || "";
        const compareAt = prices.find((value) => value !== price) || "";
        return { price, compareAt };
      };
      const selectedValue = (prefix) => {
        const elements = Array.from(document.querySelectorAll("h1,h2,h3,h4,div,span,p")).filter(visible);
        for (const element of elements) {
          const ownText = clean(Array.from(element.childNodes)
            .filter((node) => node.nodeType === 3)
            .map((node) => node.textContent)
            .join(" "));
          const text = ownText || clean(element.textContent);
          if (text.length > 100 || !prefix.test(text)) continue;
          const value = clean(text
            .replace(prefix, "")
            .replace(/size guide.*$/i, "")
            .replace(/^[:\s]+/, ""));
          if (value) return value;
        }
        return "";
      };
      const currentColor = selectedValue(/^(?:color|colour)\s*:?\s*/i);
      const currentSize = selectedValue(/^(?:clothing size|shoe size|size)\s*:?\s*/i);
      const normalizeSize = (value) => {
        const source = clean(value).toUpperCase().replace(/([0-9]{1,3}X[0-9]{1,3})\1/g, "$1");
        const numberSize = source.match(/\b[0-9]{1,3}\s*X\s*[0-9]{1,3}\b/)?.[0]?.replace(/\s+/g, "");
        if (numberSize) return numberSize;
        const ranged = source.match(/\b[0-9]{1,3}\s*[-–]\s*[0-9]{1,3}\b/)?.[0]?.replace(/\s+/g, "");
        if (ranged) return ranged;
        return source.match(/\b(?:XXXS|XXS|XS|XXXL|XXL|XL|S|M|L)\b/)?.[0] || "";
      };
      const isDisabled = (element) => {
        const text = clean([element.textContent, element.getAttribute("aria-label"), element.getAttribute("title")].join(" "));
        // Kiểm tra element có gạch chéo strikethrough (Walmart dùng div[data-testid="tile-strikethrough"])
        const hasStrikethrough = Boolean(element.querySelector('[data-testid="tile-strikethrough"]'));
        // Walmart dùng class "bg-nearer-white" + text màu "gray" cho out of stock chip
        const classStr = String(element.className || "") + " " + String(element.querySelector('[data-testid^="desktop-variant-label"]')?.className || "");
        const hasOosClass = /\bbg-nearer-white\b/.test(classStr);
        return element.matches(':disabled, [aria-disabled="true"]')
          || Boolean(element.closest(':disabled, [aria-disabled="true"]'))
          || /out of stock|not available|unavailable/i.test(text)
          || hasStrikethrough
          || hasOosClass;
      };
      const isSelected = (element, label, current) => {
        const classes = classText(element);
        return element.matches(':checked, [aria-checked="true"], [aria-pressed="true"], [data-selected="true"]')
          || Boolean(element.querySelector(':checked'))
          || /\bselected\b/i.test(classes)
          || (current && lower(label) === lower(current));
      };
      const variantContainers = Array.from(document.querySelectorAll('[data-testid^="variant-group-"]')).filter(visible);
      const colorContainer = variantContainers.find((element) => /(?:^|\s)color\s*:/i.test(clean(element.textContent)));
      const sizeContainer = variantContainers.find((element) => /(?:clothing size|shoe size|size)\s*:/i.test(clean(element.textContent)));
      const headings = Array.from(document.querySelectorAll("h1,h2,h3,h4,div,span,p")).filter((element) => {
        if (!visible(element)) return false;
        const ownText = clean(Array.from(element.childNodes).filter((node) => node.nodeType === 3).map((node) => node.textContent).join(" "));
        const text = ownText || clean(element.textContent);
        return text.length <= 100 && /^(?:color|colour|clothing size|shoe size|size)\s*:/i.test(text);
      });
      const colorHeading = headings.find((element) => /^(?:color|colour)\s*:/i.test(clean(element.textContent)));
      const sizeHeading = headings.find((element) => /^(?:clothing size|shoe size|size)\s*:/i.test(clean(element.textContent)));
      const colorRect = colorHeading?.getBoundingClientRect();
      const sizeRect = sizeHeading?.getBoundingClientRect();
      const allChips = Array.from(document.querySelectorAll('[data-testid="variant-tile-chip"], [data-testid^="variant-tile-chip"]')).filter(visible);
      const fromContainer = (container) => container
        ? Array.from(container.querySelectorAll('[data-testid="variant-tile-chip"], [data-testid^="variant-tile-chip"]')).filter(visible)
        : [];
      const fallbackBetween = (top, bottom) => allChips.filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.top >= top - 8 && rect.bottom <= bottom + 8;
      });
      const colorChips = fromContainer(colorContainer).length
        ? fromContainer(colorContainer)
        : (colorRect && sizeRect ? fallbackBetween(colorRect.bottom, sizeRect.top) : []);
      const sizeChips = fromContainer(sizeContainer).length
        ? fromContainer(sizeContainer)
        : (sizeRect ? allChips.filter((element) => {
          const rect = element.getBoundingClientRect();
          return rect.top >= sizeRect.bottom - 8 && rect.top <= sizeRect.top + 520;
        }) : []);

      const colorOptions = [];
      const sizeOptions = [];
      let sequence = 0;
      const pushUnique = (items, option) => {
        if (!option.label || items.some((item) => lower(item.label) === lower(option.label))) return;
        items.push(option);
      };

      for (const element of colorChips) {
        const swatch = element.querySelector('[data-testid="vt-swatch"]');
        const rawLabel = clean([
          swatch?.getAttribute("aria-label"),
          dataLabel(element),
          element.getAttribute("aria-label"),
          element.getAttribute("title"),
          element.textContent,
        ].filter(Boolean).join(" "));
        const label = clean(rawLabel
          .replace(/\$\d[\d,]*(?:\.\d{2})?/g, "")
          .replace(/\b(?:color|colour)\s*:?\s*/ig, "")
          .replace(/out of stock/ig, "")
          .split(",")[0]);
        if (!label || label.length > 56 || sizePattern.test(label)) continue;
        const id = `affree-variant-color-${sequence++}`;
        element.setAttribute("data-affree-option-id", id);
        const { price, compareAt } = priceInfo(element);
        const swatchImage = element.querySelector("img")?.currentSrc
          || element.querySelector("img")?.src
          || cssUrl(window.getComputedStyle(swatch || element).backgroundImage);
        pushUnique(colorOptions, {
          id,
          label,
          price,
          compareAt,
          swatchImage,
          previewImage: swatchImage,
          disabled: isDisabled(element),
          selected: isSelected(element, label, currentColor),
          kind: "color",
        });
      }

      for (const element of sizeChips) {
        const rawLabel = clean([
          dataLabel(element),
          element.getAttribute("aria-label"),
          element.getAttribute("title"),
          element.textContent,
        ].filter(Boolean).join(" "));
        const label = normalizeSize(rawLabel);
        if (!label || !sizePattern.test(label)) continue;
        const id = `affree-variant-size-${sequence++}`;
        element.setAttribute("data-affree-option-id", id);
        pushUnique(sizeOptions, {
          id,
          label,
          disabled: isDisabled(element),
          selected: isSelected(element, label, currentSize),
          kind: "size",
        });
      }

      return [
        colorOptions.length ? { key: "color", title: "Màu sắc", selectedLabel: currentColor, options: colorOptions } : null,
        sizeOptions.length ? { key: "size", title: "Kích thước", selectedLabel: currentSize, options: sizeOptions } : null,
      ].filter(Boolean);
    }

    for (const element of candidates) {
      const aria = clean(element.getAttribute("aria-label"));
      const text = clean(element.textContent || element.getAttribute("value"));
      const label = aria || text;
      if (!label) continue;
      const context = lower(element.closest('fieldset, section, [role="group"], [data-testid]')?.textContent || element.parentElement?.textContent || "");

      if (paymentPattern.test(label) || paymentPattern.test(context) && element.matches('[role="radio"], input[type="radio"]')) {
        add("payment", element, label);
      } else if (slotPattern.test(label)) {
        add("slot", element, label);
      } else if (deliveryPattern.test(label) && label.length < 80) {
        add("delivery", element, label);
      }
    }

    const titles = {
      color: "Màu sắc",
      size: "Kích thước",
      delivery: "Hình thức nhận hàng",
      slot: "Khung giờ giao/nhận",
      payment: "Phương thức thanh toán",
    };
    return Array.from(groups.entries())
      .map(([key, options]) => ({ key, title: titles[key] || key, options }))
      .filter((group) => group.options.length > 0);
  }, { mode }).catch(() => []);

  return mode === "variant" ? enrichVariantPreviews(page, groups) : groups;
}

async function applyOptions(page, selections = {}) {
  const applied = [];
  const orderedGroups = ["color", "size", ...Object.keys(selections || {}).filter((key) => !["color", "size"].includes(key))];
  for (const group of orderedGroups) {
    const selection = selections?.[group];
    if (!selection) continue;
    const requestedId = typeof selection === "string" ? selection : selection.id;
    const requestedLabel = typeof selection === "string" ? "" : selection.label;
    const freshGroups = await extractOptionGroups(page, "variant");
    const freshOption = freshGroups.find((item) => item.key === group)?.options.find((item) => (
      (requestedLabel && normalizeLabel(item.label).toLowerCase() === normalizeLabel(requestedLabel).toLowerCase())
      || item.id === requestedId
    ));
    const optionId = freshOption?.id || requestedId;
    const locator = page.locator(`[data-affree-option-id="${String(optionId || "").replace(/"/g, '\\"')}"]`);
    if (!optionId || await locator.count() !== 1 || !await locator.isVisible().catch(() => false)) {
      throw new Error(`Walmart option ${group} không còn khả dụng trên trang.`);
    }
    if (freshOption?.disabled) throw new Error(`Walmart option ${freshOption.label} đã hết hàng.`);
    await locator.click();
    await page.waitForTimeout(group === "color" ? 650 : 250);
    applied.push(group);
  }
  return applied;
}

async function hasVariantControls(page) {
  return page.evaluate(() => {
    const visible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    };
    const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
    const variantHeading = Array.from(document.querySelectorAll("h1, h2, h3, h4, div, span, p")).find((element) => {
      if (!visible(element)) return false;
      const ownText = clean(Array.from(element.childNodes)
        .filter((node) => node.nodeType === 3)
        .map((node) => node.textContent)
        .join(" "));
      const fullText = clean(element.textContent);
      const headingText = ownText || fullText;
      return headingText.length <= 80 && /^(?:color|colour|clothing size|shoe size|size)\s*:/i.test(headingText);
    });
    if (variantHeading) return true;

    return Array.from(document.querySelectorAll(
      '[data-testid="variant-tile-chip"], button[data-automation-id*="variant" i], [aria-label*="Color" i], [aria-label*="Size" i]'
    )).some(visible);
  }).catch(() => false);
}

async function addProductToCart(page, payload = {}) {
  const addButton = await waitForFirstVisible(page, SELECTORS.addToCart, 3500);
  if (!addButton) return { success: false, reason: "add_button_not_found" };

  await humanClick(page, addButton, { beforeMin: 600, beforeMax: 1400, afterMin: 900, afterMax: 1800 });
  const firstItemReady = await waitForCartReady(page);
  if (!firstItemReady) return { success: false, reason: "cart_not_updated" };

  const quantity = Math.max(1, Math.floor(Number(payload.qty) || 1));
  for (let index = 1; index < quantity; index += 1) {
    const incrementSelectors = [
      'button[aria-label*="Increase quantity" i]',
      'button[data-automation-id*="increment" i]',
      'button:has-text("+")',
    ];
    let clicked = false;
    for (const selector of incrementSelectors) {
      const locator = page.locator(selector);
      const count = await locator.count();
      if (count === 1 && await locator.isVisible().catch(() => false)) {
        await humanClick(page, locator, { beforeMin: 350, beforeMax: 900, afterMin: 500, afterMax: 1000 });
        clicked = true;
        break;
      }
    }
    if (!clicked) break;
  }

  return { success: await cartIsReady(page) };
}

async function openCheckoutFromCart(page) {
  if (!/walmart\.com\/cart(?:\/|\?|$)/i.test(page.url()) && !/walmart\.com\/checkout(?:\/|\?|$)/i.test(page.url())) {
    await page.goto("https://www.walmart.com/cart", { waitUntil: "domcontentloaded", timeout: 25000 });
  }

  if (/walmart\.com\/checkout(?:\/|\?|$)/i.test(page.url())) {
    await waitForCheckoutReady(page);
    return { success: true, alreadyCheckout: true };
  }

  // Cart sidebar is sticky and frequently re-renders. Never keep one locator
  // across the click/wait cycle: reacquire and retry deterministically instead
  // of handing this obvious button back to the AI (which tends to scroll).
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await handleKnownModal(page).catch(() => ({ handled: false }));
    const checkoutButton = await waitForFirstVisible(page, [
      'button:has-text("Continue to checkout")',
      'button[aria-label="Continue to checkout button"]',
      ...SELECTORS.checkout,
    ], attempt === 0 ? 7000 : 3000);
    if (!checkoutButton) {
      await page.waitForTimeout(500);
      continue;
    }

    await checkoutButton.scrollIntoViewIfNeeded().catch(() => { });
    await humanPause(page, 700, 1600);
    const enabled = await checkoutButton.isEnabled().catch(() => false);
    if (!enabled) {
      await page.waitForTimeout(700);
      continue;
    }

    let clicked = await humanClick(page, checkoutButton, { beforeMin: 500, beforeMax: 1200, afterMin: 900, afterMax: 1800, timeout: 4000 }).then(() => true).catch(() => false);
    if (!clicked) {
      clicked = await checkoutButton.click({ force: true, timeout: 2500 }).then(() => true).catch(() => false);
    }
    if (!clicked) {
      clicked = await page.evaluate(() => {
        const candidates = Array.from(document.querySelectorAll("button, a, [role=button]"));
        const target = candidates.find((element) => /continue\s+to\s+checkout/i.test(String(element.textContent || element.getAttribute("aria-label") || "")));
        if (!target) return false;
        target.click();
        return true;
      }).catch(() => false);
    }
    if (!clicked) continue;

    const deadline = Date.now() + 9000;
    while (Date.now() < deadline) {
      if (await checkoutHandoffReady(page)) {
        if (/walmart\.com\/checkout(?:\/|\?|$)/i.test(page.url())) await waitForCheckoutReady(page);
        return { success: true, attempts: attempt + 1 };
      }
      await page.waitForTimeout(250);
    }

    // The React handler may have been attached to a node Walmart replaced
    // during pricing refresh. The next iteration reacquires the live button.
    await page.waitForTimeout(500);
  }

  return { success: false, reason: "checkout_click_did_not_navigate" };
}

async function advanceCheckoutToPayment(page) {
  const checkout = await openCheckoutFromCart(page);
  if (!checkout.success) return checkout;
  await waitForCheckoutReady(page, 12000);

  const cardInputSelectors = [
    'input[autocomplete="cc-number"]', 'input[name*="cardNumber" i]',
    'input[id*="cardNumber" i]', 'input[aria-label*="card number" i]'
  ];
  if (await firstVisible(page, cardInputSelectors)) return { success: true, paymentReady: true };

  const continueAddress = await waitForFirstVisible(page, [
    'button:has-text("Continue")',
    'button[data-automation-id*="continue" i]',
    'button[data-testid*="continue" i]',
  ], 8000);
  if (!continueAddress) return { success: false, reason: "address_continue_button_not_found" };
  await humanClick(page, continueAddress, { beforeMin: 900, beforeMax: 1800, afterMin: 1400, afterMax: 2600 });
  const cardInput = await waitForFirstVisible(page, cardInputSelectors, 12000);
  return cardInput
    ? { success: true, paymentReady: true }
    : { success: false, reason: "payment_form_not_ready" };
}

async function run() {
  return { done: false };
}

/**
 * Fill input trong React app (Walmart dùng controlled inputs).
 * locator.fill() không trigger React's synthetic event → dùng page.evaluate
 * để set native value + dispatch input/change event.
 */
async function fillReactInput(page, selector, value) {
  if (!value) return false;
  return page.evaluate(({ sel, val }) => {
    const el = document.querySelector(sel);
    if (!el) return false;
    const nativeInput = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value");
    nativeInput.set.call(el, val);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new Event("blur", { bubbles: true }));
    return true;
  }, { sel: selector, val: value }).catch(() => false);
}

async function selectReactOption(page, selector, value) {
  if (!value) return false;
  return page.evaluate(({ sel, val }) => {
    const el = document.querySelector(sel);
    if (!el) return false;
    const nativeSelect = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value");
    nativeSelect.set.call(el, val);
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }, { sel: selector, val: value }).catch(() => false);
}


/**
 * Quản lý địa chỉ giao hàng tại /account/delivery-addresses:
 * - Xóa tất cả địa chỉ cũ
 * - Add địa chỉ mới từ payload
 * Chạy sau khi login, trước khi vào PDP.
 */
async function syncDeliveryAddress(page, payload = {}) {
  const address = payload.address || {};
  const firstName = String(address.firstName || (payload.buyerName || "").split(" ")[0] || "").trim();
  const lastName = String(address.lastName || (payload.buyerName || "").split(" ").slice(1).join(" ") || "").trim();
  const street = String(address.street || "").trim();
  const apt = String(address.apt || "").trim();
  const city = String(address.city || "").trim();
  const state = String(address.state || "").trim();
  const zipCode = String(address.zipCode || "").trim();
  const phone = String(address.phone || payload.buyerPhone || "").replace(/\D/g, "").slice(-10);

  if (!street || !city || !state || !zipCode) {
    return { success: false, reason: "missing_address_fields" };
  }

  await page.goto("https://www.walmart.com/account/delivery-addresses", {
    waitUntil: "domcontentloaded",
    timeout: 20000,
  });
  await page.waitForTimeout(1200);

  // Xóa tất cả địa chỉ cũ
  let deleteAttempts = 0;
  while (deleteAttempts < 10) {
    const deleteBtn = await firstVisible(page, [
      'button[aria-label^="Delete address" i]',
      'button[aria-label*="Remove address" i]',
      'button[aria-label^="Remove" i]',
      'button[data-testid*="remove-address" i]',
      'button[data-automation-id*="remove-address" i]',
      'button:has-text("Delete")',
      'button:has-text("Remove")',
    ]);
    if (!deleteBtn) break;
    await deleteBtn.click({ timeout: 4000 });
    await page.waitForTimeout(600);
    const knownModal = await handleKnownModal(page);
    if (knownModal.handled) {
      await page.waitForTimeout(600);
      deleteAttempts++;
      continue;
    }
    // Confirm dialog nếu có
    const confirmBtn = await firstVisible(page, [
      'button:has-text("Yes")',
      'button:has-text("Confirm")',
      'button[data-automation-id*="confirm" i]',
    ]);
    if (confirmBtn) {
      await confirmBtn.click();
      await page.waitForTimeout(600);
    }
    deleteAttempts++;
  }

  const oldAddressStillPresent = await firstVisible(page, [
    'button[aria-label^="Delete address" i]',
    'button[aria-label*="Remove address" i]',
    'button[data-testid*="remove-address" i]',
    'button[data-automation-id*="remove-address" i]',
  ]);
  if (oldAddressStillPresent) {
    return { success: false, reason: "old_address_not_removed" };
  }

  // Click "+ Add address" — trang /account/delivery-addresses dùng text "+ Add address"
  const addBtn = await waitForFirstVisible(page, [
    'button:has-text("+ Add address")',
    'button:has-text("Add address")',
    'button:has-text("Add new address")',
    'a:has-text("Add address")',
    'h3:has-text("Add address")',
  ], 5000);
  if (!addBtn) {
    // Fallback: tìm bất kỳ element có text "+ Add address" hoặc "Add address"
    const clicked = await page.evaluate(() => {
      const all = Array.from(document.querySelectorAll('button, a, h3, [role="button"]'));
      const el = all.find((e) => /\+?\s*add\s+address/i.test(e.textContent || ""));
      if (el) { el.click(); return true; }
      return false;
    }).catch(() => false);
    if (!clicked) return { success: false, reason: "add_address_button_not_found" };
    await page.waitForTimeout(800);
  } else {
    await addBtn.click();
    await page.waitForTimeout(800);
  }

  // Chờ form
  const formReady = await waitForFirstVisible(page, ['form#add-edit-address-form', 'input[name="firstName"]'], 5000);
  if (!formReady) return { success: false, reason: "address_form_not_found" };

  // Fill bằng React synthetic event
  await fillReactInput(page, 'input[name="firstName"]', firstName);
  await fillReactInput(page, 'input[name="lastName"]', lastName);

  // Street address: gộp "street, city, state" để autocomplete match đúng option
  const streetQuery = [street, city, state].filter(Boolean).join(", ");
  await page.locator('input#addressLineOne, input[name="addressLineOne"]').first().click({ timeout: 3000 }).catch(() => {});
  await page.locator('input#addressLineOne, input[name="addressLineOne"]').first().type(streetQuery, { delay: 40 }).catch(async () => {
    await fillReactInput(page, 'input[name="addressLineOne"]', streetQuery);
  });
  // Chọn option autocomplete thật theo độ khớp địa chỉ. Không dùng ArrowDown +
  // Enter mù vì Walmart có thể giữ focus sai hoặc option đầu không đúng ZIP.
  const optionLocator = page.locator([
    '#address1-auto-complete [role="option"]',
    'ul[role="listbox"] [role="option"]',
    '[id*="address" i] [role="option"]',
    '.pac-item',
  ].join(", "));
  await optionLocator.first().waitFor({ state: "visible", timeout: 5000 }).catch(() => { });
  const optionCount = await optionLocator.count();
  const normalize = (value) => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const wantedTokens = [street, city, state, zipCode]
    .flatMap((value) => normalize(value).split(" "))
    .filter((token) => token.length >= 2);
  let bestOption = null;
  let bestScore = -1;
  for (let index = 0; index < Math.min(optionCount, 12); index++) {
    const option = optionLocator.nth(index);
    if (!await option.isVisible().catch(() => false)) continue;
    const text = normalize(await option.innerText().catch(() => ""));
    const score = wantedTokens.reduce((sum, token) => sum + (text.includes(token) ? 1 : 0), 0)
      + (zipCode && text.includes(normalize(zipCode)) ? 4 : 0)
      + (city && text.includes(normalize(city)) ? 2 : 0);
    if (score > bestScore) {
      bestScore = score;
      bestOption = option;
    }
  }
  if (!bestOption || bestScore < 2) {
    return { success: false, reason: "address_suggestion_not_found" };
  }
  await bestOption.click();
  await page.waitForTimeout(800);

  if (apt) {
    await fillReactInput(page, 'input[name="addressLineTwo"]', apt);
  }
  if (phone) {
    await fillReactInput(page, 'input[type="tel"]', phone);
  }

  await page.waitForTimeout(300);

  // Save
  const saveBtn = await waitForFirstVisible(page, [
    'button[type="submit"][form="add-edit-address-form"]',
    'button:has-text("Save")',
  ], 4000);
  if (!saveBtn) return { success: false, reason: "save_button_not_found" };
  await saveBtn.click();
  await page.waitForTimeout(800);
  const modalResult = await handleKnownModal(page);
  await page.waitForTimeout(1200);

  const formStillVisible = await firstVisible(page, ['form#add-edit-address-form']);
  if (formStillVisible) return { success: false, reason: "address_form_still_open_after_save" };
  const savedText = await page.locator("body").innerText().catch(() => "");
  const normalizedSavedText = normalizeLabel(savedText).toLowerCase();
  const savedStreet = normalizeLabel(street).toLowerCase();
  const savedZip = normalizeLabel(zipCode).toLowerCase();
  if (!normalizedSavedText.includes(savedStreet) && !normalizedSavedText.includes(savedZip)) {
    return { success: false, reason: modalResult.reason || "saved_address_not_verified" };
  }

  return { success: true, removed: deleteAttempts, saved: true };
}

async function fillAddressInCheckout(page, payload = {}) {
  const address = payload.address || {};
  const firstName = String(address.firstName || (payload.buyerName || "").split(" ")[0] || "").trim();
  const lastName = String(address.lastName || (payload.buyerName || "").split(" ").slice(1).join(" ") || "").trim();
  const street = String(address.street || "").trim();
  const apt = String(address.apt || "").trim();
  const city = String(address.city || "").trim();
  const state = String(address.state || "").trim();
  const zipCode = String(address.zipCode || "").trim();
  const phone = String(address.phone || payload.buyerPhone || "").replace(/\D/g, "").slice(-10);

  if (!street || !city || !state || !zipCode) {
    return { success: false, reason: "missing_address_fields" };
  }

  // Chờ form xuất hiện
  const formVisible = await waitForFirstVisible(page, [
    'form#add-edit-address-form',
    'input[name="firstName"]',
    'input[name="addressLineOne"]',
  ], 5000);
  if (!formVisible) return { skipped: true, reason: "checkout_address_form_not_visible" };

  // Kiểm tra có phải form trống không — nếu đã có địa chỉ thì skip
  const currentStreet = await page.evaluate(() => {
    return document.querySelector('input[name="addressLineOne"], input#addressLineOne')?.value || "";
  }).catch(() => "");
  if (currentStreet.trim()) {
    return { skipped: true, reason: "checkout_form_already_filled" };
  }

  // Dùng React synthetic event để fill (Walmart controlled inputs)
  await fillReactInput(page, 'input[name="firstName"]', firstName);
  await fillReactInput(page, 'input[name="lastName"]', lastName);
  // Street: click focus trước để React mount autocomplete, rồi inject
  await page.locator('input#addressLineOne, input[name="addressLineOne"]').first().click({ timeout: 3000 }).catch(() => {});
  await fillReactInput(page, 'input[name="addressLineOne"]', street);
  await page.waitForTimeout(400);
  await page.keyboard.press("Escape"); // đóng autocomplete dropdown
  await page.waitForTimeout(200);
  await fillReactInput(page, 'input[name="addressLineTwo"]', apt);
  await fillReactInput(page, 'input[name="city"]', city);
  await selectReactOption(page, 'select[name="state"]', state);
  await fillReactInput(page, 'input[name="postalCode"]', zipCode);
  if (phone) {
    await fillReactInput(page, 'form#add-edit-address-form input[type="tel"]', phone);
  }
      const phoneInput = page.locator('input[type="tel"]').first();
      if (await phoneInput.isVisible({ timeout: 1500 }).catch(() => false)) {
        await phoneInput.click();
        await page.keyboard.press("Control+A");
        await page.keyboard.press("Backspace");
        await phoneInput.fill(phone); }
  await page.waitForTimeout(300);

  // Click Save
  const saveBtn = await firstVisible(page, [
    'button[type="submit"][form="add-edit-address-form"]',
    'button:has-text("Save")',
    'button:has-text("Use this address")',
  ]);
  if (saveBtn) {
    await saveBtn.click();
    await page.waitForTimeout(700);
    await handleKnownModal(page);
    await page.waitForTimeout(700);
  }

  return { success: true };
}

/**
 * Tự động fill địa chỉ giao hàng từ payload vào Walmart cart.
 * Flow:
 * - Có địa chỉ cũ: "Pickup and delivery options" hiện → click địa chỉ → panel mở
 *   → click "Edit address" → fill form → Save
 * - Chưa có: click "Add new address" → fill form → Save
 * - Địa chỉ đã đúng (match): bỏ qua, không làm gì
 * Trả về { success, reason, skipped }
 */
async function fillAddressInCart(page, payload = {}) {
  const address = payload.address || {};
  const firstName = String(address.firstName || (payload.buyerName || "").split(" ")[0] || "").trim();
  const lastName = String(address.lastName || (payload.buyerName || "").split(" ").slice(1).join(" ") || "").trim();
  const street = String(address.street || "").trim();
  const apt = String(address.apt || "").trim();
  const city = String(address.city || "").trim();
  const state = String(address.state || "").trim();
  const zipCode = String(address.zipCode || "").trim();
  const phone = String(address.phone || payload.buyerPhone || "").replace(/\D/g, "").slice(-10);

  if (!street || !city || !state || !zipCode) {
    return { success: false, reason: "missing_address_fields" };
  }

  // Vào cart nếu chưa ở đó
  if (!/walmart\.com\/cart/i.test(page.url())) {
    await page.goto("https://www.walmart.com/cart", { waitUntil: "domcontentloaded", timeout: 25000 });
    await page.waitForTimeout(1500);
  }

  // Case 0: Form "Add address" đã mở sẵn (URL có ?ss=addAddress hoặc form đang visible)
  const formAlreadyOpen = /[?&]ss=addAddress/i.test(page.url())
    || await firstVisible(page, ['form#add-edit-address-form']);
  if (formAlreadyOpen) {
    return fillAndSaveForm();
  }

  // Kiểm tra địa chỉ hiện tại có khớp không (normalize để so sánh)
  const normalize = (s) => String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
  const currentAddressText = await page.evaluate(() => {
    // Địa chỉ hiện tại hiển thị trong "Pickup and delivery options" hoặc show-bookslot-cta
    const el = document.querySelector('[data-testid="show-bookslot-cta"]')
      || document.querySelector('[data-testid="address-tile-selected"]');
    return el?.textContent || "";
  }).catch(() => "");

  const streetMatch = normalize(currentAddressText).includes(normalize(street.split(" ").slice(0, 2).join(" ")));
  const zipMatch = normalize(currentAddressText).includes(normalize(zipCode));
  if (streetMatch && zipMatch) {
    return { success: true, skipped: true, reason: "address_already_correct" };
  }

  // Helper: clear + fill input — dùng React synthetic event vì Walmart controlled inputs
  const fillInput = async (selector, value) => {
    await fillReactInput(page, selector, value);
  };

  const fillAndSaveForm = async () => {
    // Chờ form xuất hiện
    const formReady = await waitForFirstVisible(page, ['form#add-edit-address-form', '[data-automation-id="street-add"]'], 7000);
    if (!formReady) return { success: false, reason: "address_form_not_found" };

    await fillInput('input[name="firstName"]', firstName);
    await fillInput('input[name="lastName"]', lastName);
    // Street: gộp "street, city, state" để Walmart autocomplete match đúng option
    const streetQuery = [street, city, state].filter(Boolean).join(", ");
    await page.locator('input#addressLineOne, input[name="addressLineOne"]').first().click({ timeout: 3000 }).catch(() => {});
    await page.locator('input#addressLineOne, input[name="addressLineOne"]').first().type(streetQuery, { delay: 40 }).catch(async () => {
      await fillReactInput(page, 'input[name="addressLineOne"]', streetQuery);
    });
    await page.waitForTimeout(1500);
    const firstOpt = await firstVisible(page, [
      '#address1-auto-complete li[role="option"]:first-child',
      'ul[role="listbox"] li[role="option"]:first-child',
      '[role="listbox"] [role="option"]:first-child',
      '.pac-item',
    ]);
    if (firstOpt) {
      await firstOpt.click();
    } else {
      await page.keyboard.press("ArrowDown");
      await page.waitForTimeout(200);
      await page.keyboard.press("Enter");
    }
    await page.waitForTimeout(600);
    if (apt) await fillInput('input[name="addressLineTwo"]', apt);
    if (phone) {
      await fillReactInput(page, 'form#add-edit-address-form input[type="tel"]', phone);
    }

    await page.waitForTimeout(400);

    // Click Save
    const saveBtn = await waitForFirstVisible(page, [
      'button[type="submit"][form="add-edit-address-form"]',
      'button:has-text("Save")',
    ], 4000);
    if (!saveBtn) return { success: false, reason: "save_button_not_found" };
    await saveBtn.click();
    await page.waitForTimeout(700);
    await handleKnownModal(page);
    await page.waitForTimeout(800);
    return { success: true };
  };

  // Case 1: Có địa chỉ đầy đủ — click vào địa chỉ (show-bookslot-cta) để mở panel
  const existingAddressBtn = await firstVisible(page, ['[data-testid="show-bookslot-cta"]']);
  if (existingAddressBtn) {
    await existingAddressBtn.click();
    await page.waitForTimeout(1000);

    // Panel mở ra có danh sách địa chỉ + nút "Edit address"
    const editBtn = await waitForFirstVisible(page, ['button[aria-label^="Edit address" i]'], 4000);
    if (editBtn) {
      await editBtn.click();
      await page.waitForTimeout(800);
      return fillAndSaveForm();
    }

    // Hoặc có "Add new address" nếu tài khoản đặt hộ chưa có địa chỉ này
    const addBtn = await firstVisible(page, ['button:has-text("Add new address")']);
    if (addBtn) {
      await addBtn.click();
      await page.waitForTimeout(800);
      return fillAndSaveForm();
    }

    return { success: false, reason: "no_edit_or_add_button_in_panel" };
  }

  // Case 2: Chỉ có ZIP (chưa có địa chỉ đầy đủ) — click vào delivery block để mở panel
  // Walmart hiện block "Free shipping... 13440" — click vào đó mở panel địa chỉ
  const zipOnlyBlock = await firstVisible(page, [
    '[data-testid="fulfillment-summary"]',
    '[data-testid="shipping-fulfillment"]',
    'button[data-testid*="delivery" i]',
    // fallback: tìm element chứa đúng zip code
  ]);
  if (!zipOnlyBlock) {
    // Thử tìm bất kỳ clickable element nào chứa zip
    const zipText = zipCode.slice(0, 5);
    const zipElement = await page.evaluate((zip) => {
      const buttons = Array.from(document.querySelectorAll('button, a, [role="button"]'));
      const found = buttons.find((el) => (el.textContent || "").includes(zip));
      if (found) { found.setAttribute("data-affree-zip-target", "1"); return true; }
      return false;
    }, zipText).catch(() => false);
    if (zipElement) {
      const zipBtn = page.locator('[data-affree-zip-target="1"]').first();
      await zipBtn.click().catch(() => {});
      await page.waitForTimeout(1000);
    }
  } else {
    await zipOnlyBlock.click();
    await page.waitForTimeout(1000);
  }

  // Sau khi click ZIP block, panel mở → tìm "Add new address" hoặc "Edit address"
  const panelAddBtn = await waitForFirstVisible(page, [
    'button:has-text("Add new address")',
    'button[aria-label^="Edit address" i]',
  ], 4000);
  if (panelAddBtn) {
    await panelAddBtn.click();
    await page.waitForTimeout(800);
    return fillAndSaveForm();
  }

  // Case 3: "Add new address" trực tiếp trên trang (không có panel)
  const addNewBtn = await waitForFirstVisible(page, ['button:has-text("Add new address")'], 3000);
  if (addNewBtn) {
    await addNewBtn.click();
    await page.waitForTimeout(800);
    return fillAndSaveForm();
  }

  return { success: false, reason: "no_address_entry_point_found" };
}



/**
 * Xóa toàn bộ sản phẩm trong giỏ hàng Walmart.
 * Vào /cart, lặp click "Remove" cho đến khi giỏ trống hoặc không còn nút Remove.
 * Trả về { success, removed } — removed là số item đã xóa.
 */
async function clearCart(page) {
  await page.goto("https://www.walmart.com/cart", {
    waitUntil: "domcontentloaded",
    timeout: 25000,
  });
  await page.waitForTimeout(1500);

  let removed = 0;
  let attempts = 0;
  const maxAttempts = 30; // tránh vòng lặp vô hạn

  while (attempts < maxAttempts) {
    // Tìm nút Remove bất kỳ còn hiển thị trong giỏ
    const removeBtn = await firstVisible(page, [
      'button[aria-label^="Remove" i]',
      'button[data-automation-id="remove-item"]',
      'button[data-testid="remove-item"]',
      '[data-automation-id*="remove" i]',
      'button:has-text("Remove")',
      'a:has-text("Remove")',
    ]);

    if (!removeBtn) break; // không còn item nào

    const beforeRemoveCount = await page.getByText("Remove", { exact: true }).count().catch(() => 0);
    await removeBtn.click({ timeout: 4000 });
    await page.waitForTimeout(800);

    // Confirm dialog nếu Walmart hỏi xác nhận
    const confirmBtn = await firstVisible(page, [
      'button:has-text("Yes, remove")',
      'button:has-text("Remove item")',
      'button:has-text("Yes")',
      'button[data-automation-id*="confirm" i]',
    ]);
    if (confirmBtn) {
      await confirmBtn.click();
      await page.waitForTimeout(800);
    }

    await page.waitForFunction((previousCount) => {
      const exactRemove = Array.from(document.querySelectorAll('button, a, [role="button"]'))
        .filter((element) => String(element.textContent || "").trim() === "Remove").length;
      const text = String(document.body?.innerText || "");
      return exactRemove < previousCount || /your cart is empty|no items in your cart|cart is empty/i.test(text);
    }, beforeRemoveCount, { timeout: 5000 }).catch(() => { });
    removed++;
    attempts++;
  }

  // Kiểm tra giỏ đã trống chưa
  const cartState = await page.evaluate(() => {
    const text = String(document.body?.innerText || "").toLowerCase();
    const exactRemoveCount = Array.from(document.querySelectorAll('button, a, [role="button"]'))
      .filter((element) => String(element.textContent || "").trim().toLowerCase() === "remove").length;
    const explicitEmpty = /your cart is empty|no items in your cart|cart is empty|cart\s*\(\s*0\s*items?\s*\)/i.test(text);
    const itemCountMatch = text.match(/cart\s*\(\s*(\d+)\s*items?\s*\)/i);
    return {
      isEmpty: explicitEmpty || (itemCountMatch ? Number(itemCountMatch[1]) === 0 : false),
      exactRemoveCount,
      itemCount: itemCountMatch ? Number(itemCountMatch[1]) : null,
    };
  }).catch(() => ({ isEmpty: false, exactRemoveCount: -1, itemCount: null }));

  return {
    success: cartState.isEmpty,
    removed,
    isEmpty: cartState.isEmpty,
    remainingItems: cartState.itemCount,
    reason: cartState.isEmpty ? undefined : "cart_not_empty_after_remove",
  };
}

async function fillPaymentAndContinue(page, payment = {}) {
  if (!/walmart\.com\/checkout/i.test(page.url())) return { success: false, reason: "not_on_checkout" };
  const frames = () => [page, ...page.frames().filter((frame) => frame !== page.mainFrame())];
  const findVisible = async (selectors, timeoutMs = 8000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      for (const frame of frames()) {
        for (const selector of selectors) {
          const locator = frame.locator(selector).first();
          if (await locator.isVisible().catch(() => false)) return locator;
        }
      }
      await page.waitForTimeout(200);
    }
    return null;
  };
  const fill = async (selectors, value) => {
    const input = await findVisible(selectors);
    if (!input) return false;
    await humanFill(page, input, String(value), { delay: humanDelay(55, 110) });
    return true;
  };
  const fillPhone = async (selectors, value) => {
    const digits = String(value || "").replace(/\D/g, "").slice(-10);
    if (digits.length !== 10) return false;
    const input = await findVisible(selectors);
    if (!input) return false;
    await humanFill(page, input, digits, { delay: humanDelay(75, 135), beforeMin: 350, beforeMax: 900, afterMin: 500, afterMax: 1000 });
    const currentDigits = await input.evaluate((el) => String(el.value || "").replace(/\D/g, "").slice(-10)).catch(() => "");
    if (currentDigits !== digits) {
      await humanFill(page, input, digits, { delay: humanDelay(85, 145) }).catch(() => { });
    }
    return true;
  };
  const chooseExpiryDropdown = async (kind, rawValue) => {
    const isMonth = kind === "month";
    const fullValue = isMonth
      ? String(rawValue).padStart(2, "0")
      : String(rawValue).length === 2 ? `20${rawValue}` : String(rawValue);
    const shortValue = isMonth ? String(Number(rawValue)) : fullValue.slice(-2);
    const nativeSelectors = isMonth
      ? ['select[autocomplete="cc-exp-month"]', '[data-testid="selectMMContainer"] select', 'select[aria-label*="month" i]', 'select[name*="expMonth" i]', 'select[id*="month" i]']
      : ['select[autocomplete="cc-exp-year"]', '[data-testid="selectYYContainer"] select', 'select[aria-label*="year" i]', 'select[name*="expYear" i]', 'select[id*="year" i]'];

    const nativeSelect = await findVisible(nativeSelectors, 2500);
    if (nativeSelect) {
      const options = await nativeSelect.locator("option").evaluateAll((nodes) => nodes.map((node) => ({
        value: node.value,
        label: String(node.textContent || "").trim(),
      }))).catch(() => []);
      const match = options.find((option) => [fullValue, shortValue].includes(option.value)
        || [fullValue, shortValue].includes(option.label)
        || option.label.endsWith(fullValue));
      if (match) {
        await nativeSelect.selectOption(match.value);
        return true;
      }
    }

    const customSelectors = isMonth
      ? ['button:has-text("MM")', '[role="combobox"][aria-label*="month" i]', '[aria-haspopup="listbox"]:has-text("MM")']
      : ['button:has-text("YY")', '[role="combobox"][aria-label*="year" i]', '[aria-haspopup="listbox"]:has-text("YY")'];
    const customDropdown = await findVisible(customSelectors, 3000);
    if (!customDropdown) return false;
    await humanClick(page, customDropdown, { beforeMin: 500, beforeMax: 1200, afterMin: 500, afterMax: 1000, timeout: 3000 });

    for (const frame of frames()) {
      const exactOption = frame.getByRole("option", { name: new RegExp(`^(?:${fullValue}|${shortValue})$`) }).first();
      if (await exactOption.isVisible().catch(() => false)) {
        await humanClick(page, exactOption, { beforeMin: 350, beforeMax: 900, afterMin: 400, afterMax: 900 });
        return true;
      }
      const textOption = frame.getByText(new RegExp(`^(?:${fullValue}|${shortValue})$`), { exact: true }).first();
      if (await textOption.isVisible().catch(() => false)) {
        await humanClick(page, textOption, { beforeMin: 350, beforeMax: 900, afterMin: 400, afterMax: 900 });
        return true;
      }
    }

    // ARIA custom selects commonly support keyboard selection even when their
    // option portal has no stable selector.
    await customDropdown.press(isMonth ? fullValue : shortValue).catch(() => { });
    await customDropdown.press("Enter").catch(() => { });
    return true;
  };

  const cardNumberReady = await fill([
    'input[autocomplete="cc-number"]', 'input[name*="cardNumber" i]', 'input[id*="cardNumber" i]',
    'input[aria-label*="card number" i]', 'input[placeholder*="card number" i]'
  ], payment.cardNumber);
  if (!cardNumberReady) return { success: false, reason: "card_number_input_not_found" };
  // Walmart chỉ mount full form sau khi nhận diện loại thẻ.
  await humanPause(page, 1400, 2600);

  const nameParts = String(payment.cardholderName || "").trim().split(/\s+/).filter(Boolean);
  const firstName = nameParts[0] || "";
  const lastName = nameParts.slice(1).join(" ") || firstName;
  if (firstName) await fill(['input[name="firstName"]', 'input[autocomplete="cc-given-name"]', 'input[aria-label*="first name" i]'], firstName);
  if (lastName) await fill(['input[name="lastName"]', 'input[autocomplete="cc-family-name"]', 'input[aria-label*="last name" i]'], lastName);

  const combinedExpiry = `${String(payment.expiryMonth).padStart(2, "0")}/${String(payment.expiryYear).slice(-2)}`;
  const combinedExpiryReady = await fill([
    'input[autocomplete="cc-exp"]', 'input[name*="expir" i]', 'input[id*="expir" i]', 'input[placeholder*="MM/YY" i]'
  ], combinedExpiry);
  if (!combinedExpiryReady) {
    const monthReady = await chooseExpiryDropdown("month", payment.expiryMonth)
      || await fill(['input[autocomplete="cc-exp-month"]', 'input[name*="expMonth" i]'], payment.expiryMonth);
    if (!monthReady) return { success: false, reason: "expiry_month_dropdown_not_found" };
    const yearReady = await chooseExpiryDropdown("year", payment.expiryYear)
      || await fill(['input[autocomplete="cc-exp-year"]', 'input[name*="expYear" i]'], payment.expiryYear);
    if (!yearReady) return { success: false, reason: "expiry_year_dropdown_not_found" };
  }
  const cvvReady = await fill([
    'input[autocomplete="cc-csc"]', 'input[name*="cvv" i]', 'input[name*="securityCode" i]', 'input[id*="cvv" i]', 'input[aria-label*="security code" i]'
  ], payment.cvv);
  if (!cvvReady) return { success: false, reason: "cvv_input_not_found" };
  if (payment.cardholderName) {
    await fill(['input[autocomplete="cc-name"]', 'input[name*="cardholder" i]', 'input[aria-label*="name on card" i]'], payment.cardholderName);
  }
  if (payment.phone) {
    await fillPhone(['input[type="tel"]', 'input[autocomplete="tel"]', 'input[name*="phone" i]'], payment.phone);
  }

  // Không bấm Continue tại đây: trên form Walmart hiện tại đây chính là nút
  // submit thanh toán. Chỉ điền đủ dữ liệu rồi trả quyền xác nhận về popup Affree.
  await humanPause(page, 700, 1400);
  return { success: true, stage: "payment_form_filled", needsFinalConfirmation: true };
}

module.exports = {
  SELECTORS,
  run,
  extractVariantGroups: (page) => extractOptionGroupsStable(page, "variant"),
  extractCheckoutGroups: (page) => extractOptionGroups(page, "checkout"),
  hasVariantControls,
  waitForProductReady,
  waitForCartReady,
  waitForCheckoutReady,
  checkoutHandoffReady,
  applyOptions,
  addProductToCart,
  openCheckoutFromCart,
  advanceCheckoutToPayment,
  fillAddressInCart,
  fillAddressInCheckout,
  syncDeliveryAddress,
  clearCart,
  fillPaymentAndContinue,
  normalizeLabel,
  handleKnownModal,
};
