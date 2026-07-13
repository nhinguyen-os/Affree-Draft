import test from "node:test";
import assert from "node:assert/strict";

import { validateCreateOrderSessionRequest, validateOrderSessionEvent } from "../lib/order-agent/validators";
import { createInMemoryOrderSessionStore } from "../lib/order-agent/session-store";
import { toPublicOrderSessionState } from "../lib/order-agent/public-state";
import { buildMissingAddressMessage, parseUsAddress } from "../lib/order-agent/address";
import type { CreateOrderSessionRequest, OrderSessionPrivateState } from "../lib/order-agent/types";

const { classifyPremiumOutletsDestination, choosePremiumOutletsVerifyTarget, detectPremiumOutletsBlockedState, resolvePremiumOutletsVerifyFocusSnapshot, detectPremiumOutletsVerifyFocus, SHOP_SIMON_CHECKOUT_SELECTORS, SHOP_SIMON_CARD_IFRAME_SELECTORS, fillFirstVisibleInput, fillInputWithRetries } = require("../agent-server/playbooks/premiumoutlets.js") as {
  classifyPremiumOutletsDestination: (url: string) => {
    kind: string;
    hostname: string;
    viaSimonNetwork: boolean;
    url: string;
  };
  SHOP_SIMON_CHECKOUT_SELECTORS: string[];
  SHOP_SIMON_CARD_IFRAME_SELECTORS: Record<string, string[]>;
  fillFirstVisibleInput: (
    page: {
      locator: (selector: string) => {
        first?: () => unknown;
        count?: () => Promise<number>;
        nth?: (index: number) => { elementHandle: () => Promise<{ contentFrame: () => Promise<unknown> } | null> };
      };
      frames?: () => unknown[];
      mainFrame?: () => unknown;
      waitForTimeout?: (ms: number) => Promise<void>;
    },
    selectors: string[],
    value: string,
    options?: { iframeSelectors?: string[] }
  ) => Promise<boolean>;
  fillInputWithRetries: (
    page: {
      locator: (selector: string) => {
        first?: () => unknown;
        count?: () => Promise<number>;
        nth?: (index: number) => { elementHandle: () => Promise<{ contentFrame: () => Promise<unknown> } | null> };
      };
      frames?: () => unknown[];
      mainFrame?: () => unknown;
      waitForTimeout?: (ms: number) => Promise<void>;
    },
    selectors: string[],
    value: string,
    options?: { iframeSelectors?: string[]; attempts?: number; delayMs?: number }
  ) => Promise<boolean>;
  choosePremiumOutletsVerifyTarget: (input: {
    rootRect: { x: number; y: number; width: number; height: number };
    candidates: Array<{
      text?: string;
      className?: string;
      tagName?: string;
      role?: string;
      type?: string;
      rect?: { x: number; y: number; width: number; height: number };
    }>;
  }) => { text?: string; rect: { x: number; y: number; width: number; height: number } } | null;
  detectPremiumOutletsBlockedState: (input: { title?: string; bodyText?: string }) => { kind: string; reason: string } | null;
  resolvePremiumOutletsVerifyFocusSnapshot: (input: {
    contexts: Array<{
      rootRect: { x: number; y: number; width: number; height: number };
      text?: string;
      actions?: string[];
      candidates?: Array<{
        text?: string;
        className?: string;
        tagName?: string;
        role?: string;
        type?: string;
        rect?: { x: number; y: number; width: number; height: number };
      }>;
    }>;
    viewportWidth?: number;
    viewportHeight?: number;
  }) => {
    kind: string;
    interaction: string;
    holdDurationMs: number;
    bounds: { x: number; y: number; width: number; height: number };
    confirmBounds: { x: number; y: number; width: number; height: number };
  } | null;
  detectPremiumOutletsVerifyFocus: (
    page: {
      evaluate: (fn: () => unknown) => Promise<unknown>;
      waitForTimeout: (ms: number) => Promise<void>;
      isClosed: () => boolean;
    },
    options?: { timeoutMs?: number; pollMs?: number }
  ) => Promise<{
    kind: string;
    interaction: string;
    holdDurationMs: number;
    bounds: { x: number; y: number; width: number; height: number };
    confirmBounds: { x: number; y: number; width: number; height: number };
  } | null>;
};

