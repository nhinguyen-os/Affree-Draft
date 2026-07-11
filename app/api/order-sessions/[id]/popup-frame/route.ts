import { Buffer } from "node:buffer";

import { NextResponse } from "next/server";

import { getOrderSessionStore } from "@/lib/order-agent/session-store";

export async function GET(_req: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const session = getOrderSessionStore().get(id);
  if (!session) {
    return NextResponse.json({ ok: false, error: "session not found" }, { status: 404 });
  }

  const frameBase64 = session.private.interactionFrameBase64 || session.private.popupFrameBase64;
  const frameContentType = session.private.interactionFrameContentType || session.private.popupFrameContentType;

  if (!frameBase64) {
    return NextResponse.json({ ok: false, error: "popup frame not available" }, { status: 404 });
  }

  const bytes = Buffer.from(frameBase64, "base64");
  return new NextResponse(bytes, {
    status: 200,
    headers: {
      "Content-Type": frameContentType || "image/jpeg",
      "Cache-Control": "no-store",
    },
  });
}
