"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { memo, startTransition, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { CartItem, Catalog, Chain, Product, ProductGroup, RankedOffer, Store, Tui } from "@/lib/types";
import type { CskdCategory } from "@/lib/sheet-cskd";
import { chainColor, chainLabel, chainMinOrder, findChainBySlug, getStore, getStores, physicalStoresOfChain, setDynamicMinOrders, setDynamicStores, storeCurrency } from "@/lib/stores";
import { TrimmedLogo } from "@/components/TrimmedLogo";
import { MarqueeText } from "@/components/MarqueeText";
import {
  cheapestInStock,
  directionsUrl,
  distanceKm,
  formatMoney,
  rankOffersForProduct,
  searchProductsRanked,
} from "@/lib/util";
import { addPurchase, getPurchases } from "@/lib/purchases";
import { getProfile, saveProfile } from "@/lib/profile";
import { addAlert, getAlertForProduct, removeAlert } from "@/lib/alerts";
import type { PriceAlert } from "@/lib/types";
import { getViewCounts, recordView } from "@/lib/recent";
import { getSavedCart, saveCart } from "@/lib/cart";
import { APP_VERSION, VERSION_HISTORY, ROADMAP } from "@/lib/version";
import { type Lang, langForCountry, tr } from "@/lib/i18n";
import { findBrandBySlug, findCategoryBySlug, findGroupBySlug, findProductBySlug, slugify } from "@/lib/slug";
import { ChainBadge } from "@/components/ChainBadge";
import { Logo } from "@/components/Logo";
import { QtyInput } from "@/components/QtyInput";
import { KhucChamSidePanel } from "@/components/KhucChamBanner";
import { KhucChamAlbumList, type MusicBuyItem } from "@/components/KhucChamStore";
import { SiteStats } from "@/components/SiteStats";
import { SubCatBar } from "@/components/SubCatBar";
import { AppFooter } from "@/components/AppFooter";
import type { MusicOrderLine } from "@/components/MusicOrderModal";
import { SEED_MUSIC } from "@/lib/music";
import type { MapMarker } from "@/components/MapView";
import { type GeoResult } from "@/lib/geocode";

const MapView = dynamic(() => import("@/components/MapView"), { ssr: false });
const OrderAgentModal = dynamic(() => import("@/components/OrderAgentModal"), { ssr: false });
const TuiAgentModal = dynamic(() => import("@/components/TuiAgentModal"), { ssr: false });
const MusicOrderModal = dynamic(() => import("@/components/MusicOrderModal"), { ssr: false });
const CartModal = dynamic(() => import("@/components/CartModal"), { ssr: false });
const StoreProductsPage = dynamic(() => import("@/components/StoreProductsPage"), { ssr: false });

const HCM_CENTER: [number, number] = [10.7769, 106.7009];

/** Đổi toạ độ → { địa chỉ gọn, khu vực (phường·quận), mã quốc gia, vùng phân định } bằng Nominatim (OSM). Lỗi → rỗng. */
// In-memory geocode cache — tránh gọi lại Nominatim cho cùng query/tọa độ trong 1 session.
const _geoFwdCache = new Map<string, GeoResult[]>();
const _geoRevCache = new Map<string, { label: string; area: string; cc: string; region: string }>();

async function reverseGeocode(
  lat: number,
  lng: number
): Promise<{ label: string; area: string; cc: string; region: string }> {
  const key = `${lat.toFixed(4)},${lng.toFixed(4)}`;
  if (_geoRevCache.has(key)) return _geoRevCache.get(key)!;
  try {
    const url = `/api/geocode/reverse?lat=${lat}&lng=${lng}`;
    const res = await fetch(url);
    if (!res.ok) return { label: "", area: "", cc: "", region: "" };
    const result = await res.json();
    _geoRevCache.set(key, result);
    return result;
  } catch {
    return { label: "", area: "", cc: "", region: "" };
  }
}

/** Tìm địa chỉ → toạ độ (forward geocode) qua API backend (đã tối ưu flow và cache). */
async function forwardGeocode(q: string): Promise<GeoResult[]> {
  try {
    const cacheKey = `${q.toLowerCase().trim()}`;
    if (_geoFwdCache.has(cacheKey)) return _geoFwdCache.get(cacheKey)!;
    const url = `/api/geocode?q=${encodeURIComponent(q)}`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const results = await res.json();
    _geoFwdCache.set(cacheKey, results);
    return results;
  } catch {
    return [];
  }
}

type Loc = { lat: number; lng: number } | null;
type SortBy = "price" | "distance";
type MobileView = "list" | "map";

const CAT_EMOJI: Record<string, string> = {
  Sữa: "🥛",
  "Gia vị - Dầu ăn": "🫗",
  "Mẹ & Bé": "🍼",
  "Hóa phẩm": "🧴",
  "Gạo - Mì": "🍚",
  "Trứng - Thịt": "🥚",
};

const PAGE_SIZE = 50;

// Đổ bóng mép carousel kiểu "liquid glass" iOS/macOS 26-27: lớp phủ trắng mờ dần + làm mờ
// hậu cảnh (backdrop-blur) GIẢM DẦN vào trong (qua mask) → cảm giác kính trong, nội dung
// "chìm" mượt dưới mép thay vì cắt cứng. Dùng cho 3 carousel trong hộp trắng.
// Mép MỎNG + blur NHẸ trên mobile (màn hẹp, thẻ nhỏ → tránh "mờ quá"), dày/đậm hơn ở sm+.
const GLASS_FADE_LEFT =
  "pointer-events-none absolute inset-y-0 left-0 z-[5] w-9 sm:w-16 bg-gradient-to-r from-white/60 via-white/20 to-transparent backdrop-blur-[3px] sm:backdrop-blur-[6px] [mask-image:linear-gradient(to_right,#000,transparent)] [-webkit-mask-image:linear-gradient(to_right,#000,transparent)]";
const GLASS_FADE_RIGHT =
  "pointer-events-none absolute inset-y-0 right-0 z-[5] w-9 sm:w-16 bg-gradient-to-l from-white/60 via-white/20 to-transparent backdrop-blur-[3px] sm:backdrop-blur-[6px] [mask-image:linear-gradient(to_left,#000,transparent)] [-webkit-mask-image:linear-gradient(to_left,#000,transparent)]";
// Lớp phủ BLUR kính cho mép hàng thẻ sản phẩm — KHÔNG veil trắng (vì nền trang không trắng),
// chỉ làm mờ hậu cảnh giảm dần qua mask → thẻ "nhòe kính" khi trôi tới mép. Cần cha `relative`.
const EDGE_BLUR_RIGHT =
  "pointer-events-none absolute inset-y-0 right-0 z-[5] w-6 sm:w-12 backdrop-blur-[2px] sm:backdrop-blur-[5px] [mask-image:linear-gradient(to_left,#000,transparent)] [-webkit-mask-image:linear-gradient(to_left,#000,transparent)]";
// Ô (tile) kiểu iOS/macOS 26-27 "liquid glass": bo góc mượt + ring mảnh + bóng MỀM 2 lớp
// (ambient to + contact nhỏ) + vệt sáng kính ở mép trên (inset highlight). Hover: bóng nở.
const TILE_GLASS =
  "rounded-[22px] ring-1 ring-black/[0.06] shadow-[0_6px_18px_-6px_rgba(15,23,42,0.18),0_2px_5px_-2px_rgba(15,23,42,0.10),inset_0_1px_0_rgba(255,255,255,0.75)] transition duration-200 group-hover:shadow-[0_14px_30px_-8px_rgba(15,23,42,0.26),0_4px_10px_-2px_rgba(15,23,42,0.14),inset_0_1px_0_rgba(255,255,255,0.9)]";

/** Hàng cuộn ngang có đổ bóng kính 2 mép — mỗi mép CHỈ hiện khi còn cuộn được hướng đó
 *  (thẻ đầu/cuối không bị nhòe khi chưa cuộn). Tự bắt scroll + resize. */
function EdgeFadeRow({ className, children }: { className: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });
  const update = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setEdges({
      left: el.scrollLeft > 4,
      right: el.scrollLeft + el.clientWidth < el.scrollWidth - 4,
    });
  }, []);
  useEffect(() => {
    update();
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [update]);
  return (
    <div className="relative">
      {/* Chỉ đổ bóng mép PHẢI (gợi ý còn cuộn →). KHÔNG blur mép trái để thẻ ngoài cùng
          không bị mờ góc trái — nhất là trên mobile thẻ to. */}
      {edges.right && <div className={EDGE_BLUR_RIGHT} />}
      <div ref={ref} onScroll={update} className={className}>
        {children}
      </div>
    </div>
  );
}
import { CATEGORY_GROUPS, GROUP_TILE, DEFAULT_TILE_EMOJIS, DEFAULT_TILE_TINTS, categoryGroup, buildCategoryTiles, type ServiceTile } from "@/lib/categories";
import { isFoodSection, pickMealTitle } from "@/lib/timeSlot";



// Chuẩn hoá nhãn ngành hàng: ô VIẾT HOA TOÀN BỘ (vd "NƯỚC LAU SÀN", "GEL GỘI") → dạng câu
// ("Nước lau sàn", "Gel gội") cho đồng đều; nhãn đã viết thường/hỗn hợp giữ nguyên.
function prettyCat(raw: string): string {
  const t = (raw || "").trim();
  if (!t) return t;
  if (/[a-zà-ỹ]/i.test(t) && t === t.toUpperCase()) {
    const lower = t.toLowerCase();
    return lower.charAt(0).toUpperCase() + lower.slice(1);
  }
  return t;
}


// Bộ lọc nhanh ở màn chính — đề xuất "deal hời / giá hời / bán chạy" từ dữ liệu thật.
type QuickFilter = "deal" | "cheap" | "hot";
const QUICK_FILTERS: { key: QuickFilter; label: string; emoji: string }[] = [
  { key: "deal", label: "Deal hời", emoji: "🏷️" },
  { key: "cheap", label: "Giá hời", emoji: "💰" },
  { key: "hot", label: "Bán chạy khu vực", emoji: "🔥" },
];

// Dịch vụ "tĩnh" (link ngoài / sắp ra mắt) — luôn hiện. Các ô DANH MỤC sản phẩm
// được tạo ĐỘNG từ dữ liệu Google Sheet (xem buildCategoryTiles bên dưới), nên thêm
// danh mục mới trong sheet là tự mọc thêm ô, không cần sửa code.
const SERVICE_LEAD: ServiceTile[] = [];
// Tệp bị ẩn khỏi lưới "Dịch vụ quanh đây" dù còn trong Google Sheet (so khớp theo nhãn, bỏ dấu/hoa-thường).
const HIDDEN_TILE_LABELS = new Set(["đi chợ"]);
const SERVICE_TAIL: ServiceTile[] = [
  { key: "cam-do", label: "Cầm đồ", emoji: "🏦", tint: "bg-orange-100 text-orange-700", kind: "soon" },
  { key: "dinh-gia", label: "Định giá", emoji: "📊", tint: "bg-sky-100 text-sky-700", kind: "link", url: "https://homeinfo68.com" },
  { key: "xay-dung", label: "Xây dựng", emoji: "🏗️", tint: "bg-yellow-100 text-yellow-700", kind: "link", url: "https://housecons68.com" },
  { key: "bds", label: "Nhà đất", emoji: "🏠", tint: "bg-teal-100 text-teal-700", kind: "link", url: "https://homeinfo68.com" },
];

// Số sản phẩm chuỗi THXL tối đa được ghim lên đầu danh sách (~2 hàng × lưới 4 cột).
const PIN_THXL_TOP = 8;


/**
 * Dựng ô dịch vụ TỪ TAB "tệp" của Google Sheet (catalog.groups). Thứ tự = thứ tự dòng.
 * - link là URL  → ô mở trang ngoài (kind "link").
 * - link = "soon"/"sắp" → ô sắp ra mắt (kind "soon").
 * - link trống   → ô LỌC sản phẩm theo tệp (chỉ hiện nếu tệp đó có sản phẩm).
 * Emoji lấy từ sheet; màu lấy theo GROUP_TILE (nếu là tệp chuẩn) hoặc màu mặc định.
 */
function buildTilesFromGroups(
  groups: ProductGroup[],
  products: { name?: string; brand?: string; category?: string; group?: string }[]
): ServiceTile[] {
  const tiles: ServiceTile[] = [];
  groups.forEach((g, i) => {
    const label = (g.label || "").trim();
    if (!label) return;
    const link = (g.link || "").trim();
    const isUrl = /^https?:\/\//i.test(link);
    const isSoon = !isUrl && /^(soon|sắp|sap|coming)/i.test(link.toLowerCase());
    const known = GROUP_TILE[label];
    const emoji = (g.emoji || "").trim() || known?.emoji || DEFAULT_TILE_EMOJIS[i % DEFAULT_TILE_EMOJIS.length];
    const tint = known?.tint ?? DEFAULT_TILE_TINTS[i % DEFAULT_TILE_TINTS.length];
    // Hiển thị ĐÚNG tên người dùng gõ trong tab "tệp" (không ép theo nhãn nội bộ GROUP_TILE).
    const display = label;
    // Tile "Liên hệ dịch vụ - Affree" — bất kể link trong sheet, luôn coi là "link" để
    // openService nhận diện và mở popup form liên hệ trong app (không mở URL ngoài).
    const isContactAffree = /liên hệ.*affree/i.test(label);
    if (isContactAffree) {
      tiles.push({ key: `contact-${label}`, label: display, emoji, tint, kind: "link", url: link || "#contact" });
    } else if (isUrl) {
      tiles.push({ key: `lnk-${label}`, label: display, emoji, tint, kind: "link", url: link });
    } else if (isSoon) {
      tiles.push({ key: `soon-${label}`, label: display, emoji, tint, kind: "soon" });
    } else {
      // Tệp link trống = ô LỌC sản phẩm. Hiển thị ĐÚNG theo danh sách trong tab "tệp"
      // của Google Sheet (kể cả tệp chưa có sản phẩm), để web phản ánh trọn vẹn cấu hình.
      tiles.push({ key: `cat-${label}`, label: display, emoji, tint, kind: "filter", cat: label });
    }
  });
  return tiles;
}

/**
 * Suy ra "nguồn ảnh" thân thiện từ URL ảnh (để ghi công + minh bạch pháp lý).
 * Ảnh là tài sản của nhà bán lẻ/nhà sản xuất — hiển thị kèm nguồn, không nhận là của mình.
 */
/** Lấy link TRANG CHỦ (origin) từ một URL bất kỳ — vd ".../sua-tuoi/abc" → "https://www.bachhoaxanh.com". */
function homepageOf(url?: string): string {
  if (!url) return "";
  try {
    return new URL(url).origin;
  } catch {
    return "";
  }
}

function formatCheckedAt(raw: string): string {
  if (!raw) return "";
  const d = new Date(raw);
  if (isNaN(d.getTime())) return raw; // không parse được → trả raw
  const h = d.getHours();
  const m = d.getMinutes();
  const timeStr = m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, "0")}`;
  return `${timeStr} ngày ${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
}

/**
 * Suy quốc gia của 1 cửa hàng vật lý từ lat/lng (bbox xấp xỉ). Online store → undefined
 * (hiển thị ở mọi quốc gia). Trả về country code lowercase ("vn"/"us"/"ca"…) hoặc undefined.
 */
function storeCountryCode(store: { lat?: number; lng?: number; online?: boolean } | undefined): string | undefined {
  if (!store || store.online) return undefined;
  const { lat, lng } = store;
  if (lat == null || lng == null) return undefined;
  // VN: ~8–24°N, 102–110°E
  if (lat >= 8 && lat <= 24 && lng >= 102 && lng <= 110) return "vn";
  // US continental: ~24–50°N, -125 đến -66°W
  if (lat >= 24 && lat <= 50 && lng >= -125 && lng <= -66) return "us";
  // Canada: ~41–84°N, -141 đến -52°W
  if (lat >= 41 && lat <= 84 && lng >= -141 && lng <= -52) return "ca";
  return undefined;
}

function imageSource(url?: string): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    const h = u.hostname.toLowerCase();
    const path = u.pathname.toLowerCase();
    if (h.includes("tgdd") && path.includes("bhx")) return "Bách Hóa Xanh";
    if (h.includes("tgdd")) return "Thế Giới Di Động";
    if (h.includes("coop")) return "Co.opmart";
    if (h.includes("slatic") || h.includes("lazada")) return "Lazada";
    if (h.includes("shopee")) return "Shopee";
    if (h.includes("tiki")) return "Tiki";
    if (h.includes("winmart") || h.includes("vincommerce")) return "WinMart";
    if (h.includes("openfoodfacts")) return "Open Food Facts";
    return h.replace(/^www\./, "");
  } catch {
    return null;
  }
}

const ProductThumb = memo(function ProductThumb({
  product,
  size = 48,
  contain = false,
  fill = false,
}: {
  product: Product;
  size?: number;
  contain?: boolean;
  fill?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  if (product.image && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={product.image}
        alt=""
        loading="lazy"
        onError={() => setFailed(true)}
        style={fill ? undefined : { width: size, height: size }}
        className={
          fill
            ? "h-full w-full rounded-lg object-contain"
            : `shrink-0 rounded-lg ${contain ? "object-contain" : "border border-slate-100 object-cover"}`
        }
      />
    );
  }
  return (
    <span
      style={fill ? { fontSize: 64 } : { width: size, height: size, fontSize: size * 0.5 }}
      className={`flex items-center justify-center rounded-lg bg-emerald-50 ${fill ? "h-full w-full" : "shrink-0"
        }`}
    >
      {CAT_EMOJI[product.category] ?? "🛒"}
    </span>
  );
});

// MarqueeText đã tách ra components/MarqueeText.tsx để dùng chung (map popup, modal, header cửa hàng…).

