"use client";

import { useEffect, useState } from "react";
import QRCode from "react-qr-code";
import { getSavedCard, saveCard, fetchAccountCard, type SavedCard } from "@/lib/cards";
import { type Lang, tr } from "@/lib/i18n";

/**
 * MODULE CHUNG — section "Thanh toán" (tab QR / Thẻ / COD + thẻ đã lưu + nhập thẻ mới),
 * cấu trúc + style lấy theo form giỏ hàng (CartModal) làm chuẩn. Dùng cho form Mua cả túi
 * (TuiAgentModal) và các form đặt hàng khác cần chọn thanh toán giống giỏ.
 * State gói trong hook usePaymentState() để form cha đọc được method/cardReady cho gating
 * + các bước trợ lý.
 */

// Loại thẻ chấp nhận — chip sáng theo đầu số đang gõ (đồng bộ CartModal).
export const CARD_BRANDS = ["Visa", "Mastercard", "JCB", "Amex", "Napas"] as const;
export type CardBrand = (typeof CARD_BRANDS)[number];
export const CARD_BRAND_STYLE: Record<CardBrand, string> = {
  Visa: "border-[#1A1F71] bg-[#1A1F71]/5 text-[#1A1F71]",
  Mastercard: "border-[#EB001B] bg-[#EB001B]/5 text-[#EB001B]",
  JCB: "border-emerald-600 bg-emerald-50 text-emerald-700",
  Amex: "border-sky-600 bg-sky-50 text-sky-700",
  Napas: "border-teal-600 bg-teal-50 text-teal-700",
};
/** Nhận diện loại thẻ theo đầu số: 4=Visa, 51-55/22-27=Mastercard, 34/37=Amex, 35=JCB, 9704=Napas nội địa. */
export function detectCardBrand(num: string): CardBrand | null {
  const n = num.replace(/\s/g, "");
  if (!n) return null;
  if (n.startsWith("9704")) return "Napas";
  if (/^4/.test(n)) return "Visa";
  if (/^(5[1-5]|2[2-7])/.test(n)) return "Mastercard";
  if (/^3[47]/.test(n)) return "Amex";
  if (/^35/.test(n)) return "JCB";
  return null;
}

export type PayMethod = "qr" | "card" | "cod";

/** State thanh toán dùng chung giữa PaymentSection (UI) và form cha (gating + bước trợ lý). */
export function usePaymentState() {
  const [method, setMethod] = useState<PayMethod | null>(null);
  const [cardNumber, setCardNumber] = useState("");
  const [cardName, setCardName] = useState("");
  const [cardExp, setCardExp] = useState("");
  const [cardCvv, setCardCvv] = useState("");
  // Thẻ đã lưu từ lần mua trước (localStorage) — có thì mặc định dùng lại, khỏi nhập.
  const [savedCard, setSavedCard] = useState<SavedCard | null>(() => getSavedCard());
  // Chưa có thẻ local → lấy thẻ đã che từ tài khoản (sheet) khi đã đăng nhập (đồng bộ CartModal/OrderAgentModal).
  useEffect(() => {
    if (getSavedCard()) return;
    let alive = true;
    void fetchAccountCard().then((c) => { if (alive && c) setSavedCard(c); });
    return () => { alive = false; };
  }, []);
  const [useNewCard, setUseNewCard] = useState(false);
  // Xem full số thẻ đã lưu: bấm 👁 → OTP (mô phỏng) → nhập đúng mới hiện.
  const [otpCode, setOtpCode] = useState<string | null>(null);
  const [otpInput, setOtpInput] = useState("");
  const [otpError, setOtpError] = useState(false);
  const [cardRevealed, setCardRevealed] = useState(false);

  const usingSavedCard = !!savedCard && !useNewCard;
  const newCardReady =
    cardNumber.replace(/\s/g, "").length >= 12 &&
    cardName.trim().length > 0 &&
    /^\d{2}\/\d{2}$/.test(cardExp) &&
    cardCvv.length >= 3;
  const cardReady = usingSavedCard || newCardReady;
  const activeCardNumber = usingSavedCard ? savedCard!.number : cardNumber;
  const cardBrand = usingSavedCard ? (savedCard!.brand as CardBrand | null) : detectCardBrand(activeCardNumber);
  const cardLast4 = activeCardNumber.replace(/\D/g, "").slice(-4);

  /** Gọi khi bắt đầu đặt: thẻ MỚI hợp lệ → lưu lại (localStorage, không CVV) cho lần sau. */
  const commitCard = () => {
    if (method === "card" && !usingSavedCard && newCardReady) {
      saveCard({ number: cardNumber, name: cardName, exp: cardExp, brand: detectCardBrand(cardNumber) });
    }
  };

  return {
    method, setMethod,
    cardNumber, setCardNumber, cardName, setCardName, cardExp, setCardExp, cardCvv, setCardCvv,
    savedCard, useNewCard, setUseNewCard,
    otpCode, setOtpCode, otpInput, setOtpInput, otpError, setOtpError,
    cardRevealed, setCardRevealed,
    usingSavedCard, newCardReady, cardReady, cardBrand, cardLast4,
    commitCard,
  };
}
export type PaymentState = ReturnType<typeof usePaymentState>;

