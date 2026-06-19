import type { Catalog, Offer, Product } from "./types";
import { physicalStoresOfChain, SOURCE_META } from "./stores";

/**
 * Nguồn dữ liệu THẬT: "master sheet" 1645 sản phẩm (giá + ảnh + link) do team nhập tay.
 * Sheet được publish public nên đọc trực tiếp qua link export CSV (không cần Apps Script).
 *
 * Cấu trúc 17 cột (hàng 1 là header nhiều dòng):
 *  0 SKU · 1 PRODUCT_NAME · 2 BRAND · 3 PACKSIZE · 4 UOM · 5 CASE_PACK · 6 DAC_DIEM ·
 *  7 THUMBNAIL · 8 GIA_BAO_BI_VAT · 9 VAT · 10 %KM · 11 GIA_SAU_KM ·
 *  12 DANH_MUC_SP · 13 CHUNG_LOAI · 14 VARIANT · 15 SOURCE · 16 URL_SAN_PHAM
 *
 * Giá ở đơn vị NGHÌN đồng, dấu phẩy là thập phân: "54"→54.000, "43,74"→43.740.
 */

export const MASTER_SHEET_ID = "1NFcjrJGlWzxB8N7A_Hn0iELBJf7FRjvssa0iqlHOeI8";
export const MASTER_SHEET_GID = "1729803430";
export const MASTER_SHEET_CSV_URL =
  process.env.MASTER_SHEET_CSV_URL ||
  `https://docs.google.com/spreadsheets/d/${MASTER_SHEET_ID}/export?format=csv&gid=${MASTER_SHEET_GID}`;

/**
 * Cột do scraper GĐ2 ghi bổ sung vào master sheet (qua Apps Script live_upsert).
 * Tên cột phải KHỚP với apps-script/Code.gs (LIVE_COLS).
 */
export const LIVE_COLS = {
  price: "GIA_LIVE",
  stock: "TON_KHO_LIVE",
  exists: "CON_TON_TAI",
  checkedAt: "LAST_CHECKED_LIVE",
} as const;

/** SOURCE trong sheet → mã nguồn nội bộ. */
const SOURCE_MAP: Record<string, string> = {
  BHX: "bhx",
  CC: "concung",
  COOP: "coop",
  AEON: "aeon",
  SPE: "shopee",
  GF: "grab",
  PNJ: "pnj",
  "DALAT HASFARM": "dalathasfarm",
  ICHIBAN: "ichiban",
  LOTTE: "lotte",
  KRMART: "krmart",
};

function mapSource(raw: string): string {
  const key = (raw || "").trim().toUpperCase();
  if (!key) return "other";
  return SOURCE_MAP[key] ?? "other";
}

/** "43,74" (nghìn đồng) → 43740. "54" → 54000. "1.234,5" → 1234500. */
export function parsePriceK(raw: string): number {
  const t = (raw || "")
    .trim()
    .replace(/\./g, "") // bỏ dấu chấm ngăn cách nghìn
    .replace(",", ".") // phẩy → thập phân
    .replace(/[^\d.]/g, "");
  if (!t) return 0;
  const n = parseFloat(t);
  if (!isFinite(n)) return 0;
  return Math.round(n * 1000);
}

interface Cols {
  sku: number;
  name: number;
  brand: number;
  packsize: number;
  uom: number;
  thumb: number;
  giaGoc: number;
  km: number;
  giaSauKm: number;
  danhMuc: number;
  chungLoai: number;
  source: number;
  url: number;
  // Cột live (GĐ2) — có thể chưa tồn tại trong sheet cũ → -1.
  giaLive: number;
  tonKhoLive: number;
  conTonTai: number;
  lastCheckedLive: number;
}

/** Dò vị trí cột theo từ khoá trong header (header có thể nhiều dòng / có số thứ tự). */
function detectCols(header: string[]): Cols {
  const norm = header.map((h) => h.toUpperCase());
  const find = (...keys: string[]) => {
    for (let i = 0; i < norm.length; i++) {
      if (keys.some((k) => norm[i].includes(k))) return i;
    }
    return -1;
  };
  return {
    sku: find("SKU", "MÃ SẢN PHẨM"),
    name: find("PRODUCT_NAME", "TÊN SẢN PHẨM"),
    brand: find("BRAND", "NHÃN HÀNG"),
    packsize: find("PACKSIZE"),
    uom: find("UOM", "ĐƠN VỊ TÍNH"),
    thumb: find("THUMBNAIL", "HÌNH THẺ"),
    giaGoc: find("GIA_BAO_BI", "GIÁ BAO BÌ"),
    km: find("%_KHUYEN_MAI", "KHUYEN_MAI"),
    giaSauKm: find("GIA_SAU_KM", "GIÁ SAU"),
    danhMuc: find("DANH_MUC_SP", "DANH MỤC"),
    chungLoai: find("CHUNG_LOAI"),
    source: find("SOURCE"),
    url: find("URL_SAN_PHAM", "URL"),
    giaLive: find(LIVE_COLS.price),
    tonKhoLive: find(LIVE_COLS.stock),
    conTonTai: find(LIVE_COLS.exists),
    lastCheckedLive: find(LIVE_COLS.checkedAt),
  };
}

