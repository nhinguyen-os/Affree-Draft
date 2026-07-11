"use client";

import { useRef, useState, useEffect, type Dispatch, type SetStateAction } from "react";
import type { Product } from "@/lib/types";
import { type Lang, tr } from "@/lib/i18n";
import { formatMoney } from "@/lib/util";
import { chainMinOrder } from "@/lib/stores";
import { CAT_EMOJI } from "@/lib/categories";
import { MarqueeText } from "@/components/MarqueeText";

/**
 * Khung "🔥 Giá hời quanh đây" — DÙNG CHUNG cho trang chủ (app/page.tsx) và trang cửa hàng
 * không có sản phẩm online (StoreProductsPage). Chỉ RENDER; dữ liệu `rows` (areaDeals) + bán
 * kính do component cha tính & sở hữu, truyền xuống → không tính lại logic ở 2 nơi.
 */
export interface DealRow {
  product: Product;
  now: number;
  was: number;
  save: number;
  disc: number;
  currency: string;
  storeName: string;
  storeChain: string;
  /** id cửa hàng THẬT bán deal này — để bấm tên cửa hàng mở trang cửa hàng đó. */
  storeId?: string;
  km: number | null;
}

const RADII = [0.05, 0.1, 0.15, 0.3, 0.5, 0.7, 1];
const GLASS_FADE_LEFT =
  "pointer-events-none absolute inset-y-0 left-0 z-[5] w-9 sm:w-16 bg-gradient-to-r from-white/60 via-white/20 to-transparent backdrop-blur-[3px] sm:backdrop-blur-[6px] [mask-image:linear-gradient(to_right,#000,transparent)] [-webkit-mask-image:linear-gradient(to_right,#000,transparent)]";
const GLASS_FADE_RIGHT =
  "pointer-events-none absolute inset-y-0 right-0 z-[5] w-9 sm:w-16 bg-gradient-to-l from-white/60 via-white/20 to-transparent backdrop-blur-[3px] sm:backdrop-blur-[6px] [mask-image:linear-gradient(to_left,#000,transparent)] [-webkit-mask-image:linear-gradient(to_left,#000,transparent)]";

const fmtRadius = (r: number) => (r < 1 ? `${Math.round(r * 1000)}m` : `${r}km`);

function DealThumb({ product }: { product: Product }) {
  const [failed, setFailed] = useState(false);
  if (product.image && !failed) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={product.image} alt="" loading="lazy" onError={() => setFailed(true)} className="h-full w-full rounded-lg object-contain" />;
  }
  return (
    <span style={{ fontSize: 64 }} className="flex h-full w-full items-center justify-center rounded-lg bg-emerald-50">
      {CAT_EMOJI[product.category] ?? "🛒"}
    </span>
  );
}

interface Props {
  rows: DealRow[];
  radiusKm: number | null;
  setRadiusKm: Dispatch<SetStateAction<number | null>>;
  effKm: number | null;
  userLoc: { lat: number; lng: number } | null;
  lang: Lang;
  /** Đang tìm kiếm → đổi tiêu đề thành "Giá hời liên quan". Trang cửa hàng để trống. */
  query?: string;
  onInfo: (product: Product) => void;
  onAdd: (product: Product) => void;
  onBuy: (product: Product) => void;
  cartQtyFor: (productId: string) => number;
  /** Bấm tên cửa hàng trên card → mở trang cửa hàng đó (chỉ khi row có storeName). */
  onStore?: (deal: DealRow) => void;
}

