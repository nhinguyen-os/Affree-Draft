"use client";

import { useEffect, useRef, useState } from "react";
import { DEFAULT_WIDGET, type KhucChamWidget } from "@/lib/khuccham-widget";

/**
 * Banner "Khúc Chạm Channel" — bố cục theo Miro Update 26/06/2026:
 *  • Avatar tròn cam + nốt nhạc (animate-note-bounce, animate-note-pulse)
 *  • Tên kênh "Khúc Chạm Channel"
 *  • Hàng 4 pill: "Âm nhạc và dự báo thời tiết" · "Album Mùa Hè Sôi Động 2026" (CHẠY CHỮ)
 *    · "Gửi lời yêu thương" · "Gửi đề nghị nhận nhạc bản quyền & khai thác thương mại"
 *  • Embed YouTube Music của @KhucChamChannel (click toàn banner → driven sang trang đích)
 */
const YT_CHANNEL = "https://music.youtube.com/@KhucChamChannel";

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
  onSendLove?: () => void;
  onLicense?: () => void;
};

const LOGO_FALLBACK = "/assets/khuc-cham-logo.png";
// Pill kiểu "trắng" (link / liên hệ / nghe-không-marquee), dùng chung; rounded-2xl để chữ dài wrap đẹp.
const WHITE_PILL_BASE =
  "rounded-2xl border px-3 py-1.5 text-left text-[11px] font-medium leading-snug transition";
const WHITE_PILL_IDLE = "border-white/25 bg-white/10 text-white/90 hover:bg-white/20";
const WHITE_PILL_ACTIVE = "border-white/70 bg-white/25 text-white ring-1 ring-white/40";

