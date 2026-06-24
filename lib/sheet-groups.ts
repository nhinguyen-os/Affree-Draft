import type { ProductGroup, PriorityProfile, Sponsor } from "./types";

/**
 * Đọc 2 tab cấu hình hiển thị trong cùng spreadsheet master:
 *   - "tệp"            → các ô "Dịch vụ quanh đây" (ProductGroup[])
 *   - "ưu tiên hiển thị" → hồ sơ ưu tiên chuỗi (PriorityProfile[])
 *
 * Cho phép team chỉnh danh sách tệp + thứ tự ưu tiên ngay trên Google Sheet,
 * KHÔNG cần sửa code. Đọc qua gviz export CSV theo TÊN sheet (không cần gid).
 *
 * Cấu trúc cột (dò theo tên header, không phụ thuộc thứ tự):
 *   tệp:               tệp · emoji · link · ghi_chu · ưu tiên
 *   ưu tiên hiển thị:  ưu tiên · chuỗi · ghi_chu
 */
// Mặc định đọc từ folder Affree mới:
//  - tệp            → sheet "Tệp" tách riêng (export CSV).
//  - ưu tiên hiển thị → tab cùng tên trong bản copy tổng "Lịch sử mua hàng" (gviz theo tên).
export const TEP_SHEET_CSV_URL =
  process.env.TEP_SHEET_CSV_URL ||
  "https://docs.google.com/spreadsheets/d/1AJ2AyYnQdUF1-5UzrpK5Eo68S3x833l74r6l0sKdahY/export?format=csv&gid=0";
export const PRIORITY_SHEET_CSV_URL =
  process.env.PRIORITY_SHEET_CSV_URL ||
  `https://docs.google.com/spreadsheets/d/1D5vs9DnJnpWd6b2tivGuA8JPfMjPC3TlRbDFN-LDXLc/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(
    "ưu tiên hiển thị",
  )}`;
// Nhãn tài trợ → tab "Nhãn tài trợ" (gid=1306119583) trong sheet cấu hình 1sZTv. Cột: tên · link · logo.
// Đọc qua export CSV trực tiếp (không qua gviz). Sheet phải để chia sẻ "Bất kỳ ai có link → Người xem".
export const SPONSOR_SHEET_CSV_URL =
  process.env.SPONSOR_SHEET_CSV_URL ||
  "https://docs.google.com/spreadsheets/d/1sZTv7FHGEq6V_d8wiFKd-7cVFjpURUcAeDPVI_1WiJo/export?format=csv&gid=1306119583";

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

/** Tách chuỗi "THXL, TDAT" / "THXL TDAT" → ["THXL","TDAT"] (giữ thứ tự, bỏ rỗng). */
function splitChains(raw: string): string[] {
  return (raw || "")
    .split(/[,;|\/]+|\s{2,}/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Parse CSV tab "tệp" → ProductGroup[]. Dò cột theo tên header. */
export function parseTepCsv(csv: string): ProductGroup[] {
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
    label: col("tệp", "tep", "nhãn", "nhan", "label", "danh_muc", "danh mục"),
    emoji: col("emoji", "icon"),
    link: col("link", "url"),
    note: col("ghi_chu", "ghi chú", "ghi chu", "note"),
    priority: col("ưu tiên", "uu tien", "priority"),
  };
  // Cột tên tệp bắt buộc; nếu không dò được, lấy cột đầu.
  const labelIdx = ci.label >= 0 ? ci.label : 0;

  const out: ProductGroup[] = [];
  const seen = new Set<string>();
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const label = (r[labelIdx] || "").trim();
    if (!label || seen.has(label.toLowerCase())) continue;
    seen.add(label.toLowerCase());
    const emoji = ci.emoji >= 0 ? (r[ci.emoji] || "").trim() : "";
    const link = ci.link >= 0 ? (r[ci.link] || "").trim() : "";
    const note = ci.note >= 0 ? (r[ci.note] || "").trim() : "";
    const priority = ci.priority >= 0 ? (r[ci.priority] || "").trim() : "";
    out.push({
      label,
      emoji: emoji || undefined,
      link: link || undefined,
      note: note || undefined,
      priority: priority || undefined,
    });
  }
  return out;
}

