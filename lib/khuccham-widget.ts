/**
 * Cấu hình ĐỘNG cho widget "Khúc Chạm Channel" (tên kênh, logo, link, các pill, video player).
 * Module THUẦN (không gọi server) → import được cả client lẫn server.
 *
 * Nguồn động: 2 tab trong Google Sheet cấu hình (xem app/api/khuccham-widget/route.ts):
 *  - tab "KhucChamCaiDat": 2 cột key/value (ten_kenh, logo, trang_dich, handle, video_mac_dinh)
 *  - tab "KhucChamPill":   mỗi dòng 1 pill (thu_tu, nhan, loai, video_hoac_link, chay_chu, an)
 * Tab trống/lỗi → fallback DEFAULT_WIDGET (giá trị hiện tại) để widget không bao giờ vỡ.
 */
import { ytVideoId } from "./music";

export type WidgetPillType = "nghe" | "link" | "lien_he_yeu_thuong" | "lien_he_ban_quyen";

export interface WidgetPill {
  label: string;
  type: WidgetPillType;
  /** videoId YouTube khi type="nghe" (bấm → phát trong player). */
  videoId?: string;
  /** URL khi type="link" (bấm → mở trang ngoài). */
  url?: string;
  /** true = pill chạy chữ (marquee). */
  marquee?: boolean;
}

export interface KhucChamWidget {
  channelName: string;
  /** URL logo; trống → component dùng ảnh mặc định /assets/khuc-cham-logo.png. */
  logo: string;
  landingUrl: string;
  /** Dòng @... ở chân widget; trống → ẩn. */
  handle: string;
  /** videoId phát khi mở widget. */
  defaultVideoId: string;
  pills: WidgetPill[];
}

/** Mặc định = đúng nội dung widget đang hard-code (fallback khi sheet trống/lỗi). */
export const DEFAULT_WIDGET: KhucChamWidget = {
  channelName: "Khúc Chạm Channel",
  logo: "",
  landingUrl: "https://music.youtube.com/@KhucChamChannel",
  handle: "@KhucChamChannel",
  defaultVideoId: "k47rkLLuDlg",
  pills: [
    { label: "Âm nhạc và dự báo thời tiết", type: "nghe", videoId: "B7QWA7X8vH0" },
    { label: "Album Mùa Hè Sôi Động 2026", type: "nghe", videoId: "k47rkLLuDlg", marquee: true },
    { label: "Gửi lời yêu thương", type: "lien_he_yeu_thuong" },
    { label: "Gửi đề nghị nhận nhạc bản quyền & khai thác thương mại", type: "lien_he_ban_quyen" },
  ],
};

