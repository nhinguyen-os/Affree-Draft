/**
 * Đọc "Sheet cấu hình đường link" — bảng ánh xạ mã QR / deep-link của người bán (PG).
 *
 * Mỗi dòng = 1 chiến dịch QR: mã người bán → tên hiển thị "Phục vụ bởi", kèm nhãn hàng +
 * cửa hàng mặc định. App fetch CSV này (qua /api/sale-config) rồi resolve tham số URL:
 *   ?sale=<sale>       → hiện "Phục vụ bởi: <ten_sale>"
 *   ?nhanhang=<slug>   → lọc theo nhãn hàng (tag)
 *   ?storeid=<store_id>→ mở trang cửa hàng tương ứng (store_id lấy từ sheet "stores")
 *
 * Cấu trúc cột: sale | ten_sale | nhanhang | store_id | ghi_chu | link
 *   - `nhanhang`, `store_id` là mặc định của mã `sale` — link ngắn `?sale=chauhoangtan`
 *     tự áp brand + cửa hàng của dòng đó. Tham số trên URL (nếu có) LUÔN được ưu tiên.
 *
 * Sửa ở sheet là app đổi theo, không cần sửa code (giống các tab config khác của Affree).
 */

const SALE_CONFIG_CSV_URL =
  process.env.SALE_CONFIG_CSV_URL ||
  "https://docs.google.com/spreadsheets/d/1zazXH6onKahpwHulu9kd2OVuDseAcfcbfjxsKqDDNXA/export?format=csv&gid=0";

function splitCsv(csv: string): string[][] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQ = false;
  const t = csv.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (inQ) {
      if (c === '"') {
        if (t[i + 1] === '"') { field += '"'; i++; } else { inQ = false; }
      } else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else field += c;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

export interface SaleConfig {
  /** Mã người bán (không dấu) — khớp tham số ?sale=. */
  sale: string;
  /** Tên hiển thị "Phục vụ bởi: …". */
  ten_sale: string;
  /** Slug nhãn hàng mặc định (?nhanhang=), có thể rỗng. */
  nhanhang: string;
  /** store_id mặc định (?storeid=) lấy từ sheet stores, có thể rỗng. */
  store_id: string;
}

/** Bảng ánh xạ mã sale (lowercase) → cấu hình. */
export type SaleConfigMap = Record<string, SaleConfig>;

/**
 * Đọc sheet → map mã sale → cấu hình. Bỏ dòng thiếu cột `sale`. Nhận diện cột theo
 * tên header (không phân biệt hoa/thường, có/không dấu) nên thứ tự cột đổi vẫn chạy.
 */
export async function fetchSaleConfig(revalidate = 60): Promise<SaleConfigMap> {
  const map: SaleConfigMap = {};
  try {
    const res = await fetch(SALE_CONFIG_CSV_URL, { next: { revalidate } });
    if (!res.ok) return map;
    const rows = splitCsv(await res.text());
    if (rows.length < 2) return map;
    const header = rows[0].map((h) => h.trim().toLowerCase());
    const idx = (...keys: string[]) => header.findIndex((h) => keys.some((k) => h.includes(k)));
    const saleIdx = idx("sale");
    const nameIdx = idx("ten_sale", "ten sale", "tên", "name", "phuc vu", "phục vụ");
    const brandIdx = idx("nhanhang", "nhãn", "nhan hang", "brand");
    const storeIdx = idx("store_id", "storeid", "store id", "cua hang", "cửa hàng");
    if (saleIdx < 0) return map;
    for (let i = 1; i < rows.length; i++) {
      const sale = (rows[i][saleIdx] ?? "").trim();
      if (!sale) continue;
      const key = sale.toLowerCase();
      if (key in map) continue; // giữ dòng đầu tiên nếu trùng mã
      map[key] = {
        sale,
        ten_sale: nameIdx >= 0 ? (rows[i][nameIdx] ?? "").trim() : "",
        nhanhang: brandIdx >= 0 ? (rows[i][brandIdx] ?? "").trim() : "",
        store_id: storeIdx >= 0 ? (rows[i][storeIdx] ?? "").trim() : "",
      };
    }
  } catch {
    // lỗi mạng / sheet riêng tư → trả map rỗng, deep-link vẫn chạy với tham số trên URL
  }
  return map;
}
