import { NextResponse } from "next/server";

import { toPublicOrderSessionState } from "@/lib/order-agent/public-state";
import { getOrderSessionStore } from "@/lib/order-agent/session-store";
import { validateOrderSessionEvent } from "@/lib/order-agent/validators";
import { getOrderWorkerClient } from "@/lib/order-agent/worker-client";

export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const store = getOrderSessionStore();
  const existing = store.get(id);
  if (!existing) {
    return NextResponse.json({ ok: false, error: "session not found" }, { status: 404 });
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }

  try {
    const event = validateOrderSessionEvent(payload);
    store.appendEvent(id, event);
    getOrderWorkerClient().handleEvent(id, event);
    const updated = store.get(id);

    return NextResponse.json({
      ok: true,
      state: updated ? toPublicOrderSessionState(updated) : null,
    });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "unknown error" }, { status: 400 });
  }
}
