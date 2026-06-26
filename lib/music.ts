/**
 * Dữ liệu "Khúc Chạm Store" (nhạc bản quyền) — types + seed nhúng sẵn + helper tách ID YouTube.
 * Module THUẦN (không gọi server) nên import được cả ở client (component) lẫn server (sheet-music).
 *
 * Nguồn động: tab "KhucCham" trong Google Sheet cấu hình (xem lib/sheet-music.ts).
 * Seed dưới đây chỉ là fallback khi sheet rỗng/lỗi/đang tải.
 */

export const ALBUM_PRICE = 999_999; // giá mặc định 1 album khi sheet để trống cột gia_album
export const SONG_PRICE = 199_999; // giá mặc định 1 bài khi sheet để trống cột gia_bai

export type MusicSong = {
  /** videoId YouTube (11 ký tự) — dùng cho thumbnail + embed nghe thử. */
  vid: string;
  title: string;
  /** Giá riêng của bài (đ). Trống → dùng SONG_PRICE. */
  price?: number;
};

export type MusicAlbum = {
  id: string;
  title: string;
  /** playlistId YouTube để link "xem trên YouTube". Có thể trống. */
  playlistId: string;
  /** videoId làm ảnh bìa album. Trống → lấy bài đầu tiên. */
  cover: string;
  /** Giá riêng của album (đ). Trống → dùng ALBUM_PRICE. */
  price?: number;
  songs: MusicSong[];
};

/** Tách videoId từ link YouTube đủ kiểu (watch?v= · youtu.be/ · /embed/ · /shorts/) hoặc trả nguyên ID. */
export function ytVideoId(raw: string): string {
  const s = (raw || "").trim();
  if (!s) return "";
  const m = s.match(/(?:v=|\/embed\/|youtu\.be\/|\/shorts\/|\/v\/)([A-Za-z0-9_-]{11})/);
  if (m) return m[1];
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s; // đã là ID
  return s; // fallback: giữ nguyên (phòng khi định dạng lạ)
}

/** Tách playlistId từ link (…?list=ID) hoặc trả nguyên ID. */
export function ytPlaylistId(raw: string): string {
  const s = (raw || "").trim();
  const m = s.match(/[?&]list=([A-Za-z0-9_-]+)/);
  if (m) return m[1];
  return s;
}

/** Slug đơn giản (không dấu) để làm id album ổn định khi sheet không cho sẵn. */
export function musicSlug(s: string): string {
  return (s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "album";
}

export const thumbUrl = (vid: string) => `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`;
export const playlistUrl = (pid: string) => `https://www.youtube.com/playlist?list=${pid}`;
export const moneyVnd = (n: number) => n.toLocaleString("vi-VN") + "đ";

/** Seed = đúng 3 album lấy thật từ https://www.youtube.com/@KhucChamChannel/playlists (fallback). */
export const SEED_MUSIC: MusicAlbum[] = [
  {
    id: "mua-he-soi-dong-2026",
    playlistId: "PLYa2nhvOT4LA",
    title: 'Album "Mùa Hè Sôi Động 2026"',
    cover: "k47rkLLuDlg",
    songs: [
      { vid: "L5VrXT4QtZE", title: "Mùa Hè Sôi Động 2026 | Khúc Chạm Summer Playlist | Vincent Phan" },
      { vid: "aKNusg0Fh7w", title: "One Touch | Khúc Chạm | Vincent Phan (MV Lyric)" },
      { vid: "iFzN-AeQl2M", title: "Khúc Chạm | Vincent Phan (MV Lyric)" },
      { vid: "iEEP8H6nnVk", title: "Pelota de Paz | Khúc Chạm | Vincent Phan (MV Lyric)" },
      { vid: "ayV4zBEtj0U", title: "Bóng Đá Và Hòa Bình | Khúc Chạm | Vincent Phan (MV Lyric)" },
      { vid: "k47rkLLuDlg", title: "Mùa Hè Sôi Động 2026 | Khúc Chạm | Vincent Phan (MV Lyric)" },
    ],
  },
  {
    id: "video-short-mua-he-soi-dong",
    playlistId: "PL03y9OdRdBwZkLHzbUfMAyhcreXy92su9",
    title: 'Album Video Short "Mùa Hè Sôi Động"',
    cover: "rRZsSbzqOYI",
    songs: [
      { vid: "rRZsSbzqOYI", title: "Cùng lắng nghe ca khúc chủ đề của Album Khúc Chạm nhé" },
      { vid: "bEIuHiPJPpc", title: "Nếu World Cup 2026 Có Một Bài Hát Về Hòa Bình | Pelota de Paz | Khúc Chạm" },
      { vid: "_uGn-pDrFpk", title: "Có ai cứ đến mùa World Cup là tự nhiên thấy mùa hè vui hơn không? ⚽☀️" },
      { vid: "xe0pPfWAu5M", title: "Bóng Đá Và Hòa Bình | Khi trái bóng lăn, mọi khoảng cách biến mất" },
    ],
  },
  {
    id: "du-bao-thoi-tiet-loi-nhan-yeu-thuong",
    playlistId: "PL03y9OdRdBwZtfMVnGn32AM934J5fMz6p",
    title: 'Album "Dự Báo Thời Tiết & Lời Nhắn Yêu Thương"',
    cover: "B7QWA7X8vH0",
    songs: [
      { vid: "B7QWA7X8vH0", title: "[ Bản Tin ] Dự Báo Thời Tiết 19.06.2026 | Khúc Chạm" },
    ],
  },
];
