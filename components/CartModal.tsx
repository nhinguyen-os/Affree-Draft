"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CartItem, RankedOffer } from "@/lib/types";
import { chainLabel } from "@/lib/stores";
import { formatMoney } from "@/lib/util";
import { flushProfile, getProfile } from "@/lib/profile";
import { getOrderConfig } from "@/lib/orderConfig";
import { type Lang, tr } from "@/lib/i18n";

const SLOTS = [
  "Trong hôm nay (2–4 giờ)",
  "Tối nay (18:00–21:00)",
  "Sáng mai (8:00–11:00)",
  "Chiều mai (14:00–17:00)",
];

type StoreGroup = {
  storeId: string;
  storeName: string;
  chain: string;
  currency: string;
  items: CartItem[];
  needEmail: boolean;
  needStorePick: boolean;
  needSlot: boolean;
  authNote: string;
  total: number;
};

export default function CartModal({
  items,
  onClose,
  onUpdateQty,
  onRemove,
  onOrderWithAgent,
  lang = "vi",
}: {
  items: CartItem[];
  onClose: () => void;
  onUpdateQty: (productId: string, storeId: string, qty: number) => void;
  onRemove: (productId: string, storeId: string) => void;
  onOrderWithAgent?: (offers: RankedOffer[]) => void;
  lang?: Lang;
}) {
  const t = (vi: string, vars?: Record<string, string | number>) => tr(lang, vi, vars);

  const saved = useMemo(() => getProfile(), []);
  const [name, setName] = useState(saved.name);
  const [phone, setPhone] = useState(saved.phone);
  const [address, setAddress] = useState(saved.address);
  const [slot, setSlot] = useState(SLOTS[0]);
  const [storeExtras, setStoreExtras] = useState<Record<string, { email?: string }>>({});
  const [phase, setPhase] = useState<"cart" | "submitting" | "done">("cart");
  const [results, setResults] = useState<Record<string, "ok" | "err">>({});

  const bodyRef = useRef<HTMLDivElement>(null);

  // Close on Escape + lock body scroll
  useEffect(() => {
    const handler = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", handler);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handler);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const storeGroups = useMemo((): StoreGroup[] => {
    const map = new Map<string, CartItem[]>();
    for (const item of items) {
      const key = item.offer.store.id;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(item);
    }
    return Array.from(map.entries()).map(([storeId, storeItems]) => {
      const store = storeItems[0].offer.store;
      const cfg = getOrderConfig(store.chain);
      const authNote =
        cfg.auth === "phone-otp"
          ? t("Cần xác minh OTP qua SĐT khi thanh toán")
          : cfg.auth === "account-login"
            ? t("Cần đăng nhập tài khoản khi thanh toán")
            : "";
      return {
        storeId,
        storeName: chainLabel(store.chain) || store.name,
        chain: store.chain,
        currency: store.currency || "VND",
        items: storeItems,
        needEmail: cfg.needEmail,
        needStorePick: cfg.needStorePick,
        needSlot: cfg.needSlot,
        authNote,
        total: storeItems.reduce((s, i) => s + i.offer.price * i.qty, 0),
      };
    });
  }, [items, t]);

  const grandTotal = storeGroups.reduce((s, g) => s + g.total, 0);
  const needAnySlot = storeGroups.some((g) => g.needSlot);

  function setExtra(storeId: string, field: string, val: string) {
    setStoreExtras((prev) => ({
      ...prev,
      [storeId]: { ...prev[storeId], [field]: val },
    }));
  }

  async function placeAll() {
    flushProfile({ name, phone, address });
    setPhase("submitting");
    const next: Record<string, "ok" | "err"> = {};

    for (const group of storeGroups) {
      try {
        const orderCode = `CART-${group.storeId.toUpperCase()}-${Date.now()}`;
        for (const item of group.items) {
          const record = {
            id: `${orderCode}-${item.product.id}`,
            productId: item.product.id,
            productName: item.product.name,
            storeId: group.storeId,
            storeName: group.storeName,
            chain: group.chain,
            qty: item.qty,
            unitPrice: item.offer.price,
            total: item.offer.price * item.qty,
            boughtAt: new Date().toISOString(),
            buyerName: name,
            buyerPhone: phone,
            buyerNote: [address, needAnySlot ? slot : "", storeExtras[group.storeId]?.email || ""]
              .filter(Boolean)
              .join(" | "),
          };
          await fetch("/api/purchases", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(record),
          });
        }
        next[group.storeId] = "ok";
      } catch {
        next[group.storeId] = "err";
      }
    }

    setResults(next);
    setPhase("done");
  }

  const totalItems = items.reduce((s, i) => s + i.qty, 0);

  return (
    <div
      className="fixed inset-0 z-[2000] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/30 backdrop-blur-md" onClick={onClose} />

      {/* Panel — liquid glass */}
      <div className="relative flex w-full max-w-lg flex-col rounded-3xl bg-white/85 backdrop-blur-2xl ring-1 ring-white/60 shadow-2xl max-h-[85vh] sm:max-h-[90vh]" style={{ WebkitBackdropFilter: "blur(32px)" }}>
        {/* Header */}
        <div className="flex shrink-0 items-center gap-2 border-b border-slate-100 px-4 py-3">
          <svg
            className="text-emerald-600"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="9" cy="21" r="1" />
            <circle cx="20" cy="21" r="1" />
            <path d="M1 1h4l2.7 13.4a2 2 0 0 0 2 1.6h9.7a2 2 0 0 0 2-1.6L23 6H6" />
          </svg>
          <h2 className="flex-1 text-base font-semibold text-slate-800">
            {t("Giỏ hàng")}
            <span className="ml-1.5 text-sm font-normal text-slate-500">
              ({totalItems} {t("sản phẩm")})
            </span>
          </h2>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100"
            aria-label={t("Đóng")}
          >
            ✕
          </button>
        </div>

        {/* Scrollable body */}
        <div ref={bodyRef} className="flex-1 overflow-y-auto px-4 pb-4 pt-3">
          {phase === "done" ? (
            /* Success screen */
            <div className="flex flex-col items-center gap-4 py-8 text-center">
              <span className="text-5xl">🎉</span>
              <p className="text-lg font-semibold text-slate-800">{t("Đã ghi nhận đơn hàng!")}</p>
              <div className="w-full space-y-2">
                {storeGroups.map((g) => (
                  <div
                    key={g.storeId}
                    className={`flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-medium ${
                      results[g.storeId] === "ok"
                        ? "bg-emerald-50 text-emerald-700"
                        : "bg-rose-50 text-rose-600"
                    }`}
                  >
                    <span>{results[g.storeId] === "ok" ? "✓" : "✗"}</span>
                    <span>{g.storeName}</span>
                    <span className="ml-auto text-xs font-normal">
                      {results[g.storeId] === "ok" ? t("Thành công") : t("Lỗi, thử lại sau")}
                    </span>
                  </div>
                ))}
              </div>
              <button
                onClick={onClose}
                className="mt-2 rounded-xl bg-emerald-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700"
              >
                {t("Đóng")}
              </button>
            </div>
          ) : (
            <>
              {/* Thông tin chung */}
              <section className="mb-4 rounded-2xl border border-slate-200 p-3">
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {t("Thông tin chung")}
                </h3>
                <div className="space-y-2.5">
                  <label className="block">
                    <span className="mb-1 block text-xs font-medium text-slate-600">
                      {t("Họ tên")}
                    </span>
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder={t("Nguyễn Văn A")}
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs font-medium text-slate-600">
                      {t("Số điện thoại")}
                    </span>
                    <input
                      type="tel"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="0912 345 678"
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs font-medium text-slate-600">
                      {t("Địa chỉ giao hàng")}
                    </span>
                    <textarea
                      value={address}
                      onChange={(e) => setAddress(e.target.value)}
                      rows={2}
                      placeholder={t("Số nhà, đường, phường, quận…")}
                      className="w-full resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                    />
                  </label>
                  {needAnySlot && (
                    <label className="block">
                      <span className="mb-1 block text-xs font-medium text-slate-600">
                        {t("Khung giờ giao")}
                      </span>
                      <select
                        value={slot}
                        onChange={(e) => setSlot(e.target.value)}
                        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                      >
                        {SLOTS.map((s) => (
                          <option key={s} value={s}>
                            {t(s)}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                </div>
              </section>

              {/* Per-store sections */}
              {storeGroups.map((group) => (
                <section
                  key={group.storeId}
                  className="mb-3 rounded-2xl border border-slate-200 p-3"
                >
                  {/* Store header */}
                  <div className="mb-2.5 flex items-center gap-2">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-xs font-bold text-emerald-700">
                      {group.storeName.slice(0, 2).toUpperCase()}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-slate-800 truncate">{group.storeName}</p>
                      <p className="text-xs text-slate-500">
                        {group.items.length} {t("sản phẩm")} ·{" "}
                        <span className="font-medium text-rose-600">
                          {formatMoney(group.total, group.currency)}
                        </span>
                      </p>
                    </div>
                  </div>

                  {/* Item list */}
                  <div className="mb-3 space-y-2">
                    {group.items.map((item) => (
                      <div
                        key={item.product.id}
                        className="flex items-center gap-2 rounded-xl bg-slate-50 p-2"
                      >
                        {item.product.image && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={item.product.image}
                            alt={item.product.name}
                            className="h-12 w-12 shrink-0 rounded-lg object-contain"
                          />
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="line-clamp-2 text-xs font-medium leading-tight text-slate-700">
                            {item.product.name}
                          </p>
                          <p className="mt-0.5 text-xs font-semibold text-rose-600">
                            {formatMoney(item.offer.price * item.qty, group.currency)}
                          </p>
                        </div>
                        {/* Qty control */}
                        <div className="flex shrink-0 items-center gap-1">
                          <button
                            onClick={() =>
                              item.qty <= 1
                                ? onRemove(item.product.id, group.storeId)
                                : onUpdateQty(item.product.id, group.storeId, item.qty - 1)
                            }
                            className="flex h-7 w-7 items-center justify-center rounded-full border border-slate-200 bg-white text-sm font-bold text-slate-600 hover:border-slate-300 hover:bg-slate-100"
                          >
                            −
                          </button>
                          <span className="w-5 text-center text-sm font-semibold text-slate-700">
                            {item.qty}
                          </span>
                          <button
                            onClick={() => onUpdateQty(item.product.id, group.storeId, item.qty + 1)}
                            className="flex h-7 w-7 items-center justify-center rounded-full border border-slate-200 bg-white text-sm font-bold text-slate-600 hover:border-slate-300 hover:bg-slate-100"
                          >
                            +
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Store-specific fields */}
                  <div className="space-y-2">
                    {group.needEmail && (
                      <label className="block">
                        <span className="mb-1 block text-xs font-medium text-slate-600">
                          {t("Email tài khoản")} ({group.storeName})
                        </span>
                        <input
                          type="email"
                          value={storeExtras[group.storeId]?.email || ""}
                          onChange={(e) => setExtra(group.storeId, "email", e.target.value)}
                          placeholder="email@example.com"
                          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                        />
                      </label>
                    )}
                    {group.needStorePick && (
                      <p className="flex items-start gap-1.5 rounded-lg bg-blue-50 px-2.5 py-2 text-xs text-blue-700">
                        <span className="shrink-0">🏪</span>
                        {t("Bạn sẽ chọn siêu thị giao hàng khi thanh toán trên web cửa hàng")}
                      </p>
                    )}
                  </div>
                </section>
              ))}
            </>
          )}
        </div>

        {/* Footer */}
        {phase !== "done" && (
          <div className="shrink-0 border-t border-slate-100 px-4 py-3">
            <div className="mb-2.5 flex items-baseline justify-between">
              <span className="text-sm text-slate-500">{t("Tổng cộng")}</span>
              <span className="text-lg font-bold text-rose-600">{formatMoney(grandTotal, "VND")}</span>
            </div>
            <button
              onClick={() => {
                if (onOrderWithAgent) {
                  // Lấy offer đại diện (item đầu tiên) của mỗi store group
                  const offers = storeGroups.map((g) => g.items[0].offer);
                  onOrderWithAgent(offers);
                } else {
                  placeAll();
                }
              }}
              disabled={phase === "submitting" || !phone.trim() || !address.trim()}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 py-3 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {phase === "submitting" ? (
                <>
                  <span className="animate-spin">⏳</span>
                  {t("Đang gửi…")}
                </>
              ) : (
                <>
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <circle cx="9" cy="21" r="1" />
                    <circle cx="20" cy="21" r="1" />
                    <path d="M1 1h4l2.7 13.4a2 2 0 0 0 2 1.6h9.7a2 2 0 0 0 2-1.6L23 6H6" />
                  </svg>
                  {t("Đặt hàng tất cả")} ({storeGroups.length} {t("cửa hàng")})
                </>
              )}
            </button>
            {(!phone.trim() || !address.trim()) && (
              <p className="mt-1.5 text-center text-xs text-slate-400">
                {t("Vui lòng điền SĐT và địa chỉ giao hàng")}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
