import { Buffer } from "node:buffer";

import { NextResponse } from "next/server";

import { getOrderSessionStore } from "@/lib/order-agent/session-store";

export async function GET(_req: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const session = getOrderSessionStore().get(id);
  if (!session) {
    return NextResponse.json({ ok: false, error: "session not found" }, { status: 404 });
  }

  if (!session.private.qrImageBase64) {
    return NextResponse.json({ ok: false, error: "qr code not available" }, { status: 404 });
  }

  const bytes = Buffer.from(session.private.qrImageBase64, "base64");
  return new NextResponse(bytes, {
    status: 200,
    headers: {
      "Content-Type": session.private.qrContentType || "image/png",
      "Cache-Control": "no-store",
    },
  });
}
