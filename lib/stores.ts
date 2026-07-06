import type { Chain, Store } from "./types";

/**
 * Metadata cho từng nguồn bán hàng (chuỗi). 4 nguồn đầu có cửa hàng vật lý;
 * còn lại là nguồn online lấy từ master sheet.
 */
interface SourceMeta {
  label: string;
  color: string;
  /** Trang chủ / nơi mua online (dùng cho nguồn online không có cửa hàng vật lý). */
  home: string;
  online?: boolean;
  /** Logo thật của chuỗi (URL). Trống → tự lấy favicon từ `home`. */
  logo?: string;
  /** Tiền tệ mặc định của nguồn (fallback khi tab "stores" chưa khai báo cột currency). */
  currency?: string;
  /** Giá trị đơn hàng tối thiểu (VND). 0 hoặc undefined = không giới hạn. */
  minOrder?: number;
}

export const SOURCE_META: Record<string, SourceMeta> = {
  bhx: { label: "Bách Hóa Xanh", color: "#1aa64b", home: "https://www.bachhoaxanh.com" },
  concung: { label: "Con Cưng", color: "#e6007e", home: "https://concung.com" },
  coop: { label: "Co.opmart", color: "#0067b1", home: "https://cooponline.vn", minOrder: 200000 },
  aeon: { label: "AEON", color: "#8e0d3c", home: "https://aeoneshop.com" },
  shopee: { label: "Shopee", color: "#ee4d2d", home: "https://shopee.vn", online: true },
  spe: { label: "Shopee", color: "#ee4d2d", home: "https://shopee.vn", online: true },
  grab: { label: "GrabMart", color: "#00b14f", home: "https://food.grab.com", online: true },
  gf: { label: "GrabFood", color: "#00b14f", home: "https://food.grab.com", online: true },
  thxl: { label: "Tạp Hóa Xe Lam", color: "#16a34a", home: "https://taphoaxelam.com", online: true },
  tdat: { label: "Thiên Đường Ẩm Thực", color: "#f59e0b", home: "https://foodparadise.vn", online: true },
  cop: { label: "Co.opmart", color: "#0067b1", home: "https://cooponline.vn", minOrder: 200000 },
  pnj: { label: "PNJ", color: "#c9a227", home: "https://www.pnj.com.vn", online: true },
  dalathasfarm: { label: "Dalat Hasfarm", color: "#2e7d32", home: "https://dalathasfarm.com", online: true },
  ichiban: { label: "Ichiban Market", color: "#d32f2f", home: "https://ichibanmarket.com.vn", online: true },
  lotte: { label: "LOTTE Mart", color: "#ed1c24", home: "https://www.lottemart.vn", online: true },
  krmart: { label: "Korea Mart", color: "#003478", home: "https://xinchaokoreamart.com", online: true },
  astrabean: { label: "Astrabean", color: "#6f4e37", home: "https://day-sales.com/store/astrabean/product", currency: "USD" },
  tuoixanhnhanhngon: { label: "Tươi Xanh Nhanh Ngon", color: "#0f766e", home: "https://tuoixanhnhanhngon.timdaythay.com", online: true },
  khuccham: { label: "Khúc Chạm Plaza", color: "#f97316", home: "https://music.youtube.com/@KhucChamChannel", online: true, logo: "https://yt3.googleusercontent.com/ytc/AIdro_nBoSfZ7Bk3OkViT3fL0oVfBrqNjbDqkJNhRBsNgg=s176-c-k-c0x00ffffff-no-rj" },
  circlek: { label: "Circle K", color: "#ed1c24", home: "https://www.circlek.com.vn" },
  "7eleven": { label: "7-Eleven", color: "#ee7203", home: "https://www.7-eleven.vn" },
  gs25: { label: "GS25", color: "#0072ce", home: "https://gs25.com.vn" },
  phuclong: { label: "Phúc Long", color: "#1b5e20", home: "https://phuclong.com.vn" },
  highlands: { label: "Highlands Coffee", color: "#a4161a", home: "https://www.highlandscoffee.com.vn" },
  hoasenhome: { label: "Hoa Sen Home", color: "#00529c", home: "https://hoasenhome.vn" },
  premiumoutlets: { label: "Premium Outlets", color: "#6b7280", home: "https://www.premiumoutlets.com" },
  costco: { label: "Costco", color: "#e31837", home: "https://www.costco.com" },
  other: { label: "Khác", color: "#3948e6", home: "", online: true },
  "Highlands Coffee": { label: "Highlands Coffee", color: "#656631ff", home: "", online: true },
  "Starbucks": { label: "Starbucks", color: "#07411fff", home: "", online: true },
  "Circle K": { label: "Circle K", color: "#c54eb1ff", home: "", online: true },
  "GS25": { label: "GS25", color: "#0bc2cfff", home: "", online: true },
  "7-Eleven": { label: "7-Eleven", color: "#5d9416ff", home: "", online: true },
  "Premium Outlets": { label: "Premium Outlets", color: "#dbbe19ff", home: "", online: true },
  "Costco": { label: "Costco", color: "#e60d0dff", home: "", online: true },
};

