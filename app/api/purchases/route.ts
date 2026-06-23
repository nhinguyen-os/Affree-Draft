import { NextResponse } from "next/server";
import type { PurchaseRecord } from "@/lib/types";
import { PURCHASE_WEBHOOK_URL } from "@/lib/config";

/**
 * Ghi nhận mua hàng.
 * - Nếu có env PURCHASE_WEBHOOK_URL (Apps Script Web App /exec) → POST lên đó để
 *   ghi vào Google Sheet (giống cách dự án KPI/Recruitment đang dùng).
 * - Luôn trả ok để client vẫn lưu localStorage khi chưa cấu hình endpoint.
 */
export async function POST(req: Request) {
  let record: PurchaseRecord;
  try {
    record = (await req.json()) as PurchaseRecord;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }

  const webhook = PURCHASE_WEBHOOK_URL;
  if (!webhook) {
    return NextResponse.json({ ok: true, persisted: "client-only" });
  }

  try {
    const res = await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "add_purchase", record }),
    });
    const text = await res.text();
    return NextResponse.json({ ok: res.ok, persisted: "sheet", upstream: text.slice(0, 500) });
  } catch (err) {
    return NextResponse.json({ ok: false, persisted: "client-only", error: String(err) });
  }
}
