"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { Catalog, Product, RankedOffer } from "@/lib/types";
import { getStores } from "@/lib/stores";
import {
  cheapestInStock,
  directionsUrl,
  distanceKm,
  formatVnd,
  rankOffersForProduct,
  searchProductsRanked,
} from "@/lib/util";
import { addPurchase } from "@/lib/purchases";
import { addAlert } from "@/lib/alerts";
import { getViewCounts, recordView } from "@/lib/recent";
import { ChainBadge } from "@/components/ChainBadge";
import { Logo } from "@/components/Logo";
import type { MapMarker } from "@/components/MapView";

const MapView = dynamic(() => import("@/components/MapView"), { ssr: false });

const HCM_CENTER: [number, number] = [10.7769, 106.7009];

/** Đổi toạ độ → địa chỉ gọn bằng Nominatim (OSM, miễn phí). Lỗi thì trả "". */
async function reverseGeocode(lat: number, lng: number): Promise<string> {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1&accept-language=vi`;
    const res = await fetch(url, { headers: { "Accept-Language": "vi" } });
    if (!res.ok) return "";
    const data = await res.json();
    const a = data?.address ?? {};
    const parts = [
      [a.house_number, a.road].filter(Boolean).join(" "),
      a.suburb || a.quarter || a.neighbourhood,
      a.city_district || a.district || a.county,
      a.city || a.town,
    ].filter(Boolean);
    return parts.length ? parts.join(", ") : (data?.display_name ?? "");
  } catch {
    return "";
  }
}

// Khung nhìn (viewbox) bao vùng TP.HCM mở rộng — tất cả cửa hàng đều ở đây.
// Dùng để ưu tiên kết quả geocode trong vùng, tránh chọn nhầm đường trùng tên ở
// tỉnh khác (vd "Nguyễn Quang Bích" có ở Rạch Giá, Huế… cách HCM ~200km).
// Format Nominatim: viewbox=<lonMin>,<latMax>,<lonMax>,<latMin>
const HCM_VIEWBOX = "106.30,11.20,107.05,10.30";

async function nominatimSearch(q: string, bounded: boolean): Promise<GeoResult[]> {
  const url =
    `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}` +
    `&addressdetails=1&limit=6&accept-language=vi&countrycodes=vn` +
    `&viewbox=${HCM_VIEWBOX}${bounded ? "&bounded=1" : ""}`;
  const res = await fetch(url, { headers: { "Accept-Language": "vi" } });
  if (!res.ok) return [];
  const data = await res.json();
  return (Array.isArray(data) ? data : [])
    .map((d: { display_name?: string; lat?: string; lon?: string }) => ({
      label: d.display_name ?? "",
      lat: parseFloat(d.lat ?? ""),
      lng: parseFloat(d.lon ?? ""),
    }))
    .filter((r: GeoResult) => Number.isFinite(r.lat) && Number.isFinite(r.lng));
}

/**
 * Tìm địa chỉ → toạ độ (forward geocode) qua Nominatim/OSM.
 * Ưu tiên (bounded) trong vùng TP.HCM để không chọn nhầm đường trùng tên ở tỉnh khác;
 * nếu trong vùng không có kết quả nào thì mới nới ra toàn quốc.
 */
async function forwardGeocode(q: string): Promise<GeoResult[]> {
  try {
    const inHcm = await nominatimSearch(q, true);
    if (inHcm.length) return inHcm;
    return await nominatimSearch(q, false);
  } catch {
    return [];
  }
}

type GeoResult = { label: string; lat: number; lng: number };
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

// Dữ liệu nguồn có ~170 danh mục lộn xộn (trùng hoa/thường, lẫn cả điện tử/thời trang).
// Gom về vài nhóm grocery + "Khác" để chip danh mục gọn, dễ nhìn. Thứ tự test = ưu tiên.
const CATEGORY_GROUPS: { label: string; test: RegExp }[] = [
  { label: "Mẹ & bé", test: /\bbé\b|\bmẹ\b|bỉm|bĩm|\btã\b|dinh dưỡng cho mẹ/ },
  {
    label: "Nhà cửa & vệ sinh",
    test: /nhà cửa|nhà bếp|giặt|hóa phẩm|đồ dùng gia đình|giấy vệ sinh|khăn giấy|chăm sóc gia đình|chăm sóc nhà|đời sống/,
  },
  {
    label: "Chăm sóc cá nhân",
    test: /chăm sóc (da|tóc|cơ thể|cá nhân|sức khỏe|bé)|tắm gội|sắc đẹp|sức khỏe|trang điểm|mỹ phẩm|nước hoa|vitamin|vatamin|răng miệng|dầu xả|làm đẹp/,
  },
  { label: "Đồ uống", test: /bia|rượu|nước giải khát|nước uống|đồ uống|thức uống|\btrà\b|cà phê/ },
  { label: "Sữa", test: /sữa/ },
  {
    label: "Thực phẩm",
    test: /thịt|cá|trứng|hải sản|rau|củ|quả|nấm|trái cây|gạo|bột|đồ khô|mì|miến|cháo|phở|nui|bún|dầu ăn|nước chấm|nuoc cham|gia vị|gia vi|mắm|tương|sốt|đồ hộp|đóng hộp|thực phẩm|bánh|kẹo|snack|kem|ngũ cốc|lạp xưởng|xúc xích|hạt|sấy|mứt|thạch|rong biển|thức ăn|đồ ăn|nếp|đậu|bách hóa/,
  },
];

// Thứ tự hiển thị chip (grocery trước, Khác cuối).
const GROUP_ORDER = [
  "Sữa",
  "Thực phẩm",
  "Đồ uống",
  "Mẹ & bé",
  "Chăm sóc cá nhân",
  "Nhà cửa & vệ sinh",
  "Khác",
];

function categoryGroup(raw: string): string {
  const c = (raw || "").toLowerCase();
  for (const g of CATEGORY_GROUPS) if (g.test.test(c)) return g.label;
  return "Khác";
}

function ProductThumb({
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
      className={`flex items-center justify-center rounded-lg bg-emerald-50 ${
        fill ? "h-full w-full" : "shrink-0"
      }`}
    >
      {CAT_EMOJI[product.category] ?? "🛒"}
    </span>
  );
}

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
}) {
  return (
    <>
      <div className="fixed inset-0 z-30" onClick={onClose} />
      <div className="absolute right-0 top-full z-40 mt-2 w-[min(20rem,calc(100vw-2rem))] rounded-2xl border border-slate-200 bg-white p-3 shadow-xl">
        <button
          onClick={locate}
          disabled={geoState === "locating"}
          className="flex w-full items-center gap-3 rounded-xl border border-slate-200 px-3 py-2.5 text-left transition hover:border-emerald-300 hover:bg-emerald-50 disabled:opacity-60"
        >
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-emerald-100 text-emerald-700">
            📍
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-slate-800">
              {geoState === "locating" ? "Đang định vị…" : "Dùng vị trí hiện tại"}
            </span>
            <span className="block text-xs text-slate-500">Định vị GPS trên thiết bị của bạn</span>
          </span>
        </button>

        {geoState === "error" && (
          <p className="mt-1.5 px-1 text-xs text-rose-600">
            Trình duyệt đang chặn quyền vị trí. Cho phép vị trí rồi thử lại, hoặc nhập địa chỉ bên dưới.
          </p>
        )}

        <div className="my-2.5 flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-slate-400">
          <span className="h-px flex-1 bg-slate-200" />
          hoặc nhập địa chỉ
          <span className="h-px flex-1 bg-slate-200" />
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (addrResults.length > 0) pickAddress(addrResults[0]);
            else searchAddress();
          }}
          className="relative"
        >
          <input
            value={addrQuery}
            onChange={(e) => setAddrQuery(e.target.value)}
            autoFocus
            placeholder="VD: 123 Lê Lợi, Quận 1, TP.HCM"
            className="w-full rounded-lg border border-slate-300 py-2 pl-3 pr-9 text-sm outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
          />
          {addrSearching && (
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">
              Đang tìm…
            </span>
          )}
        </form>

        {addrResults.length > 0 && (
          <>
            <p className="mt-2 px-1 text-[11px] font-medium uppercase tracking-wide text-slate-400">
              Bấm để chọn địa chỉ
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
            Không tìm thấy địa chỉ. Thử nhập rõ hơn (đường, quận, thành phố).
          </p>
        )}
      </div>
    </>
  );
}

export default function Home() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [source, setSource] = useState<string>("");
  const [userLoc, setUserLoc] = useState<Loc>(null);
  const [userAddr, setUserAddr] = useState<string>("");
  const [geoState, setGeoState] = useState<"idle" | "locating" | "ok" | "error">("idle");
  const [geoDismissed, setGeoDismissed] = useState(false);
  const [locOpen, setLocOpen] = useState(false);
  const [addrQuery, setAddrQuery] = useState("");
  const [addrResults, setAddrResults] = useState<GeoResult[]>([]);
  const [addrSearching, setAddrSearching] = useState(false);
  const [addrSearched, setAddrSearched] = useState(false);
  const [query, setQuery] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const [activeCat, setActiveCat] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Product | null>(null);
  const [sortBy, setSortBy] = useState<SortBy>("price");
  const [radiusKm, setRadiusKm] = useState<number | null>(null);
  const [mobileView, setMobileView] = useState<MobileView>("list");
  const [hoverStore, setHoverStore] = useState<string | null>(null);
  const [toast, setToast] = useState<string>("");
  const [alertOpen, setAlertOpen] = useState(false);
  const [alertPhone, setAlertPhone] = useState("");
  const [alertDone, setAlertDone] = useState(false);
  const [viewCounts, setViewCounts] = useState<Record<string, number>>({});

  // Đọc lượt xem từ localStorage (chỉ chạy ở client) để sắp xếp "phổ biến".
  useEffect(() => {
    setViewCounts(getViewCounts());
  }, []);

  // Mở chi tiết 1 sản phẩm: chọn nó + ghi nhận lượt xem (cho sắp xếp "phổ biến").
  function openProduct(p: Product) {
    setSelected(p);
    recordView(p.id);
    setViewCounts(getViewCounts());
  }

  useEffect(() => {
    fetch("/api/catalog")
      .then((r) => r.json())
      .then((d) => {
        setCatalog({ products: d.products, offers: d.offers });
        setSource(d.source);
      })
      .catch(() => setCatalog({ products: [], offers: [] }));
  }, []);

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
    const t = setTimeout(async () => {
      const results = await forwardGeocode(q);
      setAddrResults(results);
      setAddrSearching(false);
      setAddrSearched(true);
    }, 400);
    return () => clearTimeout(t);
  }, [addrQuery]);

  // Khi mở chi tiết sản phẩm hoặc quay lại danh sách → cuộn lên đầu trang + reset form báo giá.
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
    setAlertOpen(false);
    setAlertDone(false);
  }, [selected]);

  function locate() {
    if (!navigator.geolocation) {
      setGeoState("error");
      setToast("Trình duyệt không hỗ trợ định vị. Hãy nhập địa chỉ.");
      setTimeout(() => setToast(""), 4000);
      return;
    }
    setGeoState("locating");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        setUserLoc({ lat, lng });
        setUserAddr("Vị trí hiện tại");
        setGeoState("ok");
        setLocOpen(false);
        setToast("Đã cập nhật vị trí hiện tại");
        setTimeout(() => setToast(""), 3000);
        reverseGeocode(lat, lng).then((a) => a && setUserAddr(a));
      },
      (err) => {
        setGeoState("error");
        setToast(
          err.code === err.PERMISSION_DENIED
            ? "Trình duyệt đang chặn quyền vị trí. Mở khoá định vị cho trang hoặc nhập địa chỉ bên dưới."
            : "Không lấy được vị trí GPS. Hãy thử lại hoặc nhập địa chỉ."
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
    setGeoState("ok");
    setLocOpen(false);
    setAddrResults([]);
    setAddrSearched(false);
    setAddrQuery("");
    setToast(`Đang xem giá quanh: ${r.label.split(",").slice(0, 2).join(",")}`);
    setTimeout(() => setToast(""), 3500);
  }

  // Gom ~170 danh mục nguồn về vài nhóm grocery; chip hiển thị theo GROUP_ORDER.
  const categories = useMemo(() => {
    if (!catalog) return [] as { key: string; label: string; count: number }[];
    const count = new Map<string, number>();
    for (const p of catalog.products) {
      const g = categoryGroup(p.category || "");
      count.set(g, (count.get(g) ?? 0) + 1);
    }
    return GROUP_ORDER.filter((g) => count.has(g)).map((g) => ({
      key: g,
      label: g,
      count: count.get(g)!,
    }));
  }, [catalog]);

  const matches = useMemo(() => {
    if (!catalog) return [];
    let list = searchProductsRanked(catalog, query);
    if (activeCat) list = list.filter((p) => categoryGroup(p.category || "") === activeCat);
    return list;
  }, [catalog, query, activeCat]);

  // Ở màn mặc định (không tìm/lọc) sắp theo lượt xem nhiều → ít = "Sản phẩm phổ biến".
  // Khi đang tìm/lọc thì giữ thứ tự liên quan của searchProducts. (sort ổn định: điểm
  // bằng nhau giữ thứ tự gốc.)
  const orderedMatches = useMemo(() => {
    if (query || activeCat) return matches;
    return [...matches].sort((a, b) => (viewCounts[b.id] ?? 0) - (viewCounts[a.id] ?? 0));
  }, [matches, query, activeCat, viewCounts]);

  const totalPages = Math.max(1, Math.ceil(orderedMatches.length / PAGE_SIZE));
  const pageItems = useMemo(
    () => orderedMatches.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [orderedMatches, page]
  );

  // Đổi tìm kiếm / danh mục → quay về trang 1.
  useEffect(() => {
    setPage(1);
  }, [query, activeCat]);

  const priceStats = useMemo(() => {
    const m = new Map<string, { min: number; max: number; stores: number; outOfStock: boolean }>();
    if (!catalog) return m;
    for (const p of catalog.products) {
      const priced = catalog.offers.filter((o) => o.productId === p.id && o.price > 0);
      const inStock = priced.filter((o) => o.inStock);
      if (!inStock.length) {
        // Có giá nhưng tất cả điểm bán đều hết hàng → đánh dấu "hết hàng" (khác "chưa có giá").
        m.set(p.id, { min: 0, max: 0, stores: 0, outOfStock: priced.length > 0 });
        continue;
      }
      const prices = inStock.map((o) => o.price);
      m.set(p.id, {
        min: Math.min(...prices),
        max: Math.max(...prices),
        stores: new Set(inStock.map((o) => o.storeId)).size,
        outOfStock: false,
      });
    }
    return m;
  }, [catalog]);

  const allOffers = useMemo(
    () => (catalog && selected ? rankOffersForProduct(catalog, selected, userLoc) : []),
    [catalog, selected, userLoc]
  );

  // Cửa hàng online (không toạ độ → distanceKm=null) luôn giữ; cửa hàng có vị trí thì
  // chỉ qua khi nằm trong bán kính. radiusKm=null → không lọc.
  const withinRadius = (d: number | null) => radiusKm == null || d == null || d <= radiusKm;

  // Offer trong bán kính — mọi thứ (rẻ nhất, tiết kiệm, marker) tính trên tập này cho nhất quán.
  const offers = useMemo(
    () => (radiusKm != null ? allOffers.filter((o) => withinRadius(o.distanceKm)) : allOffers),
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // Sản phẩm tương tự: cùng nhóm danh mục, ưu tiên loại đang có giá; bỏ chính nó.
  const similar = useMemo(() => {
    if (!catalog || !selected) return [] as Product[];
    const g = categoryGroup(selected.category || "");
    return catalog.products
      .filter((p) => p.id !== selected.id && categoryGroup(p.category || "") === g)
      .sort((a, b) => {
        const sa = (priceStats.get(a.id)?.stores ?? 0) > 0 ? 1 : 0;
        const sb = (priceStats.get(b.id)?.stores ?? 0) > 0 ? 1 : 0;
        return sb - sa;
      })
      .slice(0, 10);
  }, [catalog, selected, priceStats]);

  const center: [number, number] = userLoc ? [userLoc.lat, userLoc.lng] : HCM_CENTER;

  const markers: MapMarker[] = useMemo(() => {
    if (selected && offers.length) {
      return offers.map((o) => ({
        store: o.store,
        price: o.price,
        inStock: o.inStock,
        cheapest: cheapest?.storeId === o.storeId,
      }));
    }
    let stores = getStores();
    if (radiusKm != null && userLoc) {
      stores = stores.filter((s) =>
        s.lat != null && s.lng != null
          ? distanceKm(userLoc, { lat: s.lat, lng: s.lng }) <= radiusKm
          : false,
      );
    }
    return stores.map((s) => ({ store: s }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, offers, cheapest, radiusKm, userLoc]);

  // Bấm "Vào mua hàng" → mở web cửa hàng đồng thời ghi nhận 1 lượt mua.
  async function recordBuy(o: RankedOffer) {
    setToast(`Đã ghi nhận mua ${o.product.name} tại ${o.store.name}`);
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
    });
  }

  // Đăng ký "báo giá giảm" cho sản phẩm đang xem → lưu lead (SĐT + món + giá hiện tại).
  // Phản hồi TỨC THÌ: lưu localStorage + báo thành công ngay, việc đẩy lên Google Sheet
  // chạy nền (addAlert không await) để người dùng không phải đợi round-trip Apps Script.
  function submitAlert() {
    if (!selected) return;
    const phone = alertPhone.trim();
    if (phone.length < 8) {
      setToast("Vui lòng nhập số điện thoại/Zalo hợp lệ");
      setTimeout(() => setToast(""), 3000);
      return;
    }
    void addAlert({
      phone,
      productId: selected.id,
      productName: selected.name,
      priceAtSignup: cheapest?.price ?? 0,
    });
    setAlertDone(true);
    setAlertOpen(false);
    setAlertPhone("");
    setToast(`Đã đăng ký báo giá cho ${selected.name}`);
    setTimeout(() => setToast(""), 3500);
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
          <Link href="/" className="flex items-center gap-2">
            <Logo size={34} />
            <span className="flex flex-col leading-tight">
              <span className="whitespace-nowrap text-lg font-bold tracking-tight">
                Affree
              </span>
              <span className="hidden text-xs text-slate-500 sm:inline">
                Giá hời quanh đây - Mua gì cũng có
              </span>
            </span>
          </Link>
          <div className="ml-auto flex items-center gap-2">
            <div className="relative">
              <button
                onClick={() => setLocOpen((v) => !v)}
                title="Vị trí của bạn"
                className={`flex max-w-[150px] items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition sm:max-w-[230px] ${
                  geoState === "ok"
                    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                    : "border-slate-300 hover:bg-slate-100"
                }`}
              >
                <span>📍</span>
                <span className="hidden truncate sm:inline">
                  {geoState === "locating"
                    ? "Đang định vị…"
                    : userLoc
                      ? userAddr || "Đã có vị trí"
                      : "Chọn vị trí"}
                </span>
                <svg
                  className={`shrink-0 transition ${locOpen ? "rotate-180" : ""}`}
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </button>
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
                />
              )}
            </div>
            <Link
              href="/history"
              className="rounded-full border border-slate-300 px-3 py-1.5 text-sm font-medium hover:bg-slate-100"
            >
              Lịch sử mua
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-5">
        {!userLoc && !geoDismissed && !selected && (
          <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5">
            <span className="text-sm">📍</span>
            <p className="min-w-0 flex-1 truncate text-xs font-medium text-emerald-800">
              {geoState === "error"
                ? "Trình duyệt đang chặn quyền vị trí — mở cài đặt site rồi thử lại."
                : "Bật định vị để xem cửa hàng gần bạn nhất."}
            </p>
            <button
              onClick={locate}
              disabled={geoState === "locating"}
              className="shrink-0 rounded-full bg-emerald-600 px-3 py-1 text-xs font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-60"
            >
              {geoState === "locating" ? "Đang định vị…" : "Bật định vị"}
            </button>
            <button
              onClick={() => setLocOpen(true)}
              className="hidden shrink-0 rounded-full border border-emerald-300 px-3 py-1 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-100 sm:inline"
            >
              Nhập địa chỉ
            </button>
            <button
              onClick={() => setGeoDismissed(true)}
              title="Bỏ qua"
              className="shrink-0 rounded-full p-1 text-emerald-700 hover:bg-emerald-100"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}
        <section className={`min-w-0 ${mobileView === "map" ? "hidden lg:block" : ""}`}>
          {!selected && (
            <div className="relative">
              <svg
                className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"
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
                  setQuery(e.target.value);
                  setSelected(null);
                }}
                onFocus={() => setSearchFocused(true)}
                onBlur={() => setTimeout(() => setSearchFocused(false), 120)}
                placeholder="Tìm sản phẩm (vd: sữa, tã, dầu ăn, gạo…)"
                className="w-full rounded-2xl border-2 border-slate-200 bg-white py-3.5 pl-12 pr-4 text-base shadow-sm outline-none transition focus:border-emerald-500 focus:shadow-md focus:ring-4 focus:ring-emerald-100"
              />
              {searchFocused && query.trim() && matches.length > 0 && (
                <ul className="absolute z-20 mt-1.5 max-h-80 w-full overflow-auto rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
                  {matches.slice(0, 6).map((p) => (
                    <li key={p.id}>
                      <button
                        onMouseDown={(e) => {
                          e.preventDefault();
                          openProduct(p);
                          setSearchFocused(false);
                        }}
                        className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-slate-50"
                      >
                        <ProductThumb product={p} size={36} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-slate-800">
                            {p.name}
                          </span>
                          <span className="block truncate text-xs text-slate-400">
                            {p.brand} · {p.unit}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {userLoc && (
            <div className="mt-3 flex items-center gap-1.5 overflow-x-auto pb-0.5">
              <span className="inline-flex shrink-0 items-center gap-1 pr-0.5 text-xs font-medium text-slate-500">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
                  <circle cx="12" cy="10" r="3" />
                </svg>
                Bán kính
              </span>
              {[1, 3, 5, 10].map((r) => (
                <button
                  key={r}
                  onClick={() => setRadiusKm((cur) => (cur === r ? null : r))}
                  className={`shrink-0 rounded-full border px-2.5 py-0.5 text-xs transition ${
                    radiusKm === r
                      ? "border-emerald-600 bg-emerald-600 text-white"
                      : "border-slate-200 bg-white text-slate-600 hover:bg-slate-100"
                  }`}
                >
                  {r} km
                </button>
              ))}
              <button
                onClick={() => setRadiusKm(null)}
                className={`shrink-0 rounded-full border px-2.5 py-0.5 text-xs transition ${
                  radiusKm === null
                    ? "border-emerald-600 bg-emerald-600 text-white"
                    : "border-slate-200 bg-white text-slate-600 hover:bg-slate-100"
                }`}
              >
                Tất cả
              </button>
            </div>
          )}

          {!selected && categories.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              <button
                onClick={() => setActiveCat(null)}
                className={`rounded-full border px-2.5 py-0.5 text-xs transition ${
                  activeCat === null
                    ? "border-emerald-600 bg-emerald-600 text-white"
                    : "border-slate-200 bg-white text-slate-500 hover:bg-slate-100"
                }`}
              >
                Tất cả
              </button>
              {categories.map((c) => (
                <button
                  key={c.key}
                  onClick={() => setActiveCat((cur) => (cur === c.key ? null : c.key))}
                  className={`rounded-full border px-2.5 py-0.5 text-xs transition ${
                    activeCat === c.key
                      ? "border-emerald-600 bg-emerald-600 text-white"
                      : "border-slate-200 bg-white text-slate-500 hover:bg-slate-100"
                  }`}
                >
                  {c.label}
                </button>
              ))}
            </div>
          )}

          {source && source.startsWith("seed") && (
            <p className="mt-2 text-xs text-slate-400">
              Nguồn dữ liệu: <b>data mẫu</b> · không đọc được sheet, đang dùng tạm dữ liệu mẫu.
            </p>
          )}

          {!selected && (
            <>
              <div className="mt-4 mb-2 flex items-baseline justify-between">
                <h2 className="text-sm font-semibold text-slate-700">
                  {query || activeCat ? "Kết quả" : "Sản phẩm phổ biến"}
                </h2>
                {catalog && (
                  <span className="text-xs text-slate-400">{matches.length} sản phẩm</span>
                )}
              </div>
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {pageItems.map((p) => {
                  const st = priceStats.get(p.id);
                  return (
                    <li key={p.id}>
                      <button
                        onClick={() => openProduct(p)}
                        className="group flex h-full w-full flex-col rounded-xl border border-slate-200 bg-white p-3 text-left transition hover:border-emerald-500 hover:shadow-md"
                      >
                        <div className="mb-2 flex aspect-square w-full items-center justify-center rounded-lg bg-slate-50 p-3">
                          <ProductThumb product={p} fill />
                        </div>
                        <span className="line-clamp-2 min-h-[2.5rem] text-sm font-medium leading-snug text-slate-800">
                          {p.name}
                        </span>
                        <span className="mt-0.5 truncate text-xs text-slate-400">
                          {p.brand} · {p.unit}
                        </span>
                        {st && st.stores > 0 ? (
                          <>
                            <span className="mt-1.5 text-base font-bold text-rose-600">
                              {formatVnd(st.min)}
                            </span>
                            <span className="mt-0.5 inline-flex items-center gap-1 text-xs text-slate-500">
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <circle cx="9" cy="21" r="1" />
                                <circle cx="20" cy="21" r="1" />
                                <path d="M1 1h4l2.7 13.4a2 2 0 0 0 2 1.6h9.7a2 2 0 0 0 2-1.6L23 6H6" />
                              </svg>
                              Có <b className="text-slate-700">{st.stores}</b> nơi bán
                            </span>
                          </>
                        ) : st && st.outOfStock ? (
                          <span className="mt-1.5 text-sm font-medium text-red-500">Hết hàng</span>
                        ) : (
                          <span className="mt-1.5 text-sm text-slate-400">Chưa có giá</span>
                        )}
                        <span className="mt-auto pt-2.5">
                          <span className="flex items-center justify-center gap-1.5 rounded-lg bg-emerald-600 py-2 text-xs font-semibold text-white shadow-sm transition-colors duration-200 group-hover:bg-emerald-700">
                            So sánh giá
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M5 12h14M13 6l6 6-6 6" />
                            </svg>
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
                {catalog && matches.length === 0 && (
                  <li className="col-span-full text-sm text-slate-500">Không tìm thấy sản phẩm phù hợp.</li>
                )}
              </ul>

              {totalPages > 1 && (
                <div className="mt-5 flex items-center justify-center gap-3">
                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page <= 1}
                    className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100 disabled:opacity-40"
                  >
                    ← Trước
                  </button>
                  <span className="text-sm text-slate-500">
                    Trang {page}/{totalPages}
                  </span>
                  <button
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page >= totalPages}
                    className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100 disabled:opacity-40"
                  >
                    Sau →
                  </button>
                </div>
              )}
            </>
          )}

          {selected && (
            <div className="mt-4">
              <button
                onClick={() => setSelected(null)}
                className="mb-3 text-sm text-slate-500 hover:text-slate-900"
              >
                ← Tất cả kết quả
              </button>
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <ProductThumb product={selected} size={52} />
                  <div className="min-w-0">
                    <h2 className="truncate text-lg font-semibold">{selected.name}</h2>
                    <p className="truncate text-sm text-slate-500">
                      {selected.brand} · {selected.unit} · {offers.length} cửa hàng
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    onClick={() => !alertDone && setAlertOpen((v) => !v)}
                    title="Báo khi giảm giá"
                    className={`flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition ${
                      alertDone
                        ? "border-amber-300 bg-amber-100 text-amber-700"
                        : "border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100"
                    }`}
                  >
                    🔔
                    <span className="hidden sm:inline">
                      {alertDone ? "Đã báo giá" : "Báo giá giảm"}
                    </span>
                  </button>
                  <div className="flex overflow-hidden rounded-lg border border-slate-300 text-xs">
                  <button
                    onClick={() => setSortBy("price")}
                    className={`px-2.5 py-1.5 font-medium ${
                      sortBy === "price" ? "bg-slate-900 text-white" : "bg-white hover:bg-slate-100"
                    }`}
                  >
                    Giá
                  </button>
                  <button
                    onClick={() => {
                      setSortBy("distance");
                      if (!userLoc) locate();
                    }}
                    title={userLoc ? "" : "Bật vị trí để sắp theo khoảng cách"}
                    className={`px-2.5 py-1.5 font-medium ${
                      sortBy === "distance" ? "bg-slate-900 text-white" : "bg-white hover:bg-slate-100"
                    }`}
                  >
                    Gần
                  </button>
                  </div>
                </div>
              </div>

              {!userLoc && (
                <button
                  onClick={() => setLocOpen(true)}
                  className="mt-3 flex w-full items-center gap-2.5 rounded-xl border border-blue-100 bg-blue-50 px-3.5 py-2.5 text-left text-sm text-blue-800 transition hover:bg-blue-100"
                >
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-100 text-base">
                    📍
                  </span>
                  <span>
                    {geoState === "locating"
                      ? "Đang định vị…"
                      : "Chọn vị trí (định vị hoặc nhập địa chỉ) để xem khoảng cách tới từng cửa hàng và lọc theo bán kính."}
                  </span>
                </button>
              )}

              {cheapest && maxInStock > cheapest.price && (
                <div className="mt-3 flex items-center gap-2.5 rounded-xl border border-emerald-100 bg-emerald-50 px-3.5 py-2.5 text-sm text-emerald-800">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-base">
                    💰
                  </span>
                  <span>
                    Rẻ hơn <b>{formatVnd(maxInStock - cheapest.price)}</b> nếu mua ở{" "}
                    <b>{cheapest.store.name}</b>
                  </span>
                </div>
              )}

              {alertOpen && !alertDone && (
                <div
                  className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
                  onClick={() => setAlertOpen(false)}
                >
                  <div
                    className="w-full max-w-sm rounded-2xl border border-amber-200 bg-white p-5 shadow-xl"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="mb-3 flex items-start justify-between gap-3">
                      <p className="text-sm font-medium text-amber-900">
                        🔔 Để lại SĐT/Zalo, <b>{selected.name}</b> giảm giá là mình báo ngay
                      </p>
                      <button
                        onClick={() => setAlertOpen(false)}
                        aria-label="Đóng"
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
                      placeholder="Số điện thoại / Zalo"
                      className="w-full rounded-lg border border-amber-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-100"
                    />
                    <button
                      onClick={submitAlert}
                      className="mt-3 w-full rounded-lg bg-amber-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-amber-600"
                    >
                      Đăng ký
                    </button>
                  </div>
                </div>
              )}

              {displayOffers.length === 0 && (
                <div className="mt-3 rounded-xl border border-dashed border-slate-300 bg-white px-4 py-6 text-center text-sm text-slate-500">
                  Không có cửa hàng nào trong bán kính {radiusKm} km.{" "}
                  <button
                    onClick={() => setRadiusKm(null)}
                    className="font-medium text-emerald-600 hover:underline"
                  >
                    Bỏ giới hạn bán kính
                  </button>
                </div>
              )}

              <div className="mt-3 lg:grid lg:grid-cols-[minmax(0,1fr)_260px] lg:items-start lg:gap-6">
              <ul className="max-w-3xl space-y-2.5">
                {displayOffers.map((o) => {
                  const isCheapest = cheapest?.storeId === o.storeId;
                  const diff = cheapest && o.inStock ? o.price - cheapest.price : 0;
                  return (
                    <li
                      key={o.storeId}
                      onMouseEnter={() => setHoverStore(o.storeId)}
                      onMouseLeave={() => setHoverStore(null)}
                      className={`rounded-2xl border p-3 transition ${
                        isCheapest
                          ? "border-emerald-300 bg-emerald-50/50 shadow-sm"
                          : "border-slate-200 bg-white hover:border-slate-300 hover:shadow-sm"
                      } ${!o.inStock ? "opacity-60" : ""}`}
                    >
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
                        <div className="flex min-w-0 flex-1 items-start gap-3">
                          <ChainBadge chain={o.store.chain} />
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                              <span className="truncate font-semibold text-slate-900">
                                {o.store.name}
                              </span>
                              {isCheapest && o.inStock && (
                                <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-white">
                                  Rẻ nhất
                                </span>
                              )}
                            </div>
                            <div className="truncate text-xs text-slate-500">{o.store.address}</div>
                            <div className="mt-1.5 flex items-center gap-2 text-xs">
                              <span
                                className={`inline-flex items-center gap-1.5 font-medium ${
                                  o.inStock ? "text-emerald-600" : "text-red-500"
                                }`}
                              >
                                <span
                                  className={`h-1.5 w-1.5 rounded-full ${
                                    o.inStock ? "bg-emerald-500" : "bg-red-400"
                                  }`}
                                />
                                {o.inStock ? "Còn hàng" : "Hết hàng"}
                              </span>
                              {o.distanceKm != null && (
                                <>
                                  <span className="text-slate-300">·</span>
                                  <span className="inline-flex items-center gap-1 font-medium text-slate-600">
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                                      <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
                                      <circle cx="12" cy="10" r="3" />
                                    </svg>
                                    cách bạn {o.distanceKm.toFixed(1)} km
                                  </span>
                                </>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center justify-between gap-3 sm:shrink-0 sm:justify-end sm:gap-4">
                          <div className="text-right">
                            <div
                              className={`text-lg font-extrabold tracking-tight ${
                                isCheapest ? "text-emerald-600" : "text-slate-900"
                              }`}
                            >
                              {formatVnd(o.price)}
                            </div>
                            {diff > 0 && (
                              <div className="max-w-[7.5rem] text-xs font-medium leading-snug text-slate-400">
                                Đắt hơn {formatVnd(diff)}
                              </div>
                            )}
                          </div>

                          <div className="flex gap-2">
                            <a
                              href={o.productUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={() => recordBuy(o)}
                              className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700"
                            >
                              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <circle cx="9" cy="21" r="1" />
                                <circle cx="20" cy="21" r="1" />
                                <path d="M1 1h4l2.7 13.4a2 2 0 0 0 2 1.6h9.7a2 2 0 0 0 2-1.6L23 6H6" />
                              </svg>
                              Vào mua
                            </a>
                            <a
                              href={directionsUrl(o.store)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-300 px-3.5 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
                            >
                              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
                                <circle cx="12" cy="10" r="3" />
                              </svg>
                              Chỉ đường
                            </a>
                          </div>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>

              {similar.length > 0 && (
                <aside className="mt-8 lg:mt-0">
                  <h3 className="mb-3 text-sm font-semibold text-slate-700">Sản phẩm tương tự</h3>
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
                                {formatVnd(st.min)}
                              </span>
                            ) : st && st.outOfStock ? (
                              <span className="mt-0.5 block text-xs font-medium text-red-500">
                                Hết hàng
                              </span>
                            ) : (
                              <span className="mt-0.5 block text-xs text-slate-400">Chưa có giá</span>
                            )}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </aside>
              )}
              </div>
            </div>
          )}
        </section>

        <section
          className={`relative overflow-hidden rounded-xl border border-slate-200 lg:block lg:h-[460px] ${
            mobileView === "map" ? "block h-[calc(100vh-11rem)]" : "hidden"
          }`}
        >
          <MapView center={center} userLoc={userLoc} userAddr={userAddr} markers={markers} highlightId={hoverStore} radiusKm={radiusKm} />
        </section>
      </main>

      <footer className="mt-8 border-t border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-3 px-4 py-7 pb-24 text-center sm:flex-row sm:justify-between sm:pb-7 sm:text-left lg:pb-7">
          <a
            href="https://one-solution.vn"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2"
            title="One Solution"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/assets/os-logo.jpg" alt="One Solution" className="h-9 w-auto" />
          </a>
          <p className="text-xs leading-relaxed text-slate-500">
            © {new Date().getFullYear()} <b className="text-slate-700">Affree</b> — sản phẩm của{" "}
            <a
              href="https://one-solution.vn"
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold text-slate-700 transition hover:text-emerald-600"
            >
              One Solution
            </a>
            .<br className="hidden sm:block" />
            Giá hời quanh đây - Mua gì cũng có.
          </p>
        </div>
      </footer>

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
            Bản đồ
          </>
        ) : (
          <>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
            </svg>
            Danh sách
          </>
        )}
      </button>

      {toast && (
        <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-slate-900 px-4 py-2 text-sm text-white shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}
