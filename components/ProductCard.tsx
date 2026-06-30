"use client";

/**
 * Card sản phẩm dùng chung — 2 variant:
 *   "grid"   — dùng trong lưới 2-4 cột (StoreProductsPage, expanded group)
 *   "scroll" — dùng trong hàng cuộn ngang (w-36, font nhỏ hơn)
 *
 * Luôn hiển thị: ảnh · tên · brand/unit · giá · nút [+] · nút [Mua ngay]
 * Nút [+] ẩn khi không truyền onAddToCart.
 */

import { useState } from "react";
import { formatMoney } from "@/lib/util";
import { type Lang, tr } from "@/lib/i18n";

export type ProductCardData = {
  id: string;
  name: string;
  brand?: string;
  unit?: string;
  image?: string;
};

type Props = {
  product: ProductCardData;
  price: number | null;
  currency?: string;
  outOfStock?: boolean;
  discountPct?: number;
  listedPrice?: number;
  cartQty?: number;
  onBuy?: () => void;
  onAddToCart?: () => void;
  lang?: Lang;
  variant?: "grid" | "scroll";
};

function Thumb({ image, name }: { image?: string; name: string }) {
  const [failed, setFailed] = useState(false);
  if (image && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={image}
        alt=""
        loading="lazy"
        onError={() => setFailed(true)}
        className="h-full w-full object-contain"
      />
    );
  }
  return <span className="flex h-full w-full items-center justify-center text-3xl" aria-hidden>🛒</span>;
}

export function ProductCard({
  product,
  price,
  currency,
  outOfStock = false,
  discountPct,
  listedPrice,
  cartQty = 0,
  onBuy,
  onAddToCart,
  lang = "vi",
  variant = "grid",
}: Props) {
  const t = (vi: string) => tr(lang, vi);
  const isScroll = variant === "scroll";

  return (
    <div className="group relative flex h-full w-full flex-col rounded-xl border border-slate-200 bg-white p-3 text-left transition duration-200 hover:-translate-y-1 hover:border-emerald-500">
      {/* Discount badge */}
      {discountPct && discountPct > 0 && (
        <span className="absolute left-2 top-2 z-10 rounded-md bg-rose-600 px-1.5 py-0.5 text-[11px] font-bold text-white shadow-sm">
          -{Math.round(discountPct * 100)}%
        </span>
      )}

      {/* Thumbnail */}
      <div className="relative mb-1.5 flex aspect-square w-full items-center justify-center overflow-hidden rounded-lg bg-slate-50">
        <Thumb image={product.image} name={product.name} />
      </div>

      {/* Tên sản phẩm */}
      <span className={`line-clamp-2 font-medium leading-snug text-slate-800 ${isScroll ? "min-h-[2.25rem] text-xs" : "min-h-[2.5rem] text-sm"}`}>
        {product.name}
      </span>

      {/* Brand · unit */}
      {(product.brand || product.unit) && (
        <span className="mt-0.5 truncate text-xs text-slate-400">
          {product.brand}{product.unit ? ` · ${t(product.unit)}` : ""}
        </span>
      )}

      {/* Giá */}
      <div className="mt-1.5 flex flex-wrap items-baseline gap-x-1.5">
        {outOfStock ? (
          <span className="text-sm font-medium text-red-500">{t("Hết hàng")}</span>
        ) : price != null && price > 0 ? (
          <>
            <span className={`font-bold text-emerald-600 ${isScroll ? "text-sm" : "text-base"}`}>
              {formatMoney(price, currency)}
            </span>
            {listedPrice && listedPrice > price && (
              <span className="text-[11px] text-slate-400 line-through">{formatMoney(listedPrice, currency)}</span>
            )}
          </>
        ) : (
          <span className="text-xs text-slate-400">{t("Chưa có giá")}</span>
        )}
      </div>

      {/* Actions: [+] [Mua ngay] */}
      <div className="mt-auto flex gap-1.5 pt-2.5">
        {onAddToCart && (
          <button
            type="button"
            onClick={onAddToCart}
            className={`relative flex shrink-0 items-center justify-center rounded-lg border border-amber-300 bg-amber-50 font-bold text-amber-600 transition hover:bg-amber-100 ${isScroll ? "h-7 w-7 text-base" : "h-9 w-9 text-lg"}`}
            title={t("Thêm vào giỏ")}
            aria-label={t("Thêm vào giỏ")}
          >
            +
            {cartQty > 0 && (
              <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-amber-500 px-0.5 text-[10px] font-bold text-white">
                {cartQty}
              </span>
            )}
          </button>
        )}
        {onBuy && (
          <button
            type="button"
            onClick={onBuy}
            disabled={outOfStock}
            className={`flex flex-1 items-center justify-center gap-1 rounded-lg font-semibold text-white transition ${
              outOfStock
                ? "cursor-not-allowed bg-slate-200 text-slate-400"
                : "bg-amber-500 hover:bg-amber-600"
            } ${isScroll ? "py-1.5 text-[11px]" : "py-2 text-xs"}`}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <circle cx="9" cy="21" r="1" /><circle cx="20" cy="21" r="1" />
              <path d="M1 1h4l2.7 13.4a2 2 0 0 0 2 1.6h9.7a2 2 0 0 0 2-1.6L23 6H6" />
            </svg>
            {t("Mua ngay")}
          </button>
        )}
      </div>
    </div>
  );
}
