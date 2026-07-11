/**
 * Đọc tab cấu hình Zalo OA (sheet 1zazXH6…, gid=176331470) → 1 object cấu hình.
 *
 * Cột (nhận diện theo TÊN header, không phân biệt hoa/thường/dấu — thứ tự cột đổi vẫn chạy):
 *   oa_name | oa_zalo_url | oa_id | oa_logo | popup_title | popup_desc | require_follow
 * Dòng 1 = header, dòng 2 = 1 dòng cấu hình. Sheet trống/lỗi → dùng DEFAULTS.
 *
 * LƯU Ý BẢO MẬT: sheet publish CSV là công khai → CHỈ để cấu hình hiển thị.
 * KHÔNG bao giờ để token/secret OA ở đây (dành cho env khi lên phương án 🅱️).
 */

const OA_CONFIG_CSV_URL =
  process.env.OA_CONFIG_CSV_URL ||
  "https://docs.google.com/spreadsheets/d/1zazXH6onKahpwHulu9kd2OVuDseAcfcbfjxsKqDDNXA/export?format=csv&gid=176331470";

export interface OaConfig {
  oa_name: string;
  oa_zalo_url: string;
  oa_id: string;
  oa_logo: string;
  popup_title: string;
  popup_desc: string;
  require_follow: boolean;
}

const DEFAULTS: OaConfig = {
  oa_name: "Affree — One Solution",
  oa_zalo_url: "https://zalo.me/740569612756449830",
  oa_id: "740569612756449830",
  oa_logo: "",
  popup_title: "Quan tâm Zalo OA để xem liên hệ",
  popup_desc:
    "Theo dõi OA của Affree để mở khoá số liên hệ cửa hàng. Đã quan tâm rồi thì số sẽ hiện sẵn ở những lần sau.",
  require_follow: true,
};

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

const FALSEY = new Set(["false", "0", "no", "off", "khong", "không", "tat", "tắt"]);

export async function fetchOaConfig(revalidate = 60): Promise<OaConfig> {
  try {
    const res = await fetch(OA_CONFIG_CSV_URL, { next: { revalidate } });
    if (!res.ok) return DEFAULTS;
    const rows = splitCsv(await res.text());
    if (rows.length < 2) return DEFAULTS;
    const header = rows[0].map((h) => h.trim().toLowerCase());
    const idx = (...keys: string[]) => header.findIndex((h) => keys.some((k) => h.includes(k)));
    const row = rows[1];
    const get = (i: number) => (i >= 0 ? (row[i] ?? "").trim() : "");

    const reqI = idx("require_follow", "require", "bat buoc", "bắt buộc", "follow");
    const reqRaw = get(reqI).toLowerCase();

    return {
      oa_name: get(idx("oa_name", "ten", "tên", "name")) || DEFAULTS.oa_name,
      oa_zalo_url: get(idx("oa_zalo_url", "zalo_url", "zalo", "url", "link")) || DEFAULTS.oa_zalo_url,
      oa_id: get(idx("oa_id", "id")) || DEFAULTS.oa_id,
      oa_logo: get(idx("oa_logo", "logo", "anh", "ảnh", "avatar")) || DEFAULTS.oa_logo,
      popup_title: get(idx("popup_title", "title", "tieu de", "tiêu đề")) || DEFAULTS.popup_title,
      popup_desc: get(idx("popup_desc", "desc", "mo ta", "mô tả", "noi dung", "nội dung")) || DEFAULTS.popup_desc,
      require_follow: reqI >= 0 ? !FALSEY.has(reqRaw) : DEFAULTS.require_follow,
    };
  } catch {
    return DEFAULTS;
  }
}
