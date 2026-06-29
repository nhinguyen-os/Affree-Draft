import test from "node:test";
import assert from "node:assert/strict";

import { validateCreateOrderSessionRequest } from "../lib/order-agent/validators";
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
  assert.equal("private" in publicState, false);
});
