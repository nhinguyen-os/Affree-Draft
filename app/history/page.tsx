"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { Chain, PurchaseRecord } from "@/lib/types";
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

// Tách các món trong 1 đơn theo CỬA HÀNG (đơn nhiều nguồn) → mỗi cửa hàng 1 khối:
// mã đơn riêng (storeOrderCode, fallback orderCode), danh sách SP, thành tiền của cửa hàng đó.
type StoreBlock = { storeId: string; storeName: string; chain: Chain; currency: string; code: string; slot?: string; pay?: PurchaseRecord["payMethod"]; items: PurchaseRecord[]; total: number };
function groupByStore(items: PurchaseRecord[]): StoreBlock[] {
  const byStore = new Map<string, StoreBlock>();
  for (const it of items) {
    let s = byStore.get(it.storeId);
    if (!s) {
      s = { storeId: it.storeId, storeName: it.storeName, chain: it.chain, currency: chainCurrency(it.chain), code: it.storeOrderCode || it.orderCode || "", slot: it.slot, pay: it.payMethod, items: [], total: 0 };
      byStore.set(it.storeId, s);
    }
    s.items.push(it);
    s.total += it.total;
    if (!s.code) s.code = it.storeOrderCode || it.orderCode || "";
    if (!s.slot && it.slot) s.slot = it.slot;
    if (!s.pay && it.payMethod) s.pay = it.payMethod;
  }
  return [...byStore.values()];
}

