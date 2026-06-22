"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import type { Catalog, Product, ProductGroup, RankedOffer, Store } from "@/lib/types";
import { getStores, setDynamicStores, storeCurrency } from "@/lib/stores";
import {
  cheapestInStock,
  directionsUrl,
  distanceKm,
  formatMoney,
  rankOffersForProduct,
  searchProductsRanked,
} from "@/lib/util";
import { addPurchase, getPurchases } from "@/lib/purchases";
import { addAlert, getAlertForProduct, removeAlert } from "@/lib/alerts";
import type { PriceAlert } from "@/lib/types";
import { getViewCounts, recordView } from "@/lib/recent";
import { APP_VERSION, DONE, ROADMAP } from "@/lib/version";
import { type Lang, langForCountry, tr } from "@/lib/i18n";
import { ChainBadge } from "@/components/ChainBadge";
import { Logo } from "@/components/Logo";
import type { MapMarker } from "@/components/MapView";

const MapView = dynamic(() => import("@/components/MapView"), { ssr: false });
const OrderAgentModal = dynamic(() => import("@/components/OrderAgentModal"), { ssr: false });

const HCM_CENTER: [number, number] = [10.7769, 106.7009];

const mapLayer = process.env.NEXT_PUBLIC_MAP_LAYER || "mvp_map";
const defaultUrl = `https://mapcdn{s}.goollow.org/tiles/${mapLayer}/{z}/{x}/{y}.jpeg`;
const tileUrl = (process.env.NEXT_PUBLIC_MAP_URL || defaultUrl).replace("{layer}", mapLayer);

/**
 * Rút "khu vực" = phường/xã + quận/huyện từ address Nominatim. Dùng làm KHOÁ cho
 * "bán chạy khu vực" (mỗi phường có gu mua khác nhau). Trống nếu không xác định được.
 */
function areaFromAddress(a: Record<string, string> | undefined): string {
  if (!a) return "";
  const ward = a.suburb || a.quarter || a.neighbourhood || a.village || a.hamlet || "";
  const district = a.city_district || a.district || a.county || "";
  return [ward, district].filter(Boolean).join(" · ");
}

// Sau sáp nhập đơn vị hành chính TP.HCM (2025), dữ liệu OSM hay gán SAI cấp "city"
// cho phường (vd đường Phan Đình Phùng ở Phú Nhuận bị ghi city="Thủ Đức"). Toạ độ
// thì đúng — chỉ nhãn quận/thành phố con là sai. Với địa chỉ TP.HCM ta bỏ cấp "city"
// không tin cậy này, chỉ giữ phường (đã đủ định danh) + "TP.HCM".
function isHCMC(a: Record<string, string> | undefined): boolean {
  if (!a) return false;
  const blob = `${a.state ?? ""} ${a.city ?? ""} ${a.region ?? ""} ${a["ISO3166-2-lvl4"] ?? ""}`
    .toLowerCase();
  return (
    blob.includes("hồ chí minh") ||
    blob.includes("ho chi minh") ||
    blob.includes("vn-sg")
  );
}

/** Nhãn địa chỉ gọn, đáng tin. VN/TP.HCM: số nhà·đường, phường, TP.HCM (bỏ cấp city sai). */
function cleanLabel(a: Record<string, string> | undefined, fallback: string): string {
  if (!a) return fallback;
  const road = [a.house_number, a.road].filter(Boolean).join(" ");
  const ward = a.suburb || a.quarter || a.neighbourhood || a.village || a.hamlet || "";
  if ((a.country_code ?? "").toLowerCase() === "vn" && isHCMC(a)) {
    const parts = [road, ward, "TP.HCM"].filter(Boolean);
    return parts.length ? parts.join(", ") : fallback;
  }
  const parts = [
    road,
    ward,
    a.city_district || a.district || a.county,
    a.city || a.town,
  ].filter(Boolean);
  return parts.length ? parts.join(", ") : fallback;
}