/** Parse CSV tab "ưu tiên hiển thị" → PriorityProfile[]. Dò cột theo tên header. */
export function parsePriorityCsv(csv: string): PriorityProfile[] {
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
    name: col("ưu tiên", "uu tien", "name", "tên", "ten"),
    chains: col("chuỗi", "chuoi", "chain", "store"),
    note: col("ghi_chu", "ghi chú", "ghi chu", "note"),
  };
  const nameIdx = ci.name >= 0 ? ci.name : 0;
  const chainsIdx = ci.chains >= 0 ? ci.chains : 1;

  const out: PriorityProfile[] = [];
  const seen = new Set<string>();
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const name = (r[nameIdx] || "").trim();
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    const chains = splitChains(chainsIdx >= 0 ? r[chainsIdx] : "");
    if (!chains.length) continue;
    out.push({
      name,
      chains,
      note: ci.note >= 0 ? (r[ci.note] || "").trim() || undefined : undefined,
    });
  }
  return out;
}

/** Parse CSV tab "Nhãn tài trợ" → Sponsor[]. Dò cột theo tên header (tên · link · logo). */
export function parseSponsorCsv(csv: string): Sponsor[] {
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
    name: col("tên", "ten", "nhãn", "nhan", "name", "brand"),
    link: col("link", "url"),
    logo: col("logo", "ảnh", "anh", "image", "icon"),
    show: col("hiển thị", "hien thi", "hien_thi", "hienthi", "show"),
  };
  const nameIdx = ci.name >= 0 ? ci.name : 0;
  const HIDE = new Set(["0", "false", "no", "off", "ẩn", "an", "không", "khong"]);

  const out: Sponsor[] = [];
  const seen = new Set<string>();
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const name = (r[nameIdx] || "").trim();
    if (!name || seen.has(name.toLowerCase())) continue;
    if (ci.show >= 0 && HIDE.has((r[ci.show] || "").trim().toLowerCase())) continue; // tắt hiển thị
    seen.add(name.toLowerCase());
    out.push({
      name,
      link: ci.link >= 0 ? (r[ci.link] || "").trim() || undefined : undefined,
      logo: ci.logo >= 0 ? (r[ci.logo] || "").trim() || undefined : undefined,
    });
  }
  return out;
}

/**
 * Tải + parse các tab cấu hình hiển thị. Trả về object có thể rỗng cho từng phần
 * (groups/priorities/sponsors = undefined nếu lỗi/rỗng) để caller fallback an toàn.
 */
export async function fetchSheetGroups(
  revalidate = 300,
): Promise<{ groups?: ProductGroup[]; priorities?: PriorityProfile[]; sponsors?: Sponsor[] }> {
  const fetchCsv = async (url: string): Promise<string | null> => {
    try {
      const res = await fetch(url, { next: { revalidate } });
      if (!res.ok) return null;
      return await res.text();
    } catch {
      return null;
    }
  };

  const [tepCsv, prioCsv, sponsorCsv] = await Promise.all([
    fetchCsv(TEP_SHEET_CSV_URL),
    fetchCsv(PRIORITY_SHEET_CSV_URL),
    fetchCsv(SPONSOR_SHEET_CSV_URL),
  ]);

  const groups = tepCsv ? parseTepCsv(tepCsv) : [];
  const priorities = prioCsv ? parsePriorityCsv(prioCsv) : [];
  const sponsors = sponsorCsv ? parseSponsorCsv(sponsorCsv) : [];

  return {
    groups: groups.length ? groups : undefined,
    priorities: priorities.length ? priorities : undefined,
    sponsors: sponsors.length ? sponsors : undefined,
  };
}
