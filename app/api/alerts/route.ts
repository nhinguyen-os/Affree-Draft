import { NextResponse } from "next/server";
import type { PriceAlert } from "@/lib/types";
import { PURCHASE_WEBHOOK_URL, ALLOW_SHEET_WRITE } from "@/lib/config";

/**
 * Ghi nhận đăng ký "báo giá giảm" (thu lead).
 * - Nếu có env PURCHASE_WEBHOOK_URL (Apps Script Web App /exec) → POST action add_alert
 *   để ghi vào tab "alerts" của Google Sheet.
 * - Luôn trả ok để client vẫn lưu localStorage khi chưa cấu hình endpoint.
 */
export async function POST(req: Request) {
  let record: PriceAlert;
  try {
    record = (await req.json()) as PriceAlert;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }

  const webhook = PURCHASE_WEBHOOK_URL;
  if (!webhook) {
    return NextResponse.json({ ok: true, persisted: "client-only" });
  }
  if (!ALLOW_SHEET_WRITE) {
    return NextResponse.json({ ok: true, persisted: "skipped-non-prod" });
  }

  try {
    const res = await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "add_alert", record }),
    });
    const text = await res.text();
    return NextResponse.json({ ok: res.ok, persisted: "sheet", upstream: text.slice(0, 500) });
  } catch (err) {
    return NextResponse.json({ ok: false, persisted: "client-only", error: String(err) });
  }
}