function makeRequest(overrides: Partial<CreateOrderSessionRequest> = {}): CreateOrderSessionRequest {
  return {
    provider: "tuoixanhnhanhngon",
    offer: {
      productName: "Táo đỏ",
      productUrl: "https://tuoixanhnhanhngon.timdaythay.com/products/tao-do",
      productId: "tao-do",
      storeId: "store-1",
      price: 99000,
    },
    quantity: 2,
    customer: {
      name: "Huy Nguyen",
      phone: "0901234567",
      address: "123 Nguyễn Huệ, Quận 1, TP.HCM",
    },
    delivery: {
      slot: "today-afternoon",
    },
    idempotencyKey: "idem-1",
    ...overrides,
  };
}

test("validateCreateOrderSessionRequest accepts a valid tuoixanhnhanhngon request", () => {
  const parsed = validateCreateOrderSessionRequest(makeRequest());

  assert.equal(parsed.provider, "tuoixanhnhanhngon");
  assert.equal(parsed.quantity, 2);
  assert.equal(parsed.offer.productUrl, "https://tuoixanhnhanhngon.timdaythay.com/products/tao-do");
});

test("validateCreateOrderSessionRequest rejects productUrl outside allowlist", () => {
  assert.throws(
    () =>
      validateCreateOrderSessionRequest(
        makeRequest({
          offer: {
            ...makeRequest().offer,
            productUrl: "https://example.com/products/tao-do",
          },
        })
      ),
    /productUrl/i
  );
});

test("validateCreateOrderSessionRequest accepts a valid premiumoutlets request", () => {
  const parsed = validateCreateOrderSessionRequest({
    provider: "premiumoutlets",
    offer: {
      productName: "Nike Air Max",
      productUrl: "https://www.premiumoutlets.com/outlet/las-vegas-north/search/shopsimon/product/8910200373308-35814",
      productId: "nike-air-max",
      storeId: "premiumoutlets",
      price: 129.99,
    },
    quantity: 1,
    customer: {
      name: "Huy Nguyen",
      email: "huy@example.com",
      phone: "+1 (408) 555-0123",
      address: "385 Santana Row, San Jose, CA 95128",
    },
    payment: {
      method: "card",
      card: {
        number: "4111 1111 1111 1111",
        expMonth: "09",
        expYear: "29",
        cvv: "321",
        name: "HUY NGUYEN",
      },
    },
    idempotencyKey: "idem-premiumoutlets-1",
  });

  assert.equal(parsed.provider, "premiumoutlets");
  assert.equal(parsed.customer.phone, "14085550123");
  assert.equal(parsed.offer.productUrl, "https://www.premiumoutlets.com/outlet/las-vegas-north/search/shopsimon/product/8910200373308-35814");
  assert.equal(parsed.customer.email, "huy@example.com");
  assert.equal(parsed.payment?.method, "card");
  assert.equal(parsed.payment?.card.number, "4111111111111111");
  assert.equal(parsed.payment?.card.cvv, "321");
  assert.deepEqual(parsed.customer.usAddress, {
    street: "385 Santana Row",
    city: "San Jose",
    state: "CA",
    zipCode: "95128",
  });
});

test("validateCreateOrderSessionRequest rejects premiumoutlets request without email", () => {
  assert.throws(
    () =>
      validateCreateOrderSessionRequest({
        provider: "premiumoutlets",
        offer: {
          productName: "Nike Air Max",
          productUrl: "https://www.premiumoutlets.com/outlet/las-vegas-north/search/shopsimon/product/8910200373308-35814",
        },
        quantity: 1,
        customer: {
          name: "Huy Nguyen",
          phone: "+1 (408) 555-0123",
          address: "385 Santana Row, San Jose, CA 95128",
        },
        payment: {
          method: "card",
          card: {
            number: "4111111111111111",
            expMonth: "09",
            expYear: "29",
            cvv: "321",
          },
        },
        idempotencyKey: "idem-premiumoutlets-missing-email",
      }),
    /customer\.email is required/i
  );
});

