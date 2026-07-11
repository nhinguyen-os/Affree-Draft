import type { VersionEntry, SubReleaseEntry, RoadmapSection } from "./version";

/**
 * Nguồn nội dung popup "i Version": Google Sheet (workbook "i Version").
 *  - Tab `versions` (gid=0): cột  major · major_date · sub_version · sub_date · highlight
 *    → mỗi dòng = 1 gạch đầu dòng (highlight) của 1 sub_version. Gom lại thành VERSION_HISTORY.
 *  - Tab `roadmap`: cột  group · emoji · item  → gom thành ROADMAP theo group.
 *
 * Cho phép team sửa nội dung "Có gì mới" / "Sắp ra mắt" ngay trên Sheet, KHÔNG cần sửa code.
 * Thứ tự trong sheet được GIỮ NGUYÊN (sheet để bản mới nhất ở trên cùng). Lỗi/tải hụt →
 * caller fallback về hằng số tĩnh trong lib/version.ts.
 */
const WORKBOOK_ID = "1rzYLTqpgiO5i7Mvlusle9MjPGZqXNH9BcVJXqXc1vPo";

export const VERSION_SHEET_CSV_URL =
  process.env.VERSION_SHEET_CSV_URL ||
  `https://docs.google.com/spreadsheets/d/${WORKBOOK_ID}/export?format=csv&gid=0`;

export const ROADMAP_SHEET_CSV_URL =
  process.env.ROADMAP_SHEET_CSV_URL ||
  `https://docs.google.com/spreadsheets/d/${WORKBOOK_ID}/gviz/tq?tqx=out:csv&sheet=roadmap`;

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

/** Dò index cột theo tên header (không phụ thuộc thứ tự, khớp một phần). */
function headerIndex(header: string[], ...keys: string[]): number {
  const h = header.map((x) => x.trim().toLowerCase());
  for (let i = 0; i < h.length; i++) {
    if (keys.some((k) => h[i].includes(k))) return i;
  }
  return -1;
}

