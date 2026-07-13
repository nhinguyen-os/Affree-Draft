import { NextResponse } from "next/server";
import { PURCHASE_WEBHOOK_URL, ALLOW_SHEET_WRITE } from "@/lib/config";

/**
 * Tạo tài khoản NGẦM khi thanh toán thẻ: nhận { phone, name? }, kiểm tra SĐT đã có tài
 * khoản chưa; chưa thì tạo. KHÔNG set phiên đăng nhập (khách chưa chủ động đăng nhập).
 * Best-effort — fail im lặng để không cản luồng đặt hàng.
 */
export async function POST(req: Request) {
  let body: { phone?: string; name?: string; cardLast4?: string; cardBrand?: string; cardExp?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }

  const phone = (body.phone || "").trim();
  const name = (body.name || "").trim();
  if (!phone) {
    return NextResponse.json({ ok: false, error: "missing phone" }, { status: 400 });
  }
  // Thẻ ĐÃ CHE (nếu có) — chỉ 4 số cuối + hãng + hạn.
  const card = {
    cardLast4: (body.cardLast4 || "").replace(/\D/g, "").slice(-4),
    cardBrand: (body.cardBrand || "").toString().slice(0, 20),
    cardExp: (body.cardExp || "").toString().slice(0, 5),
  };

  if (!PURCHASE_WEBHOOK_URL) {
    return NextResponse.json({ ok: true, persisted: "client-only" });
  }
  if (!ALLOW_SHEET_WRITE) {
    return NextResponse.json({ ok: true, persisted: "skipped-non-prod" });
  }

  try {
    const res = await fetch(PURCHASE_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "ensure_account", record: { phone, name, ...card } }),
    });
    const data = await res.json().catch(() => ({}));
    return NextResponse.json({ ok: res.ok, persisted: "sheet", exists: data?.exists, created: data?.created });
  } catch (err) {
    return NextResponse.json({ ok: false, persisted: "client-only", error: String(err) });
  }
}