test("validateCreateOrderSessionRequest rejects premiumoutlets request without usable card payload", () => {
  assert.throws(
    () =>
      validateCreateOrderSessionRequest({
        provider: "premiumoutlets",
        offer: {
          productName: "Nike Air Max",
          productUrl: "https://www.premiumoutlets.com/outlet/las-vegas-north/search/shopsimon/product/8910200373308-35814",
        },
        quantity: 1,
        customer: {
          name: "Huy Nguyen",
          email: "huy@example.com",
          phone: "+1 (408) 555-0123",
          address: "385 Santana Row, San Jose, CA 95128",
        },
        payment: {
          method: "card",
          card: {
            number: "1111",
            expMonth: "09",
            expYear: "29",
            cvv: "32",
          },
        },
        idempotencyKey: "idem-premiumoutlets-invalid-card",
      }),
    /payment\.card\.(number|cvv) is invalid/i
  );
});

test("validateCreateOrderSessionRequest rejects premiumoutlets request with incomplete US address", () => {
  assert.throws(
    () =>
      validateCreateOrderSessionRequest({
        provider: "premiumoutlets",
        offer: {
          productName: "Nike Air Max",
          productUrl: "https://www.premiumoutlets.com/outlet/las-vegas-north/search/shopsimon/product/8910200373308-35814",
        },
        quantity: 1,
        customer: {
          name: "Huy Nguyen",
          email: "huy@example.com",
          phone: "+1 (408) 555-0123",
          address: "385 Santana Row",
        },
        payment: {
          method: "card",
          card: {
            number: "4111111111111111",
            expMonth: "09",
            expYear: "29",
            cvv: "321",
          },
        },
        idempotencyKey: "idem-premiumoutlets-bad-address",
      }),
    /customer\.address must include street, city, state, and ZIP/i
  );
});

test("classifyPremiumOutletsDestination separates Shop Simon vs merchant hops", () => {
  assert.deepEqual(classifyPremiumOutletsDestination("https://shop.simon.com/products/demo"), {
    kind: "shopsimon",
    hostname: "shop.simon.com",
    viaSimonNetwork: true,
    url: "https://shop.simon.com/products/demo",
  });

  assert.deepEqual(classifyPremiumOutletsDestination("https://plus.simon.com/redirect?merchant=nike"), {
    kind: "external_merchant",
    hostname: "plus.simon.com",
    viaSimonNetwork: true,
    url: "https://plus.simon.com/redirect?merchant=nike",
  });

  assert.deepEqual(classifyPremiumOutletsDestination("https://www.nike.com/t/air-max"), {
    kind: "external_merchant",
    hostname: "nike.com",
    viaSimonNetwork: false,
    url: "https://www.nike.com/t/air-max",
  });
});

test("SHOP_SIMON_CHECKOUT_SELECTORS cover current Checkout CTA variants", () => {
  assert.ok(SHOP_SIMON_CHECKOUT_SELECTORS.includes('form.cart button[name="checkout"]'));
  assert.ok(SHOP_SIMON_CHECKOUT_SELECTORS.includes('form[action="/cart"] button[name="checkout"]'));
  assert.ok(SHOP_SIMON_CHECKOUT_SELECTORS.includes('form.cart .cart__checkout'));
  assert.ok(SHOP_SIMON_CHECKOUT_SELECTORS.includes('button:has-text("Checkout")'));
  assert.ok(SHOP_SIMON_CHECKOUT_SELECTORS.includes('button:has-text("CHECKOUT")'));
  assert.ok(SHOP_SIMON_CHECKOUT_SELECTORS.includes('input[name="checkout"]'));
  assert.ok(SHOP_SIMON_CHECKOUT_SELECTORS.includes('input[value*="checkout" i]'));
});

