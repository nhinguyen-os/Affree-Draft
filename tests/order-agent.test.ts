import test from "node:test";
import assert from "node:assert/strict";

import { validateCreateOrderSessionRequest, validateOrderSessionEvent } from "../lib/order-agent/validators";
import { createInMemoryOrderSessionStore } from "../lib/order-agent/session-store";
import { toPublicOrderSessionState } from "../lib/order-agent/public-state";
import type { CreateOrderSessionRequest, OrderSessionPrivateState } from "../lib/order-agent/types";

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

test("validateOrderSessionEvent accepts login_completed", () => {
  const parsed = validateOrderSessionEvent({ type: "login_completed" });
  assert.deepEqual(parsed, { type: "login_completed" });
});

test("validateOrderSessionEvent accepts popup_click ratios", () => {
  const parsed = validateOrderSessionEvent({ type: "popup_click", xRatio: 0.25, yRatio: 0.75 });
  assert.deepEqual(parsed, { type: "popup_click", xRatio: 0.25, yRatio: 0.75 });
});

test("validateOrderSessionEvent accepts popup_switch_view", () => {
  const parsed = validateOrderSessionEvent({ type: "popup_switch_view", view: "confirm" });
  assert.deepEqual(parsed, { type: "popup_switch_view", view: "confirm" });
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
  assert.equal(publicState.popupFrameAvailable, true);
  assert.equal("private" in publicState, false);
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
