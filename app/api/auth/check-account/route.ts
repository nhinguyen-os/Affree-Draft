import { NextResponse } from "next/server";
import { PURCHASE_WEBHOOK_URL } from "@/lib/config";

/**
 * Kiểm tra SĐT đã có tài khoản chưa (để quyết định luồng: đăng nhập vs đăng ký).
 * ĐÂY LÀ THAO TÁC ĐỌC (không ghi) → KHÔNG chặn bởi ALLOW_SHEET_WRITE.
 * Trả { exists, known }:
 *  - known=true CHỈ khi Apps Script trả kết quả get_account hợp lệ (có field `account`).
 *    exists = đã có dòng tài khoản cho SĐT này.
 *  - known=false khi chưa cấu hình webhook / Apps Script CHƯA deploy get_account / lỗi.
 * Client: CHỈ cho đăng nhập khi exists=true; mọi trường hợp khác → bắt đăng ký (an toàn,
 * không cho đăng nhập ngầm khi chưa xác minh được).
 */
export async function POST(req: Request) {
  let body: { phone?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }

  const phone = (body.phone || "").trim();
  if (!phone) {
    return NextResponse.json({ ok: false, error: "missing phone" }, { status: 400 });
  }

  if (!PURCHASE_WEBHOOK_URL) {
    return NextResponse.json({ ok: true, exists: false, known: false });
  }

  try {
    const res = await fetch(PURCHASE_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "get_account", record: { phone } }),
    });
    const data = await res.json().catch(() => null);
    // Chỉ tin khi get_account chạy thật (ok=true và có field account). "unknown action"
    // (chưa deploy) hoặc lỗi → known=false.
    const valid = !!data && data.ok === true && Object.prototype.hasOwnProperty.call(data, "account");
    if (!valid) return NextResponse.json({ ok: true, exists: false, known: false });
    return NextResponse.json({ ok: true, exists: !!data.account, known: true });
  } catch {
    return NextResponse.json({ ok: true, exists: false, known: false });
  }
}
