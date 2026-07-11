import { NextResponse } from "next/server";
import { PURCHASE_WEBHOOK_URL, ALLOW_SHEET_WRITE } from "@/lib/config";
import { getSessionUser } from "@/lib/auth-server";

/** Đơn hàng của tài khoản đang đăng nhập — lọc theo SĐT của PHIÊN từ tab purchases. */
export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  if (!PURCHASE_WEBHOOK_URL || !ALLOW_SHEET_WRITE) {
    return NextResponse.json({ ok: true, orders: [], persisted: "skipped-non-prod" });
  }

  try {
    const res = await fetch(PURCHASE_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "get_orders", record: { userId: user.uid, phone: user.phone } }),
    });
    const data = await res.json().catch(() => ({}));
    return NextResponse.json({ ok: true, orders: Array.isArray(data?.orders) ? data.orders : [] });
  } catch (err) {
    return NextResponse.json({ ok: false, orders: [], error: String(err) });
  }
}
