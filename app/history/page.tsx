"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { PurchaseRecord } from "@/lib/types";
import { chainCurrency, chainLabel } from "@/lib/stores";
import { formatMoney } from "@/lib/util";
import { getPurchases } from "@/lib/purchases";
import { Logo } from "@/components/Logo";
import { type Lang, langForCountry, readSavedCountry, tr } from "@/lib/i18n";

// 1 ĐƠN HÀNG = các bản ghi mua cùng orderCode (nhiều món/nhiều nguồn đặt cùng 1 lần).
// Bản ghi cũ không có orderCode → tự đứng riêng 1 đơn (khoá theo id).
type Order = {
  key: string;
  code?: string; // mã đơn THẬT (chỉ có ở đơn đặt sau khi bản này lưu orderCode)
  items: PurchaseRecord[];
  total: number;
  boughtAt: string;
  currency: string;
  buyerName?: string;
  buyerPhone?: string;
  buyerAddr?: string;
};

// Khoá gom nhóm 1 đơn: ưu tiên orderCode. Đơn CŨ (chưa lưu mã) → gom các món đặt CÙNG LÚC
// (cùng người mua + cùng mốc thời gian ~3s) vì lúc đặt cả giỏ các bản ghi có timestamp sát nhau.
function orderKey(r: PurchaseRecord): string {
  if (r.orderCode) return r.orderCode;
  const bucket = Math.floor(Date.parse(r.boughtAt) / 3000);
  return `legacy:${r.buyerPhone || r.buyerName || ""}:${bucket}`;
}

// Mã đơn hiển thị: dùng mã THẬT nếu có; đơn cũ chưa lưu mã → sinh mã AFF ổn định (tất định)
// từ mốc thời gian đặt, đúng định dạng "AFF-######-###" để luôn có mã đơn tổng.
function codeOf(o: Order): string {
  if (o.code) return o.code;
  const ms = Date.parse(o.boughtAt) || 0;
  return `AFF-${String(ms).slice(-6)}-${100 + (ms % 900)}`;
}

function groupOrders(records: PurchaseRecord[]): Order[] {
  const byKey = new Map<string, Order>();
  for (const r of records) {
    const key = orderKey(r);
    let o = byKey.get(key);
    if (!o) {
      o = {
        key,
        code: r.orderCode || undefined,
        items: [],
        total: 0,
        boughtAt: r.boughtAt,
        currency: chainCurrency(r.chain),
        buyerName: r.buyerName,
        buyerPhone: r.buyerPhone,
        buyerAddr: r.buyerAddr,
      };
      byKey.set(key, o);
    }
    o.items.push(r);
    o.total += r.total;
    if (!o.code && r.orderCode) o.code = r.orderCode;
    // Giữ mốc thời gian sớm nhất làm thời điểm đặt đơn.
    if (r.boughtAt < o.boughtAt) o.boughtAt = r.boughtAt;
  }
  return [...byKey.values()];
}

