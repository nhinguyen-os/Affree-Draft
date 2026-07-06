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

  await addButton.click();
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
        await locator.click();
        clicked = true;
        await page.waitForTimeout(180);
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

  const checkoutButton = await waitForFirstVisible(page, SELECTORS.checkout, 6000);
  if (checkoutButton) {
    await checkoutButton.click();
    const deadline = Date.now() + 12000;
    while (Date.now() < deadline) {
      if (await checkoutHandoffReady(page)) {
        if (/walmart\.com\/checkout(?:\/|\?|$)/i.test(page.url())) await waitForCheckoutReady(page);
        return { success: true };
      }
      await page.waitForTimeout(180);
    }
    return { success: false, reason: "checkout_or_address_not_ready" };
  }

  return { success: false, reason: "checkout_button_not_found" };
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
      'button[aria-label^="Remove" i]',
      'button:has-text("Delete")',
      'button:has-text("Remove")',
    ]);
    if (!deleteBtn) break;
    await deleteBtn.click();
    await page.waitForTimeout(600);
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
  // Chờ dropdown Walmart autocomplete xuất hiện
  await page.waitForTimeout(1500);
  // Click option đầu tiên — Walmart dùng ul[role="listbox"] > li[role="option"]
  const firstOption = await firstVisible(page, [
    '#address1-auto-complete li[role="option"]:first-child',
    'ul[role="listbox"] li[role="option"]:first-child',
    '[role="listbox"] [role="option"]:first-child',
    '.pac-item',
  ]);
  if (firstOption) {
    await firstOption.click();
    await page.waitForTimeout(800);
  } else {
    // Fallback: ArrowDown + Enter
    await page.keyboard.press("ArrowDown");
    await page.waitForTimeout(200);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(600);
  }

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
  await page.waitForTimeout(1500);

  return { success: true };
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
    await page.waitForTimeout(1200);
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
    await page.waitForTimeout(1500);
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
      'button:has-text("Remove")',
    ]);

    if (!removeBtn) break; // không còn item nào

    await removeBtn.click();
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

    removed++;
    attempts++;
  }

  // Kiểm tra giỏ đã trống chưa
  const isEmpty = await page.evaluate(() => {
    const text = String(document.body?.innerText || "").toLowerCase();
    return /your cart is empty|no items in your cart|cart is empty/i.test(text)
      || document.querySelectorAll('[data-automation-id="cart-item"], [data-testid="cart-item"]').length === 0;
  }).catch(() => removed > 0);

  return { success: true, removed, isEmpty };
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
  fillAddressInCart,
  fillAddressInCheckout,
  syncDeliveryAddress,
  clearCart,
  normalizeLabel,
};
