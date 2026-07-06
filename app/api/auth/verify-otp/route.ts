import { NextResponse } from "next/server";
import { PURCHASE_WEBHOOK_URL, ALLOW_SHEET_WRITE } from "@/lib/config";
import { verifyOtpChallenge, setSessionCookie } from "@/lib/auth-server";

/**
 * Bước 2 đăng nhập: nhận { phone, otp, challenge, name? }. OTP đúng → tạo/đảm bảo tài
 * khoản trong sheet (best-effort, không chặn đăng nhập nếu sheet lỗi) → set cookie phiên.
 * Lần OTP đầu tiên của 1 SĐT chính là "đăng ký".
 */
export async function POST(req: Request) {
  let body: { phone?: string; otp?: string; challenge?: string; name?: string; email?: string; address?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }

  const phone = (body.phone || "").trim();
  const otp = (body.otp || "").trim();
  const challenge = body.challenge || "";
  const name = (body.name || "").trim();
  const email = (body.email || "").trim();
  const address = (body.address || "").trim();

  if (!phone || !otp || !challenge) {
    return NextResponse.json({ ok: false, error: "missing fields" }, { status: 400 });
  }
  if (!verifyOtpChallenge(phone, otp, challenge)) {
    return NextResponse.json({ ok: false, error: "otp không đúng hoặc đã hết hạn" }, { status: 401 });
  }

  // Đảm bảo có tài khoản trong sheet (best-effort — không chặn đăng nhập). Lấy user_id
  // ổn định để nhét vào phiên → gắn đơn theo user_id. Sheet lỗi/chưa deploy → uid rỗng,
  // vẫn đăng nhập được, đơn khớp theo SĐT (dự phòng).
  let created: boolean | undefined;
  let uid: string | undefined;
  if (PURCHASE_WEBHOOK_URL && ALLOW_SHEET_WRITE) {
    try {
      const res = await fetch(PURCHASE_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "ensure_account", record: { phone, name, email, address } }),
      });
      const data = await res.json().catch(() => ({}));
      created = data?.created;
      uid = data?.userId || undefined;
    } catch {
      /* im lặng: vẫn cho đăng nhập, sheet đồng bộ sau */
    }
  }

  await setSessionCookie({ phone, name, uid });
  return NextResponse.json({ ok: true, user: { phone, name: name || undefined }, created });
}
