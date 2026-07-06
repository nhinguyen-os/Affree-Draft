"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { formatVnd } from "@/lib/util";
import { Logo } from "@/components/Logo";
import { type Lang, langForCountry, readSavedCountry, tr } from "@/lib/i18n";
import { fetchMe, type AuthUser } from "@/lib/auth";

type OrderRow = {
  id?: string;
  bought_at?: string;
  product_name?: string;
  store_name?: string;
  qty?: number | string;
  unit_price?: number | string;
  total?: number | string;
};

/** Trang "Đơn hàng của tôi" — CHỈ danh sách đơn theo SĐT. Hồ sơ ở trang riêng /account. */
export default function AccountOrdersPage() {
  const [lang, setLang] = useState<Lang>("vi");
  const t = (vi: string, vars?: Record<string, string | number>) => tr(lang, vi, vars);

  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [orders, setOrders] = useState<OrderRow[]>([]);

  useEffect(() => {
    setLang(langForCountry(readSavedCountry()));
    (async () => {
      const u = await fetchMe();
      setUser(u);
      if (u) {
        const ordRes = await fetch("/api/account/orders", { cache: "no-store" }).then((r) => r.json()).catch(() => null);
        if (Array.isArray(ordRes?.orders)) setOrders(ordRes.orders);
      }
      setLoading(false);
    })();
  }, []);

  const num = (v: number | string | undefined) => Number(String(v ?? "").replace(/[^\d.-]/g, "")) || 0;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3">
          <Link href="/" className="flex items-center gap-2 text-slate-500 hover:text-slate-900">
            <Logo size={28} />
            <span className="text-sm">{t("← Trang chính")}</span>
          </Link>
          <h1 className="text-lg font-bold">{t("Đơn hàng của tôi")}</h1>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-5">
        {loading ? (
          <p className="text-slate-500">{t("Đang tải…")}</p>
        ) : !user ? (
          <div className="rounded-xl border border-slate-200 bg-white p-5 text-center">
            <p className="text-slate-600">{t("Bạn chưa đăng nhập.")}</p>
            <Link href="/" className="mt-3 inline-block rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700">
              {t("Về trang chính để đăng nhập")}
            </Link>
          </div>
        ) : (
          <>
            <section className="mb-4 rounded-xl border border-slate-200 bg-white p-4">
              {orders.length === 0 ? (
                <p className="text-sm text-slate-500">{t("Chưa có đơn hàng nào gắn với số điện thoại này.")}</p>
              ) : (
                <ul className="space-y-2">
                  {orders.map((o, i) => (
                    <li key={o.id || i} className="rounded-lg border border-slate-100 bg-slate-50 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate font-medium">{o.product_name || "—"}</div>
                          <div className="truncate text-xs text-slate-500">{o.store_name || ""}</div>
                          {o.bought_at && (
                            <div className="text-xs text-slate-400">
                              {new Date(o.bought_at).toLocaleString(lang === "en" ? "en-US" : "vi-VN")}
                            </div>
                          )}
                        </div>
                        <div className="text-right">
                          <div className="font-bold">{formatVnd(num(o.total))}</div>
                          <div className="text-xs text-slate-500">{num(o.qty)} × {formatVnd(num(o.unit_price))}</div>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

          </>
        )}
      </main>
    </div>
  );
}
