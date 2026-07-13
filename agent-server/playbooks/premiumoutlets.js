const { safeGoto } = require("./css-helpers");

const PREMIUM_OUTLETS_HOSTS = new Set(["premiumoutlets.com", "www.premiumoutlets.com"]);
const SHOP_SIMON_HOST = "shop.simon.com";

const BUY_NOW_SELECTORS = [
  'a:has-text("BUY NOW")',
  'a:has-text("Buy Now")',
  'a[href*="shop.simon.com"]',
  'a[href*="plus.simon.com"]',
  'a[href*="simon.com"]',
];

const SHOP_SIMON_ADD_TO_BAG_SELECTORS = [
  'button:has-text("Add to bag")',
  'button:has-text("Add To Bag")',
  'button[name="add"]',
  'button[type="submit"]:has-text("Add")',
];

const SHOP_SIMON_VIEW_BAG_SELECTORS = [
  'button:has-text("View Bag")',
  'a[href="/cart"]',
  'a[href*="/cart"]',
  'a:has-text("Your Bag")',
];

const SHOP_SIMON_CHECKOUT_SELECTORS = [
  'form.cart button[name="checkout"]',
  'form[action="/cart"] button[name="checkout"]',
  'form.cart .cart__checkout',
  'form[action="/cart"] .cart__checkout',
  'button:has-text("Check out")',
  'button:has-text("Checkout")',
  'button:has-text("CHECK OUT")',
  'button:has-text("CHECKOUT")',
  '[role="button"]:has-text("Check out")',
  '[role="button"]:has-text("Checkout")',
  '[role="button"]:has-text("CHECK OUT")',
  '[role="button"]:has-text("CHECKOUT")',
  'a[href*="/checkout"]',
  'button[name="checkout"]',
  'input[name="checkout"]',
  'input[value*="checkout" i]',
];

const SHOP_SIMON_QUANTITY_INPUT_SELECTORS = [
  'input[name*="updates"]',
  'input[aria-label*="Quantity" i]',
  'input[id*="quantity" i]',
  'input[name*="quantity" i]',
  'input[type="number"]',
];

const SHOP_SIMON_CARD_IFRAME_SELECTORS = {
  number: [
    'iframe[title*="Card number" i]',
    'iframe[name*="card-fields-number" i]',
    'iframe[id*="card-fields-number" i]',
    'iframe[src*="/number-" i]',
  ],
  name: [
    'iframe[title*="Name on card" i]',
    'iframe[name*="card-fields-name" i]',
    'iframe[id*="card-fields-name" i]',
    'iframe[src*="/name-" i]',
  ],
  expiry: [
    'iframe[title*="Expiry" i]',
    'iframe[title*="Expiration" i]',
    'iframe[name*="card-fields-expiry" i]',
    'iframe[id*="card-fields-expiry" i]',
    'iframe[src*="/expiry-" i]',
  ],
  cvv: [
    'iframe[title*="Security code" i]',
    'iframe[title*="CVV" i]',
    'iframe[name*="card-fields-verification" i]',
    'iframe[id*="card-fields-verification" i]',
    'iframe[src*="/verification_value-" i]',
  ],
};

const US_STATE_NAME_BY_CODE = {
  AL: "Alabama",
  AK: "Alaska",
  AZ: "Arizona",
  AR: "Arkansas",
  CA: "California",
  CO: "Colorado",
  CT: "Connecticut",
  DE: "Delaware",
  FL: "Florida",
  GA: "Georgia",
  HI: "Hawaii",
  ID: "Idaho",
  IL: "Illinois",
  IN: "Indiana",
  IA: "Iowa",
  KS: "Kansas",
  KY: "Kentucky",
  LA: "Louisiana",
  ME: "Maine",
  MD: "Maryland",
  MA: "Massachusetts",
  MI: "Michigan",
  MN: "Minnesota",
  MS: "Mississippi",
  MO: "Missouri",
  MT: "Montana",
  NE: "Nebraska",
  NV: "Nevada",
  NH: "New Hampshire",
  NJ: "New Jersey",
  NM: "New Mexico",
  NY: "New York",
  NC: "North Carolina",
  ND: "North Dakota",
  OH: "Ohio",
  OK: "Oklahoma",
  OR: "Oregon",
  PA: "Pennsylvania",
  RI: "Rhode Island",
  SC: "South Carolina",
  SD: "South Dakota",
  TN: "Tennessee",
  TX: "Texas",
  UT: "Utah",
  VT: "Vermont",
  VA: "Virginia",
  WA: "Washington",
  WV: "West Virginia",
  WI: "Wisconsin",
  WY: "Wyoming",
  DC: "Washington DC",
};

function normalizeHostname(value) {
  return String(value || "").trim().toLowerCase().replace(/^www\./, "");
}

function normalizeText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function roundRect(rect = {}) {
  return {
    x: Math.round(Number(rect.x) || 0),
    y: Math.round(Number(rect.y) || 0),
    width: Math.max(1, Math.round(Number(rect.width) || 0)),
    height: Math.max(1, Math.round(Number(rect.height) || 0)),
  };
}

function scorePremiumOutletsVerifyCandidate(rootRect, candidate) {
  const root = roundRect(rootRect);
  const rootArea = Math.max(1, root.width * root.height);
  const challengePattern = /press\s*&?\s*hold|hold to verify|verify you are human|press and hold to confirm/i;
  const exactHoldPattern = /^press\s*&?\s*hold$/i;
  const rect = roundRect(candidate?.rect);
  const area = Math.max(1, rect.width * rect.height);
  const areaRatio = area / rootArea;
  const text = String(candidate?.text || "").replace(/\s+/g, " ").trim();
  const className = normalizeText(candidate?.className || "");
  const tagName = normalizeText(candidate?.tagName || "");
  const role = normalizeText(candidate?.role || "");
  const type = normalizeText(candidate?.type || "");
  const centerX = rect.x + rect.width / 2;
  const rootCenterX = root.x + root.width / 2;
  const horizontalDistance = Math.abs(centerX - rootCenterX) / Math.max(1, root.width / 2);
  const relativeTop = (rect.y - root.y) / Math.max(1, root.height);

  let score = 0;

  if (exactHoldPattern.test(text)) score += 320;
  else if (challengePattern.test(text)) score += 160;

  if (tagName === "button") score += 140;
  else if (tagName === "input" && /button|submit/.test(type)) score += 120;
  else if (role === "button") score += 100;
  else if (tagName === "a" || tagName === "label") score += 55;

  if (/(button|btn|cta|hold|verify|challenge|captcha)/.test(className)) score += 50;
  if (rect.width >= 120 && rect.width <= Math.max(420, root.width * 0.9)) score += 35;
  if (rect.height >= 32 && rect.height <= 96) score += 35;
  if (areaRatio <= 0.4) score += 40;
  if (areaRatio >= 0.7) score -= 260;
  else if (areaRatio >= 0.5) score -= 120;
  if (horizontalDistance <= 0.2) score += 30;
  else if (horizontalDistance >= 0.55) score -= 30;
  if (relativeTop >= 0.35 && relativeTop <= 0.85) score += 28;
  else if (relativeTop < 0.15) score -= 32;

  return {
    score,
    target: { ...candidate, text, rect },
  };
}