export default function HistoryPage() {
  const [items, setItems] = useState<PurchaseRecord[]>([]);
  const [lang, setLang] = useState<Lang>("vi");
  // Đơn đang xem chi tiết (bấm 1 dòng → mở modal). null = không mở.
  const [selected, setSelected] = useState<Order | null>(null);
  const t = (vi: string, vars?: Record<string, string | number>) => tr(lang, vi, vars);

  useEffect(() => {
    setItems(getPurchases());
    setLang(langForCountry(readSavedCountry()));
  }, []);

  const orders = useMemo(() => groupOrders(items), [items]);
  const total = useMemo(() => items.reduce((s, x) => s + x.total, 0), [items]);
  const fmtTime = (iso: string) => new Date(iso).toLocaleString(lang === "en" ? "en-US" : "vi-VN");
  // Tên các nguồn (chuỗi·cửa hàng) khác nhau trong 1 đơn — để hiện dưới mã đơn.
  const storesOf = (o: Order) =>
    [...new Set(o.items.map((i) => `${chainLabel(i.chain)} · ${i.storeName}`))];

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3">
          <Link href="/" className="flex items-center gap-2 text-slate-500 hover:text-slate-900">
            <Logo size={28} />
            <span className="text-sm">{t("← Trang chính")}</span>
          </Link>
          <h1 className="text-lg font-bold">{t("Lịch sử mua hàng")}</h1>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-5">
        {orders.length === 0 ? (
          <p className="text-slate-500">
            {t("Chưa có lượt mua nào. Tìm sản phẩm ở trang chính rồi bấm “Đã mua ở đây”.")}
          </p>
        ) : (
          <>
            <div className="mb-4 rounded-xl border border-slate-200 bg-white p-4">
              <div className="text-sm text-slate-500">{t("Tổng chi đã ghi nhận")}</div>
              <div className="text-2xl font-bold">{formatMoney(total, items[0] ? chainCurrency(items[0].chain) : "VND")}</div>
              <div className="text-xs text-slate-400">{t("{n} đơn hàng", { n: orders.length })}</div>
            </div>

            <ul className="space-y-2">
              {orders.map((o) => {
                const stores = storesOf(o);
                const nItems = o.items.reduce((s, i) => s + i.qty, 0);
                return (
                  <li key={o.key}>
                    <button
                      type="button"
                      onClick={() => setSelected(o)}
                      className="flex w-full items-start justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3 text-left transition hover:border-emerald-400 hover:shadow-sm"
                    >
                      <div className="min-w-0">
                        <div className="font-bold tracking-wide text-emerald-600">{codeOf(o)}</div>
                        <div className="mt-0.5 truncate text-sm font-medium text-slate-800">
                          {o.items[0].productName}
                          {o.items.length > 1 && (
                            <span className="font-normal text-slate-500"> {t("+{n} món khác", { n: o.items.length - 1 })}</span>
                          )}
                        </div>
                        <div className="truncate text-xs text-slate-500">
                          {stores.length > 1 ? t("{n} nguồn", { n: stores.length }) : stores[0]}
                        </div>
                        <div className="text-xs text-slate-400">{fmtTime(o.boughtAt)}</div>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="font-bold">{formatMoney(o.total, o.currency)}</div>
                        <div className="text-xs text-slate-500">{t("{n} món", { n: nItems })}</div>
                        <div className="mt-1 inline-flex items-center gap-0.5 text-xs font-medium text-emerald-600">
                          {t("Chi tiết")}
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6" /></svg>
                        </div>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </main>

      {/* Modal chi tiết đơn hàng — liệt kê từng sản phẩm trong đơn. Bấm nền tối / × để đóng. */}
      {selected && (
        <div
          className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-6"
          onClick={() => setSelected(null)}
        >
          <div
            className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-t-2xl bg-white shadow-xl sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 border-b border-slate-100 p-5 pb-3">
              <div className="min-w-0">
                <h2 className="text-base font-bold">{t("Chi tiết đơn hàng")}</h2>
                <div className="mt-0.5 font-bold tracking-wide text-emerald-600">{codeOf(selected)}</div>
                <div className="text-xs text-slate-400">{fmtTime(selected.boughtAt)}</div>
              </div>
              <button
                type="button"
                onClick={() => setSelected(null)}
                aria-label={t("Đóng")}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-5 pt-3">
              {/* Danh sách sản phẩm trong đơn */}
              <ul className="divide-y divide-slate-100">
                {selected.items.map((it) => (
                  <li key={it.id} className="flex items-start justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <div className="text-sm font-medium leading-snug text-slate-800">{it.productName}</div>
                      <div className="truncate text-xs text-slate-500">{chainLabel(it.chain)} · {it.storeName}</div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="text-sm font-semibold text-slate-800">{formatMoney(it.total, chainCurrency(it.chain))}</div>
                      <div className="text-xs text-slate-500">{it.qty} × {formatMoney(it.unitPrice, chainCurrency(it.chain))}</div>
                    </div>
                  </li>
                ))}
              </ul>

              {/* Thông tin nhận hàng (chung cho cả đơn) */}
              {(selected.buyerName || selected.buyerPhone || selected.buyerAddr) && (
                <dl className="mt-3 space-y-2 border-t border-slate-100 pt-3 text-sm">
                  {selected.buyerName && <Row label={t("Người mua")} value={selected.buyerName} />}
                  {selected.buyerPhone && <Row label={t("Số điện thoại")} value={selected.buyerPhone} />}
                  {selected.buyerAddr && <Row label={t("Địa chỉ")} value={selected.buyerAddr} />}
                </dl>
              )}
            </div>

            <div className="flex items-center justify-between border-t border-slate-200 p-5 py-3.5">
              <span className="text-sm text-slate-500">{t("Thành tiền")}</span>
              <span className="text-lg font-bold text-emerald-600">{formatMoney(selected.total, selected.currency)}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** 1 dòng nhãn–giá trị trong modal chi tiết. */
function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <dt className="shrink-0 text-slate-500">{label}</dt>
      <dd className="min-w-0 text-right font-medium text-slate-800">{value}</dd>
    </div>
  );
}