test("fillFirstVisibleInput can fill Shopify-hosted card fields inside iframe on Shop Simon checkout", async () => {
  const selector = 'input[name="number"]:not([id^="autofill_"])';
  const fills: Array<{ context: string; selector: string; value: string }> = [];
  const iframeScrolls: string[] = [];

  const makeInputLocator = (visible: boolean, context: string, currentSelector: string) => ({
    first() {
      return this;
    },
    async isVisible() {
      return visible;
    },
    async scrollIntoViewIfNeeded() {},
    async fill(value: string) {
      fills.push({ context, selector: currentSelector, value });
    },
  });

  const frameContext = {
    locator(currentSelector: string) {
      return makeInputLocator(currentSelector === selector, "iframe:number", currentSelector);
    },
  };

  const iframeHandle = {
    async contentFrame() {
      return frameContext;
    },
  };

  const mainFrame = { id: "main" };
  const page = {
    locator(currentSelector: string) {
      if (SHOP_SIMON_CARD_IFRAME_SELECTORS.number.includes(currentSelector)) {
        return {
          async count() {
            return 1;
          },
          nth() {
            return {
              async scrollIntoViewIfNeeded() {
                iframeScrolls.push("card-number-iframe");
              },
              async elementHandle() {
                return iframeHandle;
              },
            };
          },
        };
      }

      return makeInputLocator(false, "page", currentSelector);
    },
    frames() {
      return [mainFrame, frameContext];
    },
    mainFrame() {
      return mainFrame;
    },
  };

  const filled = await fillFirstVisibleInput(page, [selector], "4111111111111111", {
    iframeSelectors: SHOP_SIMON_CARD_IFRAME_SELECTORS.number,
  });

  assert.equal(filled, true);
  assert.ok(iframeScrolls.length >= 2);
  assert.ok(iframeScrolls.every((entry) => entry === "card-number-iframe"));
  assert.deepEqual(fills, [
    { context: "iframe:number", selector, value: "" },
    { context: "iframe:number", selector, value: "4111111111111111" },
  ]);
});

test("fillInputWithRetries retries when Shop Simon email field appears after checkout settles", async () => {
  const selector = 'input[name="email"]:not([id^="autofill_"])';
  const waits: number[] = [];
  const fills: string[] = [];
  let locatorCalls = 0;

  const page = {
    locator(currentSelector: string) {
      locatorCalls += 1;
      return {
        first() {
          return this;
        },
        async isVisible() {
          return locatorCalls >= 2 && currentSelector === selector;
        },
        async scrollIntoViewIfNeeded() {},
        async fill(value: string) {
          fills.push(value);
        },
      };
    },
    frames() {
      return [];
    },
    mainFrame() {
      return null;
    },
    async waitForTimeout(ms: number) {
      waits.push(ms);
    },
  };

  const filled = await fillInputWithRetries(page, [selector], "huy@example.com", { attempts: 2, delayMs: 400 });

  assert.equal(filled, true);
  assert.deepEqual(waits, [400]);
  assert.deepEqual(fills, ["", "huy@example.com"]);
});

test("detectPremiumOutletsBlockedState recognizes access-denied pages", () => {
  assert.deepEqual(
    detectPremiumOutletsBlockedState({
      title: "Access to this page has been denied",
      bodyText: "Please verify you are human. Reference #18.8f6d3e17.1234567890.abcd1234",
    }),
    {
      kind: "access_denied",
      reason: "Premium Outlets chặn phiên Playwright hiện tại trước khi CTA BUY NOW render.",
    }
  );

  assert.equal(
    detectPremiumOutletsBlockedState({
      title: "Michael Kors Gorgeous by Michael Kors Eau De Parfum Spray 1.7 oz Women available now from ShopSimon",
      bodyText: "BUY NOW Colors Available Now: Clear/transparent",
    }),
    null
  );
});

