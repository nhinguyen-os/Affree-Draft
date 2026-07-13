"use client";

import { useEffect, useMemo, useState } from "react";
import { formatMoney } from "@/lib/util";
import { flushProfile, getProfile, saveProfile } from "@/lib/profile";
import { phoneRule } from "@/lib/phone";
import { type Lang, tr } from "@/lib/i18n";
import { acquireBodyScrollLock } from "@/lib/scroll-lock";
import { ensureAccount } from "@/lib/auth";
import OrderInfoSection from "./OrderInfoSection";
import PaymentSection, { usePaymentState } from "./PaymentSection";

/**
 * Form đặt mua NHẠC BẢN QUYỀN (Khúc Chạm Plaza) — sản phẩm SỐ.
 * Đơn giản, KHÔNG dùng màn agentic (không đăng nhập/địa chỉ giao/khung giờ): người nhận +
 * SĐT/Zalo + email để nhận link nhạc + CHỌN thanh toán. DÙNG CHUNG OrderInfoSection +
 * PaymentSection như các form đặt hàng khác, chỉ khác THÔNG TIN RIÊNG theo loại: bỏ địa chỉ
 * giao, thêm email nhận link, thanh toán chỉ QR/Thẻ (không COD) + flow "direct" (trả ngay).
 * Đặt xong → mã đơn, Khúc Chạm liên hệ gửi nhạc.
 */
export interface MusicOrderLine {
  id: string;
  name: string;
  image: string;
  price: number;
  qty?: number;
}

