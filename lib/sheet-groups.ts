import type { ProductGroup, PriorityProfile, Sponsor, MealTitle } from "./types";

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
// "Tệp" (sheet 1AJ2, gid=0) — cấu hình TOP TILES "Dịch vụ quanh đây", bao gồm các tile có
// link ngoài (B2B, Đàn ông đích thực, Định giá, Xây dựng…). KHÔNG dùng cho bottom sections.
export const TEP_SHEET_CSV_URL =
  process.env.TEP_SHEET_CSV_URL ||
  "https://docs.google.com/spreadsheets/d/1AJ2AyYnQdUF1-5UzrpK5Eo68S3x833l74r6l0sKdahY/export?format=csv&gid=0";

// "DanhMuc" (sheet 1sZTv, gid=1750024373) — cấu hình BOTTOM SECTIONS (Đồ ăn / Worldcup / Tươi
// xanh nhanh ngon / Hàng thiết yếu / Hè-Đẹp-Khỏe…). Cột tối thiểu: ten · emoji. Tách riêng
// khỏi top tiles để bottom sections do anh kiểm soát từ sheet 1sZTv mà không lẫn link ngoài.
export const DANHMUC_SHEET_CSV_URL =
  process.env.DANHMUC_SHEET_CSV_URL ||
  "https://docs.google.com/spreadsheets/d/1sZTv7FHGEq6V_d8wiFKd-7cVFjpURUcAeDPVI_1WiJo/export?format=csv&gid=1750024373";
export const PRIORITY_SHEET_CSV_URL =
  process.env.PRIORITY_SHEET_CSV_URL ||
  `https://docs.google.com/spreadsheets/d/1D5vs9DnJnpWd6b2tivGuA8JPfMjPC3TlRbDFN-LDXLc/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(
    "ưu tiên hiển thị",
  )}`;
// Nhãn tài trợ → tab "Nhãn tài trợ" (gid=1306119583) trong sheet cấu hình 1sZTv.
// Cột: tên · link · logo · loại · hiển thị
//   - loại: "tài trợ" → badge vàng "Tài trợ" (nhãn của nhà mình); "phổ biến" hoặc trống → badge xám "Phổ biến".
//   - hiển thị: "0"/"false"/"ẩn"/"không" → ẩn dòng đó khỏi UI.
// Đọc qua export CSV trực tiếp (không qua gviz). Sheet phải để chia sẻ "Bất kỳ ai có link → Người xem".
export const SPONSOR_SHEET_CSV_URL =
  process.env.SPONSOR_SHEET_CSV_URL ||
  "https://docs.google.com/spreadsheets/d/1sZTv7FHGEq6V_d8wiFKd-7cVFjpURUcAeDPVI_1WiJo/export?format=csv&gid=1306119583";

// Tab "SanPham" (gid=0) trong sheet 1sZTv — OVERRIDE LAYER chỉ cho cột danh_muc theo product_id.
// Catalog chính (giá/store/brand) vẫn đọc từ sheet cũ; tab này chỉ dùng để gán/đổi tệp cho từng SKU
// mà không phải sửa sheet catalog gốc. Cột tối thiểu: danh_muc · product_id.
export const SANPHAM_OVERRIDE_CSV_URL =
  process.env.SANPHAM_OVERRIDE_CSV_URL ||
  "https://docs.google.com/spreadsheets/d/1sZTv7FHGEq6V_d8wiFKd-7cVFjpURUcAeDPVI_1WiJo/export?format=csv&gid=0";

