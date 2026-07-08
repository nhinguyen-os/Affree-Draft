"use client";

import { useState, useRef, useEffect } from "react";
import { type Lang, tr } from "@/lib/i18n";

// Mục 1 (Tên mô hình) + Mục 5 (Tên giải pháp) — cả 2 phương án tên mỗi mục.
// Tên riêng (tiếng Anh) giữ nguyên; dòng dưới là chú thích (dịch theo ngôn ngữ app).
const SECTIONS: { label: string; names: { name: string; gloss: string }[] }[] = [
  {
    label: "Mô hình ứng dụng",
    names: [
      { name: "Location-Based Commerce Discovery Platform", gloss: "Nền tảng khám phá thương mại theo định vị" },
      { name: "Decentralized Commerce Aggregator", gloss: "Nền tảng tổng hợp thương mại phi tập trung" },
    ],
  },
  {
    label: "Giải pháp",
    names: [
      { name: "Direct-to-Merchant Gateway (DMG)", gloss: "Cổng điều hướng trực tiếp đến nhà bán" },
      { name: "Geo-Commerce Linkage Solution", gloss: "Giải pháp liên kết thương mại theo vị trí" },
    ],
  },
];

export function ModelInfo({ lang = "vi" }: { lang?: Lang }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const t = (vi: string) => tr(lang, vi);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  return (
    <span ref={ref} className="relative mt-0.5 inline-flex">
      <button
        type="button"
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen((v) => !v); }}
        aria-expanded={open}
        className="inline-flex items-center gap-0.5 text-[10px] font-medium text-slate-400 transition hover:text-emerald-600"
      >
        {t("Mô hình & giải pháp")}
        <svg
          width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
          style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform .2s" }}
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div
          className="absolute left-0 top-full z-[2200] mt-1.5 w-[290px] max-w-[85vw] rounded-xl border border-white/50 bg-white/90 p-3 text-left shadow-xl backdrop-blur-xl"
          style={{ WebkitBackdropFilter: "blur(20px)" }}
        >
          {SECTIONS.map((sec) => (
            <div key={sec.label} className="mb-2.5 last:mb-0">
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                {t(sec.label)}
              </p>
              {sec.names.map((n) => (
                <div key={n.name} className="mb-1.5 last:mb-0">
                  <p className="text-[12px] font-semibold leading-snug text-slate-800">{n.name}</p>
                  <p className="text-[11px] leading-snug text-slate-500">{t(n.gloss)}</p>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </span>
  );
}