function pickPremiumOutletsVerifyTarget({ rootRect, candidates = [] } = {}) {
  let best = null;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const candidate of candidates) {
    const scored = scorePremiumOutletsVerifyCandidate(rootRect, candidate);
    if (best == null || scored.score > bestScore) {
      best = scored.target;
      bestScore = scored.score;
    }
  }

  return {
    target: best && bestScore > 0 ? best : null,
    score: bestScore,
  };
}

function choosePremiumOutletsVerifyTarget({ rootRect, candidates = [] } = {}) {
  return pickPremiumOutletsVerifyTarget({ rootRect, candidates }).target;
}

function resolvePremiumOutletsVerifyFocusSnapshot({ contexts = [], viewportWidth = 1280, viewportHeight = 720 } = {}) {
  const clamp = (rect) => {
    if (!rect) return undefined;
    return {
      x: Math.max(0, Math.floor(rect.x)),
      y: Math.max(0, Math.floor(rect.y)),
      width: Math.max(1, Math.min(viewportWidth, Math.ceil(rect.width))),
      height: Math.max(1, Math.min(viewportHeight, Math.ceil(rect.height))),
    };
  };

  let best = null;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const context of contexts) {
    if (!context?.rootRect) continue;
    const rootRect = roundRect(context.rootRect);
    const picked = pickPremiumOutletsVerifyTarget({ rootRect, candidates: context.candidates || [] });
    const targetRect = roundRect(picked.target?.rect || rootRect);
    const rootArea = Math.max(1, rootRect.width * rootRect.height);
    const targetAreaRatio = Math.max(1, targetRect.width * targetRect.height) / rootArea;
    const text = normalizeText(picked.target?.text || context.text || "");

    let contextScore = picked.score;
    if (picked.target) contextScore += 120;
    if (/^press\s*&?\s*hold$/i.test(text)) contextScore += 40;
    if (targetAreaRatio <= 0.4) contextScore += 20;
    if (targetAreaRatio >= 0.7) contextScore -= 80;

    if (best == null || contextScore > bestScore) {
      best = { context, target: picked.target };
      bestScore = contextScore;
    }
  }

  if (!best?.context) return null;

  return {
    kind: "human_verify",
    view: "full",
    interaction: "hold",
    holdDurationMs: 5500,
    title: "Human verification",
    text: best.context.text,
    actions: best.context.actions || [],
    bounds: clamp(best.context.rootRect),
    confirmBounds: clamp(best.target?.rect || best.context.rootRect),
    qrBounds: undefined,
    selectionComplete: false,
  };
}

function escapeRegex(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function splitBuyerName(fullName) {
  const parts = String(fullName || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) {
    return { firstName: parts[0] || "ShopSimon", lastName: "Customer" };
  }
  return {
    firstName: parts.slice(0, -1).join(" "),
    lastName: parts.at(-1),
  };
}

function parseUsAddress(rawAddress) {
  const parts = String(rawAddress || "").split(",").map((part) => part.trim()).filter(Boolean);
  if (parts.length < 3) return null;

  const address1 = parts[0] || "";
  const city = parts[1] || "";
  const stateZipSource = parts.slice(2).join(" ");
  const match = stateZipSource.match(/\b([A-Z]{2})\b(?:\s+|,\s*)(\d{5}(?:-\d{4})?)\b/i);
  if (!address1 || !city || !match) return null;

  return {
    address1,
    city,
    stateCode: String(match[1] || "").toUpperCase(),
    postalCode: match[2] || "",
  };
}

function resolvePremiumOutletsShippingAddress(payload) {
  const structured = payload?.buyerAddressParts;
  if (structured?.street && structured?.city && structured?.state && structured?.zipCode) {
    return {
      address1: String(structured.street || "").trim(),
      city: String(structured.city || "").trim(),
      stateCode: String(structured.state || "").trim().toUpperCase(),
      postalCode: String(structured.zipCode || "").trim(),
    };
  }
  return parseUsAddress(payload?.buyerAddress);
}

async function fillVisibleInputInContext(context, selectors, value) {
  const text = String(value || "").trim();
  if (!text) return false;

  for (const selector of selectors) {
    try {
      const locator = context.locator(selector).first();
      if (!(await locator.isVisible({ timeout: 1200 }))) continue;
      await locator.scrollIntoViewIfNeeded();
      await locator.fill("");
      await locator.fill(text);
      return true;
    } catch {}
  }

  return false;
}

async function collectFrameContexts(page, iframeSelectors = []) {
  const frames = [];
  const seen = new Set();
  const pushFrame = (frame, locator = null) => {
    if (!frame || seen.has(frame)) return;
    seen.add(frame);
    frames.push({ frame, locator });
  };

  for (const selector of iframeSelectors) {
    try {
      const locators = page.locator(selector);
      const count = await locators.count();
      for (let index = 0; index < count; index += 1) {
        const iframeLocator = locators.nth(index);
        await iframeLocator.scrollIntoViewIfNeeded?.().catch(() => {});
        const handle = await iframeLocator.elementHandle();
        const frame = await handle?.contentFrame();
        pushFrame(frame, iframeLocator);
      }
    } catch {}
  }

  try {
    const mainFrame = typeof page.mainFrame === "function" ? page.mainFrame() : null;
    const pageFrames = typeof page.frames === "function" ? page.frames() : [];
    for (const frame of pageFrames) {
      if (frame && frame !== mainFrame) pushFrame(frame);
    }
  } catch {}

  return frames;
}

async function fillFirstVisibleInput(page, selectors, value, options = {}) {
  const text = String(value || "").trim();
  if (!text) return false;

  if (await fillVisibleInputInContext(page, selectors, text)) {
    return true;
  }

  const frameContexts = await collectFrameContexts(page, options.iframeSelectors || []);
  for (const frameContext of frameContexts) {
    await frameContext.locator?.scrollIntoViewIfNeeded?.().catch(() => {});
    if (await fillVisibleInputInContext(frameContext.frame, selectors, text)) {
      return true;
    }
  }

  return false;
}

async function fillInputWithRetries(page, selectors, value, options = {}) {
  const attempts = Math.max(1, Number(options.attempts) || 1);
  const delayMs = Math.max(0, Number(options.delayMs) || 0);

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const filled = await fillFirstVisibleInput(page, selectors, value, options);
    if (filled) return true;
    if (attempt < attempts && delayMs > 0) {
      await page.waitForTimeout(delayMs).catch(() => {});
    }
  }

  return false;
}

