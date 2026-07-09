"use client";

import { useEffect, useState } from "react";
import { VERSION_FALLBACK, type VersionInfo } from "./version";

/**
 * Fetch nội dung "Phiên bản" (list chữ "i" + roadmap) từ /api/version 1 lần, cache ở module.
 * Trả VERSION_FALLBACK (nội dung hardcode) trong lúc chờ / khi lỗi → UI không bao giờ trống.
 */
let cachePromise: Promise<VersionInfo> | null = null;

export function useVersionInfo(): VersionInfo {
  const [info, setInfo] = useState<VersionInfo>(VERSION_FALLBACK);
  useEffect(() => {
    if (!cachePromise) {
      cachePromise = fetch("/api/version")
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => {
          if (j && Array.isArray(j.history) && j.history.length) return j as VersionInfo;
          return VERSION_FALLBACK;
        })
        .catch(() => VERSION_FALLBACK);
    }
    let alive = true;
    cachePromise.then((c) => {
      if (alive) setInfo(c);
    });
    return () => {
      alive = false;
    };
  }, []);
  return info;
}