/** Giá live do scraper ghi (VND nguyên, KHÔNG ×1000). "675000"/"675.000₫" → 675000. */
function parseLiveVnd(raw: string): number {
  const t = (raw || "")
    .replace(/[₫đ\s]/gi, "")
    .replace(/\.(?=\d{3}\b)/g, "")
    .replace(",", ".")
    .replace(/[^\d.]/g, "");
  if (!t) return 0;
  const n = parseFloat(t);
  return isFinite(n) && n > 0 ? Math.round(n) : 0;
}

/** Cờ "còn tồn tại": rỗng/1/true/"còn" → true; 0/false/"không"/"het" → false. */
function isStillExisting(raw: string): boolean {
  const s = (raw || "").trim().toLowerCase();
  if (!s) return true; // chưa cào → mặc định còn
  return !["0", "false", "no", "khong", "không", "het", "hết", "gone", "removed"].includes(s);
}

const now = () => new Date().toISOString();

/**
 * Parse CSV của master sheet → Catalog.
 * - Mỗi dòng = 1 sản phẩm (SKU là khoá, đã gồm tiền tố nguồn nên là duy nhất).
 * - Nguồn là 1 trong 4 chuỗi có cửa hàng vật lý → fan-out giá ra mọi cửa hàng của chuỗi.
 * - Nguồn online → 1 offer trỏ tới "cửa hàng ảo" của nguồn đó.
 */
export function parseMasterCsv(csv: string): Catalog {
  const rows = splitCsv(csv).filter((r) => r.some((c) => c.trim() !== ""));
  if (rows.length < 2) return { products: [], offers: [] };

  const c = detectCols(rows[0]);
  if (c.sku < 0 || c.name < 0) return { products: [], offers: [] };

  const products: Product[] = [];
  const offers: Offer[] = [];
  const seen = new Set<string>();
  const ts = now();

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const sku = (r[c.sku] || "").trim();
    const name = (r[c.name] || "").trim();
    if (!sku || !name) continue;
    if (seen.has(sku)) continue;
    seen.add(sku);

    // Sản phẩm scraper đánh dấu đã bị gỡ khỏi web nguồn → không hiển thị.
    if (c.conTonTai >= 0 && !isStillExisting(r[c.conTonTai])) continue;

    // Giá live (cào thật) ưu tiên hơn giá nhập tay trong sheet.
    const livePrice = c.giaLive >= 0 ? parseLiveVnd(r[c.giaLive]) : 0;
    const price = livePrice ||
      parsePriceK(c.giaSauKm >= 0 ? r[c.giaSauKm] : "") ||
      parsePriceK(c.giaGoc >= 0 ? r[c.giaGoc] : "");
    if (!price) continue; // không có giá → bỏ qua

    // Tồn kho live (nếu có): "0"/"het"/"false" → hết hàng.
    const inStock =
      c.tonKhoLive >= 0 && (r[c.tonKhoLive] || "").trim()
        ? isStillExisting(r[c.tonKhoLive])
        : true;

    const chain = mapSource(c.source >= 0 ? r[c.source] : "");
    const url = (c.url >= 0 ? r[c.url] : "").trim();
    const image = (c.thumb >= 0 ? r[c.thumb] : "").trim() || undefined;
    const packsize = (c.packsize >= 0 ? r[c.packsize] : "").trim();
    const uom = (c.uom >= 0 ? r[c.uom] : "").trim();
    const category =
      (c.danhMuc >= 0 ? r[c.danhMuc] : "").trim() ||
      (c.chungLoai >= 0 ? r[c.chungLoai] : "").trim() ||
      "Khác";

    products.push({
      id: sku,
      name,
      brand: (c.brand >= 0 ? r[c.brand] : "").trim(),
      category,
      unit: packsize || uom,
      image,
    });

    const buyUrl = url || SOURCE_META[chain]?.home || "";
    const physical = physicalStoresOfChain(chain);
    if (physical.length) {
      // Chuỗi có cửa hàng vật lý: giá online áp cho mọi điểm bán.
      for (const store of physical) {
        offers.push({
          productId: sku,
          storeId: store.id,
          price,
          inStock,
          productUrl: buyUrl,
          lastChecked: ts,
        });
      }
    } else {
      // Nguồn online: 1 offer trỏ cửa hàng ảo của nguồn.
      offers.push({
        productId: sku,
        storeId: chain,
        price,
        inStock,
        productUrl: buyUrl,
        lastChecked: ts,
      });
    }
  }

  return { products, offers };
}

