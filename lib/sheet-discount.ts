/**
 * Đọc tab "giam_gia" từ sheet phụ (1sZTv… gid=1112573082) — map product_id → %
 * khuyến mãi. Cấu trúc tab: product_id | ten | giam_gia (giá trị dạng "74%" hoặc "0.74").
 *
 * Áp khi route /api/catalog gắn discountPct cho từng sản phẩm. Sản phẩm có entry ở
 * sheet này được ưu tiên trong dải "Giá hời quanh đây". Trống/lỗi → giữ nguyên.
 */

const DISCOUNT_SHEET_URL =
  process.env.DISCOUNT_SHEET_URL ||
  "https://docs.google.com/spreadsheets/d/1sZTv7FHGEq6V_d8wiFKd-7cVFjpURUcAeDPVI_1WiJo/export?format=csv&gid=1112573082";

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

function parsePct(raw: string): number | null {
  const s = (raw || "").trim().replace(/[^\d.,%-]/g, "");
  if (!s) return null;
  const hasPct = s.includes("%");
  const num = Number(s.replace("%", "").replace(",", "."));
  if (!Number.isFinite(num) || num <= 0) return null;
  // "74%" → 0.74; "0.74" → 0.74; "74" (không %) → coi như 74% nếu > 1
  return hasPct ? num / 100 : num > 1 ? num / 100 : num;
}

export async function fetchDiscountMap(revalidate = 30): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  try {
    const res = await fetch(DISCOUNT_SHEET_URL, { next: { revalidate } });
    if (!res.ok) return map;
    const rows = splitCsv(await res.text());
    if (rows.length < 2) return map;
    const header = rows[0].map((h) => h.trim().toLowerCase());
    const idIdx = header.findIndex((h) => h.includes("product_id") || h === "id");
    const pctIdx = header.findIndex((h) => h.includes("giam_gia") || h.includes("giảm giá") || h.includes("discount") || h.includes("khuyen") || h.includes("khuyến"));
    if (idIdx < 0 || pctIdx < 0) return map;
    for (let i = 1; i < rows.length; i++) {
      const id = (rows[i][idIdx] ?? "").trim();
      if (!id) continue;
      const pct = parsePct(rows[i][pctIdx] ?? "");
      if (pct != null) map.set(id, pct);
    }
  } catch {
    // bỏ qua, trả map rỗng
  }
  return map;
}