const DEFAULT_COLOR = "#3948e6";

// Override giá tối thiểu nạp từ sheet (tab "Giá tối thiểu"). Ưu tiên hơn SOURCE_META tĩnh.
let dynamicMinOrders: Record<string, number> | null = null;

// Override logo + tên hiển thị nạp từ sheet (tab "Logo nguồn", gid=1744262265).
// NGUỒN CHÍNH: sửa ở sheet là app đổi theo. Ưu tiên hơn SOURCE_META tĩnh.
let dynamicSourceLogos: Record<string, string> | null = null;
let dynamicSourceNames: Record<string, string> | null = null;

/** Nạp map logo theo chain từ sheet (key SLUG-hoá). null/rỗng → dùng logo tĩnh. */
export function setDynamicSourceLogos(map: Record<string, string> | null): void {
  if (!map || Object.keys(map).length === 0) { dynamicSourceLogos = null; return; }
  dynamicSourceLogos = Object.fromEntries(
    Object.entries(map).map(([k, v]) => [chainSlugify(k), v]),
  );
}

/** Nạp map tên hiển thị theo chain từ sheet (key SLUG-hoá). null/rỗng → dùng label tĩnh. */
export function setDynamicSourceNames(map: Record<string, string> | null): void {
  if (!map || Object.keys(map).length === 0) { dynamicSourceNames = null; return; }
  dynamicSourceNames = Object.fromEntries(
    Object.entries(map).map(([k, v]) => [chainSlugify(k), v]),
  );
}

/** Nạp bảng giá tối thiểu theo chain từ sheet (key thường-hoá). null/rỗng → dùng SOURCE_META. */
export function setDynamicMinOrders(map: Record<string, number> | null): void {
  if (!map || Object.keys(map).length === 0) { dynamicMinOrders = null; return; }
  dynamicMinOrders = Object.fromEntries(
    Object.entries(map).map(([k, v]) => [(k ?? "").toLowerCase(), v]),
  );
}

/** Giá trị đơn hàng tối thiểu (VND) của chain. 0 = không giới hạn. Sheet override > SOURCE_META. */
export function chainMinOrder(chain: Chain): number {
  const key = (chain ?? "").toLowerCase();
  if (dynamicMinOrders && key in dynamicMinOrders) return dynamicMinOrders[key];
  return (SOURCE_META[chain] ?? SOURCE_META[key])?.minOrder ?? 0;
}

/**
 * Tên hiển thị của nguồn — ưu tiên map từ sheet (setDynamicSourceNames), rồi `label`
 * trong SOURCE_META, cuối cùng fallback về chuỗi chain thô. Tra cứu không phân biệt
 * hoa/thường/dấu cách (vd THXL, TDAT, "Astra Bean").
 */
export function chainLabel(chain: Chain): string {
  if (dynamicSourceNames) {
    const sn = dynamicSourceNames[chainSlugify(chain)];
    if (sn) return sn;
  }
  return (SOURCE_META[chain] ?? SOURCE_META[(chain ?? "").toLowerCase()])?.label ?? chain;
}