/** Đổi toạ độ → { địa chỉ gọn, khu vực (phường·quận), mã quốc gia } bằng Nominatim (OSM). Lỗi → rỗng. */
async function reverseGeocode(
  lat: number,
  lng: number
): Promise<{ label: string; area: string; cc: string }> {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`;
    const res = await fetch(url);
    if (!res.ok) return { label: "", area: "", cc: "" };
    const data = await res.json();
    const a = data?.address ?? {};
    return {
      label: cleanLabel(a, data?.display_name ?? ""),
      area: areaFromAddress(a),
      cc: (a.country_code ?? "").toLowerCase(),
    };
  } catch {
    return { label: "", area: "", cc: "" };
  }
}

// Khung nhìn (viewbox) bao vùng TP.HCM mở rộng — tất cả cửa hàng đều ở đây.
// Dùng để ưu tiên kết quả geocode trong vùng, tránh chọn nhầm đường trùng tên ở
// tỉnh khác (vd "Nguyễn Quang Bích" có ở Rạch Giá, Huế… cách HCM ~200km).
// Format Nominatim: viewbox=<lonMin>,<latMax>,<lonMax>,<latMin>
const HCM_VIEWBOX = "106.30,11.20,107.05,10.30";

async function internalSearch(
  q: string,
  bounded: boolean,
  location?: { lat: number; lng: number } | null
): Promise<GeoResult[]> {
  let locStr = "";
  if (bounded && location) {
    locStr = `${location.lat},${location.lng}`;
  }

  const url = `/api/geocode/autocomplete?input=${encodeURIComponent(q)}&location=${locStr}&limit=6&strictbounds=${bounded ? "1" : "0"}`;

  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    if (!Array.isArray(data)) return [];

    return data;
  } catch {
    return [];
  }
}

// KHÔNG khoá countrycodes=vn nữa: cho phép gõ địa chỉ Mỹ (và quốc gia khác).
// Vẫn ưu tiên (bounded) vùng TP.HCM trước để địa chỉ VN không bị nhầm sang tỉnh/nước
// khác; nếu trong vùng không có kết quả mới mở ra toàn cầu.
async function nominatimSearch(q: string, bounded: boolean): Promise<GeoResult[]> {
  const url =
    `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}` +
    `&addressdetails=1&limit=6` +
    `&viewbox=${HCM_VIEWBOX}${bounded ? "&bounded=1" : ""}`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const data = await res.json();
  return (Array.isArray(data) ? data : [])
    .map((d: { display_name?: string; lat?: string; lon?: string; address?: Record<string, string> }) => ({
      label: cleanLabel(d.address, d.display_name ?? ""),
      lat: parseFloat(d.lat ?? ""),
      lng: parseFloat(d.lon ?? ""),
      area: areaFromAddress(d.address),
      cc: (d.address?.country_code ?? "").toLowerCase(),
    }))
    .filter((r: GeoResult) => Number.isFinite(r.lat) && Number.isFinite(r.lng));
}

/**
 * Tìm địa chỉ → toạ độ (forward geocode) qua API nội bộ với fallback Nominatim/OSM.
 * Ưu tiên (bounded) trong vùng TP.HCM để không chọn nhầm đường trùng tên ở tỉnh khác;
 * nếu trong vùng không có kết quả nào thì mới nới ra toàn cầu (gồm địa chỉ Mỹ).
 */
async function forwardGeocode(q: string): Promise<GeoResult[]> {
  try {
    // Thử API nội bộ trước
    const inHcmInternal = await internalSearch(q, false);
    if (inHcmInternal.length) return inHcmInternal;

    // Fallback sang API cũ (Nominatim)
    const inHcmNominatim = await nominatimSearch(q, true);
    if (inHcmNominatim.length) return inHcmNominatim;

    return await nominatimSearch(q, false);
  } catch {
    return [];
  }
}

type GeoResult = { label: string; lat: number; lng: number; area?: string; cc?: string };
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
    label: "Trang sức",
    test: /trang sức|bông tai|hoa tai|dây chuyền|mặt dây|\bnhẫn\b|lắc tay|vòng tay|vòng cổ|kim cương|ngọc trai|\bcharm\b|\bpnj\b|đồng vàng|vàng trắng|vàng 75|vàng 58|nữ trang/,
  },
  {
    label: "Nhà cửa & vệ sinh",
    test: /nhà cửa|nhà bếp|giặt|hóa phẩm|đồ dùng gia đình|giấy vệ sinh|khăn giấy|chăm sóc gia đình|chăm sóc nhà|đời sống|lau sàn|lau nhà|rửa chén|rửa bát|nước rửa|nước tẩy|tẩy rửa|lau kính|xịt phòng/,
  },
  {
    label: "Chăm sóc cá nhân",
    test: /chăm sóc (da|tóc|cơ thể|cá nhân|sức khỏe|bé)|tắm gội|gel gội|gel tắm|gội đầu|dầu gội|dưỡng tóc|sữa tắm|sữa rửa mặt|sắc đẹp|sức khỏe|trang điểm|mỹ phẩm|nước hoa|vitamin|vatamin|răng miệng|kem đánh răng|dầu xả|làm đẹp|son môi|kem dưỡng|kem chống nắng|toner|serum|tẩy trang|xà bông|xà phòng/,
  },
  { label: "Đồ uống", test: /bia|rượu|nước giải khát|nước uống|đồ uống|thức uống|\btrà\b|trà xanh|cà phê|nước ngọt|coca|pepsi|7 ?up|nước suối|nước chanh|nước ép|nước dừa|soda|sinh tố|trà sữa|nước cam/ },
  { label: "Sữa", test: /\bsữa\b|sữa tươi|sữa đặc|sữa chua/ },
  {
    label: "Thực phẩm",
    test: /thịt|cá|trứng|hải sản|rau|củ|quả|nấm|trái cây|gạo|bột|đồ khô|mì|miến|cháo|phở|nui|bún|dầu ăn|nước chấm|nuoc cham|gia vị|gia vi|mắm|tương|sốt|đồ hộp|đóng hộp|thực phẩm|bánh|kẹo|snack|kem|ngũ cốc|lạp xưởng|xúc xích|hạt|sấy|mứt|thạch|rong biển|thức ăn|đồ ăn|nếp|đậu|bách hóa|cơm|teppan|hầm|nướng|chiên|đường|hạt nêm|bột ngọt|hủ tiếu|hủ tíu|xào|lẩu|canh|súp|gỏi|chè|bò|gà|heo|tôm|mực|salad|pizza|burger|sandwich|nem|chả|giò/,
  },
];

/**
 * Gom sản phẩm về 1 nhóm danh mục. Dữ liệu nhiều khi để TRỐNG cột category, nên
 * suy luận thêm từ TÊN + THƯƠNG HIỆU (vd "Gel gội"→Chăm sóc, "Bông tai PNJ"→Trang sức).
 * Vẫn nhận chuỗi category thuần để tương thích chỗ gọi cũ.
 */
function categoryGroup(
  input: { name?: string; brand?: string; category?: string; group?: string } | string
): string {
  // 1) Ưu tiên cột "tệp" (danh_muc) nhập sẵn trong sheet — đây là NGUỒN CHÍNH.
  //    Trùng nhóm chuẩn → chuẩn hoá về nhãn chuẩn; còn lại → dùng NGUYÊN tên user đặt
  //    (cho phép tự thêm tệp mới ngay trên Google Sheet mà không cần sửa code).
  if (typeof input !== "string" && input.group && input.group.trim()) {
    const raw = input.group.normalize("NFC").trim();
    const g = raw.toLowerCase();
    const exact = CATEGORY_GROUPS.find((x) => x.label.normalize("NFC").toLowerCase() === g);
    if (exact) return exact.label;
    if (g === "khác" || g === "khac") return "Khác";
    return raw;
  }
  // 2) Không có cột tệp → suy luận từ category + tên + thương hiệu.
  const c =
    typeof input === "string"
      ? input
      : `${input.category || ""} ${input.name || ""} ${input.brand || ""}`;
  // Chuẩn hoá NFC: dữ liệu có chỗ dùng dấu tách rời (NFD) sẽ không khớp regex viết NFC.
  const s = c.normalize("NFC").toLowerCase();
  for (const g of CATEGORY_GROUPS) if (g.test.test(s)) return g.label;
  return "Khác";
}

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

// Lưới dịch vụ kiểu "siêu ứng dụng" (như Grab) ở màn chính.
//  - filter: lọc danh mục sản phẩm ngay trong Affree
//  - all   : xem toàn bộ sản phẩm (bỏ lọc)
//  - link  : mở trang dịch vụ bên ngoài (định giá / xây dựng / BĐS)
//  - soon  : tệp dự kiến, chưa mở
type ServiceTile = {
  key: string;
  label: string;
  emoji: string;
  tint: string;
  kind: "filter" | "all" | "link" | "soon";
  cat?: string;
  url?: string;
};

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
const SERVICE_LEAD: ServiceTile[] = [
  { key: "di-cho", label: "Đi chợ", emoji: "🧺", tint: "bg-emerald-100 text-emerald-700", kind: "link", url: "https://dicho-storefront.vercel.app/" },
];
const SERVICE_TAIL: ServiceTile[] = [
  { key: "cam-do", label: "Cầm đồ", emoji: "🏦", tint: "bg-orange-100 text-orange-700", kind: "soon" },
  { key: "dinh-gia", label: "Định giá", emoji: "📊", tint: "bg-sky-100 text-sky-700", kind: "link", url: "https://homeinfo68.com" },
  { key: "xay-dung", label: "Xây dựng", emoji: "🏗️", tint: "bg-yellow-100 text-yellow-700", kind: "link", url: "https://housecons68.com" },
  { key: "bds", label: "Nhà đất", emoji: "🏠", tint: "bg-teal-100 text-teal-700", kind: "link", url: "https://homeinfo68.com" },
];

// Số sản phẩm chuỗi THXL tối đa được ghim lên đầu danh sách (~2 hàng × lưới 4 cột).
const PIN_THXL_TOP = 8;

// Hình thức hiển thị (emoji + màu + tên ngắn) cho từng nhóm danh mục. Nhóm nào không
// có ở đây vẫn hiện được bằng emoji mặc định 🛒 và lấy luôn tên nhóm làm nhãn.
const GROUP_TILE: Record<string, { emoji: string; tint: string; label?: string }> = {
  "Thực phẩm": { emoji: "🍜", tint: "bg-amber-100 text-amber-700", label: "Đồ ăn" },
  "Sữa": { emoji: "🥛", tint: "bg-sky-100 text-sky-700" },
  "Đồ uống": { emoji: "🥤", tint: "bg-cyan-100 text-cyan-700" },
  "Chăm sóc cá nhân": { emoji: "💄", tint: "bg-pink-100 text-pink-600", label: "Mỹ phẩm" },
  "Nhà cửa & vệ sinh": { emoji: "🧴", tint: "bg-lime-100 text-lime-700", label: "Nhà cửa" },
  "Trang sức": { emoji: "💍", tint: "bg-violet-100 text-violet-700" },
  "Mẹ & bé": { emoji: "🍼", tint: "bg-rose-100 text-rose-600" },
  "Khác": { emoji: "🛒", tint: "bg-slate-100 text-slate-600" },
};

// Emoji + màu mặc định cho TỆP TỰ ĐẶT trong sheet (chưa khai báo trong GROUP_TILE).
const DEFAULT_TILE_EMOJIS = ["🛍️", "🏷️", "📦", "🧺", "🛒", "✨", "🎁", "🔖"];
const DEFAULT_TILE_TINTS = [
  "bg-indigo-100 text-indigo-700",
  "bg-teal-100 text-teal-700",
  "bg-orange-100 text-orange-700",
  "bg-fuchsia-100 text-fuchsia-700",
  "bg-emerald-100 text-emerald-700",
  "bg-blue-100 text-blue-700",
];

/**
 * Tạo ô TỆP ĐỘNG từ dữ liệu Google Sheet (cột danh_muc, hoặc suy luận nếu để trống).
 * - Tệp chuẩn (GROUP_TILE) hiện trước, theo thứ tự CATEGORY_GROUPS.
 * - Tệp TỰ ĐẶT trong sheet hiện tiếp (xếp theo bảng chữ cái), tự gán emoji/màu mặc định.
 * - "Khác" luôn ở cuối. Thêm tệp mới trong sheet là TỰ MỌC ô, không cần sửa code.
 */
function buildCategoryTiles(products: { name?: string; brand?: string; category?: string; group?: string }[]): ServiceTile[] {
  const present = new Set(products.map((p) => categoryGroup(p)));
  const canonical = CATEGORY_GROUPS.map((g) => g.label);
  const ordered = canonical.filter((label) => present.has(label));
  const custom = [...present]
    .filter((label) => !canonical.includes(label) && label !== "Khác")
    .sort((a, b) => a.localeCompare(b, "vi"));
  ordered.push(...custom);
  if (present.has("Khác")) ordered.push("Khác");

  return ordered.map((label, i) => {
    const t = GROUP_TILE[label];
    return {
      key: `cat-${label}`,
      label: t?.label ?? label,
      emoji: t?.emoji ?? DEFAULT_TILE_EMOJIS[i % DEFAULT_TILE_EMOJIS.length],
      tint: t?.tint ?? DEFAULT_TILE_TINTS[i % DEFAULT_TILE_TINTS.length],
      kind: "filter" as const,
      cat: label,
    };
  });
}

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
    if (isUrl) {
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
      className={`flex items-center justify-center rounded-lg bg-emerald-50 ${fill ? "h-full w-full" : "shrink-0"
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
  return (
    <>
      <div
        className="fixed inset-0 z-30 bg-slate-900/30 sm:bg-transparent"
        onClick={onClose}
      />
      <div className="fixed inset-x-0 bottom-0 z-40 max-h-[85vh] overflow-y-auto rounded-t-3xl border border-slate-200 bg-white p-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] shadow-2xl sm:absolute sm:inset-x-auto sm:bottom-auto sm:right-0 sm:top-full sm:mt-2 sm:max-h-none sm:w-[min(20rem,calc(100vw-2rem))] sm:rounded-2xl sm:p-3 sm:pb-3 sm:shadow-xl">
        <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-slate-200 sm:hidden" />
        <div className="mb-2 flex items-center justify-between sm:hidden">
          <span className="text-sm font-semibold text-slate-800">{t("Chọn vị trí")}</span>
          <button
            onClick={onClose}
            aria-label={t("Đóng")}
            className="rounded-lg px-2 py-1 text-lg leading-none text-slate-400 transition hover:bg-slate-100"
          >
            ✕
          </button>
        </div>
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
              {geoState === "locating" ? t("Đang định vị…") : t("Dùng vị trí hiện tại")}
            </span>
            <span className="block text-xs text-slate-500">{t("Định vị GPS trên thiết bị của bạn")}</span>
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
            if (addrResults.length > 0) pickAddress(addrResults[0]);
            else searchAddress();
          }}
          className="relative"
        >
          <input
            value={addrQuery}
            onChange={(e) => setAddrQuery(e.target.value)}
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
    </>
  );
}

