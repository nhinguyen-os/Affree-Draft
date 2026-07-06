/**
 * Xác thực phía SERVER cho Affree — SĐT + OTP (không mật khẩu), phiên bằng cookie
 * httpOnly ký HMAC. KHÔNG lưu OTP ở đâu cả: OTP được "khoá" trong 1 challenge ký HMAC
 * (stateless — hợp serverless Vercel). CHỈ dùng trong route handlers (đọc AUTH_SECRET,
 * crypto của Node) — đừng import từ client component.
 */

import { createHmac, randomInt, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import { AUTH_SECRET, OTP_TTL_MS } from "@/lib/config";

export const SESSION_COOKIE = "gqd_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 ngày

export type AuthUser = { phone: string; name?: string; uid?: string };

// ── helpers ────────────────────────────────────────────────────────────────
function b64url(s: string): string {
  return Buffer.from(s, "utf8").toString("base64url");
}
function unb64url(s: string): string {
  return Buffer.from(s, "base64url").toString("utf8");
}
function hmac(data: string): string {
  return createHmac("sha256", AUTH_SECRET).update(data).digest("base64url");
}
/** So sánh chữ ký kiểu constant-time (không rò rỉ theo thời gian). */
function sigEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

// ── OTP ──────────────────────────────────────────────────────────────────────
/** Mã OTP 6 số (chuỗi, giữ số 0 đầu). */
export function genOtp(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

/**
 * Sinh challenge ký HMAC gói {phone, exp}; chữ ký phụ thuộc CẢ otp nên client không
 * suy ra được otp từ challenge. Trả chuỗi "b64(payload).sig".
 */
export function signOtpChallenge(phone: string, otp: string): string {
  const payload = b64url(JSON.stringify({ phone, exp: Date.now() + OTP_TTL_MS }));
  const sig = hmac(`${payload}.${otp}`);
  return `${payload}.${sig}`;
}

/** Kiểm challenge + otp. Đúng SĐT, còn hạn, chữ ký khớp → true. */
export function verifyOtpChallenge(phone: string, otp: string, challenge: string): boolean {
  if (!challenge || !otp) return false;
  const [payload, sig] = challenge.split(".");
  if (!payload || !sig) return false;
  let data: { phone?: string; exp?: number };
  try {
    data = JSON.parse(unb64url(payload));
  } catch {
    return false;
  }
  if (!data.exp || Date.now() > data.exp) return false;
  if (String(data.phone) !== String(phone)) return false;
  return sigEqual(hmac(`${payload}.${otp}`), sig);
}

/**
 * "Gửi" OTP tới SĐT — HIỆN chỉ mô phỏng (log server). Chưa có cổng SMS thật.
 * Sau này ghép Twilio/eSMS/Zalo ZNS tại đây; giữ nguyên chữ ký hàm.
 */
export async function sendOtp(phone: string, otp: string): Promise<void> {
  console.log(`[auth] (mô phỏng) gửi OTP ${otp} tới ${phone}`);
}

// ── Phiên (session cookie) ────────────────────────────────────────────────────
export function signSession(user: AuthUser): string {
  const payload = b64url(
    JSON.stringify({ phone: user.phone, name: user.name || "", uid: user.uid || "", exp: Date.now() + SESSION_TTL_MS })
  );
  return `${payload}.${hmac(payload)}`;
}

export function verifySession(token: string | undefined | null): AuthUser | null {
  if (!token) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  if (!sigEqual(hmac(payload), sig)) return null;
  try {
    const data = JSON.parse(unb64url(payload)) as { phone?: string; name?: string; uid?: string; exp?: number };
    if (!data.phone || !data.exp || Date.now() > data.exp) return null;
    return { phone: data.phone, name: data.name || undefined, uid: data.uid || undefined };
  } catch {
    return null;
  }
}

// ── cookie helpers (Next 16: cookies() là async) ──────────────────────────────
export async function setSessionCookie(user: AuthUser): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, signSession(user), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

export async function getSessionUser(): Promise<AuthUser | null> {
  const store = await cookies();
  return verifySession(store.get(SESSION_COOKIE)?.value);
}