// Tab "Tên Đồ ăn theo giờ" (gid=743152394) trong sheet 1sZTv — tên section "Đồ ăn" đổi theo buổi ăn.
// Cột: Từ giờ · Tên hiển thị · Tên tiếng Anh. Đổi tên buổi ăn ngay trên sheet, không cần sửa code.
export const MEAL_TITLES_CSV_URL =
  process.env.MEAL_TITLES_CSV_URL ||
  "https://docs.google.com/spreadsheets/d/1sZTv7FHGEq6V_d8wiFKd-7cVFjpURUcAeDPVI_1WiJo/export?format=csv&gid=743152394";

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
  // Phát hiện cột "Thứ tự ưu tiên" TRƯỚC để loại khỏi priority (vì cùng chứa "ưu tiên").
  const orderIdx = col("thứ tự", "thu tu", "stt");
  const hiddenIdx = col("ẩn ", "hiện", "hien", "show", "hide", "ẩn/", "/ẩn");
  // priority KHÔNG nên trùng orderIdx — nếu trùng thì coi như không có priority.
  let priorityIdx = col("ưu tiên", "uu tien", "priority");
  if (priorityIdx === orderIdx) priorityIdx = -1;
  const ci = {
    label: col("tệp", "tep", "nhãn", "nhan", "label", "danh_muc", "danh mục", "ten"),
    emoji: col("emoji", "icon"),
    link: col("link", "url"),
    note: col("ghi_chu", "ghi chú", "ghi chu", "note"),
    priority: priorityIdx,
    order: orderIdx,
    hidden: hiddenIdx,
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
    // Cột "Thứ tự ưu tiên" — số nhỏ hiện trước. Trống/0/NaN → undefined (đứng cuối).
    const orderRaw = ci.order >= 0 ? (r[ci.order] || "").trim() : "";
    const orderNum = Number(orderRaw);
    const order = orderRaw && Number.isFinite(orderNum) ? orderNum : undefined;
    // Cột "Hiện"/"Ẩn": "ẩn"/"an"/"hide"/"false"/"0" → hidden=true; mặc định = false (hiện).
    const hidRaw = ci.hidden >= 0 ? (r[ci.hidden] || "").trim().toLowerCase() : "";
    const hidden = /^(ẩn|an|hide|hidden|no|false|0)$/.test(hidRaw);
    out.push({
      label,
      emoji: emoji || undefined,
      link: link || undefined,
      note: note || undefined,
      priority: priority || undefined,
      order,
      hidden: hidden || undefined,
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
    kind: col("loại", "loai", "kind", "type"),
  };
  const nameIdx = ci.name >= 0 ? ci.name : 0;
  const HIDE = new Set(["0", "false", "no", "off", "ẩn", "an", "không", "khong"]);

  const parseKind = (raw: string): "sponsor" | "popular" | undefined => {
    const v = raw.trim().toLowerCase();
    if (!v) return undefined;
    if (/(tài trợ|tai tro|sponsor|own|nhà mình|nha minh)/i.test(v)) return "sponsor";
    if (/(phổ biến|pho bien|popular)/i.test(v)) return "popular";
    return undefined;
  };

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
      kind: ci.kind >= 0 ? parseKind(r[ci.kind] || "") : undefined,
    });
  }
  return out;
}

/**
 * Parse CSV tab "SanPham" override → Map<product_id, danh_muc[]>.
 * Cột tối thiểu: danh_muc (hoặc "tệp"/"tep"/"nhóm") + product_id.
 * Mỗi product_id có thể xuất hiện NHIỀU dòng với các danh_muc khác nhau → gom thành mảng.
 * Dùng để OVERRIDE field `group`/`groups` của Product mà không phải sửa sheet catalog gốc.
 */
export function parseSanPhamOverrideCsv(csv: string): Map<string, string[]> {
  const rows = splitCsv(csv).filter((r) => r.some((c) => c.trim() !== ""));
  const out = new Map<string, string[]>();
  if (rows.length < 2) return out;

  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = (...keys: string[]) => {
    for (let i = 0; i < header.length; i++) {
      if (keys.some((k) => header[i].includes(k))) return i;
    }
    return -1;
  };
  const ci = {
    pid: col("product_id", "productid", "product id", "mã", "ma_sp", "id"),
    group: col("danh_muc", "danh mục", "tệp", "tep", "nhóm", "nhom", "group"),
  };
  if (ci.pid < 0 || ci.group < 0) return out;

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const pid = (r[ci.pid] || "").trim();
    const g = (r[ci.group] || "").trim();
    if (!pid || !g) continue;
    if (!out.has(pid)) out.set(pid, []);
    const arr = out.get(pid)!;
    if (!arr.includes(g)) arr.push(g);
  }
  return out;
}

