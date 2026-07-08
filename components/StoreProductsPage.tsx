"use client";

import { useState, useMemo, useEffect, type Dispatch, type SetStateAction } from "react";
import { createPortal } from "react-dom";
import { ZaloFollowButton } from "@/components/ZaloFollowButton";
import type { Offer, Product, RankedOffer, Store } from "@/lib/types";
import type { OnlineConfig, OnlineService } from "@/lib/sheet-online-config";
import NearbyDeals, { type DealRow } from "@/components/NearbyDeals";
import { getStore, storeCurrency } from "@/lib/stores";
import { distanceKm } from "@/lib/util";
import { ChainBadge } from "@/components/ChainBadge";
import { ProductCard } from "@/components/ProductCard";
import { SubCatBar } from "@/components/SubCatBar";
import { categoryGroup, GROUP_TILE, DEFAULT_TILE_EMOJIS } from "@/lib/categories";
import { type Lang, tr } from "@/lib/i18n";
import { slugify } from "@/lib/slug";

interface Props {
  store: Store;
  offers: Offer[];
  productMap: Map<string, Product>;
  userLoc: { lat: number; lng: number } | null;
  lang: Lang;
  headerH?: number;
  /** Emoji theo nhãn danh mục lấy từ Google Sheet (tab "tệp") — ưu tiên hơn GROUP_TILE. */
  groupEmoji?: Record<string, string>;
  /** Deep-link QR: tên người bán → hiện "Phục vụ bởi: …" ở header trang cửa hàng. */
  servedBy?: string;
  /** Deep-link QR: slug nhãn hàng → lọc sản phẩm theo nhãn + hiện tag (bấm × để bỏ lọc). */
  brandTag?: string;
  /** Khi có modal (đặt hàng) mở đè lên: hạ z xuống dưới modal để giữ trang cửa hàng
   *  mounted phía sau (không mất state/scroll) → đóng modal là quay lại đúng trang này. */
  behind?: boolean;
  onClose: () => void;
  onBuy: (offer: RankedOffer) => void;
  onAddToCart?: (product: Product, offer: Offer) => void;
  cartQtyFor?: (productId: string) => number;
  /** "Giá hời quanh đây" (dùng chung <NearbyDeals/>) — data + handler từ Home, để trang
   *  cửa hàng KHÔNG có sản phẩm cũng hiện khung này. */
  deals?: DealRow[];
  dealsRadiusKm?: number | null;
  setDealsRadiusKm?: Dispatch<SetStateAction<number | null>>;
  dealsEffKm?: number | null;
  onDealInfo?: (product: Product) => void;
  onDealAdd?: (product: Product) => void;
  onDealBuy?: (product: Product) => void;
}

// 1 dòng sản phẩm trong trang: offer + product + cửa hàng THẬT bán offer đó (brand mode).
type PageItem = { offer: Offer; product: Product; realStore: Store | null; dist: number | null };