/** Popover chọn vị trí: định vị GPS hoặc nhập địa chỉ khác để kiểm tra. */
function LocationPanel({
  geoState,
  locate,
  addrQuery,
  setAddrQuery,
  addrResults,
  addrSearching,
  addrSearched,
  searchAddress,
  pickAddress,
  onClose,
  t,
}: {
  geoState: "idle" | "locating" | "ok" | "error";
  locate: () => void;
  addrQuery: string;
  setAddrQuery: (v: string) => void;
  addrResults: GeoResult[];
  addrSearching: boolean;
  addrSearched: boolean;
  searchAddress: () => void;
  pickAddress: (r: GeoResult) => void;
  onClose: () => void;
  t: (vi: string, vars?: Record<string, string | number>) => string;
}) {
  const [inputVal, setInputVal] = useState(addrQuery);
  useEffect(() => {
    const timer = setTimeout(() => setAddrQuery(inputVal), 500);
    return () => clearTimeout(timer);
  }, [inputVal, setAddrQuery]);

  return (
    <div
      className="fixed inset-0 z-[2200] flex items-center justify-center bg-slate-900/50 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md max-h-[85vh] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <span className="text-base font-bold text-slate-800">{t("Chọn vị trí")}</span>
          <button
            onClick={onClose}
            aria-label={t("Đóng")}
            className="flex h-7 w-7 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>
        <button
          onClick={locate}
          disabled={geoState === "locating"}
          className="flex w-full items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-3 text-left transition hover:border-emerald-400 hover:bg-emerald-100 disabled:opacity-60"
        >
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-emerald-600 text-white text-lg">
            📍
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-emerald-800">
              {geoState === "locating" ? t("Đang định vị…") : t("Dùng vị trí hiện tại")}
            </span>
            <span className="block text-xs text-emerald-700/80">{t("Định vị GPS trên thiết bị của bạn")}</span>
          </span>
        </button>

        {geoState === "error" && (
          <p className="mt-1.5 px-1 text-xs text-rose-600">
            {t("Trình duyệt đang chặn quyền vị trí. Cho phép vị trí rồi thử lại, hoặc nhập địa chỉ bên dưới.")}
          </p>
        )}

        <div className="my-2.5 flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-slate-400">
          <span className="h-px flex-1 bg-slate-200" />
          {t("hoặc nhập địa chỉ")}
          <span className="h-px flex-1 bg-slate-200" />
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            setAddrQuery(inputVal);
            if (addrResults.length > 0) pickAddress(addrResults[0]);
            else searchAddress();
          }}
          className="relative"
        >
          <input
            value={inputVal}
            onChange={(e) => setInputVal(e.target.value)}
            autoFocus
            placeholder={t("VD: 123 Lê Lợi, Quận 1, TP.HCM")}
            className="w-full rounded-lg border border-slate-300 py-2 pl-3 pr-9 text-sm outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
          />
          {addrSearching && (
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">
              {t("Đang tìm…")}
            </span>
          )}
        </form>

        {addrResults.length > 0 && (
          <>
            <p className="mt-2 px-1 text-[11px] font-medium uppercase tracking-wide text-slate-400">
              {t("Bấm để chọn địa chỉ")}
            </p>
            <ul className="mt-1 max-h-56 space-y-0.5 overflow-y-auto">
              {addrResults.map((r, i) => (
                <li key={i}>
                  <button
                    onClick={() => pickAddress(r)}
                    className="group flex w-full items-center gap-2 rounded-lg border border-transparent px-2 py-2 text-left text-sm transition hover:border-emerald-200 hover:bg-emerald-50"
                  >
                    <span className="mt-0.5 shrink-0 text-slate-400">📍</span>
                    <span className="min-w-0 flex-1 text-slate-700">{r.label}</span>
                    <svg
                      className="shrink-0 text-slate-300 transition group-hover:text-emerald-600"
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.4"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="m9 18 6-6-6-6" />
                    </svg>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
        {addrSearched && addrResults.length === 0 && !addrSearching && (
          <p className="mt-2 px-1 text-xs text-slate-400">
            {t("Không tìm thấy địa chỉ. Thử nhập rõ hơn (đường, quận, thành phố).")}
          </p>
        )}
      </div>
    </div>
  );
}

// Module-level cache — tồn tại qua remount khi Next.js chuyển route (/ → /slug).
let _catalogCache: Catalog | null = null;

export default function Home() {
  // rawCatalog/rawStores = dữ liệu gốc; catalog/stores đã được scope theo region.
  // Khi đã định vị trong VN: chỉ giữ CSKD trong vùng quanh user (offline) + online stores → giảm tải dữ liệu.
  const [rawCatalog, setRawCatalog] = useState<Catalog | null>(null);
  const [rawStores, setRawStores] = useState<Store[] | null>(null);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [source, setSource] = useState<string>("");
  // Tăng mỗi khi nạp xong cửa hàng từ sheet → ép tính lại marker/khoảng cách.
  const [storesReady, setStoresReady] = useState(0);
  const [userLoc, setUserLoc] = useState<Loc>(null);
  const [userAddr, setUserAddr] = useState<string>("");
  // "Khu vực" (phường·quận) của vị trí đang chọn — khoá cho "bán chạy khu vực".
  const [areaName, setAreaName] = useState<string>("");
  // Mã quốc gia của vị trí đang chọn (vd "vn", "us") → suy ngôn ngữ giao diện.
  const [country, setCountry] = useState<string>("");
  // Vùng phân định = tỉnh/thành của vị trí đang chọn ("TPHCM", "Hà Nội", "Đồng Nai"…; rỗng nếu
  // ngoài VN / chưa định vị). Toàn hệ thống bám theo region này để lọc CSKD/sản phẩm + hiện badge.
  const [region, setRegion] = useState<string>("");
  const [geoState, setGeoState] = useState<"idle" | "locating" | "ok" | "error">("idle");
  const [geoDismissed, setGeoDismissed] = useState(false);
  const [locOpen, setLocOpen] = useState(false);
  const [verOpen, setVerOpen] = useState(false);
  const [expandedVer, setExpandedVer] = useState<string | null>(null);
  // Sub-version cũ (trong bản mới nhất) đang mở chi tiết; null = chỉ sub mới nhất xổ.
  const [expandedSub, setExpandedSub] = useState<string | null>(null);
  const [addrQuery, setAddrQuery] = useState("");
  const [addrResults, setAddrResults] = useState<GeoResult[]>([]);
  const [addrSearching, setAddrSearching] = useState(false);
  const [addrSearched, setAddrSearched] = useState(false);
  const [query, setQuery] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  // Lọc 2 cấp: activeTep = TỆP (group, từ ô "Dịch vụ quanh đây") · activeCat = NGÀNH HÀNG
  // (category, từ dãy chip). Chip ngành hàng chỉ hiện những ngành thuộc tệp đang chọn.
  const [activeTep, setActiveTep] = useState<string | null>(null);
  const [activeCat, setActiveCat] = useState<string | null>(null);
  // Filter theo nhãn hàng (brand). Set khi URL = /nhan/<brand> hoặc click logo nhãn tài trợ.
  const [activeBrand, setActiveBrand] = useState<string | null>(null);
  // Filter theo CHUỖI cửa hàng (chain, vd "astrabean"). Set khi URL = /<chain-slug>.
  // Chỉ hiện sản phẩm có offer ở chuỗi này — như "trang cửa hàng" của 1 chuỗi.
  const [activeChain, setActiveChain] = useState<string | null>(null);
  // Cửa hàng đang xem sản phẩm (mở từ pin trên bản đồ).
  const [storeProducts, setStoreProducts] = useState<Store | null>(null);
  // Ô dịch vụ vừa bấm — để làm nổi bật (highlight) khối được chọn.
  const [activeService, setActiveService] = useState<string | null>(null);
  // Lưới dịch vụ: cuộn ngang + nút mũi tên khi nhiều ô.
  const svcScrollRef = useRef<HTMLDivElement>(null);
  const [svcArrows, setSvcArrows] = useState({ left: false, right: false });
  // Carousel "🔥 Giá hời quanh đây": cuộn ngang + nút mũi tên.
  const dealScrollRef = useRef<HTMLDivElement>(null);
  const [dealArrows, setDealArrows] = useState({ left: false, right: false });
  // Carousel "Nhãn tài trợ": chỉ cần biết còn cuộn được trái/phải để đổ bóng mép (fade).
  const brandScrollRef = useRef<HTMLDivElement>(null);
  const [brandArrows, setBrandArrows] = useState({ left: false, right: false });
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Product | null>(null);
  const [sortBy, setSortBy] = useState<SortBy>("price");
  const [radiusKm, setRadiusKm] = useState<number | null>(null);
  const [dealsRadiusKm, setDealsRadiusKm] = useState<number | null>(null);
  const [mobileView, setMobileView] = useState<MobileView>("list");
  // Bản đồ dưới thanh search: mặc định ẩn, tự mở khi đã có vị trí (định vị / nhập địa chỉ).
  const [mapOpen, setMapOpen] = useState(false);
  const [hoverStore, setHoverStore] = useState<string | null>(null);
  const [toast, setToast] = useState<string>("");
  const [alertOpen, setAlertOpen] = useState(false);
  const [contactOpen, setContactOpen] = useState(false);
  // Form "Liên hệ dịch vụ - Affree": có các loại nhu cầu để route đúng team.
  // "nhac-ban-quyen" = form cấp phép nhạc Khúc Chạm (ẩn lựa chọn loại, hiện field riêng).
  type ContactKind = "tu-van" | "hop-tac" | "b2b" | "khac" | "nhac-ban-quyen" | "loi-yeu-thuong";
  const [contactKind, setContactKind] = useState<ContactKind>("tu-van");
  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [contactArea, setContactArea] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactMsg, setContactMsg] = useState("");
  // Field riêng cho form "Gửi lời yêu thương" — tên người thân sẽ nhận lời nhắn.
  const [contactRecipient, setContactRecipient] = useState("");
  // Field riêng cho form cấp phép nhạc.
  const [contactCompany, setContactCompany] = useState("");
  const [contactPurposes, setContactPurposes] = useState<string[]>([]);
  const [contactAlbum, setContactAlbum] = useState("");
  const [contactScope, setContactScope] = useState("");
  const [contactBudget, setContactBudget] = useState("");
  const [contactConsent, setContactConsent] = useState(true);
  const [contactSubmitting, setContactSubmitting] = useState(false);
  const [contactError, setContactError] = useState("");
  const [alertPhone, setAlertPhone] = useState("");
  const [myAlert, setMyAlert] = useState<PriceAlert | null>(null);
  const [viewCounts, setViewCounts] = useState<Record<string, number>>({});
  const [purchaseCounts, setPurchaseCounts] = useState<Record<string, number>>({});
  const [quickFilter, setQuickFilter] = useState<QuickFilter | null>(null);
  const [expandedGroups] = useState<Set<string>>(new Set());
  // Giờ trong ngày (client-only để tránh hydration mismatch) — dùng để đổi tên section
  // "Đồ ăn" theo buổi ăn (pickMealTitle, xem useMemo groupSections bên dưới).
  const [hourOfDay, setHourOfDay] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setHourOfDay(new Date().getHours());
    tick();
    // Cập nhật lại nếu user mở app xuyên qua mốc giờ (đổi ca trong ngày).
    const id = window.setInterval(tick, 60_000);
    return () => window.clearInterval(id);
  }, []);
  // Form "Vào mua" cho sản phẩm không có so sánh giá (chỉ 1 nguồn) → thu thông tin đặt mua.
  const [buyProduct, setBuyProduct] = useState<Product | null>(null);
  // Cửa hàng được chọn khi mở form mua từ popup bản đồ (để ghi đúng nơi mua).
  const [buyStore, setBuyStore] = useState<Store | null>(null);
  const [buyName, setBuyName] = useState("");
  const [buyPhone, setBuyPhone] = useState("");
  const [buyAddr, setBuyAddr] = useState("");
  const [buyQty, setBuyQty] = useState(1);
  const [buyNote, setBuyNote] = useState("");
  const [buySubmitting, setBuySubmitting] = useState(false);
  const [buyOffer, setBuyOffer] = useState<RankedOffer | null>(null);
  const [txnnLiveOpen, setTxnnLiveOpen] = useState(false);
  const [expandedChains, setExpandedChains] = useState<Set<string>>(new Set());

  // Giỏ hàng — mua nhiều sản phẩm từ nhiều cửa hàng cùng lúc.
  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [cartOpen, setCartOpen] = useState(false);
  // Cửa hàng đã đặt xong — hoãn xoá khỏi giỏ tới khi ĐÓNG modal, để màn "Đã ghi nhận
  // đơn hàng" kịp hiển thị (nếu xoá ngay, giỏ rỗng → CartModal unmount, mất màn done).
  const [orderedStoreIds, setOrderedStoreIds] = useState<string[]>([]);
  // Increment mỗi khi addToCart → re-key icon/badge để restart animation.
  const [cartBumpKey, setCartBumpKey] = useState(0);
  // Khôi phục giỏ hàng từ localStorage sau khi mount (dùng effect, không dùng lazy init,
  // để tránh hydration mismatch). cartLoadedRef chặn effect lưu chạy trước khi khôi phục
  // xong — nếu không sẽ ghi đè [] rỗng lên giỏ đã lưu ngay lần render đầu.
  const cartLoadedRef = useRef(false);
  useEffect(() => {
    const saved = getSavedCart();
    if (saved.length) setCartItems(saved);
    cartLoadedRef.current = true;
  }, []);
  useEffect(() => {
    if (!cartLoadedRef.current) return;
    saveCart(cartItems);
  }, [cartItems]);
  const [infoProduct, setInfoProduct] = useState<Product | null>(null);
  // Túi đang xem chi tiết — mở qua nút ⓘ trên thẻ túi để xem danh sách SP bên trong.
  const [tuiInfo, setTuiInfo] = useState<Tui | null>(null);
  // Túi đang đặt qua màn agentic ("Mua cả túi") — liệt kê món theo nguồn rồi đặt.
  const [buyTui, setBuyTui] = useState<Tui | null>(null);
  // Đơn nhạc bản quyền đang đặt (form riêng, KHÔNG agentic). null = đóng.
  const [musicOrder, setMusicOrder] = useState<MusicOrderLine[] | null>(null);
  // Map tên nhãn → màu nền chủ đạo (tự detect từ logo qua TrimmedLogo). Logo có nền màu
  // đặc (vd Mencode vàng, Vinamilk xanh) sẽ paint card cùng màu → fill 100% khung.
  const [sponsorFill, setSponsorFill] = useState<Record<string, string>>({});
  // Override màu nền cho logo mà TrimmedLogo không bắt đúng.
  // Beauty Republic: BỎ override (gold #B78932 + keyOutWhite làm logo bị xấu: chữ
  // "BEAUTY REPUBLIC" mờ/bị crop, emblem mất nét). Để card trắng tự nhiên, logo
  // crest gold/lá hiện rõ trên nền trắng = đẹp hơn.
  // Alo Clean: gradient + decorative band ở mép giữa → override khớp 4 góc cho mượt.
  const SPONSOR_FILL_OVERRIDES: Record<string, string> = {
    "Alo Clean": "#DFB77D",
  };
  // Aspect ratio (w/h) sau trim — card width co theo để logo fill 100% chiều cao + ngang.
  const [sponsorAspect, setSponsorAspect] = useState<Record<string, number>>({});

  /**
   * Cân bằng lại phần "bơm tự động" cho mức mua tối thiểu của từng chuỗi.
   * userQty (số khách thực muốn) = qty - autoQty. Nếu tổng userQty của chuỗi đã đạt ngưỡng
   * → gỡ hết bơm (mọi món về userQty). Nếu chưa → dồn phần bơm vào ĐÚNG 1 món (ưu tiên món
   * đang giữ bơm sẵn, không thì món cuối của chuỗi) cho đủ ngưỡng. Không đụng số khách tự chỉnh.
   */
  function rebalanceMinOrder(items: CartItem[]): CartItem[] {
    const byChain = new Map<string, number[]>();
    items.forEach((it, i) => {
      const c = it.offer.store.chain;
      const arr = byChain.get(c) ?? [];
      arr.push(i);
      byChain.set(c, arr);
    });
    const out = items.map((it) => ({ ...it }));
    for (const [chain, idxs] of byChain) {
      const min = chainMinOrder(chain);
      // userQty của mỗi món (bỏ phần bơm cũ)
      const userQty = idxs.map((i) => Math.max(1, out[i].qty - (out[i].autoQty ?? 0)));
      const baseTotal = idxs.reduce((s, i, k) => s + out[i].offer.price * userQty[k], 0);
      if (min <= 0 || baseTotal >= min) {
        idxs.forEach((i, k) => { out[i].qty = userQty[k]; out[i].autoQty = 0; });
        continue;
      }
      // Chọn món gánh phần bơm: ưu tiên món đang có autoQty, không thì món cuối chuỗi.
      let carrier = idxs.findIndex((i) => (items[i].autoQty ?? 0) > 0);
      if (carrier < 0) carrier = idxs.length - 1;
      const gap = min - baseTotal;
      idxs.forEach((i, k) => {
        const price = out[i].offer.price;
        if (k === carrier && price > 0) {
          const add = Math.ceil(gap / price);
          out[i].qty = userQty[k] + add;
          out[i].autoQty = add;
        } else {
          out[i].qty = userQty[k];
          out[i].autoQty = 0;
        }
      });
    }
    return out;
  }

  function addToCart(p: Product, offer?: RankedOffer) {
    let ranked = offer ?? (catalog ? rankOffersForProduct(catalog, p, userLoc) : [])?.[0];
    // Fallback: rankOffersForProduct bỏ qua offers khi store chưa đăng ký (nguồn online/food).
    // Dùng trực tiếp offer từ catalog, tạo synthetic store từ storeId.
    if (!ranked && catalog) {
      const o = catalog.offers.find((o) => o.productId === p.id && o.inStock)
        ?? catalog.offers.find((o) => o.productId === p.id);
      if (o) {
        const store = getStore(o.storeId) ?? {
          id: o.storeId, chain: o.storeId, name: o.storeId,
          address: "", website: o.productUrl ?? "", online: true,
        } as Store;
        ranked = { ...o, store, product: p, distanceKm: null };
      }
    }
    if (!ranked) return;
    setCartItems((prev) => {
      const idx = prev.findIndex(
        (i) => i.product.id === p.id && i.offer.store.id === ranked.store.id,
      );
      let next: CartItem[];
      if (idx >= 0) {
        // Coi số ĐANG HIỂN THỊ (qty, đã gồm phần bơm min-order) là mốc: bấm "+" → +1 so với
        // số user thấy. Phải reset autoQty=0, nếu không rebalance tính userQty = qty - autoQty
        // sẽ "nuốt" mất phần vừa cộng (vd 2→3 nhưng autoQty=1 → userQty=2 → hiện lại 2, tưởng lỗi).
        next = [...prev];
        next[idx] = { ...next[idx], qty: next[idx].qty + 1, autoQty: 0 };
      } else {
        next = [...prev, { product: p, offer: ranked, qty: 1, autoQty: 0 }];
      }
      return rebalanceMinOrder(next);
    });
    setCartBumpKey((k) => k + 1);
  }

  // Nhạc không nằm trong catalog → dựng product/offer/store tổng hợp (store "khuccham") để
  // dùng chung cho cả giỏ hàng lẫn màn agentic (đồng nhất với thẻ sản phẩm).
  function musicOffer(item: MusicBuyItem): RankedOffer {
    const store: Store = {
      id: "khuccham",
      chain: "khuccham",
      name: "Khúc Chạm Plaza",
      address: "",
      website: "https://music.youtube.com/@KhucChamChannel",
      online: true,
    };
    const product: Product = {
      id: item.id,
      name: item.name,
      brand: "Khúc Chạm",
      category: "Nhạc bản quyền",
      unit: item.id.includes("album") ? "album" : "bài hát",
      image: item.image,
    };
    return {
      productId: product.id,
      storeId: store.id,
      price: item.price,
      inStock: true,
      productUrl: store.website,
      lastChecked: new Date().toISOString(),
      store,
      product,
      distanceKm: null,
    };
  }

  // Nút "+" của thẻ nhạc → thêm album/bài vào giỏ (gộp chung 1 nhóm "Khúc Chạm Plaza").
  function addMusicToCart(item: MusicBuyItem) {
    const offer = musicOffer(item);
    setCartItems((prev) => {
      const idx = prev.findIndex((i) => i.product.id === offer.product.id && i.offer.store.id === offer.store.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], qty: next[idx].qty + 1 };
        return next;
      }
      return [...prev, { product: offer.product, offer, qty: 1 }];
    });
    setCartBumpKey((k) => k + 1);
  }

  // Nút "Mua ngay"/"Mua bài" của nhạc → mở FORM ĐẶT MUA NHẠC (sản phẩm số, KHÔNG agentic).
  function openMusicOrder(item: MusicBuyItem) {
    setMusicOrder([{ id: item.id, name: item.name, image: item.image, price: item.price, qty: 1 }]);
  }

  // Ghi nhận mua nhạc: mỗi dòng = 1 lượt mua tại Khúc Chạm Plaza.
  async function recordMusicBuy(lines: MusicOrderLine[]) {
    for (const l of lines) {
      await addPurchase({
        productId: l.id,
        productName: l.name,
        storeId: "khuccham",
        storeName: "Khúc Chạm Plaza",
        chain: "khuccham",
        qty: l.qty ?? 1,
        unitPrice: l.price,
        buyerAddr: userAddr || undefined,
      });
    }
  }

  // Thêm mọi SP thành viên của túi vào giỏ (SP nào chưa có trong catalog thì bỏ qua).
  // openCart=true ("Mua cả túi") → mở giỏ luôn; openCart=false (nút "+") → thêm âm thầm
  // như nút "+" của thẻ sản phẩm.
  function addTuiToCart(tui: import("@/lib/types").Tui, openCart = true) {
    if (!catalog) return;
    let added = 0;
    for (const it of tui.items) {
      const p = catalog.products.find((x) => x.id === it.productId);
      if (p) { addToCart(p); added++; }
    }
    if (openCart) setCartOpen(true);
    if (added < tui.items.length) {
      setToast(t("Đã thêm {n}/{m} món của túi (vài món chưa có trong kho)", { n: added, m: tui.items.length }));
      setTimeout(() => setToast(""), 3500);
    }
  }

  // Số "bộ túi" đang có trong giỏ (≈ số lần đã thêm cả túi) = qty NHỎ NHẤT trong các SP thành
  // viên (chỉ tính SP có trong catalog). Dùng cho badge trên nút "+" của thẻ túi.
  function tuiQtyInCart(tui: import("@/lib/types").Tui) {
    if (!catalog) return 0;
    const present = tui.items.filter((it) => catalog.products.some((x) => x.id === it.productId));
    if (!present.length) return 0;
    return Math.min(...present.map((it) => cartQtyFor(it.productId)));
  }

  // "Mua cả túi": mở màn agentic đặt CẢ TÚI (liệt kê món theo nguồn/chuyên trang rồi đặt).
  function buyTuiWithAgent(tui: import("@/lib/types").Tui) {
    setBuyTui(tui);
  }

  // Dựng danh sách dòng đặt hàng của túi (mỗi món + nguồn + cửa hàng + giá) cho TuiAgentModal.
  function tuiOrderLines(tui: import("@/lib/types").Tui) {
    if (!catalog) return [];
    return tui.items.map((it) => {
      const p = catalog.products.find((x) => x.id === it.productId);
      const ranked = p ? rankOffersForProduct(catalog, p, userLoc) : [];
      const best = cheapestInStock(ranked) ?? ranked[0];
      return {
        productId: it.productId,
        name: p?.name ?? it.name,
        image: p?.image,
        sourceLabel: chainLabel(it.chain),
        storeName: best?.store.name ?? chainLabel(it.chain),
        // Giá khớp với "Tạm tính cả túi" (tuiCombo): ưu tiên giá khai báo của túi, rồi
        // priceStats (giá thấp nhất từ catalog — có cả nguồn online), cuối cùng giá offer.
        // Tránh 0đ khi rankOffersForProduct bỏ qua nguồn online (store chưa đăng ký).
        price: it.gia || priceStats.get(it.productId)?.min || best?.price || 0,
        qty: 1,
      };
    });
  }

  // Ghi nhận mua cả túi: mỗi món thành 1 lượt mua (giống recordBuy) tại nguồn rẻ nhất sẵn có.
  async function recordTuiBuy(tui: import("@/lib/types").Tui) {
    if (!catalog) return;
    for (const it of tui.items) {
      const p = catalog.products.find((x) => x.id === it.productId);
      if (!p) continue;
      const ranked = rankOffersForProduct(catalog, p, userLoc);
      const best = cheapestInStock(ranked) ?? ranked[0];
      await addPurchase({
        productId: p.id,
        productName: p.name,
        storeId: best?.store.id ?? it.chain,
        storeName: best?.store.name ?? chainLabel(it.chain),
        chain: best?.store.chain ?? it.chain,
        qty: 1,
        unitPrice: best?.price ?? it.gia,
        buyerLat: userLoc?.lat,
        buyerLng: userLoc?.lng,
        buyerAddr: userAddr || undefined,
      });
    }
  }

  function updateCartQty(productId: string, storeId: string, qty: number) {
    // Nút +/− trong giỏ là bộ đếm số lượng THUẦN: đặt đúng số user chọn, KHÔNG chạy
    // rebalanceMinOrder để tự bơm lại cho đủ mức tối thiểu. (Min-order chỉ auto-bơm lúc
    // THÊM vào giỏ.) Nhờ vậy bấm "−" giảm đúng 1, không bị kéo ngược về mức cũ.
    setCartItems((prev) =>
      prev.map((i) =>
        i.product.id === productId && i.offer.store.id === storeId
          ? { ...i, qty: Math.max(1, qty), autoQty: 0 }
          : i,
      ),
    );
  }

  function removeFromCart(productId: string, storeId: string) {
    setCartItems((prev) =>
      rebalanceMinOrder(
        prev.filter((i) => !(i.product.id === productId && i.offer.store.id === storeId)),
      ),
    );
  }

  function cartQtyFor(productId: string) {
    return cartItems.filter((i) => i.product.id === productId).reduce((s, i) => s + i.qty, 0);
  }

  function decrementCart(productId: string) {
    setCartItems((prev) => {
      const idx = prev.findIndex((i) => i.product.id === productId);
      if (idx < 0) return prev;
      const item = prev[idx];
      // Giảm theo số KHÁCH thực muốn (bỏ phần bơm tự động). Về 0 → xoá món.
      const userQty = Math.max(1, item.qty - (item.autoQty ?? 0));
      if (userQty <= 1) return rebalanceMinOrder(prev.filter((_, i) => i !== idx));
      const next = [...prev];
      next[idx] = { ...next[idx], qty: userQty - 1, autoQty: 0 };
      return rebalanceMinOrder(next);
    });
  }

  function setCartQtyFor(productId: string, qty: number) {
    if (qty <= 0) {
      setCartItems((prev) => rebalanceMinOrder(prev.filter((i) => i.product.id !== productId)));
      return;
    }
    setCartItems((prev) => {
      const idx = prev.findIndex((i) => i.product.id === productId);
      if (idx < 0) return prev;
      const next = [...prev];
      next[idx] = { ...next[idx], qty, autoQty: 0 };
      return rebalanceMinOrder(next);
    });
  }

  function upsertCartQty(p: Product, qty: number) {
    if (qty <= 0) {
      setCartItems((prev) => rebalanceMinOrder(prev.filter((i) => i.product.id !== p.id)));
      return;
    }
    const best = (catalog ? rankOffersForProduct(catalog, p, userLoc) : [])[0];
    if (!best) return;
    setCartItems((prev) => {
      const idx = prev.findIndex((i) => i.product.id === p.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], qty, autoQty: 0 };
        return rebalanceMinOrder(next);
      }
      return rebalanceMinOrder([...prev, { product: p, offer: best, qty, autoQty: 0 }]);
    });
  }

  // Ngôn ngữ giao diện. User TỰ chọn (lưu vào localStorage 'gqd:lang') được ưu tiên trên
  // mọi auto-detect. Nếu user CHƯA chọn → suy theo quốc gia của vị trí: VN/chưa biết → vi,
  // Mỹ/Canada (và nước khác) → en. User đổi lựa chọn qua toggle VI/EN trên header.
  const [userLang, setUserLang] = useState<Lang | null>(null);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const saved = localStorage.getItem("gqd:lang");
    if (saved === "vi" || saved === "en") setUserLang(saved);
  }, []);
  const lang: Lang = userLang ?? langForCountry(country);
  const setLang = useCallback((l: Lang) => {
    setUserLang(l);
    try { localStorage.setItem("gqd:lang", l); } catch { }
  }, []);
  // Đổi vị trí = tín hiệu cho ngôn ngữ chạy theo nơi mới → xoá lựa chọn thủ công đã ghim,
  // để langForCountry(country) tự áp lại (VN → vi, Mỹ… → en).
  const resetLangToAuto = useCallback(() => {
    setUserLang(null);
    try { localStorage.removeItem("gqd:lang"); } catch { }
  }, []);
  // Hàm dịch ngắn gọn: t("chuỗi VN", { biến }). Thiếu bản dịch → giữ tiếng Việt.
  const t = (vi: string, vars?: Record<string, string | number>) => tr(lang, vi, vars);

  // Cập nhật html[lang] khi user chuyển ngôn ngữ (layout.tsx hardcode "vi" cho SSR).
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  // FIX "lướt không được" (bản CSS, thay cho wheel-listener JS cũ): carousel ngang thiếu
  // overflow-y → Chrome latch lăn dọc. globals.css ép `.overflow-x-auto { overflow-y: hidden }`
  // → wheel dọc chain thẳng lên trang, cuộn chạy trên compositor thread. Listener JS cũ
  // (passive:false + getComputedStyle mỗi tick) trói scroll vào main thread → máy bận là
  // "lướt chút đứng hình" — đã đo 3-4 FPS trên production trước khi gỡ.

  // Tách giá trị tìm kiếm "trễ" khỏi ô nhập: gõ phím cập nhật input tức thì, còn việc
  // lọc/xếp hạng (nặng khi data lớn) chạy ở mức ưu tiên thấp → không giật khi gõ.
  const deferredQuery = useDeferredValue(query);
  const txnnLiveOffer = useMemo<RankedOffer>(() => ({
    productId: "txnn-live-tui-don-ghep",
    storeId: "tuoixanhnhanhngon",
    price: 0,
    inStock: true,
    productUrl: "https://tuoixanhnhanhngon.timdaythay.com/",
    lastChecked: new Date(0).toISOString(),
    distanceKm: null,
    product: {
      id: "txnn-live-tui-don-ghep",
      name: "Túi Đơn Ghép TXNN",
      brand: "Tươi Xanh Nhanh Ngon",
      category: "Thực phẩm",
      group: "Đồ ăn",
      unit: "giỏ",
    },
    store: {
      id: "tuoixanhnhanhngon",
      chain: "tuoixanhnhanhngon",
      name: "Tươi Xanh Nhanh Ngon",
      address: "Website chính thức TXNN",
      website: "https://tuoixanhnhanhngon.timdaythay.com",
      online: true,
    },
  }), []);

  // Đo chiều cao header để ô tìm kiếm dính ngay bên dưới khi cuộn (không cần số cố định).
  const headerRef = useRef<HTMLElement>(null);
  const [headerH, setHeaderH] = useState(0);
  // Đo lại KHI catalog nạp xong: lúc mount đầu (catalog=null) header là bản skeleton
  // KHÔNG gắn ref → nếu chỉ chạy 1 lần, headerH kẹt = 0 và overlay (StoreProductsPage)
  // rơi về top:64 → bị app header cao ~122px che mất nút back + tên cửa hàng.
  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setHeaderH(el.offsetHeight));
    ro.observe(el);
    setHeaderH(el.offsetHeight);
    return () => ro.disconnect();
  }, [catalog]);

  // Đọc lượt xem + lượt mua từ localStorage (chỉ chạy ở client) để xếp "phổ biến / bán chạy".
  useEffect(() => {
    setViewCounts(getViewCounts());
    const cnt: Record<string, number> = {};
    for (const r of getPurchases()) cnt[r.productId] = (cnt[r.productId] ?? 0) + (r.qty || 1);
    setPurchaseCounts(cnt);
  }, []);

  // Khôi phục vị trí đã chọn lần trước (để F5 không bị mất định vị).
  useEffect(() => {
    try {
      const raw = localStorage.getItem("gqd_loc");
      if (!raw) return;
      const saved = JSON.parse(raw) as { loc: Loc; addr?: string; area?: string; country?: string; region?: string };
      if (saved?.loc && typeof saved.loc.lat === "number" && typeof saved.loc.lng === "number") {
        setUserLoc(saved.loc);
        setUserAddr(saved.addr || "Vị trí đã lưu");
        setAreaName(saved.area || "");
        setCountry(saved.country || "");
        setRegion(saved.region || "");
        setGeoState("ok");
        // Vị trí lưu từ trước có thể thiếu `region` (tính năng phân định vùng thêm sau) →
        // suy lại region từ toạ độ để chip vùng hiện đúng mà không cần định vị lại.
        if (!saved.region) {
          reverseGeocode(saved.loc.lat, saved.loc.lng).then((r) => {
            if (r.region) setRegion(r.region);
          });
        }
      }
    } catch {
      // bỏ qua nếu dữ liệu hỏng
    }
  }, []);

  // Lưu lại vị trí mỗi khi thay đổi để giữ qua lần tải trang sau.
  useEffect(() => {
    if (!userLoc) return;
    try {
      localStorage.setItem(
        "gqd_loc",
        JSON.stringify({ loc: userLoc, addr: userAddr, area: areaName, country, region })
      );
    } catch {
      // bỏ qua nếu localStorage không khả dụng
    }
  }, [userLoc, userAddr, areaName, country, region]);

  // Mở chi tiết 1 sản phẩm: chọn nó + ghi nhận lượt xem (cho sắp xếp "phổ biến").
  function openProduct(p: Product) {
    setSelected(p);
    recordView(p.id);
    setViewCounts(getViewCounts());
  }

  // Nạp catalog theo kiểu stale-while-revalidate 2 tầng:
  //   1. Bản đã LƯU TRONG TRÌNH DUYỆT (Cache API, key "gqd-api-v1") → vẽ UI tức thì,
  //      không phải đợi mạng (payload ~6.5MB, TTFB 0.1-1.5s).
  //   2. Song song luôn fetch bản mới → thay state + ghi đè cache cho lần sau.
  // Dùng Cache API thay localStorage vì payload vượt quota 5MB của localStorage.
  useEffect(() => {
    if (_catalogCache) { setDynamicMinOrders(_catalogCache.minOrders ?? null); setRawCatalog(_catalogCache); return; }
    let alive = true;
    let painted = false; // đã vẽ được gì đó (từ cache) chưa — quyết định cách xử lý lỗi mạng
    type CatalogPayload = Catalog & { source?: string };
    const apply = (d: CatalogPayload, fromBrowserCache: boolean) => {
      if (!alive) return;
      const cat = { products: d.products, offers: d.offers, groups: d.groups, danhMucGroups: d.danhMucGroups, priorities: d.priorities, sponsors: d.sponsors, tui: d.tui, mealTitles: d.mealTitles, minOrders: d.minOrders };
      if (!fromBrowserCache) _catalogCache = cat; // bản mạng mới đáng tin để cache in-memory
      setDynamicMinOrders(d.minOrders ?? null);
      setRawCatalog(cat);
      setSource(d.source ?? "");
      painted = true;
    };
    (async () => {
      // Tầng 1: bản lưu trình duyệt (bỏ qua êm nếu Cache API không khả dụng/chưa có bản lưu).
      try {
        if ("caches" in window) {
          const hit = await caches.match("/api/catalog");
          if (hit) apply(await hit.json(), true);
        }
      } catch { /* cache hỏng/không đọc được → chờ bản mạng */ }
      // Tầng 2: bản mới từ mạng (CDN đã có s-maxage nên thường ~100ms).
      try {
        const res = await fetch("/api/catalog");
        const copy = res.clone(); // clone TRƯỚC khi đọc body để còn ghi vào cache
        apply(await res.json(), false);
        try {
          if ("caches" in window && res.ok) {
            const c = await caches.open("gqd-api-v1");
            await c.put("/api/catalog", copy);
          }
        } catch { /* hết quota/private mode → lần sau vẫn chạy đường mạng như cũ */ }
      } catch {
        // Mạng lỗi: nếu đã vẽ từ cache thì giữ nguyên, chưa có gì mới rơi về catalog rỗng.
        if (!painted && alive) setRawCatalog({ products: [], offers: [] });
      }
    })();
    return () => { alive = false; };
  }, []);

  // URL → state (chạy 1 lần sau khi catalog nạp). Slug helpers ánh xạ tên-không-dấu về brand/cat/sản phẩm gốc.
  const pathname = usePathname();
  const router = useRouter();
  const [urlSynced, setUrlSynced] = useState(false);
  useEffect(() => {
    if (!catalog || urlSynced) return;
    const segs = (pathname || "/").split("/").filter(Boolean);
    if (segs.length === 0) { setUrlSynced(true); return; }
    if (segs[0] === "p" && segs[1]) {
      const p = findProductBySlug(catalog, decodeURIComponent(segs[1]));
      if (p) setSelected(p);
    } else if (segs[0] === "nhan" && segs[1]) {
      const raw = decodeURIComponent(segs[1]);
      let brand = findBrandBySlug(catalog, raw);
      // Sponsor (vd "Xmen") có thể không phải brand của bất kỳ sản phẩm nào — fallback theo
      // catalog.sponsors để filter view vẫn mở được dù không có sản phẩm match.
      if (!brand && catalog.sponsors) {
        const sp = catalog.sponsors.find((s) => slugify(s.name) === slugify(raw));
        if (sp) brand = sp.name;
      }
      if (brand) setActiveBrand(brand);
      if (segs[2]) {
        const cat = findCategoryBySlug(catalog, decodeURIComponent(segs[2]));
        if (cat) setActiveCat(cat);
      }
    } else if (segs[0] === "nganh" && segs[1]) {
      // /nganh/<slug> — slug có thể là TỆP (group, từ tab "tệp") hoặc CATEGORY (product.category).
      // Ưu tiên tệp vì đó là cấp nhóm cha (Đồ ăn, Đồ uống, Trang sức…) thường được click từ tile.
      const slug = decodeURIComponent(segs[1]);
      const tep = findGroupBySlug(catalog, slug);
      if (tep) {
        setActiveTep(tep);
      } else {
        const cat = findCategoryBySlug(catalog, slug);
        if (cat) setActiveCat(cat);
      }
    } else {
      // Fallback URL ngắn (không prefix). Hỗ trợ 1–3 segment:
      //   /<slug>                         → thử brand → tệp → category → product
      //   /<tep>/<brand>                  → tệp + brand
      //   /<tep>/<brand>/<cat>            → tệp + brand + category
      // Mỗi segment tự slugify ở find helper nên URL có chữ hoa / có dấu vẫn match.
      const decoded = segs.map((s) => decodeURIComponent(s));
      if (decoded.length === 1) {
        const slug = decoded[0];
        // Thứ tự: CHAIN trước (vd /astrabean = trang chuỗi) → brand → tệp → category → product.
        // Chain ưu tiên vì key chuỗi (astrabean/shopee/bhx…) là định danh cố định, ít trùng;
        // nếu để brand match trước, một brand cùng tên (vd "Astra Bean") sẽ ăn trước và
        // hiện 0 sản phẩm thay vì mở đúng trang chuỗi.
        const chain = findChainBySlug(slug);
        if (chain) {
          setActiveChain(chain);
        } else {
          const brand = findBrandBySlug(catalog, slug);
          if (brand) {
            setActiveBrand(brand);
          } else {
            const tep = findGroupBySlug(catalog, slug);
            if (tep) {
              setActiveTep(tep);
            } else {
              const cat = findCategoryBySlug(catalog, slug);
              if (cat) {
                setActiveCat(cat);
              } else {
                const p = findProductBySlug(catalog, slug);
                if (p) setSelected(p);
              }
            }
          }
        }
      } else if (decoded.length >= 2) {
        const tep = findGroupBySlug(catalog, decoded[0]);
        const brand = findBrandBySlug(catalog, decoded[1]);
        if (tep) setActiveTep(tep);
        if (brand) setActiveBrand(brand);
        if (decoded[2]) {
          const cat = findCategoryBySlug(catalog, decoded[2]);
          if (cat) setActiveCat(cat);
        }
      }
    }
    setUrlSynced(true);
  }, [catalog, pathname, urlSynced]);

  // state → document.title. Khi user mở trang chuỗi / nhãn / danh mục / sản phẩm,
  // tab trình duyệt hiển thị TÊN tương ứng (vd "Astrabean · Affree") thay vì title chung.
  useEffect(() => {
    const brand = region ? `Affree ${region}` : "Affree";
    const BASE = `${brand} — Kết nối mua bán, không thu phí · Tìm gì cũng có, giá hời quanh đây`;
    let name = "";
    if (selected) name = selected.name;
    else if (activeChain) name = `${chainLabel(activeChain)} · Cửa hàng`;
    else if (activeBrand && activeCat) name = `${activeBrand} · ${prettyCat(activeCat)}`;
    else if (activeBrand) name = `${activeBrand} · Nhãn hàng`;
    else if (activeCat) name = prettyCat(activeCat);
    else if (activeTep) name = prettyCat(activeTep);
    else if (query.trim()) name = `${t("Tìm kiếm")}: ${query.trim()}`;
    document.title = name ? `${name} · ${brand}` : BASE;
  }, [selected, activeChain, activeBrand, activeCat, activeTep, query, t, region]);

  // state → URL. Sau khi đã sync ban đầu, mỗi khi selected/activeTep/activeBrand/activeCat đổi → URL mới.
  // Hỗ trợ cả URL ngắn `/<slug>`: nếu pathname hiện tại đã là dạng ngắn HOẶC canonical
  // tương ứng với state, KHÔNG rewrite — giữ nguyên cho user copy URL ngắn đẹp.
  useEffect(() => {
    if (!urlSynced) return;
    let url = "/";
    let shortUrl: string | null = null;
    if (selected) {
      const s = slugify(selected.id || selected.name);
      url = `/p/${s}`;
      shortUrl = `/${s}`;
    } else if (activeTep && activeBrand && activeCat) {
      // Combo 3 cấp chỉ có dạng ngắn /tep/brand/cat (không có canonical).
      url = `/${slugify(activeTep)}/${slugify(activeBrand)}/${slugify(activeCat)}`;
    } else if (activeTep && activeBrand) {
      url = `/${slugify(activeTep)}/${slugify(activeBrand)}`;
    } else if (activeBrand && activeCat) {
      url = `/nhan/${slugify(activeBrand)}/${slugify(activeCat)}`;
    } else if (activeBrand) {
      const s = slugify(activeBrand);
      url = `/nhan/${s}`;
      shortUrl = `/${s}`;
    } else if (activeTep) {
      const s = slugify(activeTep);
      url = `/nganh/${s}`;
      shortUrl = `/${s}`;
    } else if (activeCat) {
      const s = slugify(activeCat);
      url = `/nganh/${s}`;
      shortUrl = `/${s}`;
    } else if (activeChain) {
      // Trang chuỗi: chỉ có dạng ngắn /<chain-slug>.
      url = `/${slugify(activeChain)}`;
    }
    if (pathname !== url && pathname !== shortUrl) router.replace(url, { scroll: false });
  }, [urlSynced, selected, activeTep, activeBrand, activeCat, activeChain, pathname, router]);

  // Nạp cửa hàng vật lý + toạ độ từ tab "stores" (Google Sheet). Lỗi → giữ STORES tĩnh.
  useEffect(() => {
    let url = "/api/stores";
    const params = new URLSearchParams();
    if (userLoc) {
      params.append("lat", String(userLoc.lat));
      params.append("lng", String(userLoc.lng));
      const radMeters = radiusKm ? radiusKm * 1000 : 1000;
      params.append("radius", String(radMeters));
      params.append("limit", "1000");
    }
    if (activeTep) {
      params.append("category", activeTep);
    }
    const queryStr = params.toString();
    if (queryStr) {
      url += `?${queryStr}`;
    }
    fetch(url)
      .then((r) => r.json())
      .then((d: { stores?: Store[] }) => {
        if (d.stores?.length) setRawStores(d.stores);
      })
      .catch(() => { });
  }, [userLoc, radiusKm, activeTep]);

  // Region scope cho CSKD (áp dụng MỌI vùng): đã định vị trong VN (region != "") + có toạ độ
  // → chỉ giữ store offline NẰM TRONG VÙNG quanh vị trí user (box ~REGION_RADIUS_DEG) + online stores.
  // Online store cross-region (shopee/grab/pnj…) luôn giữ để giỏ hàng đa kênh không vỡ.
  // (Store chỉ có lat/lng, địa chỉ không ghi tỉnh ổn định → lọc theo box toạ độ thay vì tên tỉnh.)
  useEffect(() => {
    if (!rawStores) return;
    const REGION_RADIUS_DEG = 0.6; // ~66km mỗi chiều quanh vị trí user (chỉnh được)
    const inRegionBox = (s: Store) =>
      s.lat != null && s.lng != null && userLoc != null &&
      Math.abs(s.lat - userLoc.lat) <= REGION_RADIUS_DEG &&
      Math.abs(s.lng - userLoc.lng) <= REGION_RADIUS_DEG;
    const scoped = region && userLoc
      ? rawStores.filter((s) => s.online || inRegionBox(s))
      : rawStores;
    setDynamicStores(scoped);
    setStoresReady((v) => v + 1);
  }, [rawStores, region, userLoc]);

  // Region scope cho catalog (áp dụng MỌI vùng): bám theo store còn lại sau scope → offer +
  // sản phẩm bám theo CSKD trong vùng. Mục tiêu "Giảm tải dữ liệu" (Miro Affree 26/06/2026).
  useEffect(() => {
    if (!rawCatalog) { setCatalog(null); return; }
    if (!region) { setCatalog(rawCatalog); return; }
    // Store còn lại sau scope (vật lý trong vùng + online đã nạp). getStores() = dynamicStores,
    // KHÔNG chứa nguồn online "ảo" (TDAT/PNJ/shopee…) nên không thể chỉ dựa vào nó để giữ offer online.
    const allowedStoreIds = new Set(getStores().map((s) => s.id));
    // Toàn bộ store VẬT LÝ (trước scope) — để phân biệt "vật lý ngoài vùng" (bỏ) với
    // "id lạ = nguồn online cross-region" (giữ, đúng chủ đích: giỏ đa kênh không vỡ).
    const rawPhysicalIds = new Set((rawStores ?? []).map((s) => s.id));
    const offers = rawCatalog.offers.filter((o) => {
      if (allowedStoreIds.has(o.storeId)) return true;   // trong vùng (hoặc online đã nạp)
      if (rawPhysicalIds.has(o.storeId)) return false;   // cửa hàng vật lý ngoài vùng → bỏ
      return true;                                       // id không tra được = nguồn online (TDAT/PNJ…) → giữ
    });
    const keepProductIds = new Set(offers.map((o) => o.productId));
    const products = rawCatalog.products.filter((p) => keepProductIds.has(p.id));
    setCatalog({ ...rawCatalog, products, offers });
  }, [rawCatalog, region, storesReady, rawStores]);

  // Tự tìm địa chỉ khi gõ (debounce 400ms) — không cần bấm "Tìm".
  useEffect(() => {
    const q = addrQuery.trim();
    if (q.length < 3) {
      setAddrResults([]);
      setAddrSearched(false);
      setAddrSearching(false);
      return;
    }
    setAddrSearching(true);
    let cancelled = false;
    forwardGeocode(q).then((results) => {
      if (cancelled) return;
      setAddrResults(results);
      setAddrSearching(false);
      setAddrSearched(true);
    });
    return () => { cancelled = true; setAddrSearching(false); };
  }, [addrQuery]);

  // Khi mở chi tiết sản phẩm hoặc quay lại danh sách → cuộn lên đầu trang + nạp lại
  // trạng thái đăng ký báo giá (đã đăng ký món này trên thiết bị chưa).
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
    setAlertOpen(false);
    setMyAlert(selected ? getAlertForProduct(selected.id) : null);
  }, [selected]);

  // Chuyển trang phân trang → cuộn lên đầu để xem từ sản phẩm đầu tiên.
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [page]);

  // Khoá cuộn nền khi có popup mở: giữ nguyên vị trí cuộn bằng position:fixed
  // (chạy cả iOS Safari lẫn desktop) → lướt trong popup thì nền KHÔNG di chuyển.
  const anyModalOpen =
    locOpen || verOpen || alertOpen || contactOpen || cartOpen || !!infoProduct || !!buyProduct || !!buyOffer;
  useEffect(() => {
    const body = document.body;
    if (!anyModalOpen) {
      // Safeguard: nếu body vẫn bị lock dù modal đã đóng → tháo lock
      if (body.style.position === "fixed") {
        const lockedTop = parseInt(body.style.top || "0", 10);
        body.style.position = "";
        body.style.top = "";
        body.style.left = "";
        body.style.right = "";
        body.style.width = "";
        body.style.overflow = "";
        window.scrollTo(0, -lockedTop);
      }
      return;
    }
    const scrollY = window.scrollY;
    const prev = {
      position: body.style.position,
      top: body.style.top,
      left: body.style.left,
      right: body.style.right,
      width: body.style.width,
      overflow: body.style.overflow,
    };
    body.style.position = "fixed";
    body.style.top = `-${scrollY}px`;
    body.style.left = "0";
    body.style.right = "0";
    body.style.width = "100%";
    body.style.overflow = "hidden";
    return () => {
      body.style.position = prev.position;
      body.style.top = prev.top;
      body.style.left = prev.left;
      body.style.right = prev.right;
      body.style.width = prev.width;
      body.style.overflow = prev.overflow;
      window.scrollTo(0, scrollY);
    };
  }, [anyModalOpen]);

  // Nút "lên đầu trang": chỉ hiện khi đã kéo xuống đủ xa.
  const [showTop, setShowTop] = useState(false);
  useEffect(() => {
    const onScroll = () => setShowTop(window.scrollY > 400);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const [cskdTaxonomy, setCskdTaxonomy] = useState<CskdCategory[] | undefined>(undefined);
  const [cskdStores, setCskdStores] = useState<Store[]>([]);
  useEffect(() => {
    fetch("/api/loai-cskd")
      .then((r) => r.json())
      .then((d) => { if (d.taxonomy?.length) setCskdTaxonomy(d.taxonomy); })
      .catch(() => {});
    fetch("/api/cskd-stores")
      .then((r) => r.json())
      .then((d) => { if (d.stores?.length) setCskdStores(d.stores); })
      .catch(() => {});
  }, []);

  // loaiCskd đại diện theo CHAIN (lấy từ cskdStores) — để gán cho cửa hàng offer trên map
  // so sánh giá, giúp chú thích hiển thị cây danh mục CSKD giống trang chủ.
  const cskdByChain = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const s of cskdStores) {
      if (s.loaiCskd?.length && !m.has(s.chain)) m.set(s.chain, s.loaiCskd);
    }
    return m;
  }, [cskdStores]);

  function locate() {
    if (!navigator.geolocation) {
      setGeoState("error");
      setToast(t("Trình duyệt không hỗ trợ định vị. Hãy nhập địa chỉ."));
      setTimeout(() => setToast(""), 4000);
      return;
    }
    setGeoState("locating");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        setUserLoc({ lat, lng });
        setUserAddr(t("Vị trí hiện tại"));
        setAreaName("");
        setGeoState("ok");
        setLocOpen(false);
        setMapOpen(true); // có vị trí → mở bản đồ dưới search
        setToast(t("Đã cập nhật vị trí hiện tại"));
        setTimeout(() => setToast(""), 3000);
        reverseGeocode(lat, lng).then((r) => {
          if (r.label) setUserAddr(r.label);
          if (r.area) setAreaName(r.area);
          setCountry(r.cc);
          setRegion(r.region);
          resetLangToAuto();
        });
      },
      (err) => {
        setGeoState("error");
        setToast(
          err.code === err.PERMISSION_DENIED
            ? t("Trình duyệt đang chặn quyền vị trí. Mở khoá định vị cho trang hoặc nhập địa chỉ bên dưới.")
            : t("Không lấy được vị trí GPS. Hãy thử lại hoặc nhập địa chỉ.")
        );
        setTimeout(() => setToast(""), 5000);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  }

  async function searchAddress() {
    const q = addrQuery.trim();
    if (q.length < 3) return;
    setAddrSearching(true);
    setAddrSearched(false);
    const results = await forwardGeocode(q);
    setAddrResults(results);
    setAddrSearching(false);
    setAddrSearched(true);
  }

  function pickAddress(r: GeoResult) {
    setUserLoc({ lat: r.lat, lng: r.lng });
    setUserAddr(r.label);
    setAreaName(r.area || "");
    setCountry(r.cc || "");
    setRegion(r.region || "");
    resetLangToAuto();
    setGeoState("ok");
    setLocOpen(false);
    setMapOpen(true); // có vị trí → mở bản đồ dưới search
    setAddrResults([]);
    setAddrSearched(false);
    setAddrQuery("");
    setToast(
      tr(langForCountry(r.cc), "Đang xem giá quanh: {area}", {
        area: r.label.split(",").slice(0, 2).join(","),
      })
    );
    setTimeout(() => setToast(""), 3500);
  }

  // Index offers by productId once — avoids O(n×m) per-product scan in priceStats.
  const offersByProductId = useMemo(() => {
    const idx = new Map<string, import("@/lib/types").Offer[]>();
    if (!catalog) return idx;
    for (const o of catalog.offers) {
      if (!idx.has(o.productId)) idx.set(o.productId, []);
      idx.get(o.productId)!.push(o);
    }
    return idx;
  }, [catalog]);

  const priceStats = useMemo(() => {
    const m = new Map<string, { min: number; max: number; stores: number; outOfStock: boolean; currency: string; soleSource: string; soleUrl: string; minChain: string; soleChain: string }>();
    if (!catalog) return m;
    for (const p of catalog.products) {
      const priced = (offersByProductId.get(p.id) ?? []).filter((o) => o.price > 0);
      const inStock = priced.filter((o) => o.inStock);
      if (!inStock.length) {
        // Có giá nhưng tất cả điểm bán đều hết hàng → đánh dấu "hết hàng" (khác "chưa có giá").
        m.set(p.id, { min: 0, max: 0, stores: 0, outOfStock: priced.length > 0, currency: storeCurrency(priced[0]?.storeId), soleSource: "", soleUrl: "", minChain: "", soleChain: "" });
        continue;
      }
      const prices = inStock.map((o) => o.price);
      const minPrice = Math.min(...prices);
      const storeIds = [...new Set(inStock.map((o) => o.storeId))];
      // #17: chỉ 1 nơi bán → đại diện bằng offer rẻ nhất còn hàng (để lấy tên nguồn + link đặt hàng).
      const sole = storeIds.length === 1 ? (inStock.find((o) => o.price === minPrice) ?? inStock[0]) : null;
      m.set(p.id, {
        min: minPrice,
        max: Math.max(...prices),
        stores: storeIds.length,
        outOfStock: false,
        // Tiền tệ của sản phẩm = tiền tệ cửa hàng bán (mỗi sản phẩm chỉ bán ở 1 hệ tiền tệ).
        currency: storeCurrency(inStock[0].storeId),
        // Tên NGUỒN bán: cửa hàng vật lý → nhãn chuỗi; nguồn online (storeId là mã như THXL/TDAT) → dùng mã đó.
        soleSource: sole ? chainLabel(getStore(sole.storeId)?.chain ?? sole.storeId) : "",
        // Link vào TRANG CHỦ web nguồn (origin), không dùng link sâu từng sản phẩm.
        soleUrl: sole ? (homepageOf(sole.productUrl) || homepageOf(getStore(sole.storeId)?.website)) : "",
        // Chain của offer giá thấp nhất — dùng để hiện chú thích "Mua tối thiểu".
        minChain: getStore(inStock.reduce((a, b) => a.price <= b.price ? a : b).storeId)?.chain ?? inStock[0].storeId,
        // Chain key (không phải label) của nguồn sole — dùng để tra chainMinOrder.
        soleChain: sole ? (getStore(sole.storeId)?.chain ?? sole.storeId) : "",
      });
    }
    return m;
  }, [catalog, offersByProductId]);

  // Lọc sản phẩm theo QUỐC GIA của user:
  //  - Sản phẩm có offer ở cửa hàng vật lý trong cùng country → hiện.
  //  - Sản phẩm có offer ở nguồn online (store.online=true) → hiện ở MỌI country.
  //  - User chưa có country (chưa định vị) → hiện tất cả (không lọc).
  const visibleProductIds = useMemo(() => {
    if (!catalog) return null as Set<string> | null;
    const cc = (country || "").toLowerCase();
    if (!cc) return null; // chưa biết country → không lọc
    const ok = new Set<string>();
    for (const o of catalog.offers) {
      const st = getStore(o.storeId);
      // Store không tra được → coi như cross-country (online), hiện ở mọi quốc gia.
      if (!st) { ok.add(o.productId); continue; }
      const sc = storeCountryCode(st);
      // Hiện nếu: nguồn online, không xác định được country (bbox), hoặc trùng country user.
      if (st.online || sc === undefined || sc === cc) ok.add(o.productId);
      // Chỉ FILTER nếu store có country xác định KHÁC user — nhưng product vẫn hiện nếu
      // 1 offer khác của nó qua được điều kiện trên.
    }
    return ok;
  }, [catalog, country]);

  const passCountry = useCallback((id: string) => !visibleProductIds || visibleProductIds.has(id), [visibleProductIds]);

  // Giá trung bình (min/sản phẩm) theo từng nhóm danh mục → để xác định "giá hời" = rẻ hơn mặt bằng.
  const groupAvgMin = useMemo(() => {
    const sum = new Map<string, { total: number; n: number }>();
    if (!catalog) return new Map<string, number>();
    for (const p of catalog.products) {
      const s = priceStats.get(p.id);
      if (!s || s.min <= 0) continue;
      const g = categoryGroup(p);
      const cur = sum.get(g) ?? { total: 0, n: 0 };
      cur.total += s.min;
      cur.n += 1;
      sum.set(g, cur);
    }
    const avg = new Map<string, number>();
    sum.forEach((v, k) => avg.set(k, v.total / v.n));
    return avg;
  }, [catalog, priceStats]);

  const matches = useMemo(() => {
    if (!catalog) return [];
    let list = searchProductsRanked(catalog, deferredQuery);
    // Lọc theo COUNTRY (cửa hàng cùng quốc gia hoặc nguồn online).
    // Khi đang mở "trang cửa hàng" của 1 CHUỖI (vd /astrabean) hoặc "trang nhãn" của 1
    // BRAND (vd /nhan/mencode) → KHÔNG lọc country: user chủ động click nhãn nên muốn
    // thấy đủ sản phẩm của nhãn đó, dù store nằm ở quốc gia khác mình.
    if (!activeChain && !activeBrand) list = list.filter((p) => passCountry(p.id));
    // Lọc 2 cấp lồng nhau: trước theo TỆP (group), rồi theo NGÀNH HÀNG (category) bên trong.
    if (activeTep) list = list.filter((p) => (p.groups && p.groups.includes(activeTep)) || categoryGroup(p) === activeTep);
    if (activeCat) list = list.filter((p) => (p.category || "").trim() === activeCat);
    if (activeBrand) {
      // Case-insensitive: brand trong catalog hay viết HOA (vd "MENCODE", "BEAUTY REPUBLIC")
      // nhưng sponsor / URL slug lại dạng "Mencode" → exact-match miss.
      const abLower = activeBrand.toLowerCase().trim();
      list = list.filter((p) => (p.brand || "").toLowerCase().trim() === abLower);
    }
    if (activeChain) {
      // Sản phẩm thuộc CHUỖI nếu có offer ở 1 cửa hàng có .chain === activeChain.
      const idsAtChain = new Set<string>();
      for (const o of catalog.offers) {
        const st = getStore(o.storeId);
        if (st?.chain === activeChain) idsAtChain.add(o.productId);
      }
      list = list.filter((p) => idsAtChain.has(p.id));
    }
    return list;
  }, [catalog, deferredQuery, activeTep, activeCat, activeBrand, activeChain, passCountry]);

  // % tiết kiệm nếu mua đúng chỗ rẻ nhất (chênh lệch giữa các điểm bán).
  const dealScore = (id: string) => {
    const s = priceStats.get(id);
    if (!s || s.stores < 2 || s.max <= s.min) return 0;
    return (s.max - s.min) / s.max;
  };
  // "🔥 Giá hời quanh đây": các sản phẩm có chênh lệch giá giữa các nơi cao nhất — mua đúng chỗ
  // rẻ nhất là lời nhiều nhất. now = giá rẻ nhất, was = giá cao nhất, save = chênh lệch.
  // Chỉ lấy sp có ≥2 nơi bán còn hàng và chênh ≥5% (mới đáng gọi là "giá hời").
  const areaDeals = useMemo(() => {
    if (!catalog) return [] as {
      product: Product; now: number; was: number; save: number; disc: number; currency: string; storeName: string; storeChain: string; km: number | null;
    }[];
    const storeById = new Map(getStores().map((s) => [s.id, s]));
    const rows = [];
    // #9: khi đang tìm kiếm → "Giá hời" chỉ gợi ý trong KẾT QUẢ liên quan (tham khảo Grab);
    // không tìm → quét toàn bộ catalog như cũ.
    const base = deferredQuery.trim() ? matches : catalog.products;
    for (const p of base) {
      if (!passCountry(p.id)) continue;
      const s = priceStats.get(p.id);
      if (!s || s.outOfStock) continue;
      // Chưa có giá thật (mọi offer = 0đ) → KHÔNG đưa vào "Giá hời" (tránh thẻ "-26% · 0đ ·
      // Tiết kiệm 0đ" trông như lỗi). SP cần giá thật trong catalog mới hiện ở đây.
      if (!s.min || s.min <= 0) continue;
      // Ưu tiên % khuyến mãi từ SHEET (p.discountPct + p.listedPrice) — áp dụng cho cả
      // sản phẩm 1 nơi bán. Fallback so giá max/min giữa nhiều nơi nếu sheet không khai báo.
      // CHỈ nhận sp có discountPct khai báo tường minh trong sheet "giam_gia" (1sZTv) —
      // không tự suy từ max/min giữa nơi bán. Sheet là single source of truth cho mục này.
      if (!p.discountPct || p.discountPct <= 0) continue;
      const disc = p.discountPct;
      const now = s.min;
      const was = p.listedPrice && p.listedPrice > now ? p.listedPrice : Math.round(now / (1 - disc));
      if (disc < 0.05) continue;
      // Điểm bán còn hàng ở GIÁ THẤP NHẤT (min). Nếu đã định vị → chọn nơi giá thấp nhất
      // GẦN nhất; ghi lại khoảng cách để vừa "ưu tiên giá thấp nhất" vừa "ưu tiên gần nhất".
      let bestStore: Store | undefined;
      let bestStoreId: string | undefined; // id nguồn giá thấp nhất (kể cả nguồn online không có store vật lý)
      let bestKm: number | null = null;
      for (const o of catalog.offers) {
        if (o.productId !== p.id || !o.inStock || o.price !== s.min) continue;
        const st = storeById.get(o.storeId);
        const km =
          userLoc && st?.lat != null && st?.lng != null
            ? distanceKm(userLoc, { lat: st.lat, lng: st.lng })
            : null;
        if (!bestStoreId || (km != null && (bestKm == null || km < bestKm))) {
          bestStore = st;
          bestStoreId = o.storeId;
          bestKm = km;
        }
      }
      // Chuỗi của nơi bán rẻ nhất: từ store map, hoặc suy từ prefix id ("bhx-…" → "bhx").
      const dealChain = (bestStore?.chain ?? (bestStoreId ? (getStore(bestStoreId)?.chain ?? bestStoreId.split("-")[0]) : "")) as Chain | "";
      // Nếu offer rẻ nhất KHÔNG map được cửa hàng cụ thể (id lệch danh sách stores) → lấy CHI NHÁNH
      // GẦN NHẤT cùng chuỗi để hiện tên + địa chỉ thật (giá chuỗi đồng nhất nên chi nhánh nào cũng đúng giá).
      let dealStore = bestStore;
      let dealKm = bestKm;
      if (!dealStore && dealChain) {
        const cs = physicalStoresOfChain(dealChain as Chain).filter((s2) => s2.lat != null && s2.lng != null);
        if (cs.length) {
          if (userLoc) {
            dealStore = cs.reduce((a, b) =>
              distanceKm(userLoc, { lat: a.lat as number, lng: a.lng as number }) <=
              distanceKm(userLoc, { lat: b.lat as number, lng: b.lng as number }) ? a : b);
            dealKm = distanceKm(userLoc, { lat: dealStore.lat as number, lng: dealStore.lng as number });
          } else {
            dealStore = cs[0];
          }
        }
      }
      if (userLoc && dealsRadiusKm != null && dealKm != null && dealKm > dealsRadiusKm) continue;
      const dealStoreName = dealStore?.name ?? (dealChain ? chainLabel(dealChain) : "");
      rows.push({
        product: p,
        now,
        was,
        save: was - now,
        disc,
        currency: s.currency,
        storeName: dealStoreName,
        storeChain: dealStore?.chain ?? dealChain,
        km: dealKm,
      });
    }
    // Đã định vị → xếp theo điểm gộp "rẻ + gần" (giá hời cao và càng gần càng tốt);
    // chưa định vị → chỉ theo mức giá hời như cũ.
    if (userLoc) {
      const score = (r: { disc: number; km: number | null }) =>
        r.disc / (1 + (r.km ?? 8) / 2);
      rows.sort((a, b) => score(b) - score(a));
    } else {
      rows.sort((a, b) => b.disc - a.disc);
    }
    // Phân bổ đều cho các TỆP (group): mỗi vòng nhặt 1 sản phẩm có % khuyến mãi cao nhất
    // từ mỗi tệp → lặp tới khi đủ 20 hoặc hết. Nhờ vậy mỗi tệp (Đồ ăn, Đồ uống, Nhà cửa,
    // Chăm sóc cá nhân, Trang sức…) đều có ít nhất 1 đại diện thay vì 1 tệp lấn át hết.
    const byCategory = new Map<string, typeof rows>();
    for (const r of rows) {
      const tep = categoryGroup(r.product) || "Khác";
      if (!byCategory.has(tep)) byCategory.set(tep, []);
      byCategory.get(tep)!.push(r);
    }
    const cats = [...byCategory.keys()];
    const balanced: typeof rows = [];
    let round = 0;
    while (balanced.length < 20) {
      let added = false;
      for (const cat of cats) {
        const list = byCategory.get(cat)!;
        if (round < list.length) {
          balanced.push(list[round]);
          added = true;
          if (balanced.length >= 20) break;
        }
      }
      if (!added) break;
      round++;
    }
    // Sau khi đã đảm bảo phân bổ đều, sắp lại theo % giảm giá LỚN NHẤT trước.
    balanced.sort((a, b) => b.disc - a.disc);
    return balanced;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalog, priceStats, userLoc, storesReady, matches, deferredQuery, dealsRadiusKm]);

  // Dãy chip lọc theo NGÀNH HÀNG (cột "category" trong sheet, vd "Gia vị", "Nước lau sàn"…).
  // Nếu đã chọn TỆP ở trên → chỉ hiện ngành hàng THUỘC tệp đó; chưa chọn tệp → hiện tất cả.
  // Xếp theo số lượng sản phẩm giảm dần.
  // Tổng sản phẩm trong tệp đang chọn (không lọc thêm theo activeCat) — dùng cho parent header.
  const tepTotalCount = useMemo(() => {
    if (!catalog || !activeTep) return 0;
    return catalog.products.filter((p) =>
      (p.groups?.includes(activeTep) || categoryGroup(p) === activeTep) && passCountry(p.id)
    ).length;
  }, [catalog, activeTep, passCountry]);

  const catChips = useMemo(() => {
    if (!catalog) return [] as string[];
    const base = activeTep
      ? catalog.products.filter((p) => categoryGroup(p) === activeTep && passCountry(p.id))
      : catalog.products.filter((p) => passCountry(p.id));
    const count = new Map<string, number>();
    for (const p of base) {
      const c = (p.category || "").trim();
      if (!c) continue;
      count.set(c, (count.get(c) ?? 0) + 1);
    }
    return [...count.keys()].sort((a, b) => (count.get(b) ?? 0) - (count.get(a) ?? 0));
  }, [catalog, activeTep, passCountry]);

  // % rẻ hơn mặt bằng cùng nhóm danh mục (giá hời).
  const cheapScore = (p: Product) => {
    const s = priceStats.get(p.id);
    if (!s || s.min <= 0) return -1;
    const avg = groupAvgMin.get(categoryGroup(p));
    if (!avg) return -1;
    return (avg - s.min) / avg;
  };

  // "Bán chạy khu vực": mỗi khu vực có mức bán chạy GIẢ ĐỊNH khác nhau, ổn định cho từng khu vực.
  // Cộng thêm hành vi thật (lượt mua ×5 + lượt xem) nếu có. Chưa định vị → rỗng (UI mời bật vị trí).
  // KHOÁ khu vực = PHƯỜNG·QUẬN (areaName) nếu reverse-geocode ra được → đổi phường là đổi gu bán chạy;
  // nếu chưa có tên khu vực thì tạm gom theo ô lưới ~1km quanh toạ độ.
  const areaHot = useMemo(() => {
    if (!catalog || !userLoc) return [] as Product[];
    const areaKey = areaName
      ? areaName.trim().toLowerCase()
      : `${userLoc.lat.toFixed(2)},${userLoc.lng.toFixed(2)}`;
    const scored: { p: Product; score: number }[] = [];
    for (const p of catalog.products) {
      if (!passCountry(p.id)) continue;
      const st = priceStats.get(p.id);
      if (!st || st.stores <= 0) continue;
      const realPop = (purchaseCounts[p.id] ?? 0) * 5 + (viewCounts[p.id] ?? 0);
      const areaDemand = seedRand(`${areaKey}|${p.id}`); // 0..1 giả định theo khu vực
      scored.push({ p, score: realPop * 1000 + areaDemand * 100 });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.map((x) => x.p);
  }, [catalog, userLoc, areaName, priceStats, purchaseCounts, viewCounts, passCountry]);

  // Top sản phẩm "bán chạy" để gắn tag: theo khu vực nếu đã định vị, không thì theo phổ biến chung.
  const areaHotTopIds = useMemo(() => {
    if (userLoc && areaHot.length) return new Set(areaHot.slice(0, 12).map((p) => p.id));
    if (!catalog) return new Set<string>();
    return new Set(
      [...catalog.products]
        .filter((p) => passCountry(p.id) && (priceStats.get(p.id)?.stores ?? 0) > 0)
        .sort((a, b) => hotScore(b) - hotScore(a))
        .slice(0, 12)
        .map((p) => p.id)
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userLoc, areaHot, catalog, priceStats, purchaseCounts, viewCounts, passCountry]);

  // Mỗi sản phẩm có những nguồn (chain) nào — dựa trên storeId của offer (mã nguồn, vd "THXL").
  // Dùng để xếp ưu tiên hiển thị theo chuỗi.
  const productChains = useMemo(() => {
    const m = new Map<string, Set<string>>();
    if (!catalog) return m;
    for (const o of catalog.offers) {
      const sid = String(o.storeId).trim().toUpperCase();
      if (!sid) continue;
      let set = m.get(o.productId);
      if (!set) { set = new Set(); m.set(o.productId, set); }
      set.add(sid);
    }
    return m;
  }, [catalog]);

  // Map tệp (nhóm danh mục) → danh sách chuỗi ưu tiên, ghép từ cột "ưu tiên" của tab "tệp"
  // với hồ sơ tương ứng trong tab "ưu tiên hiển thị". Tệp không cấu hình → không có → hiển thị bình thường.
  const priorityByGroup = useMemo(() => {
    const m = new Map<string, string[]>();
    if (!catalog?.groups || !catalog?.priorities) return m;
    const byName = new Map<string, string[]>();
    for (const pr of catalog.priorities) {
      byName.set(pr.name.trim().toLowerCase(), pr.chains.map((c) => c.toUpperCase()).filter(Boolean));
    }
    for (const g of catalog.groups) {
      const profile = (g.priority || "").trim().toLowerCase();
      if (!profile) continue;
      const chains = byName.get(profile);
      if (chains?.length) m.set(g.label, chains);
    }
    return m;
  }, [catalog]);

  // Thứ tự hiển thị: tìm kiếm giữ relevance; còn lại theo bộ lọc nhanh (deal/giá hời/bán chạy)
  // hoặc mặc định "phổ biến" theo lượt xem.
  // Ưu tiên hiển thị: đẩy ~2 hàng đầu là sản phẩm chuỗi THXL (pinThxlTop), phần còn lại
  // giữ nguyên. Áp cho TẤT CẢ chế độ: bộ lọc nhanh (deal/giá hời/bán chạy), lọc theo tệp,
  // và trang chủ. Tệp nào có hồ sơ ưu tiên riêng trong sheet thì dùng hồ sơ đó (pinByChains).
  const orderedMatches = useMemo(() => {
    if (deferredQuery) return matches;
    const list = [...matches];
    if (quickFilter === "deal") {
      return pinThxlTop(list.filter((p) => dealScore(p.id) > 0).sort((a, b) => dealScore(b.id) - dealScore(a.id)));
    }
    if (quickFilter === "cheap") {
      return pinThxlTop(list.filter((p) => cheapScore(p) > 0).sort((a, b) => cheapScore(b) - cheapScore(a)));
    }
    if (quickFilter === "hot") {
      // Bán chạy theo KHU VỰC định vị (không phải đề xuất chung).
      return pinThxlTop(areaHot);
    }
    if (activeTep || activeCat) {
      const prof = activeTep ? priorityByGroup.get(activeTep) : undefined;
      return prof ? pinByChains(matches, prof) : pinThxlTop(matches);
    }
    list.sort((a, b) => (viewCounts[b.id] ?? 0) - (viewCounts[a.id] ?? 0));
    return pinThxlTop(list);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matches, deferredQuery, activeTep, activeCat, quickFilter, viewCounts, purchaseCounts, priceStats, groupAvgMin, productChains, priorityByGroup, areaHot]);

  // Chuỗi cửa hàng "đang chiếm sóng" trong list đang xem: đếm sp theo chain (qua offer →
  // store → chain), trả về chain nào có ≥60% sp. Dùng để hiển thị "Bán tại: X" dưới tiêu đề
  // (vd vào "Đồ uống" mà toàn sp từ Circle K → ghi rõ Circle K). Trả null khi đa chuỗi/ít sp.
  const dominantChain = useMemo<string | null>(() => {
    if (!catalog || orderedMatches.length < 2 || activeChain) return null;
    const count: Record<string, number> = {};
    for (const p of orderedMatches) {
      const chainsForP = new Set<string>();
      // Tra qua index offersByProductId (O(offers của riêng p)) thay vì quét toàn bộ
      // catalog.offers cho TỪNG sản phẩm — trước đây O(n×m) ~11,5 triệu vòng gây đứng hình.
      for (const o of offersByProductId.get(p.id) ?? []) {
        const st = getStore(o.storeId);
        if (st?.chain) chainsForP.add(st.chain);
      }
      chainsForP.forEach((c) => { count[c] = (count[c] ?? 0) + 1; });
    }
    let best: string | null = null;
    let bestN = 0;
    for (const [c, n] of Object.entries(count)) if (n > bestN) { best = c; bestN = n; }
    return best && bestN / orderedMatches.length >= 0.6 ? best : null;
  }, [catalog, orderedMatches, activeChain, offersByProductId]);

  // Hash chuỗi → [0,1): tạo "mức bán chạy" giả định ổn định theo (khu vực + sản phẩm).
  function seedRand(str: string): number {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0) / 4294967295;
  }

  // Hạng ưu tiên của 1 sản phẩm theo danh sách chuỗi: vị trí (nhỏ nhất) của chuỗi mà sp có bán.
  // Không thuộc chuỗi nào → -1 (xếp sau).
  function chainRank(pid: string, chains: string[]): number {
    if (!chains.length) return -1;
    const set = productChains.get(pid);
    if (!set) return -1;
    for (let i = 0; i < chains.length; i++) if (set.has(chains[i])) return i;
    return -1;
  }

  // Xếp ưu tiên hiển thị theo CHUỖI: nhóm sản phẩm theo hạng chuỗi (chains[0] trước chains[1]…),
  // giữ nguyên thứ tự tương đối trong từng nhóm; sản phẩm không thuộc chuỗi nào xếp cuối.
  // chains rỗng → giữ nguyên (hiển thị bình thường).
  function pinByChains(items: Product[], chains: string[]): Product[] {
    if (!chains.length) return items;
    const buckets: Product[][] = chains.map(() => []);
    const rest: Product[] = [];
    for (const p of items) {
      const rank = chainRank(p.id, chains);
      if (rank < 0) rest.push(p);
      else buckets[rank].push(p);
    }
    return [...buckets.flat(), ...rest];
  }

  // Đẩy tối đa ~2 hàng sản phẩm chuỗi THXL lên đầu (PIN_THXL_TOP, lưới tối đa 4 cột → 8 sp),
  // phần còn lại GIỮ NGUYÊN thứ tự. Đơn giản hơn pinByChains: chỉ THXL, không xếp hạng TDAT.
  function pinThxlTop(items: Product[]): Product[] {
    const pinned: Product[] = [];
    const rest: Product[] = [];
    for (const p of items) {
      if (pinned.length < PIN_THXL_TOP && (productChains.get(p.id)?.has("THXL") ?? false)) {
        pinned.push(p);
      } else {
        rest.push(p);
      }
    }
    return pinned.length ? [...pinned, ...rest] : items;
  }

  // Điểm "bán chạy": lượt mua (×5) + lượt xem + độ phủ điểm bán (proxy phổ biến, không bịa số).
  // Khai báo dạng function (được hoist) để useMemo phía trên gọi được mà không bị lỗi TDZ.
  function hotScore(p: Product) {
    return (
      (purchaseCounts[p.id] ?? 0) * 5 +
      (viewCounts[p.id] ?? 0) +
      (priceStats.get(p.id)?.stores ?? 0) * 0.4
    );
  }

  // Gắn tag tự động cho mỗi sản phẩm: Deal hời (chênh giá nhiều) · Giá hời (rẻ hơn mặt bằng) · Bán chạy.
  const recoTags = useMemo(() => {
    const m = new Map<string, { key: string; label: string; cls: string }[]>();
    if (!catalog) return m;
    for (const p of catalog.products) {
      const tags: { key: string; label: string; cls: string }[] = [];
      const d = dealScore(p.id);
      if (d >= 0.15)
        tags.push({ key: "deal", label: t("-{x}%", { x: Math.round(d * 100) }), cls: "bg-rose-600 text-white" });
      const c = cheapScore(p);
      if (c >= 0.1) tags.push({ key: "cheap", label: t("Giá hời"), cls: "bg-emerald-600 text-white" });
      if (areaHotTopIds.has(p.id)) tags.push({ key: "hot", label: t("Bán chạy"), cls: "bg-amber-500 text-white" });
      if (tags.length) m.set(p.id, tags.slice(0, 2));
    }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalog, priceStats, groupAvgMin, viewCounts, purchaseCounts, areaHotTopIds, lang]);

  const totalPages = Math.max(1, Math.ceil(orderedMatches.length / PAGE_SIZE));
  const pageItems = useMemo(
    () => orderedMatches.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [orderedMatches, page]
  );

  // Nhóm sản phẩm theo tệp — dùng cho layout section ở trang chủ (không search/filter).
  // CHỈ hiển thị section khai báo trong tab DanhMuc của Google Sheet. Sản phẩm rơi vào
  // tệp không có trong DanhMuc (vd "Khác" tự sinh do group trống/không match) → bị ẨN
  // khỏi homepage để config là source of truth. Vẫn tìm/lọc được qua search.
  const groupSections = useMemo(() => {
    if (!catalog) return [] as { name: string; emoji?: string; displayName?: string; products: Product[] }[];
    const byGroup = new Map<string, Product[]>();
    for (const p of orderedMatches) {
      // Hỗ trợ multi-group: 1 sản phẩm có thể nằm trong nhiều tệp (vd vừa "Giỏ tạp hóa"
      // vừa "Worldcup"). Nếu `groups` có nhiều phần tử → thêm vào TỪNG tệp.
      const gs = p.groups && p.groups.length ? p.groups : [categoryGroup(p) || "Khác"];
      for (const g of gs) {
        if (!byGroup.has(g)) byGroup.set(g, []);
        byGroup.get(g)!.push(p);
      }
    }
    // Bottom sections lấy tệp từ tab DanhMuc — KHÔNG dùng `catalog.groups`
    // (vốn là cấu hình top tiles, sheet khác). Tách 2 nguồn cho 2 mục đích riêng.
    //
    // CẤU HÌNH HIỂN THỊ TỪ SHEET DanhMuc:
    //  - Cột "Thứ tự ưu tiên" (C): số NHỎ hiện TRƯỚC; trống/0/NaN → đứng cuối,
    //    giữ thứ tự nhập trong sheet.
    //  - Cột "Hiện" (D): ô là "Ẩn" → KHÔNG render trên homepage (sản phẩm vẫn tìm
    //    được qua search, chỉ ẩn khỏi danh sách tệp).
    //  - Sự kiện (vd World Cup) đặt số 1 ở cột C để nhảy lên đầu.
    const allGroups = (catalog.danhMucGroups ?? catalog.groups ?? []).filter((g) => !g.link);
    // TẤT CẢ section luôn hiện (chỉ ẩn nếu cột "Hiện"=Ẩn). Việc đổi tên theo giờ chỉ tác động
    // tới TITLE hiển thị của "Đồ ăn" (pickMealTitle bên dưới), KHÔNG ẩn section nào theo giờ.
    const visibleGroups = allGroups.filter((g) => !g.hidden);
    const sortedGroups = visibleGroups
      .map((g, i) => ({ g, i }))
      .sort((a, b) => {
        // order undefined → đẩy về cuối; trong cùng nhóm có/không order, giữ thứ tự gốc.
        const ao = a.g.order;
        const bo = b.g.order;
        if (ao != null && bo != null) return ao - bo;
        if (ao != null) return -1;
        if (bo != null) return 1;
        return a.i - b.i;
      })
      .map((x) => x.g);
    // So khớp CASE-INSENSITIVE giữa label sheet và bucket sản phẩm: sheet ghi "khác"
    // (k thường), bucket nội bộ rơi vào "Khác" (K hoa) do fallback. Nếu strict-match,
    // tệp sheet sẽ không render dù có sản phẩm. Build map lower-case 1 lần để lookup nhanh.
    const byGroupCI = new Map<string, Product[]>();
    byGroup.forEach((v, k) => byGroupCI.set(k.toLowerCase(), v));
    // User mong đợi: thêm dòng mới vào sheet → thấy NGAY trên web kể cả chưa có sản phẩm.
    // Vì vậy KHÔNG lọc bỏ tệp rỗng; thay vào đó trả về `products: []` để layer render
    // hiển thị placeholder "Chưa có sản phẩm" thay vì ẩn section.
    const ordered: { name: string; emoji?: string; displayName?: string; products: Product[] }[] = [];
    for (const g of sortedGroups) {
      const products = byGroupCI.get(g.label.toLowerCase()) ?? [];
      // Tên + emoji section lấy TỪ GOOGLE SHEET (tab DanhMuc) — giữ nguyên `name`/`emoji`.
      // RIÊNG "Đồ ăn" đổi tên theo BUỔI ĂN lấy từ sheet buổi-ăn (đã có sẵn VI+EN → chọn theo
      // lang, không qua i18n); emoji vẫn giữ của sheet. SSR/sheet lỗi → giữ tên gốc "Đồ ăn".
      let displayName: string | undefined;
      if (isFoodSection(g.label) && hourOfDay !== null && catalog.mealTitles?.length) {
        const m = pickMealTitle(catalog.mealTitles, hourOfDay);
        if (m) displayName = lang === "en" ? m.en : m.vi;
      }
      ordered.push({ name: g.label, emoji: g.emoji, displayName, products });
    }
    return ordered;
  }, [catalog, orderedMatches, hourOfDay, lang]);

  // Danh mục túi ghép/đôi/đa dạng — nhận diện để render TÚI thay vì sản phẩm lẻ.
  const TUI_CAT_RE = /túi ghép|túi đôi|túi.*đa dạng/i;
  const isTuiActive = !!activeTep && TUI_CAT_RE.test(activeTep) && !!catalog?.tui?.length;
  // Đang xem trang "Xem tất cả" của Nhạc bản quyền (activeTep) → render Khúc Chạm Plaza đầy đủ.
  const isMusicActive = !!activeTep && /nhạc bản quyền|nhac ban quyen/i.test(activeTep);
  const loaiLabel = (l: string) => (l === "T2" ? t("Túi đôi") : l === "TĐD" ? t("Túi đa dạng") : t("Túi ghép"));
  // Giá combo: dùng giaCombo nếu sheet có; nếu trống (vd nguồn SanPham) → cộng giá thành viên từ catalog.
  const tuiCombo = (tu: import("@/lib/types").Tui) =>
    tu.giaCombo || tu.items.reduce((s, it) => s + (it.gia || priceStats.get(it.productId)?.min || 0), 0);

  // Đổi tìm kiếm / danh mục / lọc nhanh → quay về trang 1.
  useEffect(() => {
    setPage(1);
  }, [query, activeTep, activeCat, quickFilter]);

  // Mở danh mục / lọc nhanh (vd bấm "Xem tất cả") → cuộn LÊN ĐẦU để xem danh sách từ trên.
  // Cuộn tức thì NGAY + lặp lại sau khi layout đổi (group sections ẩn → lưới hiện, ảnh tải)
  // để không bị kẹt ở giữa/cuối trang như khi dùng smooth.
  useEffect(() => {
    if (!(activeTep || activeCat || quickFilter)) return;
    window.scrollTo(0, 0);
    const r = requestAnimationFrame(() => window.scrollTo(0, 0));
    const t = setTimeout(() => window.scrollTo(0, 0), 120);
    return () => { cancelAnimationFrame(r); clearTimeout(t); };
  }, [activeTep, activeCat, quickFilter]);

  const allOffers = useMemo(
    () => (catalog && selected ? rankOffersForProduct(catalog, selected, userLoc) : []),
    // storesReady: tính lại sau khi nạp toạ độ cửa hàng từ sheet.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [catalog, selected, userLoc, storesReady]
  );

  // Offer trong bán kính — online (store.online=true) luôn giữ; physical phải có distanceKm ≤ radiusKm.
  // radiusKm=null → không lọc.
  const offers = useMemo(
    () => radiusKm == null
      ? allOffers
      : allOffers.filter((o) => o.store.online || (o.distanceKm != null && o.distanceKm <= radiusKm)),
    [allOffers, radiusKm]
  );
  const cheapest = cheapestInStock(offers);

  const maxInStock = useMemo(
    () => offers.filter((o) => o.inStock).reduce((m, o) => Math.max(m, o.price), 0),
    [offers]
  );

  const displayOffers = useMemo(() => {
    if (sortBy === "distance" && userLoc) {
      return [...offers].sort((a, b) => {
        if (a.inStock !== b.inStock) return a.inStock ? -1 : 1;
        return (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity);
      });
    }
    return offers;
  }, [offers, sortBy, userLoc]);

  // Cửa hàng gần nhất (còn hàng, có khoảng cách) — để gắn tag "Gần nhất" khi sắp theo "Gần".
  const nearestStoreId = useMemo(() => {
    if (!userLoc) return null;
    const near = offers
      .filter((o) => o.inStock && o.distanceKm != null)
      .sort((a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity))[0];
    return near?.storeId ?? null;
  }, [offers, userLoc]);

  // Sản phẩm tương tự: ưu tiên dùng cấu hình từ tab "tương tự" trong sheet;
  // fallback → cùng nhóm danh mục, ưu tiên loại đang có giá.
  const similar = useMemo(() => {
    if (!catalog || !selected) return [] as Product[];

    // Tìm nhóm sheet khớp với sản phẩm đang xem (so ID trước, rồi tên không phân biệt hoa thường)
    const sg = catalog.similarGroups?.find((g) =>
      g.products.some(
        (s) =>
          s.toLowerCase() === selected.id.toLowerCase() ||
          selected.name.toLowerCase().includes(s.toLowerCase()) ||
          s.toLowerCase().includes(selected.name.toLowerCase()),
      ),
    );

    if (sg) {
      // Lấy các sản phẩm trong cùng nhóm, bỏ chính nó
      const norm = (s: string) => s.toLowerCase();
      return catalog.products
        .filter(
          (p) =>
            p.id !== selected.id &&
            sg.products.some(
              (s) =>
                norm(s) === norm(p.id) ||
                p.name.toLowerCase().includes(norm(s)) ||
                norm(s).includes(p.name.toLowerCase()),
            ),
        )
        .sort((a, b) => {
          const sa = (priceStats.get(a.id)?.stores ?? 0) > 0 ? 1 : 0;
          const sb = (priceStats.get(b.id)?.stores ?? 0) > 0 ? 1 : 0;
          return sb - sa;
        })
        .slice(0, 10);
    }

    // Fallback: cùng nhóm danh mục
    const g = categoryGroup(selected);
    return catalog.products
      .filter((p) => p.id !== selected.id && categoryGroup(p) === g)
      .sort((a, b) => {
        const sa = (priceStats.get(a.id)?.stores ?? 0) > 0 ? 1 : 0;
        const sb = (priceStats.get(b.id)?.stores ?? 0) > 0 ? 1 : 0;
        return sb - sa;
      })
      .slice(0, 10);
  }, [catalog, selected, priceStats]);

  const center: [number, number] = userLoc && userLoc.lat ? [userLoc.lat, userLoc.lng] : HCM_CENTER;
  // Vị trí map user đang xem (pan/zoom tay trên homepage map) → sync sang product map.
  const [mapView, setMapView] = useState<[number, number] | null>(null);
  const syncedCenter: [number, number] = mapView ?? center;

  const markers: MapMarker[] = useMemo(() => {
    if (selected && offers.length) {
      return offers.map((o) => ({
        // Gán loaiCskd theo chain (nếu store chưa có) → chú thích map hiện cây danh mục như trang chủ.
        store: o.store.loaiCskd?.length ? o.store : { ...o.store, loaiCskd: cskdByChain.get(o.store.chain) },
        price: o.price,
        inStock: o.inStock,
        cheapest: cheapest?.storeId === o.storeId,
        nearest: nearestStoreId === o.storeId,
      }));
    }
    // Khi đang ở CSKD mode (có taxonomy), dùng cskdStores để marker có loaiCskd
    let stores = (cskdTaxonomy && cskdStores.length > 0) ? cskdStores : getStores();
    // Lọc theo QUỐC GIA: store nằm ngoài quốc gia user đang đứng → ẩn khỏi map.
    if (country && country !== "vn") {
      stores = stores.filter((s) => {
        if (s.lat == null || s.lng == null) return false;
        const inVN = s.lat >= 8 && s.lat <= 23.5 && s.lng >= 102 && s.lng <= 110;
        return !inVN;
      });
    }
    if (radiusKm != null && userLoc) {
      stores = stores.filter((s) =>
        s.lat != null && s.lng != null
          ? distanceKm(userLoc, { lat: s.lat, lng: s.lng }) <= radiusKm
          : false,
      );
    }
    return stores.map((s) => ({ store: s }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, offers, cheapest, nearestStoreId, radiusKm, userLoc, country, storesReady, cskdTaxonomy, cskdStores, cskdByChain]);

  // Bấm "Vào mua hàng" → mở web cửa hàng đồng thời ghi nhận 1 lượt mua.
  async function recordBuy(o: RankedOffer, note?: string) {
    setToast(t("Đã ghi nhận mua {product} tại {store}", { product: o.product.name, store: o.store.name }));
    setTimeout(() => setToast(""), 3500);
    await addPurchase({
      productId: o.product.id,
      productName: o.product.name,
      storeId: o.store.id,
      storeName: o.store.name,
      chain: o.store.chain,
      qty: 1,
      unitPrice: o.price,
      buyerLat: userLoc?.lat,
      buyerLng: userLoc?.lng,
      buyerAddr: userAddr || undefined,
      buyerNote: note?.trim() || undefined,
    });
  }

  // "Có so sánh giá" = bán ở ≥2 nơi (có cái để so). Còn lại (1 nguồn / chưa có giá) → "Vào mua".
  const canCompare = (p: Product) => (priceStats.get(p.id)?.stores ?? 0) >= 2;

  // Mở thẳng popup "trợ lý đặt hàng" (OrderAgentModal) cho 1 sản phẩm: chọn offer
  // rẻ nhất còn hàng (fallback: offer đầu / form liên hệ nếu chưa có giá).
  function openBuyAgent(p: Product) {
    if (!catalog) return;
    const ranked = rankOffersForProduct(catalog, p, userLoc);
    const best = cheapestInStock(ranked) ?? ranked[0];
    if (best) setBuyOffer(best);
    else openBuyForm(p);
  }

  // Mở form đặt mua cho sản phẩm không so sánh được giá; điền sẵn địa chỉ đã định vị.
  function openBuyForm(p: Product, store?: Store) {
    setBuyProduct(p);
    setBuyStore(store ?? null);
    setBuyName("");
    setBuyPhone("");
    setBuyAddr(userAddr || "");
    setBuyQty(1);
    setBuyNote("");
  }

  // Gửi đơn đặt mua: kiểm tra tối thiểu (tên + SĐT), ghi nhận kèm thông tin liên hệ.
  async function submitBuy() {
    if (!buyProduct) return;
    const name = buyName.trim();
    const phone = buyPhone.trim();
    if (name.length < 2) {
      setToast(t("Vui lòng nhập họ tên người nhận"));
      setTimeout(() => setToast(""), 3000);
      return;
    }
    if (phone.length < 8) {
      setToast(t("Vui lòng nhập số điện thoại / Zalo hợp lệ"));
      setTimeout(() => setToast(""), 3000);
      return;
    }
    setBuySubmitting(true);
    // Ưu tiên cửa hàng chọn từ popup bản đồ; nếu không có thì lấy offer rẻ nhất sẵn có.
    const off = buyStore
      ? catalog?.offers.find((o) => o.productId === buyProduct.id && o.storeId === buyStore.id)
      : catalog?.offers.find((o) => o.productId === buyProduct.id && o.price > 0);
    const unitPrice =
      off?.price || priceStats.get(buyProduct.id)?.min || 0;
    try {
      await addPurchase({
        productId: buyProduct.id,
        productName: buyProduct.name,
        storeId: buyStore?.id ?? off?.storeId ?? "other",
        storeName: buyStore?.name ?? (off ? chainLabel(off.storeId) : "Affree"),
        chain: buyStore?.chain ?? off?.storeId ?? "other",
        qty: buyQty,
        unitPrice,
        buyerName: name,
        buyerPhone: phone,
        buyerAddr: buyAddr.trim() || userAddr || undefined,
        buyerNote: buyNote.trim() || undefined,
        buyerLat: userLoc?.lat,
        buyerLng: userLoc?.lng,
      });
    } finally {
      setBuySubmitting(false);
    }
    const productName = buyProduct.name;
    setBuyProduct(null);
    setBuyStore(null);
    setToast(t("Đã gửi yêu cầu mua {product} — shop sẽ liên hệ bạn sớm.", { product: productName }));
    setTimeout(() => setToast(""), 4000);
  }

  // Đăng ký "báo giá giảm" cho sản phẩm đang xem → lưu lead (SĐT + món + giá hiện tại).
  // Phản hồi TỨC THÌ: lưu localStorage + báo thành công ngay, việc đẩy lên Google Sheet
  // chạy nền (addAlert không await) để người dùng không phải đợi round-trip Apps Script.
  function submitAlert() {
    if (!selected) return;
    const phone = alertPhone.trim();
    if (phone.length < 8) {
      setToast(t("Vui lòng nhập số điện thoại/Zalo hợp lệ"));
      setTimeout(() => setToast(""), 3000);
      return;
    }
    // Sửa lại = xoá đăng ký cũ rồi tạo mới (giữ localStorage gọn, 1 món 1 đăng ký).
    if (myAlert) removeAlert(myAlert.id);
    void addAlert({
      phone,
      productId: selected.id,
      productName: selected.name,
      priceAtSignup: cheapest?.price ?? 0,
    });
    // addAlert ghi localStorage đồng bộ trước khi gọi mạng → đọc lại được ngay.
    setMyAlert(getAlertForProduct(selected.id));
    setAlertOpen(false);
    setAlertPhone("");
    setToast(t("Đã đăng ký báo giá cho {product}", { product: selected.name }));
    setTimeout(() => setToast(""), 3500);
  }

  // Xoá đăng ký báo giá của món đang xem (chỉ trên thiết bị này).
  function deleteAlert() {
    if (!myAlert) return;
    removeAlert(myAlert.id);
    setMyAlert(null);
    setAlertOpen(false);
    setAlertPhone("");
    setToast(t("Đã huỷ đăng ký báo giá"));
    setTimeout(() => setToast(""), 3000);
  }

  // Mở form để sửa lại SĐT đã đăng ký (điền sẵn số cũ).
  function openEditAlert() {
    setAlertPhone(myAlert?.phone ?? "");
    setAlertOpen(true);
  }

  // Lưới dịch vụ = Đi chợ + các ô DANH MỤC tạo động từ Google Sheet + dịch vụ ngoài.
  const services = useMemo<ServiceTile[]>(() => {
    // Ưu tiên cấu hình từ tab "tệp" (Google Sheet) — gồm cả ô lọc lẫn ô link.
    const raw = catalog?.groups?.length
      ? buildTilesFromGroups(catalog.groups, catalog.products)
      // Chưa có tab "tệp" → dựng như cũ: tệp suy luận + dịch vụ ngoài.
      : [...SERVICE_LEAD, ...buildCategoryTiles(catalog?.products ?? []), ...SERVICE_TAIL];
    // Ẩn các tệp trong HIDDEN_TILE_LABELS (vd "Đi chợ") dù còn khai báo trong sheet.
    return raw.filter((s) => !HIDDEN_TILE_LABELS.has((s.label || "").trim().toLowerCase()));
  }, [catalog]);

  // Bật/tắt mũi tên cuộn theo vị trí hiện tại của thanh cuộn ngang.
  function updateSvcArrows() {
    const el = svcScrollRef.current;
    if (!el) return;
    setSvcArrows({
      left: el.scrollLeft > 4,
      right: el.scrollLeft + el.clientWidth < el.scrollWidth - 4,
    });
  }
  useEffect(() => {
    updateSvcArrows();
    const onResize = () => updateSvcArrows();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [services.length, selected, query]);

  // Mũi tên cuộn cho carousel "Giá hời quanh đây".
  function updateDealArrows() {
    const el = dealScrollRef.current;
    if (!el) return;
    setDealArrows({
      left: el.scrollLeft > 4,
      right: el.scrollLeft + el.clientWidth < el.scrollWidth - 4,
    });
  }
  useEffect(() => {
    updateDealArrows();
    const onResize = () => updateDealArrows();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [areaDeals.length, selected, query]);

  // Fade mép cho carousel "Nhãn tài trợ" (đổ bóng trắng mờ khi còn cuộn được).
  function updateBrandArrows() {
    const el = brandScrollRef.current;
    if (!el) return;
    setBrandArrows({
      left: el.scrollLeft > 4,
      right: el.scrollLeft + el.clientWidth < el.scrollWidth - 4,
    });
  }
  useEffect(() => {
    updateBrandArrows();
    const onResize = () => updateBrandArrows();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalog?.sponsors?.length, selected, query]);

  // Bấm 1 ô dịch vụ ở lưới "siêu ứng dụng".
  function openService(s: ServiceTile) {
    setSelected(null);
    setQuery("");
    setActiveService(s.key);
    if (s.kind === "all") {
      setActiveTep(null);
      setActiveCat(null);
      setActiveBrand(null);
      setActiveChain(null);
      setPage(1);
    } else if (s.kind === "filter" && s.cat) {
      // Chọn TỆP mới → đặt lại ngành hàng (chip) về "Tất cả" cho khớp tệp vừa chọn.
      setActiveTep(s.cat);
      setActiveCat(null);
      setActiveBrand(null);
      setActiveChain(null);
      setPage(1);
      setToast(t("Đang xem: {label}", { label: t(s.label) }));
      setTimeout(() => setToast(""), 2500);
    } else if (s.kind === "link" && /liên hệ.*affree/i.test(s.label)) {
      // Tile "Liên hệ dịch vụ - Affree" → mở popup form liên hệ trong app, không mở link ngoài.
      // Prefill từ profile đã lưu (tên/SĐT) + userAddr (khu vực) để khách đỡ phải gõ lại.
      const saved = getProfile();
      setContactName(saved.name);
      setContactPhone(saved.phone);
      setContactArea(userAddr || saved.address || "");
      setContactKind("tu-van");
      setContactEmail("");
      setContactMsg("");
      setContactError("");
      setContactOpen(true);
    } else if (s.kind === "link" && s.url) {
      window.open(s.url, "_blank", "noopener,noreferrer");
      setToast(t("Mở {label} (trang dịch vụ bên ngoài)", { label: t(s.label) }));
      setTimeout(() => setToast(""), 3000);
    } else {
      setToast(t("{label} — sắp ra mắt", { label: t(s.label) }));
      setTimeout(() => setToast(""), 2500);
    }
  }

  if (!catalog) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-sky-50 to-emerald-50 text-slate-900">
        {/* Header thật — render ngay không cần catalog */}
        <header className="sticky top-0 z-[2100] border-b border-white/40 bg-white/70 backdrop-blur-2xl" style={{ WebkitBackdropFilter: "blur(32px)" }}>
          <div className="mx-auto max-w-6xl px-3 py-3 sm:px-4">
            <div className="flex items-center gap-2 sm:gap-3">
              <Link href="/" className="flex shrink-0 items-center gap-2">
                <Logo size={34} />
                <span className="flex flex-col leading-tight">
                  <span className="flex items-center gap-1.5 whitespace-nowrap text-lg font-bold tracking-tight">
                    Affree
                    <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">
                      v{APP_VERSION}
                    </span>
                    <span className="inline-flex shrink-0 items-center gap-px rounded-full border border-slate-200 bg-white px-1 py-0.5 text-[10px] font-semibold">
                      <span className={`rounded-full px-1 ${lang === "vi" ? "bg-emerald-500 text-white" : "text-slate-400"}`}>VI</span>
                      <span className={`rounded-full px-1 ${lang === "en" ? "bg-emerald-500 text-white" : "text-slate-400"}`}>EN</span>
                    </span>
                  </span>
                  <span className="flex flex-col text-[11px] leading-tight text-slate-500">
                    <span className="font-semibold text-slate-700">{t("Kết nối mua bán - Không thu phí")}</span>
                    <span>{t("Tìm gì cũng có - Giá hời quanh đây")}</span>
                  </span>
                </span>
              </Link>
              <div className="ml-auto flex items-center gap-1.5">
                <div className="hidden min-w-0 sm:block">
                  <button onClick={() => setLocOpen(true)} className="flex items-center gap-1 rounded-full border border-slate-300 px-2.5 py-1.5 text-sm font-medium text-slate-500">
                    <span>📍</span>
                    <span className="max-w-[150px] truncate">{userAddr || t("Chọn vị trí")}</span>
                  </button>
                </div>
                <button onClick={() => setCartOpen(true)} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-600">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="9" cy="21" r="1" /><circle cx="20" cy="21" r="1" />
                    <path d="M1 1h4l2.7 13.4a2 2 0 0 0 2 1.6h9.7a2 2 0 0 0 2-1.6L23 6H6" />
                  </svg>
                </button>
              </div>
            </div>
            {/* Mobile: address bar */}
            <div className="mt-2 sm:hidden">
              <button onClick={() => setLocOpen(true)} className="flex w-full items-center gap-1 rounded-full border border-slate-300 bg-white px-3 py-2 text-sm text-slate-500">
                <span>📍</span>
                <span className="truncate">{userAddr || t("Chọn vị trí")}</span>
              </button>
            </div>
          </div>
        </header>
        {/* Skeleton content */}
        <div className="mx-auto max-w-6xl px-3 py-4 sm:px-4">
          {/* Search bar skeleton */}
          <div className="mb-4 h-12 animate-pulse rounded-xl bg-slate-200/70" />
          {/* Map button skeleton */}
          <div className="mb-5 h-11 animate-pulse rounded-xl bg-slate-200/70" />
          {/* Services section skeleton */}
          <div className="mb-5">
            <div className="mb-3 flex items-center justify-between">
              <div className="h-5 w-32 animate-pulse rounded bg-slate-200/70" />
              <div className="h-4 w-24 animate-pulse rounded bg-slate-200/70" />
            </div>
            <div className="flex gap-3 overflow-hidden">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="flex shrink-0 flex-col items-center gap-2">
                  <div className="h-20 w-20 animate-pulse rounded-2xl bg-slate-200/70" style={{ animationDelay: `${i * 80}ms` }} />
                  <div className="h-3 w-16 animate-pulse rounded bg-slate-200/70" style={{ animationDelay: `${i * 80}ms` }} />
                </div>
              ))}
            </div>
          </div>
          {/* Brand tiles skeleton */}
          <div className="mb-5">
            <div className="mb-3 flex items-center justify-between">
              <div className="h-5 w-44 animate-pulse rounded bg-slate-200/70" />
              <div className="h-4 w-20 animate-pulse rounded bg-slate-200/70" />
            </div>
            <div className="flex gap-3 overflow-hidden">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="flex shrink-0 flex-col items-center gap-2">
                  <div className="h-20 w-20 animate-pulse rounded-2xl bg-slate-200/70" style={{ animationDelay: `${i * 60}ms` }} />
                  <div className="h-3 w-16 animate-pulse rounded bg-slate-200/70" style={{ animationDelay: `${i * 60}ms` }} />
                </div>
              ))}
            </div>
          </div>
          {/* Product cards skeleton */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {[...Array(8)].map((_, i) => (
              <div key={i} className="rounded-xl border border-slate-200 bg-white p-3" style={{ animationDelay: `${i * 50}ms` }}>
                <div className="mb-2 aspect-square w-full animate-pulse rounded-lg bg-slate-200/70" />
                <div className="mb-1.5 h-4 animate-pulse rounded bg-slate-200/70" />
                <div className="mb-1.5 h-3 w-2/3 animate-pulse rounded bg-slate-200/70" />
                <div className="mb-2.5 h-5 w-1/2 animate-pulse rounded bg-slate-200/70" />
                <div className="h-9 animate-pulse rounded-lg bg-slate-200/70" />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-sky-50 to-emerald-50 text-slate-900">
      <header ref={headerRef} className="sticky top-0 z-[2100] border-b border-white/40 bg-white/70 backdrop-blur-2xl" style={{ WebkitBackdropFilter: "blur(32px)" }}>
        <div className="mx-auto max-w-6xl px-3 py-3 sm:px-4">
          <div className="flex items-center gap-2 sm:gap-3">
            <Link
              href="/"
              onClick={() => {
                // Reset bằng startTransition để re-render lớn (clear filter → show ALL sections)
                // chạy ở priority THẤP, không block navigation/scroll. URL chuyển về "/" ngay,
                // các section nặng (sponsors/deals/groupSections) render dần sau.
                // Cuộn lên đầu trước để user thấy header thay vì chờ skeleton.
                window.scrollTo(0, 0);
                startTransition(() => {
                  setSelected(null);
                  setActiveTep(null);
                  setActiveCat(null);
                  setActiveBrand(null);
                  setActiveChain(null);
                  setActiveService(null);
                  setQuickFilter(null);
                  setQuery("");
                  setPage(1);
                });
              }}
              className="flex shrink-0 items-center gap-2"
            >
              <Logo size={34} />
              <span className="flex flex-col leading-tight">
                <span className="flex items-center gap-1.5 whitespace-nowrap text-lg font-bold tracking-tight">
                  Affree
                  {region && (
                    <span
                      className="inline-flex shrink-0 items-center rounded-full bg-emerald-600 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white shadow-sm"
                      title={t("Vùng phân định — toàn hệ thống bám theo vùng này")}
                    >
                      {region}
                    </span>
                  )}
                  <button
                    onClick={(e) => { e.preventDefault(); setVerOpen(true); }}
                    title={t("Phiên bản & tính năng sắp tới")}
                    className="inline-flex shrink-0 items-center gap-0.5 rounded-full border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 transition hover:bg-emerald-100"
                  >
                    v{APP_VERSION}
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <circle cx="12" cy="12" r="10" />
                      <path d="M12 16v-4" />
                      <path d="M12 8h.01" />
                    </svg>
                  </button>
                  {/* Toggle ngôn ngữ VI/EN — pill nhỏ cạnh chip phiên bản */}
                  <button
                    onClick={(e) => { e.preventDefault(); setLang(lang === "vi" ? "en" : "vi"); }}
                    aria-label={lang === "vi" ? "Switch to English" : "Chuyển sang tiếng Việt"}
                    title={lang === "vi" ? "Switch to English" : "Chuyển sang tiếng Việt"}
                    className="inline-flex shrink-0 items-center gap-px rounded-full border border-slate-200 bg-white px-1 py-0.5 text-[10px] font-semibold transition hover:border-slate-300"
                  >
                    <span className={`rounded-full px-1 ${lang === "vi" ? "bg-emerald-500 text-white" : "text-slate-400"}`}>VI</span>
                    <span className={`rounded-full px-1 ${lang === "en" ? "bg-emerald-500 text-white" : "text-slate-400"}`}>EN</span>
                  </button>
                </span>
                <span className="flex flex-col text-[11px] leading-tight text-slate-500">
                  <span className="font-semibold text-slate-700">{t("Kết nối mua bán - Không thu phí")}</span>
                  <span>{t("Tìm gì cũng có - Giá hời quanh đây")}</span>
                </span>
              </span>
            </Link>
            <div className="ml-auto flex min-w-0 items-center justify-end gap-1.5 sm:flex-initial sm:gap-2">
              {/* Vị trí: trên desktop nằm cùng hàng với Logo + Giỏ hàng; trên mobile chuyển
                xuống hàng riêng bên dưới (full-width) để hàng trên còn chỗ cho Giỏ hàng + Lịch sử. */}
              <div className="relative hidden min-w-0 sm:block sm:flex-initial">
                <button
                  onClick={() => setLocOpen((v) => !v)}
                  title={t("Vị trí của bạn")}
                  className={`flex w-full min-w-0 items-center gap-1 rounded-full border px-2.5 py-1.5 text-sm font-medium transition sm:max-w-[230px] sm:gap-1.5 sm:px-3 ${geoState === "ok"
                    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                    : "border-slate-300 hover:bg-slate-100"
                    }`}
                >
                  <span className="shrink-0">📍</span>
                  <MarqueeText className="min-w-0 flex-1 text-left">{
                    geoState === "locating"
                      ? t("Đang định vị…")
                      : userLoc
                        ? userAddr || t("Đã có vị trí")
                        : t("Chọn vị trí")
                  }</MarqueeText>
                </button>
              </div>
              {/* Giỏ hàng + Lịch sử — hiện ở mọi viewport (mobile + desktop) cùng hàng với Logo. */}
              <button
                onClick={() => setCartOpen(true)}
                className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-emerald-200 bg-emerald-50 shadow-sm transition hover:border-emerald-300 hover:bg-emerald-100 active:scale-95"
                aria-label={t("Giỏ hàng")}
                title={t("Giỏ hàng")}
              >
                <span key={`bump-d-${cartBumpKey}`} className={cartBumpKey > 0 ? "flex animate-cart-bump" : "flex text-emerald-600"}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="9" cy="21" r="1" /><circle cx="20" cy="21" r="1" />
                    <path d="M1 1h4l2.7 13.4a2 2 0 0 0 2 1.6h9.7a2 2 0 0 0 2-1.6L23 6H6" />
                  </svg>
                </span>
                {cartBumpKey > 0 && (
                  <span key={`plus-d-${cartBumpKey}`} className="animate-cart-plus-one">+1</span>
                )}
                {cartItems.length > 0 && (
                  <span
                    key={`badge-d-${cartBumpKey}`}
                    className={`absolute -right-1.5 -top-1.5 flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white shadow-sm ${cartBumpKey > 0 ? "animate-cart-ring" : ""}`}
                  >
                    {cartItems.reduce((s, i) => s + i.qty, 0)}
                  </span>
                )}
              </button>
              <Link
                href="/history"
                title={t("Lịch sử mua")}
                aria-label={t("Lịch sử mua")}
                className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 shadow-sm transition hover:border-slate-300 hover:bg-slate-100 active:scale-95"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-slate-500">
                  <circle cx="12" cy="12" r="10" />
                  <polyline points="12 6 12 12 16 14" />
                </svg>
              </Link>
              {/* <Link
              href="/agent-demo"
              className="shrink-0 whitespace-nowrap rounded-full border border-emerald-300 bg-emerald-50 px-2.5 py-1.5 text-sm font-medium hover:bg-emerald-100 text-emerald-800 sm:px-3"
            >
              🤖 Agent Demo
            </Link> */}
            </div>
          </div>
          {/* Mobile-only: thanh vị trí (full-width) ở dòng dưới — để dòng trên gọn cho Logo + Giỏ hàng + Lịch sử. */}
          <div className="mt-2 sm:hidden">
            <button
              onClick={() => setLocOpen((v) => !v)}
              title={t("Vị trí của bạn")}
              className={`flex w-full min-w-0 items-center gap-1 rounded-full border px-2.5 py-1.5 text-sm font-medium transition ${geoState === "ok"
                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                : "border-slate-300 hover:bg-slate-100"
                }`}
            >
              <span className="shrink-0">📍</span>
              <MarqueeText className="min-w-0 flex-1 text-left">{
                geoState === "locating"
                  ? t("Đang định vị…")
                  : userLoc
                    ? userAddr || t("Đã có vị trí")
                    : t("Chọn vị trí")
              }</MarqueeText>
            </button>
          </div>
        </div>
      </header>

      {locOpen && (
        <LocationPanel
          geoState={geoState}
          locate={locate}
          addrQuery={addrQuery}
          setAddrQuery={setAddrQuery}
          addrResults={addrResults}
          addrSearching={addrSearching}
          addrSearched={addrSearched}
          searchAddress={searchAddress}
          pickAddress={pickAddress}
          onClose={() => setLocOpen(false)}
          t={t}
        />
      )}

      {verOpen && (
        <div
          className="fixed inset-0 z-[2200] flex items-center justify-center bg-slate-900/30 backdrop-blur-md p-4"
          onClick={() => setVerOpen(false)}
        >
          <div
            className="liquid-glass max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-3xl p-5"
            onClick={(e) => e.stopPropagation()}
            style={{ WebkitBackdropFilter: "blur(32px)" }}
          >
            <div className="mb-1 flex items-start justify-between gap-3">
              <div className="flex items-center gap-2">
                <Logo size={30} />
                <div>
                  <p className="flex flex-wrap items-center gap-2 text-base font-bold tracking-tight">
                    <span>Affree</span>
                    {region && (
                      <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider text-white">
                        {region}
                      </span>
                    )}
                    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700">
                      {t("Phiên bản")} {APP_VERSION}
                    </span>
                  </p>
                  <p className="text-xs text-slate-500">{t("Kết nối mua bán - Không thu phí")} · {t("Tìm gì cũng có - Giá hời quanh đây")}</p>
                </div>
              </div>
              <button
                onClick={() => setVerOpen(false)}
                aria-label={t("Đóng")}
                className="shrink-0 rounded-lg px-2 py-1 text-lg leading-none text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
              >
                ✕
              </button>
            </div>

            {VERSION_HISTORY[0] && (
              <>
                <p className="mt-3 mb-2 flex items-center gap-2 text-sm font-semibold text-slate-700">
                  <span className="rounded-md bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-700">
                    {t("Mới")}
                  </span>
                  {t("Có gì trong bản {v}", { v: VERSION_HISTORY[0].version })}
                  {VERSION_HISTORY[0].date && (
                    <span className="text-xs font-normal text-slate-400">· {VERSION_HISTORY[0].date}</span>
                  )}
                </p>
                <div className="mb-1 flex flex-col gap-3">
                  {VERSION_HISTORY[0].children.map((sub, idx) => {
                    // Sub MỚI NHẤT (idx 0) luôn xổ; sub cũ hơn thu gọn, bấm "Xem chi tiết" mới mở.
                    if (idx === 0) {
                      return (
                        <div key={sub.subVersion} className="flex flex-col gap-1.5">
                          <p className="flex items-center gap-2 text-xs font-semibold text-slate-600">
                            <span className="rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-700">
                              v{sub.subVersion}
                            </span>
                            {sub.date && <span className="font-normal text-slate-400">· {sub.date}</span>}
                          </p>
                          <ol className="flex flex-col gap-1 pl-1">
                            {sub.highlights.map((it, i) => (
                              <li key={i} className="flex gap-2 text-xs leading-snug text-slate-600">
                                <span className="shrink-0 font-mono text-[11px] font-semibold text-emerald-600">{i + 1}.</span>
                                <span>{it}</span>
                              </li>
                            ))}
                          </ol>
                        </div>
                      );
                    }
                    const isOpen = expandedSub === sub.subVersion;
                    return (
                      <div key={sub.subVersion} className="rounded-xl border border-slate-200 bg-white">
                        <button
                          type="button"
                          onClick={() => setExpandedSub(isOpen ? null : sub.subVersion)}
                          aria-expanded={isOpen}
                          className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs font-medium text-slate-700 transition hover:bg-slate-50"
                        >
                          <span className="flex items-center gap-2">
                            <span className="rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-700">v{sub.subVersion}</span>
                            {sub.date && <span className="font-normal text-slate-400">{sub.date}</span>}
                          </span>
                          <span className="flex items-center gap-1 font-normal text-slate-500">
                            {isOpen ? t("Thu gọn") : t("Xem chi tiết")}
                            <svg className={`transition ${isOpen ? "rotate-180" : ""}`} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                              <path d="m6 9 6 6 6-6" />
                            </svg>
                          </span>
                        </button>
                        {isOpen && (
                          <ol className="flex flex-col gap-1 border-t border-slate-100 px-3 py-2.5 pl-4">
                            {sub.highlights.map((it, i) => (
                              <li key={i} className="flex gap-2 text-xs leading-snug text-slate-600">
                                <span className="shrink-0 font-mono text-[11px] font-semibold text-slate-500">{i + 1}.</span>
                                <span>{it}</span>
                              </li>
                            ))}
                          </ol>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            )}

            {VERSION_HISTORY.length > 1 && (
              <>
                <p className="mt-4 mb-2 flex items-center gap-2 text-sm font-semibold text-slate-700">
                  <span className="rounded-md bg-slate-200 px-2 py-0.5 text-xs font-bold text-slate-600">
                    {t("Cũ")}
                  </span>
                  {t("Phiên bản trước")}
                </p>
                <div className="flex flex-col gap-1.5">
                  {VERSION_HISTORY.slice(1).map((v) => {
                    const isOpen = expandedVer === v.version;
                    return (
                      <div key={v.version} className="rounded-xl border border-slate-200 bg-white">
                        <button
                          type="button"
                          onClick={() => setExpandedVer(isOpen ? null : v.version)}
                          aria-expanded={isOpen}
                          className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                        >
                          <span className="flex items-center gap-2">
                            <span className="font-semibold">v{v.version}</span>
                            {v.date && <span className="text-xs font-normal text-slate-400">{v.date}</span>}
                          </span>
                          <span className="flex items-center gap-1 text-xs font-normal text-slate-500">
                            {isOpen ? t("Thu gọn") : t("Xem chi tiết")}
                            <svg className={`transition ${isOpen ? "rotate-180" : ""}`} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                              <path d="m6 9 6 6 6-6" />
                            </svg>
                          </span>
                        </button>
                        {isOpen && (
                          <div className="flex flex-col gap-3 border-t border-slate-100 px-3 py-2.5">
                            {v.children.map((sub) => (
                              <div key={sub.subVersion} className="flex flex-col gap-1.5">
                                <p className="flex items-center gap-2 text-xs font-semibold text-slate-600">
                                  <span className="rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-700">
                                    v{sub.subVersion}
                                  </span>
                                  {sub.date && <span className="font-normal text-slate-400">· {sub.date}</span>}
                                </p>
                                <ol className="flex flex-col gap-1 pl-1">
                                  {sub.highlights.map((it, i) => (
                                    <li key={i} className="flex gap-2 text-xs leading-snug text-slate-600">
                                      <span className="shrink-0 font-mono text-[11px] font-semibold text-slate-500">{i + 1}.</span>
                                      <span>{it}</span>
                                    </li>
                                  ))}
                                </ol>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            )}

            <p className="mt-4 mb-2 flex items-center gap-2 text-sm font-semibold text-slate-700">
              <span className="rounded-md bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-700">
                {t("Sắp ra mắt")}
              </span>
              {t("Các tính năng đang được phát triển")}
            </p>

            <div className="flex flex-col gap-3">
              {ROADMAP.map((sec) => (
                <div key={sec.group} className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
                  <p className="mb-1.5 text-sm font-semibold text-slate-800">
                    <span className="mr-1.5">{sec.emoji}</span>
                    {sec.group}
                  </p>
                  <ul className="flex flex-col gap-1.5">
                    {sec.items.map((it, i) => (
                      <li key={i} className="flex gap-2 text-xs leading-snug text-slate-600">
                        <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" />
                        <span>{it}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>

            <p className="mt-4 text-center text-[11px] text-slate-400">
              {t("Cảm ơn bạn đã dùng Affree 💚")}
            </p>
          </div>
        </div>
      )}

      <main className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-2 sm:gap-4 sm:py-5">
        {!userLoc && !geoDismissed && !selected && (
          <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5">
            <span className="text-sm">📍</span>
            <p className="min-w-0 flex-1 truncate text-xs font-medium text-emerald-800">
              {geoState === "error"
                ? t("Trình duyệt đang chặn quyền vị trí — mở cài đặt site rồi thử lại.")
                : t("Bật định vị để xem cửa hàng gần bạn nhất.")}
            </p>
            <button
              onClick={locate}
              disabled={geoState === "locating"}
              className="shrink-0 rounded-full border border-slate-200 bg-emerald-600 px-3 py-1text-xs font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-60"
            >
              {geoState === "locating" ? t("Đang định vị…") : t("Bật định vị")}
            </button>
            <button
              onClick={() => setLocOpen(true)}
              className="hidden shrink-0 rounded-full border border-emerald-300 px-3 py-1 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-100 sm:inline"
            >
              {t("Nhập địa chỉ")}
            </button>
            <button
              onClick={() => setGeoDismissed(true)}
              title={t("Bỏ qua")}
              className="shrink-0 rounded-full p-1 text-emerald-700 hover:bg-emerald-100"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}
        <section className={`min-w-0 ${mobileView === "map" ? "hidden lg:block" : ""}`}>
          {!selected && !activeTep && !activeBrand && !activeCat && !activeChain && (
            <div
              className="sticky z-20 -mx-4 mb-1 bg-slate-50 px-4 py-1.5 sm:py-2"
              style={{ top: headerH }}
            >
              <div className="relative">
                <svg
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 sm:left-4"
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                >
                  <circle cx="11" cy="11" r="7" />
                  <path d="m21 21-4.3-4.3" />
                </svg>
                <input
                  value={query}
                  onChange={(e) => {
                    const v = e.target.value;
                    setQuery(v);
                    setSelected(null);
                    // Tìm kiếm = TOÀN BỘ catalog. Bỏ mọi bộ lọc tệp/ngành hàng/lọc-nhanh đang bật
                    // để kết quả (vd "sữa tắm") không bị "kẹt" trong bộ lọc cũ — lỗi tìm-kiếm đa vùng
                    // khi đổi VN ↔ Canada rồi gõ lại không ra sản phẩm.
                    if (v.trim()) {
                      setActiveTep(null);
                      setActiveCat(null);
                      setActiveService(null);
                      setQuickFilter(null);
                    }
                  }}
                  onFocus={() => setSearchFocused(true)}
                  onBlur={() => setTimeout(() => setSearchFocused(false), 120)}
                  placeholder={t("Tìm sản phẩm (vd: sữa, tã, dầu ăn, gạo…)")}
                  className="w-full rounded-2xl border-2 border-slate-200 bg-white py-2 pl-10 pr-3 text-sm shadow-sm outline-none transition focus:border-emerald-500 focus:shadow-md focus:ring-4 focus:ring-emerald-100 sm:py-3.5 sm:pl-12 sm:pr-4 sm:text-base"
                />
                {searchFocused && query.trim() && matches.length > 0 && (
                  <ul className="absolute z-20 mt-1.5 max-h-80 w-full overflow-auto rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
                    {matches.slice(0, 6).map((p) => (
                      <li key={p.id}>
                        <button
                          onMouseDown={(e) => {
                            e.preventDefault();
                            if (canCompare(p)) openProduct(p);
                            else openBuyForm(p);
                            setSearchFocused(false);
                          }}
                          className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-slate-50"
                        >
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white">
                            <ProductThumb product={p} size={36} contain />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium text-slate-800">
                              {p.name}
                            </span>
                            <span className="block truncate text-xs text-slate-400">
                              {p.brand} · {t(p.unit)}
                            </span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}

          {/* Bản đồ inline dưới search bar — thu gọn/mở rộng, không full-screen */}
          {!selected && !activeTep && !activeBrand && !activeCat && !activeChain && userLoc && mapOpen && mobileView !== "map" && (
            <div className="isolate mb-3 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              {/* Header: hàng 1 = địa chỉ (chạy) + nút thu gọn · hàng 2 = chip bán kính */}
              <div className="border-b border-slate-100 px-3 py-2">
                <div className="flex items-center gap-2">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                    <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" /><circle cx="12" cy="10" r="3" />
                  </svg>
                  <MarqueeText className="text-xs font-medium text-slate-600">
                    {userAddr || t("Vị trí của bạn")}
                  </MarqueeText>
                  <button
                    type="button"
                    onClick={() => setMapOpen(false)}
                    aria-label={t("Thu gọn bản đồ")}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m18 15-6-6-6 6" /></svg>
                  </button>
                </div>
                <div className="mt-1.5 flex items-center gap-1 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  {[0.05, 0.1, 0.15, 0.3, 0.5, 0.7, 1].map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setRadiusKm((cur) => (cur === r ? null : r))}
                      className={`shrink-0 rounded-full border px-2.5 py-0.5 text-[11px] transition ${radiusKm === r
                        ? "border-emerald-600 bg-emerald-600 text-white"
                        : "border-slate-200 bg-white text-slate-500 hover:border-slate-300"
                        }`}
                    >
                      {r < 1 ? `${Math.round(r * 1000)}m` : `${r}km`}
                    </button>
                  ))}
                </div>
              </div>
              {/* Map area */}
              <div className="h-64 overflow-hidden rounded-b-xl sm:h-80">
                <MapView
                  center={center}
                  userLoc={userLoc}
                  userAddr={userAddr}
                  markers={markers}
                  radiusKm={radiusKm}
                  onRadiusChange={setRadiusKm}
                  onViewChange={(c) => setMapView(c)}
                  onStorePick={setStoreProducts}
                  lang={lang}
                  cskdTaxonomy={cskdTaxonomy}
                />
              </div>
            </div>
          )}
          {!selected && !activeTep && !activeBrand && !activeCat && !activeChain && userLoc && !mapOpen && mobileView !== "map" && (
            <button
              type="button"
              onClick={() => setMapOpen(true)}
              className="mb-3 flex w-full items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white py-2.5 text-sm font-medium text-slate-600 shadow-sm transition hover:border-emerald-300 hover:bg-emerald-50"
            >
              🗺️ {t("Xem bản đồ quanh đây")}
            </button>
          )}

          {/* Khúc Chạm Channel — gom hết (tên kênh + pill + player) vào widget nổi lề phải,
              chỉ hiện ở Home & màn rộng (2xl+). Không còn banner trong cột chính. */}
          {!selected && !activeTep && !activeCat && !activeBrand && !activeChain && !quickFilter && (
            <KhucChamSidePanel
              t={t}
              onSendLove={() => {
                setContactKind("loi-yeu-thuong");
                setContactMsg("");
                setContactRecipient("");
                setContactOpen(true);
              }}
              onLicense={() => {
                setContactKind("nhac-ban-quyen");
                setContactMsg("");
                setContactPurposes([]);
                setContactOpen(true);
              }}
            />
          )}

          {/* #8: GIỮ khi đang gõ tìm; ẨN khi xem 1 danh mục (trang "Xem tất cả") cho gọn. */}
          {!selected && !activeTep && !activeCat && !activeBrand && !activeChain && !quickFilter && (
            <div className="mt-3 rounded-2xl border-2 border-slate-200 bg-white p-3 shadow-sm sm:p-4">
              <div className="mb-2 flex items-baseline justify-between">
                <h2 className="text-sm font-semibold text-slate-700">{t("Dịch vụ quanh đây")}</h2>
                <span className="text-[11px] text-slate-400">{t("Mua sắm · nhà đất · dịch vụ")}</span>
              </div>
              <div className="relative">
                {/* Đổ bóng kính (liquid glass): MỖI mép chỉ hiện khi còn cuộn được hướng đó —
                    không phủ trắng item đầu khi chưa cuộn (trái) / item cuối (phải). */}
                {svcArrows.left && <div className={GLASS_FADE_LEFT} />}
                {svcArrows.right && <div className={GLASS_FADE_RIGHT} />}
                {svcArrows.left && (
                  <button
                    type="button"
                    aria-label={t("Cuộn về trước")}
                    onClick={() => svcScrollRef.current?.scrollBy({ left: -(svcScrollRef.current?.clientWidth ?? 260), behavior: "smooth" })}
                    className="absolute left-0 top-6 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-white text-lg text-slate-600 shadow-md ring-1 ring-slate-200 transition hover:bg-slate-50"
                  >
                    ‹
                  </button>
                )}
                <div
                  ref={svcScrollRef}
                  onScroll={updateSvcArrows}
                  className="flex gap-4 overflow-x-auto scroll-smooth px-0.5 pb-2 pt-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                >
                  {services.map((s) => {
                    const active =
                      s.kind === "filter" && s.cat ? activeTep === s.cat : activeService === s.key;
                    return (
                      <button
                        key={s.key}
                        onClick={() => openService(s)}
                        className={`group relative flex shrink-0 flex-col items-center gap-1.5 rounded-2xl px-1.5 py-1.5 transition ${active
                          ? "bg-emerald-50 ring-2 ring-emerald-300"
                          : "hover:-translate-y-0.5"
                          }`}
                      >
                        <span
                          className={`flex h-20 w-20 items-center justify-center overflow-hidden text-5xl group-hover:scale-105 ${TILE_GLASS} ${s.tint}`}
                        >
                          {(() => {
                            const sp = catalog?.sponsors?.find(
                              (sp) => sp.logo && sp.name.toLowerCase() === s.label.toLowerCase(),
                            );
                            return sp ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={sp.logo} alt={s.label} className="h-full w-full object-cover" />
                            ) : s.emoji?.includes("⚽") ? (
                              <span className="animate-spin inline-block">{s.emoji}</span>
                            ) : (
                              s.emoji
                            );
                          })()}
                        </span>
                        {s.kind === "link" && (
                          <span
                            title={t("Mở trang dịch vụ bên ngoài")}
                            className="absolute right-1.5 top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-white text-[9px] font-bold text-slate-400 shadow-sm ring-1 ring-slate-200"
                          >
                            ↗
                          </span>
                        )}
                        <span
                          className={`w-20 line-clamp-2 text-center text-[13px] font-medium leading-tight ${active ? "text-emerald-700" : "text-slate-600"
                            }`}
                        >
                          {t(s.label)}
                        </span>
                      </button>
                    );
                  })}
                </div>
                {svcArrows.right && (
                  <button
                    type="button"
                    aria-label="Cuộn tiếp"
                    onClick={() => svcScrollRef.current?.scrollBy({ left: svcScrollRef.current?.clientWidth ?? 260, behavior: "smooth" })}
                    className="absolute right-0 top-6 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-white text-lg text-slate-600 shadow-md ring-1 ring-slate-200 transition hover:bg-slate-50"
                  >
                    ›
                  </button>
                )}
              </div>

            </div>
          )}

          {/* Nhãn tài trợ — KHUNG RIÊNG, tách khỏi "Dịch vụ quanh đây". Cấu hình ở tab "Nhãn tài trợ". */}
          {/* Ẩn khi đang xem 1 danh mục/lọc (trang "Xem tất cả") — chỉ hiện ở trang chủ. */}
          {!selected && !activeTep && !activeCat && !activeBrand && !activeChain && !quickFilter && catalog?.sponsors?.length ? (
            <div className="mt-3 rounded-2xl border-2 border-slate-200 bg-white p-3 shadow-sm sm:p-4">
              <div className="mb-2 flex items-baseline justify-between">
                <h2 className="text-sm font-semibold text-slate-700">{t("Nhãn tài trợ - Nhãn phổ biến")}</h2>
                <span className="text-[11px] text-slate-400">{t("Nhãn của nhà mình & nhãn phổ biến")}</span>
              </div>
              <div className="relative">
                {/* Đổ bóng kính 2 mép (liquid glass): hiện cả 2 bên khi hàng còn cuộn được. */}
                {brandArrows.left && <div className={GLASS_FADE_LEFT} />}
                {brandArrows.right && <div className={GLASS_FADE_RIGHT} />}
                <div
                  ref={brandScrollRef}
                  onScroll={updateBrandArrows}
                  className="flex gap-4 overflow-x-auto scroll-smooth px-3 pb-2 pt-4 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  {catalog.sponsors.map((sp) => {
                    const isSponsor = sp.kind === "sponsor";
                    const cls =
                      "group flex shrink-0 flex-col items-center justify-start gap-1.5 transition hover:-translate-y-0.5 active:scale-95";
                    const inner = (
                      <>
                        {/* THẺ TRẮNG bo rounded-2xl + viền + shadow nhẹ — đồng phong cách
                          tuoixanhnhanhngon.mualoibanloi.com. Logo nằm trong thẻ, GÓC VUÔNG (không
                          tự bo) để giữ nguyên hình dáng gốc; bo góc thuộc THẺ chứ không thuộc ảnh. */}
                        {/* THẺ TRẮNG vuông, đồng kích thước — phong cách reference (ảnh user gửi):
                          logo tự dò + trim lề rỗng (TrimmedLogo) để hiển thị "nguyên hình"
                          ở giữa thẻ, có khoảng đệm tự nhiên quanh logo, không méo/crop. */}
                        <span className="relative">
                          <span
                            className={`flex h-20 w-20 items-center justify-center overflow-hidden p-2 ${TILE_GLASS}`}
                            // Vuông 80×80 đồng kích thước với tile 'Dịch vụ quanh đây' để 2 section
                            // đồng phong cách. Logo tự dò màu nền brand + trim lề rỗng (TrimmedLogo).
                            style={{
                              backgroundColor: SPONSOR_FILL_OVERRIDES[sp.name] || sponsorFill[sp.name] || "#ffffff",
                            }}
                          >
                            {sp.logo ? (
                              <TrimmedLogo
                                src={sp.logo}
                                alt={sp.name}
                                className="h-full w-full object-contain"
                                keyOutWhite={!!SPONSOR_FILL_OVERRIDES[sp.name]}
                                padPx={sp.name === "Beauty Republic" ? 2 : undefined}
                                onResult={({ fillColor }) => {
                                  if (fillColor) setSponsorFill((m) => (m[sp.name] === fillColor ? m : { ...m, [sp.name]: fillColor }));
                                }}
                              />
                            ) : (
                              <span className="text-3xl font-bold text-slate-500">
                                {sp.name.slice(0, 1)}
                              </span>
                            )}
                          </span>
                          <span
                            className={`pointer-events-none absolute -right-2 -top-2 rounded-sm px-1 py-px text-[9px] font-medium leading-tight shadow-sm ${isSponsor
                              ? "bg-amber-100 text-amber-600"
                              : "bg-emerald-100 text-emerald-600"
                              }`}
                          >
                            {isSponsor ? t("Tài trợ") : t("Phổ biến")}
                          </span>
                        </span>
                        <span
                          className="block min-h-[2rem] line-clamp-2 text-center text-[12px] font-medium leading-tight text-slate-600 group-hover:text-emerald-700"
                          style={{
                            width: sponsorAspect[sp.name]
                              ? `${Math.max(64, Math.min(160, Math.round(80 * sponsorAspect[sp.name])))}px`
                              : "96px",
                          }}
                        >
                          {sp.name}
                        </span>
                      </>
                    );
                    // Click sponsor → mở MODAL giống "xem sản phẩm cửa hàng trên bản đồ"
                    // (StoreProductsPage): sticky header tên brand + sản phẩm grouped theo
                    // category, mỗi section cuộn ngang, có "Xem tất cả →" vào sub-view dọc.
                    // Dùng synthetic store id = `__brand__<lowercase>` để parent route filter
                    // offers theo brand thay vì storeId.
                    return (
                      <button
                        key={sp.name}
                        type="button"
                        onClick={() => {
                          setStoreProducts({
                            id: `__brand__${sp.name.toLowerCase().trim()}`,
                            name: sp.name,
                            chain: "other",
                          } as Store);
                        }}
                        title={sp.name}
                        className={cls}
                      >
                        {inner}
                      </button>
                    );
                  })}
                </div >
              </div >
            </div >
          ) : null}

          {/* Mục TÚI GHÉP · TÚI ĐÔI — combo nhiều SP đơn, giá combo, có thể đa chain. Nguồn: tab "Tui" 1sZTv / seed. */}
          {/* #8/#9: GIỮ khi tìm (gợi ý "Giá hời liên quan"); ẨN khi xem 1 danh mục (trang "Xem tất cả"). */}
          {
            !selected && !activeTep && !activeCat && !activeBrand && !activeChain && !quickFilter && (areaDeals.length > 0 || dealsRadiusKm != null) && (
              <div className="mt-3 rounded-2xl border-2 border-amber-200 bg-gradient-to-br from-amber-50 to-white p-3 shadow-sm sm:p-4">
                <div className="mb-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <h2 className="text-sm font-semibold text-slate-800">
                    <span className="animate-fire mr-0.5">🔥</span>{query.trim() ? t("Giá hời liên quan") : t("Giá hời quanh đây")}
                  </h2>
                  <span className="text-[11px] text-slate-400">
                    {t("so giá nhiều nơi · bật vị trí để ưu tiên gần bạn")}
                  </span>
                </div>
                {userLoc && (
                  <div className="mb-2 flex items-center gap-1.5 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                    {/* Đồng bộ style với bộ filter "Bán kính" trên bản đồ. */}
                    <span className="inline-flex shrink-0 items-center gap-1 pr-0.5 text-xs font-medium text-slate-500">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
                        <circle cx="12" cy="10" r="3" />
                      </svg>
                      {t("Bán kính")}
                    </span>
                    {[0.05, 0.1, 0.15, 0.3, 0.5, 0.7, 1].map((r) => (
                      <button
                        key={r}
                        type="button"
                        onClick={() => setDealsRadiusKm((cur) => (cur === r ? null : r))}
                        className={`shrink-0 rounded-full border px-2.5 py-0.5 text-xs transition ${dealsRadiusKm === r
                          ? "border-emerald-600 bg-emerald-600 text-white"
                          : "border-slate-200 bg-white text-slate-600 hover:bg-slate-100"
                          }`}
                      >
                        {r < 1 ? `${Math.round(r * 1000)}m` : `${r}km`}
                      </button>
                    ))}
                    {dealsRadiusKm != null && (
                      <button
                        type="button"
                        onClick={() => setDealsRadiusKm(null)}
                        title={t("Hiện tất cả cửa hàng, không giới hạn bán kính")}
                        className="inline-flex shrink-0 items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-2.5 py-0.5 text-xs font-medium text-rose-600 transition hover:bg-rose-100"
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M18 6 6 18M6 6l12 12" />
                        </svg>
                        {t("Bỏ giới hạn")}
                      </button>
                    )}
                  </div>
                )}
                <div className="relative">
                  {/* Đổ bóng kính 2 mép (liquid glass) — đồng bộ với các hàng cuộn khác. */}
                  {dealArrows.left && <div className={GLASS_FADE_LEFT} />}
                  {dealArrows.right && <div className={GLASS_FADE_RIGHT} />}
                  {dealArrows.left && (
                    <button
                      type="button"
                      aria-label={t("Cuộn về trước")}
                      onClick={() => dealScrollRef.current?.scrollBy({ left: -(dealScrollRef.current?.clientWidth ?? 260), behavior: "smooth" })}
                      className="absolute left-0 top-1/2 z-10 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-white text-lg text-slate-600 shadow-md ring-1 ring-slate-200 transition hover:bg-slate-50"
                    >
                      ‹
                    </button>
                  )}
                  {areaDeals.length === 0 && dealsRadiusKm != null && (
                    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-amber-200 bg-amber-50/40 px-4 py-6 text-center">
                      <span className="text-2xl">🔎</span>
                      <p className="text-sm font-medium text-amber-800">
                        {t("Chưa có giá hời nào trong {r}", { r: dealsRadiusKm < 1 ? `${Math.round(dealsRadiusKm * 1000)}m` : `${dealsRadiusKm}km` })}
                      </p>
                      <button
                        type="button"
                        onClick={() => setDealsRadiusKm(null)}
                        className="rounded-full border border-slate-200 bg-amber-500 px-3 py-1text-xs font-semibold text-white shadow-sm transition hover:bg-amber-600"
                      >
                        {t("Bỏ giới hạn bán kính")}
                      </button>
                    </div>
                  )}
                  <div
                    ref={dealScrollRef}
                    onScroll={updateDealArrows}
                    className={`flex gap-3 overflow-x-auto scroll-smooth px-0.5 py-3 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${areaDeals.length === 0 ? "hidden" : ""}`}
                  >
                    {areaDeals.map((d) => (
                      <div
                        key={d.product.id}
                        className="group relative flex w-36 shrink-0 flex-col rounded-2xl bg-white p-2.5 text-left ring-1 ring-black/[0.06] shadow-[0_4px_14px_-6px_rgba(15,23,42,0.16),0_2px_5px_-3px_rgba(15,23,42,0.10)] transition duration-200 hover:-translate-y-1 hover:shadow-[0_14px_30px_-10px_rgba(15,23,42,0.24),0_5px_12px_-4px_rgba(15,23,42,0.14)] sm:w-40"
                      >
                        <span
                          role="button"
                          tabIndex={0}
                          onClick={(e) => { e.stopPropagation(); setInfoProduct(d.product); }}
                          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.stopPropagation(); setInfoProduct(d.product); } }}
                          aria-label={t("Xem thông tin & chứng nhận")}
                          title={t("Xem thông tin & chứng nhận")}
                          className="absolute right-1.5 top-1 z-10 cursor-pointer text-[10px] font-semibold leading-none text-slate-400 transition hover:text-slate-700"
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10" /><path d="M12 16v-4" /><path d="M12 8h.01" /></svg>
                        </span>
                        <div className="mb-1.5 flex min-h-[20px] flex-wrap items-start gap-1">
                          <span className="rounded-md bg-rose-600 px-1.5 py-0.5 text-[11px] font-bold text-white shadow-sm">
                            -{Math.round(d.disc * 100)}%
                          </span>
                        </div>
                        <div className="mb-1.5 flex aspect-square w-full items-center justify-center overflow-hidden rounded-lg bg-white">
                          <ProductThumb product={d.product} fill />
                        </div>
                        <div className="min-h-[2.25rem] text-xs font-medium leading-tight text-slate-700">
                          {d.product.name}
                        </div>
                        <div className="mt-1 flex flex-wrap items-baseline gap-x-1.5">
                          <span className="text-sm font-bold text-rose-600">{formatMoney(d.now, d.currency)}</span>
                          <span className="text-[11px] text-slate-400 line-through">{formatMoney(d.was, d.currency)}</span>
                        </div>
                        <div className="mt-0.5 text-[11px] font-medium text-emerald-600">
                          {t("Tiết kiệm {x}", { x: formatMoney(d.save, d.currency) })}
                        </div>
                        <div className="mt-1 min-h-[16px] text-[11px] text-slate-500">
                          {d.storeName && <MarqueeText>{`🛒 ${d.storeName}`}</MarqueeText>}
                        </div>
                        <div className="mt-0.5 min-h-[16px] line-clamp-1 text-[11px] font-medium text-emerald-600">
                          {d.km != null && <>📍 {t("cách bạn {km} km", { km: d.km.toFixed(1) })}</>}
                        </div>
                        {d.storeChain && chainMinOrder(d.storeChain) > 0 && (
                          <div className="mt-0.5 text-[10px] font-medium text-blue-500">{t("Mua tối thiểu {x}", { x: formatMoney(chainMinOrder(d.storeChain), d.currency) })}</div>
                        )}
                        <div className="mt-auto pt-2 flex gap-1.5">
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); addToCart(d.product); }}
                            className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-amber-50 text-lg font-bold text-amber-600 hover:bg-amber-100"
                          >
                            +
                            {cartQtyFor(d.product.id) > 0 && (
                              <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-amber-500 px-0.5 text-[10px] font-bold text-white">
                                {cartQtyFor(d.product.id)}
                              </span>
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); openBuyAgent(d.product); }}
                            className="flex flex-1 items-center justify-center gap-1 rounded-lg border border-slate-200 bg-amber-500 py-1.5 text-xs font-semibold text-white transition hover:bg-amber-600"
                          >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <circle cx="9" cy="21" r="1" /><circle cx="20" cy="21" r="1" />
                              <path d="M1 1h4l2.7 13.4a2 2 0 0 0 2 1.6h9.7a2 2 0 0 0 2-1.6L23 6H6" />
                            </svg>
                            {t("Mua ngay")}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                  {dealArrows.right && (
                    <button
                      type="button"
                      aria-label={t("Cuộn tiếp")}
                      onClick={() => dealScrollRef.current?.scrollBy({ left: dealScrollRef.current?.clientWidth ?? 260, behavior: "smooth" })}
                      className="absolute right-0 top-1/2 z-10 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-white text-lg text-slate-600 shadow-md ring-1 ring-slate-200 transition hover:bg-slate-50"
                    >
                      ›
                    </button>
                  )}
                </div>
              </div>
            )
          }

          {/* Thanh bán kính đã chuyển vào header của map section bên dưới */}


          {source && source.startsWith("seed") && (
            <p className="mt-2 text-xs text-slate-400">
              {t("Nguồn dữ liệu:")} <b>{t("data mẫu")}</b> {t("· không đọc được sheet, đang dùng tạm dữ liệu mẫu.")}
            </p>
          )}

          {!selected && (
            <>
              {/* ── Flat mode: search / quickFilter / activeTep / activeCat / activeBrand / activeChain (URL-driven) ── */}
              {(query.trim() || quickFilter || activeTep || activeCat || activeBrand || activeChain) && (
                <>
                  <div
                    className="sticky z-20 -mx-4 mb-5 border-b border-slate-200 bg-slate-50/95 backdrop-blur supports-[backdrop-filter]:bg-slate-50/80"
                    style={{ top: headerH }}
                  >
                    {activeTep ? (
                      /* ── 2-tầng giống PNJ: tầng cha (circle button) + tầng con SubCatBar ── */
                      <>
                        {/* Tầng cha: tên tệp + circle back về trang chủ — giống PNJ store header */}
                        <div className="flex items-center gap-2 px-3 pt-4 pb-3">
                          <button
                            onClick={() => { setActiveTep(null); setActiveCat(null); setActiveBrand(null); setActiveChain(null); setQuickFilter(null); setQuery(""); setPage(1); }}
                            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100 active:bg-slate-200"
                          >
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M15 18l-6-6 6-6" />
                            </svg>
                          </button>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              {(() => { const g = (catalog?.danhMucGroups ?? catalog?.groups ?? []).find(g => g.label === activeTep); return g?.emoji ? <span>{g.emoji}</span> : null; })()}
                              <h1 className="truncate text-base font-bold text-slate-900">{prettyCat(activeTep)}</h1>
                            </div>
                            {catalog && !isMusicActive && (
                              <p className="mt-0.5 text-xs leading-snug text-slate-500">
                                {isTuiActive ? t("{n} túi", { n: catalog.tui!.length }) : t("{n} sản phẩm", { n: tepTotalCount })}
                              </p>
                            )}
                          </div>
                        </div>
                        {/* Tầng con: SubCatBar chỉ hiện khi đang trong ngành hàng cụ thể */}
                        {activeCat && (
                          <div className="border-t border-slate-200">
                            <SubCatBar
                              backLabel={t("Quay lại")}
                              onBack={() => { setActiveCat(null); setPage(1); }}
                              emoji={null}
                              title={prettyCat(activeCat)}
                              count={catalog && !isMusicActive ? orderedMatches.length : undefined}
                              t={t}
                            />
                          </div>
                        )}
                      </>
                    ) : (
                      /* ── 1-tầng: brand / chain / search / quickFilter ── */
                      <SubCatBar
                        backLabel={t("Quay lại")}
                        onBack={() => { setActiveTep(null); setActiveCat(null); setActiveBrand(null); setActiveChain(null); setQuickFilter(null); setQuery(""); setPage(1); }}
                        emoji={null}
                        title={
                          activeBrand && activeCat
                            ? `${activeBrand} · ${prettyCat(activeCat)}`
                            : activeBrand
                              ? activeBrand
                              : activeChain
                                ? chainLabel(activeChain)
                                : query
                                  ? t("Kết quả")
                                  : quickFilter
                                    ? t(QUICK_FILTERS.find((q) => q.key === quickFilter)!.label)
                                    : t("Kết quả")
                        }
                        count={catalog && !isMusicActive ? (isTuiActive ? catalog.tui!.length : orderedMatches.length) : undefined}
                        countUnit={isTuiActive ? t("túi") : undefined}
                        badges={<>
                          {activeBrand && (
                            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                              {t("Nhãn hàng")}
                            </span>
                          )}
                          {activeChain && !activeBrand && (
                            <span
                              className="rounded-full px-2 py-0.5 text-[11px] font-medium"
                              style={{ backgroundColor: `${chainColor(activeChain)}22`, color: chainColor(activeChain) }}
                            >
                              {t("Cửa hàng")}
                            </span>
                          )}
                          {quickFilter === "hot" && areaName && !query && (
                            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                              📍 {areaName}
                            </span>
                          )}
                        </>}
                        t={t}
                      />
                    )}
                  </div>
                  {isMusicActive ? (
                    <KhucChamAlbumList t={t} onBuy={addMusicToCart} onBuyNow={openMusicOrder} showAll headerH={headerH} cartQtyForId={(id) => cartItems.filter((i) => i.product.id === id).reduce((s, i) => s + i.qty, 0)} />
                  ) : isTuiActive ? (
                    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                      {catalog!.tui!.map((tu) => (
                        <li key={tu.chuyenTrang + tu.maTui + tu.tenTui} className="group relative flex h-full w-full flex-col rounded-2xl bg-white p-3 text-left ring-1 ring-black/[0.06] shadow-[0_4px_14px_-6px_rgba(15,23,42,0.16),0_2px_5px_-3px_rgba(15,23,42,0.10)] transition duration-200 hover:-translate-y-1 hover:shadow-[0_14px_30px_-10px_rgba(15,23,42,0.24),0_5px_12px_-4px_rgba(15,23,42,0.14)]">
                          <span
                            role="button"
                            tabIndex={0}
                            onClick={(e) => { e.stopPropagation(); setTuiInfo(tu); }}
                            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.stopPropagation(); setTuiInfo(tu); } }}
                            aria-label={t("Xem chi tiết sản phẩm trong túi")}
                            title={t("Xem chi tiết sản phẩm trong túi")}
                            className="absolute right-2 top-2 z-10 flex cursor-pointer items-center justify-center text-slate-400 transition hover:text-emerald-600"
                          >
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><path d="M12 16v-4" /><path d="M12 8h.01" /></svg>
                          </span>
                          <div className="mb-1.5 flex min-h-[20px] flex-wrap items-start gap-1">
                            <span className="rounded-md bg-violet-600 px-1.5 py-0.5 text-[10px] font-bold text-white shadow-sm">{loaiLabel(tu.loai)}</span>
                          </div>
                          <div className="relative mb-1.5 aspect-square w-full overflow-hidden rounded-lg bg-slate-50">
                            <div className={`grid h-full w-full gap-0.5 ${tu.items.length <= 1 ? "grid-cols-1" : "grid-cols-2"}`}>
                              {tu.items.slice(0, 4).map((it) => {
                                const p = catalog!.products.find((x) => x.id === it.productId);
                                return (
                                  <span key={it.productId} title={it.name} className="relative flex items-center justify-center overflow-hidden bg-white">
                                    {p ? <ProductThumb product={p} fill /> : <span className="px-1 text-center text-[8px] font-bold leading-tight text-slate-400">{it.name.slice(0, 12)}</span>}
                                  </span>
                                );
                              })}
                            </div>
                            {tu.items.length > 4 && <span className="absolute bottom-1 right-1 rounded-md bg-slate-900/70 px-1.5 py-0.5 text-[9px] font-bold text-white">+{tu.items.length - 4}</span>}
                          </div>
                          <span className="line-clamp-2 min-h-[2.5rem] text-sm font-medium leading-snug text-slate-800">{tu.tenTui}</span>
                          <span className="mt-0.5 truncate text-xs text-slate-400">{tu.chuyenTrang} · {tu.items.length} món</span>
                          <span className="mt-1.5 inline-flex items-center gap-1 text-base font-bold text-rose-600">
                            <svg className="shrink-0 text-rose-500" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20.59 13.41 13.42 20.6a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82Z" /><circle cx="7" cy="7" r="1.2" fill="currentColor" /></svg>
                            {formatMoney(tuiCombo(tu))}
                          </span>
                          <div className="mt-2 flex gap-1">
                            <button
                              type="button"
                              onClick={() => addTuiToCart(tu, false)}
                              aria-label={t("Thêm cả túi vào giỏ")}
                              title={t("Thêm cả túi vào giỏ")}
                              className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-amber-50 text-lg font-bold text-amber-600 hover:bg-amber-100"
                            >
                              +
                              {tuiQtyInCart(tu) > 0 && (
                                <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-amber-500 px-0.5 text-[10px] font-bold text-white">
                                  {tuiQtyInCart(tu)}
                                </span>
                              )}
                            </button>
                            <button type="button" onClick={() => buyTuiWithAgent(tu)} className="flex flex-1 items-center justify-center gap-1 rounded-lg border border-slate-200 bg-amber-500 py-2 text-xs font-semibold text-white transition hover:bg-amber-600">
                              🛍️ {t("Mua cả túi")}
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  ) : activeTep && !activeCat && !query.trim() && !quickFilter && !activeBrand && !activeChain ? (
                    // Grouped carousel: mỗi sub-category 1 hàng ngang, click "Xem tất cả →" mới ra lưới
                    <>
                      {!catalog ? (
                        // Catalog đang load — hiện skeleton
                        <div className="mt-5 flex flex-col gap-6">
                          {[1, 2].map((i) => (
                            <div key={i}>
                              <div className="mb-2.5 h-4 w-32 animate-pulse rounded bg-slate-200" />
                              <div className="flex gap-3 overflow-hidden py-3">
                                {[1, 2, 3, 4].map((j) => (
                                  <div key={j} className="h-52 w-36 shrink-0 animate-pulse rounded-2xl bg-slate-100" />
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : null}
                      {(() => {
                        const catMap = new Map<string, typeof orderedMatches>();
                        for (const p of orderedMatches) {
                          const cat = (p.category || "").trim() || "Khác";
                          if (!catMap.has(cat)) catMap.set(cat, []);
                          catMap.get(cat)!.push(p);
                        }
                        return [...catMap.entries()].map(([cat, catProducts]) => (
                          <section key={cat} className="mt-5">
                            <div className="mb-2.5 flex items-center justify-between">
                              <h3 className="text-sm font-semibold text-slate-700">
                                <span className="mr-1">{CAT_EMOJI[cat] ?? "🛒"}</span>{prettyCat(cat)}
                              </h3>
                              <button
                                onClick={() => { setActiveCat(cat); setPage(1); }}
                                className="shrink-0 text-xs font-medium text-emerald-600 hover:underline"
                              >
                                {t("Xem tất cả →")}
                              </button>
                            </div>
                            <EdgeFadeRow className="flex gap-3 overflow-x-auto py-3 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                              {catProducts.slice(0, 12).map((p) => {
                                const st = priceStats.get(p.id);
                                const tags = recoTags.get(p.id) ?? [];
                                const compare = canCompare(p);
                                return (
                                  <div key={p.id} className="w-36 shrink-0 sm:w-40">
                                    <div className="group relative flex h-full w-full flex-col rounded-2xl bg-white p-3 text-left ring-1 ring-black/[0.06] shadow-[0_4px_14px_-6px_rgba(15,23,42,0.16),0_2px_5px_-3px_rgba(15,23,42,0.10)] transition duration-200 hover:-translate-y-1 hover:shadow-[0_14px_30px_-10px_rgba(15,23,42,0.24),0_5px_12px_-4px_rgba(15,23,42,0.14)]">
                                      <div className="mb-3 flex min-h-[20px] flex-wrap items-start gap-1">
                                        {tags.map((tag) => (
                                          <span key={tag.key} className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold shadow-sm ${tag.cls}`}>{tag.label}</span>
                                        ))}
                                      </div>
                                      <div className="relative flex aspect-square w-full items-center justify-center overflow-hidden rounded-lg bg-white">
                                        <ProductThumb product={p} fill />
                                      </div>
                                      <span
                                        role="button" tabIndex={0}
                                        onClick={(e) => { e.stopPropagation(); setInfoProduct(p); }}
                                        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.stopPropagation(); setInfoProduct(p); } }}
                                        aria-label={t("Xem thông tin & chứng nhận")} title={t("Xem thông tin & chứng nhận")}
                                        className="absolute right-1.5 top-1 z-10 cursor-pointer text-[10px] font-semibold leading-none text-slate-400 transition hover:text-slate-700"
                                      >
                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10" /><path d="M12 16v-4" /><path d="M12 8h.01" /></svg>
                                      </span>
                                      <span className="mb-1.5 block h-[10px]" />
                                      <span className="line-clamp-2 min-h-[2.5rem] text-sm font-medium leading-snug text-slate-800">{p.name}</span>
                                      <span className="mt-0.5 truncate text-xs text-slate-400">{p.brand} · {t(p.unit)}</span>
                                      {st && st.stores > 0 ? (
                                        <>
                                          <span className="mt-1.5 inline-flex items-center gap-1 text-sm font-bold text-rose-600">
                                            <svg className="shrink-0 text-rose-500" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20.59 13.41 13.42 20.6a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82Z" /><circle cx="7" cy="7" r="1.2" fill="currentColor" /></svg>
                                            {formatMoney(st.min, st.currency)}
                                          </span>
                                          <span className="mt-0.5 flex min-h-[16px] items-center gap-1.5">
                                            {(() => {
                                              const listed = p.listedPrice;
                                              const km = p.discountPct ?? (listed && listed > st.min ? (listed - st.min) / listed : 0);
                                              if (!listed || listed <= st.min) return null;
                                              return (<><span className="text-[10px] text-slate-400 line-through">{formatMoney(listed, st.currency)}</span>{km > 0 && (<span className="rounded bg-rose-100 px-1 py-0.5 text-[9px] font-bold text-rose-700">-{Math.round(km * 100)}%</span>)}</>);
                                            })()}
                                          </span>
                                          <span className="mt-0.5 truncate text-xs text-slate-500">
                                            {st.stores === 1 && (st.soleUrl || st.soleSource) ? (st.soleUrl ? st.soleUrl.replace(/^https?:\/\/(www\.)?/, "") : st.soleSource) : t("Có {n} nơi bán", { n: st.stores })}
                                          </span>
                                          {st.soleChain && chainMinOrder(st.soleChain) > 0 && (<span className="mt-0.5 text-[10px] font-medium text-blue-500">{t("Mua tối thiểu {x}", { x: formatMoney(chainMinOrder(st.soleChain), st.currency) })}</span>)}
                                        </>
                                      ) : st && st.outOfStock ? (
                                        <span className="mt-1.5 text-xs font-medium text-red-500">{t("Hết hàng")}</span>
                                      ) : (
                                        <span className="mt-1.5 text-xs text-slate-400">{t("Chưa có giá")}</span>
                                      )}
                                      <span className="mt-auto block w-full pt-2">
                                        {compare ? (
                                          <span onClick={(e) => { e.stopPropagation(); openProduct(p); }} className="flex w-full items-center justify-center gap-1 rounded-lg border border-slate-200 bg-emerald-600 py-1.5 text-[11px] font-semibold text-white transition-colors duration-200 group-hover:bg-emerald-700">
                                            {t("So sánh")}<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
                                          </span>
                                        ) : (
                                          <span className="flex gap-1">
                                            <span role="button" tabIndex={0} onClick={(e) => { e.stopPropagation(); addToCart(p); }} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.stopPropagation(); addToCart(p); } }} className="relative flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-slate-200 bg-amber-50 text-base font-bold text-amber-600 hover:bg-amber-100">
                                              +
                                              {cartQtyFor(p.id) > 0 && (<span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-amber-500 px-0.5 text-[10px] font-bold text-white">{cartQtyFor(p.id)}</span>)}
                                            </span>
                                            <span onClick={(e) => { e.stopPropagation(); openBuyAgent(p); }} className="flex flex-1 cursor-pointer items-center justify-center gap-1 rounded-lg border border-slate-200 bg-amber-500 py-1.5 text-[11px] font-semibold text-white transition-colors duration-200 group-hover:bg-amber-600">
                                              {t("Mua ngay")}
                                            </span>
                                          </span>
                                        )}
                                      </span>
                                    </div>
                                  </div>
                                );
                              })}
                            </EdgeFadeRow>
                          </section>
                        ));
                      })()}
                    </>
                  ) : (<>
                    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                      {pageItems.map((p) => {
                        const st = priceStats.get(p.id);
                        const tags = recoTags.get(p.id) ?? [];
                        const compare = canCompare(p);
                        return (
                          <li key={p.id}>
                            <div
                              className="group relative flex h-full w-full flex-col rounded-2xl bg-white p-3 text-left ring-1 ring-black/[0.06] shadow-[0_4px_14px_-6px_rgba(15,23,42,0.16),0_2px_5px_-3px_rgba(15,23,42,0.10)] transition duration-200 hover:-translate-y-1 hover:shadow-[0_14px_30px_-10px_rgba(15,23,42,0.24),0_5px_12px_-4px_rgba(15,23,42,0.14)]"
                            >
                              <div className="mb-3 flex min-h-[20px] flex-wrap items-start gap-1">
                                {tags.map((tag) => (
                                  <span key={tag.key} className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold shadow-sm ${tag.cls}`}>{tag.label}</span>
                                ))}
                              </div>
                              <div className="relative flex aspect-square w-full items-center justify-center overflow-hidden rounded-lg bg-white">
                                <ProductThumb product={p} fill />
                              </div>
                              <span
                                role="button"
                                tabIndex={0}
                                onClick={(e) => { e.stopPropagation(); setInfoProduct(p); }}
                                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.stopPropagation(); setInfoProduct(p); } }}
                                aria-label={t("Xem thông tin & chứng nhận")}
                                title={t("Xem thông tin & chứng nhận")}
                                className="absolute right-1.5 top-1 z-10 cursor-pointer text-[10px] font-semibold leading-none text-slate-400 transition hover:text-slate-700"
                              >
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10" /><path d="M12 16v-4" /><path d="M12 8h.01" /></svg>
                              </span>
                              <span className="mb-1.5 block h-[10px]" />
                              <span className="line-clamp-2 min-h-[2.5rem] text-sm font-medium leading-snug text-slate-800">{p.name}</span>
                              <span className="mt-0.5 truncate text-xs text-slate-400">{p.brand} · {t(p.unit)}</span>
                              {st && st.stores > 0 ? (
                                <>
                                  <span className="mt-1.5 inline-flex items-center gap-1 text-base font-bold text-rose-600">
                                    <svg className="shrink-0 text-rose-500" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20.59 13.41 13.42 20.6a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82Z" /><circle cx="7" cy="7" r="1.2" fill="currentColor" /></svg>
                                    {formatMoney(st.min, st.currency)}
                                  </span>
                                  <span className="mt-0.5 flex min-h-[18px] items-center gap-1.5">
                                    {(() => {
                                      const listed = p.listedPrice;
                                      const km = p.discountPct ?? (listed && listed > st.min ? (listed - st.min) / listed : 0);
                                      if (!listed || listed <= st.min) return null;
                                      return (
                                        <>
                                          <span className="text-[11px] text-slate-400 line-through">{formatMoney(listed, st.currency)}</span>
                                          {km > 0 && (
                                            <span className="rounded bg-rose-100 px-1 py-0.5 text-[10px] font-bold text-rose-700">-{Math.round(km * 100)}%</span>
                                          )}
                                        </>
                                      );
                                    })()}
                                  </span>
                                  <span className="mt-0.5 inline-flex items-center gap-1 text-xs text-slate-500">
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="21" r="1" /><circle cx="20" cy="21" r="1" /><path d="M1 1h4l2.7 13.4a2 2 0 0 0 2 1.6h9.7a2 2 0 0 0 2-1.6L23 6H6" /></svg>
                                    {st.stores === 1 && (st.soleUrl || st.soleSource) ? (st.soleUrl ? st.soleUrl.replace(/^https?:\/\/(www\.)?/, "") : st.soleSource) : t("Có {n} nơi bán", { n: st.stores })}
                                  </span>
                                  {st.soleChain && chainMinOrder(st.soleChain) > 0 && (<span className="mt-0.5 text-[10px] font-medium text-blue-500">{t("Mua tối thiểu {x}", { x: formatMoney(chainMinOrder(st.soleChain), st.currency) })}</span>)}
                                </>
                              ) : st && st.outOfStock ? (
                                <span className="mt-1.5 text-sm font-medium text-red-500">{t("Hết hàng")}</span>
                              ) : (
                                <span className="mt-1.5 text-sm text-slate-400">{t("Chưa có giá")}</span>
                              )}
                              <span className="mt-auto block w-full pt-2.5">
                                <span className="flex gap-1">
                                  <span
                                    role="button"
                                    tabIndex={0}
                                    onClick={(e) => { e.stopPropagation(); addToCart(p); }}
                                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.stopPropagation(); addToCart(p); } }}
                                    className="relative flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-slate-200 bg-amber-50 text-lg font-bold text-amber-600 hover:bg-amber-100"
                                  >
                                    +
                                    {cartQtyFor(p.id) > 0 && (
                                      <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-amber-500 px-0.5 text-[10px] font-bold text-white">
                                        {cartQtyFor(p.id)}
                                      </span>
                                    )}
                                  </span>
                                  {compare ? (
                                    <span onClick={(e) => { e.stopPropagation(); openProduct(p); }} className="flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-emerald-600 py-2 text-xs font-semibold text-white transition-colors duration-200 group-hover:bg-emerald-700">
                                      {t("So sánh giá")}<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
                                    </span>
                                  ) : (
                                    <span onClick={(e) => { e.stopPropagation(); openBuyAgent(p); }} className="flex flex-1 cursor-pointer items-center justify-center rounded-lg border border-slate-200 bg-amber-500 py-2 text-xs font-semibold text-white transition-colors duration-200 group-hover:bg-amber-600">
                                      {t("Mua ngay")}
                                    </span>
                                  )}
                                </span>
                              </span>
                            </div>
                          </li>
                        );
                      })}
                      {catalog && orderedMatches.length === 0 && (
                        quickFilter === "hot" && !userLoc ? (
                          <li className="col-span-full rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-center text-sm text-slate-500">
                            {t("Cần vị trí để xem sản phẩm bán chạy quanh bạn.")}
                            <button onClick={locate} className="ml-2 inline-flex items-center gap-1 rounded-full border border-slate-200 bg-emerald-600 px-3 py-1text-xs font-semibold text-white">{t("Bật vị trí")}</button>
                          </li>
                        ) : quickFilter === "hot" ? (
                          <li className="col-span-full text-sm text-slate-500">{t("Chưa có sản phẩm bán chạy trong khu vực {r} km quanh bạn.", { r: radiusKm ?? 10 })}</li>
                        ) : (
                          <li className="col-span-full text-sm text-slate-500">{t("Không tìm thấy sản phẩm phù hợp.")}</li>
                        )
                      )}
                    </ul>
                    {
                      totalPages > 1 && (
                        <div className="mt-5 flex items-center justify-center gap-3">
                          <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100 disabled:opacity-40">{t("← Trước")}</button>
                          <span className="text-sm text-slate-500">{t("Trang {page}/{total}", { page, total: totalPages })}</span>
                          <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100 disabled:opacity-40">{t("Sau →")}</button>
                        </div>
                      )
                    }
                  </>)}
                </>
              )}

              {/* ── Grouped sections: trang chủ, không search/filter ── */}
              {
                !query.trim() && !quickFilter && !activeTep && !activeCat && !activeBrand && !activeChain && groupSections.map(({ name, emoji, displayName, products }) => {
                  const isExpanded = expandedGroups.has(name);
                  // Danh mục "Túi ghép - đôi - đa dạng" → render các TÚI combo dạng card giống sản phẩm.
                  const isTuiCat = !!catalog?.tui?.length && /túi ghép|túi đôi|túi.*đa dạng/i.test(name);
                  if (isTuiCat) {
                    const tuis = catalog!.tui!;
                    return (
                      <section key={name} className="mt-5">
                        <div className="mb-2.5 flex items-end justify-between gap-3">
                          <div className="flex min-w-0 flex-col leading-tight">
                            <h2 className="text-lg font-bold tracking-tight text-slate-900 sm:text-xl">
                              {emoji && <span className={`mr-1.5${emoji?.includes("⚽") ? " animate-spin inline-block" : ""}`}>{emoji}</span>}{t(displayName ?? name)}
                            </h2>
                          </div>
                          <button
                            onClick={() => { setActiveTep(name); setActiveCat(null); setQuickFilter(null); setQuery(""); setSelected(null); }}
                            className="text-xs font-medium text-emerald-600 hover:underline"
                          >
                            {t("Xem tất cả →")}
                          </button>
                        </div>
                        <EdgeFadeRow className="flex gap-3 overflow-x-auto scroll-smooth px-0.5 py-3 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                          {tuis.map((tu) => (
                            <div
                              key={tu.chuyenTrang + tu.maTui + tu.tenTui}
                              className="group relative flex w-44 shrink-0 flex-col rounded-2xl bg-white p-3 text-left ring-1 ring-black/[0.06] shadow-[0_4px_14px_-6px_rgba(15,23,42,0.16),0_2px_5px_-3px_rgba(15,23,42,0.10)] transition duration-200 hover:-translate-y-1 hover:shadow-[0_14px_30px_-10px_rgba(15,23,42,0.24),0_5px_12px_-4px_rgba(15,23,42,0.14)] sm:w-48"
                            >
                              <span
                                role="button"
                                tabIndex={0}
                                onClick={(e) => { e.stopPropagation(); setTuiInfo(tu); }}
                                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.stopPropagation(); setTuiInfo(tu); } }}
                                aria-label={t("Xem chi tiết sản phẩm trong túi")}
                                title={t("Xem chi tiết sản phẩm trong túi")}
                                className="absolute right-2 top-2 z-10 flex cursor-pointer items-center justify-center text-slate-400 transition hover:text-emerald-600"
                              >
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><path d="M12 16v-4" /><path d="M12 8h.01" /></svg>
                              </span>
                              {/* Tag loại túi — dòng riêng phía trên ảnh, không che lưới SP */}
                              <div className="mb-1.5 flex min-h-[20px] flex-wrap items-start gap-1">
                                <span className="rounded-md bg-violet-600 px-1.5 py-0.5 text-[10px] font-bold text-white shadow-sm">{loaiLabel(tu.loai)}</span>
                              </div>
                              {/* Ảnh TẤT CẢ sản phẩm trong túi (lưới 2 cột) */}
                              <div className="relative mb-1.5 aspect-square w-full overflow-hidden rounded-lg bg-slate-50">
                                <div className={`grid h-full w-full gap-0.5 ${tu.items.length <= 1 ? "grid-cols-1" : "grid-cols-2"}`}>
                                  {tu.items.slice(0, 4).map((it) => {
                                    const p = catalog!.products.find((x) => x.id === it.productId);
                                    return (
                                      <span key={it.productId} title={it.name} className="relative flex items-center justify-center overflow-hidden bg-white">
                                        {p ? <ProductThumb product={p} fill /> : <span className="px-1 text-center text-[8px] font-bold leading-tight text-slate-400">{it.name.slice(0, 12)}</span>}
                                      </span>
                                    );
                                  })}
                                </div>
                                {tu.items.length > 4 && <span className="absolute bottom-1 right-1 rounded-md bg-slate-900/70 px-1.5 py-0.5 text-[9px] font-bold text-white">+{tu.items.length - 4}</span>}
                              </div>
                              <span className="line-clamp-2 min-h-[2.5rem] text-sm font-medium leading-snug text-slate-800">{tu.tenTui}</span>
                              <span className="mt-0.5 truncate text-xs text-slate-400">{tu.chuyenTrang} · {tu.items.length} món</span>
                              <span className="mt-1.5 inline-flex items-center gap-1 text-base font-bold text-rose-600">
                                <svg className="shrink-0 text-rose-500" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20.59 13.41 13.42 20.6a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82Z" /><circle cx="7" cy="7" r="1.2" fill="currentColor" /></svg>
                                {formatMoney(tuiCombo(tu))}
                              </span>
                              <div className="mt-2 flex gap-1">
                                <button
                                  type="button"
                                  onClick={() => addTuiToCart(tu, false)}
                                  aria-label={t("Thêm cả túi vào giỏ")}
                                  title={t("Thêm cả túi vào giỏ")}
                                  className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-amber-50 text-lg font-bold text-amber-600 hover:bg-amber-100"
                                >
                                  +
                                  {tuiQtyInCart(tu) > 0 && (
                                    <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-amber-500 px-0.5 text-[10px] font-bold text-white">
                                      {tuiQtyInCart(tu)}
                                    </span>
                                  )}
                                </button>
                                <button type="button" onClick={() => buyTuiWithAgent(tu)} className="flex flex-1 items-center justify-center gap-1 rounded-lg border border-slate-200 bg-amber-500 py-2 text-xs font-semibold text-white transition hover:bg-amber-600">
                                  🛍️ {t("Mua cả túi")}
                                </button>
                              </div>
                            </div>
                          ))}
                        </EdgeFadeRow>
                      </section>
                    );
                  }
                  // Danh mục "Nhạc bản quyền" → render album Khúc Chạm bằng card đẹp (không phải sản phẩm
                  // catalog). Đặt TRƯỚC guard rỗng vì nhạc không nằm trong catalog (products luôn = []).
                  const isMusicCat = /nhạc bản quyền|nhac ban quyen/i.test(name);
                  if (isMusicCat) {
                    return (
                      <section key={name} className="mt-5">
                        <div className="mb-2.5 flex items-end justify-between gap-3">
                          <div className="flex min-w-0 items-center gap-2.5 leading-tight">
                            {/* Logo đĩa than QUAY + nốt nhạc NHẤP NHÁY — điểm nhấn cạnh tiêu đề */}
                            <a
                              href="https://music.youtube.com/@KhucChamChannel"
                              target="_blank"
                              rel="noopener noreferrer"
                              aria-label={t("Mở Khúc Chạm Channel")}
                              title={t("Khúc Chạm Channel")}
                              className="relative block h-10 w-10 shrink-0"
                            >
                              <span className="animate-disc-spin block h-10 w-10 rounded-full bg-[radial-gradient(circle,#3f3f46_0%,#18181b_55%,#000_100%)] shadow-md ring-2 ring-orange-300">
                                <span className="absolute inset-1.5 rounded-full border border-white/10" />
                                <span className="absolute inset-2.5 rounded-full border border-white/10" />
                                <span className="absolute inset-0 m-auto flex h-3.5 w-3.5 items-center justify-center rounded-full bg-gradient-to-br from-orange-400 to-amber-500 text-[7px] text-white">♪</span>
                              </span>
                              <span className="animate-note-blink pointer-events-none absolute -right-1 -top-1 text-sm text-pink-500" aria-hidden="true">♫</span>
                              <span className="animate-note-blink pointer-events-none absolute -bottom-1 -left-1 text-xs text-amber-500 [animation-delay:.4s]" aria-hidden="true">♪</span>
                            </a>
                            <h2 className="text-lg font-bold tracking-tight text-slate-900 sm:text-xl">
                              {emoji && <span className={`mr-1.5${emoji?.includes("⚽") ? " animate-spin inline-block" : ""}`}>{emoji}</span>}{t(displayName ?? name)}
                            </h2>
                          </div>
                          <button
                            onClick={() => { setActiveTep(name); setActiveCat(null); setQuickFilter(null); setQuery(""); setSelected(null); }}
                            className="shrink-0 text-xs font-medium text-emerald-600 hover:underline"
                          >
                            {t("Xem tất cả →")}
                          </button>
                        </div>
                        <KhucChamAlbumList t={t} onBuy={addMusicToCart} onBuyNow={openMusicOrder} headerH={headerH} cartQtyForId={(id) => cartItems.filter((i) => i.product.id === id).reduce((s, i) => s + i.qty, 0)} />
                      </section>
                    );
                  }
                  // Danh mục chưa có sản phẩm → ẨN luôn cả section (không hiện placeholder "Khu vực mới…").
                  if (products.length === 0) return null;
                  return (
                    <section key={name} className="mt-5">
                      <div className="mb-2.5 flex items-end justify-between gap-3">
                        <div className="flex min-w-0 flex-col leading-tight">
                          <h2 className="text-lg font-bold tracking-tight text-slate-900 sm:text-xl">
                            {emoji && <span className={`mr-1.5${emoji?.includes("⚽") ? " animate-spin inline-block" : ""}`}>{emoji}</span>}{t(displayName ?? name)}
                          </h2>
                        </div>
                        {products.length > 0 && (
                          <button
                            onClick={() => {
                              // Mở "trang" danh mục: lọc toàn bộ sản phẩm của tệp này (tái dùng lưới + phân trang),
                              // thay vì xổ inline. Đặt lại các bộ lọc khác + cuộn lên đầu.
                              setActiveTep(name);
                              setActiveCat(null);
                              setQuickFilter(null);
                              setQuery("");
                              setSelected(null);
                              // cuộn lên đầu do useEffect [activeTep] lo (sau khi layout đổi)
                            }}
                            className="text-xs font-medium text-emerald-600 hover:underline"
                          >
                            {t("Xem tất cả →")}
                          </button>
                        )}
                      </div>
                      {isExpanded ? (
                        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                          {products.map((p) => {
                            const st = priceStats.get(p.id);
                            const tags = recoTags.get(p.id) ?? [];
                            const compare = canCompare(p);
                            return (
                              <li key={p.id}>
                                <div
                                  className="group relative flex h-full w-full flex-col rounded-2xl bg-white p-3 text-left ring-1 ring-black/[0.06] shadow-[0_4px_14px_-6px_rgba(15,23,42,0.16),0_2px_5px_-3px_rgba(15,23,42,0.10)] transition duration-200 hover:-translate-y-1 hover:shadow-[0_14px_30px_-10px_rgba(15,23,42,0.24),0_5px_12px_-4px_rgba(15,23,42,0.14)]"
                                >
                                  <div className="mb-3 flex min-h-[20px] flex-wrap items-start gap-1">
                                    {tags.map((tag) => (
                                      <span key={tag.key} className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold shadow-sm ${tag.cls}`}>{tag.label}</span>
                                    ))}
                                  </div>
                                  <div className="relative flex aspect-square w-full items-center justify-center overflow-hidden rounded-lg bg-white">
                                    <ProductThumb product={p} fill />
                                  </div>
                                  <span
                                    role="button"
                                    tabIndex={0}
                                    onClick={(e) => { e.stopPropagation(); setInfoProduct(p); }}
                                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.stopPropagation(); setInfoProduct(p); } }}
                                    aria-label={t("Xem thông tin & chứng nhận")}
                                    title={t("Xem thông tin & chứng nhận")}
                                    className="absolute right-1.5 top-1 z-10 cursor-pointer text-[10px] font-semibold leading-none text-slate-400 transition hover:text-slate-700"
                                  >
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10" /><path d="M12 16v-4" /><path d="M12 8h.01" /></svg>
                                  </span>
                                  <span className="mb-1.5 block h-[10px]" />
                                  <span className="line-clamp-2 min-h-[2.5rem] text-sm font-medium leading-snug text-slate-800">{p.name}</span>
                                  <span className="mt-0.5 truncate text-xs text-slate-400">{p.brand} · {t(p.unit)}</span>
                                  {st && st.stores > 0 ? (
                                    <>
                                      <span className="mt-1.5 inline-flex items-center gap-1 text-base font-bold text-rose-600">
                                        <svg className="shrink-0 text-rose-500" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20.59 13.41 13.42 20.6a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82Z" /><circle cx="7" cy="7" r="1.2" fill="currentColor" /></svg>
                                        {formatMoney(st.min, st.currency)}
                                      </span>
                                      <span className="mt-0.5 flex min-h-[18px] items-center gap-1.5">
                                        {(() => {
                                          const listed = p.listedPrice;
                                          const km = p.discountPct ?? (listed && listed > st.min ? (listed - st.min) / listed : 0);
                                          if (!listed || listed <= st.min) return null;
                                          return (
                                            <>
                                              <span className="text-[11px] text-slate-400 line-through">{formatMoney(listed, st.currency)}</span>
                                              {km > 0 && (
                                                <span className="rounded bg-rose-100 px-1 py-0.5 text-[10px] font-bold text-rose-700">-{Math.round(km * 100)}%</span>
                                              )}
                                            </>
                                          );
                                        })()}
                                      </span>
                                      <span className="mt-0.5 inline-flex items-center gap-1 text-xs text-slate-500">
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="21" r="1" /><circle cx="20" cy="21" r="1" /><path d="M1 1h4l2.7 13.4a2 2 0 0 0 2 1.6h9.7a2 2 0 0 0 2-1.6L23 6H6" /></svg>
                                        {st.stores === 1 && (st.soleUrl || st.soleSource) ? (st.soleUrl ? st.soleUrl.replace(/^https?:\/\/(www\.)?/, "") : st.soleSource) : t("Có {n} nơi bán", { n: st.stores })}
                                      </span>
                                    </>
                                  ) : st && st.outOfStock ? (
                                    <span className="mt-1.5 text-sm font-medium text-red-500">{t("Hết hàng")}</span>
                                  ) : (
                                    <span className="mt-1.5 text-sm text-slate-400">{t("Chưa có giá")}</span>
                                  )}
                                  <span className="mt-auto block w-full pt-2.5">
                                    <span className="flex gap-1">
                                      <span
                                        role="button"
                                        tabIndex={0}
                                        onClick={(e) => { e.stopPropagation(); addToCart(p); }}
                                        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.stopPropagation(); addToCart(p); } }}
                                        className="relative flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-slate-200 bg-amber-50 text-lg font-bold text-amber-600 hover:bg-amber-100"
                                      >
                                        +
                                        {cartQtyFor(p.id) > 0 && (
                                          <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-amber-500 px-0.5 text-[10px] font-bold text-white">
                                            {cartQtyFor(p.id)}
                                          </span>
                                        )}
                                      </span>
                                      {compare ? (
                                        <span onClick={(e) => { e.stopPropagation(); openProduct(p); }} className="flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-emerald-600 py-2 text-xs font-semibold text-white transition-colors duration-200 group-hover:bg-emerald-700">
                                          {t("So sánh giá")}<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
                                        </span>
                                      ) : (
                                        <span onClick={(e) => { e.stopPropagation(); openBuyAgent(p); }} className="flex flex-1 cursor-pointer items-center justify-center rounded-lg border border-slate-200 bg-amber-500 py-2 text-xs font-semibold text-white transition-colors duration-200 group-hover:bg-amber-600">
                                          {t("Mua ngay")}
                                        </span>
                                      )}
                                    </span>
                                  </span>
                                </div>
                              </li>
                            );
                          })}
                        </ul>
                      ) : (
                        <EdgeFadeRow className="flex gap-3 overflow-x-auto py-3 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                          {products.slice(0, 12).map((p) => {
                            const st = priceStats.get(p.id);
                            const tags = recoTags.get(p.id) ?? [];
                            const compare = canCompare(p);
                            return (
                              <div key={p.id} className="w-36 shrink-0 sm:w-40">
                                <div
                                  className="group relative flex h-full w-full flex-col rounded-2xl bg-white p-3 text-left ring-1 ring-black/[0.06] shadow-[0_4px_14px_-6px_rgba(15,23,42,0.16),0_2px_5px_-3px_rgba(15,23,42,0.10)] transition duration-200 hover:-translate-y-1 hover:shadow-[0_14px_30px_-10px_rgba(15,23,42,0.24),0_5px_12px_-4px_rgba(15,23,42,0.14)]"
                                >
                                  <div className="mb-3 flex min-h-[20px] flex-wrap items-start gap-1">
                                    {tags.map((tag) => (
                                      <span key={tag.key} className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold shadow-sm ${tag.cls}`}>{tag.label}</span>
                                    ))}
                                  </div>
                                  <div className="relative flex aspect-square w-full items-center justify-center overflow-hidden rounded-lg bg-white">
                                    <ProductThumb product={p} fill />
                                  </div>
                                  <span
                                    role="button"
                                    tabIndex={0}
                                    onClick={(e) => { e.stopPropagation(); setInfoProduct(p); }}
                                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.stopPropagation(); setInfoProduct(p); } }}
                                    aria-label={t("Xem thông tin & chứng nhận")}
                                    title={t("Xem thông tin & chứng nhận")}
                                    className="absolute right-1.5 top-1 z-10 cursor-pointer text-[10px] font-semibold leading-none text-slate-400 transition hover:text-slate-700"
                                  >
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10" /><path d="M12 16v-4" /><path d="M12 8h.01" /></svg>
                                  </span>
                                  <span className="mb-1.5 block h-[10px]" />
                                  <span className="line-clamp-2 min-h-[2.5rem] text-sm font-medium leading-snug text-slate-800">{p.name}</span>
                                  <span className="mt-0.5 truncate text-xs text-slate-400">{p.brand} · {t(p.unit)}</span>
                                  {st && st.stores > 0 ? (
                                    <>
                                      <span className="mt-1.5 inline-flex items-center gap-1 text-sm font-bold text-rose-600">
                                        <svg className="shrink-0 text-rose-500" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20.59 13.41 13.42 20.6a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82Z" /><circle cx="7" cy="7" r="1.2" fill="currentColor" /></svg>
                                        {formatMoney(st.min, st.currency)}
                                      </span>
                                      <span className="mt-0.5 flex min-h-[16px] items-center gap-1.5">
                                        {(() => {
                                          const listed = p.listedPrice;
                                          const km = p.discountPct ?? (listed && listed > st.min ? (listed - st.min) / listed : 0);
                                          if (!listed || listed <= st.min) return null;
                                          return (
                                            <>
                                              <span className="text-[10px] text-slate-400 line-through">{formatMoney(listed, st.currency)}</span>
                                              {km > 0 && (
                                                <span className="rounded bg-rose-100 px-1 py-0.5 text-[9px] font-bold text-rose-700">-{Math.round(km * 100)}%</span>
                                              )}
                                            </>
                                          );
                                        })()}
                                      </span>
                                      <span className="mt-0.5 truncate text-xs text-slate-500">
                                        {st.stores === 1 && (st.soleUrl || st.soleSource) ? (st.soleUrl ? st.soleUrl.replace(/^https?:\/\/(www\.)?/, "") : st.soleSource) : t("Có {n} nơi bán", { n: st.stores })}
                                      </span>
                                      {st.soleChain && chainMinOrder(st.soleChain) > 0 && (<span className="mt-0.5 text-[10px] font-medium text-blue-500">{t("Mua tối thiểu {x}", { x: formatMoney(chainMinOrder(st.soleChain), st.currency) })}</span>)}
                                    </>
                                  ) : st && st.outOfStock ? (
                                    <span className="mt-1.5 text-xs font-medium text-red-500">{t("Hết hàng")}</span>
                                  ) : (
                                    <span className="mt-1.5 text-xs text-slate-400">{t("Chưa có giá")}</span>
                                  )}
                                  <span className="mt-auto block w-full pt-2">
                                    {compare ? (
                                      <span onClick={(e) => { e.stopPropagation(); openProduct(p); }} className="flex w-full items-center justify-center gap-1 rounded-lg border border-slate-200 bg-emerald-600 py-1.5 text-[11px] font-semibold text-white transition-colors duration-200 group-hover:bg-emerald-700">
                                        {t("So sánh")}<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
                                      </span>
                                    ) : (
                                      <span className="flex gap-1">
                                        <span
                                          role="button"
                                          tabIndex={0}
                                          onClick={(e) => { e.stopPropagation(); addToCart(p); }}
                                          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.stopPropagation(); addToCart(p); } }}
                                          className="relative flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-slate-200 bg-amber-50 text-base font-bold text-amber-600 hover:bg-amber-100"
                                        >
                                          +
                                          {cartQtyFor(p.id) > 0 && (
                                            <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-amber-500 px-0.5 text-[10px] font-bold text-white">
                                              {cartQtyFor(p.id)}
                                            </span>
                                          )}
                                        </span>
                                        <span onClick={(e) => { e.stopPropagation(); openBuyAgent(p); }} className="flex flex-1 cursor-pointer items-center justify-center gap-1 rounded-lg border border-slate-200 bg-amber-500 py-1.5 text-[11px] font-semibold text-white transition-colors duration-200 group-hover:bg-amber-600">
                                          {t("Mua ngay")}
                                        </span>
                                      </span>
                                    )}
                                  </span>
                                </div>
                              </div>
                            );
                          })}
                        </EdgeFadeRow>
                      )}
                    </section>
                  );
                })
              }
            </>
          )}

          {
            selected && (
              <div className="mt-4">
                <button
                  onClick={() => setSelected(null)}
                  className="mb-3 text-sm text-slate-500 hover:text-slate-900"
                >
                  {t("← Tất cả kết quả")}
                </button>
                <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_260px] lg:items-start lg:gap-6">
                  <div className="max-w-5xl">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <ProductThumb product={selected} size={52} />
                        <div className="min-w-0">
                          <h2 className="flex items-center gap-1.5 text-lg font-semibold">
                            <span className="truncate">{selected.name}</span>
                            <button
                              type="button"
                              onClick={() => setInfoProduct(selected)}
                              title={t("Xem thông tin & chứng nhận")}
                              aria-label={t("Xem thông tin & chứng nhận")}
                              className="flex shrink-0 items-center justify-center text-slate-400 transition hover:text-emerald-600"
                            >
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                                <circle cx="12" cy="12" r="10" />
                                <path d="M12 16v-4" />
                                <path d="M12 8h.01" />
                              </svg>
                            </button>
                          </h2>
                          <p className="truncate text-sm text-slate-500">
                            {selected.brand} · {selected.unit} · {t("{n} cửa hàng", { n: offers.length })}
                          </p>
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {myAlert ? (
                          <div className="flex items-center gap-1 rounded-lg border border-emerald-300 bg-emerald-50 py-1 pl-2.5 pr-1 text-xs font-semibold text-emerald-700">
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M20 6 9 17l-5-5" />
                            </svg>
                            <span className="hidden sm:inline">{t("Đã đăng ký")}</span>
                            <button
                              onClick={openEditAlert}
                              title={t("Sửa số điện thoại")}
                              className="ml-1 rounded-md p-1 text-emerald-600 transition hover:bg-emerald-100"
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M12 20h9" />
                                <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
                              </svg>
                            </button>
                            <button
                              onClick={deleteAlert}
                              title={t("Huỷ đăng ký")}
                              className="rounded-md p-1 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                              </svg>
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setAlertOpen((v) => !v)}
                            title={t("Báo khi giảm giá")}
                            className="flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-amber-500 to-orange-500 px-3 py-1.5 text-xs font-bold text-white shadow-md shadow-amber-500/30 transition hover:from-amber-600 hover:to-orange-600 hover:shadow-lg"
                          >
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
                              <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
                            </svg>
                            <span>{t("Báo giá giảm")}</span>
                          </button>
                        )}
                      </div>
                    </div>

                    {
                      !userLoc && (
                        <button
                          onClick={() => setLocOpen(true)}
                          className="mt-3 flex w-full items-center gap-2.5 rounded-xl border border-blue-100 bg-blue-50 px-3.5 py-2.5 text-left text-sm text-blue-800 transition hover:bg-blue-100"
                        >
                          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-100 text-base">
                            📍
                          </span>
                          <span>
                            {geoState === "locating"
                              ? t("Đang định vị…")
                              : t("Chọn vị trí (định vị hoặc nhập địa chỉ) để xem khoảng cách tới từng cửa hàng và lọc theo bán kính.")}
                          </span>
                        </button>
                      )
                    }

                    {
                      cheapest && maxInStock > cheapest.price && (
                        <div className="mt-3 flex w-fit max-w-full items-center gap-2.5 rounded-xl border border-emerald-100 bg-emerald-50 px-3.5 py-2.5 text-sm text-emerald-800">
                          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-base">
                            💰
                          </span>
                          <span>
                            {t("Rẻ hơn {amount} nếu mua ở {store}", { amount: formatMoney(maxInStock - cheapest.price, storeCurrency(cheapest.storeId)), store: cheapest.store.name })}
                          </span>
                        </div>
                      )
                    }

                    {
                      alertOpen && (
                        <div
                          className="fixed inset-0 z-[2200] flex items-center justify-center bg-slate-900/30 backdrop-blur-md p-4"
                          onClick={() => setAlertOpen(false)}
                        >
                          <div
                            className="liquid-glass w-full max-w-sm rounded-3xl p-5 ring-1 ring-amber-200/70"
                            onClick={(e) => e.stopPropagation()}
                            style={{ WebkitBackdropFilter: "blur(32px)" }}
                          >
                            <div className="mb-3 flex items-start justify-between gap-3">
                              <p className="text-sm font-medium text-amber-900">
                                {myAlert
                                  ? `✏️ ${t("Sửa số nhận báo giá cho {name}", { name: selected.name })}`
                                  : `🔔 ${t("Để lại SĐT/Zalo, {name} giảm giá là mình báo ngay", { name: selected.name })}`}
                              </p>
                              <button
                                onClick={() => setAlertOpen(false)}
                                aria-label={t("Đóng")}
                                className="shrink-0 rounded-lg px-2 py-1 text-lg leading-none text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
                              >
                                ✕
                              </button>
                            </div>
                            <input
                              value={alertPhone}
                              onChange={(e) => setAlertPhone(e.target.value)}
                              onKeyDown={(e) => e.key === "Enter" && submitAlert()}
                              type="tel"
                              inputMode="tel"
                              autoFocus
                              placeholder={t("Số điện thoại / Zalo")}
                              className="w-full rounded-lg border border-amber-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-100"
                            />
                            <button
                              onClick={submitAlert}
                              className="mt-3 w-full rounded-lg border border-slate-200 bg-amber-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-amber-600"
                            >
                              {myAlert ? t("Lưu thay đổi") : t("Đăng ký")}
                            </button>
                            {myAlert && (
                              <button
                                onClick={deleteAlert}
                                className="mt-2 w-full rounded-lg border border-rose-200 px-4 py-2 text-sm font-medium text-rose-600 transition hover:bg-rose-50"
                              >
                                {t("Huỷ đăng ký")}
                              </button>
                            )}
                          </div>
                        </div>
                      )
                    }

                    {
                      displayOffers.length === 0 && offers.length === 0 && (
                        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-6 text-center">
                          <p className="text-sm text-slate-600">
                            {t("Sản phẩm này chưa có nhiều nơi bán để so sánh giá.")}
                          </p>
                          <button
                            onClick={() => openBuyForm(selected)}
                            className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-amber-500 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-amber-600"
                          >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <circle cx="9" cy="21" r="1" />
                              <circle cx="20" cy="21" r="1" />
                              <path d="M1 1h4l2.7 13.4a2 2 0 0 0 2 1.6h9.7a2 2 0 0 0 2-1.6L23 6H6" />
                            </svg>
                            {t("Vào mua")}
                          </button>
                        </div>
                      )
                    }

                    {
                      displayOffers.length === 0 && offers.length > 0 && (
                        <div className="mt-3 rounded-xl border border-dashed border-slate-300 bg-white px-4 py-6 text-center text-sm text-slate-500">
                          {t("Không có cửa hàng nào trong bán kính {r} km.", { r: radiusKm ?? 0 })}{" "}
                          <button
                            onClick={() => setRadiusKm(null)}
                            className="font-medium text-emerald-600 hover:underline"
                          >
                            {t("Bỏ giới hạn bán kính")}
                          </button>
                        </div>
                      )
                    }

                    {
                      displayOffers.length > 0 && (
                        <div className="mt-4 mb-3 flex items-center justify-between gap-3">
                          <span className="text-sm font-medium text-slate-500">{t("Sắp xếp theo")}</span>
                          <div className="flex overflow-hidden rounded-xl border border-slate-300 text-sm shadow-sm">
                            <button
                              onClick={() => setSortBy("price")}
                              className={`flex items-center gap-1.5 px-4 py-2 font-semibold transition ${sortBy === "price" ? "bg-slate-900 text-white" : "bg-white text-slate-600 hover:bg-slate-100"
                                }`}
                            >
                              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M20.59 13.41 13.42 20.6a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82Z" />
                                <circle cx="7" cy="7" r="1.2" fill="currentColor" />
                              </svg>
                              {t("Giá rẻ")}
                            </button>
                            <button
                              onClick={() => {
                                setSortBy("distance");
                                if (!userLoc) locate();
                              }}
                              title={userLoc ? "" : t("Bật vị trí để sắp theo khoảng cách")}
                              className={`flex items-center gap-1.5 px-4 py-2 font-semibold transition ${sortBy === "distance" ? "bg-slate-900 text-white" : "bg-white text-slate-600 hover:bg-slate-100"
                                }`}
                            >
                              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
                                <circle cx="12" cy="10" r="3" />
                              </svg>
                              {t("Gần nhất")}
                            </button>
                          </div>
                        </div>
                      )
                    }

                    <ul className="space-y-4">
                      {(() => {
                        // Gom nhóm theo chain
                        const chainMap = new Map<string, typeof displayOffers>();
                        for (const o of displayOffers) {
                          const key = o.store.chain;
                          if (!chainMap.has(key)) chainMap.set(key, []);
                          chainMap.get(key)!.push(o);
                        }
                        // Giữ thứ tự chain theo offer đầu tiên xuất hiện
                        const chainOrder: string[] = [];
                        for (const o of displayOffers) {
                          if (!chainOrder.includes(o.store.chain)) chainOrder.push(o.store.chain);
                        }

                        return chainOrder.map((chainKey) => {
                          const group = chainMap.get(chainKey)!;
                          // Best = rẻ+còn hàng trước, sau đó gần nhất; fallback = index 0
                          const best = group.find((o) => o.inStock && cheapest?.storeId === o.storeId)
                            ?? group.find((o) => o.inStock && nearestStoreId === o.storeId)
                            ?? group.find((o) => o.inStock)
                            ?? group[0];
                          const rest = group.filter((o) => o.storeId !== best.storeId);
                          const isExpanded = expandedChains.has(chainKey);

                          const renderOffer = (o: typeof best, isNested: boolean) => {
                            const isCheapest = cheapest?.storeId === o.storeId;
                            const isNearest = nearestStoreId === o.storeId;
                            const diff = cheapest && o.inStock ? o.price - cheapest.price : 0;
                            return (
                              <div
                                key={o.storeId}
                                onMouseEnter={() => setHoverStore(o.storeId)}
                                onMouseLeave={() => setHoverStore(null)}
                                className={`relative ${isNested ? "rounded-xl border bg-white p-2.5 shadow-sm" : ""} ${isNested
                                  ? isCheapest
                                    ? "border-emerald-300"
                                    : isNearest
                                      ? "border-blue-300"
                                      : "border-slate-200"
                                  : ""
                                  } ${!o.inStock && isNested ? "opacity-60" : ""} transition`}
                              >
                                {/* Tag nổi cho chi nhánh xổ ra — style outline để phân biệt với chi nhánh chính (nền đậm chữ trắng) */}
                                {isNested && (isCheapest || isNearest) && o.inStock && (
                                  <span className="pointer-events-none absolute -top-2 right-2.5 z-10 flex gap-1">
                                    {isCheapest && (
                                      <span className="rounded-full border border-emerald-500 bg-white px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-600 shadow-sm">
                                        {t("Rẻ nhất")}
                                      </span>
                                    )}
                                    {isNearest && (
                                      <span className="inline-flex items-center gap-1 rounded-full border border-blue-500 bg-white px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-blue-600 shadow-sm">
                                        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" /><circle cx="12" cy="10" r="3" /></svg>
                                        {t("Gần nhất")}
                                      </span>
                                    )}
                                  </span>
                                )}
                                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
                                  <div className="flex min-w-0 flex-1 items-start gap-3">
                                    <ChainBadge chain={o.store.chain} />
                                    <div className="min-w-0 flex-1">
                                      <div className="min-w-0 truncate font-semibold text-slate-900">
                                        {o.store.name}
                                      </div>
                                      <div className="truncate text-xs text-slate-500">{o.store.address}</div>
                                      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                                        <span
                                          className={`inline-flex items-center gap-1.5 font-medium ${o.inStock ? "text-emerald-600" : "text-red-500"
                                            }`}
                                        >
                                          <span
                                            className={`h-1.5 w-1.5 rounded-full ${o.inStock ? "bg-emerald-500" : "bg-red-400"
                                              }`}
                                          />
                                          {o.inStock ? t("Còn hàng") : t("Hết hàng")}
                                        </span>
                                        {o.distanceKm != null && (
                                          <>
                                            <span className="text-slate-300">·</span>
                                            <span className="inline-flex items-center gap-1 font-medium text-slate-600">
                                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                                                <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
                                                <circle cx="12" cy="10" r="3" />
                                              </svg>
                                              {t("cách bạn {km} km", { km: o.distanceKm.toFixed(1) })}
                                            </span>
                                            <a
                                              href={directionsUrl(o.store)}
                                              target="_blank"
                                              rel="noopener noreferrer"
                                              onClick={(e) => e.stopPropagation()}
                                              className="inline-flex items-center gap-0.5 font-medium text-blue-600 underline-offset-2 hover:text-blue-700 hover:underline"
                                            >
                                              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                                                <polyline points="9 18 15 12 9 6" />
                                              </svg>
                                              {t("Chỉ đường")}
                                            </a>
                                          </>
                                        )}
                                      </div>
                                      {o.lastChecked && (
                                        <div className="mt-0.5 text-[10px] font-normal text-slate-400">
                                          ({formatCheckedAt(o.lastChecked)})
                                        </div>
                                      )}
                                    </div>
                                  </div>

                                  <div className="flex items-center justify-between gap-3 pl-[3.25rem] sm:shrink-0 sm:justify-end sm:gap-4 sm:pl-0">
                                    <div className="text-right">
                                      <div
                                        className={`inline-flex items-center gap-1 text-lg font-extrabold tracking-tight ${isCheapest ? "text-emerald-600" : "text-slate-900"
                                          }`}
                                      >
                                        <svg className={`shrink-0 ${isCheapest ? "text-emerald-500" : "text-slate-400"}`} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                          <path d="M20.59 13.41 13.42 20.6a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82Z" />
                                          <circle cx="7" cy="7" r="1.2" fill="currentColor" />
                                        </svg>
                                        {formatMoney(o.price, storeCurrency(o.storeId))}
                                      </div>
                                      {diff > 0 && (
                                        <div className="max-w-[7.5rem] text-xs font-medium leading-snug text-slate-400">
                                          {t("Chênh {amount}", { amount: formatMoney(diff, storeCurrency(o.storeId)) })}
                                        </div>
                                      )}
                                    </div>

                                    <div className="flex items-center gap-2">
                                      <button
                                        type="button"
                                        onClick={(e) => { e.stopPropagation(); addToCart(o.product, o); }}
                                        className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-amber-300 bg-amber-50 text-xl font-bold text-amber-600 transition hover:bg-amber-100"
                                        title={t("Thêm vào giỏ")}
                                        aria-label={t("Thêm vào giỏ")}
                                      >
                                        +
                                        {cartItems.filter((i) => i.product.id === o.product.id && i.offer.store.id === o.storeId).reduce((s, i) => s + i.qty, 0) > 0 && (
                                          <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-amber-500 px-0.5 text-[10px] font-bold text-white">
                                            {cartItems.filter((i) => i.product.id === o.product.id && i.offer.store.id === o.storeId).reduce((s, i) => s + i.qty, 0)}
                                          </span>
                                        )}
                                      </button>
                                      <button
                                        onClick={() => setBuyOffer(o)}
                                        className="inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-slate-200 bg-amber-500 px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-amber-600"
                                      >
                                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                          <circle cx="9" cy="21" r="1" />
                                          <circle cx="20" cy="21" r="1" />
                                          <path d="M1 1h4l2.7 13.4a2 2 0 0 0 2 1.6h9.7a2 2 0 0 0 2-1.6L23 6H6" />
                                        </svg>
                                        {t("Mua ngay")}
                                      </button>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            );
                          };

                          const isBestCheapest = cheapest?.storeId === best.storeId;
                          const isBestNearest = nearestStoreId === best.storeId;

                          return (
                            <li
                              key={chainKey}
                              className={`relative rounded-2xl border transition ${isBestCheapest
                                ? "border-emerald-300 bg-emerald-50/50 shadow-sm"
                                : isBestNearest
                                  ? "border-blue-300 bg-blue-50/50 shadow-sm"
                                  : "border-slate-200 bg-white hover:border-slate-300 hover:shadow-sm"
                                } ${!best.inStock ? "opacity-60" : ""}`}
                            >
                              {(isBestCheapest || isBestNearest) && best.inStock && (
                                <span className="absolute -top-2.5 right-3 z-10 flex gap-1 pointer-events-none">
                                  {isBestCheapest && (
                                    <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-white shadow-sm">
                                      {t("Rẻ nhất")}
                                    </span>
                                  )}
                                  {isBestNearest && (
                                    <span className="inline-flex items-center gap-1 rounded-full bg-blue-600 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-white shadow-sm">
                                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" /><circle cx="12" cy="10" r="3" /></svg>
                                      {t("Gần nhất")}
                                    </span>
                                  )}
                                </span>
                              )}
                              <div className="p-3">
                                {renderOffer(best, false)}

                                {/* Nút xổ chi nhánh */}
                                {rest.length > 0 && (
                                  <button
                                    onClick={() => setExpandedChains((prev) => {
                                      const next = new Set(prev);
                                      if (next.has(chainKey)) next.delete(chainKey);
                                      else next.add(chainKey);
                                      return next;
                                    })}
                                    className="mt-2 flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium text-slate-500 transition hover:bg-slate-100 hover:text-slate-700"
                                  >
                                    <svg
                                      width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
                                      className={`transition-transform ${isExpanded ? "rotate-180" : ""}`}
                                    >
                                      <path d="m6 9 6 6 6-6" />
                                    </svg>
                                    {isExpanded
                                      ? t("Ẩn bớt")
                                      : t("{n} chi nhánh khác", { n: rest.length })}
                                  </button>
                                )}
                              </div>

                              {/* Chi nhánh xổ ra — cuộn dọc trong khung giới hạn để so sánh với chi nhánh mặc định ở trên */}
                              {isExpanded && rest.length > 0 && (
                                <div className="border-t border-slate-100 px-3 pb-3 pt-2">
                                  <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
                                    {rest.map((o) => renderOffer(o, true))}
                                  </div>
                                </div>
                              )}
                            </li>
                          );
                        });
                      })()}
                    </ul>

                    {/* Map desktop — nằm trong left column để không có khoảng trống */}
                    {
                      selected && (
                        <div className="mt-4 hidden overflow-hidden rounded-xl border border-slate-200 lg:block">
                          {/* Header đồng bộ với map trang chủ: địa chỉ (chạy chữ) + chip bán kính */}
                          {userLoc && (
                            <div className="border-b border-slate-100 px-3 py-2">
                              <div className="flex items-center gap-2">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                                  <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" /><circle cx="12" cy="10" r="3" />
                                </svg>
                                <MarqueeText className="text-xs font-medium text-slate-600">
                                  {userAddr || t("Vị trí của bạn")}
                                </MarqueeText>
                              </div>
                              <div className="mt-1.5 flex items-center gap-1 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                                {[0.05, 0.1, 0.15, 0.3, 0.5, 0.7, 1].map((r) => (
                                  <button
                                    key={r}
                                    type="button"
                                    onClick={() => setRadiusKm((cur) => (cur === r ? null : r))}
                                    className={`shrink-0 rounded-full border px-2.5 py-0.5 text-[11px] transition ${radiusKm === r
                                      ? "border-emerald-600 bg-emerald-600 text-white"
                                      : "border-slate-200 bg-white text-slate-500 hover:border-slate-300"
                                      }`}
                                  >
                                    {r < 1 ? `${Math.round(r * 1000)}m` : `${r}km`}
                                  </button>
                                ))}
                                {radiusKm !== null && (
                                  <button
                                    type="button"
                                    onClick={() => setRadiusKm(null)}
                                    title={t("Hiện tất cả cửa hàng, không giới hạn bán kính")}
                                    className="inline-flex shrink-0 items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-2.5 py-0.5 text-[11px] font-medium text-rose-600 transition hover:bg-rose-100"
                                  >
                                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
                                    {t("Bỏ giới hạn")}
                                  </button>
                                )}
                              </div>
                            </div>
                          )}
                          <div className="relative z-0 lg:h-[380px]">
                            <MapView
                              center={syncedCenter}
                              userLoc={userLoc}
                              userAddr={userAddr}
                              markers={markers}
                              highlightId={hoverStore}
                              radiusKm={radiusKm}
                              onRadiusChange={setRadiusKm}
                              lang={lang}
                              onBuy={(store) => openBuyForm(selected, store)}
                              onStorePick={setStoreProducts}
                              cskdTaxonomy={cskdTaxonomy}
                            />
                          </div>
                        </div>
                      )
                    }
                  </div >

                  {
                    similar.length > 0 && (
                      <aside className="mt-8 lg:mt-0">
                        <h3 className="mb-3 text-sm font-semibold text-slate-700">{t("Sản phẩm tương tự")}</h3>
                        <div className="flex flex-col gap-2">
                          {similar.map((p) => {
                            const st = priceStats.get(p.id);
                            return (
                              <button
                                key={p.id}
                                onClick={() => openProduct(p)}
                                className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-2 text-left transition hover:border-emerald-500 hover:shadow-sm"
                              >
                                <ProductThumb product={p} size={48} contain />
                                <span className="min-w-0 flex-1">
                                  <span className="line-clamp-2 text-xs font-medium leading-snug text-slate-800">
                                    {p.name}
                                  </span>
                                  {st && st.stores > 0 ? (
                                    <span className="mt-0.5 block text-sm font-bold text-rose-600">
                                      {formatMoney(st.min, st.currency)}
                                    </span>
                                  ) : st && st.outOfStock ? (
                                    <span className="mt-0.5 block text-xs font-medium text-red-500">
                                      {t("Hết hàng")}
                                    </span>
                                  ) : (
                                    <span className="mt-0.5 block text-xs text-slate-400">{t("Chưa có giá")}</span>
                                  )}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </aside>
                    )
                  }
                </div >
              </div >
            )
          }
        </section >

        {/* Map mobile — chỉ hiện trên mobile (lg: đã có map trong left column) */}
        {
          (selected || mobileView === "map") && (
            <section
              className={`overflow-hidden rounded-xl border border-slate-200 lg:hidden ${mobileView === "map" ? "block" : "hidden"
                }`}
            >
              {userLoc && (
                <div className="flex items-center gap-1.5 overflow-x-auto border-b border-slate-100 bg-white px-3 py-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  <span className="inline-flex shrink-0 items-center gap-1 pr-0.5 text-xs font-medium text-slate-500">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
                      <circle cx="12" cy="10" r="3" />
                    </svg>
                    {t("Bán kính")}
                  </span>
                  {[0.05, 0.1, 0.15, 0.3, 0.5, 0.7, 1].map((r) => (
                    <button
                      key={r}
                      onClick={() => setRadiusKm((cur) => (cur === r ? null : r))}
                      className={`shrink-0 rounded-full border px-2.5 py-0.5 text-xs transition ${radiusKm === r
                        ? "border-emerald-600 bg-emerald-600 text-white"
                        : "border-slate-200 bg-white text-slate-600 hover:bg-slate-100"
                        }`}
                    >
                      {r < 1 ? `${Math.round(r * 1000)}m` : "1km"}
                    </button>
                  ))}
                  {radiusKm !== null && (
                    <button
                      onClick={() => setRadiusKm(null)}
                      title={t("Hiện tất cả cửa hàng, không giới hạn bán kính")}
                      className="inline-flex shrink-0 items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-2.5 py-0.5 text-xs font-medium text-rose-600 transition hover:bg-rose-100"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M18 6 6 18M6 6l12 12" />
                      </svg>
                      {t("Bỏ giới hạn")}
                    </button>
                  )}
                </div>
              )}
              <div className={`relative z-0 ${mobileView === "map" ? "h-[calc(100vh-11rem)]" : "lg:h-[420px]"}`}>
                <MapView
                  center={selected ? syncedCenter : center}
                  userLoc={userLoc}
                  userAddr={userAddr}
                  markers={markers}
                  highlightId={hoverStore}
                  radiusKm={radiusKm}
                  onRadiusChange={setRadiusKm}
                  onViewChange={!selected ? (c) => setMapView(c) : undefined}
                  lang={lang}
                  onStorePick={setStoreProducts}
                  cskdTaxonomy={cskdTaxonomy}
                  onBuy={
                    selected
                      ? (store) => openBuyForm(selected, store)
                      : undefined
                  }
                />
              </div>
            </section>
          )}
      </main>

      <div className="mx-auto max-w-6xl px-4">
        <SiteStats
          t={t}
          products={catalog?.offers?.length ?? 0}
          stores={catalog ? new Set(catalog.offers.map((o) => o.storeId)).size : 0}
          brands={catalog ? new Set(catalog.products.map((p) => p.brand).filter(Boolean)).size : 0}
        />
      </div>

      <AppFooter lang={lang} />

      <button
        onClick={() => setMobileView((v) => (v === "list" ? "map" : "list"))}
        className="fixed bottom-4 left-1/2 z-30 flex -translate-x-1/2 items-center gap-2 rounded-full bg-slate-900 px-5 py-2.5 text-sm font-medium text-white shadow-lg lg:hidden"
      >
        {mobileView === "list" ? (
          <>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 18 3 21V6l6-3 6 3 6-3v15l-6 3-6-3Z" />
              <path d="M9 3v15M15 6v15" />
            </svg>
            {t("Bản đồ")}
          </>
        ) : (
          <>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
            </svg>
            {t("Danh sách")}
          </>
        )}
      </button>

      {/* Nút lên đầu trang — hiện khi đã kéo xuống xa. Đặt góc phải để không đè nút "Bản đồ". */}
      {
        showTop && (
          <button
            type="button"
            aria-label={t("Lên đầu trang")}
            title={t("Lên đầu trang")}
            onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
            className="fixed bottom-4 right-4 z-40 flex h-11 w-11 items-center justify-center rounded-full bg-white text-slate-700 shadow-lg ring-1 ring-slate-200 transition hover:bg-slate-50 hover:text-emerald-600"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m18 15-6-6-6 6" />
            </svg>
          </button>
        )
      }

      {
        toast && (
          <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-slate-900 px-4 py-2 text-sm text-white shadow-lg">
            {toast}
          </div>
        )
      }

      {
        cartOpen && cartItems.length > 0 && (
          <CartModal
            items={cartItems}
            lang={lang}
            onClose={() => {
              setCartOpen(false);
              // Đóng modal xong mới dọn các cửa hàng đã đặt khỏi giỏ (đã hoãn từ onOrdered).
              if (orderedStoreIds.length) {
                const ok = new Set(orderedStoreIds);
                setCartItems((prev) => prev.filter((i) => !ok.has(i.offer.store.id)));
                setOrderedStoreIds([]);
              }
            }}
            onUpdateQty={updateCartQty}
            onRemove={(pid, sid) => {
              removeFromCart(pid, sid);
              if (cartItems.length <= 1) setCartOpen(false);
            }}
            onOrderWithAgent={() => {
              // Giỏ toàn nhạc bản quyền → form đặt nhạc (không agentic). Trả true = đã xử lý.
              const allMusic = cartItems.length > 0 && cartItems.every((i) => i.offer.store.id === "khuccham");
              if (allMusic) {
                setCartOpen(false);
                setMusicOrder(cartItems.map((i) => ({ id: i.product.id, name: i.product.name, image: i.product.image || "", price: i.offer.price, qty: i.qty })));
                return true;
              }
              // Giỏ thường → để CartModal tự đặt nhiều cửa hàng (placeAll).
              return false;
            }}
            onOrdered={(okStoreIds) => {
              // KHÔNG xoá ngay — ghi nhận để dọn khi đóng modal, tránh giỏ rỗng làm
              // CartModal unmount trước khi màn "Đã ghi nhận đơn hàng" kịp hiển thị.
              setOrderedStoreIds(okStoreIds);
            }}
          />
        )
      }

      {
        musicOrder && (
          <MusicOrderModal
            items={musicOrder}
            lang={lang}
            onClose={() => setMusicOrder(null)}
            onPlaced={() => {
              recordMusicBuy(musicOrder);
              setToast(t("Đã đặt mua nhạc · {n} mục", { n: musicOrder.length }));
              setTimeout(() => setToast(""), 4000);
            }}
          />
        )
      }

      {
        buyTui && (
          <TuiAgentModal
            tuiName={buyTui.tenTui}
            lines={tuiOrderLines(buyTui)}
            comboPrice={tuiCombo(buyTui)}
            lang={lang}
            defaultName={undefined}
            defaultPhone={undefined}
            defaultAddress={userAddr}
            onClose={() => setBuyTui(null)}
            onPlaced={() => {
              recordTuiBuy(buyTui);
              setToast(t("Đã đặt cả túi {tui}", { tui: buyTui.tenTui }));
              setTimeout(() => setToast(""), 4000);
            }}
          />
        )
      }

      {
        buyOffer && (
          <OrderAgentModal
            offer={buyOffer}
            lang={lang}
            alternatives={allOffers.filter((o) => o.product.id === buyOffer.product.id)}
            geoAddr={userAddr}
            defaultAddress={userAddr}
            defaultQty={(() => {
              const base = cartQtyFor(buyOffer.product.id) || 1;
              const min = chainMinOrder(buyOffer.store.chain);
              if (min > 0 && buyOffer.price > 0) {
                const chainTotal = cartItems
                  .filter((i) => i.offer.store.chain === buyOffer.store.chain && i.product.id !== buyOffer.product.id)
                  .reduce((s, i) => s + i.offer.price * i.qty, 0);
                const needed = Math.max(0, min - chainTotal);
                return Math.max(base, Math.ceil(needed / buyOffer.price));
              }
              return base;
            })()}
            onClose={() => setBuyOffer(null)}
            onPlaced={(code, chosen) => {
              recordBuy(chosen);
              setToast(t("Đã đặt {product} tại {store} · {code}", { product: chosen.product.name, store: chosen.store.name, code }));
              setTimeout(() => setToast(""), 4000);
            }}
          />
        )
      }

      {
        txnnLiveOpen && (
          <OrderAgentModal
            offer={txnnLiveOffer}
            lang={lang}
            geoAddr={userAddr}
            defaultAddress={userAddr}
            onClose={() => setTxnnLiveOpen(false)}
            onPlaced={(code, chosen) => {
              recordBuy(chosen);
              setToast(t("TXNN đã hoàn tất · {code}", { code }));
              setTimeout(() => setToast(""), 4000);
            }}
          />
        )
      }

      {/* Modal "Liên hệ dịch vụ - Affree" — form intake có phân loại nhu cầu (Phương án 1+). */}
      {
        contactOpen && (() => {
          // Validate SĐT VN ngay khi gõ.
          const phoneDigits = contactPhone.replace(/[\s.\-()]/g, "").replace(/^(\+?84)/, "0");
          const phoneValid = /^0[35789]\d{8}$/.test(phoneDigits);
          const phoneError = contactPhone.trim().length > 0 && !phoneValid;
          // Form cấp phép nhạc: email BẮT BUỘC (để gửi hợp đồng/license).
          const isMusic = contactKind === "nhac-ban-quyen";
          // Form "Gửi lời yêu thương": tối giản — chỉ cần lời nhắn; tên/SĐT tùy chọn.
          const isLove = contactKind === "loi-yeu-thuong";
          const emailValid = isMusic
            ? /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail.trim())
            : (!contactEmail.trim() || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail.trim()));
          // SĐT: bắt buộc & hợp lệ cho form thường/nhạc; với "lời yêu thương" thì tùy chọn (rỗng cũng được).
          const phoneOk = isLove ? (!contactPhone.trim() || phoneValid) : phoneValid;
          const canSubmit =
            phoneOk && emailValid && (isLove || contactConsent) && !contactSubmitting &&
            (isLove ? contactMsg.trim().length > 0 : contactName.trim().length >= 2) &&
            (!isMusic || contactPurposes.length > 0);
          // Mục đích khai thác cho form cấp phép nhạc (KHÔNG có "Khác").
          const MUSIC_PURPOSES = [
            t("🎬 Quảng cáo / TVC"),
            t("📱 Video MXH (YT/TikTok/FB)"),
            t("🏪 Phát trong cửa hàng / quán"),
            t("🎤 Sự kiện / biểu diễn"),
            t("🎮 Game / App"),
          ];
          const togglePurpose = (p: string) =>
            setContactPurposes((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));
          // Placeholder thay đổi theo nhu cầu đã chọn — gợi ý cho khách điền cụ thể.
          const msgPlaceholder = {
            "tu-van": t("Vd: tư vấn so giá sữa cho quán cà phê, ngân sách 3tr/tháng…"),
            "hop-tac": t("Vd: muốn đăng sản phẩm mới lên Affree, làm nhãn tài trợ…"),
            "b2b": t("Vd: lấy sỉ 500kg gạo/tháng, cần báo giá kho bãi…"),
            "khac": t("Vd: báo lỗi giá, hợp tác sự kiện, đề xuất tính năng…"),
            "nhac-ban-quyen": t("Vd: mô tả dự án, deadline phát hành, kênh đăng…"),
            "loi-yeu-thuong": t("Vd: Cảm ơn Khúc Chạm vì những bài hát chữa lành…"),
          }[contactKind];
          const KINDS: Array<{ key: ContactKind; emoji: string; label: string }> = [
            { key: "tu-van", emoji: "🛒", label: t("Tư vấn mua sắm") },
            { key: "hop-tac", emoji: "🤝", label: t("Hợp tác bán hàng") },
            { key: "b2b", emoji: "📦", label: t("Phân phối / B2B") },
          ];
          return (
            <div
              className="fixed inset-0 z-[2100] flex items-center justify-center p-4"
              style={{ background: "rgba(0,0,0,0.35)", backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)" }}
              onClick={() => setContactOpen(false)}
            >
              <div
                className="relative flex w-full max-w-md max-h-[90vh] flex-col overflow-hidden rounded-3xl"
                onClick={(e) => e.stopPropagation()}
                style={{
                  // Nền trắng sữa đặc giống popup mua hàng (OrderAgentModal) → label/text RÕ,
                  // không bị backdrop tối làm chìm chữ.
                  backdropFilter: "blur(24px) saturate(160%)",
                  WebkitBackdropFilter: "blur(24px) saturate(160%)",
                  backgroundColor: "rgba(255,255,255,0.96)",
                  boxShadow: "0 0 0 1px rgba(255,255,255,0.5), 0 16px 48px rgba(0,0,0,0.18), inset 0 1px 0 rgba(255,255,255,0.7)",
                }}
              >
                <div className={`relative bg-gradient-to-br ${isLove ? 'from-amber-400 via-orange-400 to-rose-400' : 'from-emerald-50 via-white to-sky-50' } px-5 pb-3 pt-5`}>
                  <button
                    onClick={() => setContactOpen(false)}
                    aria-label={t("Đóng")}
                    className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full bg-white/80 text-slate-500 shadow-sm transition hover:bg-white hover:text-slate-800"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
                  </button>
                  <p className={`text-[10px] font-bold uppercase tracking-wider ${isLove ? 'text-white/80' : 'text-emerald-600'}`} pr-9>
                    {isMusic ? t("Nhạc bản quyền · Khúc Chạm") : isLove ? t("Khúc Chạm Channel") : t("Liên hệ Affree")}
                  </p>
                  <h3 className={`mt-0.5 text-base font-bold leading-snug text-slate-900 pr-9 ${isLove ? 'text-white' : ''}`}>
                    {isMusic ? t("Đề nghị cấp phép & khai thác thương mại") : isLove ? t("Gửi lời yêu thương 💚") : t("Để lại liên hệ")}
                  </h3>
                  {!isLove && (
                    <p className="mt-1 inline-flex items-center gap-1.5 text-[11px] font-medium text-emerald-600">
                      <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
                      {t("Phản hồi trong 24h")}
                    </p>
                  )}
                  {isLove && (
                    <>
                      <p className="mt-1.5 text-[11px] font-medium leading-snug text-white pr-9">
                        {t("Gửi lời nhắn yêu thương đến người thân — lời nhắn may mắn sẽ được Khúc Chạm phát sóng độc quyền vào sáng mai 🎁")}
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <a
                          href="https://zalo.me/0888803998"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-[12px] font-bold text-blue-600 shadow transition hover:bg-blue-50"
                        ><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.477 2 2 6.477 2 12c0 1.89.525 3.66 1.438 5.168L2 22l4.832-1.438A9.953 9.953 0 0 0 12 22c5.523 0 10-4.477 10-10S17.523 2 12 2Z"/></svg>
                          {t("Nhắn Zalo: 0888 803 998")}
                        </a>
                        <span className="inline-flex items-center gap-1 rounded-full bg-white/20 px-3 py-1.5 text-[11px] font-semibold text-white">
                          🎰 {t("Vòng quay may mắn")}
                        </span>
                      </div>
                    </>
                  )}
                </div>

                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    setContactError("");
                    if (isLove && !contactMsg.trim()) { setContactError(t("Vui lòng nhập lời nhắn")); return; }
                    if (!isLove && contactName.trim().length < 2) { setContactError(t("Vui lòng nhập họ tên (≥ 2 ký tự)")); return; }
                    if (!phoneOk) { setContactError(t("Số điện thoại không hợp lệ — dùng định dạng 09/03/05/07/08")); return; }
                    if (isMusic && !contactEmail.trim()) { setContactError(t("Vui lòng nhập email để nhận hợp đồng cấp phép")); return; }
                    if (!emailValid) { setContactError(t("Email không hợp lệ")); return; }
                    if (isMusic && contactPurposes.length === 0) { setContactError(t("Chọn ít nhất 1 mục đích khai thác")); return; }
                    if (!isLove && !contactConsent) { setContactError(t("Vui lòng tick đồng ý liên hệ qua SĐT")); return; }
                    setContactSubmitting(true);
                    // Lưu tên + SĐT + khu vực vào profile cho lần sau auto-fill.
                    saveProfile({ name: contactName.trim(), phone: phoneDigits, address: contactArea.trim() });
                    try {
                      await fetch("/api/contact", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          kind: contactKind,
                          name: contactName.trim(),
                          phone: phoneDigits,
                          area: contactArea.trim(),
                          email: contactEmail.trim(),
                          msg: contactMsg.trim(),
                          // Người nhận lời nhắn (chỉ form "lời yêu thương").
                          ...(isLove && { recipient: contactRecipient.trim() }),
                          // Field riêng form cấp phép nhạc (chỉ gửi khi đúng loại).
                          ...(contactKind === "nhac-ban-quyen" && {
                            company: contactCompany.trim(),
                            purposes: contactPurposes,
                            album: contactAlbum.trim(),
                            scope: contactScope.trim(),
                            budget: contactBudget.trim(),
                          }),
                        }),
                      });
                    } catch {
                      // im lặng — vẫn báo thành công vì đã lưu localStorage
                    }
                    setContactSubmitting(false);
                    setContactOpen(false);
                    setToast(t("Đã ghi nhận — đội Affree sẽ liên hệ sớm. Cảm ơn bạn!"));
                    setTimeout(() => setToast(""), 3500);
                  }}
                  className="flex-1 overflow-y-auto px-5 py-4"
                >
                  {!isMusic && !isLove && (
                    <div className="mb-3">
                      <label className="mb-1.5 block text-[11px] font-semibold text-slate-700">
                        {t("Bạn cần Affree hỗ trợ gì?")} <span className="text-rose-500">*</span>
                      </label>
                      <div className="grid grid-cols-2 gap-2">
                        {KINDS.map((k) => {
                          const active = contactKind === k.key;
                          return (
                            <button
                              key={k.key}
                              type="button"
                              onClick={() => setContactKind(k.key)}
                              className={`flex items-center gap-2 rounded-xl border px-2.5 py-2 text-left text-xs transition ${active
                                ? "border-emerald-500 bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200"
                                : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"
                                }`}
                            >
                              <span className="text-base">{k.emoji}</span>
                              <span className="line-clamp-2 font-medium leading-tight">{k.label}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Form "lời yêu thương": lời nhắn (field bắt buộc DUY NHẤT) lên đầu,
                      thông tin liên hệ tùy chọn gom xuống dưới cho đúng tinh thần tối giản. */}
                  {isLove && (
                    <>
                      <label className="mb-3 block">
                        <span className="mb-1 block text-[11px] font-medium text-slate-600">
                          {t("Lời nhắn yêu thương")} <span className="text-rose-500">*</span>
                        </span>
                        <textarea
                          value={contactMsg}
                          onChange={(e) => setContactMsg(e.target.value)}
                          rows={4}
                          autoFocus
                          className="w-full resize-none rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                          placeholder={msgPlaceholder}
                        />
                      </label>

                      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                        {t("Thông tin liên hệ (tùy chọn)")}
                      </p>

                      <label className="mb-2.5 block">
                        <span className="mb-1 block text-[11px] font-medium text-slate-600">
                          {t("Gửi đến ai (người thân)")}
                        </span>
                        <input
                          type="text"
                          value={contactRecipient}
                          onChange={(e) => setContactRecipient(e.target.value)}
                          className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                          placeholder={t("Vd: Mẹ, Ba, người thương…")}
                        />
                      </label>

                      <div className="mb-1 grid grid-cols-2 gap-2">
                        <label className="block">
                          <span className="mb-1 block text-[11px] font-medium text-slate-600">{t("Tên người gửi")}</span>
                          <input
                            type="text"
                            value={contactName}
                            onChange={(e) => setContactName(e.target.value)}
                            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                            placeholder={t("Vd: Nguyễn Văn A")}
                          />
                        </label>
                        <label className="block">
                          <span className="mb-1 block text-[11px] font-medium text-slate-600">{t("SĐT / Zalo")}</span>
                          <input
                            type="tel"
                            value={contactPhone}
                            onChange={(e) => setContactPhone(e.target.value)}
                            className={`w-full rounded-xl border bg-white px-3 py-2 text-sm outline-none focus:ring-2 ${phoneError
                              ? "border-rose-300 focus:border-rose-400 focus:ring-rose-100"
                              : "border-slate-200 focus:border-emerald-400 focus:ring-emerald-100"
                              }`}
                            placeholder={t("Vd: 09xxxxxxxx")}
                          />
                        </label>
                      </div>
                      {phoneError ? (
                        <span className="mb-2 block text-[11px] text-rose-600">
                          {t("Số chưa đúng định dạng — bắt đầu bằng 03/05/07/08/09, đủ 10 số")}
                        </span>
                      ) : (
                        <span className="mb-2 block text-[11px] text-slate-400">
                          {t("Để Khúc Chạm kết nối nếu lời nhắn được chọn phát sóng 💚")}
                        </span>
                      )}
                    </>
                  )}

                  {!isLove && (
                    <label className="mb-2.5 block">
                      <span className="mb-1 block text-[11px] font-medium text-slate-600">
                        {t("Họ tên")} <span className="text-rose-500">*</span>
                      </span>
                      <input
                        type="text"
                        value={contactName}
                        onChange={(e) => setContactName(e.target.value)}
                        required
                        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                        placeholder={t("Vd: Nguyễn Văn A")}
                      />
                    </label>
                  )}

                  {!isLove && (
                    <label className="mb-2.5 block">
                      <span className="mb-1 block text-[11px] font-medium text-slate-600">
                        {t("SĐT / Zalo")} <span className="text-rose-500">*</span>
                      </span>
                      <input
                        type="tel"
                        value={contactPhone}
                        onChange={(e) => setContactPhone(e.target.value)}
                        required
                        className={`w-full rounded-xl border bg-white px-3 py-2 text-sm outline-none focus:ring-2 ${phoneError
                          ? "border-rose-300 focus:border-rose-400 focus:ring-rose-100"
                          : "border-slate-200 focus:border-emerald-400 focus:ring-emerald-100"
                          }`}
                        placeholder={t("Vd: 09xxxxxxxx")}
                      />
                      {phoneError && (
                        <span className="mt-1 block text-[11px] text-rose-600">
                          {t("Số chưa đúng định dạng — bắt đầu bằng 03/05/07/08/09, đủ 10 số")}
                        </span>
                      )}
                    </label>
                  )}

                  {!isMusic && !isLove && (
                    <label className="mb-2.5 block">
                      <span className="mb-1 block text-[11px] font-medium text-slate-600">{t("Khu vực")}</span>
                      <input
                        type="text"
                        value={contactArea}
                        onChange={(e) => setContactArea(e.target.value)}
                        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                        placeholder={t("Vd: TP HCM, Q1 (tự điền từ định vị)")}
                      />
                    </label>
                  )}

                  {isMusic && (
                    <>
                      <label className="mb-2.5 block">
                        <span className="mb-1 block text-[11px] font-medium text-slate-600">
                          {t("Email")} <span className="text-rose-500">*</span>
                        </span>
                        <input
                          type="email"
                          value={contactEmail}
                          onChange={(e) => setContactEmail(e.target.value)}
                          required
                          className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                          placeholder={t("Vd: ten@congty.com (nhận hợp đồng cấp phép)")}
                        />
                      </label>

                      <label className="mb-2.5 block">
                        <span className="mb-1 block text-[11px] font-medium text-slate-600">{t("Đơn vị / thương hiệu")}</span>
                        <input
                          type="text"
                          value={contactCompany}
                          onChange={(e) => setContactCompany(e.target.value)}
                          className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                          placeholder={t("Vd: Cá nhân, hoặc Công ty ABC")}
                        />
                      </label>

                      <div className="mb-2.5">
                        <span className="mb-1 block text-[11px] font-medium text-slate-600">
                          {t("Mục đích khai thác")} <span className="text-rose-500">*</span>
                        </span>
                        <div className="flex flex-wrap gap-1.5">
                          {MUSIC_PURPOSES.map((p) => {
                            const active = contactPurposes.includes(p);
                            return (
                              <button
                                key={p}
                                type="button"
                                onClick={() => togglePurpose(p)}
                                className={`rounded-full border px-2.5 py-1 text-xs font-medium transition ${active
                                  ? "border-orange-400 bg-orange-50 text-orange-700 ring-1 ring-orange-200"
                                  : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                                  }`}
                              >
                                {p}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      <label className="mb-2.5 block">
                        <span className="mb-1 block text-[11px] font-medium text-slate-600">{t("Bài / Album quan tâm")}</span>
                        <select
                          value={contactAlbum}
                          onChange={(e) => setContactAlbum(e.target.value)}
                          className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                        >
                          <option value="">{t("Chọn")}</option>
                          <option value={t("Toàn bộ kho nhạc")}>{t("Toàn bộ kho nhạc")}</option>
                          {SEED_MUSIC.map((al) => (
                            <option key={al.id} value={al.title}>{al.title}</option>
                          ))}
                          <option value={t("Chưa rõ, cần tư vấn")}>{t("Chưa rõ, cần tư vấn")}</option>
                        </select>
                      </label>

                      <label className="mb-2.5 block">
                        <span className="mb-1 block text-[11px] font-medium text-slate-600">{t("Phạm vi & thời hạn")}</span>
                        <input
                          type="text"
                          value={contactScope}
                          onChange={(e) => setContactScope(e.target.value)}
                          className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                          placeholder={t("Vd: VN, 12 tháng / Toàn cầu, vĩnh viễn")}
                        />
                      </label>

                      <label className="mb-2.5 block">
                        <span className="mb-1 block text-[11px] font-medium text-slate-600">{t("Ngân sách dự kiến")}</span>
                        <input
                          type="text"
                          value={contactBudget}
                          onChange={(e) => setContactBudget(e.target.value)}
                          className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                          placeholder={t("Vd: 5–10tr (để gợi ý gói phù hợp)")}
                        />
                      </label>
                    </>
                  )}

                  {(contactKind === "hop-tac" || contactKind === "b2b") && (
                    <label className="mb-2.5 block">
                      <span className="mb-1 block text-[11px] font-medium text-slate-600">{t("Email")}</span>
                      <input
                        type="email"
                        value={contactEmail}
                        onChange={(e) => setContactEmail(e.target.value)}
                        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                        placeholder={t("Vd: ten@congty.com")}
                      />
                    </label>
                  )}

                  {!isLove && (
                    <label className="mb-3 block">
                      <span className="mb-1 block text-[11px] font-medium text-slate-600">{t("Nội dung cụ thể")}</span>
                      <textarea
                        value={contactMsg}
                        onChange={(e) => setContactMsg(e.target.value)}
                        rows={3}
                        className="w-full resize-none rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                        placeholder={msgPlaceholder}
                      />
                    </label>
                  )}

                  {!isLove && (
                    <label className="mb-3 flex items-start gap-2 text-[12px] text-slate-600">
                      <input
                        type="checkbox"
                        checked={contactConsent}
                        onChange={(e) => setContactConsent(e.target.checked)}
                        className="mt-0.5 h-4 w-4 cursor-pointer accent-emerald-600"
                      />
                      <span>{t("Tôi đồng ý Affree liên hệ lại qua SĐT/Zalo đã cung cấp.")}</span>
                    </label>
                  )}

                  {contactError && (
                    <p className="mb-2 rounded-lg bg-rose-50 px-3 py-2 text-[12px] text-rose-700 ring-1 ring-rose-100">
                      {contactError}
                    </p>
                  )}

                  <button
                    type="submit"
                    disabled={!canSubmit}
                    className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 active:scale-95 disabled:cursor-not-allowed disabled:bg-slate-300"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7Z" /></svg>
                    {contactSubmitting ? t("Đang gửi…") : isMusic ? t("Gửi đề nghị cấp phép") : isLove ? t("Gửi lời yêu thương") : t("Gửi liên hệ")}
                  </button>
                </form>
              </div>
            </div>
          );
        })()}

      {/* Modal sản phẩm của 1 cửa hàng — mở từ pin trên bản đồ HOẶC từ click sponsor logo.
          Sponsor click set id = "__brand__<lower-name>" → offers filter theo brand thay vì storeId.
          Brand mode dùng RAW catalog (chưa filter region) để show full brand bất kể vùng. */}
      {
        storeProducts && (rawCatalog || catalog) && (() => {
          const isBrandMode = storeProducts.id.startsWith("__brand__");
          const sourceCat = isBrandMode ? (rawCatalog || catalog!) : catalog!;
          const brandLower = isBrandMode ? storeProducts.id.slice("__brand__".length) : "";
          const productMap = new Map(sourceCat.products.map((p) => [p.id, p]));
          // Emoji danh mục lấy từ SHEET (tab "tệp" → catalog.groups) để header section trang
          // cửa hàng KHỚP với tile trang chủ — quản lý 1 nơi duy nhất là Google Sheet.
          const groupEmoji: Record<string, string> = {};
          (sourceCat.groups || []).forEach((g) => {
            const label = (g.label || "").trim();
            const emoji = (g.emoji || "").trim();
            if (label && emoji) groupEmoji[label] = emoji;
          });
          const offersForView = isBrandMode
            ? sourceCat.offers.filter((o) => {
              const p = productMap.get(o.productId);
              return p && (p.brand || "").toLowerCase().trim() === brandLower;
            })
            : sourceCat.offers.filter((o) => o.storeId === storeProducts.id);
          return (
            <StoreProductsPage
              store={storeProducts}
              offers={offersForView}
              productMap={productMap}
              userLoc={userLoc}
              lang={lang}
              headerH={headerH}
              groupEmoji={groupEmoji}
              onClose={() => setStoreProducts(null)}
              onBuy={(ranked) => {
                setStoreProducts(null);
                setBuyOffer(ranked);
              }}
            />
          );
        })()}

      {/* Modal "Sản phẩm trong túi" — mở từ nút ⓘ trên thẻ túi. Bấm ⓘ trên từng SP → mở [[infoProduct]]. */}
      {
        tuiInfo && catalog && (
          <div
            className="fixed inset-0 z-[2050] flex items-center justify-center bg-black/40 backdrop-blur-md p-4"
            onClick={() => setTuiInfo(null)}
          >
            <div
              className="flex w-full max-w-md max-h-[90vh] flex-col overflow-hidden rounded-3xl bg-white shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="relative bg-gradient-to-br from-violet-50 via-white to-emerald-50 px-5 pb-4 pt-5">
                <button
                  onClick={() => setTuiInfo(null)}
                  aria-label={t("Đóng")}
                  className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full bg-white/80 text-slate-500 shadow-sm transition hover:bg-white hover:text-slate-800"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
                </button>
                <p className="text-[10px] font-bold uppercase tracking-wider text-violet-600">
                  🛍️ {loaiLabel(tuiInfo.loai)}
                </p>
                <h3 className="mt-0.5 pr-8 text-base font-bold leading-snug text-slate-900">
                  {tuiInfo.tenTui}
                </h3>
                <p className="mt-1 truncate text-xs text-slate-500">
                  {tuiInfo.chuyenTrang} · {t("{n} món", { n: tuiInfo.items.length })} · {formatMoney(tuiCombo(tuiInfo))}
                </p>
              </div>
              <div className="flex-1 overflow-y-auto px-3 py-3">
                <ul className="space-y-2">
                  {tuiInfo.items.map((it) => {
                    const p = catalog.products.find((x) => x.id === it.productId);
                    const gia = it.gia || priceStats.get(it.productId)?.min || 0;
                    return (
                      <li key={it.productId} className="rounded-xl border border-slate-200 bg-white p-2.5">
                        <div className="flex items-center gap-3">
                          <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-slate-50">
                            {p ? <ProductThumb product={p} size={48} contain /> : <span className="text-xs font-bold text-slate-400">{it.name.slice(0, 2)}</span>}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="line-clamp-2 text-sm font-medium leading-snug text-slate-800">{p?.name || it.name}</p>
                            {p && (p.brand || p.unit) && <p className="truncate text-[11px] text-slate-400">{[p.brand, p.unit ? t(p.unit) : null].filter(Boolean).join(" · ")}</p>}
                            {gia > 0 && <p className="mt-0.5 text-sm font-bold text-rose-600">{formatMoney(gia)}</p>}
                          </div>
                        </div>
                        {p?.info && (
                          <p className="mt-2 whitespace-pre-wrap rounded-lg bg-slate-50 px-3 py-2 text-[12px] leading-relaxed text-slate-600">{p.info}</p>
                        )}
                        {p?.certifications && p.certifications.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {p.certifications.map((url, i) => (
                              // eslint-disable-next-line @next/next/no-img-element
                              <a key={i} href={url} target="_blank" rel="noopener noreferrer" title={t("Chứng nhận {n}", { n: i + 1 })} className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-white transition hover:border-emerald-400">
                                <img src={url} alt={t("Chứng nhận {n}", { n: i + 1 })} loading="lazy" className="h-full w-full object-contain p-1" />
                              </a>
                            ))}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
              <div className="border-t border-slate-100 bg-slate-50 px-5 py-3">
                <button
                  type="button"
                  onClick={() => { buyTuiWithAgent(tuiInfo); setTuiInfo(null); }}
                  className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-amber-500 py-2.5 text-sm font-semibold text-white transition hover:bg-amber-600"
                >
                  🛍️ {t("Mua cả túi")}
                </button>
              </div>
            </div>
          </div>
        )
      }

      {/* Modal thông tin sản phẩm (nút ⓘ) */}
      {
        infoProduct && (
          <div
            className="fixed inset-0 z-[2100] flex items-center justify-center bg-black/30 backdrop-blur-md p-4"
            onClick={() => setInfoProduct(null)}
          >
            <div
              className="liquid-glass flex w-full max-w-md max-h-[90vh] flex-col overflow-hidden rounded-3xl"
              onClick={(e) => e.stopPropagation()}
              style={{ WebkitBackdropFilter: "blur(32px)", backdropFilter: "blur(32px)" }}
            >
              {/* Header gradient + thumb + tên */}
              <div className="relative bg-gradient-to-br from-emerald-50/80 via-white/40 to-sky-50/80 px-5 pb-4 pt-5">
                <button
                  onClick={() => setInfoProduct(null)}
                  aria-label={t("Đóng")}
                  className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full bg-white/80 text-slate-500 shadow-sm backdrop-blur transition hover:bg-white hover:text-slate-800"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
                </button>
                <div className="flex items-start gap-4">
                  <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-100">
                    <ProductThumb product={infoProduct} size={80} contain />
                  </div>
                  <div className="min-w-0 flex-1 pr-8 pt-1">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-600">
                      {t("Thông tin sản phẩm")}
                    </p>
                    <h3 className="mt-0.5 text-base font-bold leading-snug text-slate-900">
                      {infoProduct.name}
                    </h3>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      {infoProduct.brand && (
                        <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-700 ring-1 ring-slate-200">
                          {infoProduct.brand}
                        </span>
                      )}
                      {infoProduct.unit && (
                        <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-medium text-slate-500 ring-1 ring-slate-200">
                          {t(infoProduct.unit)}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Body cuộn được */}
              <div className="flex-1 overflow-y-auto px-5 py-4">
                {infoProduct.info ? (
                  <section>
                    <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><path d="M12 16v-4" /><path d="M12 8h.01" /></svg>
                      {t("Mô tả")}
                    </h4>
                    <div className="whitespace-pre-wrap rounded-xl bg-slate-50/80 px-4 py-3 text-sm leading-relaxed text-slate-700 ring-1 ring-slate-100">
                      {infoProduct.info}
                    </div>
                  </section>
                ) : (
                  <p className="rounded-xl bg-slate-50/80 px-4 py-6 text-center text-xs text-slate-400 ring-1 ring-slate-100">
                    {t("Chưa có mô tả cho sản phẩm này.")}
                  </p>
                )}

                {infoProduct.certifications && infoProduct.certifications.length > 0 && (
                  <section className="mt-5">
                    <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="7" /><path d="M8.21 13.89 7 22l5-3 5 3-1.21-8.12" /></svg>
                      {t("Chứng nhận")}
                      <span className="rounded-full bg-emerald-100 px-1.5 text-[10px] font-bold text-emerald-700">
                        {infoProduct.certifications.length}
                      </span>
                    </h4>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                      {infoProduct.certifications.map((url, i) => (
                        <a
                          key={i}
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="group relative block overflow-hidden rounded-lg border border-slate-200 bg-white transition hover:border-emerald-400 hover:shadow-md"
                        >
                          <div className="flex aspect-square items-center justify-center bg-slate-50">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={url}
                              alt={t("Chứng nhận {n}", { n: i + 1 })}
                              loading="lazy"
                              className="h-full w-full object-contain p-1.5"
                            />
                          </div>
                          <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent px-2 pb-1 pt-4 text-[10px] font-medium text-white opacity-0 transition group-hover:opacity-100">
                            {t("Xem ảnh lớn")}
                          </span>
                        </a>
                      ))}
                    </div>
                  </section>
                )}
              </div>

              {/* Footer */}
              <div className="border-t border-slate-100 bg-white/60 px-5 py-3">
                <button
                  onClick={() => setInfoProduct(null)}
                  className="w-full rounded-xl bg-slate-900 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800"
                >
                  {t("Đóng")}
                </button>
              </div>
            </div>
          </div>
        )
      }

      {
        buyProduct && (
          <div
            className="fixed inset-0 z-[2200] flex items-center justify-center bg-slate-900/30 backdrop-blur-md p-4"
            onClick={() => !buySubmitting && setBuyProduct(null)}
          >
            <div
              className="liquid-glass w-full max-w-md max-h-[85vh] overflow-y-auto rounded-3xl p-5 ring-1 ring-amber-200/70"
              onClick={(e) => e.stopPropagation()}
              style={{ WebkitBackdropFilter: "blur(32px)" }}
            >
              <div className="mb-3 flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <ProductThumb product={buyProduct} size={44} />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-800">{buyProduct.name}</p>
                    <p className="truncate text-xs text-slate-500">
                      {buyProduct.brand} · {buyProduct.unit}
                      {(() => {
                        const ps = priceStats.get(buyProduct.id);
                        return ps?.min ? ` · ${formatMoney(ps.min, ps.currency)}` : "";
                      })()}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => !buySubmitting && setBuyProduct(null)}
                  aria-label={t("Đóng")}
                  className="shrink-0 rounded-lg px-2 py-1 text-lg leading-none text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
                >
                  ✕
                </button>
              </div>

              <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                {t("Điền thông tin nhận hàng, shop sẽ liên hệ xác nhận và giao tận nơi.")}
              </p>

              {/* Cấu trúc field ĐỒNG BỘ với form giỏ hàng (CartModal): label + placeholder giống nhau */}
              <section className="rounded-2xl border border-slate-200 p-3">
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {t("Thông tin chung")}
                </h3>
                <div className="space-y-2.5">
                  <label className="block">
                    <span className="mb-1 block text-xs font-semibold text-slate-800">{t("Họ tên")}</span>
                    <input
                      value={buyName}
                      onChange={(e) => setBuyName(e.target.value)}
                      placeholder={t("Nguyễn Văn A")}
                      autoFocus
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-100"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs font-semibold text-slate-800">{t("Số điện thoại / Zalo")}</span>
                    <input
                      value={buyPhone}
                      onChange={(e) => setBuyPhone(e.target.value)}
                      type="tel"
                      inputMode="tel"
                      placeholder="0912 345 678"
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-100"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs font-semibold text-slate-800">{t("Địa chỉ giao hàng")}</span>
                    <textarea
                      value={buyAddr}
                      onChange={(e) => setBuyAddr(e.target.value)}
                      rows={2}
                      placeholder={t("Số nhà, đường, phường, quận…")}
                      className="w-full resize-none rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-100"
                    />
                  </label>
                </div>
              </section>
              <section className="mt-3 rounded-2xl border border-slate-200 p-3">
                <div className="space-y-2.5">
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-slate-500">{t("Số lượng")}</span>
                    <div className="flex items-center overflow-hidden rounded-lg border border-slate-300">
                      <button
                        onClick={() => setBuyQty((q) => Math.max(1, q - 1))}
                        className="px-3 py-2 text-slate-600 transition hover:bg-slate-100"
                      >
                        −
                      </button>
                      <span className="min-w-[2.5rem] text-center text-sm font-semibold">{buyQty}</span>
                      <button
                        onClick={() => setBuyQty((q) => Math.min(99, q + 1))}
                        className="px-3 py-2 text-slate-600 transition hover:bg-slate-100"
                      >
                        +
                      </button>
                    </div>
                  </div>
                  <label className="block">
                    <span className="mb-1 block text-xs font-semibold text-slate-800">{t("Ghi chú")}</span>
                    <textarea
                      value={buyNote}
                      onChange={(e) => setBuyNote(e.target.value)}
                      rows={2}
                      placeholder={t("Ghi chú (tuỳ chọn): màu sắc, kích cỡ, thời gian nhận…")}
                      className="w-full resize-none rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-100"
                    />
                  </label>
                </div>
              </section>

              <button
                onClick={submitBuy}
                disabled={buySubmitting}
                className="mt-4 w-full rounded-lg border border-slate-200 bg-amber-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-amber-600 disabled:opacity-60"
              >
                {buySubmitting ? t("Đang gửi…") : t("Gửi yêu cầu mua")}
              </button>
            </div>
          </div>
        )
      }
    </div >
  );
}