export default function MusicOrderModal({
  items,
  lang = "vi",
  defaultName,
  defaultPhone,
  onClose,
  onPlaced,
}: {
  items: MusicOrderLine[];
  lang?: Lang;
  defaultName?: string;
  defaultPhone?: string;
  onClose: () => void;
  onPlaced: (orderCode: string) => void;
}) {
  const t = (vi: string, vars?: Record<string, string | number>) => tr(lang, vi, vars);
  const [phase, setPhase] = useState<"form" | "done">("form");
  const saved = useMemo(() => getProfile(), []);
  const [name, setName] = useState(defaultName || saved.name);
  const [phone, setPhone] = useState(defaultPhone || saved.phone);
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [orderCode, setOrderCode] = useState("");

  // Thanh toán — DÙNG CHUNG usePaymentState (như CartModal/TuiAgentModal), chỉ giới hạn QR/Thẻ.
  const pay = usePaymentState();

  // Khoá scroll nền — refcount chung (xem lib/scroll-lock.ts).
  useEffect(() => acquireBodyScrollLock(), []);
  useEffect(() => { saveProfile({ name, phone }); }, [name, phone]);

  // Cùng rule VND với OrderInfoSection để canOrder khớp với lỗi hiển thị trong form.
  const rule = useMemo(() => phoneRule("VND"), []);
  const phoneValid = rule.test(phone);
  const phoneError = phone.trim().length > 0 && !phoneValid;
  const emailValid = !email.trim() || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const emailError = email.trim().length > 0 && !emailValid;

  const total = items.reduce((s, l) => s + l.price * (l.qty ?? 1), 0);

  const maskedCardLabel = `${pay.cardBrand ?? t("Thẻ")} ****${pay.cardLast4}`;
  // Đã chọn thanh toán hợp lệ: QR (chỉ cần chọn) hoặc Thẻ (phải đủ thông tin thẻ).
  const paymentReady = pay.method === "qr" || (pay.method === "card" && pay.cardReady);

  // Cần email HOẶC SĐT để Khúc Chạm gửi nhạc; tên bắt buộc; đã chọn thanh toán.
  const canOrder =
    !!name.trim() && (phoneValid || (!!email.trim() && emailValid)) && !emailError && paymentReady;

  const place = () => {
    flushProfile({ name, phone });
    pay.commitCard(); // thẻ mới hợp lệ → lưu lại cho lần sau (localStorage, không CVV)
    // Thanh toán thẻ → tạo tài khoản NGẦM theo SĐT + lưu thẻ ĐÃ CHE (4 số cuối + hãng + hạn).
    if (pay.method === "card" && phone.trim()) {
      ensureAccount(phone.trim(), name.trim(), {
        last4: pay.cardLast4,
        brand: pay.cardBrand,
        exp: pay.usingSavedCard ? pay.savedCard?.exp : pay.cardExp,
      });
    }
    const code = "KC-" + String(Date.now()).slice(-6) + "-" + Math.floor(Math.random() * 900 + 100);
    setOrderCode(code);
    setPhase("done");
    onPlaced(code);
  };

  return (
    <div
      className="fixed inset-0 z-[2300] flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.35)", backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)" }}
      onClick={onClose}
    >
      <div
        className="relative flex max-h-[92vh] w-full max-w-md flex-col overflow-hidden rounded-3xl"
        onClick={(e) => e.stopPropagation()}
        style={{
          backdropFilter: "blur(24px) saturate(160%)",
          WebkitBackdropFilter: "blur(24px) saturate(160%)",
          backgroundColor: "rgba(255,255,255,0.92)",
          boxShadow: "0 0 0 1px rgba(255,255,255,0.5), 0 16px 48px rgba(0,0,0,0.18), inset 0 1px 0 rgba(255,255,255,0.7)",
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/20 px-4 py-3">
          <div className="min-w-0">
            <h2 className="truncate text-base font-bold text-slate-900">
              {phase === "done" ? t("Đã đặt mua") : t("Đặt mua nhạc · Khúc Chạm Plaza")}
            </h2>
            <p className="truncate text-xs text-slate-700">🎵 {t("Nhạc bản quyền — sản phẩm số")}</p>
          </div>
          <button onClick={onClose} className="shrink-0 rounded-full p-1.5 text-slate-500 hover:bg-white/40" aria-label={t("Đóng")}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 py-4">
          {phase === "form" && (
            <div className="space-y-3">
              {/* ── Thông tin chung — MODULE CHUNG với form giỏ hàng / Mua ngay (sản phẩm số → không cần địa chỉ) ── */}
              <OrderInfoSection
                lang={lang}
                name={name}
                phone={phone}
                onName={setName}
                onPhone={setPhone}
                showAddress={false}
              />

              {/* ── Riêng Khúc Chạm Plaza: danh sách nhạc + email nhận link + lời nhắn ── */}
              <section className="space-y-3 rounded-2xl border border-slate-400 p-3">
                <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
                  {items.map((l) => (
                    <div key={l.id} className="flex items-center gap-2.5">
                      {l.image ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={l.image} alt={l.name} className="h-10 w-10 shrink-0 rounded-lg bg-white object-cover" />
                      ) : (
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white text-lg">🎵</div>
                      )}
                      <p className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800">{l.name}</p>
                      <span className="shrink-0 text-sm font-semibold text-emerald-600">
                        {formatMoney(l.price * (l.qty ?? 1))}{(l.qty ?? 1) > 1 ? ` ×${l.qty}` : ""}
                      </span>
                    </div>
                  ))}
                </div>

                <Field label={t("Email (nhận link nhạc)")}>
                  <input
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    inputMode="email"
                    placeholder="email@vidu.com"
                    aria-invalid={emailError}
                    className="input"
                    style={emailError ? { borderColor: "#ef4444" } : undefined}
                  />
                  {emailError && <span className="mt-1 block text-xs text-rose-600">{t("Email không hợp lệ.")}</span>}
                </Field>
                <Field label={t("Ghi chú")}>
                  <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder={t("Lời nhắn cho Khúc Chạm Plaza…")} className="input resize-none" />
                </Field>

                <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-[11px] text-slate-600">
                  {t("Sản phẩm số: Khúc Chạm Plaza liên hệ qua SĐT/Zalo hoặc email để gửi link nhạc bản quyền sau khi đặt.")}
                </p>
              </section>

              {/* ── Thanh toán — DÙNG CHUNG PaymentSection. Riêng loại "nhạc": chỉ QR/Thẻ (bỏ COD),
                  flow "direct" (đặt trả ngay → QR hiện mã quét luôn, không qua bước trợ lý AAAI). ── */}
              <PaymentSection
                pay={pay}
                lang={lang}
                phone={phone}
                methods={["qr", "card"]}
                flow="direct"
                qrInline={`AFFREE|KHUCCHAM|${total}|${(name || "").trim()}`}
                qrAmountLabel={formatMoney(total)}
              />
            </div>
          )}

          {phase === "done" && (
            <div className="flex flex-col items-center py-4 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100">
                <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
              </div>
              <h3 className="mt-3 text-lg font-bold text-slate-900">{t("Đã đặt mua nhạc!")}</h3>
              <p className="mt-1 text-sm text-slate-500">{t("Mã đơn:")}</p>
              <p className="mt-1 text-base font-bold tracking-wide text-emerald-600">{orderCode}</p>
              <div className="mt-4 w-full space-y-1.5 rounded-xl bg-slate-50 p-3 text-left text-sm">
                {items.map((l) => (
                  <Row key={l.id} k={l.name} v={`${formatMoney(l.price * (l.qty ?? 1))}${(l.qty ?? 1) > 1 ? ` ×${l.qty}` : ""}`} />
                ))}
                <div className="border-t border-slate-200 pt-1.5">
                  {!!email.trim() && <Row k="Email" v={email} />}
                  <Row k={t("Thanh toán")} v={pay.method === "qr" ? t("QR chuyển khoản") : maskedCardLabel} />
                  <Row k={t("Tổng")} v={formatMoney(total)} strong />
                </div>
              </div>
              <button onClick={onClose} className="mt-4 w-full rounded-xl border border-slate-200 bg-emerald-600 py-3 text-sm font-semibold text-white transition hover:bg-emerald-700">{t("Xong")}</button>
            </div>
          )}
        </div>

        {phase === "form" && (
          <div className="border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur-sm">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-medium text-slate-800">{t("Tạm tính")}</span>
              <span className="text-lg font-bold text-emerald-600">{formatMoney(total)}</span>
            </div>
            <button
              disabled={!canOrder}
              onClick={place}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-emerald-600 py-3 text-sm font-semibold text-white shadow-[0_4px_14px_rgba(16,185,129,0.35),inset_0_1px_0_rgba(255,255,255,0.25)] transition-all duration-150 hover:bg-emerald-700 active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500 disabled:shadow-none disabled:hover:bg-slate-300"
            >
              {t("Đặt mua")}
            </button>
            {!canOrder && (
              <p className="mt-1.5 text-center text-xs text-slate-400">
                {!name.trim() || !(phoneValid || (!!email.trim() && emailValid))
                  ? t("Nhập tên và SĐT/Zalo hoặc email để đặt.")
                  : t("Chọn phương thức thanh toán để tiếp tục.")}
              </p>
            )}
          </div>
        )}
      </div>

      <style jsx global>{`
        .input {
          width: 100%; border-radius: 0.5rem; border: 1px solid #cbd5e1;
          background: rgba(255,255,255,0.35); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
          padding: 0.5rem 0.75rem; font-size: 0.875rem; color: #0f172a; outline: none;
          transition: border-color 0.15s, box-shadow 0.15s, background 0.15s;
        }
        .input::placeholder { color: rgba(100,116,139,0.7); }
        .input:focus { border-color: rgba(16,185,129,0.7); background: rgba(255,255,255,0.5); box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.18); }
      `}</style>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold text-slate-800">{label}</span>
      {children}
    </label>
  );
}
function Row({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="shrink-0 text-slate-500">{k}</span>
      <span className={`text-right ${strong ? "font-bold text-emerald-600" : "font-medium text-slate-800"}`}>{v}</span>
    </div>
  );
}
