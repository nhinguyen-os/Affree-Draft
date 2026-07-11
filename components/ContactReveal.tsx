"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { type Lang, tr } from "@/lib/i18n";
import { useOaConfig, followOa } from "@/lib/oa";
import { ZaloFollowButton } from "@/components/ZaloFollowButton";

function maskPhone(phone: string): string {
  const d = (phone || "").replace(/\D/g, "");
  if (d.length < 6) return phone;
  return d.slice(0, 2) + "x".repeat(d.length - 4) + d.slice(-2);
}

function EyeOpen() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}
function EyeClosed() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c6.5 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
      <path d="M6.61 6.61A13.5 13.5 0 0 0 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.39-1.61" />
      <path d="M14.12 14.12A3 3 0 1 1 9.88 9.88M1 1l22 22" />
    </svg>
  );
}

/**
 * Số liên hệ cửa hàng — che số + con mắt. Mặc định ĐÓNG mắt. Mở khoá bằng Quan tâm OA:
 * popup (1 bước, đồng bộ giao diện với gate trang cửa hàng) có widget Quan tâm THẬT của
 * Zalo (nhúng ngay trên web) + nút "Tôi đã quan tâm — xem số". Đã quan tâm rồi → bấm mắt
 * hiện số luôn (không popup).
 */
export function ContactReveal({
  phone,
  lang = "vi",
  className = "",
  source = "contact",
  showLabel = true,
}: {
  phone: string;
  lang?: Lang;
  className?: string;
  source?: string;
  /** false = ẩn chữ "Liên hệ:" (nơi đã có icon điện thoại riêng, vd popup pin map). */
  showLabel?: boolean;
}) {
  const t = (vi: string) => tr(lang, vi);
  const cfg = useOaConfig(); // OA config (oa_id cho widget)
  const [reveal, setReveal] = useState(false); // mặc định ĐÓNG mắt (che số)
  const [popup, setPopup] = useState(false);

  const shown = reveal;

  // Luôn mời Quan tâm mỗi lần mở mắt (i chang gate trang cửa hàng — KHÔNG bỏ qua theo cờ đã-follow).
  const onEye = () => {
    if (reveal) { setReveal(false); return; }
    setPopup(true);
  };

  const confirmFollowed = () => {
    void followOa(source);
    setReveal(true);
    setPopup(false);
  };

  return (
    <span className={`inline-flex items-center gap-1 text-[11px] text-slate-500 ${className}`}>
      {showLabel && <span>{t("Liên hệ")}:</span>}
      {shown ? (
        <a
          href={`tel:${phone.replace(/\s+/g, "")}`}
          className="font-mono text-[11px] font-semibold tracking-wide text-emerald-700 no-underline hover:underline"
        >
          {phone}
        </a>
      ) : (
        <span className="font-mono text-[11px] font-semibold tracking-wide text-slate-600 select-none">
          {maskPhone(phone)}
        </span>
      )}
      <button
        type="button"
        onClick={onEye}
        aria-label={shown ? t("Ẩn số liên hệ") : t("Xem số liên hệ")}
        className="inline-flex items-center text-slate-400 transition hover:text-emerald-600"
      >
        {shown ? <EyeOpen /> : <EyeClosed />}
      </button>

      {/* Popup soft-gate — ĐỒNG BỘ với gate trang cửa hàng (StoreProductsPage). */}
      {popup && typeof document !== "undefined" && createPortal(
        <div className="fixed inset-0 z-[3000] flex items-center justify-center bg-black/40 p-6" onClick={() => setPopup(false)}>
          <div className="w-full max-w-xs rounded-2xl bg-white p-5 text-center shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-2xl">💬</div>
            <h3 className="text-sm font-semibold text-slate-800">{t("Quan tâm OA để xem liên hệ")}</h3>
            <p className="mt-1.5 text-xs leading-relaxed text-slate-500">{t("Quan tâm Zalo OA của công ty để xem thông tin liên hệ mua sản phẩm.")}</p>
            {/* Nút Quan tâm THẬT của Zalo — nhúng ngay trên web, không rời trang. */}
            <div className="mt-4 flex min-h-[40px] items-center justify-center">
              <ZaloFollowButton oaid={cfg.oa_id} />
            </div>
            <button
              type="button"
              onClick={confirmFollowed}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-700 active:scale-[0.98]"
            >
              {t("Tôi đã quan tâm — xem số")}
            </button>
            <button type="button" onClick={() => setPopup(false)} className="mt-2 w-full py-2 text-xs font-medium text-slate-400 hover:text-slate-600">
              {t("Để sau")}
            </button>
          </div>
        </div>,
        document.body
      )}
    </span>
  );
}