async function selectShopSimonState(page, stateCode) {
  const zone = page.locator('select[name="zone"]').first();
  if (!(await zone.isVisible({ timeout: 1200 }).catch(() => false))) return false;

  const stateLabel = US_STATE_NAME_BY_CODE[String(stateCode || "").toUpperCase()] || String(stateCode || "").trim();
  const candidates = [
    { label: stateLabel },
    { value: stateLabel },
    { value: String(stateCode || "").toUpperCase() },
    { label: String(stateCode || "").toUpperCase() },
  ];

  for (const option of candidates) {
    try {
      await zone.selectOption(option);
      return true;
    } catch {}
  }

  return false;
}

function getPremiumOutletsCardPayload(payload) {
  const card = payload?.payment?.method === "card" ? payload.payment.card : null;
  if (!card) return null;
  return {
    number: String(card.number || "").replace(/\D/g, ""),
    expMonth: String(card.expMonth || "").replace(/\D/g, "").slice(0, 2),
    expYear: String(card.expYear || "").replace(/\D/g, "").slice(-2),
    cvv: String(card.cvv || "").replace(/\D/g, "").slice(0, 4),
    name: String(card.name || payload?.buyerName || "").trim(),
  };
}

async function chooseShopSimonCardPayment(page, sendLog) {
  const selectors = [
    'label:has-text("Credit card")',
    'label:has-text("Credit Card")',
    'label:has-text("Debit card")',
    'label:has-text("Debit Card")',
    'button:has-text("Credit card")',
    'button:has-text("Debit card")',
    '[role="radio"]:has-text("Credit card")',
    '[role="radio"]:has-text("Debit card")',
  ];

  for (const selector of selectors) {
    try {
      const locator = page.locator(selector).first();
      if (!(await locator.isVisible({ timeout: 800 }))) continue;
      await locator.scrollIntoViewIfNeeded();
      await locator.click({ timeout: 2500 });
      await page.waitForTimeout(600).catch(() => {});
      sendLog("Premium Outlets: đã chọn credit/debit card trên Shop Simon checkout.", "info");
      return true;
    } catch {}
  }

  return false;
}

async function fillShopSimonPaymentCard(page, payload, sendLog, sendStatus) {
  const card = getPremiumOutletsCardPayload(payload);
  if (!card || card.number.length < 12 || !card.expMonth || !card.expYear || card.cvv.length < 3) {
    sendStatus("waiting_user_input", {
      reason: "Thiếu thông tin thẻ payment trên Shop Simon checkout.",
      requiredInput: "final_confirmation",
      orderUrl: page.url(),
    });
    return { ready: false, blocking: "missing_card_payload" };
  }

  await chooseShopSimonCardPayment(page, sendLog);

  const cardNumberFilled = await fillFirstVisibleInput(page, [
    'input[name="number"]:not([id^="autofill_"])',
    'input[autocomplete="cc-number"]:not([id^="autofill_"])',
    'input[placeholder*="Card number" i]:not([id^="autofill_"])',
  ], card.number, { iframeSelectors: SHOP_SIMON_CARD_IFRAME_SELECTORS.number });
  if (!cardNumberFilled) {
    sendStatus("waiting_user_input", {
      reason: "Chưa điền được thông tin thẻ.",
      requiredInput: "final_confirmation",
      orderUrl: page.url(),
    });
    return { ready: false, blocking: "missing_card_number_field" };
  }

  const nameFilled = await fillFirstVisibleInput(page, [
    'input[name="name"]:not([id^="autofill_"])',
    'input[autocomplete="cc-name"]:not([id^="autofill_"])',
    'input[placeholder*="Name on card" i]:not([id^="autofill_"])',
  ], card.name || payload?.buyerName || "", { iframeSelectors: SHOP_SIMON_CARD_IFRAME_SELECTORS.name });

  const expiryValue = `${card.expMonth}/${card.expYear}`;
  const combinedExpiryFilled = await fillFirstVisibleInput(page, [
    'input[name="expiry"]:not([id^="autofill_"])',
    'input[autocomplete="cc-exp"]:not([id^="autofill_"])',
    'input[placeholder*="MM / YY" i]:not([id^="autofill_"])',
    'input[placeholder*="Expiration" i]:not([id^="autofill_"])',
  ], expiryValue, { iframeSelectors: SHOP_SIMON_CARD_IFRAME_SELECTORS.expiry });
  if (!combinedExpiryFilled) {
    const monthFilled = await fillFirstVisibleInput(page, [
      'input[name="expiry-month"]:not([id^="autofill_"])',
      'input[name="expirationMonth"]:not([id^="autofill_"])',
      'select[name="expirationMonth"]',
    ], card.expMonth, { iframeSelectors: SHOP_SIMON_CARD_IFRAME_SELECTORS.expiry });
    const yearFilled = await fillFirstVisibleInput(page, [
      'input[name="expiry-year"]:not([id^="autofill_"])',
      'input[name="expirationYear"]:not([id^="autofill_"])',
      'select[name="expirationYear"]',
    ], card.expYear, { iframeSelectors: SHOP_SIMON_CARD_IFRAME_SELECTORS.expiry });
    if (!monthFilled || !yearFilled) {
      sendStatus("waiting_user_input", {
        reason: "Chưa điền được ô hạn thẻ.",
        requiredInput: "final_confirmation",
        orderUrl: page.url(),
      });
      return { ready: false, blocking: "missing_card_expiry_field" };
    }
  }

  const cvvFilled = await fillFirstVisibleInput(page, [
    'input[name="verification_value"]:not([id^="autofill_"])',
    'input[name="cvv"]:not([id^="autofill_"])',
    'input[autocomplete="cc-csc"]:not([id^="autofill_"])',
    'input[placeholder*="CVV" i]:not([id^="autofill_"])',
    'input[placeholder*="Security code" i]:not([id^="autofill_"])',
  ], card.cvv, { iframeSelectors: SHOP_SIMON_CARD_IFRAME_SELECTORS.cvv });
  if (!cvvFilled) {
    sendStatus("waiting_user_input", {
      reason: "Chưa điền được thông tin CVV.",
      requiredInput: "final_confirmation",
      orderUrl: page.url(),
    });
    return { ready: false, blocking: "missing_card_cvv_field" };
  }

  await page.waitForTimeout(1200).catch(() => {});
  sendLog(`Đã điền thông tin thẻ ****${card.number.slice(-4)}${nameFilled ? " và cardholder name" : ""}.`, "success", { audience: "client" });
  return { ready: true, last4: card.number.slice(-4) };
}

