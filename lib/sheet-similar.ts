import type { SimilarGroup } from "./types";

/**
 * Đọc tab "tương tự" từ Google Sheet để cấu hình "Sản phẩm tương tự".
 *
 * Cấu trúc tab (dò theo tên header, không phụ thuộc thứ tự cột):
 *   nhóm      | sản phẩm
 *   Nước có gas | coke-15l, pepsi-330, 7up-330
 *   Sữa tươi   | milk-vnm-1l, milk-vin-1l
 *
 * Cột "sản phẩm": nhiều product_id hoặc tên, phân cách bằng dấu phẩy/chấm phẩy.
 * Khớp theo ID trước, rồi theo tên (không phân biệt hoa thường, khớp một phần).
 */

const SIMILAR_SHEET_URL =
  process.env.SIMILAR_SHEET_URL ||
  "https://docs.google.com/spreadsheets/d/1nx4nl0fN3p0wAgKGJzu9fKhDxEglKq7oJOzh7gL5_SY/gviz/tq?tqx=out:csv&sheet=" +
    encodeURIComponent("tương tự");

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
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field); field = "";
    } else if (ch === "\n") {
      row.push(field); rows.push(row); row = []; field = "";
    } else field += ch;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

export async function fetchSimilarGroups(revalidate = 30): Promise<SimilarGroup[]> {
  try {
    const res = await fetch(SIMILAR_SHEET_URL, { next: { revalidate } });
    if (!res.ok) return [];
    const rows = splitCsv(await res.text());
    if (rows.length < 2) return [];

    const header = rows[0].map((h) => h.trim().toLowerCase());
    const col = (...keys: string[]) => {
      for (let i = 0; i < header.length; i++)
        if (keys.some((k) => header[i].includes(k))) return i;
      return -1;
    };
    const nameIdx = col("nhóm", "nhom", "group", "name", "tên");
    const prodIdx = col("sản phẩm", "san pham", "products", "product", "id", "sp");

    if (nameIdx < 0 || prodIdx < 0) return [];

    const groups: SimilarGroup[] = [];
    const seen = new Set<string>();
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const name = (r[nameIdx] ?? "").trim();
      if (!name || seen.has(name)) continue;
      seen.add(name);
      const products = (r[prodIdx] ?? "")
        .split(/[,;]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      if (products.length) groups.push({ name, products });
    }
    return groups;
  } catch {
    return [];
  }
}
