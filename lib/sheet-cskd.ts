import type { Store } from "./types";
import CSKD_SEED from "./cskd-seed.json";

const SHEET_ID =
  process.env.CSKD_SHEET_ID || "1mlks8SNxxeZvSe0bWIwzAne98VptXRFCS8rJnoKlrik";

const LOAI_CSKD_GID = process.env.CSKD_LOAI_GID || "1616621658";

// GID từng tab — thêm env var khi sheet được publish public
const TAB_GIDS: { chain: string; label: string; gid: string }[] = [
  { chain: "bhx",        label: "BHX",          gid: process.env.CSKD_BHX_GID        || "1725424807" },
  { chain: "pnj",        label: "PNJ",          gid: process.env.CSKD_PNJ_GID        || "1234119021" },
  { chain: "coop",       label: "COOP",         gid: process.env.CSKD_COOP_GID       || "357608963" },
  { chain: "aeon",       label: "Aeon",         gid: process.env.CSKD_AEON_GID       || "529607688" },
  { chain: "concung",    label: "Con Cưng",     gid: process.env.CSKD_CONCUNG_GID    || "326684663" },
  { chain: "circlek",    label: "Circle K",     gid: process.env.CSKD_CIRCLEK_GID    || "1627928477" },
  { chain: "7eleven",    label: "7-Eleven",     gid: process.env.CSKD_7ELEVEN_GID    || "899557867" },
  { chain: "gs25",       label: "GS25",         gid: process.env.CSKD_GS25_GID       || "380743128" },
  { chain: "phuclong",   label: "Phúc Long",    gid: process.env.CSKD_PHUCLONG_GID   || "133811329" },
  { chain: "highlands",  label: "Highlands",    gid: process.env.CSKD_HIGHLANDS_GID  || "312844744" },
  { chain: "hoasenhome", label: "Hoa Sen Home", gid: process.env.CSKD_HOASENHOME_GID || "724288136" },
  { chain: "premiumoutlets", label: "Premium Outlets", gid: process.env.CSKD_PREMIUMOUTLETS_GID || "1388215093" },
  { chain: "costco",     label: "Costco",       gid: process.env.CSKD_COSTCO_GID      || "270100334" },
];

function csvUrl(gid: string) {
  return `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${gid}`;
}

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
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field); field = "";
    } else if (ch === "\n") {
      row.push(field); rows.push(row); row = []; field = "";
    } else field += ch;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function parseCoord(raw: string): number | undefined {
  const t = (raw || "").trim().replace(",", ".");
  const n = parseFloat(t);
  return isFinite(n) ? n : undefined;
}

/** Parse Loại CSKD field thành mảng entries, handle commas trong tên subcategory. */
function parseLoaiCskd(raw: string): string[] {
  if (!raw?.trim()) return [];
  const parts = raw.split(",");
  const result: string[] = [];
  for (const part of parts) {
    const t = part.trim();
    if (!t) continue;
    if (t.includes(" > ") || result.length === 0) {
      result.push(t);
    } else {
      result[result.length - 1] += ", " + t;
    }
  }
  return result.filter(Boolean);
}

async function fetchTab(chain: string, gid: string): Promise<Store[]> {
  if (!gid) return [];
  const url = csvUrl(gid);
  // Retry vài lần: Google hay 302/429 khi nhiều tab tải song song trên Vercel → 1 lần fail
  // KHÔNG được rơi về seed vội. Thử lại có backoff nhẹ trước khi bỏ cuộc.
  let csv = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { next: { revalidate: 300 }, redirect: "follow" });
      if (res.ok) {
        const text = await res.text();
        if (text && text.length > 0) { csv = text; break; }
      }
    } catch {
      /* thử lại */
    }
    await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
  }
  if (!csv) return [];

  const rows = splitCsv(csv);
  if (rows.length < 2) return [];

  const header = rows[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, "_"));
  const col = (name: string) => header.indexOf(name);

  const iStt = col("stt");
  const iName = col("tên_cửa_hàng");
  const iAddr = col("địa_chỉ");
  const iLat = col("lat");
  const iLng = col("long");
  const iLoai = col("loại_cskd");
  const iWeb = col("trang_web");

  const stores: Store[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const stt = (r[iStt] || "").trim();
    if (!stt || !/^\d+$/.test(stt)) continue;
    const name = (r[iName] || "").trim();
    if (!name) continue;
    const lat = parseCoord(r[iLat] || "");
    const lng = parseCoord(r[iLng] || "");
    if (lat == null || lng == null) continue;

    stores.push({
      id: `${chain}_${stt}`,
      chain,
      name,
      address: (r[iAddr] || "").trim(),
      lat,
      lng,
      website: (iWeb >= 0 ? r[iWeb] || "" : "").trim(),
      loaiCskd: parseLoaiCskd(r[iLoai] || ""),
    });
  }
  return stores;
}

/** Fetch stores từ tất cả các tabs CSKD, merge thành 1 mảng.
 *  Tab có GID → fetch live; tab không có GID → lấy từ seed (chain đó). */
