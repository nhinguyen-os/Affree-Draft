"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ALBUM_PRICE,
  SONG_PRICE,
  SEED_MUSIC,
  moneyVnd,
  playlistUrl,
  thumbUrl,
  type MusicAlbum,
  type MusicSong,
} from "@/lib/music";

/**
 * Khúc Chạm — nhạc bản quyền của @KhucChamChannel.
 *  • Lưới thẻ ALBUM (playlist) — mặc định 999.999đ/album.
 *  • Bấm "Xem N bài" trên thẻ album → mở TRANG CHI TIẾT (overlay toàn màn): danh sách
 *    CARD BÀI HÁT xếp theo CHIỀU DỌC, mỗi bài là 1 card sản phẩm riêng (nghe thử · + · Mua ngay).
 *  • "Nghe thử" → nhúng embed YouTube trong popup.
 *
 * Dữ liệu đọc động từ tab "KhucCham" (Google Sheet) qua /api/music; lỗi → SEED_MUSIC nhúng sẵn.
 */

export type MusicBuyItem = {
  /** id ổn định để gộp trong giỏ (kc-<videoId> hoặc kc-album-<slug>). */
  id: string;
  name: string;
  image: string;
  price: number;
};

// Đổ bóng mép kính cho carousel album (đồng bộ thẻ sản phẩm ở trang chủ): blur mỏng/nhẹ trên
// mobile, dày/đậm hơn ở sm+. Không veil trắng vì thẻ nằm trên nền section.
const EDGE_BLUR_RIGHT =
  "pointer-events-none absolute inset-y-0 right-0 z-[5] w-6 sm:w-12 backdrop-blur-[2px] sm:backdrop-blur-[5px] [mask-image:linear-gradient(to_left,#000,transparent)] [-webkit-mask-image:linear-gradient(to_left,#000,transparent)]";

type Props = {
  t: (s: string) => string;
  /** Nút "+" → thêm album/bài vào giỏ hàng chung. */
  onBuy: (item: MusicBuyItem) => void;
  /** Nút "Mua ngay"/"Mua bài" → mở màn agentic (giống thẻ sản phẩm). */
  onBuyNow: (item: MusicBuyItem) => void;
  /** false = carousel 1 hàng (mặc định); true = lưới đầy đủ ("Xem tất cả"). */
  showAll?: boolean;
  /** Chiều cao header app (để overlay trang chi tiết nằm DƯỚI header cố định, không che nó). */
  headerH?: number;
  /** Album đang mở (id) — điều khiển từ ngoài để sync URL /nhac/<id>. */
  detailId?: string | null;
  /** Đổi album đang mở (null = đóng) → cha cập nhật URL. Có truyền = chế độ "controlled". */
  onDetailChange?: (id: string | null) => void;
};