/** Tách CSV → mảng hàng × cột (hỗ trợ field có dấu " và xuống dòng bên trong). */
function splitCsv(csv: string): string[][] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  const text = (csv || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else field += ch;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

const isYes = (s: string) => /^(x|1|true|có|co|yes|on|✓)$/i.test((s || "").trim());

/** Chuẩn hoá cột "loai" → kiểu pill. Trả null nếu không nhận ra. */
function normType(raw: string): WidgetPillType | null {
  const v = (raw || "").trim().toLowerCase();
  if (!v) return null;
  if (/(yeu|yêu|love)/.test(v)) return "lien_he_yeu_thuong";
  if (/(quyen|quyền|license|hop tac|hợp tác|khai thac|khai thác)/.test(v)) return "lien_he_ban_quyen";
  if (/(link|url|mo|mở|web|trang)/.test(v)) return "link";
  if (/(nghe|play|phat|phát|video|bai|bài|nhac|nhạc)/.test(v)) return "nghe";
  return null;
}

/** Parse tab "KhucChamCaiDat" (key/value) → các trường cài đặt chung. */
export function parseWidgetSettings(csv: string): Partial<KhucChamWidget> {
  const out: Partial<KhucChamWidget> = {};
  for (const r of splitCsv(csv)) {
    const key = (r[0] || "").trim().toLowerCase();
    const val = (r[1] || "").trim();
    if (!key || !val) continue;
    if (/(ten_kenh|tên kênh|ten kenh|channel|name)/.test(key)) out.channelName = val;
    else if (/(logo|anh|ảnh|avatar)/.test(key)) out.logo = val;
    else if (/(trang_dich|trang dich|trang đích|landing|kenh|kênh|youtube)/.test(key)) out.landingUrl = val;
    else if (/handle|@/.test(key)) out.handle = val;
    else if (/(video_mac_dinh|mac_dinh|mặc định|mac dinh|default|video)/.test(key)) out.defaultVideoId = ytVideoId(val);
  }
  return out;
}

/** Parse tab "KhucChamPill" (mỗi dòng 1 pill) → WidgetPill[]. */
export function parsePills(csv: string): WidgetPill[] {
  const rows = splitCsv(csv).filter((r) => r.some((c) => c.trim() !== ""));
  if (rows.length < 2) return [];
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = (...keys: string[]) => {
    for (let i = 0; i < header.length; i++) if (keys.some((k) => header[i].includes(k))) return i;
    return -1;
  };
  const ci = {
    order: col("thu_tu", "thứ tự", "thu tu", "order", "stt"),
    label: col("nhan", "nhãn", "label", "ten", "tên", "but", "nút"),
    type: col("loai", "loại", "type", "kieu", "kiểu"),
    link: col("video_hoac_link", "video", "link", "url", "youtube"),
    marquee: col("chay_chu", "chạy", "chay", "marquee", "run"),
    hide: col("an", "ẩn", "hide", "off"),
  };
  if (ci.label < 0 || ci.type < 0) return [];

  const pills: { p: WidgetPill; order: number }[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const label = (r[ci.label] || "").trim();
    const type = normType(ci.type >= 0 ? r[ci.type] || "" : "");
    if (!label || !type) continue;
    if (ci.hide >= 0 && isYes(r[ci.hide] || "")) continue;
    const linkVal = ci.link >= 0 ? (r[ci.link] || "").trim() : "";
    const pill: WidgetPill = { label, type };
    if (type === "nghe") pill.videoId = ytVideoId(linkVal);
    else if (type === "link") pill.url = linkVal;
    if (ci.marquee >= 0 && isYes(r[ci.marquee] || "")) pill.marquee = true;
    const order = ci.order >= 0 ? parseInt((r[ci.order] || "").replace(/[^\d]/g, ""), 10) : NaN;
    pills.push({ p: pill, order: Number.isFinite(order) ? order : 1e9 + i });
  }
  pills.sort((a, b) => a.order - b.order);
  return pills.map((x) => x.p);
}

/** Gộp 2 CSV → KhucChamWidget hoàn chỉnh (mọi trường thiếu → lấy DEFAULT_WIDGET). */
export function buildWidget(settingsCsv: string, pillsCsv: string): KhucChamWidget {
  const s = parseWidgetSettings(settingsCsv);
  const pills = parsePills(pillsCsv);
  // Logo chỉ nhận khi là URL/đường dẫn hợp lệ (http… hoặc /…); placeholder/ghi chú → bỏ, dùng mặc định.
  const logo = s.logo && /^(https?:\/\/|\/)/.test(s.logo.trim()) ? s.logo.trim() : DEFAULT_WIDGET.logo;
  return {
    channelName: s.channelName || DEFAULT_WIDGET.channelName,
    logo,
    landingUrl: s.landingUrl || DEFAULT_WIDGET.landingUrl,
    handle: s.handle ?? DEFAULT_WIDGET.handle,
    defaultVideoId: s.defaultVideoId || DEFAULT_WIDGET.defaultVideoId,
    pills: pills.length ? pills : DEFAULT_WIDGET.pills,
  };
}