export async function fetchCskdStores(): Promise<Store[]> {
  const seedByChain = new Map<string, Store[]>();
  for (const s of CSKD_SEED as Store[]) {
    if (!seedByChain.has(s.chain)) seedByChain.set(s.chain, []);
    seedByChain.get(s.chain)!.push(s);
  }

  // Tải theo LÔ NHỎ (3 tab/lần) thay vì 13 tab song song — tránh Google giới hạn (302/429)
  // khiến nhiều tab fail và rơi về seed trên Vercel.
  const BATCH = 3;
  const results: Store[][] = [];
  for (let i = 0; i < TAB_GIDS.length; i += BATCH) {
    const batch = TAB_GIDS.slice(i, i + BATCH);
    const part = await Promise.all(
      batch.map(async (t) => {
        if (t.gid) {
          const live = await fetchTab(t.chain, t.gid);
          return live.length > 0 ? live : (seedByChain.get(t.chain) ?? []);
        }
        return seedByChain.get(t.chain) ?? [];
      })
    );
    results.push(...part);
  }
  return results.flat();
}

export interface CskdCategory {
  category: string;
  subs: string[];
}

/** Fetch taxonomy "Loại CSKD" từ tab riêng của sheet. */
export async function fetchLoaiCskdTaxonomy(): Promise<CskdCategory[]> {
  const url = csvUrl(LOAI_CSKD_GID);
  let csv: string;
  try {
    const res = await fetch(url, { next: { revalidate: 3600 } });
    if (!res.ok) return FALLBACK_TAXONOMY;
    csv = await res.text();
  } catch {
    return FALLBACK_TAXONOMY;
  }

  const rows = splitCsv(csv);
  const map = new Map<string, string[]>();
  for (const r of rows) {
    const cat = (r[0] || "").trim();
    const sub = (r[1] || "").trim();
    if (!cat || !sub) continue;
    if (!map.has(cat)) map.set(cat, []);
    map.get(cat)!.push(sub);
  }
  if (map.size === 0) return FALLBACK_TAXONOMY;
  return Array.from(map.entries()).map(([category, subs]) => ({ category, subs }));
}

// Fallback nếu sheet chưa public / lỗi fetch
const FALLBACK_TAXONOMY: CskdCategory[] = [
  { category: "ĂN UỐNG", subs: ["Ăn vặt", "Beer Club", "Buffet", "Fast Food", "Giải khát", "Kem", "Khác", "Lẩu", "Món ăn gia đình", "Món chay", "Món Hàn", "Món Hoa", "Món Nhật", "Món Tây", "Món Thái", "Món Việt", "Nhạc sống / Live music", "Nhà hàng", "Nướng", "Phòng trà", "Pub", "Quán ăn bình dân", "Quán nhậu", "Tiệm bánh", "Trà Sữa"] },
  { category: "THỜI TRANG", subs: ["Áo cưới - Studio", "Áo dài", "Cho thuê trang phục", "Cosplay", "Đồ bơi", "Đồ cũ", "Đồng hồ", "Giầy dép", "Mẹ và bé", "Mỹ phẩm", "Nam", "Nón, Mũ bảo hiểm", "Nội Y", "Nữ", "Nước hoa", "Phụ kiện", "Quần áo", "Thể thao", "Thêu tay", "Trang sức", "Trẻ em", "Túi xách"] },
  { category: "LÀM ĐẸP - THƯ GIÃN", subs: ["Cắt Tóc", "Dụng cụ làm đẹp", "Massage - Đấm bóp", "Nam", "Nữ", "Phun xăm thẩm mỹ mày, môi, mí", "Salon tóc, gội đầu", "Spa", "Tắm hơi Hàn Quốc", "Tiệm Nails", "Tiệm nối mi", "Tiệm Xăm", "Trang điểm"] },
  { category: "CỬA HÀNG - SIÊU THỊ", subs: ["Bán nguyên vật liệu - dụng cụ làm bánh", "Chợ", "Cửa hàng bia - nước giải khát", "Cửa hàng đồ gia dụng", "Cửa hàng hoa quả - rau củ", "Cửa hàng lương thực", "Cửa hàng nhạc cụ", "Cửa hàng thực phẩm", "Cửa hàng tiện lợi 24h", "Đại lí gas", "Đại lý bia", "Đại lý gạo", "Đại lý gas", "Đại lý nước", "Đại lý nước đá", "Đại lý sim", "Đồ chơi trẻ em", "Đồ điện tử cũ", "Hàng Xuất Khẩu", "Khác", "Nhà may", "Nhập khẩu", "Phụ kiện may", "Quà lưu niệm", "Shop dụng cụ tình yêu", "Shop hoa", "Shop Rượu", "Shop thú cưng", "Siêu thị", "Siêu thị điện máy", "Tạp hóa", "Tẩu điện tử - Tinh dầu", "Thủy hải sản - thịt tươi sống", "Tiệm vải", "Trung tâm thương mại", "VinMart"] },
  { category: "VĂN HÓA - GIẢI TRÍ", subs: ["Bảo tàng", "Bar", "Công viên", "Di tích lịch sử", "Game", "Karaoke", "Khác", "Nhà hát", "Nhà triễn lãm", "Nhà văn hóa", "Phim trường", "Phòng thu âm", "Rạp chiếu phim", "Sạp báo", "Sân khấu kịch", "Sân vận động", "Tiệm Đồ cổ", "Trung tâm hội nghị - Tiệc cưới", "Vui chơi Giải trí"] },
  { category: "THỂ DỤC THỂ THAO", subs: ["Dụng cụ thể thao", "Khác", "Nhà thi đấu", "Phòng tập", "Sân vận động", "Trung tâm Thể dục Thể Thao"] },
];