// Nhãn hình thức thanh toán (có icon) — dùng cho lịch sử đơn. tr() dịch phần chữ.
function payLabel(p: PurchaseRecord["payMethod"], t: (vi: string) => string): string {
  if (p === "qr") return "📱 " + t("QR chuyển khoản");
  if (p === "card") return "💳 " + t("Thẻ");
  if (p === "cod") return "💵 COD";
  return "";
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

  // Gom theo ĐƠN TỔNG (orderCode) — mỗi đơn tổng = 1 khung; đơn nhiều cửa hàng
  // giữ nguyên các đơn con bên trong, KHÔNG tách phẳng ra ngoài. Mới nhất lên đầu.
  const orders = useMemo(
    () => groupOrders(items).sort((a, b) => b.boughtAt.localeCompare(a.boughtAt)),
    [items],
  );
  const total = useMemo(() => items.reduce((s, x) => s + x.total, 0), [items]);
  const fmtTime = (iso: string) => new Date(iso).toLocaleString(lang === "en" ? "en-US" : "vi-VN");

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

            <ul className="space-y-3">
              {orders.map((o) => {
                const blocks = groupByStore(o.items);
                const nItems = o.items.reduce((s, i) => s + i.qty, 0);

                // ĐƠN 1 CỬA HÀNG: 1 card gọn như cũ (không cần khung "đơn tổng" thừa).
                if (blocks.length === 1) {
                  const b = blocks[0];
                  return (
                    <li key={o.key}>
                      <button
                        type="button"
                        onClick={() => setSelected(o)}
                        className="flex w-full items-start justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3 text-left transition hover:border-emerald-400 hover:shadow-sm"
                      >
                        <div className="min-w-0">
                          <div className="truncate text-sm font-bold text-slate-900">
                            {b.items[0].productName}
                            {b.items.length > 1 && (
                              <span className="font-normal text-slate-500"> {t("+{n} món khác", { n: b.items.length - 1 })}</span>
                            )}
                          </div>
                          <div className="mt-0.5 truncate text-xs text-slate-500">{chainLabel(b.chain)} · {b.storeName}</div>
                          <div className="truncate font-mono text-[11px] font-semibold tracking-wide text-emerald-600">{b.code || codeOf(o)}</div>
                          {b.slot && <div className="truncate text-xs text-slate-500">🕐 {t("Giao")}: {t(b.slot)}</div>}
                          {b.pay && <div className="truncate text-xs text-slate-500">{t("Thanh toán")}: {payLabel(b.pay, t)}</div>}
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
                }

                // ĐƠN NHIỀU CỬA HÀNG: 1 KHUNG "đơn tổng" bao các đơn con của từng cửa hàng.
                return (
                  <li key={o.key} className="overflow-hidden rounded-xl border border-slate-300 bg-white shadow-sm">
                    {/* Đầu khung: thời điểm + MÃ ĐƠN NHÁP TỔNG (codeOf — mã thật nếu có, không thì mã AFF sinh ổn định) bên trái, tổng tiền bên phải. */}
                    <div className="flex items-start justify-between gap-3 border-b border-slate-200 bg-slate-50 px-3 py-2.5">
                      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5">
                        <div className="text-xs text-slate-400">{fmtTime(o.boughtAt)}</div>
                        <div className="truncate font-mono text-[11px] font-semibold tracking-wide text-emerald-600">{codeOf(o)}</div>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="font-bold">{formatMoney(o.total, o.currency)}</div>
                        <div className="text-xs text-slate-500">{t("{n} cửa hàng", { n: blocks.length })} · {t("{n} món", { n: nItems })}</div>
                      </div>
                    </div>
                    {/* Các đơn con theo cửa hàng — mỗi cửa hàng 1 dòng, bấm mở chi tiết RIÊNG cửa hàng đó. */}
                    <div className="divide-y divide-slate-100">
                      {blocks.map((b) => (
                        <button
                          key={b.storeId}
                          type="button"
                          onClick={() =>
                            setSelected({
                              ...o,
                              key: `${o.key}:${b.storeId}`,
                              code: b.code || o.code,
                              items: b.items,
                              total: b.total,
                              currency: b.currency,
                              boughtAt: b.items[0].boughtAt,
                            })
                          }
                          className="flex w-full items-start justify-between gap-3 px-3 py-2.5 text-left transition hover:bg-slate-50"
                        >
                          <div className="min-w-0">
                            <div className="truncate text-sm font-semibold text-slate-900">{chainLabel(b.chain)} · {b.storeName}</div>
                            <div className="truncate text-xs text-slate-600">
                              {b.items[0].productName}
                              {b.items.length > 1 && (
                                <span className="text-slate-400"> {t("+{n} món khác", { n: b.items.length - 1 })}</span>
                              )}
                            </div>
                            <div className="truncate font-mono text-[11px] font-semibold tracking-wide text-slate-400">{b.code || codeOf(o)}</div>
                            {b.slot && <div className="truncate text-xs text-slate-500">🕐 {t("Giao")}: {t(b.slot)}</div>}
                            {b.pay && <div className="truncate text-xs text-slate-500">{t("Thanh toán")}: {payLabel(b.pay, t)}</div>}
                          </div>
                          <div className="shrink-0 text-right">
                            <div className="text-sm font-bold text-slate-800">{formatMoney(b.total, b.currency)}</div>
                            <div className="mt-1 inline-flex items-center gap-0.5 text-xs font-medium text-emerald-600">
                              {t("Chi tiết")}
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6" /></svg>
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
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
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setSelected(null)}
        >
          <div
            className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-2xl bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 border-b border-slate-100 p-5 pb-3">
              <div className="min-w-0">
                <h2 className="text-base font-bold">{t("Chi tiết đơn hàng")}</h2>
                <div className="mt-0.5 text-xs text-slate-400">{fmtTime(selected.boughtAt)}</div>
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
              {/* TÁCH THEO CỬA HÀNG: mỗi cửa hàng = 1 khối riêng (mã đơn riêng + SP + thành tiền).
                  Đơn 1 cửa hàng: bỏ dòng "Thành tiền" trong khối (footer đã hiện tổng — tránh lặp). */}
              {(() => {
              const blocks = groupByStore(selected.items);
              return (
              <div className="space-y-3">
                {blocks.map((s) => (
                  <div key={s.storeId} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0 truncate text-sm font-semibold text-slate-800">{chainLabel(s.chain)} · {s.storeName}</div>
                      <span className="shrink-0 font-mono text-[11px] font-bold tracking-wide text-emerald-600">{s.code || codeOf(selected)}</span>
                    </div>
                    <ul className="mt-1.5 divide-y divide-slate-200/70 border-t border-slate-200/70">
                      {s.items.map((it) => (
                        <li key={it.id} className="flex items-start justify-between gap-3 py-2">
                          <div className="min-w-0 text-sm leading-snug text-slate-700">{it.productName}</div>
                          <div className="shrink-0 text-right">
                            <div className="text-sm font-semibold text-slate-800">{formatMoney(it.total, s.currency)}</div>
                            <div className="text-xs text-slate-500">{it.qty} × {formatMoney(it.unitPrice, s.currency)}</div>
                          </div>
                        </li>
                      ))}
                    </ul>
                    {s.slot && (
                      <div className="mt-1.5 flex items-center justify-between border-t border-slate-200/70 pt-1.5 text-sm">
                        <span className="text-slate-500">{t("Khung giờ giao")}</span>
                        <span className="font-medium text-slate-800">🕐 {t(s.slot)}</span>
                      </div>
                    )}
                    {s.pay && (
                      <div className="mt-1.5 flex items-center justify-between border-t border-slate-200/70 pt-1.5 text-sm">
                        <span className="text-slate-500">{t("Thanh toán")}</span>
                        <span className="font-medium text-slate-800">{payLabel(s.pay, t)}</span>
                      </div>
                    )}
                    {/* Đơn nhiều cửa hàng: mỗi khối hiện thành tiền RIÊNG; đơn 1 cửa hàng bỏ
                        (footer đã hiện tổng — tránh lặp "Thành tiền" 2 lần). */}
                    {blocks.length > 1 && (
                      <div className="mt-1.5 flex items-center justify-between border-t border-slate-200/70 pt-1.5 text-sm">
                        <span className="text-slate-500">{t("Thành tiền")}</span>
                        <span className="font-bold text-slate-800">{formatMoney(s.total, s.currency)}</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
              );
              })()}

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