function classifyPremiumOutletsDestination(targetUrl) {
  let parsed;
  try {
    parsed = new URL(targetUrl);
  } catch {
    return {
      kind: "invalid",
      hostname: "",
      viaSimonNetwork: false,
      url: String(targetUrl || ""),
    };
  }

  const hostname = normalizeHostname(parsed.hostname);
  if (!hostname) {
    return { kind: "invalid", hostname: "", viaSimonNetwork: false, url: parsed.toString() };
  }
  if (PREMIUM_OUTLETS_HOSTS.has(hostname)) {
    return { kind: "premiumoutlets", hostname, viaSimonNetwork: false, url: parsed.toString() };
  }
  if (hostname === SHOP_SIMON_HOST) {
    return { kind: "shopsimon", hostname, viaSimonNetwork: true, url: parsed.toString() };
  }
  if (hostname.endsWith("simon.com")) {
    return { kind: "external_merchant", hostname, viaSimonNetwork: true, url: parsed.toString() };
  }
  return { kind: "external_merchant", hostname, viaSimonNetwork: false, url: parsed.toString() };
}

function describeDestination(destination) {
  if (destination.kind === "shopsimon") {
    return `Shop Simon (${destination.hostname})`;
  }
  if (destination.kind === "external_merchant") {
    return destination.viaSimonNetwork
      ? `merchant ngoài qua Simon hop (${destination.hostname})`
      : `merchant ngoài (${destination.hostname})`;
  }
  if (destination.kind === "premiumoutlets") {
    return `Premium Outlets (${destination.hostname})`;
  }
  return `URL không hợp lệ (${destination.url || "unknown"})`;
}

function detectPremiumOutletsBlockedState({ title = "", bodyText = "" } = {}) {
  const normalizedTitle = normalizeText(title);
  const normalizedBody = normalizeText(bodyText);
  const haystack = `${normalizedTitle} ${normalizedBody}`.trim();
  if (!haystack) return null;

  if (
    haystack.includes("access to this page has been denied") ||
    haystack.includes("reference #") ||
    haystack.includes("enable cookies and reload the page") ||
    haystack.includes("generated by perimeterx") ||
    haystack.includes("press & hold to confirm you are a human") ||
    haystack.includes("verify you are human")
  ) {
    return {
      kind: "access_denied",
      reason: "Premium Outlets chặn phiên Playwright hiện tại trước khi CTA BUY NOW render.",
    };
  }

  return null;
}

async function readPremiumOutletsBlockedState(page) {
  const snapshot = await page.evaluate(() => ({
    title: document.title || "",
    bodyText: (document.body?.innerText || "").slice(0, 5000),
  })).catch(() => null);
  return detectPremiumOutletsBlockedState(snapshot || {});
}

async function inspectPremiumOutletsVerifyFocusSnapshot(page) {
  if (!page || page.isClosed()) return null;
  return page.evaluate(() => {
    const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();
    const lower = (value) => normalize(value).toLowerCase();
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 1280;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 720;
    const isVisible = (node) => {
      if (!(node instanceof Element)) return false;
      const rect = node.getBoundingClientRect();
      const style = window.getComputedStyle(node);
      return rect.width > 24 && rect.height > 24 && style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || "1") > 0.01;
    };
    const challengePattern = /press\s*&?\s*hold|hold to verify|verify you are human|press and hold to confirm/i;
    const toAbsoluteRect = (rect, offsetX = 0, offsetY = 0) => ({
      x: rect.left + offsetX,
      y: rect.top + offsetY,
      width: rect.width,
      height: rect.height,
    });
    const inspectDocument = (doc, offsetX = 0, offsetY = 0) => {
      if (!doc) return null;
      const candidates = Array.from(doc.querySelectorAll('div, section, article, main, form, [role="dialog"]')).filter((node) => {
        if (!isVisible(node)) return false;
        const text = lower(node.textContent || "");
        return challengePattern.test(text);
      });
      const root = candidates
        .map((node) => ({ node, rect: node.getBoundingClientRect() }))
        .sort((a, b) => (b.rect.width * b.rect.height) - (a.rect.width * a.rect.height))[0]?.node;
      if (!root) return null;

      const buttonCandidates = Array.from(root.querySelectorAll('button, [role="button"], input[type="button"], input[type="submit"], label, a, div, span')).filter((node) => {
        if (!isVisible(node)) return false;
        const text = lower(node.textContent || node.getAttribute?.("aria-label") || node.getAttribute?.("title") || "");
        if (challengePattern.test(text)) return true;
        const rect = node.getBoundingClientRect();
        const className = lower(node.className || "");
        return rect.width >= 56 && rect.height >= 24 && /(hold|verify|captcha|challenge|slider|button)/.test(className);
      }).map((node) => ({
        text: normalize(node.textContent || node.getAttribute?.("value") || node.getAttribute?.("aria-label") || node.getAttribute?.("title") || ""),
        className: node.className || "",
        tagName: node.tagName || "",
        role: node.getAttribute?.("role") || "",
        type: node.getAttribute?.("type") || "",
        rect: toAbsoluteRect(node.getBoundingClientRect(), offsetX, offsetY),
      }));

      const rootRect = root.getBoundingClientRect();
      const actionLabels = Array.from(root.querySelectorAll('button, [role="button"], label')).map((node) => normalize(node.textContent || node.getAttribute?.("aria-label") || "")).filter(Boolean).slice(0, 6);
      return {
        rootRect: toAbsoluteRect(rootRect, offsetX, offsetY),
        text: normalize(root.textContent || "").slice(0, 500),
        actions: actionLabels,
        candidates: buttonCandidates,
      };
    };

    const contexts = [];
    const mainContext = inspectDocument(document, 0, 0);
    if (mainContext) contexts.push(mainContext);

    for (const frame of Array.from(document.querySelectorAll("iframe"))) {
      try {
        const frameDoc = frame.contentDocument;
        if (!frameDoc) continue;
        const frameRect = frame.getBoundingClientRect();
        const frameContext = inspectDocument(frameDoc, frameRect.left, frameRect.top);
        if (frameContext) contexts.push(frameContext);
      } catch {}
    }

    return {
      contexts,
      viewportWidth,
      viewportHeight,
    };
  }).catch(() => null);
}

