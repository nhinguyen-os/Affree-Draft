/**
 * Đọc tab "Giá tối thiểu" (sheet chính, gid=2040938264) — map chain → giá mua tối thiểu (VND).
 * Cấu trúc: chain | Giá tối thiểu | khung giờ giao | phương thức thanh toán | (checkout url)
 *
 * Giá dạng "200.000" / "300000" / "0". 0 hoặc trống → không ràng buộc. Áp vào chainMinOrder
 * qua setDynamicMinOrders để ghi chú "Mua tối thiểu" trong app lấy số thật từ sheet.
 */

const STORE_RULES_SHEET_URL =
  process.env.STORE_RULES_SHEET_URL ||
  "https://docs.google.com/spreadsheets/d/1Gr93tqONyaV5sxuckgyxdRXrQYt6suZdF-2y2RyA6ns/export?format=csv&gid=2040938264";

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

/** "200.000" → 200000; "0"/"" → 0. Bỏ mọi ký tự không phải số. */
function parseVnd(raw: string): number {
  const s = (raw || "").replace(/[^\d]/g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

export async function fetchChainMinOrders(revalidate = 60): Promise<Record<string, number>> {
  const map: Record<string, number> = {};
  try {
    const res = await fetch(STORE_RULES_SHEET_URL, { next: { revalidate } });
    if (!res.ok) return map;
    const rows = splitCsv(await res.text());
    if (rows.length < 2) return map;
    const header = rows[0].map((h) => h.trim().toLowerCase());
    const chainIdx = header.findIndex((h) => h.includes("chain"));
    const minIdx = header.findIndex((h) => h.includes("tối thiểu") || h.includes("toi thieu") || h.includes("min"));
    if (chainIdx < 0 || minIdx < 0) return map;
    for (let i = 1; i < rows.length; i++) {
      const chain = (rows[i][chainIdx] ?? "").trim();
      if (!chain) continue;
      const min = parseVnd(rows[i][minIdx] ?? "");
      if (min > 0) map[chain.toLowerCase()] = min;
    }
  } catch {
    // bỏ qua, trả map rỗng
  }
  return map;
}
