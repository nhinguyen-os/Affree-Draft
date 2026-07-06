/**
 * Đọc tab "Logo nguồn" (sheet chính "Danh sách sản phẩm", gid=1744262265) —
 * map chain → { logo, tên hiển thị }. Cấu trúc: chain | ten_nguon | logo_url | ghi_chu.
 *
 * Đây là NGUỒN DUY NHẤT cho LOGO và TÊN HIỂN THỊ của từng source: sửa ở sheet là app
 * đổi theo, không cần sửa code. Áp vào chainLogo()/chainLabel() qua
 * setDynamicSourceLogos / setDynamicSourceNames.
 * logo_url có thể là URL http(s) HOẶC data: URI (ảnh base64 dán thẳng trong ô).
 */

const SOURCES_SHEET_URL =
  process.env.SOURCES_SHEET_URL ||
  "https://docs.google.com/spreadsheets/d/1Gr93tqONyaV5sxuckgyxdRXrQYt6suZdF-2y2RyA6ns/export?format=csv&gid=1744262265";

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

/** Slug hoá để match chain bất kể hoa/thường, dấu cách, dấu tiếng Việt (giống chainSlugify). */
function slug(s: string): string {
  return (s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

export interface SourceMaps {
  /** key SLUG → URL/URI logo. */
  logos: Record<string, string>;
  /** key SLUG → tên hiển thị (ten_nguon). */
  names: Record<string, string>;
}

/**
 * Đọc tab → 2 map: logo + tên hiển thị, key theo SLUG của cả cột `chain` LẪN `ten_nguon`,
 * để khớp dù store lưu chain kiểu slug ("bhx") hay tên hiển thị ("Long Monaco").
 * Bỏ dòng thiếu chain. Dòng thiếu logo vẫn lấy tên (và ngược lại).
 */
export async function fetchSources(revalidate = 60): Promise<SourceMaps> {
  const logos: Record<string, string> = {};
  const names: Record<string, string> = {};
  try {
    const res = await fetch(SOURCES_SHEET_URL, { next: { revalidate } });
    if (!res.ok) return { logos, names };
    const rows = splitCsv(await res.text());
    if (rows.length < 2) return { logos, names };
    const header = rows[0].map((h) => h.trim().toLowerCase());
    const chainIdx = header.findIndex((h) => h.includes("chain"));
    const nameIdx = header.findIndex((h) => h.includes("ten") || h.includes("tên") || h.includes("name") || h.includes("nguon") || h.includes("nguồn"));
    const logoIdx = header.findIndex((h) => h.includes("logo") || h.includes("url") || h.includes("ảnh") || h.includes("anh"));
    if (chainIdx < 0) return { logos, names };
    for (let i = 1; i < rows.length; i++) {
      const chain = (rows[i][chainIdx] ?? "").trim();
      if (!chain) continue;
      const name = nameIdx >= 0 ? (rows[i][nameIdx] ?? "").trim() : "";
      const logo = logoIdx >= 0 ? (rows[i][logoIdx] ?? "").trim() : "";
      const keys = [slug(chain), slug(name)].filter(Boolean);
      if (logo && /^(https?:\/\/|data:image\/)/i.test(logo)) {
        for (const k of keys) if (!(k in logos)) logos[k] = logo;
      }
      if (name) {
        for (const k of keys) if (!(k in names)) names[k] = name;
      }
    }
  } catch {
    // bỏ qua, trả map rỗng → app dùng logo/tên tĩnh SOURCE_META/favicon
  }
  return { logos, names };
}