export interface ScrapeTarget {
  sku: string;
  name: string;
  chain: string;
  url: string;
  sheetPrice: number;
  /** ISO lần cào live gần nhất ("" nếu chưa từng) — để xoay vòng theo mẻ. */
  lastCheckedLive: string;
}

/** Danh sách (sku, url, nguồn) để cào giá thật. Chỉ lấy dòng có URL hợp lệ. */
export async function fetchScrapeTargets(): Promise<ScrapeTarget[]> {
  const res = await fetch(MASTER_SHEET_CSV_URL, { cache: "no-store" });
  if (!res.ok) return [];
  const rows = splitCsv(await res.text()).filter((r) => r.some((c) => c.trim() !== ""));
  if (rows.length < 2) return [];
  const c = detectCols(rows[0]);
  const out: ScrapeTarget[] = [];
  const seen = new Set<string>();
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const sku = (r[c.sku] || "").trim();
    const url = (c.url >= 0 ? r[c.url] : "").trim();
    if (!sku || !url || !/^https?:\/\//i.test(url) || seen.has(sku)) continue;
    seen.add(sku);
    out.push({
      sku,
      name: (r[c.name] || "").trim(),
      chain: mapSource(c.source >= 0 ? r[c.source] : ""),
      url,
      sheetPrice:
        parsePriceK(c.giaSauKm >= 0 ? r[c.giaSauKm] : "") ||
        parsePriceK(c.giaGoc >= 0 ? r[c.giaGoc] : ""),
      lastCheckedLive: (c.lastCheckedLive >= 0 ? r[c.lastCheckedLive] : "").trim(),
    });
  }
  return out;
}

/** Suy ra nguồn (chain) từ hostname của link sản phẩm. */
const HOST_CHAIN: { test: RegExp; chain: string }[] = [
  { test: /concung\.com/i, chain: "concung" },
  { test: /cooponline\.vn/i, chain: "coop" },
  { test: /bachhoaxanh\.com/i, chain: "bhx" },
  { test: /aeoneshop\.com|aeon/i, chain: "aeon" },
];

export function chainFromUrl(url: string): string {
  for (const h of HOST_CHAIN) if (h.test.test(url)) return h.chain;
  return "other";
}

/**
 * Mục tiêu cào cho TAB CATALOG (Apps Script). Gồm đủ thông tin sản phẩm để khi ghi
 * ngược (upsert_catalog ghi đè CẢ dòng) không làm rỗng các cột name/brand/category…
 */
export interface CatalogScrapeTarget {
  productId: string;
  storeId: string;
  chain: string; // suy từ hostname của url
  url: string;
  sheetPrice: number; // giá cũ trong tab — giữ lại nếu cào không ra giá
  sheetInStock: boolean; // tồn cũ — giữ lại nếu cào không xác định được
  product: { name: string; brand: string; category: string; unit: string };
}

/**
 * Đọc tab "catalog" (qua doGet ?type=catalog) → danh sách offer có link để cào.
 * Mỗi offer kèm thông tin product để dựng lại full dòng khi ghi ngược.
 */
export async function fetchCatalogScrapeTargets(): Promise<CatalogScrapeTarget[]> {
  const apiUrl = process.env.CATALOG_API_URL;
  if (!apiUrl) return [];
  try {
    const res = await fetch(apiUrl, { cache: "no-store" });
    if (!res.ok) return [];
    const data = (await res.json()) as Catalog;
    if (!data?.offers?.length) return [];
    const prodById = new Map(data.products.map((p) => [p.id, p]));
    const out: CatalogScrapeTarget[] = [];
    for (const o of data.offers) {
      const url = (o.productUrl || "").trim();
      if (!/^https?:\/\//i.test(url)) continue;
      const p = prodById.get(o.productId);
      out.push({
        productId: o.productId,
        storeId: o.storeId,
        chain: chainFromUrl(url),
        url,
        sheetPrice: Number(o.price) || 0,
        sheetInStock: o.inStock !== false,
        product: {
          name: p?.name ?? o.productId,
          brand: p?.brand ?? "",
          category: p?.category ?? "",
          unit: p?.unit ?? "",
        },
      });
    }
    return out;
  } catch {
    return [];
  }
}

/** Tải + parse master sheet. Trả null nếu lỗi để caller fallback. */
export async function fetchMasterCatalog(revalidate = 300): Promise<Catalog | null> {
  try {
    const res = await fetch(MASTER_SHEET_CSV_URL, { next: { revalidate } });
    if (!res.ok) return null;
    const catalog = parseMasterCsv(await res.text());
    return catalog.products.length ? catalog : null;
  } catch {
    return null;
  }
}

/** Tách CSV → mảng hàng × cột, hỗ trợ field có dấu " và xuống dòng bên trong. */
function splitCsv(csv: string): string[][] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  const text = csv.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}
