import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { toPublicOrderSessionState } from "@/lib/order-agent/public-state";
import { getOrderSessionStore } from "@/lib/order-agent/session-store";
import type { OrderSessionPrivateState } from "@/lib/order-agent/types";
import { validateCreateOrderSessionRequest } from "@/lib/order-agent/validators";
import { getOrderWorkerClient } from "@/lib/order-agent/worker-client";

export async function POST(req: Request) {
  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }

  try {
    const parsed = validateCreateOrderSessionRequest(payload);
    const store = getOrderSessionStore();
    const existing = store.findByIdempotencyKey(parsed.idempotencyKey);
    if (existing) {
      return NextResponse.json({ ok: true, sessionId: existing.id, state: toPublicOrderSessionState(existing) });
    }

    const now = new Date().toISOString();
    const session: OrderSessionPrivateState = {
      id: randomUUID(),
      provider: parsed.provider,
      status: "created",
      step: "created",
      progress: 0,
      message: "Đã tạo phiên đặt hàng",
      customer: parsed.customer,
      offer: parsed.offer,
      quantity: parsed.quantity,
      delivery: parsed.delivery,
      payment: parsed.payment,
      idempotencyKey: parsed.idempotencyKey,
      events: [],
      timeline: [{ at: now, status: "created", message: "Đã tạo phiên đặt hàng" }],
      createdAt: now,
      updatedAt: now,
      expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
      private: {},
    };

    const created = store.create(session);
    getOrderWorkerClient().startSession(created.id);

    return NextResponse.json({ ok: true, sessionId: created.id, state: toPublicOrderSessionState(created) });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "unknown error" }, { status: 400 });
  }
}