test("choosePremiumOutletsVerifyTarget prefers the actual Press & Hold button over the outer challenge container", () => {
  const target = choosePremiumOutletsVerifyTarget({
    rootRect: { x: 120, y: 50, width: 760, height: 520 },
    candidates: [
      {
        text: "Before we continue... Press & Hold to confirm you are a human (and not a bot). Press & Hold",
        className: "challenge-card",
        tagName: "DIV",
        rect: { x: 120, y: 50, width: 760, height: 520 },
      },
      {
        text: "Press & Hold",
        className: "px-captcha-button",
        tagName: "BUTTON",
        role: "button",
        rect: { x: 280, y: 270, width: 300, height: 64 },
      },
      {
        text: "Before we continue...",
        className: "challenge-title",
        tagName: "DIV",
        rect: { x: 250, y: 110, width: 410, height: 56 },
      },
    ],
  });

  assert.ok(target);
  assert.equal(target?.text, "Press & Hold");
  assert.deepEqual(target?.rect, { x: 280, y: 270, width: 300, height: 64 });
});

test("resolvePremiumOutletsVerifyFocusSnapshot selects iframe-local Press & Hold button and translates bounds to page coordinates", () => {
  const popup = resolvePremiumOutletsVerifyFocusSnapshot({
    viewportWidth: 1280,
    viewportHeight: 720,
    contexts: [
      {
        rootRect: { x: 40, y: 80, width: 900, height: 420 },
        text: "Human verification challenge",
        actions: [],
        candidates: [],
      },
      {
        rootRect: { x: 200, y: 140, width: 640, height: 52 },
        text: "Press & Hold Human Challenge requires verification. Please press and hold the button until verified",
        actions: ["Press & Hold"],
        candidates: [
          {
            text: "Press & Hold",
            className: "bMODMganemuJNeo",
            tagName: "DIV",
            role: "button",
            rect: { x: 360, y: 140, width: 320, height: 52 },
          },
        ],
      },
    ],
  });

  assert.ok(popup);
  assert.equal(popup?.kind, "human_verify");
  assert.equal(popup?.interaction, "hold");
  assert.equal(popup?.holdDurationMs, 5500);
  assert.deepEqual(popup?.bounds, { x: 200, y: 140, width: 640, height: 52 });
  assert.deepEqual(popup?.confirmBounds, { x: 360, y: 140, width: 320, height: 52 });
});

test("detectPremiumOutletsVerifyFocus waits for a late-loaded iframe challenge before giving up", async () => {
  let evaluateCalls = 0;
  const waits: number[] = [];
  const page = {
    async evaluate() {
      evaluateCalls += 1;
      if (evaluateCalls === 1) {
        return { contexts: [], viewportWidth: 1280, viewportHeight: 720 };
      }
      return {
        viewportWidth: 1280,
        viewportHeight: 720,
        contexts: [
          {
            rootRect: { x: 200, y: 140, width: 640, height: 52 },
            text: "Press & Hold Human Challenge requires verification. Please press and hold the button until verified",
            actions: ["Press & Hold"],
            candidates: [
              {
                text: "Press & Hold",
                className: "bMODMganemuJNeo",
                tagName: "DIV",
                role: "button",
                rect: { x: 360, y: 140, width: 320, height: 52 },
              },
            ],
          },
        ],
      };
    },
    async waitForTimeout(ms: number) {
      waits.push(ms);
    },
    isClosed() {
      return false;
    },
  };

  const popup = await detectPremiumOutletsVerifyFocus(page, { timeoutMs: 1000, pollMs: 150 });

  assert.ok(popup);
  assert.equal(evaluateCalls, 2);
  assert.deepEqual(waits, [150]);
  assert.deepEqual(popup?.confirmBounds, { x: 360, y: 140, width: 320, height: 52 });
});

