"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import QRCode from "react-qr-code";
import type { CartItem, RankedOffer } from "@/lib/types";
import { chainLabel, chainLogo, chainMinOrder } from "@/lib/stores";
import { formatMoney } from "@/lib/util";
import { flushProfile, getProfile } from "@/lib/profile";
import { addPurchase } from "@/lib/purchases";
import { getOrderConfig } from "@/lib/orderConfig";
import { bumpMetric } from "@/lib/metrics";
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
  onOrdered,
  lang = "vi",
}: {
  items: CartItem[];
  onClose: () => void;
  onUpdateQty: (productId: string, storeId: string, qty: number) => void;
  onRemove: (productId: string, storeId: string) => void;
  /** Trả true nếu đã tự xử lý (mở form khác) → cart không chạy mô phỏng trợ lý. */
  onOrderWithAgent?: (offers: RankedOffer[]) => boolean;
  /** Gọi sau khi đặt xong với danh sách storeId đặt thành công → cha xoá khỏi giỏ. */
  onOrdered?: (okStoreIds: string[]) => void;
  lang?: Lang;
}) {
  const t = (vi: string, vars?: Record<string, string | number>) => tr(lang, vi, vars);

  const saved = useMemo(() => getProfile(), []);
  const [name, setName] = useState(saved.name);
  const [phone, setPhone] = useState(saved.phone);
  const [address, setAddress] = useState(saved.address);
  const [slot, setSlot] = useState(SLOTS[0]);
  const [storeExtras, setStoreExtras] = useState<Record<string, { email?: string; note?: string }>>({});
  const [phase, setPhase] = useState<"cart" | "agent" | "done">("cart");
  const [results, setResults] = useState<Record<string, "ok" | "err">>({});

  // Trợ lý đặt lần lượt từng cửa hàng: si = cửa hàng hiện tại, ki = bước trong cửa hàng đó.
  const [agentSi, setAgentSi] = useState(0);
  const [agentKi, setAgentKi] = useState(0);
  const [otpInput, setOtpInput] = useState("");
  // Thẻ nhập 1 lần cho mọi cửa hàng — xác nhận ở cửa hàng đầu, các cửa hàng sau tự dùng lại.
  const [cardConfirmed, setCardConfirmed] = useState(false);

  // Payment method — không mặc định chọn, user tự chọn (null = chưa chọn)
  type PayMethod = "qr" | "card" | "cod";
  const [payMethod, setPayMethod] = useState<PayMethod | null>(null);
  const [cardNumber, setCardNumber] = useState("");
  const [cardName, setCardName] = useState("");
  const [cardExp, setCardExp] = useState("");
  const [cardCvv, setCardCvv] = useState("");

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

  // Thẻ hợp lệ — dùng ở BƯỚC TRỢ LÝ (nhập thẻ khi thanh toán), không phải ở giỏ.
  const cardReady =
    cardNumber.replace(/\s/g, "").length >= 12 &&
    cardName.trim().length > 0 &&
    /^\d{2}\/\d{2}$/.test(cardExp) &&
    cardCvv.length >= 3;
  // Giỏ chỉ cần: đủ thông tin giao + đã CHỌN phương thức (QR/thẻ thao tác ở bước trợ lý).
  const paymentReady = payMethod !== null;
  const orderHint =
    !phone.trim() || !address.trim()
      ? t("Nhập đủ tên, số điện thoại và địa chỉ để bắt đầu.")
      : !payMethod
        ? t("Chọn phương thức thanh toán để tiếp tục.")
        : "";

  function setExtra(storeId: string, field: string, val: string) {
    setStoreExtras((prev) => ({
      ...prev,
      [storeId]: { ...prev[storeId], [field]: val },
    }));
  }

  // Kế hoạch các bước trợ lý cho TỪNG cửa hàng — bước định danh khác nhau tuỳ auth của nguồn.
  type AgentStep = { label: string; pause?: "otp" | "login" | "pay-qr" | "pay-card"; ok?: boolean };
  const agentPlan = useMemo(() => storeGroups.map((g) => {
    const cfg = getOrderConfig(g.chain);
    const steps: AgentStep[] = [{ label: t("Mở website {chain}…", { chain: g.storeName }) }];
    if (cfg.auth === "phone-otp") {
      steps.push({ label: t("Nhập số điện thoại {phone}…", { phone: phone || t("(của bạn)") }) });
      steps.push({ label: t("{chain} gửi mã OTP về {phone}", { chain: g.storeName, phone: phone || t("điện thoại của bạn") }), pause: "otp" });
    } else if (cfg.auth === "account-login") {
      steps.push({ label: t("Đăng nhập tài khoản {chain}…", { chain: g.storeName }), pause: "login" });
    } else {
      steps.push({ label: t("Điền số điện thoại {phone} (mua nhanh, không cần đăng nhập)…", { phone: phone || t("(của bạn)") }) });
    }
    steps.push({ label: t("Thêm {n} sản phẩm vào giỏ…", { n: g.items.length }) });
    steps.push({ label: t("Điền địa chỉ giao…") });
    if (cfg.needSlot) steps.push({ label: t('Chọn khung giờ "{slot}"…', { slot: t(slot) }) });
    // Thanh toán ngay tại cửa hàng — QR để quét / nhập thẻ (tuỳ phương thức đã chọn ở giỏ).
    if (payMethod === "qr") steps.push({ label: t("Quét QR chuyển khoản cho {chain}…", { chain: g.storeName }), pause: "pay-qr" });
    else if (payMethod === "card") steps.push({ label: t("Nhập thẻ thanh toán…"), pause: "pay-card" });
    else if (payMethod === "cod") steps.push({ label: t("Thanh toán khi nhận hàng (COD)…") });
    steps.push({ label: t("Xác nhận & gửi đơn tới {chain}…", { chain: g.storeName }) });
    steps.push({ label: t("Đặt thành công tại {chain}", { chain: g.storeName }), ok: true });
    return { group: g, steps };
  }), [storeGroups, phone, slot, payMethod, t]);

  // Ghi nhận đơn (localStorage + Sheet) rồi sang màn thành công — gọi khi trợ lý xong hết cửa hàng.
  async function finalizeOrder() {
    const next: Record<string, "ok" | "err"> = {};
    for (const group of storeGroups) {
      try {
        for (const item of group.items) {
          await addPurchase({
            productId: item.product.id,
            productName: item.product.name,
            storeId: group.storeId,
            storeName: group.storeName,
            chain: group.chain,
            qty: item.qty,
            unitPrice: item.offer.price,
            buyerName: name,
            buyerPhone: phone,
            buyerAddr: address,
            buyerNote: [needAnySlot ? slot : "", storeExtras[group.storeId]?.email || "", storeExtras[group.storeId]?.note?.trim() || ""]
              .filter(Boolean)
              .join(" | "),
          });
        }
        next[group.storeId] = "ok";
        bumpMetric("order");
      } catch {
        next[group.storeId] = "err";
      }
    }
    setResults(next);
    setPhase("done");
    const okStoreIds = Object.entries(next).filter(([, v]) => v === "ok").map(([id]) => id);
    if (okStoreIds.length) onOrdered?.(okStoreIds);
  }

  // Bấm "Để trợ lý đặt giúp" → khởi động mô phỏng trợ lý (thay vì đặt tức thì).
  function startAgent() {
    flushProfile({ name, phone, address });
    setAgentSi(0);
    setAgentKi(0);
    setOtpInput("");
    setCardConfirmed(false);
    setPhase("agent");
  }

  // Sang bước kế tiếp (dùng cho auto-tick lẫn khi user gửi OTP / xác nhận đăng nhập).
  function advanceAgent() {
    const store = agentPlan[agentSi];
    if (!store) return;
    if (agentKi < store.steps.length - 1) setAgentKi(agentKi + 1);
    else if (agentSi < agentPlan.length - 1) { setAgentSi(agentSi + 1); setAgentKi(0); }
    else finalizeOrder();
  }

  // Auto chạy các bước không cần bạn; dừng ở bước pause (OTP/đăng nhập) chờ thao tác.
  useEffect(() => {
    if (phase !== "agent") return;
    const store = agentPlan[agentSi];
    const cur = store?.steps[agentKi];
    if (!cur) return;
    // Bước thẻ đã xác nhận từ cửa hàng trước → không dừng lại nữa, tự chạy qua.
    const paused = cur.pause && !(cur.pause === "pay-card" && cardConfirmed);
    if (paused) return;
    const timer = setTimeout(() => advanceAgent(), cur.ok ? 550 : 850);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, agentSi, agentKi, agentPlan, cardConfirmed]);

  const totalItems = items.reduce((s, i) => s + i.qty, 0);

  // Tải mã QR về máy (SVG → PNG, phóng 4× cho nét/dễ quét).
  const downloadQr = (storeId: string, storeName: string) => {
    const svg = document.querySelector(`[data-qr="${(window.CSS?.escape ?? ((x: string) => x))(storeId)}"] svg`) as SVGSVGElement | null;
    if (!svg) return;
    const xml = new XMLSerializer().serializeToString(svg);
    const src = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(xml)))}`;
    const img = new Image();
    img.onload = () => {
      const size = 288; // 72 × 4
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, size, size);
      ctx.drawImage(img, 0, 0, size, size);
      const a = document.createElement("a");
      a.href = canvas.toDataURL("image/png");
      a.download = `QR-${storeName.replace(/[^\p{L}\p{N}]+/gu, "-")}.png`;
      a.click();
    };
    img.src = src;
  };

  return (
    <div
      className="fixed inset-0 z-[2200] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/30 backdrop-blur-md" onClick={onClose} />

      {/* Panel — liquid glass */}
      <div className="liquid-glass relative flex w-full max-w-lg flex-col rounded-3xl max-h-[85vh] sm:max-h-[90vh]">
        {/* Header */}
        <div className="flex shrink-0 items-center gap-2 border-b border-slate-100 px-4 py-3">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-base font-bold text-slate-900">
              {phase === "done" ? t("Đã ghi nhận đơn hàng") : t("Phục vụ bởi Affree Agentic AI - AAAI")}
            </h2>
            <p className="truncate text-xs text-slate-500">
              {t("Giỏ hàng")} · {totalItems} {t("sản phẩm")}
            </p>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 flex h-8 w-8 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100"
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
                className="mt-2 rounded-xl border border-slate-200 bg-emerald-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700"
              >
                {t("Đóng")}
              </button>
            </div>
          ) : phase === "agent" ? (
            /* ── Trợ lý đặt lần lượt từng cửa hàng (đăng nhập/OTP tuỳ nguồn) ── */
            <>
              <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50/60 px-3 py-2.5 text-xs text-amber-800">
                🤖 {t("Trợ lý đang đặt lần lượt tại từng cửa hàng — dừng lại khi cần bạn nhập OTP / đăng nhập.")}
              </div>
              {agentPlan.map((sp, i) => {
                const g = sp.group;
                const doneStore = i < agentSi;
                const activeStore = i === agentSi;
                return (
                  <section
                    key={g.storeId}
                    className={`mb-3 rounded-2xl border p-3 ${activeStore ? "border-emerald-300" : "border-slate-200"} ${i > agentSi ? "opacity-50" : ""}`}
                  >
                    <div className="mb-2 flex items-center gap-2">
                      <span className="relative flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full bg-emerald-100 text-[10px] font-bold text-emerald-700 ring-1 ring-slate-200">
                        {g.storeName.slice(0, 2).toUpperCase()}
                        {chainLogo(g.chain) && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={chainLogo(g.chain)} alt={g.storeName} className="absolute inset-0 h-full w-full bg-white object-contain p-0.5" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
                        )}
                      </span>
                      <p className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-800">{g.storeName}</p>
                      {doneStore && <span className="text-sm font-bold text-emerald-600">✓</span>}
                      {i > agentSi && <span className="text-xs text-slate-400">{t("Chờ…")}</span>}
                    </div>

                    {(doneStore || activeStore) && (
                      <div className="space-y-1.5">
                        {sp.steps.map((st, k) => {
                          const show = doneStore || k <= agentKi;
                          if (!show) return null;
                          const stepDone = doneStore || k < agentKi;
                          const isCurrent = activeStore && k === agentKi;
                          return (
                            <div key={k}>
                              <div className="flex items-center gap-2 text-xs text-slate-600">
                                {stepDone || (isCurrent && st.ok) ? (
                                  <span className="shrink-0 text-emerald-500">✓</span>
                                ) : isCurrent && st.pause && !(st.pause === "pay-card" && cardConfirmed) ? (
                                  <span className="shrink-0">🔒</span>
                                ) : (
                                  <span className="inline-block h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-slate-300 border-t-emerald-500" />
                                )}
                                <span className={st.ok && (stepDone || isCurrent) ? "font-medium text-emerald-700" : ""}>
                                  {st.pause === "pay-card" && cardConfirmed ? t("Thanh toán bằng thẻ đã lưu…") : st.label}
                                </span>
                              </div>

                              {/* Chờ bạn nhập OTP */}
                              {isCurrent && st.pause === "otp" && (
                                <div className="mt-1.5 flex gap-2 pl-5">
                                  <input
                                    type="tel"
                                    value={otpInput}
                                    onChange={(e) => setOtpInput(e.target.value.replace(/\D/g, ""))}
                                    placeholder={t("Nhập mã OTP")}
                                    className="w-full rounded-lg border border-emerald-300 px-3 py-1.5 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                                  />
                                  <button
                                    onClick={() => { setOtpInput(""); advanceAgent(); }}
                                    disabled={otpInput.trim().length < 3}
                                    className="shrink-0 rounded-lg bg-emerald-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:bg-slate-300"
                                  >
                                    {t("Gửi")}
                                  </button>
                                </div>
                              )}

                              {/* Chờ bạn đăng nhập */}
                              {isCurrent && st.pause === "login" && (
                                <div className="mt-1.5 pl-5">
                                  <button
                                    onClick={() => advanceAgent()}
                                    className="rounded-lg bg-emerald-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700"
                                  >
                                    {t("Tôi đã đăng nhập {chain}", { chain: g.storeName })}
                                  </button>
                                </div>
                              )}

                              {/* Thanh toán QR — quét mã của cửa hàng này */}
                              {isCurrent && st.pause === "pay-qr" && (
                                <div className="mt-1.5 pl-5">
                                  <div className="flex items-center gap-3 rounded-xl bg-slate-50 p-2.5">
                                    <div data-qr={g.storeId} className="shrink-0 rounded-lg bg-white p-1.5 shadow-sm">
                                      <QRCode
                                        value={`Chuyen khoan: ${g.storeName} | So tien: ${g.total} VND | SDT: ${phone} | ${g.storeId}`}
                                        size={72}
                                        level="M"
                                      />
                                    </div>
                                    <div className="min-w-0 flex-1">
                                      <p className="text-xs text-slate-500">{t("Quét QR để chuyển khoản")}</p>
                                      <p className="mt-1 text-sm font-bold text-rose-600">{formatMoney(g.total, g.currency)}</p>
                                      <button
                                        type="button"
                                        onClick={() => downloadQr(g.storeId, g.storeName)}
                                        className="mt-1.5 inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 transition hover:bg-slate-50"
                                      >
                                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
                                        {t("Tải QR")}
                                      </button>
                                    </div>
                                  </div>
                                  <button
                                    onClick={() => advanceAgent()}
                                    className="mt-2 rounded-lg bg-emerald-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700"
                                  >
                                    {t("Tôi đã chuyển khoản")}
                                  </button>
                                </div>
                              )}

                              {/* Thanh toán Thẻ — nhập thẻ (nhập 1 lần, cửa hàng sau tự dùng lại) */}
                              {isCurrent && st.pause === "pay-card" && !cardConfirmed && (
                                <div className="mt-1.5 space-y-2 pl-5">
                                  <input
                                    type="text"
                                    inputMode="numeric"
                                    maxLength={19}
                                    value={cardNumber}
                                    onChange={(e) => setCardNumber(e.target.value.replace(/\D/g, "").replace(/(.{4})/g, "$1 ").trim())}
                                    placeholder={t("Số thẻ") + " 0000 0000 0000 0000"}
                                    className="w-full rounded-lg border border-emerald-300 px-3 py-1.5 text-sm font-mono outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                                  />
                                  <input
                                    type="text"
                                    value={cardName}
                                    onChange={(e) => setCardName(e.target.value.toUpperCase())}
                                    placeholder={t("Tên chủ thẻ")}
                                    className="w-full rounded-lg border border-emerald-300 px-3 py-1.5 text-sm font-mono outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                                  />
                                  <div className="flex gap-2">
                                    <input
                                      type="text"
                                      maxLength={5}
                                      value={cardExp}
                                      onChange={(e) => { const v = e.target.value.replace(/\D/g, ""); setCardExp(v.length > 2 ? `${v.slice(0,2)}/${v.slice(2)}` : v); }}
                                      placeholder="MM/YY"
                                      className="w-full rounded-lg border border-emerald-300 px-3 py-1.5 text-sm font-mono outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                                    />
                                    <input
                                      type="password"
                                      maxLength={4}
                                      value={cardCvv}
                                      onChange={(e) => setCardCvv(e.target.value.replace(/\D/g, ""))}
                                      placeholder="CVV"
                                      className="w-full rounded-lg border border-emerald-300 px-3 py-1.5 text-sm font-mono outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                                    />
                                  </div>
                                  <button
                                    onClick={() => { setCardConfirmed(true); advanceAgent(); }}
                                    disabled={!cardReady}
                                    className="rounded-lg bg-emerald-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:bg-slate-300"
                                  >
                                    {t("Thanh toán {amount}", { amount: formatMoney(g.total, g.currency) })}
                                  </button>
                                  <p className="mt-1 text-[11px] text-slate-400">{t("Nhập 1 lần — các cửa hàng sau tự dùng lại thẻ này.")}</p>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </section>
                );
              })}
            </>
          ) : (
            <>
              {/* Thông tin chung */}
              <section className="mb-4 rounded-2xl border border-slate-200 p-3">
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {t("Thông tin chung")}
                </h3>
                <div className="space-y-2.5">
                  <Field label={t("Họ tên")}>
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder={t("Nguyễn Văn A")}
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                    />
                  </Field>
                  <Field label={t("Số điện thoại / Zalo")}>
                    <input
                      type="tel"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="0912 345 678"
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                    />
                  </Field>
                  <Field label={t("Địa chỉ giao hàng")}>
                    <textarea
                      value={address}
                      onChange={(e) => setAddress(e.target.value)}
                      rows={2}
                      placeholder={t("Số nhà, đường, phường, quận…")}
                      className="w-full resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                    />
                  </Field>
                  {needAnySlot && (
                    <Field label={t("Khung giờ giao")}>
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
                    </Field>
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
                    <span className="relative flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-emerald-100 text-xs font-bold text-emerald-700 ring-1 ring-slate-200">
                      {group.storeName.slice(0, 2).toUpperCase()}
                      {chainLogo(group.chain) && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={chainLogo(group.chain)}
                          alt={group.storeName}
                          className="absolute inset-0 h-full w-full bg-white object-contain p-0.5"
                          onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                        />
                      )}
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
                            {formatMoney(item.offer.price, group.currency)}
                            {item.qty > 1 && (
                              <span className="ml-1 font-normal text-slate-400">× {item.qty}</span>
                            )}
                          </p>
                          {(item.autoQty ?? 0) > 0 && (
                            <p className="mt-0.5 text-[10px] font-medium text-blue-500">
                              +{item.autoQty} tự thêm để đủ mua tối thiểu {chainMinOrder(group.chain as Parameters<typeof chainMinOrder>[0]) > 0 ? `(${formatMoney(chainMinOrder(group.chain as Parameters<typeof chainMinOrder>[0]), group.currency)})` : ""}
                            </p>
                          )}
                        </div>
                        {/* Qty control */}
                        <div className="flex shrink-0 items-center gap-1">
                          <button
                            onClick={() =>
                              // Bộ đếm thuần: giảm đúng 1. Tới 1 rồi bấm nữa mới bỏ món.
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
                      <Field label={`${t("Email tài khoản")} (${group.storeName})`}>
                        <input
                          type="email"
                          value={storeExtras[group.storeId]?.email || ""}
                          onChange={(e) => setExtra(group.storeId, "email", e.target.value)}
                          placeholder="email@example.com"
                          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                        />
                      </Field>
                    )}
                    {group.needStorePick && (
                      <p className="flex items-start gap-1.5 rounded-lg bg-blue-50 px-2.5 py-2 text-xs text-blue-700">
                        <span className="shrink-0">🏪</span>
                        {t("Bạn sẽ chọn siêu thị giao hàng khi thanh toán trên web cửa hàng")}
                      </p>
                    )}
                    {/* Ghi chú riêng cho TỪNG cửa hàng — gửi kèm đơn của cửa hàng đó */}
                    <Field label={t("Ghi chú")}>
                      <textarea
                        value={storeExtras[group.storeId]?.note || ""}
                        onChange={(e) => setExtra(group.storeId, "note", e.target.value)}
                        rows={2}
                        placeholder={t("Ghi chú (tuỳ chọn): màu sắc, kích cỡ, thời gian nhận…")}
                        className="w-full resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                      />
                    </Field>
                  </div>
                </section>
              ))}
            {/* ── Thanh toán ── */}
            <section className="mb-3 rounded-2xl border border-slate-200 p-3">
              <h3 className="mb-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
                {t("Thanh toán")}
              </h3>
              {/* Tabs */}
              <div className="mb-3 flex gap-1.5">
                {(["qr", "card", "cod"] as PayMethod[]).map((m) => (
                  <button
                    key={m}
                    onClick={() => setPayMethod(m)}
                    className={`flex-1 rounded-lg border py-1.5 text-xs font-semibold transition-colors ${payMethod === m ? "border-emerald-500 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"}`}
                  >
                    {m === "qr" ? "📱 QR" : m === "card" ? "💳 " + t("Thẻ") : "💵 COD"}
                  </button>
                ))}
              </div>

              {/* Chỉ CHỌN phương thức ở giỏ; QR/nhập thẻ sẽ hiện ở bước trợ lý tại từng cửa hàng. */}
              {payMethod && (
                <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
                  {payMethod === "qr"
                    ? "📱 " + t("Trợ lý sẽ hiện mã QR để bạn quét tại từng cửa hàng khi đặt.")
                    : payMethod === "card"
                      ? "💳 " + t("Bạn sẽ nhập thẻ ở bước trợ lý đặt hàng.")
                      : "💵 " + t("Thanh toán khi nhận hàng (COD) — nhân viên giao hàng thu tiền mặt.")}
                </p>
              )}
            </section>
            </>
          )}
        </div>

        {/* Footer — chỉ ở bước giỏ (bước trợ lý có nút OTP/đăng nhập riêng inline) */}
        {phase === "cart" && (
          <div className="shrink-0 border-t border-slate-100 px-4 py-3">
            <div className="mb-2.5 flex items-baseline justify-between">
              <span className="text-sm text-slate-500">{t("Tổng cộng")}</span>
              <span className="text-lg font-bold text-rose-600">{formatMoney(grandTotal, "VND")}</span>
            </div>
            <button
              onClick={() => {
                // onOrderWithAgent trả true nếu đã tự xử lý (vd giỏ toàn nhạc → mở form nhạc).
                // Trả false/không có → chạy mô phỏng trợ lý đặt từng cửa hàng (startAgent).
                const offers = storeGroups.map((g) => g.items[0].offer);
                if (onOrderWithAgent && onOrderWithAgent(offers)) return;
                startAgent();
              }}
              disabled={!phone.trim() || !address.trim() || !paymentReady}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-emerald-600 py-3 text-sm font-semibold text-white shadow-[0_4px_14px_rgba(16,185,129,0.35),inset_0_1px_0_rgba(255,255,255,0.25)] transition-all duration-150 hover:bg-emerald-700 active:scale-[0.98] active:shadow-[0_2px_8px_rgba(16,185,129,0.25)] disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500 disabled:shadow-none disabled:hover:bg-slate-300"
            >
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
              {t("Để trợ lý đặt giúp →")} ({storeGroups.length} {t("cửa hàng")})
            </button>
            {orderHint && (
              <p className="mt-1.5 text-center text-xs text-slate-400">
                {orderHint}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold text-slate-800">{label}</span>
      {children}
    </label>
  );
}