async function detectPremiumOutletsVerifyFocus(page, options = {}) {
  if (!page || page.isClosed()) return null;
  const timeoutMs = Math.max(0, Number(options.timeoutMs) || 4000);
  const pollMs = Math.max(100, Number(options.pollMs) || 250);
  const deadline = Date.now() + timeoutMs;

  while (true) {
    const snapshot = await inspectPremiumOutletsVerifyFocusSnapshot(page);
    if (snapshot?.contexts?.length) {
      const resolved = resolvePremiumOutletsVerifyFocusSnapshot(snapshot);
      if (resolved) return resolved;
    }

    if (Date.now() >= deadline || page.isClosed()) return null;
    await page.waitForTimeout(Math.min(pollMs, Math.max(0, deadline - Date.now()))).catch(() => { });
  }
}

async function detectPremiumOutletsPaymentSection(page) {
  if (!page || page.isClosed()) return null;
  return page.evaluate(() => {
    const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();
    const lower = (value) => normalize(value).toLowerCase();
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 1280;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 720;
    const clamp = (rect) => ({
      x: Math.max(0, Math.floor(rect.left)),
      y: Math.max(0, Math.floor(rect.top)),
      width: Math.max(1, Math.min(viewportWidth, Math.ceil(rect.width))),
      height: Math.max(1, Math.min(viewportHeight, Math.ceil(rect.height))),
    });
    const isVisible = (node) => {
      if (!(node instanceof Element)) return false;
      const rect = node.getBoundingClientRect();
      const style = window.getComputedStyle(node);
      return rect.width > 24 && rect.height > 16 && style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || "1") > 0.01;
    };
    const heading = Array.from(document.querySelectorAll('h1, h2, h3, legend, label, p, span, div')).find((node) => {
      if (!isVisible(node)) return false;
      const text = lower(node.textContent || "");
      return /payment method|payment|thanh toán|thanh toan/.test(text);
    });
    if (!heading) return null;
    const headingRect = heading.getBoundingClientRect();
    const options = Array.from(document.querySelectorAll('label, button, [role="button"], [role="radio"], input[type="radio"], input[type="checkbox"]')).filter((node) => {
      if (!isVisible(node)) return false;
      const rect = node.getBoundingClientRect();
      const text = lower(node.textContent || node.getAttribute?.("aria-label") || node.getAttribute?.("title") || "");
      const nearHeading = rect.top >= headingRect.top - 40 && rect.top <= headingRect.bottom + 520;
      return nearHeading && /card|credit|debit|paypal|shop pay|apple pay|google pay|cash|cod|bank|payment|thanh toán|thanh toan/.test(text);
    });
    if (!options.length) return null;

    const selectedOption = options.find((node) => {
      if (!(node instanceof HTMLElement)) return false;
      if (node.matches('input[type="radio"], input[type="checkbox"]')) {
        return node.checked;
      }
      return node.getAttribute("aria-checked") === "true" || node.getAttribute("data-selected") === "true" || /selected|active|checked/.test(lower(node.className || ""));
    }) || null;

    const sectionRoot = heading.closest('section, form, fieldset, article, div') || heading.parentElement || heading;
    const rootRect = sectionRoot.getBoundingClientRect();
    const optionRects = options.map((node) => node.getBoundingClientRect());
    const unionTop = Math.max(0, Math.min(rootRect.top, ...optionRects.map((rect) => rect.top)) - 16);
    const unionBottom = Math.min(viewportHeight, Math.max(rootRect.bottom, ...optionRects.map((rect) => rect.bottom)) + 24);
    const unionLeft = Math.max(0, Math.min(rootRect.left, ...optionRects.map((rect) => rect.left)) - 12);
    const unionRight = Math.min(viewportWidth, Math.max(rootRect.right, ...optionRects.map((rect) => rect.right)) + 12);

    const payButton = Array.from(document.querySelectorAll('button, [role="button"], input[type="submit"]')).find((node) => {
      if (!isVisible(node)) return false;
      const text = lower(node.textContent || node.getAttribute?.("value") || node.getAttribute?.("aria-label") || "");
      return /pay now|place order|review order|xác nhận|xac nhan|đặt hàng|dat hang/.test(text);
    }) || null;

    return {
      kind: "payment_selection",
      view: "full",
      interaction: "click",
      title: normalize(heading.textContent || "") || "Payment method",
      text: selectedOption
        ? `Đã có phương thức được chọn: ${normalize(selectedOption.textContent || selectedOption.getAttribute?.("aria-label") || "")}`
        : "Chọn phương thức thanh toán trên website thật.",
      actions: options.map((node) => normalize(node.textContent || node.getAttribute?.("aria-label") || node.getAttribute?.("title") || "")).filter(Boolean).slice(0, 8),
      bounds: clamp({ left: unionLeft, top: unionTop, width: unionRight - unionLeft, height: unionBottom - unionTop }),
      qrBounds: undefined,
      confirmBounds: payButton ? clamp(payButton.getBoundingClientRect()) : undefined,
      selectionComplete: Boolean(selectedOption),
      finalConfirmVisible: Boolean(payButton),
      finalConfirmLabel: payButton ? normalize(payButton.textContent || payButton.getAttribute?.("value") || payButton.getAttribute?.("aria-label") || "") : "",
    };
  }).catch(() => null);
}

async function detectPremiumOutletsFocusRegion(page, mode = "verify") {
  if (mode === "payment") return detectPremiumOutletsPaymentSection(page);
  return detectPremiumOutletsVerifyFocus(page);
}

async function resolveBuyNowHref(page) {
  for (const selector of BUY_NOW_SELECTORS) {
    try {
      const locator = page.locator(selector).first();
      if (!(await locator.isVisible({ timeout: 1200 }))) continue;
      const href = await locator.getAttribute("href");
      if (href) {
        return new URL(href, page.url()).toString();
      }
    } catch {}
  }

  const rawHref = await page.evaluate(() => {
    const anchors = Array.from(document.querySelectorAll("a[href]"));
    const match = anchors.find((anchor) => /buy\s*now/i.test(anchor.textContent || ""));
    return match?.getAttribute("href") || "";
  });
  if (!rawHref) return "";
  return new URL(rawHref, page.url()).toString();
}