export function KhucChamAlbumList({ t, onBuy, onBuyNow, showAll = false, headerH = 0, detailId, onDetailChange }: Props) {
  const [albums, setAlbums] = useState<MusicAlbum[]>(SEED_MUSIC);
  // Bài đang nghe thử (popup embed). null = đóng.
  const [preview, setPreview] = useState<MusicSong | null>(null);
  // Album đang mở TRANG CHI TIẾT. Controlled (theo URL) nếu cha truyền onDetailChange,
  // ngược lại dùng state cục bộ.
  const [detailLocal, setDetailLocal] = useState<MusicAlbum | null>(null);
  const controlled = onDetailChange != null;
  const detail = controlled
    ? (detailId ? albums.find((a) => a.id === detailId) ?? null : null)
    : detailLocal;
  const openDetail = (al: MusicAlbum | null) => {
    if (controlled) onDetailChange!(al?.id ?? null);
    else setDetailLocal(al);
  };
  // Đổ bóng mép carousel — chỉ hiện khi còn cuộn được hướng đó (thẻ đầu/cuối không bị nhòe khi chưa cuộn).
  const rowRef = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });
  const updateEdges = useCallback(() => {
    const el = rowRef.current;
    if (!el) return;
    setEdges({ left: el.scrollLeft > 4, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 4 });
  }, []);

  useEffect(() => {
    let alive = true;
    fetch("/api/music")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (alive && data?.albums?.length) setAlbums(data.albums as MusicAlbum[]);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  // Vào trang chi tiết → cuộn lên đầu cho giống "sang trang mới".
  useEffect(() => {
    if (detail) window.scrollTo({ top: 0, behavior: "auto" });
  }, [detail]);

  // Cập nhật bóng mép theo kích thước/nội dung carousel (chỉ ở chế độ carousel).
  useEffect(() => {
    if (showAll) return;
    updateEdges();
    const el = rowRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(updateEdges);
    ro.observe(el);
    return () => ro.disconnect();
  }, [showAll, albums, updateEdges]);

  const albumPrice = (al: MusicAlbum) => al.price ?? ALBUM_PRICE;
  const songPrice = (s: MusicSong) => s.price ?? SONG_PRICE;
  const albumItem = (al: MusicAlbum): MusicBuyItem => ({ id: `kc-album-${al.id}`, name: `${t("Album")}: ${al.title}`, image: thumbUrl(al.cover), price: albumPrice(al) });
  const songItem = (s: MusicSong): MusicBuyItem => ({ id: `kc-${s.vid}`, name: s.title, image: thumbUrl(s.vid), price: songPrice(s) });

  // Tất cả bài hát (gộp từ mọi album, bỏ trùng theo videoId) → mỗi bài 1 CARD RIÊNG ở
  // section chính để mua lẻ trực tiếp, không cần vào trang album.
  const allSongs = useMemo(() => {
    const seen = new Set<string>();
    const out: MusicSong[] = [];
    for (const al of albums) for (const s of al.songs) {
      if (seen.has(s.vid)) continue;
      seen.add(s.vid);
      out.push(s);
    }
    return out;
  }, [albums]);

  // Layout: mặc định carousel 1 hàng (cuộn ngang); "Xem tất cả" → lưới đầy đủ. Album & bài
  // nằm CHUNG 1 container nên hiển thị cùng 1 hàng.
  const containerCls = showAll
    ? "grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4"
    : "flex gap-3 overflow-x-auto scroll-smooth px-0.5 py-3 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden";
  const cardW = showAll ? "w-full" : "w-44 shrink-0 sm:w-48";

  return (
    <>
      {/* ALBUM + BÀI HÁT — cùng 1 hàng (carousel) hoặc lưới khi "Xem tất cả" */}
      <div className="relative">
        {/* Chỉ blur mép PHẢI (gợi ý cuộn →); không blur mép trái để thẻ đầu không mờ góc. */}
        {!showAll && edges.right && <div className={EDGE_BLUR_RIGHT} />}
        <div ref={rowRef} onScroll={showAll ? undefined : updateEdges} className={containerCls}>
        {albums.filter((al) => !al.single).map((al) => {
          const price = albumPrice(al);
          return (
            <div
              key={al.id}
              className={`group relative flex h-full ${cardW} flex-col rounded-2xl bg-white p-3 text-left ring-1 ring-black/[0.06] shadow-[0_4px_14px_-6px_rgba(15,23,42,0.16),0_2px_5px_-3px_rgba(15,23,42,0.10)] transition duration-200 hover:-translate-y-1 hover:shadow-[0_14px_30px_-10px_rgba(15,23,42,0.24),0_5px_12px_-4px_rgba(15,23,42,0.14)]`}
            >
              <div className="mb-2 flex flex-wrap items-start gap-1">
                <span className="rounded-md bg-orange-100 px-1.5 py-0.5 text-[10px] font-bold text-orange-700 shadow-sm">🎵 {t("Album")}</span>
                <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-500">{al.songs.length} {t("bài")}</span>
              </div>

              {/* Ảnh bìa — bấm để nghe thử bài đầu */}
              <button
                type="button"
                onClick={() => al.songs[0] && setPreview(al.songs[0])}
                className="relative flex aspect-square w-full items-center justify-center overflow-hidden rounded-lg bg-slate-50"
                aria-label={`${t("Nghe thử")} ${al.title}`}
                title={t("Nghe thử")}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={thumbUrl(al.cover)} alt={al.title} className="h-full w-full object-cover" loading="lazy" />
                <span className="absolute inset-0 flex items-center justify-center bg-black/15 text-2xl text-white opacity-90 transition group-hover:bg-black/35">▶</span>
                <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1.5 py-0.5 text-[9px] font-medium text-white">{t("Nghe thử")}</span>
              </button>

              {al.playlistId ? (
                <a href={playlistUrl(al.playlistId)} target="_blank" rel="noopener noreferrer" className="mt-2 line-clamp-2 min-h-[2.5rem] text-sm font-medium leading-snug text-slate-800 hover:text-orange-700" title={al.title}>{al.title}</a>
              ) : (
                <span className="mt-2 line-clamp-2 min-h-[2.5rem] text-sm font-medium leading-snug text-slate-800" title={al.title}>{al.title}</span>
              )}
              <span className="mt-0.5 truncate text-xs text-slate-400">Khúc Chạm · {al.songs.length} {t("bài")}</span>

              <span className="mt-1.5 inline-flex items-center gap-1 text-base font-bold text-rose-600">
                <svg className="shrink-0 text-rose-500" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20.59 13.41 13.42 20.6a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82Z" /><circle cx="7" cy="7" r="1.2" fill="currentColor" /></svg>
                {moneyVnd(price)}
              </span>

              {/* Xem từng bài → SANG TRANG CHI TIẾT (card bài dọc) */}
              <button
                type="button"
                onClick={() => openDetail(al)}
                className="mt-1 inline-flex items-center gap-1 self-start text-[11px] font-semibold text-orange-700 transition hover:text-orange-800"
              >
                {t("Xem {n} bài").replace("{n}", String(al.songs.length))} <span aria-hidden>→</span>
              </button>

              {/* + / Mua ngay (mua cả album) */}
              <span className="mt-auto block w-full pt-2.5">
                <span className="flex gap-1">
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={() => onBuy(albumItem(al))}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onBuy(albumItem(al)); }}
                    className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-slate-200 bg-amber-50 text-lg font-bold text-amber-600 hover:bg-amber-100"
                    aria-label={t("Thêm album vào giỏ")}
                    title={t("Thêm album vào giỏ")}
                  >
                    +
                  </span>
                  <span
                    onClick={() => onBuyNow(albumItem(al))}
                    className="flex flex-1 cursor-pointer items-center justify-center rounded-lg border border-slate-200 bg-amber-500 py-2 text-xs font-semibold text-white transition-colors duration-200 group-hover:bg-amber-600"
                  >
                    {t("Mua ngay")}
                  </span>
                </span>
              </span>
            </div>
          );
        })}
        {/* Card BÀI HÁT lẻ — cùng hàng với album */}
        {allSongs.map((s) => (
          <div
            key={`song-${s.vid}`}
            className={`group relative flex h-full ${cardW} flex-col rounded-2xl bg-white p-3 text-left ring-1 ring-black/[0.06] shadow-[0_4px_14px_-6px_rgba(15,23,42,0.16),0_2px_5px_-3px_rgba(15,23,42,0.10)] transition duration-200 hover:-translate-y-1 hover:shadow-[0_14px_30px_-10px_rgba(15,23,42,0.24),0_5px_12px_-4px_rgba(15,23,42,0.14)]`}
          >
                <div className="mb-2 flex flex-wrap items-start gap-1">
                  <span className="rounded-md bg-pink-100 px-1.5 py-0.5 text-[10px] font-bold text-pink-700 shadow-sm">🎵 {t("Bài hát")}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setPreview(s)}
                  className="relative flex aspect-square w-full items-center justify-center overflow-hidden rounded-lg bg-slate-50"
                  aria-label={`${t("Nghe thử")} ${s.title}`}
                  title={t("Nghe thử")}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={thumbUrl(s.vid)} alt={s.title} className="h-full w-full object-cover" loading="lazy" />
                  <span className="absolute inset-0 flex items-center justify-center bg-black/15 text-2xl text-white opacity-90 transition group-hover:bg-black/35">▶</span>
                  <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1.5 py-0.5 text-[9px] font-medium text-white">{t("Nghe thử")}</span>
                </button>
                <span className="mt-2 line-clamp-2 min-h-[2.5rem] text-sm font-medium leading-snug text-slate-800" title={s.title}>{s.title}</span>
                <span className="mt-0.5 truncate text-xs text-slate-400">Khúc Chạm · {t("Bài hát")}</span>
                <span className="mt-1.5 inline-flex items-center gap-1 text-base font-bold text-rose-600">
                  <svg className="shrink-0 text-rose-500" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20.59 13.41 13.42 20.6a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82Z" /><circle cx="7" cy="7" r="1.2" fill="currentColor" /></svg>
                  {moneyVnd(songPrice(s))}
                </span>
                {/* Placeholder cân chiều cao với dòng "Xem N bài" của thẻ album → 2 thẻ thẳng hàng nút */}
                <span className="mt-1 block h-[18px]" aria-hidden />
                <span className="mt-auto block w-full pt-2.5">
                  <span className="flex gap-1">
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={() => onBuy(songItem(s))}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onBuy(songItem(s)); }}
                      className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-slate-200 bg-amber-50 text-lg font-bold text-amber-600 hover:bg-amber-100"
                      aria-label={t("Thêm bài vào giỏ")}
                      title={t("Thêm bài vào giỏ")}
                    >
                      +
                    </span>
                    <span
                      onClick={() => onBuyNow(songItem(s))}
                      className="flex flex-1 cursor-pointer items-center justify-center rounded-lg border border-slate-200 bg-amber-500 py-2 text-xs font-semibold text-white transition-colors duration-200 group-hover:bg-amber-600"
                    >
                      {t("Mua ngay")}
                    </span>
                  </span>
                </span>
          </div>
        ))}
        </div>
      </div>

      {/* TRANG CHI TIẾT ALBUM — overlay nằm DƯỚI header cố định (top=headerH, z thấp hơn
          header 2100), card bài hát xếp DỌC. Nhờ vậy thanh Affree trên cùng vẫn hiển thị. */}
      {detail && (
        <div className="fixed inset-x-0 bottom-0 z-[2050] overflow-y-auto bg-slate-50" style={{ top: headerH || 64 }}>
          <div className="mx-auto w-full max-w-2xl px-4 pb-10">
            {/* Thanh trên: quay lại */}
            <div className="sticky top-0 z-10 -mx-4 flex items-center gap-2 border-b border-slate-200 bg-slate-50/95 px-4 py-3 backdrop-blur">
              <button
                type="button"
                onClick={() => openDetail(null)}
                className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-200"
              >
                <span aria-hidden>←</span> {t("Quay lại")}
              </button>
              <span className="truncate text-sm font-medium text-slate-500">{t("Bài hát trong album")}</span>
            </div>

            {/* Header album */}
            <div className="mt-4 flex gap-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={thumbUrl(detail.cover)} alt={detail.title} className="h-28 w-28 shrink-0 rounded-xl object-cover ring-1 ring-slate-200" loading="lazy" />
              <div className="min-w-0 flex-1">
                <span className="rounded-md bg-orange-100 px-1.5 py-0.5 text-[10px] font-bold text-orange-700">🎵 {t("Album")}</span>
                <h3 className="mt-1.5 line-clamp-2 text-lg font-bold text-slate-900">{detail.title}</h3>
                <p className="text-xs text-slate-500">Khúc Chạm · {detail.songs.length} {t("bài")}</p>
                <div className="mt-2 flex items-center gap-2">
                  <span className="text-base font-bold text-rose-600">{moneyVnd(albumPrice(detail))}</span>
                  <button type="button" onClick={() => onBuyNow(albumItem(detail))} className="rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-amber-600">{t("Mua cả album")}</button>
                  <button type="button" onClick={() => onBuy(albumItem(detail))} className="rounded-lg border border-slate-200 bg-amber-50 px-2.5 py-1.5 text-sm font-bold text-amber-600 transition hover:bg-amber-100" aria-label={t("Thêm album vào giỏ")} title={t("Thêm album vào giỏ")}>+</button>
                </div>
              </div>
            </div>

            {/* DANH SÁCH BÀI — nghe thử + giá + mua lẻ từng bài (hoặc mua nguyên album ở trên) */}
            <p className="mt-5 mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">{t("Danh sách bài hát")}</p>
            <div className="space-y-2.5">
              {detail.songs.map((s, i) => (
                <div
                  key={s.vid}
                  className="flex w-full items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 text-left transition hover:border-orange-300 hover:bg-orange-50/40"
                >
                  <button
                    type="button"
                    onClick={() => setPreview(s)}
                    className="group/song relative aspect-video w-24 shrink-0 overflow-hidden rounded-lg ring-1 ring-slate-200 sm:w-32"
                    aria-label={`${t("Nghe thử")} ${s.title}`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={thumbUrl(s.vid)} alt={s.title} className="h-full w-full object-cover" loading="lazy" />
                    <span className="absolute inset-0 flex items-center justify-center bg-black/20 text-lg text-white opacity-90 transition group-hover/song:bg-black/45">▶</span>
                    <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1.5 py-0.5 text-[9px] font-medium text-white">{t("Nghe thử")}</span>
                  </button>
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="flex items-start gap-2">
                      <span className="mt-0.5 shrink-0 text-xs font-semibold text-slate-400">{i + 1}.</span>
                      <span className="line-clamp-2 text-sm font-medium leading-snug text-slate-800">{s.title}</span>
                    </span>
                  </div>
                  {/* Mua nhạc theo TRỌN ALBUM (nút ở header) — từng bài chỉ để nghe thử. */}
                  <button
                    type="button"
                    onClick={() => setPreview(s)}
                    className="shrink-0 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-[11px] font-bold text-slate-700 transition hover:border-orange-300 hover:bg-orange-50 hover:text-orange-700 active:scale-95"
                  >
                    ▶ {t("Nghe thử")}
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Popup nghe thử — embed YouTube */}
      {preview && (
        <div className="fixed inset-0 z-[2300] flex items-center justify-center p-4" role="dialog" aria-modal="true" onClick={() => setPreview(null)}>
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          <div className="relative w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
            <button type="button" onClick={() => setPreview(null)} aria-label={t("Đóng")} className="absolute -top-9 right-0 flex h-8 w-8 items-center justify-center rounded-full bg-white/90 text-slate-700 shadow transition hover:bg-white">✕</button>
            <div className="overflow-hidden rounded-2xl bg-black shadow-2xl ring-1 ring-white/20">
              <div className="relative aspect-video w-full">
                <iframe
                  key={preview.vid}
                  src={`https://www.youtube.com/embed/${preview.vid}?rel=0&autoplay=1`}
                  title={`${t("Nghe thử")} — ${preview.title}`}
                  className="absolute inset-0 h-full w-full"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  referrerPolicy="strict-origin-when-cross-origin"
                  allowFullScreen
                />
              </div>
              <div className="flex items-center gap-2 px-3 py-2.5">
                <p className="min-w-0 flex-1 truncate text-[12px] font-semibold text-white">{preview.title}</p>
                <button type="button" onClick={() => onBuyNow(songItem(preview))} className="shrink-0 rounded-full bg-pink-500 px-3 py-1.5 text-[11px] font-bold text-white transition hover:bg-pink-600 active:scale-95">{t("Mua bài")} · {moneyVnd(songPrice(preview))}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default KhucChamAlbumList;
