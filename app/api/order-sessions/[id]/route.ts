import { NextResponse } from "next/server";

import { toPublicOrderSessionState } from "@/lib/order-agent/public-state";
import { getOrderSessionStore } from "@/lib/order-agent/session-store";

export async function GET(_req: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const session = getOrderSessionStore().get(id);
  if (!session) {
    return NextResponse.json({ ok: false, error: "session not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, state: toPublicOrderSessionState(session) });
}