const CARD_INPUT_CLS =
  "w-full rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-mono outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100";

/** Bộ 4 ô nhập thẻ mới — dùng ở section Thanh toán lẫn bước trợ lý (pause pay-card). */
export function CardInputs({ pay, lang = "vi" }: { pay: PaymentState; lang?: Lang }) {
  const t = (vi: string, vars?: Record<string, string | number>) => tr(lang, vi, vars);
  return (
    <>
      <input
        type="text"
        inputMode="numeric"
        maxLength={19}
        value={pay.cardNumber}
        onChange={(e) => pay.setCardNumber(e.target.value.replace(/\D/g, "").replace(/(.{4})/g, "$1 ").trim())}
        placeholder={t("Số thẻ") + " 0000 0000 0000 0000"}
        className={CARD_INPUT_CLS}
      />
      <input
        type="text"
        value={pay.cardName}
        onChange={(e) => pay.setCardName(e.target.value.toUpperCase())}
        placeholder={t("Tên chủ thẻ")}
        className={CARD_INPUT_CLS}
      />
      <div className="flex gap-2">
        <input
          type="text"
          maxLength={5}
          value={pay.cardExp}
          onChange={(e) => { const v = e.target.value.replace(/\D/g, ""); pay.setCardExp(v.length > 2 ? `${v.slice(0, 2)}/${v.slice(2)}` : v); }}
          placeholder="MM/YY"
          className={CARD_INPUT_CLS}
        />
        <input
          type="password"
          maxLength={4}
          value={pay.cardCvv}
          onChange={(e) => pay.setCardCvv(e.target.value.replace(/\D/g, ""))}
          placeholder="CVV"
          className={CARD_INPUT_CLS}
        />
      </div>
    </>
  );
}

