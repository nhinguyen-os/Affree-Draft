import type { Tui } from "./types";
import { SEED_TUI } from "./seed-tui";

// Túi ghép/đôi/đa dạng — đọc tab "Tui" trong sheet cấu hình 1sZTv (dò theo TÊN tab, không cần gid).
// Cột: chuyen_trang · ten_tui · ma_tui · loai · so_sp · gia_combo · da_chain · product_id · ten_sp · gia_sp · chain.
// Tab rỗng/lỗi → fallback SEED_TUI (21 túi nhúng sẵn) để vẫn hiển thị được mục Túi.
export const TUI_SHEET_CSV_URL =
  process.env.TUI_SHEET_CSV_URL ||
  `https://docs.google.com/spreadsheets/d/1sZTv7FHGEq6V_d8wiFKd-7cVFjpURUcAeDPVI_1WiJo/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(
    "Tui",
  )}`;

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

const num = (s: string) => parseInt((s || "").replace(/[^\d]/g, ""), 10) || 0;

/** Parse CSV tab "Tui" → Tui[]. Gom nhiều dòng (mỗi dòng = 1 SP thành viên) theo (chuyên trang + mã túi). */
export function parseTuiCsv(csv: string): Tui[] {
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
    ct: col("chuyen_trang", "chuyên trang", "chuyen trang"),
    ten: col("ten_tui", "tên túi", "ten tui"),
    ma: col("ma_tui", "mã túi", "ma tui"),
    loai: col("loai", "loại"),
    gia: col("gia_combo", "giá combo", "gia combo"),
    da: col("da_chain", "đa chain", "da chain"),
    pid: col("product_id", "sku", "mã sp"),
    sp: col("ten_sp", "tên sp", "ten sp"),
    giaSp: col("gia_sp", "giá sp", "gia sp"),
    chain: col("chain", "chuỗi", "chuoi"),
  };
  if (ci.ten < 0 || ci.pid < 0) return [];

  const map = new Map<string, Tui>();
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const ten = (r[ci.ten] || "").trim();
    const pid = (r[ci.pid] || "").trim();
    if (!ten || !pid) continue;
    const ct = ci.ct >= 0 ? (r[ci.ct] || "").trim() : "";
    const ma = ci.ma >= 0 ? (r[ci.ma] || "").trim() : "";
    const key = `${ct}|${ma}|${ten}`;
    let t = map.get(key);
    if (!t) {
      t = {
        maTui: ma,
        tenTui: ten,
        chuyenTrang: ct,
        loai: ci.loai >= 0 ? (r[ci.loai] || "").trim() : "",
        giaCombo: ci.gia >= 0 ? num(r[ci.gia]) : 0,
        daChain: ci.da >= 0 ? /^(1|true|x|có|co|yes)$/i.test((r[ci.da] || "").trim()) : false,
        items: [],
      };
      map.set(key, t);
    }
    t.items.push({
      productId: pid,
      name: ci.sp >= 0 ? (r[ci.sp] || "").trim() : "",
      gia: ci.giaSp >= 0 ? num(r[ci.giaSp]) : 0,
      chain: ci.chain >= 0 ? (r[ci.chain] || "").trim() : "",
    });
  }
  // Bù giá combo nếu sheet để trống = tổng giá thành viên; đa chain nếu item khác chain.
  for (const t of map.values()) {
    if (!t.giaCombo) t.giaCombo = t.items.reduce((s, it) => s + it.gia, 0);
    if (!t.daChain) t.daChain = new Set(t.items.map((it) => it.chain).filter(Boolean)).size > 1;
  }
  return [...map.values()];
}

// Cho phép gom túi NGAY trong tab "SanPham" (1sZTv, gid=0) — chỉ cần thêm 2 cột:
//   tui   (tên túi)            → các dòng cùng tên túi gom thành 1 card
//   loai  (TĐG | T2 | TĐD)     → badge + nhóm
// Cột sẵn có: danh_muc · product_id · ten. Giá combo bỏ trống → web tự cộng giá thành viên.
export const SANPHAM_CSV_URL =
  process.env.SANPHAM_OVERRIDE_CSV_URL ||
  "https://docs.google.com/spreadsheets/d/1sZTv7FHGEq6V_d8wiFKd-7cVFjpURUcAeDPVI_1WiJo/export?format=csv&gid=0";

/** Gom các dòng SanPham có cột "tui" thành Tui[] (giá để route/page tự điền từ catalog). */
export function parseTuiFromSanPham(csv: string): Tui[] {
  const rows = splitCsv(csv).filter((r) => r.some((c) => c.trim() !== ""));
  if (rows.length < 2) return [];
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = (...keys: string[]) => {
    for (let i = 0; i < header.length; i++) if (keys.some((k) => header[i].includes(k))) return i;
    return -1;
  };
  const ci = {
    danhMuc: col("danh_muc", "danh mục", "danh muc"),
    pid: col("product_id", "sku", "mã sp"),
    sp: col("ten_sp", "tên sp", "ten "),
    tui: col("tui", "túi", "ten_tui", "tên túi"),
    loai: col("loai", "loại"),
    ct: col("chuyen_trang", "chuyên trang", "chuyen trang"),
    gia: col("gia_combo", "giá combo"),
  };
  if (ci.tui < 0 || ci.pid < 0) return []; // chưa có cột "tui" → không phải nguồn túi
  const tenIdx = ci.sp >= 0 ? ci.sp : header.findIndex((h) => h.includes("ten"));

  const map = new Map<string, Tui>();
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const tui = (r[ci.tui] || "").trim();
    const pid = (r[ci.pid] || "").trim();
    if (!tui || !pid) continue;
    const dm = ci.danhMuc >= 0 ? (r[ci.danhMuc] || "").trim() : "";
    const key = `${dm}|${tui}`;
    let t = map.get(key);
    if (!t) {
      t = {
        maTui: "",
        tenTui: tui,
        chuyenTrang: ci.ct >= 0 ? (r[ci.ct] || "").trim() : dm,
        loai: ci.loai >= 0 ? (r[ci.loai] || "").trim() : "",
        giaCombo: ci.gia >= 0 ? num(r[ci.gia]) : 0,
        daChain: false,
        items: [],
      };
      map.set(key, t);
    }
    if (t.items.some((it) => it.productId === pid)) continue; // dedup SP trong cùng túi
    t.items.push({ productId: pid, name: tenIdx >= 0 ? (r[tenIdx] || "").trim() : "", gia: 0, chain: "" });
  }
  return [...map.values()];
}

/** Tải túi: ưu tiên tab "SanPham" (có cột tui) → tab "Tui" → SEED_TUI. */
export async function fetchTui(revalidate = 300): Promise<Tui[]> {
  // 1) Gom từ SanPham nếu đã thêm cột "tui".
  try {
    const res = await fetch(SANPHAM_CSV_URL, { next: { revalidate } });
    if (res.ok) {
      const fromSP = parseTuiFromSanPham(await res.text());
      if (fromSP.length) return fromSP;
    }
  } catch {
    // bỏ qua, thử nguồn kế
  }
  // 2) Tab "Tui" riêng.
  try {
    const res = await fetch(TUI_SHEET_CSV_URL, { next: { revalidate } });
    if (res.ok) {
      const parsed = parseTuiCsv(await res.text());
      if (parsed.length) return parsed;
    }
  } catch {
    // rơi xuống seed
  }
  // 3) Seed nhúng sẵn.
  return SEED_TUI;
}
