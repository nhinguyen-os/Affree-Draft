"use client";

import { useState, useMemo } from "react";
import type { Offer, Product, RankedOffer, Store } from "@/lib/types";
import { getStore, storeCurrency } from "@/lib/stores";
import { distanceKm } from "@/lib/util";
import { ChainBadge } from "@/components/ChainBadge";
import { ProductCard } from "@/components/ProductCard";
import { SubCatBar } from "@/components/SubCatBar";
import { categoryGroup, GROUP_TILE, CATEGORY_GROUPS, DEFAULT_TILE_EMOJIS } from "@/lib/categories";
import { type Lang, tr } from "@/lib/i18n";

interface Props {
  store: Store;
  offers: Offer[];
  productMap: Map<string, Product>;
  userLoc: { lat: number; lng: number } | null;
  lang: Lang;
  headerH?: number;
  /** Emoji theo nhãn danh mục lấy từ Google Sheet (tab "tệp") — ưu tiên hơn GROUP_TILE. */
  groupEmoji?: Record<string, string>;
  onClose: () => void;
  onBuy: (offer: RankedOffer) => void;
  onAddToCart?: (product: Product, offer: Offer) => void;
  cartQtyFor?: (productId: string) => number;
}

// 1 dòng sản phẩm trong trang: offer + product + cửa hàng THẬT bán offer đó (brand mode).
type PageItem = { offer: Offer; product: Product; realStore: Store | null; dist: number | null };

