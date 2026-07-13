"use client";

/**
 * Wrapper client cho luồng đăng nhập SĐT + OTP. Phiên nằm trong cookie httpOnly (server
 * quản), client KHÔNG đọc token trực tiếp — trạng thái đăng nhập lấy qua /api/auth/me.
 */

export type AuthUser = { phone: string; name?: string };

/** Lấy user đang đăng nhập (null nếu chưa). */
export async function fetchMe(): Promise<AuthUser | null> {
  try {
    const res = await fetch("/api/auth/me", { cache: "no-store" });
    const data = await res.json();
    return data?.user ?? null;
  } catch {
    return null;
  }
}

export type CheckAccountResult = { ok: boolean; exists: boolean; known: boolean };

/** Kiểm tra SĐT đã có tài khoản chưa (quyết định đăng nhập vs đăng ký). */
export async function checkAccount(phone: string): Promise<CheckAccountResult> {
  try {
    const res = await fetch("/api/auth/check-account", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone }),
    });
    const data = await res.json();
    return { ok: !!data?.ok, exists: !!data?.exists, known: !!data?.known };
  } catch {
    return { ok: false, exists: false, known: false };
  }
}

export type SendOtpResult = { ok: boolean; challenge?: string; otp?: string; demo?: boolean; error?: string };

/** Bước 1: gửi OTP tới SĐT → trả challenge (và otp ở chế độ demo). */
export async function sendOtp(phone: string): Promise<SendOtpResult> {
  try {
    const res = await fetch("/api/auth/send-otp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone }),
    });
    return await res.json();
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

export type VerifyOtpResult = { ok: boolean; user?: AuthUser; error?: string };

/** Bước 2: xác thực OTP → set phiên, trả user. */
export async function verifyOtp(
  phone: string,
  otp: string,
  challenge: string,
  name?: string,
  extra?: { email?: string; address?: string }
): Promise<VerifyOtpResult> {
  try {
    const res = await fetch("/api/auth/verify-otp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone, otp, challenge, name, email: extra?.email, address: extra?.address }),
    });
    return await res.json();
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

/** Đăng xuất — xoá cookie phiên. */
export async function logout(): Promise<void> {
  try {
    await fetch("/api/auth/logout", { method: "POST" });
  } catch {
    /* noop */
  }
}

/** Thẻ đã CHE — chỉ 4 số cuối + hãng + hạn (KHÔNG số đầy đủ, KHÔNG CVV). */
export type MaskedCard = { last4?: string; brand?: string | null; exp?: string };

/**
 * Tạo tài khoản ngầm (đường thanh toán thẻ) — fire-and-forget, im lặng nếu lỗi.
 * Kèm thẻ ĐÃ CHE nếu có (để hiện lại "Visa ****1234" ở trang tài khoản).
 */
export function ensureAccount(phone: string, name?: string, card?: MaskedCard): void {
  if (!phone) return;
  try {
    void fetch("/api/auth/ensure-account", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        phone,
        name,
        cardLast4: card?.last4 || undefined,
        cardBrand: card?.brand || undefined,
        cardExp: card?.exp || undefined,
      }),
      keepalive: true,
    });
  } catch {
    /* noop */
  }
}
