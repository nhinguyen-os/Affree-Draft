"use client";

import { useEffect, useRef, useState } from "react";
import { getMetrics, reportCatalogSnapshot, type SiteTotals } from "@/lib/metrics";

/**
 * Dải "thống kê nhỏ" tạo niềm tin, đặt cuối trang chủ (trên footer).
 *  • Số ENGAGEMENT thật (lượt truy cập / đơn đã tạo / lượt thêm giỏ) — đọc từ /api/metrics
 *    (Apps Script). Số nào = 0 / chưa cấu hình backend → tự ẩn, không bịa.
 *  • Số COVERAGE thật từ dữ liệu app (sản phẩm / điểm bán / thương hiệu) — luôn hiện.
 *  • Mỗi số đếm tăng dần khi cuộn tới (count-up).
 */

type Props = {
  t: (s: string, vars?: Record<string, string | number>) => string;
  products: number;
  stores: number;
  brands: number;
};

// Đếm tăng dần 0 → value khi phần tử lọt vào màn hình.
function useCountUp(value: number, run: boolean, ms = 1100): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!run || value <= 0) {
      setN(value > 0 && !run ? 0 : value <= 0 ? 0 : value);
      return;
    }
    let raf = 0;
    let t0 = 0;
    let cancelled = false;
    const tick = (now: number) => {
      if (cancelled) return;
      if (!t0) t0 = now;
      const p = Math.min(1, (now - t0) / ms);
      const eased = 1 - Math.pow(1 - p, 3); // easeOutCubic
      setN(Math.round(value * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    // Snap chắc chắn về đúng value (phòng RAF bị treo/throttle ở tab nền).
    const snap = setTimeout(() => setN(value), ms + 200);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      clearTimeout(snap);
    };
  }, [value, run, ms]);
  return n;
}

const fmt = (n: number) => n.toLocaleString("vi-VN");

type StatItem = { emoji: string; value: number; label: string; accent: string };

function Stat({ emoji, value, label, run, accent }: StatItem & { run: boolean }) {
  const n = useCountUp(value, run);
  // Chỉ thêm "+" khi số đủ lớn (≥ 50). Số nhỏ → hiện chính xác ("2", "1").
  const suffix = value >= 50 ? "+" : "";
  return (
    <div className="flex min-w-[96px] flex-col items-center gap-1 px-2 py-1 text-center sm:min-w-[120px]">
      <span className="text-2xl sm:text-3xl" aria-hidden>
        {emoji}
      </span>
      <span className={`text-2xl font-extrabold leading-tight sm:text-4xl ${accent}`}>
        {fmt(n)}
        {suffix}
      </span>
      <span className="text-xs leading-tight text-slate-500 sm:text-sm">{label}</span>
    </div>
  );
}

export function SiteStats({ t, products, stores, brands }: Props) {
  const [totals, setTotals] = useState<SiteTotals | null>(null);
  const [run, setRun] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    getMetrics().then(setTotals);
  }, []);

  useEffect(() => {
    if (products > 0 || stores > 0 || brands > 0) {
      reportCatalogSnapshot(products, stores, brands);
    }
  }, [products, stores, brands]);

  // Chạy count-up khi dải lọt vào màn hình; fallback: tự chạy sau 1.2s nếu observer
  // không kích hoạt (đảm bảo số luôn hiện đúng, không kẹt ở 0).
  useEffect(() => {
    const el = rootRef.current;
    const fallback = setTimeout(() => setRun(true), 1200);
    if (el && typeof IntersectionObserver !== "undefined") {
      const io = new IntersectionObserver(
        (entries) => {
          if (entries.some((e) => e.isIntersecting)) {
            setRun(true);
            io.disconnect();
          }
        },
        { threshold: 0.2 },
      );
      io.observe(el);
      return () => { io.disconnect(); clearTimeout(fallback); };
    }
    return () => clearTimeout(fallback);
  }, []);

  // Nhóm HOẠT ĐỘNG (engagement thật — ẩn nếu = 0) và nhóm QUY MÔ (coverage — luôn hiện).
  const activity: StatItem[] = [];
  if (totals && totals.visits > 0)
    activity.push({ emoji: "👀", value: totals.visits, label: t("Lượt truy cập"), accent: "text-emerald-600" });
  if (totals && totals.orders > 0)
    activity.push({ emoji: "🧾", value: totals.orders, label: t("Đơn đã tạo"), accent: "text-orange-600" });
  if (totals && totals.carts > 0)
    activity.push({ emoji: "🛒", value: totals.carts, label: t("Lượt thêm giỏ"), accent: "text-pink-600" });
  const scale: StatItem[] = [
    { emoji: "📦", value: products, label: t("Sản phẩm so giá"), accent: "text-slate-800" },
    { emoji: "🏪", value: stores, label: t("Điểm bán quanh bạn"), accent: "text-slate-800" },
    { emoji: "🏷️", value: brands, label: t("Nhãn hiệu"), accent: "text-slate-800" },
  ];

  return (
    <section
      ref={rootRef}
      className="mt-8 rounded-2xl bg-gradient-to-br from-emerald-50 via-white to-sky-50 p-4 ring-1 ring-black/[0.06] shadow-[0_4px_18px_-8px_rgba(15,23,42,0.18)] sm:p-5"
      aria-label={t("Thống kê Affree")}
    >
      <div className="mb-4 flex items-center justify-center gap-2 text-center">
        <span className="text-lg sm:text-xl" aria-hidden>📊</span>
        <h2 className="text-base font-bold text-slate-700 sm:text-lg">
          {t("Affree trong những con số")}
        </h2>
      </div>
      <div className="flex flex-col items-stretch gap-4 sm:flex-row sm:items-center sm:justify-center sm:gap-0">
        {activity.length > 0 && (
          <div className="grid grid-cols-3 gap-y-3 sm:flex sm:gap-7">
            {activity.map((it) => (
              <Stat key={it.label} {...it} run={run} />
            ))}
          </div>
        )}
        {activity.length > 0 && (
          <div
            className="mx-auto h-px w-1/2 bg-slate-200/80 sm:mx-4 sm:h-12 sm:w-px"
            aria-hidden
          />
        )}
        <div className="grid grid-cols-3 gap-y-3 sm:flex sm:gap-7">
          {scale.map((it) => (
            <Stat key={it.label} {...it} run={run} />
          ))}
        </div>
      </div>
      <p className="mt-3 text-center text-[11px] text-slate-400">
        {t("Kết nối mua bán - Không thu phí")} · {t("Số liệu cập nhật liên tục")}
      </p>
    </section>
  );
}

export default SiteStats;
