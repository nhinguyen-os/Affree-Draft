import type { Store } from "./types";

/**
 * Nguồn toạ độ cửa hàng VẬT LÝ: tab "stores" trong cùng spreadsheet master.
 * Cho phép team thêm/sửa cửa hàng + toạ độ ngay trên Google Sheet, KHÔNG cần sửa code.
 *
 * Cấu trúc cột (theo tên header, không phụ thuộc thứ tự):
 *   store_id · chain · name · address · lat · lng · website
 *
 * Tab được publish public (cùng spreadsheet master) nên đọc trực tiếp qua link export CSV.
 */
export const STORES_SHEET_GID = process.env.STORES_SHEET_GID || "831311713";
// Mặc định đọc từ sheet "Cửa hàng" (tách riêng) trong folder Affree mới. Override bằng env.
export const STORES_SHEET_CSV_URL =
  process.env.STORES_SHEET_CSV_URL ||
  "https://docs.google.com/spreadsheets/d/11lf6ckDt3PnienNVBRg1kJz1UOXERI_xpXgArXRwUIg/export?format=csv&gid=0";

/** "10.7725" / "10,7725" → 10.7725. Rỗng/không phải số → undefined. */
function parseCoord(raw: string): number | undefined {
  const t = (raw || "").trim().replace(",", ".").replace(/[^\d.\-]/g, "");
  if (!t) return undefined;
  const n = parseFloat(t);
  return isFinite(n) ? n : undefined;
}

/** Tách CSV → mảng hàng × cột (hỗ trợ field có dấu " và xuống dòng bên trong). */
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

/** Parse CSV tab "stores" → Store[]. Dò cột theo tên header (không phụ thuộc thứ tự). */
export function parseStoresCsv(csv: string): Store[] {
  const rows = splitCsv(csv).filter((r) => r.some((c) => c.trim() !== ""));
  if (rows.length < 2) return [];

  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = (...keys: string[]) => {
    for (let i = 0; i < header.length; i++) {
      if (keys.some((k) => header[i].includes(k))) return i;
    }
    return -1;
  };
  const ci = {
    id: col("store_id", "id"),
    chain: col("chain", "nguồn", "nguon"),
    name: col("name", "tên", "ten"),
    address: col("address", "địa chỉ", "dia chi"),
    lat: col("lat"),
    lng: col("lng", "lon"),
    website: col("website", "url", "web"),
    currency: col("currency", "tiền tệ", "tien te", "tiente"),
  };
  if (ci.id < 0) return [];

  const out: Store[] = [];
  const seen = new Set<string>();
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const id = (r[ci.id] || "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      chain: (ci.chain >= 0 ? r[ci.chain] : "").trim() || "other",
      name: (ci.name >= 0 ? r[ci.name] : "").trim() || id,
      address: (ci.address >= 0 ? r[ci.address] : "").trim(),
      lat: ci.lat >= 0 ? parseCoord(r[ci.lat]) : undefined,
      lng: ci.lng >= 0 ? parseCoord(r[ci.lng]) : undefined,
      website: (ci.website >= 0 ? r[ci.website] : "").trim(),
      currency: ci.currency >= 0 ? (r[ci.currency] || "").trim().toUpperCase() || undefined : undefined,
    });
  }
  return out;
}

/** Tải + parse tab "stores". Trả null nếu lỗi/rỗng để caller fallback về STORES tĩnh. */
export async function fetchSheetStores(revalidate = 300): Promise<Store[] | null> {
  try {
    const res = await fetch(STORES_SHEET_CSV_URL, { next: { revalidate } });
    if (!res.ok) return null;
    const stores = parseStoresCsv(await res.text());
    return stores.length ? stores : null;
  } catch {
    return null;
  }
}
