"use client";

import { useState } from "react";
import type { Chain } from "@/lib/types";
import { chainColor, chainLabel, chainLogo } from "@/lib/stores";

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
 * Logo thật của chuỗi; URL lấy từ sheet "Logo nguồn" (qua chainLogo).
 * Thiếu logo hoặc ảnh lỗi → hiện badge chữ màu. KHÔNG bọc nền trắng/viền tròn ngoài:
 * nhiều logo (vd BHX) tự nó đã tròn, thêm border tròn nữa thành "vòng lồng vòng".
 * Vẫn overflow-hidden rounded-full để clip logo không tròn về khung tròn; object-contain
 * để logo chữ nhật hiện TRỌN, không bị phóng to cắt mép.
 */
export function ChainBadge({ chain }: { chain: Chain }) {
  const [failed, setFailed] = useState(false);
  const logo = chainLogo(chain);

  if (failed || !logo) {
    return (
      <span
        title={chainLabel(chain)}
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white shadow-sm"
        style={{ backgroundColor: chainColor(chain) }}
      >
        {shortLabel(chain)}
      </span>
    );
  }

  return (
    <span
      title={chainLabel(chain)}
      className="flex h-10 w-10 shrink-0 overflow-hidden rounded-full"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={logo}
        alt={chainLabel(chain)}
        className="h-full w-full object-contain"
        loading="lazy"
        onError={() => setFailed(true)}
      />
    </span>
  );
}