/** Slugify đơn giản (không dấu, [a-z0-9]) — dùng cục bộ ở đây để tránh phụ thuộc lib/slug. */
function chainSlugify(s: string): string {
  return (s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

/** Tìm chain (vd "astrabean") từ slug URL — match cả KEY và label trong SOURCE_META. */
export function findChainBySlug(slug: string): Chain | null {
  const s = chainSlugify(slug);
  if (!s) return null;
  for (const [key, meta] of Object.entries(SOURCE_META)) {
    if (chainSlugify(key) === s || chainSlugify(meta.label) === s) return key as Chain;
  }
  return null;
}

/** Màu nhận diện của nguồn, có fallback xám. Tra cứu không phân biệt hoa/thường. */
export function chainColor(chain: Chain): string {
  return (SOURCE_META[chain] ?? SOURCE_META[(chain ?? "").toLowerCase()])?.color ?? DEFAULT_COLOR;
}

/**
 * Logo thật của chuỗi — ưu tiên map từ sheet (setDynamicSourceLogos), rồi `logo`
 * khai báo sẵn trong SOURCE_META; nếu không có thì lấy favicon từ domain `home`
 * (dịch vụ favicon Google, luôn trả ảnh thật, không 404).
 * Trả undefined khi không có gì → caller hiện chữ viết tắt thay thế.
 */
export function chainLogo(chain: Chain): string | undefined {
  const key = (chain ?? "").toLowerCase();
  if (dynamicSourceLogos) {
    const sl = dynamicSourceLogos[chainSlugify(chain)];
    if (sl) return sl;
  }
  const meta = SOURCE_META[chain] ?? SOURCE_META[key];
  if (meta?.logo) return meta.logo;
  if (meta?.home) {
    try {
      const host = new URL(meta.home).hostname;
      return `https://www.google.com/s2/favicons?domain=${host}&sz=128`;
    } catch {
      // home không phải URL hợp lệ → bỏ qua
    }
  }
  return undefined;
}

/** Giữ tương thích với code cũ (truy cập kiểu CHAIN_LABEL[chain]). */
export const CHAIN_LABEL: Record<string, string> = Object.fromEntries(
  Object.entries(SOURCE_META).map(([k, v]) => [k, v.label]),
);
export const CHAIN_COLOR: Record<string, string> = Object.fromEntries(
  Object.entries(SOURCE_META).map(([k, v]) => [k, v.color]),
);

/** Đường tìm kiếm đúng của từng chuỗi (đã verify không 404). */
const SEARCH_URL: Record<string, (q: string) => string> = {
  bhx: (q) => `https://www.bachhoaxanh.com/tim-kiem?key=${encodeURIComponent(q)}`,
  concung: (q) => `https://concung.com/?s=${encodeURIComponent(q)}`,
  coop: (q) => `https://cooponline.vn/?s=${encodeURIComponent(q)}`,
  aeon: (q) => `https://aeoneshop.com/?s=${encodeURIComponent(q)}`,
  pnj: (q) => `https://www.pnj.com.vn/catalogsearch/result/?q=${encodeURIComponent(q)}`,
};

export function chainSearchUrl(chain: Chain, query: string): string {
  const fn = SEARCH_URL[chain];
  if (fn) return fn(query);
  return SOURCE_META[chain]?.home || "";
}

/**
 * Seed cửa hàng VẬT LÝ quanh TP.HCM (toạ độ gần đúng).
 * GHI CHÚ: sau này danh sách cửa hàng + toạ độ sẽ lấy từ map server công ty.
 */
export const STORES: Store[] = [
  { id: "bhx-q1", chain: "bhx", name: "Bách Hóa Xanh Nguyễn Thị Minh Khai", address: "123 Nguyễn Thị Minh Khai, Quận 1", lat: 10.7725, lng: 106.6938, website: "https://www.bachhoaxanh.com" },
  { id: "bhx-q3", chain: "bhx", name: "Bách Hóa Xanh Cách Mạng Tháng 8", address: "456 CMT8, Quận 3", lat: 10.7820, lng: 106.6810, website: "https://www.bachhoaxanh.com" },
  { id: "bhx-bt", chain: "bhx", name: "Bách Hóa Xanh Xô Viết Nghệ Tĩnh", address: "78 Xô Viết Nghệ Tĩnh, Bình Thạnh", lat: 10.8015, lng: 106.7110, website: "https://www.bachhoaxanh.com" },
  { id: "cc-q3", chain: "concung", name: "Con Cưng Lê Văn Sỹ", address: "200 Lê Văn Sỹ, Quận 3", lat: 10.7905, lng: 106.6772, website: "https://concung.com" },
  { id: "cc-pn", chain: "concung", name: "Con Cưng Phan Đăng Lưu", address: "55 Phan Đăng Lưu, Phú Nhuận", lat: 10.7985, lng: 106.6840, website: "https://concung.com" },
  { id: "coop-q1", chain: "coop", name: "Co.opmart Cống Quỳnh", address: "189C Cống Quỳnh, Quận 1", lat: 10.7665, lng: 106.6890, website: "https://cooponline.vn" },
  { id: "coop-bt", chain: "coop", name: "Co.opmart Đinh Tiên Hoàng", address: "127 Đinh Tiên Hoàng, Bình Thạnh", lat: 10.7990, lng: 106.7035, website: "https://cooponline.vn" },
  { id: "aeon-tp", chain: "aeon", name: "AEON Mall Tân Phú Celadon", address: "30 Bờ Bao Tân Thắng, Tân Phú", lat: 10.8009, lng: 106.6178, website: "https://aeoneshop.com" },
  // Cửa hàng tại Mỹ (Astra Bean) — fallback đồng bộ theo tab "stores" (Google Sheet là nguồn
  // chuẩn, sheet thắng khi trùng id — xem /api/stores); sheet đổi thì cập nhật dòng này theo.
  { id: "astrabean", chain: "astrabean", name: "Astra Bean", address: "9878 Bolsa Ave, Westminster, California CA 92683", lat: 33.7868893, lng: -117.896468, website: "https://day-sales.com/store/astrabean/product", currency: "USD" },
];

/** Cửa hàng "ảo" cho nguồn online (mua qua web, không có vị trí bản đồ). */
export const ONLINE_STORES: Store[] = Object.entries(SOURCE_META)
  .filter(([, m]) => m.online)
  .map(([key, m]) => ({
    id: key,
    chain: key,
    name: m.label,
    address: "Mua online",
    website: m.home,
    online: true,
  }));

const STORE_INDEX: Record<string, Store> = Object.fromEntries(
  [...STORES, ...ONLINE_STORES].map((s) => [s.id, s]),
);

/**
 * Cửa hàng vật lý nạp động từ tab "stores" của Google Sheet (qua lib/sheet-stores).
 * Khi đã nạp, getStores()/getStore()/physicalStoresOfChain() dùng dữ liệu sheet để
 * team quản lý cửa hàng + toạ độ mà KHÔNG cần sửa code. Chưa nạp → dùng STORES tĩnh.
 */
let dynamicStores: Store[] | null = null;
let dynamicIndex: Record<string, Store> | null = null;

/** Nạp danh sách cửa hàng từ sheet (null/rỗng → quay về STORES tĩnh). */
export function setDynamicStores(stores: Store[] | null): void {
  if (!stores || stores.length === 0) {
    dynamicStores = null;
    dynamicIndex = null;
    return;
  }
  dynamicStores = stores;
  dynamicIndex = Object.fromEntries(
    [...stores, ...ONLINE_STORES].map((s) => [s.id, s]),
  );
}

/** Chỉ cửa hàng vật lý (có toạ độ) — dùng cho marker mặc định trên bản đồ. */
export function getStores(): Store[] {
  return dynamicStores ?? STORES;
}

/** Cửa hàng vật lý của 1 chuỗi (để fan-out giá online ra từng điểm bán). */
export function physicalStoresOfChain(chain: Chain): Store[] {
  return getStores().filter((s) => s.chain === chain);
}

export function getStore(id: string): Store | undefined {
  return dynamicIndex?.[id] ?? STORE_INDEX[id];
}

/**
 * Tiền tệ của một cửa hàng (theo store_id). Ưu tiên cột currency từ tab "stores",
 * fallback theo tiền tệ mặc định của nguồn (SOURCE_META), cuối cùng "VND".
 */
export function storeCurrency(id?: string): string {
  if (!id) return "VND";
  const s = getStore(id);
  return (s?.currency || (s ? SOURCE_META[s.chain]?.currency : "") || "VND").toUpperCase();
}
