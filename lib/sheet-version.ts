import {
  APP_VERSION as FALLBACK_APP_VERSION,
  VERSION_HISTORY as FALLBACK_HISTORY,
  ROADMAP as FALLBACK_ROADMAP,
  VERSION_FALLBACK,
  type VersionEntry,
  type RoadmapSection,
  type VersionInfo,
} from "./version";

export { VERSION_FALLBACK };
export type { VersionInfo };

/**
 * Nguồn "Phiên bản" (danh sách chữ "i" version) + "Sắp ra mắt" từ Google Sheet.
 * Cho phép sửa nội dung version ngay trên sheet, KHÔNG cần sửa code / deploy lại.
 *
 * 2 tab (dò theo TÊN tab qua gviz nên không phụ thuộc gid):
 *   - tab "versions": cột  major · major_date · sub_version · sub_date · highlight
 *       (mỗi dòng = 1 highlight; nhóm theo major → sub_version, giữ thứ tự dòng = thứ tự hiển thị)
 *   - tab "roadmap":  cột  group · emoji · item
 *       (mỗi dòng = 1 mục "Sắp ra mắt")
 *
 * Cột dò theo TÊN header (không phụ thuộc thứ tự). Sheet lỗi/riêng tư/rỗng → dùng FALLBACK
 * (đúng nội dung đang hardcode trong lib/version.ts) nên app KHÔNG bao giờ trống trang Phiên bản.
 *
 * LƯU Ý: sheet publish/chia sẻ công khai là công khai → chỉ để nội dung hiển thị cho người dùng.
 */
const VERSION_SHEET_ID =
  process.env.VERSION_SHEET_ID || "1rzYLTqpgiO5i7Mvlusle9MjPGZqXNH9BcVJXqXc1vPo";

const gviz = (sheetName: string) =>
  `https://docs.google.com/spreadsheets/d/${VERSION_SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}`;

const VERSIONS_CSV_URL = process.env.VERSION_SHEET_CSV_URL || gviz("versions");
const ROADMAP_CSV_URL = process.env.ROADMAP_SHEET_CSV_URL || gviz("roadmap");

/** Tách CSV → mảng hàng × cột (hỗ trợ field có dấu " và xuống dòng bên trong). */
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
        if (t[i + 1] === '"') {
          field += '"';
          i++;
        } else inQ = false;
      } else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

const headerIndexer = (header: string[]) => (...keys: string[]) =>
  header.findIndex((h) => keys.some((k) => h.includes(k)));

/**
 * Parse tab "versions" → VersionEntry[]. Giữ thứ tự xuất hiện: major → sub_version → highlight.
 * Trả [] nếu thiếu cột bắt buộc (major/sub_version/highlight) để caller fallback.
 */
export function parseVersionsCsv(csv: string): VersionEntry[] {
  const rows = splitCsv(csv);
  if (rows.length < 2) return [];
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const idx = headerIndexer(header);
  const ci = {
    major: idx("major", "cha", "version"),
    majorDate: idx("major_date", "cha_date", "ngay_cha"),
    sub: idx("sub_version", "sub", "con", "patch"),
    subDate: idx("sub_date", "date", "ngay"),
    highlight: idx("highlight", "noi dung", "nội dung", "mo ta", "mô tả", "item"),
  };
  // sub_date có thể trùng khớp "date" trước major_date → chấp nhận; nhưng bắt buộc có major/sub/highlight.
  if (ci.major < 0 || ci.sub < 0 || ci.highlight < 0) return [];

  const get = (r: string[], i: number) => (i >= 0 ? (r[i] ?? "").trim() : "");
  const parents: VersionEntry[] = [];
  const parentByVer = new Map<string, VersionEntry>();
  const subByKey = new Map<string, { subVersion: string; date?: string; highlights: string[] }>();

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const major = get(r, ci.major);
    const sub = get(r, ci.sub);
    const highlight = get(r, ci.highlight);
    if (!major || !sub || !highlight) continue;

    let parent = parentByVer.get(major);
    if (!parent) {
      parent = { version: major, date: get(r, ci.majorDate) || undefined, children: [] };
      parentByVer.set(major, parent);
      parents.push(parent);
    }
    const key = `${major}||${sub}`;
    let subEntry = subByKey.get(key);
    if (!subEntry) {
      subEntry = { subVersion: sub, date: get(r, ci.subDate) || undefined, highlights: [] };
      subByKey.set(key, subEntry);
      parent.children.push(subEntry);
    }
    subEntry.highlights.push(highlight);
  }
  return parents;
}

/** Parse tab "roadmap" → RoadmapSection[]. Trả [] nếu thiếu cột group/item. */
export function parseRoadmapCsv(csv: string): RoadmapSection[] {
  const rows = splitCsv(csv);
  if (rows.length < 2) return [];
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const idx = headerIndexer(header);
  const ci = {
    group: idx("group", "nhom", "nhóm"),
    emoji: idx("emoji", "icon", "bieu tuong", "biểu tượng"),
    item: idx("item", "muc", "mục", "noi dung", "nội dung"),
  };
  if (ci.group < 0 || ci.item < 0) return [];

  const get = (r: string[], i: number) => (i >= 0 ? (r[i] ?? "").trim() : "");
  const sections: RoadmapSection[] = [];
  const byGroup = new Map<string, RoadmapSection>();
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const group = get(r, ci.group);
    const item = get(r, ci.item);
    if (!group || !item) continue;
    let sec = byGroup.get(group);
    if (!sec) {
      sec = { group, emoji: get(r, ci.emoji), items: [] };
      byGroup.set(group, sec);
      sections.push(sec);
    }
    sec.items.push(item);
  }
  return sections;
}

async function fetchCsv(url: string, revalidate: number): Promise<string> {
  // Google hay 302/429 trên Vercel edge → thử vài lần trước khi bỏ cuộc.
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
    await new Promise((r) => setTimeout(r, 200 * (attempt + 1)));
  }
  return "";
}

/**
 * Đọc version + roadmap từ sheet. Mỗi phần fallback ĐỘC LẬP: versions lỗi thì lấy history
 * hardcode; roadmap lỗi thì lấy roadmap hardcode. appVersion = sub_version của dòng đầu tiên.
 */
export async function fetchVersionInfo(revalidate = 60): Promise<VersionInfo> {
  const [vCsv, rCsv] = await Promise.all([
    fetchCsv(VERSIONS_CSV_URL, revalidate),
    fetchCsv(ROADMAP_CSV_URL, revalidate),
  ]);

  let history = FALLBACK_HISTORY;
  let appVersion = FALLBACK_APP_VERSION;
  if (vCsv) {
    const parsed = parseVersionsCsv(vCsv);
    if (parsed.length && parsed[0].children.length) {
      history = parsed;
      appVersion = parsed[0].children[0].subVersion || FALLBACK_APP_VERSION;
    }
  }

  let roadmap = FALLBACK_ROADMAP;
  if (rCsv) {
    const parsed = parseRoadmapCsv(rCsv);
    if (parsed.length) roadmap = parsed;
  }

  return { appVersion, history, roadmap };
}
