"use client";

import { useState } from "react";
import type { Chain } from "@/lib/types";
import { chainColor, chainLabel } from "@/lib/stores";

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

/** Logo thật của chuỗi trên nền trắng; nếu thiếu file logo thì hiện badge chữ màu. */
export function ChainBadge({ chain }: { chain: Chain }) {
  const [failed, setFailed] = useState(false);

  if (failed) {
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
      className="flex h-10 w-10 shrink-0 overflow-hidden rounded-full bg-white shadow-sm ring-1 ring-black/10"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`/logos/${chain}.png`}
        alt={chainLabel(chain)}
        className="h-full w-full object-cover"
        loading="lazy"
        onError={() => setFailed(true)}
      />
    </span>
  );
}
