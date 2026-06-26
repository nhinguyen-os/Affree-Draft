"use client";

import { useState, useMemo } from "react";
import type { Offer, Product, RankedOffer, Store } from "@/lib/types";
import { storeCurrency } from "@/lib/stores";
import { distanceKm, formatMoney } from "@/lib/util";
import { ChainBadge } from "@/components/ChainBadge";
import { categoryGroup, GROUP_TILE, CATEGORY_GROUPS, DEFAULT_TILE_EMOJIS } from "@/lib/categories";
import { type Lang, tr } from "@/lib/i18n";

interface Props {
  store: Store;
  offers: Offer[];
  productMap: Map<string, Product>;
  userLoc: { lat: number; lng: number } | null;
  lang: Lang;
  headerH?: number;
  onClose: () => void;
  onBuy: (offer: RankedOffer) => void;
}

function Thumb({ product }: { product: Product }) {
  const [failed, setFailed] = useState(false);
  if (product.image && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={product.image}
        alt=""
        loading="lazy"
        onError={() => setFailed(true)}
        className="h-full w-full object-contain"
      />
    );
  }
  return <span className="flex h-full w-full items-center justify-center text-3xl">🛒</span>;
}

export default function StoreProductsPage({ store, offers, productMap, userLoc, lang, headerH = 0, onClose, onBuy }: Props) {
  const t = (key: string, vars?: Record<string, string | number>) => tr(lang, key, vars);

  const items = useMemo(
    () =>
      offers
        .map((o) => ({ offer: o, product: productMap.get(o.productId) }))
        .filter((x): x is { offer: Offer; product: Product } => !!x.product),
    [offers, productMap],
  );

  // Group by category, ordered like CATEGORY_GROUPS
  const sections = useMemo(() => {
    const byGroup = new Map<string, { offer: Offer; product: Product }[]>();
    for (const item of items) {
      const g = categoryGroup(item.product);
      if (!byGroup.has(g)) byGroup.set(g, []);
      byGroup.get(g)!.push(item);
    }
    const canonical = CATEGORY_GROUPS.map((x) => x.label);
    const result: { name: string; items: { offer: Offer; product: Product }[] }[] = [];
    for (const label of canonical) {
      if (byGroup.has(label)) result.push({ name: label, items: byGroup.get(label)! });
    }
    byGroup.forEach((list, label) => {
      if (!canonical.includes(label) && label !== "Khác") result.push({ name: label, items: list });
    });
    if (byGroup.has("Khác")) result.push({ name: "Khác", items: byGroup.get("Khác")! });
    return result;
  }, [items]);

  // null = trang danh mục chính, string = tên danh mục đang xem toàn bộ
  const [activeSection, setActiveSection] = useState<string | null>(null);

  const dist =
    userLoc && store.lat != null && store.lng != null
      ? distanceKm(userLoc, { lat: store.lat, lng: store.lng })
      : null;

  const activeSectionData = activeSection ? sections.find((s) => s.name === activeSection) : null;
  const activeSectionIdx = activeSection ? sections.findIndex((s) => s.name === activeSection) : -1;
  const activeTile = activeSectionData ? GROUP_TILE[activeSectionData.name] : null;
  const activeEmoji = activeTile?.emoji ?? (activeSectionIdx >= 0 ? DEFAULT_TILE_EMOJIS[activeSectionIdx % DEFAULT_TILE_EMOJIS.length] : "🛒");

  return (
    <div className="fixed inset-x-0 bottom-0 z-[2050] flex flex-col bg-gradient-to-br from-slate-50 via-sky-50 to-emerald-50" style={{ top: headerH || 64 }}>
      <div className="flex-1 overflow-y-auto overscroll-contain" style={{ WebkitOverflowScrolling: "touch" }}>
        {/* Header — sticky trong scroll container để sticks đúng */}
        <div className="sticky top-0 z-10 border-b border-slate-100 bg-white/95 backdrop-blur-sm">
          <div className="flex items-center gap-2 px-3 py-3">
            <button
              onClick={onClose}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100 active:bg-slate-200"
              aria-label={t("Quay lại")}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M15 18l-6-6 6-6" />
              </svg>
            </button>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <ChainBadge chain={store.chain} />
                <h1 className="truncate text-base font-bold text-slate-900">{store.name}</h1>
              </div>
              <p className="mt-0.5 truncate text-xs text-slate-500">
                {items.length} {t("sản phẩm")}
                {dist != null && <> · {dist < 1 ? `${Math.round(dist * 1000)}m` : `${dist.toFixed(1)}km`}</>}
                {store.address && <> · {store.address}</>}
              </p>
            </div>
          </div>
        </div>
        {activeSection && activeSectionData ? (
          /* ── Sub-view: lưới 2 cột tất cả sản phẩm trong danh mục ── */
          <>
            {/* Breadcrumb row — giống trang chủ */}
            <div className="flex items-center justify-between px-3 py-2.5">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setActiveSection(null)}
                  className="flex items-center gap-1 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 shadow-sm transition hover:bg-slate-50"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
                  {t("Quay lại")}
                </button>
                <h2 className="text-sm font-semibold text-slate-800">
                  <span className="mr-1">{activeEmoji}</span>{activeSection}
                </h2>
              </div>
              <span className="text-xs text-slate-400">{activeSectionData.items.length} {t("sản phẩm")}</span>
            </div>
          <ul className="grid grid-cols-2 gap-3 px-3 pb-3 sm:grid-cols-3">
            {activeSectionData.items.map(({ offer: o, product: p }) => (
              <li key={p.id}>
                <div className="group relative flex h-full w-full flex-col rounded-xl border border-slate-200 bg-white p-3 text-left transition duration-200 hover:-translate-y-1 hover:border-emerald-500">
                  <div className="relative mb-1 flex aspect-square w-full items-center justify-center overflow-hidden rounded-lg bg-slate-50">
                    <Thumb product={p} />
                  </div>
                  <span className="line-clamp-2 min-h-[2.5rem] text-sm font-medium leading-snug text-slate-800">{p.name}</span>
                  <span className="mt-0.5 truncate text-xs text-slate-400">{p.brand}{p.unit ? ` · ${p.unit}` : ""}</span>
                  {o.inStock ? (
                    <span className="mt-1.5 inline-flex items-center gap-1 text-base font-bold text-emerald-600">
                      {formatMoney(o.price, storeCurrency(o.storeId))}
                    </span>
                  ) : (
                    <span className="mt-1.5 text-sm font-medium text-red-500">{t("Hết hàng")}</span>
                  )}
                  <span className="mt-auto block w-full pt-2.5">
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={() => o.inStock && onBuy({ ...o, store, product: p, distanceKm: dist } as RankedOffer)}
                      onKeyDown={(e) => { if ((e.key === "Enter" || e.key === " ") && o.inStock) onBuy({ ...o, store, product: p, distanceKm: dist } as RankedOffer); }}
                      className={`flex w-full items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-semibold text-white transition-colors duration-200 ${o.inStock ? "cursor-pointer bg-amber-500 hover:bg-amber-600" : "cursor-not-allowed bg-slate-100 text-slate-400"}`}
                    >
                      {t("Mua")}
                    </span>
                  </span>
                </div>
              </li>
            ))}
          </ul>
          </>
        ) : (
          /* ── Main view: sections với horizontal scroll row ── */
          <div className="px-3 py-3">
            {sections.length === 0 ? (
              <p className="rounded-xl bg-white px-4 py-10 text-center text-sm text-slate-400 shadow-sm">
                {t("Không có sản phẩm.")}
              </p>
            ) : (
              sections.map(({ name, items: secItems }, sIdx) => {
                const tile = GROUP_TILE[name];
                const emoji = tile?.emoji ?? DEFAULT_TILE_EMOJIS[sIdx % DEFAULT_TILE_EMOJIS.length];
                return (
                  <section key={name} className="mb-5">
                    <div className="mb-2.5 flex items-center justify-between">
                      <h2 className="text-sm font-semibold text-slate-700">
                        <span className="mr-1">{emoji}</span>{name}
                        <span className="ml-1.5 text-xs font-normal text-slate-400">({secItems.length})</span>
                      </h2>
                      <button
                        onClick={() => setActiveSection(name)}
                        className="text-xs font-medium text-emerald-600 hover:underline"
                      >
                        {t("Xem tất cả →")}
                      </button>
                    </div>
                    {/* Horizontal scroll row — giống trang chủ */}
                    <div className="flex gap-3 overflow-x-auto pb-2 pt-1 touch-pan-x [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                      {secItems.slice(0, 12).map(({ offer: o, product: p }) => (
                        <div key={p.id} className="w-36 shrink-0">
                          <div className="group relative flex h-full w-full flex-col rounded-xl border border-slate-200 bg-white p-3 text-left transition duration-200 hover:-translate-y-1 hover:border-emerald-500">
                            <div className="relative mb-1 flex aspect-square w-full items-center justify-center overflow-hidden rounded-lg bg-slate-50">
                              <Thumb product={p} />
                            </div>
                            <span className="line-clamp-2 min-h-[2.5rem] text-sm font-medium leading-snug text-slate-800">{p.name}</span>
                            <span className="mt-0.5 truncate text-xs text-slate-400">{p.brand}{p.unit ? ` · ${p.unit}` : ""}</span>
                            {o.inStock ? (
                              <span className="mt-1.5 text-sm font-bold text-emerald-600">
                                {formatMoney(o.price, storeCurrency(o.storeId))}
                              </span>
                            ) : (
                              <span className="mt-1.5 text-sm text-slate-400">{t("Hết hàng")}</span>
                            )}
                            <span className="mt-auto block w-full pt-2.5">
                              <span
                                role="button"
                                tabIndex={0}
                                onClick={() => o.inStock && onBuy({ ...o, store, product: p, distanceKm: dist } as RankedOffer)}
                                onKeyDown={(e) => { if ((e.key === "Enter" || e.key === " ") && o.inStock) onBuy({ ...o, store, product: p, distanceKm: dist } as RankedOffer); }}
                                className={`flex w-full items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-semibold text-white transition-colors duration-200 ${o.inStock ? "cursor-pointer bg-amber-500 hover:bg-amber-600" : "cursor-not-allowed bg-slate-100 text-slate-400"}`}
                              >
                                {t("Mua")}
                              </span>
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                );
              })
            )}
          </div>
        )}
      </div>
      {/* Safe area spacer cho iPhone home indicator */}
      <div style={{ height: "env(safe-area-inset-bottom, 0px)" }} className="shrink-0 bg-gradient-to-br from-slate-50 via-sky-50 to-emerald-50" />
    </div>
  );
}
