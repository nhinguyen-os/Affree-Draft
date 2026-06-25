"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Logo tự dò + cắt lề trắng/trong suốt trong file ảnh gốc + phát hiện màu nền chủ đạo.
 *
 *  1. Load ảnh qua <img> ẩn (crossOrigin để đọc pixel).
 *  2. Vẽ vào canvas, scan pixel để tìm bounding-box vùng KHÔNG trong suốt và KHÔNG sát-trắng.
 *  3. Crop → dataURL hiển thị, đồng thời sample các pixel ở 4 góc của vùng đã trim
 *     để đoán "fill color" (nếu 4 góc giống nhau & không trong suốt → logo có nền màu;
 *     cho phép app dùng màu này làm background card để logo fill cả khung).
 *  4. Trả callback `onResult({trimmedSrc, fillColor})`. Nếu CORS chặn → giữ ảnh gốc, fillColor=undefined.
 */
export function TrimmedLogo({
  src,
  alt,
  className,
  onResult,
  keyOutWhite,
}: {
  src: string;
  alt: string;
  className?: string;
  /** Gọi khi đã trim xong, truyền màu nền chủ đạo (nếu có) và aspect = w/h của ảnh sau trim. */
  onResult?: (info: { fillColor?: string; aspect?: number }) => void;
  /**
   * Bật để flood-fill các pixel near-white liền mép thành transparent.
   * Dùng khi card có BG override khác trắng (vd Beauty Republic gold card)
   * để logo nền trắng không tạo dải trắng cắt ngang BG.
   */
  keyOutWhite?: boolean;
}) {
  const [finalSrc, setFinalSrc] = useState<string>(src);
  const cacheKey = useRef<string>(src);

  useEffect(() => {
    cacheKey.current = src;
    setFinalSrc(src);
    if (!src) return;
    let cancelled = false;
    const img = new Image();
    // Logo từ domain ngoài (taphoaxelam.com, gstatic.com…) chặn CORS → canvas.getImageData
    // ném SecurityError, không đọc pixel để dò màu/trim được. Đi qua proxy nội bộ
    // /api/proxy-img để re-serve cùng-origin có CORS=* → đọc pixel thoải mái.
    const isAbsolute = /^https?:\/\//i.test(src);
    const loadSrc = isAbsolute ? `/api/proxy-img?u=${encodeURIComponent(src)}` : src;
    img.crossOrigin = "anonymous";
    img.onload = () => {
      if (cancelled || cacheKey.current !== src) return;
      try {
        const w = img.naturalWidth;
        const h = img.naturalHeight;
        if (!w || !h) return;
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.drawImage(img, 0, 0);
        const data = ctx.getImageData(0, 0, w, h).data;
        // Bounds inclusive
        let top = -1, bottom = -1, left = w, right = -1;
        const isEmpty = (r: number, g: number, b: number, a: number) => {
          if (a < 8) return true; // trong suốt
          // sát trắng (mỗi kênh ≥245) → coi là nền
          return r >= 245 && g >= 245 && b >= 245;
        };
        for (let y = 0; y < h; y++) {
          let rowHasContent = false;
          for (let x = 0; x < w; x++) {
            const i = (y * w + x) * 4;
            if (!isEmpty(data[i], data[i + 1], data[i + 2], data[i + 3])) {
              rowHasContent = true;
              if (x < left) left = x;
              if (x > right) right = x;
            }
          }
          if (rowHasContent) {
            if (top === -1) top = y;
            bottom = y;
          }
        }
        if (top < 0 || bottom < 0 || left >= w || right < 0) return;
        // Pad ÂM (shrink vào trong): crop bỏ luôn 2px viền anti-alias quanh content.
        // Nếu không, edge image có alpha pha hoặc màu off-shade so với fill bg → tạo line
        // ngang/dọc giữa image và card bg. Cắt thêm 2px → image edge = solid brand color = card bg.
        const pad = -2;
        const sx = Math.max(0, left - pad);
        const sy = Math.max(0, top - pad);
        const sw = Math.min(w, right + 1 + pad) - sx;
        const sh = Math.min(h, bottom + 1 + pad) - sy;
        if (sw < 4 || sh < 4) return;

        // Sample 4 góc của vùng đã trim để đoán fill color. Lấy pixel cách viền 2px
        // (tránh anti-alias edge). Nếu 4 màu sai khác nhỏ + không trong suốt → coi là nền.
        const sampleAt = (x: number, y: number) => {
          const i = (y * w + x) * 4;
          return [data[i], data[i + 1], data[i + 2], data[i + 3]] as [number, number, number, number];
        };
        // Detect MÀU VIỀN của trimmed bbox (perimeter): nếu viền chủ yếu cùng 1 màu opaque
        // → logo có nền liền màu (Mencode pill, Vinamilk block, Alo Clean band…) →
        // paint card bg đúng màu viền đó → khi render image cạnh nào cũng hòa vào card,
        // không tạo line ngang/dọc. Nếu viền diverse hoặc trong suốt → logo nền trong suốt
        // (PNJ, Beauty Republic) → giữ card trắng.
        // Quantize 32-step (8³=512 buckets) — gộp shades gần nhau vào cùng bucket để
        // logo có gradient border (Alo Clean, Hảo Hảo…) vẫn cluster về 1 màu nền chính.
        const edgeBuckets = new Map<number, { r: number; g: number; b: number; n: number }>();
        let edgeOpaqueCount = 0;
        const addEdgePx = (x: number, y: number) => {
          const i = (y * w + x) * 4;
          const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
          if (a < 200) return;
          edgeOpaqueCount++;
          const key = (r >> 5) * 64 + (g >> 5) * 8 + (b >> 5);
          const cur = edgeBuckets.get(key);
          if (cur) { cur.r += r; cur.g += g; cur.b += b; cur.n += 1; }
          else edgeBuckets.set(key, { r, g, b, n: 1 });
        };
        for (let x = sx; x < sx + sw; x++) { addEdgePx(x, sy); addEdgePx(x, sy + sh - 1); }
        for (let y = sy + 1; y < sy + sh - 1; y++) { addEdgePx(sx, y); addEdgePx(sx + sw - 1, y); }
        const totalEdgePx = 2 * sw + 2 * Math.max(0, sh - 2);
        let fillColor: string | undefined;
        let bestEdgeBucket: { r: number; g: number; b: number; n: number } | undefined;
        edgeBuckets.forEach((v) => { if (!bestEdgeBucket || v.n > bestEdgeBucket.n) bestEdgeBucket = v; });
        if (bestEdgeBucket && edgeOpaqueCount / totalEdgePx >= 0.5) {
          const r = Math.round(bestEdgeBucket.r / bestEdgeBucket.n);
          const g = Math.round(bestEdgeBucket.g / bestEdgeBucket.n);
          const b = Math.round(bestEdgeBucket.b / bestEdgeBucket.n);
          // Bỏ near-white (logo nền trắng → giữ card trắng). Hạ dominance threshold xuống
          // 0.15 để bắt logos có gradient nhẹ (Alo Clean, Hảo Hảo) mà tan/red center
          // không chiếm tuyệt đối nhưng vẫn là màu nền chính.
          const isWhite = r >= 240 && g >= 240 && b >= 240;
          const dominanceRatio = bestEdgeBucket.n / Math.max(1, edgeOpaqueCount);
          if (!isWhite && dominanceRatio >= 0.15) {
            fillColor = `rgb(${r},${g},${b})`;
          }
        }

        // Key-out near-white BG: flood-fill từ 4 cạnh trim bbox, mark connected
        // near-white pixels thành transparent. Internal white (negative space trong
        // crest/text) không bị ảnh hưởng vì không liền mép. Chỉ bật khi caller yêu cầu
        // (Beauty Republic card override gold) để khỏi vô tình phá Vinamilk-text-trắng-trên-blue.
        let didKeyOut = false;
        if (keyOutWhite) {
          const stack: number[] = [];
          const visited = new Uint8Array(w * h);
          const isNearWhiteOrTransparent = (idx: number) => {
            const i = idx * 4;
            const a = data[i + 3];
            if (a < 8) return true;
            return data[i] >= 235 && data[i + 1] >= 235 && data[i + 2] >= 235;
          };
          // Seed: tất cả pixel ở 4 cạnh của trim bbox
          for (let x = sx; x < sx + sw; x++) {
            stack.push(sy * w + x);
            stack.push((sy + sh - 1) * w + x);
          }
          for (let y = sy + 1; y < sy + sh - 1; y++) {
            stack.push(y * w + sx);
            stack.push(y * w + sx + sw - 1);
          }
          while (stack.length) {
            const idx = stack.pop() as number;
            if (visited[idx]) continue;
            visited[idx] = 1;
            if (!isNearWhiteOrTransparent(idx)) continue;
            data[idx * 4 + 3] = 0;
            didKeyOut = true;
            const x = idx % w, y = (idx - x) / w;
            // Chỉ flood trong trim bbox (không xài pixel ngoài)
            if (x > sx) stack.push(idx - 1);
            if (x < sx + sw - 1) stack.push(idx + 1);
            if (y > sy) stack.push(idx - w);
            if (y < sy + sh - 1) stack.push(idx + w);
          }
          if (didKeyOut) {
            ctx.putImageData(new ImageData(data, w, h), 0, 0);
          }
        }

        // Nếu trim không đáng kể (>=98% diện tích) → giữ src gốc; CHỈ trả fillColor.
        // Nhưng nếu didKeyOut → phải re-encode để giữ transparency mới.
        const trimmed = sw * sh < 0.98 * w * h;
        let newSrc = src;
        if (trimmed || didKeyOut) {
          const out = document.createElement("canvas");
          out.width = sw;
          out.height = sh;
          const octx = out.getContext("2d");
          if (octx) {
            octx.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);
            newSrc = out.toDataURL("image/png");
          }
        }
        if (!cancelled && cacheKey.current === src) {
          if (newSrc !== src) setFinalSrc(newSrc);
          const aspect = sh > 0 ? sw / sh : undefined;
          onResult?.({ fillColor, aspect });
        }
      } catch {
        // CORS hoặc tainted canvas → fallback ảnh gốc, không xử lý.
      }
    };
    img.onerror = () => {
      /* lỗi load → giữ ảnh gốc */
    };
    img.src = loadSrc;
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

  // eslint-disable-next-line @next/next/no-img-element
  return <img src={finalSrc} alt={alt} className={className} />;
}