export default function StoreProductsPage({ store, offers, productMap, userLoc, lang, headerH = 0, groupEmoji = {}, onClose, onBuy, onAddToCart, cartQtyFor }: Props) {
  const t = (key: string, vars?: Record<string, string | number>) => tr(lang, key, vars);
  // Emoji của 1 danh mục: ưu tiên sheet (tab "tệp") → GROUP_TILE → emoji mặc định theo index.
  const emojiFor = (name: string, idx: number) =>
    groupEmoji[name] || GROUP_TILE[name]?.emoji || DEFAULT_TILE_EMOJIS[idx % DEFAULT_TILE_EMOJIS.length];

  // Brand mode (bấm sponsor logo): store là synthetic `__brand__<name>` — offers thuộc
  // NHIỀU cửa hàng thật khác nhau (fan-out theo chuỗi), phải gom về 1 card/sản phẩm.
  const isBrandMode = store.id.startsWith("__brand__");

  const items = useMemo<PageItem[]>(() => {
    const all: PageItem[] = offers
      .map((o) => ({ offer: o, product: productMap.get(o.productId) }))
      .filter((x): x is { offer: Offer; product: Product } => !!x.product)
      .map((x) => {
        const realStore = getStore(x.offer.storeId) ?? null;
        const dist =
          userLoc && realStore?.lat != null && realStore?.lng != null
            ? distanceKm(userLoc, { lat: realStore.lat, lng: realStore.lng })
            : null;
        return { ...x, realStore, dist };
      });
    if (!isBrandMode) return all;
    // Brand mode: cùng 1 sản phẩm có thể có N offer (mỗi cửa hàng 1 offer) → giữ offer
    // TỐT NHẤT: còn hàng trước, rồi gần nhất (offer không rõ vị trí xếp sau), rồi rẻ nhất.
    const best = new Map<string, PageItem>();
    for (const it of all) {
      const cur = best.get(it.product.id);
      if (!cur) { best.set(it.product.id, it); continue; }
      const better =
        (it.offer.inStock ? 1 : 0) - (cur.offer.inStock ? 1 : 0) ||
        (cur.dist ?? Infinity) - (it.dist ?? Infinity) ||
        (cur.offer.price ?? Infinity) - (it.offer.price ?? Infinity);
      if (better > 0) best.set(it.product.id, it);
    }
    return [...best.values()];
  }, [offers, productMap, userLoc, isBrandMode]);

  // Group by product.category (granular), fallback to categoryGroup tệp nếu category trống.
  // Sắp xếp: tệp-level theo CATEGORY_GROUPS order, rồi sort alpha trong từng tệp.
  const sections = useMemo(() => {
    const byGroup = new Map<string, PageItem[]>();
    for (const item of items) {
      const cat = (item.product.category || "").trim();
      const g = cat || categoryGroup(item.product) || "Khác";
      if (!byGroup.has(g)) byGroup.set(g, []);
      byGroup.get(g)!.push(item);
    }
    // Sắp xếp các category theo tệp cha (CATEGORY_GROUPS order), rồi alpha trong tệp
    const tepOrder = CATEGORY_GROUPS.map((x) => x.label);
    const sorted = [...byGroup.keys()].sort((a, b) => {
      const ta = tepOrder.indexOf(categoryGroup(a) || a);
      const tb = tepOrder.indexOf(categoryGroup(b) || b);
      const ta2 = ta === -1 ? 999 : ta;
      const tb2 = tb === -1 ? 999 : tb;
      if (ta2 !== tb2) return ta2 - tb2;
      return a.localeCompare(b, "vi");
    });
    return sorted.map((name) => ({ name, items: byGroup.get(name)! }));
  }, [items]);

  // null = trang danh mục chính, string = tên danh mục đang xem toàn bộ
  const [activeSection, setActiveSection] = useState<string | null>(null);

  const dist =
    userLoc && store.lat != null && store.lng != null
      ? distanceKm(userLoc, { lat: store.lat, lng: store.lng })
      : null;

  const fmtDist = (d: number) => (d < 1 ? `${Math.round(d * 1000)}m` : `${d.toFixed(1)}km`);
  // Dòng cửa hàng trên card — CHỈ brand mode (trang cửa hàng thì thừa, header đã ghi).
  // Cửa hàng NGOÀI VÙNG (>100km — vd định vị VN mà store ở Cali) thì ẨN LUÔN: định vị
  // ở đâu chỉ thấy cửa hàng vùng đó, đồng bộ với scope vùng của bản đồ/so sánh.
  // Chưa rõ vị trí user / store không tọa độ → hiện tên cửa hàng, không kèm khoảng cách.
  const storeLineFor = (it: PageItem) => {
    if (!isBrandMode || !it.realStore) return undefined;
    if (it.dist != null && it.dist >= 100) return undefined; // ngoài vùng → ẩn
    return `🛒 ${it.realStore.name}${it.dist != null ? ` · 📍${fmtDist(it.dist)}` : ""}`;
  };
  // RankedOffer cho Mua ngay / giỏ: gắn cửa hàng THẬT của offer (brand mode trước đây
  // gắn nhầm synthetic store `__brand__…` → đơn hàng không rõ cửa hàng nào).
  const rankedFor = (it: PageItem): RankedOffer =>
    ({ ...it.offer, store: it.realStore ?? store, product: it.product, distanceKm: it.dist ?? dist } as RankedOffer);

  const activeSectionData = activeSection ? sections.find((s) => s.name === activeSection) : null;
  const activeSectionIdx = activeSection ? sections.findIndex((s) => s.name === activeSection) : -1;
  const activeEmoji = activeSectionData ? emojiFor(activeSectionData.name, activeSectionIdx) : "🛒";

  return (
    <div className="fixed inset-x-0 bottom-0 z-[2050] flex flex-col bg-gradient-to-br from-slate-50 via-sky-50 to-emerald-50" style={{ top: headerH || 64 }}>
      <div className="flex-1 overflow-y-auto overscroll-contain" style={{ WebkitOverflowScrolling: "touch" }}>
        {/* Section header CỐ ĐỊNH (sticky top-0 trong overlay): luôn thấy tên cửa hàng +
            số sản phẩm/khoảng cách/địa chỉ khi cuộn. Nền mờ đặc để sản phẩm cuộn dưới
            không lộ qua; overlay đã bắt đầu dưới app header nên không bị che. */}
        <div className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50/95 backdrop-blur supports-[backdrop-filter]:bg-slate-50/80">
          <div className="flex items-center gap-2 px-3 pt-4 pb-3">
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
                {/* Ẩn ChainBadge ở brand mode (synthetic store id `__brand__...`) — không có
                    logo chuỗi để hiển thị, badge "•" trống đè lên tên brand. */}
                {!store.id.startsWith("__brand__") && <ChainBadge chain={store.chain} />}
                <h1 className="truncate text-base font-bold text-slate-900">{store.name}</h1>
              </div>
              <p className="mt-0.5 text-xs leading-snug text-slate-500">
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
            <SubCatBar
              backLabel={t("Quay lại")}
              onBack={() => setActiveSection(null)}
              emoji={activeEmoji}
              title={t(activeSection!)}
              count={activeSectionData.items.length}
              t={t}
            />
          <ul className="grid grid-cols-2 gap-3 px-3 pb-3 sm:grid-cols-3">
            {activeSectionData.items.map((it) => (
              <li key={it.product.id}>
                <ProductCard
                  product={it.product}
                  price={it.offer.price}
                  currency={storeCurrency(it.offer.storeId)}
                  outOfStock={!it.offer.inStock}
                  cartQty={cartQtyFor?.(it.product.id) ?? 0}
                  storeLine={storeLineFor(it)}
                  onBuy={() => it.offer.inStock && onBuy(rankedFor(it))}
                  onAddToCart={onAddToCart ? () => onAddToCart(it.product, it.offer) : undefined}
                  lang={lang}
                  variant="grid"
                />
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
                const emoji = emojiFor(name, sIdx);
                return (
                  <section key={name} className="mb-5">
                    <div className="mb-2.5 flex items-center justify-between">
                      <h2 className="text-sm font-semibold text-slate-700">
                        <span className="mr-1">{emoji}</span>{t(name)}
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
                      {secItems.slice(0, 12).map((it) => (
                        <div key={it.product.id} className="w-36 shrink-0">
                          <ProductCard
                            product={it.product}
                            price={it.offer.price}
                            currency={storeCurrency(it.offer.storeId)}
                            outOfStock={!it.offer.inStock}
                            cartQty={cartQtyFor?.(it.product.id) ?? 0}
                            storeLine={storeLineFor(it)}
                            onBuy={() => it.offer.inStock && onBuy(rankedFor(it))}
                            onAddToCart={onAddToCart ? () => onAddToCart(it.product, it.offer) : undefined}
                            lang={lang}
                            variant="scroll"
                          />
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
