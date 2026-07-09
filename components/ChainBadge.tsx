"use client";

import { useState } from "react";
import type { Chain } from "@/lib/types";
import { chainColor, chainLabel, chainLogo } from "@/lib/stores";
import { TrimmedLogo } from "@/components/TrimmedLogo";

const SHORT: Record<string, string> = {
  bhx: "BHX",
  concung: "CC",
  coop: "Coop",
  aeon: "AEON",
  shopee: "SPE",
  grab: "Grab",
  pnj: "PNJ",
  dalathasfarm: "DLHF",
  ichiban: "ICHI",
  lotte: "LOTTE",
  krmart: "KR",
  other: "•",
};

/** Nhãn ngắn cho badge: dùng map cố định, hoặc 3-4 ký tự đầu của tên nguồn. */
function shortLabel(chain: Chain): string {
  return SHORT[chain] ?? chainLabel(chain).slice(0, 4).toUpperCase();
}

/**
 * Logo thật của chuỗi; URL lấy từ sheet "Logo nguồn" (qua chainLogo). Thiếu logo / ảnh lỗi
 * → badge chữ màu.
 *
 * ĐỒNG BỘ HÌNH DẠNG: mọi badge là 1 ĐĨA TRÒN đặc phủ kín khung. Dùng TrimmedLogo để cắt lề
 * trắng/trong suốt + dò MÀU NỀN chủ đạo của logo; đổ màu đó làm nền đĩa → logo có nền màu
 * (Coop xanh, BHX xanh lá…) hòa liền, KHÔNG "vòng lồng vòng"; logo chữ/wordmark (Walmart…)
 * nằm giữa đĩa trắng, phủ hết border mà KHÔNG bị cắt (object-contain).
 */
// Badge = 1 ĐĨA TRÒN đồng nhất (shape giống nhau cho mọi cửa hàng): cùng size, bo tròn,
// ring + shadow. Dùng chung cho cả nhánh có logo lẫn nhánh chữ fallback.
const BADGE_SHELL =
  "flex shrink-0 items-center justify-center overflow-hidden rounded-full shadow-sm ring-1 ring-black/[0.06]";

export function ChainBadge({ chain, size = 40 }: { chain: Chain; size?: number }) {
  const [failed, setFailed] = useState(false);
  const [fill, setFill] = useState<string | undefined>();
  const [aspect, setAspect] = useState<number | undefined>();
  const logo = chainLogo(chain);
  const brand = chainColor(chain);
  const dim = { width: size, height: size };

  if (failed || !logo) {
    return (
      <span
        title={chainLabel(chain)}
        className={`${BADGE_SHELL} font-bold text-white`}
        style={{ ...dim, fontSize: Math.max(9, Math.round(size * 0.26)), backgroundColor: brand }}
      >
        {shortLabel(chain)}
      </span>
    );
  }

  // Logo NGANG (wordmark, aspect ≥ 1.6 — Walmart, AEON…) → nền TRẮNG + đệm rộng hơn để chữ
  //   đọc rõ, không bị đĩa màu nuốt / cắt chữ. Logo VUÔNG (icon — Coop, BHX…) → nền = màu logo
  //   tự dò (fill) hoặc màu brand → đĩa màu phủ kín border, icon nằm sát mép.
  const isWordmark = aspect != null && aspect >= 1.6;
  const bg = isWordmark ? "#ffffff" : (fill || brand);
  return (
    <span title={chainLabel(chain)} className={BADGE_SHELL} style={{ ...dim, backgroundColor: bg }}>
      <TrimmedLogo
        src={logo}
        alt={chainLabel(chain)}
        className={`h-full w-full object-contain ${isWordmark ? "p-1.5" : "p-0.5"}`}
        onResult={({ fillColor, aspect }) => { setFill(fillColor); setAspect(aspect); }}
        onError={() => setFailed(true)}
      />
    </span>
  );
}