export default function StoreProductsPage({ store, offers, productMap, userLoc, lang, headerH = 0, groupEmoji = {}, servedBy, brandTag, behind = false, onClose, onBuy, onAddToCart, cartQtyFor, deals, dealsRadiusKm, setDealsRadiusKm, dealsEffKm, onDealInfo, onDealAdd, onDealBuy }: Props) {
  const t = (key: string, vars?: Record<string, string | number>) => tr(lang, key, vars);
  // Lọc theo nhãn hàng (deep-link ?nhanhang=…). Bật mặc định khi có brandTag; bấm × để bỏ.
  const [brandFilterOn, setBrandFilterOn] = useState(!!brandTag);
  const brandSlug = brandTag ? slugify(brandTag) : "";

  // ── Trang KHÔNG có sản phẩm online: cấu hình (dịch vụ tạo web, số liên hệ, Zalo OA)
  //    lấy từ /api/online-config (đọc Google Sheet, có default). Soft-gate Zalo OA:
  //    bấm mở mắt → popup mời Quan tâm OA; đã quan tâm (cờ localStorage) → mở mắt sẵn. ──
  const [onlineCfg, setOnlineCfg] = useState<OnlineConfig | null>(null);
  const [contactRevealed, setContactRevealed] = useState(false);
  const [showOaGate, setShowOaGate] = useState(false);
  const [regService, setRegService] = useState<OnlineService | null>(null);
  const [regSent, setRegSent] = useState(false);
  useEffect(() => {
    let alive = true;
    fetch("/api/online-config")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: OnlineConfig | null) => { if (alive && d) setOnlineCfg(d); })
      .catch(() => {});
    // Mặc định luôn ĐÓNG mắt (che số) — không tự mở lại kể cả khi user từng Quan tâm OA.
    return () => { alive = false; };
  }, []);
  // Che giữa số điện thoại: "0912345678" → "09xxxxxx78" (không lưu/bịa số nào).
  const maskPhone = (p: string) => {
    const d = p.replace(/\D/g, "");
    if (d.length < 6) return p;
    return d.slice(0, 2) + "x".repeat(d.length - 4) + d.slice(-2);
  };
  const onEyeClick = () => {
    if (contactRevealed) { setContactRevealed(false); return; }
    setShowOaGate(true); // chưa quan tâm → mời Quan tâm OA
  };
  // Quan tâm giờ diễn ra NGAY TRÊN WEB qua widget Zalo (ZaloFollowButton) trong popup —
  // không mở tab rời trang. Nút này chỉ xác nhận "đã quan tâm" → mở khoá số + đóng popup.
  const confirmFollowOa = () => {
    try { localStorage.setItem("affree_oa_followed", "1"); } catch {}
    setContactRevealed(true);
    setShowOaGate(false);
  };
  // OA id (số) cho widget — tách từ link zalo.me + oaid trong cấu hình (không dùng regex).
  const oaId = (() => {
    let z = onlineCfg?.zaloOa || "";
    const qi = z.indexOf("?"); if (qi >= 0) z = z.slice(0, qi);
    const hi = z.indexOf("#"); if (hi >= 0) z = z.slice(0, hi);
    const parts = z.split("/").filter(Boolean);
    return parts.length ? parts[parts.length - 1] : "";
  })();
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
    // Deep-link ?nhanhang=… : chỉ giữ sản phẩm đúng nhãn hàng (khớp theo slug, bỏ dấu/hoa-thường).
    const filtered = brandFilterOn && brandSlug
      ? all.filter((x) => slugify(x.product.brand || "") === brandSlug)
      : all;
    if (!isBrandMode) return filtered;
    // Brand mode: cùng 1 sản phẩm có thể có N offer (mỗi cửa hàng 1 offer) → giữ offer
    // TỐT NHẤT: còn hàng trước, rồi gần nhất (offer không rõ vị trí xếp sau), rồi rẻ nhất.
    const best = new Map<string, PageItem>();
    for (const it of filtered) {
      const cur = best.get(it.product.id);
      if (!cur) { best.set(it.product.id, it); continue; }
      const better =
        (it.offer.inStock ? 1 : 0) - (cur.offer.inStock ? 1 : 0) ||
        (cur.dist ?? Infinity) - (it.dist ?? Infinity) ||
        (cur.offer.price ?? Infinity) - (it.offer.price ?? Infinity);
      if (better > 0) best.set(it.product.id, it);
    }
    return [...best.values()];
  }, [offers, productMap, userLoc, isBrandMode, brandFilterOn, brandSlug]);

  // Tên nhãn hàng hiển thị trên tag: lấy đúng chữ gốc từ sản phẩm khớp, fallback brandTag.
  const brandLabel = useMemo(() => {
    if (!brandTag) return "";
    for (const o of offers) {
      const p = productMap.get(o.productId);
      if (p?.brand && slugify(p.brand) === brandSlug) return p.brand;
    }
    return brandTag;
  }, [brandTag, brandSlug, offers, productMap]);

  // Group by product.category (granular), fallback to categoryGroup tệp nếu category trống.
  // THỨ TỰ SECTION = thứ tự category xuất hiện lần đầu trong tab catalog (sheet).
  // Map giữ insertion order; `items` bám theo thứ tự `offers` = thứ tự dòng trong sheet
  // (catalog không bị re-sort). Muốn đổi thứ tự ngành hàng → đổi thứ tự dòng trong sheet.
  const sections = useMemo(() => {
    const byGroup = new Map<string, PageItem[]>();
    for (const item of items) {
      const cat = (item.product.category || "").trim();
      const g = cat || categoryGroup(item.product) || "Khác";
      if (!byGroup.has(g)) byGroup.set(g, []);
      byGroup.get(g)!.push(item);
    }
    return [...byGroup.keys()].map((name) => ({ name, items: byGroup.get(name)! }));
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
  // SĐT liên hệ: ưu tiên số của cửa hàng lấy từ map (store.phone), rồi mới tới cấu hình sheet.
  const contactPhone = store.phone || onlineCfg?.contactPhone || "";

  return (
    <div className={`fixed inset-x-0 bottom-0 flex flex-col bg-gradient-to-br from-slate-50 via-sky-50 to-emerald-50 ${behind ? "z-[1050]" : "z-[2050]"}`} style={{ top: headerH || 64 }}>
      <div className="flex-1 overflow-y-auto overscroll-contain" style={{ WebkitOverflowScrolling: "touch" }}>
        {/* Section header CỐ ĐỊNH (sticky top-0 trong overlay): luôn thấy tên cửa hàng +
            số sản phẩm/khoảng cách/địa chỉ khi cuộn. Nền mờ đặc để sản phẩm cuộn dưới
            không lộ qua; overlay đã bắt đầu dưới app header nên không bị che. */}
        <div className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50/95 backdrop-blur supports-[backdrop-filter]:bg-slate-50/80">
          <div className="flex items-center gap-2 px-3 pt-4 pb-4">
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
                {sections.length === 0 && (
                  <span className="shrink-0 rounded-full bg-amber-100 px-2.5 py-0.5 text-[11px] font-semibold text-amber-700 ring-1 ring-amber-200">
                    {t("Chưa có thông tin bán hàng online")}
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-xs leading-snug text-slate-500">
                {items.length} {t("sản phẩm")}
                {dist != null && <> · {dist < 1 ? `${Math.round(dist * 1000)}m` : `${dist.toFixed(1)}km`}</>}
                {store.address && <> · {store.address}</>}
              </p>
              {servedBy && (
                <p className="mt-2 text-xs font-medium text-emerald-700">
                  🤝 {t("Phục vụ bởi")}: {servedBy}
                </p>
              )}
              {brandTag && brandFilterOn && (
                <button
                  onClick={() => setBrandFilterOn(false)}
                  className="mt-2 inline-flex items-center gap-1 self-start rounded-full bg-rose-500 px-3 py-1 text-xs font-bold uppercase tracking-wide text-white shadow-sm transition hover:bg-rose-600"
                  aria-label={t("Bỏ lọc nhãn hàng")}
                  title={t("Bỏ lọc nhãn hàng")}
                >
                  {brandLabel}
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
                </button>
              )}
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
              <div className="space-y-3.5 pt-1">
                {/* ── Trạng thái: chưa bán online + liên hệ (soft-gate Zalo OA) ── */}
                <div className="rounded-2xl border border-slate-200/70 bg-white p-4 shadow-[0_1px_3px_rgba(15,23,42,0.06)] sm:p-5">
                  <div>
                    <p className="mb-1.5 text-xs font-medium text-slate-500">🛍️ {t("Mua sản phẩm — liên hệ")}</p>
                    <div className="flex items-center gap-1.5">
                      <span className="rounded-lg bg-slate-50 px-3 py-2 text-sm font-semibold tracking-wide text-slate-700">
                        {contactPhone
                          ? (contactRevealed ? contactPhone : maskPhone(contactPhone))
                          : t("Đang cập nhật")}
                      </span>
                      {contactPhone && (
                      <button
                        type="button"
                        onClick={onEyeClick}
                        aria-label={contactRevealed ? t("Ẩn liên hệ") : t("Xem liên hệ")}
                        title={contactRevealed ? t("Ẩn liên hệ") : t("Xem liên hệ")}
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 active:bg-slate-200"
                      >
                        {contactRevealed ? (
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" /></svg>
                        ) : (
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9.9 4.24A9.1 9.1 0 0 1 12 4c6.5 0 10 7 10 7a13.2 13.2 0 0 1-1.67 2.68M6.6 6.6A13.3 13.3 0 0 0 2 12s3.5 7 10 7a9 9 0 0 0 5.4-1.6" /><path d="M14.12 14.12A3 3 0 1 1 9.88 9.88M2 2l20 20" /></svg>
                        )}
                      </button>
                      )}
                    </div>
                  </div>
                </div>

                {/* ── Tạo trang bán hàng Online ── */}
                <div className="rounded-2xl border border-slate-200/70 bg-white p-4 shadow-[0_1px_3px_rgba(15,23,42,0.06)] sm:p-5">
                  <h2 className="text-sm font-semibold text-slate-800">{t("Tạo trang bán hàng Online")}</h2>
                  {onlineCfg && onlineCfg.services.length > 0 ? (
                    <div className="mt-3 flex gap-3.5 overflow-x-auto px-0.5 pb-2 pt-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                      {onlineCfg.services.map((s) => (
                        <button
                          key={s.name}
                          type="button"
                          onClick={() => { setRegService(s); setRegSent(false); }}
                          className="group flex w-32 shrink-0 flex-col items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-center shadow-sm transition hover:-translate-y-0.5 hover:border-emerald-300 hover:shadow-md active:translate-y-0 active:scale-[0.98]"
                        >
                          <ServiceLogo name={s.name} logo={s.logo} />
                          <span className="w-full truncate text-sm font-semibold text-slate-700 transition group-hover:text-emerald-700">{s.name}</span>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-3 text-center text-xs text-slate-400">{t("Đang tải…")}</p>
                  )}
                </div>

                {/* Khung "Giá hời quanh đây" — DÙNG CHUNG component với trang chủ. */}
                {onDealInfo && onDealAdd && onDealBuy && setDealsRadiusKm && (
                  <NearbyDeals
                    rows={deals ?? []}
                    radiusKm={dealsRadiusKm ?? null}
                    setRadiusKm={setDealsRadiusKm}
                    effKm={dealsEffKm ?? null}
                    userLoc={userLoc}
                    lang={lang}
                    onInfo={onDealInfo}
                    onAdd={onDealAdd}
                    onBuy={onDealBuy}
                    cartQtyFor={(id) => cartQtyFor?.(id) ?? 0}
                  />
                )}

                {/* Popup soft-gate: Quan tâm Zalo OA để xem liên hệ */}
                {showOaGate && createPortal(
                  <div className="fixed inset-0 z-[3000] flex items-center justify-center bg-black/40 p-6" onClick={() => setShowOaGate(false)}>
                    <div className="w-full max-w-xs rounded-2xl bg-white p-5 text-center shadow-xl" onClick={(e) => e.stopPropagation()}>
                      <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-2xl">💬</div>
                      <h3 className="text-sm font-semibold text-slate-800">{t("Quan tâm OA để xem liên hệ")}</h3>
                      <p className="mt-1.5 text-xs leading-relaxed text-slate-500">{t("Quan tâm Zalo OA của công ty để xem thông tin liên hệ mua sản phẩm.")}</p>
                      {/* Nút Quan tâm THẬT của Zalo — nhúng ngay trên web, không rời trang. */}
                      <div className="mt-4 flex min-h-[40px] items-center justify-center">
                        <ZaloFollowButton oaid={oaId} />
                      </div>
                      <button
                        type="button"
                        onClick={confirmFollowOa}
                        className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-700 active:scale-[0.98]"
                      >
                        {t("Tôi đã quan tâm — xem số")}
                      </button>
                      <button type="button" onClick={() => setShowOaGate(false)} className="mt-2 w-full py-2 text-xs font-medium text-slate-400 hover:text-slate-600">{t("Để sau")}</button>
                    </div>
                  </div>,
                  document.body
                )}

                {/* Popup: form đăng ký dịch vụ tạo trang bán hàng */}
                {regService && createPortal(
                  <div className="fixed inset-0 z-[3000] flex items-center justify-center bg-black/40 p-6" onClick={() => setRegService(null)}>
                    <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
                      <div className="mb-3 flex items-center justify-between">
                        <h3 className="text-sm font-semibold text-slate-800">{t("Đăng ký")} {regService.name}</h3>
                        <button type="button" onClick={() => setRegService(null)} aria-label={t("Đóng")} className="flex h-8 w-8 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100">
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
                        </button>
                      </div>
                      {regSent ? (
                        <div className="py-4 text-center">
                          <div className="mx-auto mb-2 flex h-11 w-11 items-center justify-center rounded-full bg-emerald-100 text-xl">✓</div>
                          <p className="text-sm text-slate-700">{t("Đã ghi nhận. Đang mở trang đăng ký {name}…", { name: regService.name })}</p>
                        </div>
                      ) : (
                        <form
                          onSubmit={(e) => {
                            e.preventDefault();
                            setRegSent(true);
                            if (regService.link) window.open(regService.link, "_blank", "noopener");
                            setTimeout(() => setRegService(null), 1600);
                          }}
                          className="space-y-2.5"
                        >
                          <input required placeholder={t("Họ tên")} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100" />
                          <input required inputMode="tel" placeholder={t("Số điện thoại")} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100" />
                          <input type="email" placeholder={t("Email (không bắt buộc)")} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100" />
                          <input defaultValue={store.name} placeholder={t("Tên cửa hàng")} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100" />
                          <button type="submit" className="mt-1 w-full rounded-xl bg-emerald-600 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-700 active:scale-[0.98]">{t("Gửi đăng ký")}</button>
                          <p className="pt-1 text-center text-[10px] text-slate-400">{t("Phục vụ bởi Affree Agentic AI — AAAI")}</p>
                        </form>
                      )}
                    </div>
                  </div>,
                  document.body
                )}
              </div>
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

/** Logo dịch vụ tạo web: thử ảnh (Google Drive cần referrerPolicy no-referrer); vỡ ảnh → chữ đầu. */
function ServiceLogo({ name, logo }: { name: string; logo: string }) {
  const [errored, setErrored] = useState(false);
  if (logo && !errored) {
    return (
      <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white p-2 ring-1 ring-slate-100 shadow-sm">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={logo}
          alt={name}
          referrerPolicy="no-referrer"
          loading="lazy"
          onError={() => setErrored(true)}
          className="h-full w-full object-contain"
        />
      </span>
    );
  }
  return (
    <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-100 to-emerald-50 text-xl font-bold text-emerald-700 ring-1 ring-emerald-100">
      {name.slice(0, 2).toUpperCase()}
    </span>
  );
}