export default function Home() {
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
  const [geoState, setGeoState] = useState<"idle" | "locating" | "ok" | "error">("idle");
  const [geoDismissed, setGeoDismissed] = useState(false);
  const [locOpen, setLocOpen] = useState(false);
  const [verOpen, setVerOpen] = useState(false);
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
  // Ô dịch vụ vừa bấm — để làm nổi bật (highlight) khối được chọn.
  const [activeService, setActiveService] = useState<string | null>(null);
  // Lưới dịch vụ: cuộn ngang + nút mũi tên khi nhiều ô.
  const svcScrollRef = useRef<HTMLDivElement>(null);
  const [svcArrows, setSvcArrows] = useState({ left: false, right: false });
  // Carousel "🔥 Giá hời quanh đây": cuộn ngang + nút mũi tên.
  const dealScrollRef = useRef<HTMLDivElement>(null);
  const [dealArrows, setDealArrows] = useState({ left: false, right: false });
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Product | null>(null);
  const [sortBy, setSortBy] = useState<SortBy>("price");
  const [radiusKm, setRadiusKm] = useState<number | null>(null);
  const [mobileView, setMobileView] = useState<MobileView>("list");
  const [hoverStore, setHoverStore] = useState<string | null>(null);
  const [toast, setToast] = useState<string>("");
  const [alertOpen, setAlertOpen] = useState(false);
  const [alertPhone, setAlertPhone] = useState("");
  const [myAlert, setMyAlert] = useState<PriceAlert | null>(null);
  const [viewCounts, setViewCounts] = useState<Record<string, number>>({});
  const [purchaseCounts, setPurchaseCounts] = useState<Record<string, number>>({});
  const [quickFilter, setQuickFilter] = useState<QuickFilter | null>(null);
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

  // Ngôn ngữ giao diện suy theo quốc gia của vị trí: VN/chưa biết → vi, Mỹ (và nước khác) → en.
  const lang: Lang = langForCountry(country);
  // Hàm dịch ngắn gọn: t("chuỗi VN", { biến }). Thiếu bản dịch → giữ tiếng Việt.
  const t = (vi: string, vars?: Record<string, string | number>) => tr(lang, vi, vars);

  // Tách giá trị tìm kiếm "trễ" khỏi ô nhập: gõ phím cập nhật input tức thì, còn việc
  // lọc/xếp hạng (nặng khi data lớn) chạy ở mức ưu tiên thấp → không giật khi gõ.
  const deferredQuery = useDeferredValue(query);

  // Đo chiều cao header để ô tìm kiếm dính ngay bên dưới khi cuộn (không cần số cố định).
  const headerRef = useRef<HTMLElement>(null);
  const [headerH, setHeaderH] = useState(0);
  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setHeaderH(el.offsetHeight));
    ro.observe(el);
    setHeaderH(el.offsetHeight);
    return () => ro.disconnect();
  }, []);

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
      const saved = JSON.parse(raw) as { loc: Loc; addr?: string; area?: string; country?: string };
      if (saved?.loc && typeof saved.loc.lat === "number" && typeof saved.loc.lng === "number") {
        setUserLoc(saved.loc);
        setUserAddr(saved.addr || "Vị trí đã lưu");
        setAreaName(saved.area || "");
        setCountry(saved.country || "");
        setGeoState("ok");
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
        JSON.stringify({ loc: userLoc, addr: userAddr, area: areaName, country })
      );
    } catch {
      // bỏ qua nếu localStorage không khả dụng
    }
  }, [userLoc, userAddr, areaName, country]);

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
        setCatalog({ products: d.products, offers: d.offers, groups: d.groups, priorities: d.priorities });
        setSource(d.source);
      })
      .catch(() => setCatalog({ products: [], offers: [] }));
  }, []);

  // Nạp cửa hàng vật lý + toạ độ từ API.
  useEffect(() => {
    let url = "/api/stores";
    const params = new URLSearchParams();
    if (userLoc) {
      params.append("lat", String(userLoc.lat));
      params.append("lng", String(userLoc.lng));
      const radMeters = radiusKm ? radiusKm * 1000 : 5000;
      params.append("radius", String(radMeters));
      params.append("limit", "500");
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
        if (d.stores?.length) {
          setDynamicStores(d.stores);
          setStoresReady((v) => v + 1);
        }
      })
      .catch(() => { });
  }, [userLoc, radiusKm, activeTep]);

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

  // Nút "lên đầu trang": chỉ hiện khi đã kéo xuống đủ xa.
  const [showTop, setShowTop] = useState(false);
  useEffect(() => {
    const onScroll = () => setShowTop(window.scrollY > 400);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

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
        setToast(t("Đã cập nhật vị trí hiện tại"));
        setTimeout(() => setToast(""), 3000);
        reverseGeocode(lat, lng).then((r) => {
          if (r.label) setUserAddr(r.label);
          if (r.area) setAreaName(r.area);
          setCountry(r.cc);
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
    setGeoState("ok");
    setLocOpen(false);
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

  const priceStats = useMemo(() => {
    const m = new Map<string, { min: number; max: number; stores: number; outOfStock: boolean; currency: string }>();
    if (!catalog) return m;
    for (const p of catalog.products) {
      const priced = catalog.offers.filter((o) => o.productId === p.id && o.price > 0);
      const inStock = priced.filter((o) => o.inStock);
      if (!inStock.length) {
        // Có giá nhưng tất cả điểm bán đều hết hàng → đánh dấu "hết hàng" (khác "chưa có giá").
        m.set(p.id, { min: 0, max: 0, stores: 0, outOfStock: priced.length > 0, currency: storeCurrency(priced[0]?.storeId) });
        continue;
      }
      const prices = inStock.map((o) => o.price);
      m.set(p.id, {
        min: Math.min(...prices),
        max: Math.max(...prices),
        stores: new Set(inStock.map((o) => o.storeId)).size,
        outOfStock: false,
        // Tiền tệ của sản phẩm = tiền tệ cửa hàng bán (mỗi sản phẩm chỉ bán ở 1 hệ tiền tệ).
        currency: storeCurrency(inStock[0].storeId),
      });
    }
    return m;
  }, [catalog]);

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
    // Lọc 2 cấp lồng nhau: trước theo TỆP (group), rồi theo NGÀNH HÀNG (category) bên trong.
    if (activeTep) list = list.filter((p) => categoryGroup(p) === activeTep);
    if (activeCat) list = list.filter((p) => (p.category || "").trim() === activeCat);
    return list;
  }, [catalog, deferredQuery, activeTep, activeCat]);

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
      product: Product; now: number; was: number; save: number; disc: number; currency: string; storeName: string; km: number | null;
    }[];
    const storeById = new Map(getStores().map((s) => [s.id, s]));
    const rows = [];
    for (const p of catalog.products) {
      const s = priceStats.get(p.id);
      if (!s || s.outOfStock || s.stores < 2 || s.max <= s.min) continue;
      const disc = (s.max - s.min) / s.max;
      if (disc < 0.05) continue;
      // Điểm bán còn hàng ở GIÁ THẤP NHẤT (min). Nếu đã định vị → chọn nơi giá thấp nhất
      // GẦN nhất; ghi lại khoảng cách để vừa "ưu tiên giá thấp nhất" vừa "ưu tiên gần nhất".
      let bestStore: Store | undefined;
      let bestKm: number | null = null;
      for (const o of catalog.offers) {
        if (o.productId !== p.id || !o.inStock || o.price !== s.min) continue;
        const st = storeById.get(o.storeId);
        const km =
          userLoc && st?.lat != null && st?.lng != null
            ? distanceKm(userLoc, { lat: st.lat, lng: st.lng })
            : null;
        if (!bestStore || (km != null && (bestKm == null || km < bestKm))) {
          bestStore = st;
          bestKm = km;
        }
      }
      rows.push({
        product: p,
        now: s.min,
        was: s.max,
        save: s.max - s.min,
        disc,
        currency: s.currency,
        storeName: bestStore?.name ?? "",
        km: bestKm,
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
    return rows.slice(0, 16);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalog, priceStats, userLoc, storesReady]);

  // Dãy chip lọc theo NGÀNH HÀNG (cột "category" trong sheet, vd "Gia vị", "Nước lau sàn"…).
  // Nếu đã chọn TỆP ở trên → chỉ hiện ngành hàng THUỘC tệp đó; chưa chọn tệp → hiện tất cả.
  // Xếp theo số lượng sản phẩm giảm dần.
  const catChips = useMemo(() => {
    if (!catalog) return [] as string[];
    const base = activeTep
      ? catalog.products.filter((p) => categoryGroup(p) === activeTep)
      : catalog.products;
    const count = new Map<string, number>();
    for (const p of base) {
      const c = (p.category || "").trim();
      if (!c) continue;
      count.set(c, (count.get(c) ?? 0) + 1);
    }
    return [...count.keys()].sort((a, b) => (count.get(b) ?? 0) - (count.get(a) ?? 0));
  }, [catalog, activeTep]);

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
      const st = priceStats.get(p.id);
      if (!st || st.stores <= 0) continue;
      const realPop = (purchaseCounts[p.id] ?? 0) * 5 + (viewCounts[p.id] ?? 0);
      const areaDemand = seedRand(`${areaKey}|${p.id}`); // 0..1 giả định theo khu vực
      scored.push({ p, score: realPop * 1000 + areaDemand * 100 });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.map((x) => x.p);
  }, [catalog, userLoc, areaName, priceStats, purchaseCounts, viewCounts]);

  // Top sản phẩm "bán chạy" để gắn tag: theo khu vực nếu đã định vị, không thì theo phổ biến chung.
  const areaHotTopIds = useMemo(() => {
    if (userLoc && areaHot.length) return new Set(areaHot.slice(0, 12).map((p) => p.id));
    if (!catalog) return new Set<string>();
    return new Set(
      [...catalog.products]
        .filter((p) => (priceStats.get(p.id)?.stores ?? 0) > 0)
        .sort((a, b) => hotScore(b) - hotScore(a))
        .slice(0, 12)
        .map((p) => p.id)
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userLoc, areaHot, catalog, priceStats, purchaseCounts, viewCounts]);

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
        tags.push({ key: "deal", label: t("Deal -{x}%", { x: Math.round(d * 100) }), cls: "bg-rose-600 text-white" });
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

  // Đổi tìm kiếm / danh mục / lọc nhanh → quay về trang 1.
  useEffect(() => {
    setPage(1);
  }, [query, activeTep, activeCat, quickFilter]);

  const allOffers = useMemo(
    () => (catalog && selected ? rankOffersForProduct(catalog, selected, userLoc) : []),
    // storesReady: tính lại sau khi nạp toạ độ cửa hàng từ sheet.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [catalog, selected, userLoc, storesReady]
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

  // Cửa hàng gần nhất (còn hàng, có khoảng cách) — để gắn tag "Gần nhất" khi sắp theo "Gần".
  const nearestStoreId = useMemo(() => {
    if (sortBy !== "distance" || !userLoc) return null;
    const near = offers
      .filter((o) => o.inStock && o.distanceKm != null)
      .sort((a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity))[0];
    return near?.storeId ?? null;
  }, [offers, sortBy, userLoc]);

  // Sản phẩm tương tự: cùng nhóm danh mục, ưu tiên loại đang có giá; bỏ chính nó.
  const similar = useMemo(() => {
    if (!catalog || !selected) return [] as Product[];
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
  }, [selected, offers, cheapest, radiusKm, userLoc, storesReady]);

  // Bấm "Vào mua hàng" → mở web cửa hàng đồng thời ghi nhận 1 lượt mua.
  async function recordBuy(o: RankedOffer) {
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
        storeName: buyStore?.name ?? off?.storeId ?? "Affree",
        chain: buyStore?.chain ?? "other",
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
    if (catalog?.groups?.length) return buildTilesFromGroups(catalog.groups, catalog.products);
    // Chưa có tab "tệp" → dựng như cũ: Đi chợ + tệp suy luận + dịch vụ ngoài.
    return [...SERVICE_LEAD, ...buildCategoryTiles(catalog?.products ?? []), ...SERVICE_TAIL];
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

  // Bấm 1 ô dịch vụ ở lưới "siêu ứng dụng".
  function openService(s: ServiceTile) {
    setSelected(null);
    setQuery("");
    setActiveService(s.key);
    if (s.kind === "all") {
      setActiveTep(null);
      setActiveCat(null);
      setPage(1);
    } else if (s.kind === "filter" && s.cat) {
      // Chọn TỆP mới → đặt lại ngành hàng (chip) về "Tất cả" cho khớp tệp vừa chọn.
      setActiveTep(s.cat);
      setActiveCat(null);
      setPage(1);
      setToast(t("Đang xem: {label}", { label: t(s.label) }));
      setTimeout(() => setToast(""), 2500);
    } else if (s.kind === "link" && s.url) {
      window.open(s.url, "_blank", "noopener,noreferrer");
      setToast(t("Mở {label} (trang dịch vụ bên ngoài)", { label: t(s.label) }));
      setTimeout(() => setToast(""), 3000);
    } else {
      setToast(t("{label} — sắp ra mắt", { label: t(s.label) }));
      setTimeout(() => setToast(""), 2500);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header ref={headerRef} className="sticky top-0 z-[1000] border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
          <Link href="/" className="flex items-center gap-2">
            <Logo size={34} />
            <span className="flex flex-col leading-tight">
              <span className="whitespace-nowrap text-lg font-bold tracking-tight">
                Affree
              </span>
              <span className="hidden text-xs text-slate-500 sm:inline">
                {t("Giá hời quanh đây - Mua gì cũng có")}
              </span>
            </span>
          </Link>
          <button
            onClick={() => setVerOpen(true)}
            title={t("Phiên bản & tính năng sắp tới")}
            className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 transition hover:bg-emerald-100"
          >
            v{APP_VERSION}
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 16v-4" />
              <path d="M12 8h.01" />
            </svg>
          </button>
          <div className="ml-auto flex items-center gap-2">
            <div className="relative">
              <button
                onClick={() => setLocOpen((v) => !v)}
                title={t("Vị trí của bạn")}
                className={`flex max-w-[150px] items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition sm:max-w-[230px] ${geoState === "ok"
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                  : "border-slate-300 hover:bg-slate-100"
                  }`}
              >
                <span>📍</span>
                <span className="hidden truncate sm:inline">
                  {geoState === "locating"
                    ? t("Đang định vị…")
                    : userLoc
                      ? userAddr || t("Đã có vị trí")
                      : t("Chọn vị trí")}
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
                  t={t}
                />
              )}
            </div>
            <Link
              href="/history"
              className="rounded-full border border-slate-300 px-3 py-1.5 text-sm font-medium hover:bg-slate-100"
            >
              {t("Lịch sử mua")}
            </Link>
          </div>
        </div>
      </header>

      {verOpen && (
        <div
          className="fixed inset-0 z-[1200] flex items-end justify-center bg-slate-900/50 p-0 sm:items-center sm:p-4"
          onClick={() => setVerOpen(false)}
        >
          <div
            className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-1 flex items-start justify-between gap-3">
              <div className="flex items-center gap-2">
                <Logo size={30} />
                <div>
                  <p className="text-base font-bold tracking-tight">
                    Affree
                    <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700">
                      {t("Phiên bản")} {APP_VERSION}
                    </span>
                  </p>
                  <p className="text-xs text-slate-500">{t("Giá hời quanh đây - Mua gì cũng có")}</p>
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

            <p className="mt-3 mb-2 flex items-center gap-2 text-sm font-semibold text-slate-700">
              <span className="rounded-md bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-700">
                {t("Đã có")}
              </span>
              {t("Tính năng trong bản {v}", { v: APP_VERSION })}
            </p>
            <ul className="mb-1 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {DONE.map((it, i) => (
                <li key={i} className="flex gap-2 text-xs leading-snug text-slate-600">
                  <svg className="mt-0.5 shrink-0 text-emerald-500" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                  <span>{it}</span>
                </li>
              ))}
            </ul>

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

      <main className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-5">
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
              className="shrink-0 rounded-full bg-emerald-600 px-3 py-1 text-xs font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-60"
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
          {!selected && (
            <div
              className="sticky z-20 -mx-4 mb-1 bg-slate-50 px-4 py-2"
              style={{ top: headerH }}
            >
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
                  placeholder={t("Tìm sản phẩm (vd: sữa, tã, dầu ăn, gạo…)")}
                  className="w-full rounded-2xl border-2 border-slate-200 bg-white py-3.5 pl-12 pr-4 text-base shadow-sm outline-none transition focus:border-emerald-500 focus:shadow-md focus:ring-4 focus:ring-emerald-100"
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
            </div>
          )}

          {!selected && !query.trim() && (
            <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
              <div className="mb-2 flex items-baseline justify-between">
                <h2 className="text-sm font-semibold text-slate-700">{t("Dịch vụ quanh đây")}</h2>
                <span className="text-[11px] text-slate-400">{t("Mua sắm · nhà đất · dịch vụ")}</span>
              </div>
              <div className="relative">
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
                  className="flex gap-2 overflow-x-auto scroll-smooth px-0.5 pb-2 pt-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                >
                  {services.map((s) => {
                    const active =
                      s.kind === "filter" && s.cat ? activeTep === s.cat : activeService === s.key;
                    return (
                      <button
                        key={s.key}
                        onClick={() => openService(s)}
                        className={`group relative flex w-[calc((100%-2.5rem)/6)] shrink-0 flex-col items-center gap-1.5 rounded-2xl border px-2 py-3 transition ${active
                          ? "border-emerald-500 bg-emerald-50 shadow ring-2 ring-emerald-200"
                          : "border-slate-200 bg-white shadow-sm hover:-translate-y-0.5 hover:border-slate-300 hover:shadow"
                          }`}
                      >
                        <span
                          className={`flex h-12 w-12 items-center justify-center rounded-2xl text-3xl transition group-hover:scale-105 sm:h-16 sm:w-16 sm:text-4xl ${s.tint}`}
                        >
                          {s.emoji}
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
                          className={`line-clamp-2 text-center text-xs font-medium leading-tight ${active ? "text-emerald-700" : "text-slate-600"
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

          {!selected && !query.trim() && areaDeals.length > 0 && (
            <div className="mt-3 rounded-2xl border border-amber-200/80 bg-gradient-to-br from-amber-50 to-white p-3 shadow-sm sm:p-4">
              <div className="mb-2 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <h2 className="text-sm font-semibold text-slate-800">{t("🔥 Giá hời quanh đây")}</h2>
                <span className="text-[11px] text-slate-400">
                  {t("so giá nhiều nơi · bật vị trí để ưu tiên gần bạn")}
                </span>
              </div>
              <div className="relative">
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
                <div
                  ref={dealScrollRef}
                  onScroll={updateDealArrows}
                  className="flex gap-3 overflow-x-auto scroll-smooth px-0.5 pb-1 pt-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                >
                  {areaDeals.map((d) => (
                    <div
                      key={d.product.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => openBuyAgent(d.product)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          openBuyAgent(d.product);
                        }
                      }}
                      className="group relative flex w-36 shrink-0 cursor-pointer flex-col rounded-xl border border-slate-200 bg-white p-2.5 text-left transition hover:border-emerald-500 hover:shadow-md sm:w-40"
                    >
                      <span className="absolute left-2 top-2 z-10 rounded-md bg-rose-600 px-1.5 py-0.5 text-[11px] font-bold text-white shadow-sm">
                        -{Math.round(d.disc * 100)}%
                      </span>
                      <div className="mb-1.5 flex aspect-square w-full items-center justify-center overflow-hidden rounded-lg bg-white">
                        <ProductThumb product={d.product} fill />
                      </div>
                      <div className="line-clamp-2 min-h-[2.25rem] text-xs font-medium leading-tight text-slate-700">
                        {d.product.name}
                      </div>
                      <div className="mt-1 flex flex-wrap items-baseline gap-x-1.5">
                        <span className="text-sm font-bold text-rose-600">{formatMoney(d.now, d.currency)}</span>
                        <span className="text-[11px] text-slate-400 line-through">{formatMoney(d.was, d.currency)}</span>
                      </div>
                      <div className="mt-0.5 text-[11px] font-medium text-emerald-600">
                        {t("Tiết kiệm {x}", { x: formatMoney(d.save, d.currency) })}
                      </div>
                      {d.storeName && (
                        <div className="mt-1 line-clamp-1 text-[11px] text-slate-500">🛒 {d.storeName}</div>
                      )}
                      {d.km != null && (
                        <div className="mt-0.5 line-clamp-1 text-[11px] font-medium text-emerald-600">
                          📍 {t("cách bạn {km} km", { km: d.km.toFixed(1) })}
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          openBuyAgent(d.product);
                        }}
                        className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-emerald-600 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-700"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="9" cy="21" r="1" />
                          <circle cx="20" cy="21" r="1" />
                          <path d="M1 1h4l2.7 13.4a2 2 0 0 0 2 1.6h9.7a2 2 0 0 0 2-1.6L23 6H6" />
                        </svg>
                        {t("Vào mua")}
                      </button>
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
          )}

          {!selected && !query.trim() && catChips.length > 0 && (
            <div className="mt-3 flex items-center gap-2 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <button
                onClick={() => {
                  setActiveCat(null);
                  setPage(1);
                }}
                className={`shrink-0 rounded-full border px-4 py-2 text-sm font-medium transition ${activeCat === null
                  ? "border-emerald-600 bg-emerald-600 text-white"
                  : "border-slate-200 bg-white text-slate-600 hover:bg-slate-100"
                  }`}
              >
                {t("Tất cả")}
              </button>
              {catChips.map((cat) => (
                <button
                  key={cat}
                  onClick={() => {
                    setActiveCat((cur) => (cur === cat ? null : cat));
                    setPage(1);
                  }}
                  className={`shrink-0 rounded-full border px-4 py-2 text-sm font-medium transition ${activeCat === cat
                    ? "border-emerald-600 bg-emerald-600 text-white"
                    : "border-slate-200 bg-white text-slate-600 hover:bg-slate-100"
                    }`}
                >
                  {prettyCat(cat)}
                </button>
              ))}
            </div>
          )}

          {userLoc && (
            <div className="mt-3 flex items-center gap-1.5 overflow-x-auto pb-0.5">
              <span className="inline-flex shrink-0 items-center gap-1 pr-0.5 text-xs font-medium text-slate-500">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
                  <circle cx="12" cy="10" r="3" />
                </svg>
                {t("Bán kính")}
              </span>
              {[1, 3, 5, 10].map((r) => (
                <button
                  key={r}
                  onClick={() => setRadiusKm((cur) => (cur === r ? null : r))}
                  className={`shrink-0 rounded-full border px-2.5 py-0.5 text-xs transition ${radiusKm === r
                    ? "border-emerald-600 bg-emerald-600 text-white"
                    : "border-slate-200 bg-white text-slate-600 hover:bg-slate-100"
                    }`}
                >
                  {r} km
                </button>
              ))}
              {radiusKm === null ? (
                <button
                  onClick={() => setRadiusKm(null)}
                  className="shrink-0 rounded-full border border-emerald-600 bg-emerald-600 px-2.5 py-0.5 text-xs text-white"
                >
                  {t("Tất cả")}
                </button>
              ) : (
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

          {source && source.startsWith("seed") && (
            <p className="mt-2 text-xs text-slate-400">
              {t("Nguồn dữ liệu:")} <b>{t("data mẫu")}</b> {t("· không đọc được sheet, đang dùng tạm dữ liệu mẫu.")}
            </p>
          )}

          {!selected && (
            <>
              <div className="mt-4 mb-2 flex items-baseline justify-between gap-2">
                <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                  {query
                    ? t("Kết quả")
                    : quickFilter
                      ? t(QUICK_FILTERS.find((q) => q.key === quickFilter)!.label)
                      : activeTep || activeCat
                        ? t("Kết quả")
                        : t("Sản phẩm phổ biến")}
                  {quickFilter === "hot" && areaName && !query && (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                      📍 {areaName}
                    </span>
                  )}
                  {activeTep && !query && (
                    <button
                      onClick={() => {
                        setActiveTep(null);
                        setActiveCat(null);
                        setPage(1);
                      }}
                      className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-medium text-slate-500 transition hover:bg-slate-100"
                    >
                      {prettyCat(activeTep)}
                      <span className="text-slate-400">✕</span>
                    </button>
                  )}
                  {activeCat && !query && (
                    <button
                      onClick={() => {
                        setActiveCat(null);
                        setPage(1);
                      }}
                      className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 transition hover:bg-emerald-100"
                    >
                      {prettyCat(activeCat)}
                      <span className="text-emerald-400">✕</span>
                    </button>
                  )}
                </h2>
                {catalog && (
                  <span className="shrink-0 text-xs text-slate-400">
                    {t("{n} sản phẩm", { n: quickFilter || activeTep || activeCat ? orderedMatches.length : matches.length })}
                  </span>
                )}
              </div>
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {pageItems.map((p) => {
                  const st = priceStats.get(p.id);
                  const tags = recoTags.get(p.id) ?? [];
                  const compare = canCompare(p);
                  return (
                    <li key={p.id}>
                      <button
                        onClick={() => (compare ? openProduct(p) : openBuyForm(p))}
                        className="group flex h-full w-full flex-col rounded-xl border border-slate-200 bg-white p-3 text-left transition hover:border-emerald-500 hover:shadow-md"
                      >
                        <div className="relative mb-1 flex aspect-square w-full items-center justify-center overflow-hidden rounded-lg bg-white">
                          <ProductThumb product={p} fill />
                          {tags.length > 0 && (
                            <span className="absolute left-1 top-1 flex flex-col items-start gap-1">
                              {tags.map((t) => (
                                <span
                                  key={t.key}
                                  className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold shadow-sm ${t.cls}`}
                                >
                                  {t.label}
                                </span>
                              ))}
                            </span>
                          )}
                        </div>
                        {p.image && imageSource(p.image) ? (
                          <span className="mb-1.5 block truncate text-[10px] leading-none text-slate-300">
                            {t("Ảnh: {src}", { src: imageSource(p.image) ?? "" })}
                          </span>
                        ) : (
                          <span className="mb-1.5 block h-[10px]" />
                        )}
                        <span className="line-clamp-2 text-sm font-medium leading-snug text-slate-800">
                          {p.name}
                        </span>
                        <span className="mt-0.5 truncate text-xs text-slate-400">
                          {p.brand} · {p.unit}
                        </span>
                        {st && st.stores > 0 ? (
                          <>
                            <span className="mt-1.5 inline-flex items-center gap-1 text-base font-bold text-rose-600">
                              <svg className="shrink-0 text-rose-500" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M20.59 13.41 13.42 20.6a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82Z" />
                                <circle cx="7" cy="7" r="1.2" fill="currentColor" />
                              </svg>
                              {formatMoney(st.min, st.currency)}
                            </span>
                            <span className="mt-0.5 inline-flex items-center gap-1 text-xs text-slate-500">
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <circle cx="9" cy="21" r="1" />
                                <circle cx="20" cy="21" r="1" />
                                <path d="M1 1h4l2.7 13.4a2 2 0 0 0 2 1.6h9.7a2 2 0 0 0 2-1.6L23 6H6" />
                              </svg>
                              {t("Có {n} nơi bán", { n: st.stores })}
                            </span>
                          </>
                        ) : st && st.outOfStock ? (
                          <span className="mt-1.5 text-sm font-medium text-red-500">{t("Hết hàng")}</span>
                        ) : (
                          <span className="mt-1.5 text-sm text-slate-400">{t("Chưa có giá")}</span>
                        )}
                        <span className="mt-auto pt-2.5">
                          {compare ? (
                            <span className="flex items-center justify-center gap-1.5 rounded-lg bg-emerald-600 py-2 text-xs font-semibold text-white shadow-sm transition-colors duration-200 group-hover:bg-emerald-700">
                              {t("So sánh giá")}
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M5 12h14M13 6l6 6-6 6" />
                              </svg>
                            </span>
                          ) : (
                            <span className="flex items-center justify-center gap-1.5 rounded-lg bg-amber-500 py-2 text-xs font-semibold text-white shadow-sm transition-colors duration-200 group-hover:bg-amber-600">
                              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <circle cx="9" cy="21" r="1" />
                                <circle cx="20" cy="21" r="1" />
                                <path d="M1 1h4l2.7 13.4a2 2 0 0 0 2 1.6h9.7a2 2 0 0 0 2-1.6L23 6H6" />
                              </svg>
                              {t("Vào mua")}
                            </span>
                          )}
                        </span>
                      </button>
                    </li>
                  );
                })}
                {catalog && orderedMatches.length === 0 && (
                  quickFilter === "hot" && !userLoc ? (
                    <li className="col-span-full rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-center text-sm text-slate-500">
                      {t("Cần vị trí để xem sản phẩm bán chạy quanh bạn.")}
                      <button
                        onClick={locate}
                        className="ml-2 inline-flex items-center gap-1 rounded-full bg-emerald-600 px-3 py-1 text-xs font-semibold text-white"
                      >
                        {t("Bật vị trí")}
                      </button>
                    </li>
                  ) : quickFilter === "hot" ? (
                    <li className="col-span-full text-sm text-slate-500">
                      {t("Chưa có sản phẩm bán chạy trong khu vực {r} km quanh bạn.", { r: radiusKm ?? 10 })}
                    </li>
                  ) : (
                    <li className="col-span-full text-sm text-slate-500">{t("Không tìm thấy sản phẩm phù hợp.")}</li>
                  )
                )}
              </ul>

              {totalPages > 1 && (
                <div className="mt-5 flex items-center justify-center gap-3">
                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page <= 1}
                    className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100 disabled:opacity-40"
                  >
                    {t("← Trước")}
                  </button>
                  <span className="text-sm text-slate-500">
                    {t("Trang {page}/{total}", { page, total: totalPages })}
                  </span>
                  <button
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page >= totalPages}
                    className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100 disabled:opacity-40"
                  >
                    {t("Sau →")}
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
                {t("← Tất cả kết quả")}
              </button>
              <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_260px] lg:items-start lg:gap-6">
                <div className="max-w-5xl">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <ProductThumb product={selected} size={52} />
                      <div className="min-w-0">
                        <h2 className="truncate text-lg font-semibold">{selected.name}</h2>
                        <p className="truncate text-sm text-slate-500">
                          {selected.brand} · {selected.unit} · {t("{n} cửa hàng", { n: offers.length })}
                        </p>
                        {selected.image && (
                          <p className="mt-0.5 truncate text-[11px] text-slate-400">
                            {t("Ảnh minh hoạ")}{imageSource(selected.image) ? ` · ${t("nguồn: {src}", { src: imageSource(selected.image) ?? "" })}` : ""} — {t("thuộc về chủ sở hữu.")}
                          </p>
                        )}
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
                          ? t("Đang định vị…")
                          : t("Chọn vị trí (định vị hoặc nhập địa chỉ) để xem khoảng cách tới từng cửa hàng và lọc theo bán kính.")}
                      </span>
                    </button>
                  )}

                  {cheapest && maxInStock > cheapest.price && (
                    <div className="mt-3 flex w-fit max-w-full items-center gap-2.5 rounded-xl border border-emerald-100 bg-emerald-50 px-3.5 py-2.5 text-sm text-emerald-800">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-base">
                        💰
                      </span>
                      <span>
                        {t("Rẻ hơn {amount} nếu mua ở {store}", { amount: formatMoney(maxInStock - cheapest.price, storeCurrency(cheapest.storeId)), store: cheapest.store.name })}
                      </span>
                    </div>
                  )}

                  {alertOpen && (
                    <div
                      className="fixed inset-0 z-[1100] flex items-center justify-center bg-slate-900/50 p-4"
                      onClick={() => setAlertOpen(false)}
                    >
                      <div
                        className="w-full max-w-sm rounded-2xl border border-amber-200 bg-white p-5 shadow-xl"
                        onClick={(e) => e.stopPropagation()}
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
                          className="mt-3 w-full rounded-lg bg-amber-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-amber-600"
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
                  )}

                  {displayOffers.length === 0 && offers.length === 0 && (
                    <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-6 text-center">
                      <p className="text-sm text-slate-600">
                        {t("Sản phẩm này chưa có nhiều nơi bán để so sánh giá.")}
                      </p>
                      <button
                        onClick={() => openBuyForm(selected)}
                        className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-amber-600"
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="9" cy="21" r="1" />
                          <circle cx="20" cy="21" r="1" />
                          <path d="M1 1h4l2.7 13.4a2 2 0 0 0 2 1.6h9.7a2 2 0 0 0 2-1.6L23 6H6" />
                        </svg>
                        {t("Vào mua")}
                      </button>
                    </div>
                  )}

                  {displayOffers.length === 0 && offers.length > 0 && (
                    <div className="mt-3 rounded-xl border border-dashed border-slate-300 bg-white px-4 py-6 text-center text-sm text-slate-500">
                      {t("Không có cửa hàng nào trong bán kính {r} km.", { r: radiusKm ?? 0 })}{" "}
                      <button
                        onClick={() => setRadiusKm(null)}
                        className="font-medium text-emerald-600 hover:underline"
                      >
                        {t("Bỏ giới hạn bán kính")}
                      </button>
                    </div>
                  )}

                  {displayOffers.length > 0 && (
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
                  )}

                  <ul className="space-y-2.5">
                    {displayOffers.map((o) => {
                      const isCheapest = cheapest?.storeId === o.storeId;
                      const isNearest = nearestStoreId === o.storeId;
                      const diff = cheapest && o.inStock ? o.price - cheapest.price : 0;
                      return (
                        <li
                          key={o.storeId}
                          onMouseEnter={() => setHoverStore(o.storeId)}
                          onMouseLeave={() => setHoverStore(null)}
                          className={`rounded-2xl border p-3 transition ${isCheapest
                            ? "border-emerald-300 bg-emerald-50/50 shadow-sm"
                            : isNearest
                              ? "border-blue-300 bg-blue-50/50 shadow-sm"
                              : "border-slate-200 bg-white hover:border-slate-300 hover:shadow-sm"
                            } ${!o.inStock ? "opacity-60" : ""}`}
                        >
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
                            <div className="flex min-w-0 flex-1 items-start gap-3">
                              <ChainBadge chain={o.store.chain} />
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center justify-between gap-2">
                                  <span className="truncate font-semibold text-slate-900">
                                    {o.store.name}
                                  </span>
                                  {(isCheapest || isNearest) && o.inStock && (
                                    <span className="flex shrink-0 items-center gap-1">
                                      {isCheapest && (
                                        <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-white">
                                          {t("Rẻ nhất")}
                                        </span>
                                      )}
                                      {isNearest && (
                                        <span className="inline-flex items-center gap-1 rounded-full bg-blue-600 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-white">
                                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                                            <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
                                            <circle cx="12" cy="10" r="3" />
                                          </svg>
                                          {t("Gần nhất")}
                                        </span>
                                      )}
                                    </span>
                                  )}
                                </div>
                                <div className="truncate text-xs text-slate-500">{o.store.address}</div>
                                <div className="mt-1.5 flex items-center gap-2 text-xs">
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
                                    </>
                                  )}
                                </div>
                              </div>
                            </div>

                            <div className="flex items-center justify-between gap-3 sm:shrink-0 sm:justify-end sm:gap-4">
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
                                    {t("Đắt hơn {amount}", { amount: formatMoney(diff, storeCurrency(o.storeId)) })}
                                  </div>
                                )}
                              </div>

                              <div className="flex gap-2">
                                <button
                                  onClick={() => setBuyOffer(o)}
                                  className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700"
                                >
                                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <circle cx="9" cy="21" r="1" />
                                    <circle cx="20" cy="21" r="1" />
                                    <path d="M1 1h4l2.7 13.4a2 2 0 0 0 2 1.6h9.7a2 2 0 0 0 2-1.6L23 6H6" />
                                  </svg>
                                  {t("Mua")}
                                </button>
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
                                  {t("Chỉ đường")}
                                </a>
                              </div>
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>

                {similar.length > 0 && (
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
                )}
              </div>
            </div>
          )}
        </section>

        <section
          className={`relative z-0 overflow-hidden rounded-xl border border-slate-200 lg:block lg:h-[460px] ${mobileView === "map" ? "block h-[calc(100vh-11rem)]" : "hidden"
            }`}
        >
          <MapView
            center={center}
            userLoc={userLoc}
            userAddr={userAddr}
            markers={markers}
            highlightId={hoverStore}
            radiusKm={radiusKm}
            lang={lang}
            tileUrl={tileUrl}
            onBuy={
              selected
                ? (store) => openBuyForm(selected, store)
                : undefined
            }
          />
        </section>
      </main>

      <footer className="mt-8 border-t border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-3 px-4 py-7 pb-24 text-center sm:flex-row sm:justify-between sm:pb-7 sm:text-left lg:pb-7">
          <a
            href="https://one-solution.vn"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center opacity-90 transition hover:opacity-100"
            title="One Solution"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/assets/os-logo.png" alt="One Solution" className="h-9 w-auto" />
          </a>
          <p className="text-xs leading-relaxed text-slate-500">
            © {new Date().getFullYear()} <b className="text-slate-700">Affree</b> — {t("sản phẩm của")}{" "}
            <a
              href="https://one-solution.vn"
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold text-slate-700 transition hover:text-emerald-600"
            >
              One Solution
            </a>
            .<br className="hidden sm:block" />
            {t("Giá hời quanh đây - Mua gì cũng có.")}
          </p>
          <p className="max-w-md text-[11px] leading-relaxed text-slate-400 sm:text-right">
            {t("Giá & thông tin được tổng hợp từ nguồn công khai, có thể thay đổi theo thời gian. Hình ảnh, logo và thương hiệu thuộc về chủ sở hữu tương ứng; Affree là dịch vụ so sánh giá & điều hướng mua hàng. Yêu cầu gỡ nội dung: liên hệ One Solution.")}
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
      {showTop && (
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
      )}

      {toast && (
        <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-slate-900 px-4 py-2 text-sm text-white shadow-lg">
          {toast}
        </div>
      )}

      {buyOffer && (
        <OrderAgentModal
          offer={buyOffer}
          lang={lang}
          alternatives={allOffers.filter((o) => o.product.id === buyOffer.product.id)}
          geoAddr={userAddr}
          defaultAddress={userAddr}
          onClose={() => setBuyOffer(null)}
          onPlaced={(code, chosen) => {
            recordBuy(chosen);
            setToast(t("Đã đặt {product} tại {store} · {code}", { product: chosen.product.name, store: chosen.store.name, code }));
            setTimeout(() => setToast(""), 4000);
          }}
        />
      )}

      {buyProduct && (
        <div
          className="fixed inset-0 z-[1100] flex items-end justify-center bg-slate-900/50 p-0 sm:items-center sm:p-4"
          onClick={() => !buySubmitting && setBuyProduct(null)}
        >
          <div
            className="w-full max-w-md rounded-t-2xl border border-amber-200 bg-white p-5 shadow-xl sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
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
              {t("Sản phẩm chưa có nhiều nơi bán để so sánh. Điền thông tin, shop sẽ liên hệ và giao tận nơi.")}
            </p>

            <div className="space-y-2.5">
              <input
                value={buyName}
                onChange={(e) => setBuyName(e.target.value)}
                placeholder={t("Họ tên người nhận *")}
                autoFocus
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-100"
              />
              <input
                value={buyPhone}
                onChange={(e) => setBuyPhone(e.target.value)}
                type="tel"
                inputMode="tel"
                placeholder={t("Số điện thoại / Zalo *")}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-100"
              />
              <input
                value={buyAddr}
                onChange={(e) => setBuyAddr(e.target.value)}
                placeholder={t("Địa chỉ giao hàng")}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-100"
              />
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
              <textarea
                value={buyNote}
                onChange={(e) => setBuyNote(e.target.value)}
                rows={2}
                placeholder={t("Ghi chú (tuỳ chọn): màu sắc, kích cỡ, thời gian nhận…")}
                className="w-full resize-none rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-100"
              />
            </div>

            <button
              onClick={submitBuy}
              disabled={buySubmitting}
              className="mt-4 w-full rounded-lg bg-amber-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-amber-600 disabled:opacity-60"
            >
              {buySubmitting ? t("Đang gửi…") : t("Gửi yêu cầu mua")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
