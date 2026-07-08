/**
 * Đọc tab "cấu hình web" (sheet cấu hình 1zazXH6, gid=1397872848) — cấu hình cho TRANG
 * CỬA HÀNG KHÔNG có sản phẩm bán online: danh sách dịch vụ tạo trang bán hàng (MISA,
 * Haravan…), số điện thoại liên hệ, link Zalo OA. Cột dò theo TÊN (không theo vị trí),
 * đồng bộ cách làm của các lib/sheet-*.ts khác. Sheet trống/lỗi → dùng DEFAULT.
 *
 * Quy ước mỗi dòng (cột: ten | logo | link | mo_ta):
 *  - Dòng DỊCH VỤ:  ten = "MISA" | "Haravan" | … , link = URL trang liên hệ/tư vấn.
 *  - Dòng CÀI ĐẶT:  ten = "PHONE" (số liên hệ) hoặc "ZALO_OA" (link Zalo OA) — giá trị ở cột link.
 */

const ONLINE_CONFIG_CSV_URL =
  process.env.ONLINE_CONFIG_CSV_URL ||
  "https://docs.google.com/spreadsheets/d/1zazXH6onKahpwHulu9kd2OVuDseAcfcbfjxsKqDDNXA/export?format=csv&gid=1397872848";

export interface OnlineService {
  name: string;
  logo: string;
  link: string;
  desc: string;
}

export interface OnlineConfig {
  services: OnlineService[];
  /** Số điện thoại liên hệ (chưa cấu hình → "" → không hiển thị, KHÔNG bịa số). */
  contactPhone: string;
  /** Link Zalo OA để "Quan tâm" mở khoá xem liên hệ. */
  zaloOa: string;
}

// Mặc định khi sheet trống — dịch vụ link ra trang liên hệ/tư vấn (không auto-register).
const DEFAULTS: OnlineConfig = {
  services: [
    { name: "MISA", logo: "", link: "https://www.misa.vn/lien-he/", desc: "Phần mềm quản lý & bán hàng" },
    { name: "Haravan", logo: "", link: "https://www.haravan.com/lien-he", desc: "Tạo website bán hàng" },
  ],
  contactPhone: "",
  zaloOa: "https://zalo.me/740569612756449830",
};

/** Chuyển Google Drive /view link → direct image URL (lh3.googleusercontent) để <img> hiển thị được. */
function normalizeDriveUrl(url: string): string {
  if (!url) return url;
  const m = url.match(/drive\.google\.com\/file\/d\/([^/?#]+)/);
  if (m) return `https://lh3.googleusercontent.com/d/${m[1]}`;
  return url;
}

// CSV parser tối giản: xử lý ô có dấu ngoặc kép và xuống dòng trong ô.
function splitCsv(csv: string): string[][] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < csv.length; i++) {
    const c = csv[i];
    if (inQuotes) {
      if (c === '"') {
        if (csv[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c === "\r") { /* bỏ qua */ }
    else field += c;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

export async function fetchOnlineConfig(revalidate = 300): Promise<OnlineConfig> {
  try {
    const res = await fetch(ONLINE_CONFIG_CSV_URL, { next: { revalidate } });
    if (!res.ok) return DEFAULTS;
    const rows = splitCsv(await res.text());
    if (rows.length < 2) return DEFAULTS;

    const header = rows[0].map((h) => h.trim().toLowerCase());
    const idxOf = (subs: string[]) => header.findIndex((h) => subs.some((s) => h.includes(s)));
    const nameIdx = idxOf(["ten", "tên", "name", "dich vu", "dịch vụ"]);
    const logoIdx = idxOf(["logo", "icon", "anh", "ảnh"]);
    const linkIdx = idxOf(["link", "url", "website", "gia tri", "giá trị", "value"]);
    const descIdx = idxOf(["mo ta", "mô tả", "desc", "ghi chu", "ghi chú"]);
    if (nameIdx < 0 || linkIdx < 0) return DEFAULTS;

    const services: OnlineService[] = [];
    let contactPhone = "";
    let zaloOa = "";
    for (let i = 1; i < rows.length; i++) {
      const name = (rows[i][nameIdx] ?? "").trim();
      if (!name) continue;
      const link = (rows[i][linkIdx] ?? "").trim();
      const key = name.toUpperCase().replace(/[\s.]+/g, "_");
      if (["PHONE", "SDT", "SĐT", "DIEN_THOAI", "ĐIỆN_THOẠI"].includes(key)) { contactPhone = link; continue; }
      if (["ZALO_OA", "ZALO", "OA"].includes(key)) { zaloOa = link; continue; }
      services.push({
        name,
        logo: logoIdx >= 0 ? normalizeDriveUrl((rows[i][logoIdx] ?? "").trim()) : "",
        link,
        desc: descIdx >= 0 ? (rows[i][descIdx] ?? "").trim() : "",
      });
    }
    return {
      services: services.length ? services : DEFAULTS.services,
      contactPhone: contactPhone || DEFAULTS.contactPhone,
      zaloOa: zaloOa || DEFAULTS.zaloOa,
    };
  } catch {
    return DEFAULTS;
  }
}