async function readVisibleText(page, selector) {
  try {
    const locator = page.locator(selector).first();
    if (!(await locator.isVisible({ timeout: 1200 }))) return "";
    return ((await locator.textContent()) || "").replace(/\s+/g, " ").trim();
  } catch {
    return "";
  }
}

async function ensureShopSimonProductPage(page, productName, sendLog, sendStatus) {
  const headingSelectors = ["h1", '[data-testid="product-title"]', '[class*="product-title"]'];
  let headingText = "";
  for (const selector of headingSelectors) {
    headingText = await readVisibleText(page, selector);
    if (headingText) break;
  }

  if (!headingText) {
    sendStatus("failed", {
      error: "Premium Outlets → Shop Simon: không đọc được tiêu đề product page sau khi redirect.",
      orderUrl: page.url(),
    });
    return false;
  }

  if (productName) {
    const normalizedHeading = normalizeText(headingText);
    const normalizedProduct = normalizeText(productName);
    const candidates = [
      normalizedProduct,
      normalizeText(productName.split("(")[0]),
      normalizeText(productName.split("-")[0]),
      normalizeText(productName.split(",")[0]),
    ].filter(Boolean);
    const matched = candidates.some((candidate) => candidate && (normalizedHeading.includes(candidate) || candidate.includes(normalizedHeading)));
    if (!matched) {
      const nameRegex = new RegExp(escapeRegex(productName), "i");
      if (!nameRegex.test(headingText)) {
        sendLog(
          `Premium Outlets: Shop Simon landing có tiêu đề khác dự kiến (thấy: "${headingText}"). Tiếp tục best-effort vì vẫn ở đúng domain.`,
          "warning"
        );
      }
    }
  }

  const variantText = await page.evaluate(() => {
    const blocks = Array.from(document.querySelectorAll("body *"));
    const match = blocks.find((node) => /colors available now:/i.test(node.textContent || ""));
    return match?.textContent?.replace(/\s+/g, " ").trim() || "";
  }).catch(() => "");

  sendLog(
    `Premium Outlets: đã vào product detail Shop Simon${headingText ? ` — ${headingText}` : ""}${variantText ? ` (${variantText})` : ""}.`,
    "success"
  );
  sendStatus("running");
  return true;
}

async function clickFirstVisible(page, selectors, sendLog, options = {}) {
  const {
    timeout = 1500,
    clickTimeout = 3000,
    successMessage = "Đã click thành công",
    failureMessage = "Không tìm thấy nút phù hợp",
  } = options;

  for (const selector of selectors) {
    try {
      const locator = page.locator(selector).first();
      if (!(await locator.isVisible({ timeout }))) continue;
      await locator.scrollIntoViewIfNeeded();
      await locator.click({ timeout: clickTimeout });
      if (successMessage) {
        sendLog(`${successMessage}`, "success", { audience: "client" });
      }
      return true;
    } catch {}
  }
  if (failureMessage) {
    sendLog(failureMessage, "warning", { audience: "client" });
  }
  return false;
}

async function setShopSimonQuantity(page, qty, sendLog) {
  if (!Number.isFinite(qty) || qty <= 1) return true;

  for (const selector of SHOP_SIMON_QUANTITY_INPUT_SELECTORS) {
    try {
      const locator = page.locator(selector).first();
      if (!(await locator.isVisible({ timeout: 1200 }))) continue;
      await locator.scrollIntoViewIfNeeded();
      await locator.fill(String(qty));
      await page.keyboard.press("Enter").catch(() => {});
      await page.waitForTimeout(1200);
      sendLog(`Premium Outlets: đã thử cập nhật số lượng Shop Simon lên ${qty}.`, "info");
      return true;
    } catch {}
  }

  sendLog(
    `Premium Outlets: chưa chỉnh được số lượng Shop Simon lên ${qty}; sẽ dừng ở cart/checkout để người dùng xác nhận thủ công.`,
    "warning"
  );
  return false;
}

