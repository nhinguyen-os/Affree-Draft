import { SEED_MUSIC, musicSlug, ytPlaylistId, ytVideoId, type MusicAlbum } from "./music";

/**
 * Khúc Chạm Store — đọc tab "KhucCham" trong sheet cấu hình 1sZTv (dò theo TÊN tab, không cần gid).
 *
 * Mỗi DÒNG = 1 BÀI HÁT. Các dòng cùng tên `album` được gom lại thành 1 album, giữ thứ tự nhập.
 * Cột (không phân biệt hoa thường, chỉ cần CHỨA từ khoá):
 *   album        — tên album (bắt buộc)
 *   playlist     — link/ID playlist YouTube của album (tuỳ chọn; điền 1 dòng là đủ)
 *   bia          — link/ID video làm ảnh bìa album (tuỳ chọn; trống → lấy bài đầu)
 *   gia_album    — giá album, đ (tuỳ chọn; trống → 999999)
 *   video        — link/ID video YouTube của bài (bắt buộc)
 *   ten_bai      — tên bài hát
 *   gia_bai      — giá 1 bài, đ (tuỳ chọn; trống → 199999)
 *   an           — đánh "x"/"1" để ẩn dòng (tuỳ chọn)
 *
 * Tab rỗng/lỗi → fallback SEED_MUSIC (3 album nhúng sẵn) để store vẫn hiển thị.
 */
export const MUSIC_SHEET_CSV_URL =
  process.env.MUSIC_SHEET_CSV_URL ||
  `https://docs.google.com/spreadsheets/d/1sZTv7FHGEq6V_d8wiFKd-7cVFjpURUcAeDPVI_1WiJo/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(
    "KhucCham",
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

/** Parse CSV tab "KhucCham" → MusicAlbum[]. */
export function parseMusicCsv(csv: string): MusicAlbum[] {
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
    album: col("album", "ten_album", "tên album"),
    playlist: col("playlist", "list"),
    cover: col("bia", "bìa", "cover", "anh_bia"),
    giaAlbum: col("gia_album", "giá album", "gia album"),
    video: col("video", "link_bai", "link bài", "url", "youtube"),
    ten: col("ten_bai", "tên bài", "ten bai", "ten_sp", "tên"),
    giaBai: col("gia_bai", "giá bài", "gia bai"),
    an: col("an", "ẩn", "hide", "off"),
  };
  if (ci.album < 0 || ci.video < 0) return []; // thiếu cột bắt buộc → coi như chưa có dữ liệu

  const map = new Map<string, MusicAlbum>();
  const order: string[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const albumName = (r[ci.album] || "").trim();
    const vidRaw = ci.video >= 0 ? (r[ci.video] || "").trim() : "";
    if (!albumName || !vidRaw) continue;
    if (ci.an >= 0 && /^(x|1|true|có|co|yes|ẩn|an|off)$/i.test((r[ci.an] || "").trim())) continue;

    let al = map.get(albumName);
    if (!al) {
      al = { id: musicSlug(albumName), title: albumName, playlistId: "", cover: "", songs: [] };
      map.set(albumName, al);
      order.push(albumName);
    }
    // Trường cấp album: lấy từ dòng đầu tiên có giá trị.
    if (!al.playlistId && ci.playlist >= 0) al.playlistId = ytPlaylistId(r[ci.playlist] || "");
    if (!al.cover && ci.cover >= 0) al.cover = ytVideoId(r[ci.cover] || "");
    if (al.price == null && ci.giaAlbum >= 0) {
      const g = num(r[ci.giaAlbum]);
      if (g) al.price = g;
    }

    al.songs.push({
      vid: ytVideoId(vidRaw),
      title: ci.ten >= 0 ? (r[ci.ten] || "").trim() : "",
      price: ci.giaBai >= 0 ? num(r[ci.giaBai]) || undefined : undefined,
    });
  }

  // Bìa mặc định = bài đầu; bỏ album không có bài.
  const albums = order.map((n) => map.get(n)!).filter((a) => a.songs.length > 0);
  for (const a of albums) if (!a.cover) a.cover = a.songs[0].vid;
  return albums;
}

/** Tải album nhạc: tab "KhucCham" → SEED_MUSIC. */
export async function fetchMusicAlbums(revalidate = 120): Promise<MusicAlbum[]> {
  try {
    const res = await fetch(MUSIC_SHEET_CSV_URL, { next: { revalidate } });
    if (res.ok) {
      const parsed = parseMusicCsv(await res.text());
      if (parsed.length) return parsed;
    }
  } catch {
    // rơi xuống seed
  }
  return SEED_MUSIC;
}
