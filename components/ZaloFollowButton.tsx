"use client";

import { useEffect } from "react";

/**
 * Nút "Quan tâm" THẬT của Zalo (Zalo Social Follow widget).
 * Nhúng SDK sp.zalo.me + <div class="zalo-follow-only-button" data-oaid="…">.
 * Bấm là quan tâm OA thật. LƯU Ý: widget KHÔNG callback lại JS mình biết đã follow hay
 * chưa → vẫn phải xác nhận best-effort (nút "Tôi đã quan tâm" ở ContactReveal) hoặc lên
 * 🅱️ (Zalo Login) để biết chắc.
 *
 * data-oaid = OA ID thật (số). Sai id → widget không hiện.
 */

let sdkPromise: Promise<void> | null = null;

function loadZaloSdk(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if ((window as any).ZaloSocialSDK) return Promise.resolve();
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise((resolve) => {
    const s = document.createElement("script");
    s.src = "https://sp.zalo.me/plugins/sdk.js";
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => resolve();
    document.body.appendChild(s);
  });
  return sdkPromise;
}

export function ZaloFollowButton({ oaid }: { oaid: string }) {
  useEffect(() => {
    let cancelled = false;
    loadZaloSdk().then(() => {
      if (cancelled) return;
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).ZaloSocialSDK?.reload?.();
      } catch {
        // ignore
      }
    });
    return () => { cancelled = true; };
  }, [oaid]);

  return (
    <div
      className="zalo-follow-only-button"
      data-oaid={oaid}
    />
  );
}