async function gotoShopSimonCart(page, sendLog) {
  const openedBag = await clickFirstVisible(page, SHOP_SIMON_VIEW_BAG_SELECTORS, sendLog, {
    successMessage: null,
    failureMessage: null,
  });

  if (!openedBag) {
    const directCartUrl = new URL("/cart", page.url()).toString();
    await safeGoto(page, directCartUrl, sendLog, { waitUntil: "domcontentloaded", settleMs: 1800, force: true });
  } else {
    await page.waitForLoadState("domcontentloaded", { timeout: 12000 }).catch(() => {});
    await page.waitForTimeout(1500).catch(() => {});
  }

  const currentUrl = page.url();
  const onCart = /\/cart(?:[/?#]|$)/i.test(currentUrl);
  if (!onCart) {
    const hasShoppingBag = await page.getByText(/shopping bag/i).first().isVisible({ timeout: 1200 }).catch(() => false);
    if (!hasShoppingBag) {
      sendLog("Premium Outlets: chưa xác nhận được Shop Simon cart page sau bước View Bag.", "warning", { audience: "client" });
      return false;
    }
  }

  sendLog(`Premium Outlets: đã vào Shop Simon cart (${currentUrl}).`, "success");
  return true;
}

async function gotoShopSimonCheckout(page, sendLog) {
  const submitted = await page.evaluate(() => {
    const form = document.querySelector('form.cart, form[action="/cart"]');
    const button = form?.querySelector('button[name="checkout"], .cart__checkout, input[name="checkout"]');
    if (!(form instanceof HTMLFormElement)) return false;
    if (button instanceof HTMLElement) {
      button.scrollIntoView({ block: "center", inline: "center" });
    }
    if (typeof form.requestSubmit === "function") {
      form.requestSubmit(button instanceof HTMLButtonElement || button instanceof HTMLInputElement ? button : undefined);
      return true;
    }
    form.submit();
    return true;
  }).catch(() => false);

  if (!submitted) {
    sendLog("Premium Outlets: chưa thấy form.cart hoặc button[name=checkout] để submit Shop Simon cart.", "warning");
    return false;
  }

  sendLog("Premium Outlets: đã submit trực tiếp Shop Simon cart form bằng button[name=checkout].", "success");

  const waitForCheckoutSettled = async () => {
    await page.waitForLoadState("domcontentloaded", { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(1800).catch(() => {});
  };

  await waitForCheckoutSettled();

  let checkoutUrl = page.url();
  let onCheckout = /\/checkouts?\//i.test(checkoutUrl) || /checkout/i.test(await page.title().catch(() => ""));
  if (!onCheckout && /\/cart(?:[/?#]|$)/i.test(checkoutUrl)) {
    const resubmitted = await page.evaluate(() => {
      const form = document.querySelector('form.cart, form[action="/cart"]');
      const button = form?.querySelector('button[name="checkout"], .cart__checkout, input[name="checkout"]');
      if (!(form instanceof HTMLFormElement)) return false;
      if (typeof form.requestSubmit === "function") {
        form.requestSubmit(button instanceof HTMLButtonElement || button instanceof HTMLInputElement ? button : undefined);
        return true;
      }
      form.submit();
      return true;
    }).catch(() => false);
    if (resubmitted) {
      sendLog("Premium Outlets: checkout vẫn ở cart sau submit đầu tiên; retry thêm một lần bằng requestSubmit trên form.cart.", "info");
      await waitForCheckoutSettled();
      checkoutUrl = page.url();
      onCheckout = /\/checkouts?\//i.test(checkoutUrl) || /checkout/i.test(await page.title().catch(() => ""));
    }
  }
  if (!onCheckout) {
    const checkoutHeading = await page.getByText(/checkout/i).first().isVisible({ timeout: 1200 }).catch(() => false);
    if (!checkoutHeading) {
      sendLog(`Premium Outlets: đã bấm checkout nhưng chưa xác nhận được checkout page (${checkoutUrl}).`, "warning");
      return false;
    }
  }

  sendLog(`Premium Outlets: đã tới Shop Simon checkout (${checkoutUrl}).`, "success");
  return true;
}

async function fillShopSimonCheckout(page, payload, sendLog, sendStatus) {
  const buyerEmail = String(payload?.buyerEmail || "").trim();
  if (!buyerEmail) {
    sendStatus("waiting_user_input", {
      reason: "Chưa có email để điền thông tin.",
      requiredInput: "final_confirmation",
      orderUrl: page.url(),
    });
    return { readyForPayment: false, blocking: "missing_email" };
  }

  const parsedAddress = resolvePremiumOutletsShippingAddress(payload);
  if (!parsedAddress) {
    sendStatus("waiting_user_input", {
      reason:
        "Địa chỉ chưa ở định dạng US đủ rõ (ví dụ: street, city, ST ZIP) để điền thông tin shipping.",
      requiredInput: "final_confirmation",
      orderUrl: page.url(),
    });
    return { readyForPayment: false, blocking: "address_parse_failed" };
  }

  const { firstName, lastName } = splitBuyerName(payload?.buyerName);
  const fields = [
    { label: "email", selectors: ['input[name="email"]:not([id^="autofill_"])', 'input[type="email"][name="email"]'], value: buyerEmail },
    { label: "first name", selectors: ['input[name="firstName"]:not([id^="autofill_"])'], value: firstName },
    { label: "last name", selectors: ['input[name="lastName"]:not([id^="autofill_"])'], value: lastName },
    { label: "address", selectors: ['input[name="address1"]:not([id^="autofill_"])', '#shipping-address1'], value: parsedAddress.address1 },
    { label: "city", selectors: ['input[name="city"]:not([id^="autofill_"])'], value: parsedAddress.city },
    { label: "ZIP code", selectors: ['input[name="postalCode"]:not([id^="autofill_"])'], value: parsedAddress.postalCode },
    { label: "phone", selectors: ['input[name="phone"]:not([id^="autofill_"])', 'input[type="tel"][name="phone"]'], value: payload?.buyerPhone },
  ];

  for (const field of fields) {
    const filled = await fillInputWithRetries(page, field.selectors, field.value, {
      attempts: field.label === "email" ? 4 : 2,
      delayMs: field.label === "email" ? 600 : 250,
    });
    if (!filled) {
      sendStatus("waiting_user_input", {
        reason: `Chưa tự điền được trường ${field.label}.`,
        requiredInput: "final_confirmation",
        orderUrl: page.url(),
      });
      return { readyForPayment: false, blocking: `missing_${field.label.replace(/\s+/g, "_")}` };
    }
  }

  const stateSelected = await selectShopSimonState(page, parsedAddress.stateCode);
  if (!stateSelected) {
    sendStatus("waiting_user_input", {
      reason: `Chưa chọn được bang ${parsedAddress.stateCode}.`,
      requiredInput: "final_confirmation",
      orderUrl: page.url(),
    });
    return { readyForPayment: false, blocking: "state_select_failed" };
  }

  await page.waitForTimeout(1800).catch(() => {});
  sendLog(
    `Premium Outlets: đã điền form checkout Shop Simon cho ${parsedAddress.city}, ${parsedAddress.stateCode} ${parsedAddress.postalCode}.`,
    "success"
  );

  const cardAutofill = await fillShopSimonPaymentCard(page, payload, sendLog, sendStatus);
  if (!cardAutofill.ready) {
    return { readyForPayment: false, blocking: cardAutofill.blocking };
  }

  sendStatus("waiting_user_input", {
    reason: `Đã điền đầy đủ thông tin. Kiểm tra lại rồi bấm xác nhận.`,
    requiredInput: "final_confirmation",
    orderUrl: page.url(),
  });

  return { readyForPayment: true };
}

async function runShopSimonBranch(page, payload, sendLog, sendStatus, outbound) {
  const { productName, qty } = payload;

  await safeGoto(page, outbound.url, sendLog, { waitUntil: "domcontentloaded", settleMs: 2200, force: true });

  const landed = classifyPremiumOutletsDestination(page.url());
  if (landed.kind !== "shopsimon") {
    sendLog(
      `Premium Outlets: BUY NOW dự kiến vào Shop Simon nhưng thực tế land tại ${describeDestination(landed)}.`,
      "warning"
    );
    return { done: false };
  }

  const productReady = await ensureShopSimonProductPage(page, productName, sendLog, sendStatus);
  if (!productReady) return { done: true };

  const addedToBag = await clickFirstVisible(page, SHOP_SIMON_ADD_TO_BAG_SELECTORS, sendLog, {
    timeout: 2200,
    clickTimeout: 4000,
    successMessage: "Đã thêm sản phẩm vào giỏ hàng",
    failureMessage: "Thêm sản phẩm vào giỏ hàng thất bại",
  });
  if (!addedToBag) {
    sendStatus("waiting_user_input", {
      reason: "Thêm sản phẩm vào giỏ hàng thất bại; cần người dùng tiếp tục thủ công.",
      requiredInput: "final_confirmation",
      orderUrl: page.url(),
    });
    return { done: true };
  }

  await page.waitForTimeout(1500).catch(() => {});
  sendStatus("running");

  const onCart = await gotoShopSimonCart(page, sendLog);
  if (!onCart) {
    sendStatus("waiting_user_input", {
      reason: "Premium Outlets: đã add to bag nhưng chưa xác nhận được Shop Simon cart; cần người dùng tiếp tục thủ công.",
      requiredInput: "final_confirmation",
      orderUrl: page.url(),
    });
    return { done: true };
  }

  const quantityReady = await setShopSimonQuantity(page, qty, sendLog);
  sendStatus("running");

  const onCheckout = await gotoShopSimonCheckout(page, sendLog);
  if (!onCheckout) {
    sendStatus("waiting_user_input", {
      reason: quantityReady
        ? "Premium Outlets: đã vào Shop Simon cart nhưng chưa tự mở được checkout; cần người dùng tiếp tục thủ công."
        : "Premium Outlets: đã vào Shop Simon cart nhưng cần người dùng chỉnh lại số lượng rồi tiếp tục checkout thủ công.",
      requiredInput: "final_confirmation",
      orderUrl: page.url(),
    });
    return { done: true };
  }

  const checkoutReady = await fillShopSimonCheckout(page, payload, sendLog, sendStatus);
  if (!checkoutReady.readyForPayment) {
    return { done: true };
  }

  return { done: true };
}

async function continueAfterVerify(page, payload, sendLog, sendStatus) {
  const blockedState = await readPremiumOutletsBlockedState(page);
  if (blockedState) {
    sendStatus("waiting_user_input", {
      reason: "Verification thất bại. Bạn vui lòng nhấn giữ nút xác minh phía dưới...",
      requiredInput: "captcha",
      pauseReason: "premiumoutlets_verify",
      orderUrl: page.url(),
    });
    return { done: true, resumedPath: "still_blocked", needsAgentic: false };
  }

  sendLog(
    "Verify thành công, tiếp tục mua hàng.",
    "success"
  );

  const buyNowHref = await resolveBuyNowHref(page);
  if (!buyNowHref) {
    sendStatus("failed", {
      error: "Premium Outlets: verify đã qua nhưng không tìm thấy CTA BUY NOW trên product page.",
      orderUrl: page.url(),
    });
    return { done: true, resumedPath: "missing_buy_now", needsAgentic: false };
  }

  const outbound = classifyPremiumOutletsDestination(buyNowHref);
  sendLog(
    `Premium Outlets: sau verify, BUY NOW resolve ra ${describeDestination(outbound)}.`,
    outbound.kind === "invalid" ? "warning" : "info"
  );
  sendStatus("running", {
    reason: `Verify thành công, tiếp tục mua hàng...`,
  });

  if (outbound.kind === "shopsimon") {
    const result = await runShopSimonBranch(page, payload, sendLog, sendStatus, outbound);
    return { ...result, resumedPath: "shopsimon", needsAgentic: false };
  }

  if (outbound.kind !== "invalid") {
    await safeGoto(page, outbound.url, sendLog, { waitUntil: "domcontentloaded", settleMs: 2200, force: true });
    const landed = classifyPremiumOutletsDestination(page.url());
    sendLog(
      `Premium Outlets: sau verify đã land tại ${describeDestination(landed)}; chuyển sang agentic loop cho merchant ngoài.`,
      "info",
      { audience: "client" }
    );
    sendStatus("running", {
      reason: `Premium Outlets: đã land tại ${describeDestination(landed)} sau verify.`,
    });
    return { done: false, resumedPath: landed.kind || "external", needsAgentic: true };
  }

  sendLog("Premium Outlets: chưa phân loại được outbound sau verify; dùng agentic loop để đọc lại trang hiện tại.", "warning", { audience: "client" });
  return { done: false, resumedPath: "invalid", needsAgentic: true };
}

async function run(page, payload, sendLog, sendStatus) {
  const { url, productName } = payload;
  sendLog("Mở websitePremium Outlets...", "info", { audience: "client" });

  await safeGoto(page, url, sendLog, { waitUntil: "domcontentloaded", settleMs: 1800, force: true });

  const blockedState = await readPremiumOutletsBlockedState(page);
  if (blockedState) {
    sendStatus("waiting_user_input", {
      reason: `Bạn vui lòng nhấn giữ nút xác minh phía dưới.`,
      requiredInput: "captcha",
      pauseReason: "premiumoutlets_verify",
      orderUrl: page.url(),
    });
    return { done: true };
  }

  const buyNowHref = await resolveBuyNowHref(page);
  if (!buyNowHref) {
    sendStatus("failed", {
      error: "Premium Outlets: không tìm thấy CTA BUY NOW trên product page.",
      orderUrl: page.url(),
    });
    return { done: true };
  }

  const outbound = classifyPremiumOutletsDestination(buyNowHref);
  sendLog(
    `Premium Outlets: BUY NOW resolve ra ${describeDestination(outbound)}.`,
    outbound.kind === "invalid" ? "warning" : "info",
    { audience: "client" }
  );
  sendStatus("running", {
    reason: `Premium Outlets: đã phân loại BUY NOW → ${describeDestination(outbound)}.`,
  });

  if (outbound.kind === "shopsimon") {
    return runShopSimonBranch(page, payload, sendLog, sendStatus, outbound);
  }

  if (outbound.kind !== "invalid") {
    await safeGoto(page, outbound.url, sendLog, { waitUntil: "domcontentloaded", settleMs: 2200, force: true });
    const landed = classifyPremiumOutletsDestination(page.url());
    sendLog(
      `Premium Outlets: đã land tại ${describeDestination(landed)}; giữ nhánh merchant ngoài cho batch 2B / handoff tiếp theo.`,
      "info",
      { audience: "client" }
    );
    sendStatus("running", {
      reason: `Premium Outlets: đã land tại ${describeDestination(landed)}.`,
    });
  }

  return { done: false };
}

module.exports = {
  continueAfterVerify,
  run,
  classifyPremiumOutletsDestination,
  describeDestination,
  SHOP_SIMON_CHECKOUT_SELECTORS,
  SHOP_SIMON_CARD_IFRAME_SELECTORS,
  choosePremiumOutletsVerifyTarget,
  resolvePremiumOutletsVerifyFocusSnapshot,
  detectPremiumOutletsBlockedState,
  detectPremiumOutletsVerifyFocus,
  detectPremiumOutletsPaymentSection,
  detectPremiumOutletsFocusRegion,
  fillFirstVisibleInput,
  fillInputWithRetries,
};
