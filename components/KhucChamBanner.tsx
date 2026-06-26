"use client";

import { useState } from "react";

/**
 * Banner "Khúc Chạm Channel" — bố cục theo Miro Update 26/06/2026:
 *  • Avatar tròn cam + nốt nhạc (animate-note-bounce, animate-note-pulse)
 *  • Tên kênh "Khúc Chạm Channel"
 *  • Hàng 4 pill: "Âm nhạc và dự báo thời tiết" · "Album Mùa Hè Sôi Động 2026" (CHẠY CHỮ)
 *    · "Gửi lời yêu thương" · "Gửi đề nghị nhận nhạc bản quyền & khai thác thương mại"
 *  • Embed YouTube Music của @KhucChamChannel (click toàn banner → driven sang trang đích)
 */
const YT_CHANNEL = "https://music.youtube.com/@KhucChamChannel";
/** Video ID YouTube thường (embed được, phát nhạc bản quyền). */
const VID_ALBUM = "k47rkLLuDlg";   // Album Mùa Hè Sôi Động
const VID_WEATHER = "B7QWA7X8vH0"; // Âm nhạc và dự báo thời tiết
const EMBED_VIDEO_ID = VID_ALBUM;

type Props = {
  t: (s: string) => string;
  /** Trang đích override (vd. test). Mặc định = channel YouTube Music của Khúc Chạm. */
  landingUrl?: string;
  onSendLove?: () => void;
  onLicense?: () => void;
};

export function KhucChamBanner({ t, landingUrl = YT_CHANNEL, onSendLove, onLicense }: Props) {
  const albumTitle = t("Album Mùa Hè Sôi Động 2026");
  // 2 bản nối nhau → marquee mượt khi kéo -50%.
  const marqueeRun = (
    <span className="flex shrink-0 items-center gap-6 pr-6">
      <span>{albumTitle}</span>
      <span className="text-pink-500">♪</span>
      <span>{albumTitle}</span>
      <span className="text-pink-500">♪</span>
    </span>
  );

  const openChannel = () => {
    if (typeof window !== "undefined") window.open(landingUrl, "_blank", "noopener,noreferrer");
  };

  return (
    <section
      className="relative mt-3 mb-3 overflow-hidden rounded-2xl border-2 border-slate-200 bg-white p-3 shadow-sm sm:p-4"
      aria-label={`${t("Khúc Chạm Channel")} — ${albumTitle}`}
    >
      {/* Hàng 1: avatar nhảy + tên kênh + 4 pill */}
      <div className="flex flex-wrap items-center gap-2 sm:gap-3">
        {/* Avatar tròn cam — nốt nhạc nhảy + đập */}
        <button
          type="button"
          onClick={openChannel}
          aria-label={t("Mở Khúc Chạm Channel")}
          className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-orange-400 to-amber-500 shadow-sm ring-1 ring-orange-300 transition hover:scale-105"
        >
          <span className="animate-note-bounce text-xl text-white drop-shadow-sm">♪</span>
          {/* Nốt phụ "đập đập" ngoài rìa avatar */}
          <span className="animate-note-pulse pointer-events-none absolute -right-1 -top-1 text-xs text-pink-500" aria-hidden="true">♫</span>
        </button>

        {/* Tên kênh */}
        <h3 className="shrink-0 text-sm font-bold tracking-tight text-slate-800 sm:text-base">
          {t("Khúc Chạm Channel")}
        </h3>

        {/* 4 pill — wrap xuống hàng mới ở mobile */}
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <a
            href={landingUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-full border border-slate-300 bg-white px-3 py-1 text-[11px] font-medium text-slate-700 transition hover:border-emerald-400 hover:bg-emerald-50 hover:text-emerald-700"
          >
            {t("Âm nhạc và dự báo thời tiết")}
          </a>

          {/* Pill "Album Mùa Hè Sôi Động 2026" — CHẠY CHỮ */}
          <a
            href={landingUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="group flex max-w-[180px] items-center overflow-hidden rounded-full border border-pink-300 bg-pink-50 px-3 py-1 text-[11px] font-semibold text-pink-700 transition hover:border-pink-400 hover:bg-pink-100 sm:max-w-[240px]"
            aria-label={albumTitle}
            title={albumTitle}
          >
            <span className="overflow-hidden">
              <span className="animate-title-marquee flex w-max whitespace-nowrap">
                {marqueeRun}
                {marqueeRun}
              </span>
            </span>
          </a>

          <button
            type="button"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onSendLove?.(); }}
            className="rounded-full border border-slate-300 bg-white px-3 py-1 text-[11px] font-medium text-slate-700 transition hover:border-rose-400 hover:bg-rose-50 hover:text-rose-700"
          >
            {t("Gửi lời yêu thương")}
          </button>

          <button
            type="button"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onLicense?.(); }}
            className="rounded-full border border-slate-300 bg-white px-3 py-1 text-[11px] font-medium text-slate-700 transition hover:border-violet-400 hover:bg-violet-50 hover:text-violet-700"
          >
            {t("Gửi đề nghị nhận nhạc bản quyền & khai thác thương mại")}
          </button>
        </div>
      </div>

      {/* Card to đã bỏ — toàn bộ nội dung album giờ nằm trong mini-player nổi mép phải
          (KhucChamSidePanel). Banner chỉ còn hàng tên kênh + pill. */}
    </section>
  );
}

