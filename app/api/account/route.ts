import { NextResponse } from "next/server";
import { PURCHASE_WEBHOOK_URL, ALLOW_SHEET_WRITE } from "@/lib/config";
import { getSessionUser, setSessionCookie } from "@/lib/auth-server";

/** GET: hồ sơ tài khoản đang đăng nhập (đọc từ sheet, fallback về phiên). */
export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  let account: Record<string, unknown> = { phone: user.phone, name: user.name || "" };
  // ĐỌC hồ sơ (kể cả thẻ đã che) từ sheet — read-only nên KHÔNG chặn theo ALLOW_SHEET_WRITE
  // (cờ đó chỉ để chặn GHI ở local/preview). Nhờ vậy /account hiện thẻ cả trên local.
  if (PURCHASE_WEBHOOK_URL) {
    try {
      const res = await fetch(PURCHASE_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "get_account", record: { phone: user.phone } }),
      });
      const data = await res.json().catch(() => ({}));
      if (data?.account) account = { ...account, ...data.account };
    } catch {
      /* im lặng: dùng thông tin từ phiên */
    }
  }
  return NextResponse.json({ ok: true, account });
}

/** POST: cập nhật hồ sơ (name/email/address). Khoá theo SĐT của PHIÊN, không tin client. */
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  let body: { name?: string; email?: string; address?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }

  const record = {
    phone: user.phone,
    name: (body.name || "").trim(),
    email: (body.email || "").trim(),
    address: (body.address || "").trim(),
  };

  // Cập nhật tên trong phiên để header phản ánh ngay (kể cả khi sheet chưa ghi).
  // GIỮ NGUYÊN uid để không mất khoá liên kết đơn.
  if (record.name && record.name !== (user.name || "")) {
    await setSessionCookie({ phone: user.phone, name: record.name, uid: user.uid });
  }

  if (!PURCHASE_WEBHOOK_URL) return NextResponse.json({ ok: true, persisted: "client-only" });
  if (!ALLOW_SHEET_WRITE) return NextResponse.json({ ok: true, persisted: "skipped-non-prod" });

  try {
    const res = await fetch(PURCHASE_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "update_account", record }),
    });
    const text = await res.text();
    return NextResponse.json({ ok: res.ok, persisted: "sheet", upstream: text.slice(0, 500) });
  } catch (err) {
    return NextResponse.json({ ok: false, persisted: "client-only", error: String(err) });
  }
}