export default function PaymentSection({
  pay,
  lang = "vi",
  phone = "",
  qrHintVi = "Trợ lý AAAI sẽ hiện mã QR để bạn quét tại từng cửa hàng khi đặt.",
  className = "",
  methods = ["qr", "card", "cod"],
  flow = "agentic",
  qrInline = null,
  qrAmountLabel = "",
}: {
  pay: PaymentState;
  lang?: Lang;
  /** SĐT người mua — hiện đuôi số trong khung OTP mô phỏng. */
  phone?: string;
  /** Ghi chú khi chọn QR (form túi/giỏ có thể diễn đạt khác nhau). */
  qrHintVi?: string;
  className?: string;
  /** TUỲ LOẠI ĐƠN: phương thức được phép (vd nhạc = ["qr","card"], bỏ COD). */
  methods?: PayMethod[];
  /**
   * "agentic" = trợ lý đặt hộ từng cửa hàng (QR/thẻ thao tác ở bước sau) — mặc định.
   * "direct" = đặt trả ngay tại form (nhạc/sản phẩm số): QR hiện mã QUÉT NGAY, chữ không nhắc "trợ lý".
   */
  flow?: "agentic" | "direct";
  /** flow="direct" + method="qr": chuỗi encode vào QR để hiện mã quét ngay. null = chỉ hiện gợi ý. */
  qrInline?: string | null;
  /** Nhãn số tiền hiện dưới mã QR (flow direct). */
  qrAmountLabel?: string;
}) {
  const t = (vi: string, vars?: Record<string, string | number>) => tr(lang, vi, vars);
  const maskedCardLabel = `${pay.cardBrand ?? t("Thẻ")} ****${pay.cardLast4}`;
  const direct = flow === "direct";
  // Chữ ghi chú thẻ tuỳ flow: direct (trả ngay) không nhắc "trợ lý".
  const cardReadyNote =
    "✓ " +
    (direct
      ? t("Dùng {card} thanh toán.", { card: maskedCardLabel })
      : t("{card} sẽ được trợ lý dùng thanh toán tự động.", { card: maskedCardLabel }));
  const cardEmptyNote =
    "💳 " +
    (direct
      ? t("Điền đủ thông tin thẻ để đặt.")
      : t("Điền đủ để trợ lý tự thanh toán — hoặc bỏ trống, nhập ở bước đặt hàng."));

  // Bấm 👁: đang hiện → che lại; đang che → sinh OTP 6 số (mô phỏng), nhập đúng mới hiện.
  const requestRevealCard = () => {
    if (pay.cardRevealed) {
      pay.setCardRevealed(false);
      pay.setOtpCode(null);
      pay.setOtpInput("");
      pay.setOtpError(false);
      return;
    }
    pay.setOtpCode(String(Math.floor(100000 + Math.random() * 900000)));
    pay.setOtpInput("");
    pay.setOtpError(false);
  };
  const verifyOtp = () => {
    if (pay.otpInput === pay.otpCode) {
      pay.setCardRevealed(true);
      pay.setOtpCode(null);
      pay.setOtpError(false);
    } else {
      pay.setOtpError(true);
    }
  };

  const brandChipsRow = (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-[10px] text-slate-400">{t("Chấp nhận")}:</span>
      {CARD_BRANDS.map((b) => (
        <span
          key={b}
          className={`rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide transition ${
            pay.cardBrand === b
              ? CARD_BRAND_STYLE[b] + " ring-1 ring-current"
              : "border-slate-200 text-slate-400" + (pay.cardBrand ? " opacity-40" : "")
          }`}
        >
          {b}
        </span>
      ))}
    </div>
  );

  return (
    <section className={`rounded-2xl border border-slate-200 p-3 ${className}`}>
      <h3 className="mb-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
        {t("Thanh toán")}
      </h3>
      {/* Tabs — chỉ hiện các phương thức được phép theo LOẠI đơn (methods). */}
      <div className="mb-3 flex gap-1.5">
        {methods.map((m) => (
          <button
            key={m}
            onClick={() => pay.setMethod(m)}
            className={`flex-1 rounded-lg border py-1.5 text-xs font-semibold transition-colors ${pay.method === m ? "border-emerald-500 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"}`}
          >
            {m === "qr" ? "📱 QR" : m === "card" ? "💳 " + t("Thẻ") : "💵 COD"}
          </button>
        ))}
      </div>

      {/* QR: flow "direct" (trả ngay) → hiện MÃ QR để quét luôn; flow "agentic" → chỉ gợi ý. */}
      {pay.method === "qr" && (
        direct && qrInline ? (
          <div className="flex flex-col items-center gap-2 rounded-xl bg-slate-50 px-3 py-3">
            <div className="rounded-lg bg-white p-2"><QRCode value={qrInline} size={128} /></div>
            <p className="text-center text-[11px] text-slate-500">
              📱 {t("Quét mã để chuyển khoản")}{qrAmountLabel ? " " : ""}<b className="text-emerald-600">{qrAmountLabel}</b>.
            </p>
          </div>
        ) : (
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">📱 {t(qrHintVi)}</p>
        )
      )}

      {/* COD (chỉ khi methods có "cod"): thao tác ở bước trợ lý. */}
      {pay.method === "cod" && (
        <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
          {"💵 " + t("Thanh toán khi nhận hàng (COD) — nhân viên giao hàng thu tiền mặt.")}
        </p>
      )}

      {/* Thẻ: có thẻ ĐÃ LƯU → mặc định chọn lại, 👁 + OTP mô phỏng để xem full số.
          Chưa có / "Dùng thẻ khác" → điền ngay tại form. */}
      {pay.method === "card" && pay.usingSavedCard && pay.savedCard && (
        <div className="space-y-2">
          <p className="text-[10px] text-slate-400">{t("Chọn thẻ")}:</p>
          <div className="flex items-center gap-2 rounded-xl border border-emerald-400 bg-emerald-50/60 px-3 py-2 ring-1 ring-emerald-200">
            <span className={`rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${pay.cardBrand ? CARD_BRAND_STYLE[pay.cardBrand] : "border-slate-300 text-slate-500"}`}>
              {pay.cardBrand ?? t("Thẻ")}
            </span>
            <span className="flex-1 truncate font-mono text-sm text-slate-800">
              {pay.cardRevealed ? pay.savedCard.number : `****${pay.cardLast4}`}
            </span>
            <button
              type="button"
              onClick={requestRevealCard}
              aria-label={pay.cardRevealed ? t("Ẩn số thẻ") : t("Xem số thẻ")}
              title={pay.cardRevealed ? t("Ẩn số thẻ") : t("Xem số thẻ (cần OTP)")}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-slate-400 transition hover:bg-white hover:text-slate-700"
            >
              {pay.cardRevealed ? (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" /><line x1="1" y1="1" x2="23" y2="23" /></svg>
              ) : (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z" /><circle cx="12" cy="12" r="3" /></svg>
              )}
            </button>
          </div>

          {/* OTP mô phỏng: khung "tin nhắn" chứa mã + ô nhập, đúng mã mới hiện số thẻ */}
          {pay.otpCode && !pay.cardRevealed && (
            <div className="space-y-1.5 rounded-lg bg-slate-50 px-3 py-2 ring-1 ring-slate-200">
              <p className="text-[11px] text-slate-500">
                📩 {t("(Mô phỏng) OTP đã gửi tới SĐT")} ****{phone.replace(/\D/g, "").slice(-3) || "•••"}: <b className="font-mono text-slate-700">{pay.otpCode}</b>
              </p>
              <div className="flex gap-2">
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  value={pay.otpInput}
                  onChange={(e) => { pay.setOtpInput(e.target.value.replace(/\D/g, "")); pay.setOtpError(false); }}
                  placeholder={t("Nhập OTP 6 số")}
                  className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-mono outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                />
                <button
                  type="button"
                  onClick={verifyOtp}
                  disabled={pay.otpInput.length < 6}
                  className="shrink-0 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:bg-slate-300"
                >
                  {t("Xác nhận")}
                </button>
              </div>
              {pay.otpError && <p className="text-[11px] text-rose-600">{t("OTP chưa đúng — thử lại.")}</p>}
            </div>
          )}

          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] text-slate-400">{cardReadyNote}</p>
            <button
              type="button"
              onClick={() => { pay.setUseNewCard(true); pay.setCardRevealed(false); pay.setOtpCode(null); pay.setOtpInput(""); pay.setOtpError(false); }}
              className="shrink-0 text-[11px] font-medium text-emerald-600 underline-offset-2 hover:underline"
            >
              {t("Dùng thẻ khác")}
            </button>
          </div>
        </div>
      )}

      {pay.method === "card" && !pay.usingSavedCard && (
        <div className="space-y-2">
          {pay.savedCard && (
            <button
              type="button"
              onClick={() => pay.setUseNewCard(false)}
              className="text-[11px] font-medium text-emerald-600 underline-offset-2 hover:underline"
            >
              ← {t("Dùng thẻ đã lưu")} ({pay.savedCard.brand ?? t("Thẻ")} ****{pay.savedCard.number.replace(/\D/g, "").slice(-4)})
            </button>
          )}
          {brandChipsRow}
          <CardInputs pay={pay} lang={lang} />
          <p className="text-[11px] text-slate-400">{pay.cardReady ? cardReadyNote : cardEmptyNote}</p>
        </div>
      )}
    </section>
  );
}