/** Parse CSV tab "Tên Đồ ăn theo giờ" → MealTitle[]. Cột: Từ giờ · Tên hiển thị · Tên tiếng Anh. */
export function parseMealTitlesCsv(csv: string): MealTitle[] {
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
    hour: col("từ giờ", "tu gio", "giờ", "gio", "hour", "from"),
    vi: col("tên hiển thị", "ten hien thi", "hiển thị", "tên việt", "vi", "name"),
    en: col("tiếng anh", "tieng anh", "english", "en"),
  };
  const hourIdx = ci.hour >= 0 ? ci.hour : 0;
  const viIdx = ci.vi >= 0 ? ci.vi : 1;
  const enIdx = ci.en >= 0 ? ci.en : 2;

  const out: MealTitle[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const hourRaw = (r[hourIdx] || "").trim();
    const fromHour = Number(hourRaw);
    const vi = (r[viIdx] || "").trim();
    if (!vi || !Number.isFinite(fromHour)) continue;
    const en = (enIdx >= 0 ? (r[enIdx] || "").trim() : "") || vi; // thiếu EN → dùng VI
    out.push({ fromHour: ((fromHour % 24) + 24) % 24, vi, en });
  }
  return out;
}

/**
 * Tải + parse các tab cấu hình hiển thị. Trả về object có thể rỗng cho từng phần
 * (groups/priorities/sponsors/sanPhamGroupOverrides/danhMucGroups = undefined nếu lỗi/rỗng).
 *
 * - `groups` = cấu hình TOP TILES "Dịch vụ quanh đây" (sheet 1AJ2/gid=0) — gồm các tile có link ngoài.
 * - `danhMucGroups` = cấu hình BOTTOM SECTIONS (sheet 1sZTv/DanhMuc) — chỉ ten + emoji, đơn giản.
 */
export async function fetchSheetGroups(
  revalidate = 300,
): Promise<{ groups?: ProductGroup[]; danhMucGroups?: ProductGroup[]; priorities?: PriorityProfile[]; sponsors?: Sponsor[]; sanPhamGroupOverrides?: Map<string, string[]>; mealTitles?: MealTitle[] }> {
  const fetchCsv = async (url: string): Promise<string | null> => {
    try {
      // revalidate=0 → tắt cache Next.js (force-dynamic ở route). Thêm cache-buster `_=<ms>`
      // để bypass cả cache CDN của Google Sheets, đảm bảo lần fetch nào cũng là dữ liệu mới
      // nhất → user sửa sheet là reload web thấy NGAY (không phải đợi).
      const bust = revalidate === 0 ? `${url.includes("?") ? "&" : "?"}_=${Date.now()}` : "";
      const res = await fetch(url + bust, {
        next: { revalidate },
        cache: revalidate === 0 ? "no-store" : "default",
      });
      if (!res.ok) return null;
      return await res.text();
    } catch {
      return null;
    }
  };

  const [tepCsv, danhMucCsv, prioCsv, sponsorCsv, sanphamCsv, mealCsv] = await Promise.all([
    fetchCsv(TEP_SHEET_CSV_URL),
    fetchCsv(DANHMUC_SHEET_CSV_URL),
    fetchCsv(PRIORITY_SHEET_CSV_URL),
    fetchCsv(SPONSOR_SHEET_CSV_URL),
    fetchCsv(SANPHAM_OVERRIDE_CSV_URL),
    fetchCsv(MEAL_TITLES_CSV_URL),
  ]);

  const groups = tepCsv ? parseTepCsv(tepCsv) : [];
  const danhMucGroups = danhMucCsv ? parseTepCsv(danhMucCsv) : [];
  const priorities = prioCsv ? parsePriorityCsv(prioCsv) : [];
  const sponsors = sponsorCsv ? parseSponsorCsv(sponsorCsv) : [];
  const sanPhamGroupOverrides = sanphamCsv ? parseSanPhamOverrideCsv(sanphamCsv) : new Map();
  const mealTitles = mealCsv ? parseMealTitlesCsv(mealCsv) : [];

  return {
    groups: groups.length ? groups : undefined,
    danhMucGroups: danhMucGroups.length ? danhMucGroups : undefined,
    priorities: priorities.length ? priorities : undefined,
    sponsors: sponsors.length ? sponsors : undefined,
    sanPhamGroupOverrides: sanPhamGroupOverrides.size ? sanPhamGroupOverrides : undefined,
    mealTitles: mealTitles.length ? mealTitles : undefined,
  };
}