test("validateOrderSessionEvent accepts login_completed", () => {
  const parsed = validateOrderSessionEvent({ type: "login_completed" });
  assert.deepEqual(parsed, { type: "login_completed" });
});

test("validateOrderSessionEvent accepts popup_click ratios", () => {
  const parsed = validateOrderSessionEvent({ type: "popup_click", xRatio: 0.25, yRatio: 0.75 });
  assert.deepEqual(parsed, { type: "popup_click", xRatio: 0.25, yRatio: 0.75 });
});

test("validateOrderSessionEvent accepts popup_hold payload", () => {
  const parsed = validateOrderSessionEvent({ type: "popup_hold", xRatio: 0.5, yRatio: 0.4, durationMs: 2500 });
  assert.deepEqual(parsed, { type: "popup_hold", xRatio: 0.5, yRatio: 0.4, durationMs: 2500 });
});

test("validateOrderSessionEvent accepts fullscreen frame pointer payloads", () => {
  const down = validateOrderSessionEvent({ type: "frame_mousedown", xRatio: 0.2, yRatio: 0.8 });
  const wheel = validateOrderSessionEvent({ type: "frame_wheel", xRatio: 0.5, yRatio: 0.25, deltaY: 120 });
  const keypress = validateOrderSessionEvent({ type: "frame_keypress", key: "Space" });

  assert.deepEqual(down, { type: "frame_mousedown", xRatio: 0.2, yRatio: 0.8 });
  assert.deepEqual(wheel, { type: "frame_wheel", xRatio: 0.5, yRatio: 0.25, deltaX: 0, deltaY: 120 });
  assert.deepEqual(keypress, { type: "frame_keypress", key: "Space" });
});

test("validateOrderSessionEvent accepts popup_switch_view", () => {
  const parsed = validateOrderSessionEvent({ type: "popup_switch_view", view: "confirm" });
  assert.deepEqual(parsed, { type: "popup_switch_view", view: "confirm" });
});

test("parseUsAddress parses common Premium Outlets US address formats", () => {
  assert.deepEqual(parseUsAddress("385 Santana Row, San Jose, CA 95128"), {
    street: "385 Santana Row",
    city: "San Jose",
    state: "CA",
    zipCode: "95128",
    isComplete: true,
    missingFields: [],
  });

  assert.deepEqual(parseUsAddress("385 Santana Row, San Jose, California 95128"), {
    street: "385 Santana Row",
    city: "San Jose",
    state: "CA",
    zipCode: "95128",
    isComplete: true,
    missingFields: [],
  });

  assert.deepEqual(parseUsAddress("385 Santana Row, San Jose CA 95128"), {
    street: "385 Santana Row",
    city: "San Jose",
    state: "CA",
    zipCode: "95128",
    isComplete: true,
    missingFields: [],
  });

  assert.deepEqual(parseUsAddress("875 S Grand Central Pkwy, Las Vegas, NV 89106, USA"), {
    street: "875 S Grand Central Pkwy",
    city: "Las Vegas",
    state: "NV",
    zipCode: "89106",
    isComplete: true,
    missingFields: [],
  });
});

test("parseUsAddress reports missing city/state/zip fields instead of guessing", () => {
  assert.deepEqual(parseUsAddress("385 Santana Row, San Jose, CA"), {
    street: "385 Santana Row",
    city: "San Jose",
    state: "CA",
    zipCode: "",
    isComplete: false,
    missingFields: ["zipCode"],
  });

  assert.deepEqual(parseUsAddress("385 Santana Row"), {
    street: "385 Santana Row",
    city: "",
    state: "",
    zipCode: "",
    isComplete: false,
    missingFields: ["city", "state", "zipCode"],
  });

  assert.equal(
    buildMissingAddressMessage(["city", "state", "zipCode"]),
    "Địa chỉ chưa đủ thông tin. Vui lòng bổ sung city/state/ZIP."
  );
});