/**
/** So sánh version giảm dần theo SỐ: "1.3.10" > "1.3.8" > "1.3" > "1.0.1". */
function cmpVersionDesc(a: string, b: string): number {
  const pa = a.split(".").map((x) => parseInt(x, 10) || 0);
  const pb = b.split(".").map((x) => parseInt(x, 10) || 0);
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    const d = (pb[i] ?? 0) - (pa[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/**
 * Parse tab `versions` → VERSION_HISTORY.
 * Quy ước NHẬP LIỆU: điền bản mới ở đâu cũng được (thường append DÒNG CUỐI sheet).
 *   → Bản MỚI NHẤT xác định theo SỐ phiên bản (không phụ thuộc vị trí dòng): major + sub_version
 *     sắp GIẢM DẦN nên 1.3.8 luôn lên đầu popup dù nằm ở đầu hay cuối sheet.
 *   → riêng các gạch đầu dòng (highlight) TRONG 1 sub_version GIỮ NGUYÊN thứ tự sheet
 *     (highlight thêm sau vẫn nằm dưới cùng của bản đó).
 */
export function parseVersionsCsv(csv: string): VersionEntry[] {
  const rows = splitCsv(csv).filter((r) => r.some((c) => c.trim() !== ""));
  if (rows.length < 2) return [];
  const header = rows[0];
  const ci = {
    major: headerIndex(header, "major", "cha"),
    majorDate: headerIndex(header, "major_date", "ngày cha"),
    sub: headerIndex(header, "sub_version", "sub", "phiên bản con"),
    subDate: headerIndex(header, "sub_date", "ngày con"),
    highlight: headerIndex(header, "highlight", "nội dung", "noi dung"),
    stt: headerIndex(header, "stt", "thứ tự", "thu tu", "order", "no."),
  };
  if (ci.sub < 0 || ci.highlight < 0) return [];

  const majors: VersionEntry[] = [];
  const majorByKey = new Map<string, VersionEntry>();
  const subByKey = new Map<string, SubReleaseEntry>();
  // Gom highlight kèm STT + thứ tự dòng để sắp lại trong mỗi sub_version.
  const itemsBySub = new Map<SubReleaseEntry, { text: string; stt: number; seq: number }[]>();

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const subV = (r[ci.sub] || "").trim();
    const highlight = (r[ci.highlight] || "").trim();
    if (!subV || !highlight) continue;

    // Nhóm major SUY TỪ chính sub_version (2 đoạn đầu, vd "1.3.9" → "1.3"), KHÔNG lệ thuộc
    // cột `major` (dễ nhập lệch). Fallback cột `major` nếu sub_version chỉ có 1 đoạn.
    const majorColV = ci.major >= 0 ? (r[ci.major] || "").trim() : "";
    const parts = subV.split(".");
    const derivedMajor = parts.length >= 2 ? parts.slice(0, 2).join(".") : majorColV || subV;
    const majorDateV = ci.majorDate >= 0 ? (r[ci.majorDate] || "").trim() : "";

    let major = majorByKey.get(derivedMajor);
    if (!major) {
      major = { version: derivedMajor, date: majorDateV || undefined, children: [] };
      majorByKey.set(derivedMajor, major);
      majors.push(major);
    } else if (!major.date && majorDateV) {
      major.date = majorDateV;
    }

    const subKey = `${derivedMajor}::${subV}`;
    let sub = subByKey.get(subKey);
    if (!sub) {
      sub = {
        subVersion: subV,
        date: ci.subDate >= 0 ? (r[ci.subDate] || "").trim() || undefined : undefined,
        highlights: [],
      };
      subByKey.set(subKey, sub);
      major.children.push(sub);
      itemsBySub.set(sub, []);
    }
    // STT: có số → sắp tăng dần theo số; trống/không phải số → giữ thứ tự dòng (đẩy xuống cuối).
    const sttRaw = ci.stt >= 0 ? (r[ci.stt] || "").trim() : "";
    const sttNum = sttRaw !== "" && isFinite(Number(sttRaw)) ? Number(sttRaw) : Number.POSITIVE_INFINITY;
    itemsBySub.get(sub)!.push({ text: highlight, stt: sttNum, seq: i });
  }

  // Trong mỗi sub: sắp highlight theo STT tăng dần (tie/không STT → giữ thứ tự dòng sheet).
  for (const [sub, items] of itemsBySub) {
    items.sort((a, b) => (a.stt - b.stt) || (a.seq - b.seq));
    sub.highlights = items.map((it) => it.text);
  }

  // Sắp GIẢM DẦN theo số phiên bản → bản mới nhất lên đầu (không phụ thuộc vị trí dòng sheet).
  majors.sort((a, b) => cmpVersionDesc(a.version, b.version));
  for (const m of majors) m.children.sort((a, b) => cmpVersionDesc(a.subVersion, b.subVersion));
  return majors;
}

/** Parse tab `roadmap` → ROADMAP. Gom theo group (giữ thứ tự), giữ emoji của group. */
export function parseRoadmapCsv(csv: string): RoadmapSection[] {
  const rows = splitCsv(csv).filter((r) => r.some((c) => c.trim() !== ""));
  if (rows.length < 2) return [];
  const header = rows[0];
  const ci = {
    group: headerIndex(header, "group", "nhóm", "nhom"),
    emoji: headerIndex(header, "emoji", "icon", "biểu tượng"),
    item: headerIndex(header, "item", "nội dung", "noi dung", "highlight"),
  };
  if (ci.item < 0) return [];

  const out: RoadmapSection[] = [];
  const byGroup = new Map<string, RoadmapSection>();
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const group = ci.group >= 0 ? (r[ci.group] || "").trim() : "";
    const item = (r[ci.item] || "").trim();
    // Chỉ cần có nội dung item; group/emoji để TRỐNG cũng nhận (gom vào 1 nhóm không tiêu đề).
    if (!item) continue;
    let sec = byGroup.get(group);
    if (!sec) {
      sec = { group, emoji: ci.emoji >= 0 ? (r[ci.emoji] || "").trim() : "", items: [] };
      byGroup.set(group, sec);
      out.push(sec);
    }
    if (!sec.emoji && ci.emoji >= 0) sec.emoji = (r[ci.emoji] || "").trim();
    sec.items.push(item);
  }
  return out;
}

/** Tải 1 tab CSV, retry vài lần (Google hay 302/429 trên edge). Trả "" nếu fail. */
async function fetchCsv(url: string, revalidate: number): Promise<string> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { next: { revalidate }, redirect: "follow" });
      if (res.ok) {
        const text = await res.text();
        if (text) return text;
      }
    } catch {
      /* thử lại */
    }
    await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
  }
  return "";
}

export interface SheetVersionData {
  appVersion: string;
  history: VersionEntry[];
  roadmap: RoadmapSection[];
}

/**
 * Tải + parse cả 2 tab. Trả null nếu tab `versions` hụt (không có history → caller fallback tĩnh).
 * `appVersion` = sub_version mới nhất (đầu mảng history đầu tiên). Roadmap lỗi → mảng rỗng.
 */
export async function fetchSheetVersion(revalidate = 60): Promise<SheetVersionData | null> {
  const [verCsv, roadCsv] = await Promise.all([
    fetchCsv(VERSION_SHEET_CSV_URL, revalidate),
    fetchCsv(ROADMAP_SHEET_CSV_URL, revalidate),
  ]);
  if (!verCsv) return null;
  const history = parseVersionsCsv(verCsv);
  if (!history.length || !history[0].children.length) return null;
  const roadmap = roadCsv ? parseRoadmapCsv(roadCsv) : [];
  const appVersion = history[0].children[0].subVersion;
  return { appVersion, history, roadmap };
}