export function KhucChamSidePanel({ t, landingUrl, onSendLove, onLicense }: SideProps) {
  // Cấu hình ĐỘNG đọc từ Google Sheet (/api/khuccham-widget); chưa nạp/lỗi → DEFAULT_WIDGET.
  const [cfg, setCfg] = useState<KhucChamWidget>(DEFAULT_WIDGET);
  // Mặc định MỞ mỗi lần mount/load. ✕ chỉ thu gọn cho lượt xem hiện tại (không nhớ).
  const [open, setOpen] = useState(true);
  const [videoId, setVideoId] = useState(DEFAULT_WIDGET.defaultVideoId);
  const [autoplay, setAutoplay] = useState(false);
  const touched = useRef(false); // user đã tự chọn bài → không ghi đè khi cfg nạp xong

  useEffect(() => {
    let alive = true;
    fetch("/api/khuccham-widget")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive || !d?.widget) return;
        const w = d.widget as KhucChamWidget;
        setCfg(w);
        if (!touched.current) setVideoId(w.defaultVideoId);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  const play = (id: string) => { touched.current = true; setVideoId(id); setAutoplay(true); };

  const logo = cfg.logo || LOGO_FALLBACK;
  const landing = landingUrl || cfg.landingUrl;
  // Tên footer = nhãn pill nhạc đang phát; không khớp → tên kênh.
  const footerTitle =
    cfg.pills.find((p) => p.type === "nghe" && p.videoId === videoId)?.label || cfg.channelName;

  const marqueeFor = (label: string) => (
    <span className="flex shrink-0 items-center gap-6 pr-6">
      <span>{t(label)}</span><span className="text-pink-300">♪</span>
      <span>{t(label)}</span><span className="text-pink-300">♪</span>
    </span>
  );

  const openChannel = () => {
    if (typeof window !== "undefined") window.open(landing, "_blank", "noopener,noreferrer");
  };

  // Thu gọn: nút logo dính mép PHẢI, canh giữa chiều dọc → luôn nằm giữa màn, có vòng nhấp nháy.
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t("Mở Khúc Chạm Channel")}
        title={t(cfg.channelName)}
        className="fixed right-2 top-1/2 z-40 flex h-14 w-14 -translate-y-1/2 items-center justify-center rounded-full shadow-2xl transition hover:scale-110"
      >
        <span className="pointer-events-none absolute inset-0 rounded-full bg-orange-400 opacity-40 animate-ping" aria-hidden="true" />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={logo} alt={t(cfg.channelName)} className="relative h-14 w-14 rounded-full object-contain drop-shadow-lg" />
      </button>
    );
  }

  // Thẻ Khúc Chạm đầy đủ — nổi góc dưới-phải, width co theo màn để bớt đè nội dung.
  return (
    <aside
      className="fixed bottom-20 right-4 z-40 w-60 max-w-[calc(100vw-2rem)] sm:w-80"
      aria-label={t(cfg.channelName)}
    >
      <div className="relative max-h-[calc(100vh-6rem)] overflow-y-auto overflow-x-hidden rounded-2xl bg-gradient-to-br from-[#1e1b4b] via-[#4c1d95] to-[#831843] p-3 text-white shadow-xl ring-1 ring-white/20">
        {/* Nút đóng → thu gọn (mở lại được qua nút logo) */}
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label={t("Thu gọn")}
          title={t("Thu gọn")}
          className="absolute right-1.5 top-1.5 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-black/40 text-xs text-white/80 transition hover:bg-black/60 hover:text-white"
        >
          ✕
        </button>

        {/* Header: logo quay + tên kênh */}
        <div className="flex items-center gap-2 pr-6">
          <button
            type="button"
            onClick={openChannel}
            aria-label={t("Mở Khúc Chạm Channel")}
            className="relative h-10 w-10 shrink-0 overflow-hidden rounded-full transition hover:scale-105 sm:h-12 sm:w-12"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={logo} alt={t(cfg.channelName)} className="animate-disc-spin h-full w-full object-cover" />
          </button>
          <h3 className="whitespace-nowrap text-[13px] font-bold tracking-tight text-white sm:text-sm">
            {t(cfg.channelName)}
          </h3>
        </div>

        {/* Pill — xếp dọc, đọc động từ sheet. Pill "nghe" = chọn bài (đổi player & tự phát);
            "link" = mở trang ngoài; "lien_he_*" = mở form liên hệ. */}
        <div className="mt-2.5 flex flex-col gap-1.5">
          {cfg.pills.map((pill, i) => {
            const key = `${pill.type}-${i}`;
            if (pill.type === "lien_he_yeu_thuong")
              return (
                <button key={key} type="button" onClick={() => onSendLove?.()} className={`${WHITE_PILL_BASE} ${WHITE_PILL_IDLE}`}>
                  {t(pill.label)}
                </button>
              );
            if (pill.type === "lien_he_ban_quyen")
              return (
                <button key={key} type="button" onClick={() => onLicense?.()} className={`${WHITE_PILL_BASE} ${WHITE_PILL_IDLE}`}>
                  {t(pill.label)}
                </button>
              );
            if (pill.type === "link")
              return (
                <a key={key} href={pill.url || landing} target="_blank" rel="noopener noreferrer" className={`${WHITE_PILL_BASE} ${WHITE_PILL_IDLE} block`}>
                  {t(pill.label)}
                </a>
              );
            // type "nghe"
            const active = !!pill.videoId && videoId === pill.videoId;
            if (pill.marquee)
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => pill.videoId && play(pill.videoId)}
                  aria-pressed={active}
                  title={t(pill.label)}
                  className={`group flex items-center overflow-hidden rounded-full border px-3 py-1 text-[11px] font-semibold text-pink-100 transition ${
                    active ? "border-pink-300 bg-pink-500/35 ring-1 ring-pink-300/60" : "border-pink-300/60 bg-pink-500/20 hover:bg-pink-500/30"
                  }`}
                >
                  <span className="overflow-hidden">
                    <span className="animate-title-marquee flex w-max whitespace-nowrap">
                      {marqueeFor(pill.label)}
                      {marqueeFor(pill.label)}
                    </span>
                  </span>
                </button>
              );
            return (
              <button
                key={key}
                type="button"
                onClick={() => pill.videoId && play(pill.videoId)}
                aria-pressed={active}
                className={`${WHITE_PILL_BASE} ${active ? WHITE_PILL_ACTIVE : WHITE_PILL_IDLE}`}
              >
                {t(pill.label)}
              </button>
            );
          })}
        </div>

        {/* Player nhúng YouTube (phát nhạc bản quyền) */}
        <div className="relative mt-2.5 aspect-video w-full overflow-hidden rounded-lg bg-black">
          <iframe
            key={videoId}
            src={`https://www.youtube.com/embed/${videoId}?rel=0${autoplay ? "&autoplay=1" : ""}`}
            title={`${t(cfg.channelName)} — ${footerTitle}`}
            className="absolute inset-0 h-full w-full"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            referrerPolicy="strict-origin-when-cross-origin"
            allowFullScreen
            loading="lazy"
          />
        </div>

        {/* Footer: tên bài đang phát + handle + nút sang YouTube Music */}
        <div className="mt-1.5 flex items-center justify-between gap-1.5 px-0.5 pb-0.5">
          <div className="min-w-0">
            <p className="truncate text-[12px] font-extrabold leading-tight">
              {footerTitle}
            </p>
            {cfg.handle && (
              <p className="truncate text-[9px] uppercase tracking-widest text-pink-200/90">
                {cfg.handle}
              </p>
            )}
          </div>
          <a
            href={landing}
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