test("session store persists timeline and public state hides private payload", () => {
  const store = createInMemoryOrderSessionStore();
  const now = new Date().toISOString();

  const session: OrderSessionPrivateState = {
    id: "session-1",
    provider: "tuoixanhnhanhngon",
    status: "created",
    step: "created",
    progress: 0,
    message: "Đã tạo phiên",
    customer: makeRequest().customer,
    offer: makeRequest().offer,
    quantity: 2,
    delivery: makeRequest().delivery,
    payment: {
      method: "card",
      card: {
        number: "4111111111111111",
        expMonth: "09",
        expYear: "29",
        cvv: "321",
        name: "HUY NGUYEN",
      },
    },
    events: [],
    timeline: [{ at: now, status: "created", message: "Đã tạo phiên" }],
    idempotencyKey: "idem-1",
    createdAt: now,
    updatedAt: now,
    expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
    private: {
      qrImageBase64: "secret-qr",
      lastOtp: "123456",
    },
  };

  store.create(session);
  store.appendEvent(session.id, { type: "confirm_final_action" });
  store.savePopupState(session.id, {
    open: true,
    mode: "popup-focus",
    kind: "payment",
    view: "qr",
    title: "Popup thanh toán",
    text: "Xác nhận thanh toán",
    actions: ["Xác nhận", "Đóng"],
    bounds: { x: 10, y: 20, width: 300, height: 420 },
    qrBounds: { x: 20, y: 40, width: 180, height: 180 },
    confirmBounds: { x: 60, y: 360, width: 220, height: 56 },
    scrollHint: "top",
    updatedAt: now,
  });
  store.savePopupFrame(session.id, "popup-frame-base64", "image/jpeg");
  store.update(session.id, {
    status: "waiting_for_final_confirmation",
    step: "review_order",
    progress: 80,
    message: "Chờ xác nhận cuối",
  });

  const saved = store.get(session.id);
  assert.ok(saved);
  assert.equal(saved?.events.length, 1);
  assert.equal(saved?.timeline.at(-1)?.message, "Chờ xác nhận cuối");

  const publicState = toPublicOrderSessionState(saved!);
  assert.equal(publicState.status, "waiting_for_final_confirmation");
  assert.equal(publicState.timeline.at(-1)?.message, "Chờ xác nhận cuối");
  assert.equal(publicState.popup?.mode, "popup-focus");
  assert.equal(publicState.popup?.view, "qr");
  assert.deepEqual(publicState.popup?.qrBounds, { x: 20, y: 40, width: 180, height: 180 });
  assert.equal(publicState.popup?.scrollHint, "top");
  assert.equal(publicState.interactionFrameAvailable, true);
  assert.equal(publicState.popupFrameAvailable, true);
  assert.equal("private" in publicState, false);
  assert.equal("payment" in publicState, false);
});

test("public state supports full-viewport interaction mode", () => {
  const store = createInMemoryOrderSessionStore();
  const now = new Date().toISOString();

  const session: OrderSessionPrivateState = {
    id: "session-full-viewport-1",
    provider: "premiumoutlets",
    status: "waiting_for_captcha",
    step: "waiting_for_captcha",
    progress: 70,
    message: "Chờ human verification",
    customer: {
      name: "Huy Nguyen",
      email: "huy@example.com",
      phone: "+14085550123",
      address: "385 Santana Row, San Jose, CA 95128",
    },
    offer: {
      productName: "Nike Air Max",
      productUrl: "https://www.premiumoutlets.com/outlet/las-vegas-north/search/shopsimon/product/8910200373308-35814",
    },
    quantity: 1,
    payment: {
      method: "card",
      card: {
        number: "4111111111111111",
        expMonth: "09",
        expYear: "29",
        cvv: "321",
      },
    },
    events: [],
    timeline: [{ at: now, status: "waiting_for_captcha", message: "Chờ human verification" }],
    idempotencyKey: "idem-full-viewport-1",
    createdAt: now,
    updatedAt: now,
    expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
    private: {},
  };

  store.create(session);
  store.savePopupState(session.id, {
    open: true,
    mode: "full-viewport",
    kind: "human_verify",
    view: "full",
    verifyState: "passed",
    verifyHint: "Widget đã pass, thả chuột ngay.",
    interaction: "hold",
    holdDurationMs: 5500,
    title: "Human verification",
    text: "Press & Hold",
    actions: ["Press & Hold"],
    bounds: { x: 0, y: 0, width: 1280, height: 720 },
    confirmBounds: { x: 420, y: 300, width: 320, height: 80 },
    updatedAt: now,
  });
  store.saveInteractionFrame(session.id, "fullscreen-frame-base64", "image/jpeg");

  const publicState = toPublicOrderSessionState(store.get(session.id)!);
  assert.equal(publicState.popup?.mode, "full-viewport");
  assert.equal(publicState.popup?.kind, "human_verify");
  assert.equal(publicState.popup?.verifyState, "passed");
  assert.equal(publicState.popup?.verifyHint, "Widget đã pass, thả chuột ngay.");
  assert.equal(publicState.interactionFrameAvailable, true);
  assert.equal(publicState.popupFrameAvailable, true);
});