export default function NearbyDeals({ rows, radiusKm, setRadiusKm, effKm, userLoc, lang, query = "", onInfo, onAdd, onBuy, cartQtyFor, onStore }: Props) {
  const t = (key: string, vars?: Record<string, string | number>) => tr(lang, key, vars);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [arrows, setArrows] = useState({ left: false, right: false });
  const updateArrows = () => {
    const el = scrollRef.current;
    if (!el) return;
    setArrows({ left: el.scrollLeft > 4, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 4 });
  };
  useEffect(() => {
    updateArrows();
    const onResize = () => updateArrows();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows.length]);

  // Không có deal nào và cũng không đặt bán kính → không hiện khung (tránh hộp rỗng).
  if (rows.length === 0 && radiusKm == null) return null;

  return (
    <div className="mt-3 rounded-2xl border-2 border-amber-200 bg-gradient-to-br from-amber-50 to-white p-3 shadow-sm sm:p-4">
      <div className="mb-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <h2 className="text-sm font-semibold text-slate-800">
          <span className="animate-fire mr-0.5">🔥</span>{query.trim() ? t("Giá hời liên quan") : t("Giá hời quanh đây")}
        </h2>
        <span className="text-[11px] text-slate-400">{t("so giá nhiều nơi · bật vị trí để ưu tiên gần bạn")}</span>
      </div>
      {userLoc && (
        <div className="mb-2 flex items-center gap-1.5 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <span className="inline-flex shrink-0 items-center gap-1 pr-0.5 text-xs font-medium text-slate-500">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
              <circle cx="12" cy="10" r="3" />
            </svg>
            {t("Bán kính")}
          </span>
          {RADII.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRadiusKm((cur) => (cur === r ? null : r))}
              className={`shrink-0 rounded-full border px-2.5 py-0.5 text-xs transition ${radiusKm === r ? "border-emerald-600 bg-emerald-600 text-white" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-100"}`}
            >
              {r < 1 ? `${Math.round(r * 1000)}m` : `${r}km`}
            </button>
          ))}
          {radiusKm != null && (
            <button
              type="button"
              onClick={() => setRadiusKm(null)}
              title={t("Hiện tất cả cửa hàng, không giới hạn bán kính")}
              className="inline-flex shrink-0 items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-2.5 py-0.5 text-xs font-medium text-rose-600 transition hover:bg-rose-100"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
              {t("Bỏ giới hạn")}
            </button>
          )}
        </div>
      )}
      {userLoc && radiusKm != null && effKm !== radiusKm && rows.length > 0 && (
        <p className="mb-1.5 text-[11px] font-medium text-amber-700">
          {effKm == null
            ? t("Trong {r} chưa đủ giá hời — hiện toàn khu vực", { r: fmtRadius(radiusKm) })
            : t("Trong {r} chưa đủ giá hời — đã nới bán kính tới {r2}", { r: fmtRadius(radiusKm), r2: fmtRadius(effKm) })}
        </p>
      )}
      <div className="relative">
        {arrows.left && <div className={GLASS_FADE_LEFT} />}
        {arrows.right && <div className={GLASS_FADE_RIGHT} />}
        {arrows.left && (
          <button
            type="button"
            aria-label={t("Cuộn về trước")}
            onClick={() => scrollRef.current?.scrollBy({ left: -(scrollRef.current?.clientWidth ?? 260), behavior: "smooth" })}
            className="absolute left-0 top-1/2 z-10 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-white text-lg text-slate-600 shadow-md ring-1 ring-slate-200 transition hover:bg-slate-50"
          >
            ‹
          </button>
        )}
        {rows.length === 0 && radiusKm != null && (
          <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-amber-200 bg-amber-50/40 px-4 py-6 text-center">
            <span className="text-2xl">🔎</span>
            <p className="text-sm font-medium text-amber-800">{t("Chưa có giá hời nào quanh đây")}</p>
            <button type="button" onClick={() => setRadiusKm(null)} className="rounded-full border border-slate-200 bg-amber-500 px-3 py-1 text-xs font-semibold text-white shadow-sm transition hover:bg-amber-600">
              {t("Bỏ giới hạn bán kính")}
            </button>
          </div>
        )}
        <div
          ref={scrollRef}
          onScroll={updateArrows}
          className={`flex gap-3 overflow-x-auto scroll-smooth px-0.5 py-3 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${rows.length === 0 ? "hidden" : ""}`}
        >
          {rows.map((d) => (
            <div
              key={d.product.id}
              className="group relative flex w-36 shrink-0 flex-col rounded-2xl bg-white p-2.5 text-left ring-1 ring-black/[0.06] shadow-[0_4px_14px_-6px_rgba(15,23,42,0.16),0_2px_5px_-3px_rgba(15,23,42,0.10)] transition duration-200 hover:-translate-y-1 hover:shadow-[0_14px_30px_-10px_rgba(15,23,42,0.24),0_5px_12px_-4px_rgba(15,23,42,0.14)] sm:w-40"
            >
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => { e.stopPropagation(); onInfo(d.product); }}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.stopPropagation(); onInfo(d.product); } }}
                aria-label={t("Xem thông tin & chứng nhận")}
                title={t("Xem thông tin & chứng nhận")}
                className="absolute right-1.5 top-1 z-10 cursor-pointer text-[10px] font-semibold leading-none text-slate-400 transition hover:text-slate-700"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10" /><path d="M12 16v-4" /><path d="M12 8h.01" /></svg>
              </span>
              <div className="mb-1.5 flex min-h-[20px] flex-wrap items-start gap-1">
                <span className="rounded-md bg-rose-600 px-1.5 py-0.5 text-[11px] font-bold text-white shadow-sm">-{Math.round(d.disc * 100)}%</span>
              </div>
              <div className="mb-1.5 flex aspect-square w-full items-center justify-center overflow-hidden rounded-lg bg-white">
                <DealThumb product={d.product} />
              </div>
              <div className="min-h-[2.25rem] text-xs font-medium leading-tight text-slate-700">{d.product.name}</div>
              <div className="mt-1 flex flex-wrap items-baseline gap-x-1.5">
                <span className="text-sm font-bold text-rose-600">{formatMoney(d.now, d.currency)}</span>
                <span className="text-[11px] text-slate-400 line-through">{formatMoney(d.was, d.currency)}</span>
              </div>
              <div className="mt-0.5 text-[11px] font-medium text-emerald-600">{t("Tiết kiệm {x}", { x: formatMoney(d.save, d.currency) })}</div>
              <div className="mt-1 min-h-[16px] text-[11px] text-slate-500">
                {d.storeName && (
                  onStore && (d.storeChain || d.storeId) ? (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); onStore(d); }}
                      title={t("Xem tất cả sản phẩm của {store}", { store: d.storeName })}
                      className="flex w-full items-center gap-0.5 text-left font-medium text-emerald-700 transition hover:text-emerald-800 hover:underline"
                    >
                      <MarqueeText>{`🛒 ${d.storeName}`}</MarqueeText>
                    </button>
                  ) : (
                    <MarqueeText>{`🛒 ${d.storeName}`}</MarqueeText>
                  )
                )}
              </div>
              <div className="mt-0.5 min-h-[16px] line-clamp-1 text-[11px] font-medium text-emerald-600">{d.km != null && <>📍 {t("cách bạn {km} km", { km: d.km.toFixed(1) })}</>}</div>
              {d.storeChain && chainMinOrder(d.storeChain) > 0 && (
                <div className="mt-0.5 text-[10px] font-medium text-blue-500">{t("Mua tối thiểu {x}", { x: formatMoney(chainMinOrder(d.storeChain), d.currency) })}</div>
              )}
              <div className="mt-auto pt-2 flex gap-1.5">
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onAdd(d.product); }}
                  className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-amber-50 text-lg font-bold text-amber-600 hover:bg-amber-100"
                >
                  +
                  {cartQtyFor(d.product.id) > 0 && (
                    <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-amber-500 px-0.5 text-[10px] font-bold text-white">{cartQtyFor(d.product.id)}</span>
                  )}
                </button>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onBuy(d.product); }}
                  className="flex flex-1 items-center justify-center gap-1 rounded-lg border border-slate-200 bg-amber-500 py-1.5 text-xs font-semibold text-white transition hover:bg-amber-600"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="21" r="1" /><circle cx="20" cy="21" r="1" /><path d="M1 1h4l2.7 13.4a2 2 0 0 0 2 1.6h9.7a2 2 0 0 0 2-1.6L23 6H6" /></svg>
                  {t("Mua ngay")}
                </button>
              </div>
            </div>
          ))}
        </div>
        {arrows.right && (
          <button
            type="button"
            aria-label={t("Cuộn tiếp")}
            onClick={() => scrollRef.current?.scrollBy({ left: scrollRef.current?.clientWidth ?? 260, behavior: "smooth" })}
            className="absolute right-0 top-1/2 z-10 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-white text-lg text-slate-600 shadow-md ring-1 ring-slate-200 transition hover:bg-slate-50"
          >
            ›
          </button>
        )}
      </div>
    </div>
  );
}
