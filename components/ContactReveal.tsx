"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { type Lang, tr } from "@/lib/i18n";
import { useOaConfig, useOaFollowed, followOa } from "@/lib/oa";
import { ZaloFollowButton } from "@/components/ZaloFollowButton";

function maskPhone(phone: string): string {
  const c = (phone || "").trim();
  if (c.length <= 4) return c;
  return c.slice(0, 2) + "x".repeat(Math.max(2, c.length - 4)) + c.slice(-2);
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
 * Số liên hệ cửa hàng — che số + con mắt. Mở khoá bằng "Quan tâm Zalo OA":
 *  - Đã quan tâm (cờ localStorage) / OA không bắt buộc → hiện số.
 *  - Chưa → bấm mắt → popup: mời → màn "Đăng nhập Zalo" MÔ PHỎNG → Cho phép
 *    → tạo tài khoản Zalo giả (zalo_id) + mở link OA + lưu vào danh sách follower.
 */
export function ContactReveal({
  phone,
  lang = "vi",
  className = "",
  source = "contact",
}: {
  phone: string;
  lang?: Lang;
  className?: string;
  source?: string;
}) {
  const t = (vi: string) => tr(lang, vi);
  const followed = useOaFollowed();
  const cfg = useOaConfig();
  const [reveal, setReveal] = useState(false); // mặc định ĐÓNG mắt (che số), bấm mới mở
  const [popup, setPopup] = useState(false);
  const [step, setStep] = useState<"prompt" | "consent">("prompt");

  const canSee = !cfg.require_follow || followed;
  const shown = canSee && reveal;

  const openPopup = () => { setStep("prompt"); setPopup(true); };
  const closePopup = () => { setPopup(false); setStep("prompt"); };

  const onEye = () => {
    if (!canSee) { openPopup(); return; }
    setReveal((v) => !v);
  };

  // Đã bấm Quan tâm (qua widget Zalo thật) → xác nhận: lưu follower + mở mắt + đóng popup.
  const confirmFollowed = () => {
    void followOa(source);
    setReveal(true);
    closePopup();
  };

  return (
    <span className={`inline-flex items-center gap-1 text-[11px] text-slate-500 ${className}`}>
      <span>{t("Liên hệ")}:</span>
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

      {popup && typeof document !== "undefined" && createPortal(
        <div className="fixed inset-0 z-[3000] flex items-center justify-center bg-black/45 p-4" onClick={closePopup}>
          <div className="w-full max-w-[330px] overflow-hidden rounded-2xl bg-white text-center shadow-2xl" onClick={(e) => e.stopPropagation()}>
            {step === "prompt" ? (
              <div className="p-5">
                {cfg.oa_logo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={cfg.oa_logo} alt={cfg.oa_name} className="mx-auto mb-3 h-14 w-14 rounded-full object-cover" />
                ) : (
                  <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-blue-50 text-blue-600">
                    <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2C6.5 2 2 5.9 2 10.7c0 2.7 1.5 5.1 3.8 6.7-.1.9-.6 2.3-1.3 3.4-.2.3.1.7.4.6 2-.6 3.5-1.4 4.3-2 .9.2 1.8.3 2.8.3 5.5 0 10-3.9 10-8.7S17.5 2 12 2Z" /></svg>
                  </div>
                )}
                <p className="text-[15px] font-bold text-slate-800">{cfg.popup_title}</p>
                <p className="mt-1.5 text-[12px] leading-relaxed text-slate-500">{cfg.popup_desc}</p>
                <button
                  type="button"
                  onClick={() => setStep("consent")}
                  className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-[13px] font-semibold text-white transition hover:bg-blue-700"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2C6.5 2 2 5.9 2 10.7c0 2.7 1.5 5.1 3.8 6.7-.1.9-.6 2.3-1.3 3.4-.2.3.1.7.4.6 2-.6 3.5-1.4 4.3-2 .9.2 1.8.3 2.8.3 5.5 0 10-3.9 10-8.7S17.5 2 12 2Z" /></svg>
                  {t("Quan tâm Zalo OA")}
                </button>
                <button type="button" onClick={closePopup} className="mt-2 w-full rounded-xl px-4 py-2 text-[12px] font-medium text-slate-500 transition hover:bg-slate-100">
                  {t("Để sau")}
                </button>
              </div>
            ) : (
              <div>
                <div className="flex items-center gap-2 bg-blue-600 px-4 py-3 text-left text-white">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2C6.5 2 2 5.9 2 10.7c0 2.7 1.5 5.1 3.8 6.7-.1.9-.6 2.3-1.3 3.4-.2.3.1.7.4.6 2-.6 3.5-1.4 4.3-2 .9.2 1.8.3 2.8.3 5.5 0 10-3.9 10-8.7S17.5 2 12 2Z" /></svg>
                  <span className="text-[14px] font-bold">{cfg.oa_name}</span>
                </div>
                <div className="p-5 text-center">
                  <p className="text-[12px] leading-relaxed text-slate-500">
                    {t("Bấm Quan tâm để theo dõi OA, sau đó bấm \"Tôi đã quan tâm\" để xem số.")}
                  </p>
                  {/* Nút Quan tâm THẬT của Zalo (widget). data-oaid lấy từ cấu hình OA. */}
                  <div className="mt-4 flex min-h-[40px] justify-center">
                    <ZaloFollowButton oaid={cfg.oa_id} />
                  </div>
                  <button
                    type="button"
                    onClick={confirmFollowed}
                    className="mt-4 w-full rounded-xl bg-emerald-600 px-4 py-2.5 text-center text-[13px] font-semibold text-white transition hover:bg-emerald-700"
                  >
                    {t("Tôi đã quan tâm — xem số")}
                  </button>
                  <button type="button" onClick={() => setStep("prompt")} className="mt-2 w-full rounded-xl px-4 py-2 text-center text-[12px] font-medium text-slate-500 transition hover:bg-slate-100">
                    {t("Quay lại")}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>,
        document.body
      )}
    </span>
  );
}