test("session store does not append adjacent duplicate timeline entries", () => {
  const store = createInMemoryOrderSessionStore();
  const now = new Date().toISOString();

  const session: OrderSessionPrivateState = {
    id: "session-dedupe-1",
    provider: "tuoixanhnhanhngon",
    status: "running",
    step: "remote_ready",
    progress: 12,
    message: "Đã nhận lệnh run_order cho: Táo đỏ",
    customer: makeRequest().customer,
    offer: makeRequest().offer,
    quantity: 1,
    delivery: makeRequest().delivery,
    events: [],
    timeline: [{ at: now, status: "running", message: "Đã nhận lệnh run_order cho: Táo đỏ" }],
    idempotencyKey: "idem-dedupe-1",
    createdAt: now,
    updatedAt: now,
    expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
    private: {},
  };

  store.create(session);
  store.update(session.id, {
    status: "running",
    step: "dispatch_run_order",
    progress: 12,
    message: "Đã nhận lệnh run_order cho: Táo đỏ",
  });
  store.update(session.id, {
    status: "running",
    step: "dispatch_run_order",
    progress: 12,
    message: "Khởi động AI Agentic (Gemini (gemini-3.5-flash))...",
  });

  const saved = store.get(session.id);
  assert.ok(saved);
  assert.equal(saved?.timeline.length, 2);
  assert.deepEqual(
    saved?.timeline.map((item) => item.message),
    [
      "Đã nhận lệnh run_order cho: Táo đỏ",
      "Khởi động AI Agentic (Gemini (gemini-3.5-flash))...",
    ]
  );
});

test("session store only appends expired timeline entry once across repeated reads", async () => {
  const store = createInMemoryOrderSessionStore(5);
  const now = new Date().toISOString();

  const session: OrderSessionPrivateState = {
    id: "session-expire-1",
    provider: "tuoixanhnhanhngon",
    status: "running",
    step: "checkout",
    progress: 60,
    message: "Đang đặt hàng",
    customer: makeRequest().customer,
    offer: makeRequest().offer,
    quantity: 1,
    delivery: makeRequest().delivery,
    events: [],
    timeline: [{ at: now, status: "running", message: "Đang đặt hàng" }],
    idempotencyKey: "idem-expire-1",
    createdAt: now,
    updatedAt: now,
    expiresAt: new Date(Date.now() + 5).toISOString(),
    private: {},
  };

  store.create(session);
  await new Promise((resolve) => setTimeout(resolve, 20));

  const first = store.get(session.id);
  const second = store.get(session.id);

  assert.equal(first?.status, "expired");
  assert.equal(second?.status, "expired");
  assert.equal(first?.timeline.filter((item) => item.status === "expired").length, 1);
  assert.equal(second?.timeline.filter((item) => item.status === "expired").length, 1);
  assert.equal(second?.timeline.length, 2);
});
