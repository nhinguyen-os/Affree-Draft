"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { type Lang, tr } from "@/lib/i18n";
import { phoneRule } from "@/lib/phone";
import { acquireBodyScrollLock } from "@/lib/scroll-lock";
import { saveProfile } from "@/lib/profile";
import { checkAccount, sendOtp, verifyOtp, type AuthUser } from "@/lib/auth";

/**
 * Đăng nhập bằng SĐT + OTP (không mật khẩu). Mặc định là ĐĂNG NHẬP: chỉ nhập SĐT →
 * kiểm tra tài khoản. Nếu SĐT CHƯA có tài khoản (sheet xác nhận) → chuyển bước ĐĂNG KÝ
 * (nhập tên) rồi mới gửi OTP. OTP đang MÔ PHỎNG (chưa có SMS) → chế độ demo hiện mã.
 */
export default function AuthModal({
  lang = "vi",
  defaultPhone,
  onClose,
  onAuthed,
}: {
  lang?: Lang;
  defaultPhone?: string;
  onClose: () => void;
  onAuthed: (user: AuthUser) => void;
}) {
  const t = (vi: string, vars?: Record<string, string | number>) => tr(lang, vi, vars);
  const rule = useMemo(() => phoneRule("VND"), []);

  const [phase, setPhase] = useState<"phone" | "register" | "otp">("phone");
  const [phone, setPhone] = useState(defaultPhone || "");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [isRegister, setIsRegister] = useState(false); // đang ở luồng đăng ký?
  const [otp, setOtp] = useState("");
  const [challenge, setChallenge] = useState("");
  const [demoOtp, setDemoOtp] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const otpRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => acquireBodyScrollLock(), []);
  useEffect(() => { if (phase === "otp") otpRef.current?.focus(); if (phase === "register") nameRef.current?.focus(); }, [phase]);

  const phoneValid = rule.test(phone);

  /** Gửi OTP rồi chuyển sang bước nhập mã. */
  async function doSendOtp(register: boolean) {
    setBusy(true);
    setError("");
    const res = await sendOtp(phone.trim());
    setBusy(false);
    if (!res.ok || !res.challenge) {
      setError(res.error || t("Không gửi được mã, thử lại."));
      return;
    }
    setChallenge(res.challenge);
    setDemoOtp(res.demo ? res.otp ?? null : null);
    setIsRegister(register);
    setOtp("");
    setPhase("otp");
  }

  /** Bước 1: kiểm tra SĐT → đăng nhập (đã có) hoặc chuyển đăng ký (chưa có). */
  async function handleContinue() {
    if (!phoneValid || busy) return;
    setBusy(true);
    setError("");
    const chk = await checkAccount(phone.trim());
    // CHỈ cho đăng nhập khi CHẮC CHẮN đã có tài khoản. Mọi trường hợp còn lại (chưa có,
    // hoặc chưa xác minh được) → bắt đăng ký, KHÔNG cho đăng nhập ngầm.
    if (chk.exists) {
      await doSendOtp(false);
    } else {
      setBusy(false);
      setPhase("register");
    }
  }

  async function handleVerify() {
    if (otp.trim().length < 6 || busy) return;
    setBusy(true);
    setError("");
    const res = await verifyOtp(phone.trim(), otp.trim(), challenge, name.trim(), {
      email: email.trim(),
      address: address.trim(),
    });
    setBusy(false);
    if (!res.ok || !res.user) {
      setError(res.error || t("Mã không đúng hoặc đã hết hạn."));
      return;
    }
    saveProfile({ name: name.trim(), phone: phone.trim(), address: address.trim() });
    onAuthed(res.user);
  }

  const title = phase === "register" ? t("Đăng ký") : phase === "otp" ? (isRegister ? t("Đăng ký") : t("Đăng nhập")) : t("Đăng nhập");
  const subtitle =
    phase === "phone" ? t("Nhập SĐT để tiếp tục")
      : phase === "register" ? t("Số này chưa có tài khoản — tạo tài khoản mới")
        : t("Nhập mã OTP vừa gửi");

  return (
    <div
      className="fixed inset-0 z-[2400] flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.35)", backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)" }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="relative flex w-full max-w-sm flex-col overflow-hidden rounded-3xl"
        onClick={(e) => e.stopPropagation()}
        style={{
          backdropFilter: "blur(24px) saturate(160%)",
          WebkitBackdropFilter: "blur(24px) saturate(160%)",
          backgroundColor: "rgba(255,255,255,0.94)",
          boxShadow: "0 0 0 1px rgba(255,255,255,0.5), 0 16px 48px rgba(0,0,0,0.18), inset 0 1px 0 rgba(255,255,255,0.7)",
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/20 px-4 py-3">
          <div className="min-w-0">
            <h2 className="truncate text-base font-bold text-slate-900">{title}</h2>
            <p className="truncate text-xs text-slate-700">{subtitle}</p>
          </div>
          <button onClick={onClose} className="shrink-0 rounded-full p-1.5 text-slate-500 hover:bg-white/40" aria-label={t("Đóng")}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="px-4 py-4">
          {phase === "phone" && (
            <div className="space-y-3">
              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-slate-800">{t("Số điện thoại / Zalo")}</span>
                <input
                  type="tel"
                  inputMode="tel"
                  autoFocus
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleContinue(); }}
                  placeholder="VD: 0901234567"
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                />
              </label>
              {error && <p className="text-xs font-medium text-rose-600">{error}</p>}
              <button
                onClick={handleContinue}
                disabled={!phoneValid || busy}
                className="w-full rounded-xl bg-emerald-600 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                {busy ? t("Đang kiểm tra…") : t("Tiếp tục")}
              </button>
            </div>
          )}

          {phase === "register" && (
            <div className="space-y-3">
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                {t("Số {phone} chưa có tài khoản. Nhập tên để tạo tài khoản mới.", { phone })}
              </div>
              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-slate-800">{t("Họ tên")}</span>
                <input
                  ref={nameRef}
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Nguyễn Văn A"
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-slate-800">Email <span className="font-normal text-slate-400">({t("tuỳ chọn")})</span></span>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="ban@email.com"
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-slate-800">{t("Địa chỉ giao hàng")} <span className="font-normal text-slate-400">({t("tuỳ chọn")})</span></span>
                <textarea
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  rows={2}
                  placeholder={t("Số nhà, đường, phường, quận…")}
                  className="w-full resize-none rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                />
              </label>
              {error && <p className="text-xs font-medium text-rose-600">{error}</p>}
              <button
                onClick={() => doSendOtp(true)}
                disabled={!name.trim() || busy}
                className="w-full rounded-xl bg-emerald-600 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                {busy ? t("Đang gửi…") : t("Đăng ký & nhận mã")}
              </button>
              <button onClick={() => { setPhase("phone"); setError(""); }} className="w-full text-center text-xs text-slate-500 hover:text-slate-700">
                ← {t("Đổi số")}
              </button>
            </div>
          )}

          {phase === "otp" && (
            <div className="space-y-3">
              <p className="text-sm text-slate-600">{t("Đã gửi mã tới")} <span className="font-semibold text-slate-800">{phone}</span></p>
              {demoOtp && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  {t("Bản mô phỏng (chưa có SMS) — mã của bạn:")} <span className="font-mono text-sm font-bold">{demoOtp}</span>
                </div>
              )}
              <input
                ref={otpRef}
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                onKeyDown={(e) => { if (e.key === "Enter") handleVerify(); }}
                placeholder="______"
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-center font-mono text-lg tracking-[0.5em] outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
              />
              {error && <p className="text-xs font-medium text-rose-600">{error}</p>}
              <button
                onClick={handleVerify}
                disabled={otp.trim().length < 6 || busy}
                className="w-full rounded-xl bg-emerald-600 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                {busy ? t("Đang xác nhận…") : t("Xác nhận")}
              </button>
              <div className="flex items-center justify-between text-xs">
                <button onClick={() => { setPhase("phone"); setError(""); }} className="text-slate-500 hover:text-slate-700">
                  ← {t("Đổi số")}
                </button>
                <button onClick={() => doSendOtp(isRegister)} disabled={busy} className="font-medium text-emerald-600 hover:text-emerald-700 disabled:text-slate-400">
                  {t("Gửi lại mã")}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
