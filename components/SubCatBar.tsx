"use client";

import type { ReactNode } from "react";

interface Props {
  backLabel: string;
  onBack: () => void;
  emoji?: string | null;
  title: string;
  /** undefined = ẩn count hoàn toàn */
  count?: number;
  /** đơn vị sau count, mặc định "sản phẩm" */
  countUnit?: string;
  badges?: ReactNode;
  t: (s: string) => string;
}

export function SubCatBar({ backLabel, onBack, emoji, title, count, countUnit, badges, t }: Props) {
  return (
    <div className="flex items-center justify-between px-3 py-2.5">
      <div className="flex min-w-0 items-center gap-2">
        <button
          onClick={onBack}
          className="flex shrink-0 items-center gap-1 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 shadow-sm transition hover:bg-slate-50 active:scale-95"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
          {backLabel}
        </button>
        <h2 className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 text-sm font-semibold text-slate-800">
          {emoji && <span className="mr-0.5">{emoji}</span>}
          <span className="truncate">{title}</span>
          {badges}
        </h2>
      </div>
      {count != null && (
        <span className="shrink-0 text-xs text-slate-400">
          {count} {countUnit ?? t("sản phẩm")}
        </span>
      )}
    </div>
  );
}
