"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { PurchaseRecord } from "@/lib/types";
import { chainLabel } from "@/lib/stores";
import { formatVnd } from "@/lib/util";
import { clearPurchases, getPurchases } from "@/lib/purchases";
import { Logo } from "@/components/Logo";
import { type Lang, langForCountry, readSavedCountry, tr } from "@/lib/i18n";

export default function HistoryPage() {
  const [items, setItems] = useState<PurchaseRecord[]>([]);
  const [lang, setLang] = useState<Lang>("vi");
  const t = (vi: string, vars?: Record<string, string | number>) => tr(lang, vi, vars);

  useEffect(() => {
    setItems(getPurchases());
    setLang(langForCountry(readSavedCountry()));
  }, []);

  const total = useMemo(() => items.reduce((s, x) => s + x.total, 0), [items]);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3">
          <Link href="/" className="flex items-center gap-2 text-slate-500 hover:text-slate-900">
            <Logo size={28} />
            <span className="text-sm">{t("← Trang chính")}</span>
          </Link>
          <h1 className="text-lg font-bold">{t("Lịch sử mua hàng")}</h1>
          {items.length > 0 && (
            <button
              onClick={() => {
                clearPurchases();
                setItems([]);
              }}
              className="ml-auto text-sm text-red-500 hover:underline"
            >
              {t("Xóa hết")}
            </button>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-5">
        {items.length === 0 ? (
          <p className="text-slate-500">
            {t("Chưa có lượt mua nào. Tìm sản phẩm ở trang chính rồi bấm “Đã mua ở đây”.")}
          </p>
        ) : (
          <>
            <div className="mb-4 rounded-xl border border-slate-200 bg-white p-4">
              <div className="text-sm text-slate-500">{t("Tổng chi đã ghi nhận")}</div>
              <div className="text-2xl font-bold">{formatVnd(total)}</div>
              <div className="text-xs text-slate-400">{t("{n} lượt mua", { n: items.length })}</div>
            </div>

            <ul className="space-y-2">
              {items.map((p) => (
                <li key={p.id} className="rounded-xl border border-slate-200 bg-white p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate font-medium">{p.productName}</div>
                      <div className="truncate text-xs text-slate-500">
                        {chainLabel(p.chain)} · {p.storeName}
                      </div>
                      <div className="text-xs text-slate-400">
                        {new Date(p.boughtAt).toLocaleString(lang === "en" ? "en-US" : "vi-VN")}
                      </div>
                      {p.buyerAddr && (
                        <div className="mt-1 flex items-start gap-1 text-xs text-slate-500">
                          <span>📍</span>
                          <span className="min-w-0">{p.buyerAddr}</span>
                        </div>
                      )}
                    </div>
                    <div className="text-right">
                      <div className="font-bold">{formatVnd(p.total)}</div>
                      <div className="text-xs text-slate-500">
                        {p.qty} × {formatVnd(p.unitPrice)}
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </main>
    </div>
  );
}