/**
 * Widget Khúc Chạm — nổi ở góc dưới-phải. Mỗi lần mới vào trang là TỰ MỞ;
 * bấm ✕ thu về nút tròn, bấm nút tròn mở lại. Không nhớ trạng thái qua lần load
 * (cố ý: user mới vào luôn thấy player mở).
 */
type SideProps = {
  t: (s: string) => string;
  landingUrl?: string;
  /** Video/playlist ID YouTube để nhúng mini-player. Mặc định = bài Mùa Hè Sôi Động. */
  embedVideoId?: string;
  onSendLove?: () => void;
  onLicense?: () => void;
};

export function KhucChamSidePanel({ t, landingUrl = YT_CHANNEL, embedVideoId = EMBED_VIDEO_ID, onSendLove, onLicense }: SideProps) {
  // Mặc định MỞ mỗi lần mount/load. ✕ chỉ thu gọn cho lượt xem hiện tại (không nhớ).
  const [open, setOpen] = useState(true);
  const [videoId, setVideoId] = useState(embedVideoId);
  const [autoplay, setAutoplay] = useState(false);
  const play = (id: string) => { setVideoId(id); setAutoplay(true); };

  const albumTitle = t("Album Mùa Hè Sôi Động 2026");
  const weatherLabel = t("Âm nhạc và dự báo thời tiết");
  // Tên hiển thị ở footer theo video đang phát.
  const footerTitle = videoId === VID_WEATHER ? weatherLabel : t("Mùa Hè Sôi Động");
  const marqueeRun = (
    <span className="flex shrink-0 items-center gap-6 pr-6">
      <span>{albumTitle}</span>
      <span className="text-pink-300">♪</span>
      <span>{albumTitle}</span>
      <span className="text-pink-300">♪</span>
    </span>
  );
  const openChannel = () => {
    if (typeof window !== "undefined") window.open(landingUrl, "_blank", "noopener,noreferrer");
  };

  // Thu gọn: tab dính mép PHẢI, canh giữa chiều dọc → luôn nằm giữa màn, không bị
  // thanh công cụ đáy của trình duyệt che. Có vòng nhấp nháy cho nổi bật.
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t("Mở Khúc Chạm Channel")}
        title={t("Khúc Chạm Channel")}
        className="fixed right-0 top-1/2 z-40 flex h-16 w-12 -translate-y-1/2 items-center justify-center rounded-l-2xl bg-gradient-to-br from-orange-400 to-amber-500 text-white shadow-2xl ring-2 ring-white/70 transition hover:w-14"
      >
        {/* Vòng nhấp nháy thu hút mắt */}
        <span className="pointer-events-none absolute inset-0 rounded-l-2xl bg-orange-400 opacity-50 animate-ping" aria-hidden="true" />
        <span className="animate-note-bounce relative text-2xl drop-shadow-sm">♪</span>
        <span className="animate-note-pulse pointer-events-none absolute left-1 top-1 text-xs text-pink-100" aria-hidden="true">♫</span>
      </button>
    );
  }

  // Thẻ Khúc Chạm đầy đủ — nổi góc dưới-phải, width co theo màn để bớt đè nội dung.
  return (
    <aside
      className="fixed bottom-20 right-4 z-40 w-56 max-w-[calc(100vw-2rem)] sm:w-80"
      aria-label={`${t("Khúc Chạm Channel")} — ${albumTitle}`}
    >
      <div className="relative max-h-[calc(100vh-6rem)] overflow-y-auto overflow-x-hidden rounded-2xl bg-gradient-to-br from-[#1e1b4b] via-[#4c1d95] to-[#831843] p-3 text-white shadow-xl ring-1 ring-white/20">
        {/* Nút đóng → thu gọn (mở lại được qua nút tròn) */}
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label={t("Thu gọn")}
          title={t("Thu gọn")}
          className="absolute right-1.5 top-1.5 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-black/40 text-xs text-white/80 transition hover:bg-black/60 hover:text-white"
        >
          ✕
        </button>

        {/* Header: avatar nhảy + tên kênh */}
        <div className="flex items-center gap-2 pr-6">
          <button
            type="button"
            onClick={openChannel}
            aria-label={t("Mở Khúc Chạm Channel")}
            className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-orange-400 to-amber-500 shadow-sm ring-1 ring-orange-300 transition hover:scale-105"
          >
            <span className="animate-note-bounce text-lg text-white drop-shadow-sm">♪</span>
            <span className="animate-note-pulse pointer-events-none absolute -right-1 -top-1 text-[10px] text-pink-300" aria-hidden="true">♫</span>
          </button>
          <h3 className="text-sm font-bold tracking-tight text-white">
            {t("Khúc Chạm Channel")}
          </h3>
        </div>

        {/* Pill — xếp dọc. 2 pill nhạc = nút chọn bài, bấm là đổi player & tự phát. */}
        <div className="mt-2.5 flex flex-col gap-1.5">
          <button
            type="button"
            onClick={() => play(VID_WEATHER)}
            aria-pressed={videoId === VID_WEATHER}
            className={`block rounded-full border px-3 py-1 text-left text-[11px] font-medium transition ${
              videoId === VID_WEATHER
                ? "border-white/70 bg-white/25 text-white ring-1 ring-white/40"
                : "border-white/25 bg-white/10 text-white/90 hover:bg-white/20"
            }`}
          >
            {weatherLabel}
          </button>

          {/* Pill album — CHẠY CHỮ */}
          <button
            type="button"
            onClick={() => play(VID_ALBUM)}
            aria-pressed={videoId === VID_ALBUM}
            aria-label={albumTitle}
            title={albumTitle}
            className={`group flex items-center overflow-hidden rounded-full border px-3 py-1 text-[11px] font-semibold text-pink-100 transition ${
              videoId === VID_ALBUM
                ? "border-pink-300 bg-pink-500/35 ring-1 ring-pink-300/60"
                : "border-pink-300/60 bg-pink-500/20 hover:bg-pink-500/30"
            }`}
          >
            <span className="overflow-hidden">
              <span className="animate-title-marquee flex w-max whitespace-nowrap">
                {marqueeRun}
                {marqueeRun}
              </span>
            </span>
          </button>

          <button
            type="button"
            onClick={() => onSendLove?.()}
            className="rounded-full border border-white/25 bg-white/10 px-3 py-1 text-left text-[11px] font-medium text-white/90 transition hover:bg-white/20"
          >
            {t("Gửi lời yêu thương")}
          </button>

          <button
            type="button"
            onClick={() => onLicense?.()}
            className="rounded-2xl border border-white/25 bg-white/10 px-3 py-1.5 text-left text-[11px] font-medium leading-snug text-white/90 transition hover:bg-white/20"
          >
            {t("Gửi đề nghị nhận nhạc bản quyền & khai thác thương mại")}
          </button>
        </div>

        {/* Player nhúng YouTube (phát nhạc bản quyền) */}
        <div className="relative mt-2.5 aspect-video w-full overflow-hidden rounded-lg bg-black">
          <iframe
            key={videoId}
            src={`https://www.youtube.com/embed/${videoId}?rel=0${autoplay ? "&autoplay=1" : ""}`}
            title={`${t("Khúc Chạm Channel")} — ${footerTitle}`}
            className="absolute inset-0 h-full w-full"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            referrerPolicy="strict-origin-when-cross-origin"
            allowFullScreen
            loading="lazy"
          />
        </div>

        {/* Footer: tên album + nút sang YouTube Music */}
        <div className="mt-1.5 flex items-center justify-between gap-1.5 px-0.5 pb-0.5">
          <div className="min-w-0">
            <p className="truncate text-[12px] font-extrabold leading-tight">
              {footerTitle}
            </p>
            <p className="truncate text-[9px] uppercase tracking-widest text-pink-200/90">
              @KhucChamChannel
            </p>
          </div>
          <a
            href={landingUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={t("Mở YouTube Music")}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white shadow-md transition hover:scale-105"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="#FF0000" aria-hidden="true">
              <path d="M23.498 6.186a3.014 3.014 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.376.505A3.014 3.014 0 0 0 .502 6.186C0 8.072 0 12 0 12s0 3.928.502 5.814a3.014 3.014 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.376-.505a3.014 3.014 0 0 0 2.122-2.136C24 15.928 24 12 24 12s0-3.928-.502-5.814ZM9.546 15.568V8.432L15.818 12l-6.272 3.568Z"/>
            </svg>
          </a>
        </div>
      </div>
    </aside>
  );
}

export default KhucChamBanner;
