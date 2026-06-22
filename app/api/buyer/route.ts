import { NextResponse } from "next/server";

/**
 * Lưu hồ sơ người mua (tên / SĐT / địa chỉ).
 * - Nếu có env PURCHASE_WEBHOOK_URL (Apps Script Web App /exec) → POST action save_buyer
 *   để upsert vào tab "buyers" của Google Sheet (theo SĐT).
 * - Luôn trả ok để client vẫn lưu localStorage khi chưa cấu hình endpoint.
 */
export async function POST(req: Request) {
  let record: { name?: string; phone?: string; address?: string };
  try {
    record = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }

  if (!record.phone) {
    return NextResponse.json({ ok: false, error: "missing phone" }, { status: 400 });
  }

  const webhook = process.env.PURCHASE_WEBHOOK_URL;
  if (!webhook) {
    return NextResponse.json({ ok: true, persisted: "client-only" });
  }

  try {
    const res = await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "save_buyer", record }),
    });
    const text = await res.text();
    return NextResponse.json({ ok: res.ok, persisted: "sheet", upstream: text.slice(0, 500) });
  } catch (err) {
    return NextResponse.json({ ok: false, persisted: "client-only", error: String(err) });
  }
}
