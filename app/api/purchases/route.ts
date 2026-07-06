import { NextResponse } from "next/server";
import type { PurchaseRecord } from "@/lib/types";
import { PURCHASE_WEBHOOK_URL, ALLOW_SHEET_WRITE } from "@/lib/config";
import { getSessionUser } from "@/lib/auth-server";

/**
 * Ghi nhận mua hàng.
 * - Nếu có env PURCHASE_WEBHOOK_URL (Apps Script Web App /exec) → POST lên đó để
 *   ghi vào Google Sheet (giống cách dự án KPI/Recruitment đang dùng).
 * - Nếu người mua ĐÃ đăng nhập → server tự gắn buyerUserId (+ buyerPhone) từ PHIÊN
 *   (khoá chính liên kết "đơn của tôi"), KHÔNG tin client. Khách vãng lai → chỉ có SĐT form.
 * - Luôn trả ok để client vẫn lưu localStorage khi chưa cấu hình endpoint.
 */
export async function POST(req: Request) {
  let record: PurchaseRecord;
  try {
    record = (await req.json()) as PurchaseRecord;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }

  // Gắn định danh tài khoản từ phiên (nếu đã đăng nhập) — ưu tiên hơn giá trị client gửi.
  const session = await getSessionUser();
  if (session) {
    if (session.uid) record.buyerUserId = session.uid;
    if (!record.buyerPhone) record.buyerPhone = session.phone;
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
      body: JSON.stringify({ action: "add_purchase", record }),
    });
    const text = await res.text();
    return NextResponse.json({ ok: res.ok, persisted: "sheet", upstream: text.slice(0, 500) });
  } catch (err) {
    return NextResponse.json({ ok: false, persisted: "client-only", error: String(err) });
  }
}
