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
  /** Tiền tệ mặc định của nguồn (fallback khi tab "stores" chưa khai báo cột currency). */
  currency?: string;
}

export const SOURCE_META: Record<string, SourceMeta> = {
  bhx: { label: "Bách Hóa Xanh", color: "#1aa64b", home: "https://www.bachhoaxanh.com" },
  concung: { label: "Con Cưng", color: "#e6007e", home: "https://concung.com" },
  coop: { label: "Co.opmart", color: "#0067b1", home: "https://cooponline.vn" },
  aeon: { label: "AEON", color: "#8e0d3c", home: "https://aeoneshop.com" },
  shopee: { label: "Shopee", color: "#ee4d2d", home: "https://shopee.vn", online: true },
  grab: { label: "GrabMart", color: "#00b14f", home: "https://food.grab.com", online: true },
  pnj: { label: "PNJ", color: "#c9a227", home: "https://www.pnj.com.vn", online: true },
  dalathasfarm: { label: "Dalat Hasfarm", color: "#2e7d32", home: "https://dalathasfarm.com", online: true },
  ichiban: { label: "Ichiban Market", color: "#d32f2f", home: "https://ichibanmarket.com.vn", online: true },
  lotte: { label: "LOTTE Mart", color: "#ed1c24", home: "https://www.lottemart.vn", online: true },
  krmart: { label: "Korea Mart", color: "#003478", home: "https://xinchaokoreamart.com", online: true },
  astrabean: { label: "Astrabean", color: "#6f4e37", home: "https://day-sales.com/store/astrabean/product", currency: "USD" },
  other: { label: "Khác", color: "#3948e6", home: "", online: true },
};

const DEFAULT_COLOR = "#3948e6";

/** Tên hiển thị của nguồn, có fallback cho nguồn lạ. */
export function chainLabel(chain: Chain): string {
  return SOURCE_META[chain]?.label ?? chain;
}

/** Màu nhận diện của nguồn, có fallback xám. */
export function chainColor(chain: Chain): string {
  return SOURCE_META[chain]?.color ?? DEFAULT_COLOR;
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
  // Cửa hàng tại Mỹ (PHIN LAB / Astrabean) — hiện khi user ở vị trí US.
  { id: "astrabean", chain: "astrabean", name: "Astrabean — PHIN LAB", address: "San Jose, CA, USA", lat: 37.3352, lng: -121.8811, website: "https://day-sales.com/store/astrabean/product", currency: "USD" },
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
