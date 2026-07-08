import { NextResponse } from "next/server";
import { OTP_DEMO_MODE } from "@/lib/config";
import { genOtp, signOtpChallenge, sendOtp } from "@/lib/auth-server";

/**
 * Bước 1 đăng nhập: nhận { phone } → sinh OTP + challenge ký HMAC (không lưu OTP).
 * "Gửi" OTP (mô phỏng khi chưa có SMS). Trả challenge cho client; ở chế độ demo trả
 * kèm otp để hiển thị. Client gửi lại { phone, otp, challenge } ở bước verify.
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

  const otp = genOtp();
  const challenge = signOtpChallenge(phone, otp);
  await sendOtp(phone, otp);

  return NextResponse.json({
    ok: true,
    challenge,
    demo: OTP_DEMO_MODE,
    ...(OTP_DEMO_MODE ? { otp } : {}),
  });
}
