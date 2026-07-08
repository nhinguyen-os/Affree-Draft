import { Buffer } from "node:buffer";

import { NextResponse } from "next/server";

import { getOrderSessionStore } from "@/lib/order-agent/session-store";

export async function GET(_req: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const session = getOrderSessionStore().get(id);
  if (!session) {
    return NextResponse.json({ ok: false, error: "session not found" }, { status: 404 });
  }

  if (!session.private.popupFrameBase64) {
    return NextResponse.json({ ok: false, error: "popup frame not available" }, { status: 404 });
  }

  const bytes = Buffer.from(session.private.popupFrameBase64, "base64");
  return new NextResponse(bytes, {
    status: 200,
    headers: {
      "Content-Type": session.private.popupFrameContentType || "image/jpeg",
      "Cache-Control": "no-store",
    },
  });
}
