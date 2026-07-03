"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import QRCode from "react-qr-code";
import type { CartItem, RankedOffer } from "@/lib/types";
import { chainLabel, chainLogo, chainMinOrder } from "@/lib/stores";
import { formatMoney } from "@/lib/util";
import { flushProfile, getProfile } from "@/lib/profile";
import { getSavedCard, saveCard, type SavedCard } from "@/lib/cards";
import { addPurchase } from "@/lib/purchases";
import { getOrderConfig } from "@/lib/orderConfig";
import { bumpMetric } from "@/lib/metrics";
import { type Lang, tr } from "@/lib/i18n";
import { acquireBodyScrollLock } from "@/lib/scroll-lock";
import OrderInfoSection from "./OrderInfoSection";

const SLOTS = [
  "Trong hôm nay (2–4 giờ)",
  "Tối nay (18:00–21:00)",
  "Sáng mai (8:00–11:00)",
  "Chiều mai (14:00–17:00)",
];

// Loại thẻ chấp nhận — hiện chip ở form nhập thẻ; chip sáng theo đầu số đang gõ.
const CARD_BRANDS = ["Visa", "Mastercard", "JCB", "Amex", "Napas"] as const;
type CardBrand = (typeof CARD_BRANDS)[number];
// Màu chip khi khớp đầu số (Visa xanh navy, Mastercard đỏ… theo màu nhận diện brand).
const CARD_BRAND_STYLE: Record<CardBrand, string> = {
  Visa: "border-[#1A1F71] bg-[#1A1F71]/5 text-[#1A1F71]",
  Mastercard: "border-[#EB001B] bg-[#EB001B]/5 text-[#EB001B]",
  JCB: "border-emerald-600 bg-emerald-50 text-emerald-700",
  Amex: "border-sky-600 bg-sky-50 text-sky-700",
  Napas: "border-teal-600 bg-teal-50 text-teal-700",
};
/** Nhận diện loại thẻ theo đầu số: 4=Visa, 51-55/22-27=Mastercard, 34/37=Amex, 35=JCB, 9704=Napas nội địa. */
function detectCardBrand(num: string): CardBrand | null {
  const n = num.replace(/\s/g, "");
  if (!n) return null;
  if (n.startsWith("9704")) return "Napas";
  if (/^4/.test(n)) return "Visa";
  if (/^(5[1-5]|2[2-7])/.test(n)) return "Mastercard";
  if (/^3[47]/.test(n)) return "Amex";
  if (/^35/.test(n)) return "JCB";
  return null;
}

type StoreGroup = {
  storeId: string;
  storeName: string;
  chain: string;
  currency: string;
  items: CartItem[];
  needEmail: boolean;
  needStorePick: boolean;
  needSlot: boolean;
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
  // Khung giờ giao RIÊNG theo từng nguồn (storeId → slot) — mỗi nguồn giao một khung khác nhau được.
  const [storeSlots, setStoreSlots] = useState<Record<string, string>>({});
  const slotOf = (storeId: string) => storeSlots[storeId] ?? SLOTS[0];
  const [storeExtras, setStoreExtras] = useState<Record<string, { email?: string; note?: string }>>({});
  const [phase, setPhase] = useState<"cart" | "agent" | "done">("cart");
  const [results, setResults] = useState<Record<string, "ok" | "err">>({});
  // Mã đơn hiện ở màn thành công (đồng bộ định dạng với Mua ngay / Mua cả túi).
  const [orderCode, setOrderCode] = useState("");

  // Nhiều trợ lý chạy SONG SONG — agentKis[i] = bước hiện tại của cửa hàng thứ i.
  const [agentKis, setAgentKis] = useState<number[]>([]);
  // Thẻ nhập 1 lần cho mọi cửa hàng — xác nhận ở cửa hàng đầu, các cửa hàng sau tự dùng lại.
  const [cardConfirmed, setCardConfirmed] = useState(false);

  // Payment method — không mặc định chọn, user tự chọn (null = chưa chọn)
  type PayMethod = "qr" | "card" | "cod";
  const [payMethod, setPayMethod] = useState<PayMethod | null>(null);
  const [cardNumber, setCardNumber] = useState("");
  const [cardName, setCardName] = useState("");
  const [cardExp, setCardExp] = useState("");
  const [cardCvv, setCardCvv] = useState("");
  // Thẻ đã lưu từ lần mua trước (localStorage) — có thì mặc định dùng lại, khỏi nhập.
  const [savedCard] = useState<SavedCard | null>(() => getSavedCard());
  const [useNewCard, setUseNewCard] = useState(false);
  // Xem full số thẻ đã lưu: bấm 👁 → OTP (mô phỏng) gửi tới SĐT → nhập đúng mới hiện.
  const [otpCode, setOtpCode] = useState<string | null>(null); // null = chưa yêu cầu xem
  const [otpInput, setOtpInput] = useState("");
  const [otpError, setOtpError] = useState(false);
  const [cardRevealed, setCardRevealed] = useState(false);

  const bodyRef = useRef<HTMLDivElement>(null);

  // Close on Escape + lock body scroll (refcount chung — xem lib/scroll-lock.ts)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", handler);
    const release = acquireBodyScrollLock();
    return () => {
      document.removeEventListener("keydown", handler);
      release();
    };
  }, [onClose]);

  const storeGroups = useMemo((): StoreGroup[] => {
    const map = new Map<string, CartItem[]>();
    for (const item of items) {
      const key = item.offer.store.id;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(item);
    }
    const groups = Array.from(map.entries()).map(([storeId, storeItems]) => {
      const store = storeItems[0].offer.store;
      const cfg = getOrderConfig(store.chain);
      return {
        storeId,
        storeName: chainLabel(store.chain) || store.name,
        chain: store.chain,
        currency: store.currency || "VND",
        items: storeItems,
        needEmail: cfg.needEmail,
        needStorePick: cfg.needStorePick,
        needSlot: cfg.needSlot,
        total: storeItems.reduce((s, i) => s + i.offer.price * i.qty, 0),
      };
    });
    // Một chuỗi có 2+ chi nhánh trong giỏ → hiện tên chi nhánh đầy đủ để phân biệt
    // (tránh 2 section cùng tên "Co.opmart" không biết cái nào của chi nhánh nào).
    const chainCount = new Map<string, number>();
    for (const g of groups) chainCount.set(g.chain, (chainCount.get(g.chain) ?? 0) + 1);
    return groups.map((g) =>
      (chainCount.get(g.chain) ?? 0) > 1 && g.items[0].offer.store.name
        ? { ...g, storeName: g.items[0].offer.store.name }
        : g
    );
  }, [items, t]);

  const grandTotal = storeGroups.reduce((s, g) => s + g.total, 0);

  // Đang dùng thẻ ĐÃ LƯU (mặc định khi có) hay nhập thẻ mới.
  const usingSavedCard = !!savedCard && !useNewCard;
  // Thẻ hợp lệ — thẻ đã lưu coi như sẵn sàng (CVV không lưu, mô phỏng bỏ qua);
  // thẻ mới thì điền ngay Ở GIỎ (điền đủ → trợ lý tự thanh toán, bỏ trống → hỏi ở bước đặt).
  const newCardReady =
    cardNumber.replace(/\s/g, "").length >= 12 &&
    cardName.trim().length > 0 &&
    /^\d{2}\/\d{2}$/.test(cardExp) &&
    cardCvv.length >= 3;
  const cardReady = usingSavedCard || newCardReady;
  // Số thẻ "hiệu lực" cho brand/last4: thẻ lưu hay thẻ đang gõ.
  const activeCardNumber = usingSavedCard ? savedCard!.number : cardNumber;
  const cardBrand = usingSavedCard ? (savedCard!.brand as CardBrand | null) : detectCardBrand(activeCardNumber);
  const cardLast4 = activeCardNumber.replace(/\D/g, "").slice(-4);
  // Nhãn thẻ dạng che số: "Visa ****1111".
  const maskedCardLabel = `${cardBrand ?? t("Thẻ")} ****${cardLast4}`;
  // Bấm 👁: đang hiện → che lại; đang che → sinh OTP 6 số "gửi" tới SĐT (mô phỏng,
  // mã hiện trong khung tin-nhắn-giả bên dưới), nhập đúng mới hiện full số thẻ.
  const requestRevealCard = () => {
    if (cardRevealed) {
      setCardRevealed(false);
      setOtpCode(null);
      setOtpInput("");
      setOtpError(false);
      return;
    }
    setOtpCode(String(Math.floor(100000 + Math.random() * 900000)));
    setOtpInput("");
    setOtpError(false);
  };
  const verifyOtp = () => {
    if (otpInput === otpCode) {
      setCardRevealed(true);
      setOtpCode(null);
      setOtpError(false);
    } else {
      setOtpError(true);
    }
  };
  // Hàng chip "Chấp nhận: VISA MASTERCARD…" — dùng ở giỏ lẫn bước trợ lý cho đồng nhất.
  const brandChipsRow = (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-[10px] text-slate-400">{t("Chấp nhận")}:</span>
      {CARD_BRANDS.map((b) => (
        <span
          key={b}
          className={`rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide transition ${
            cardBrand === b
              ? CARD_BRAND_STYLE[b] + " ring-1 ring-current"
              : "border-slate-200 text-slate-400" + (cardBrand ? " opacity-40" : "")
          }`}
        >
          {b}
        </span>
      ))}
    </div>
  );
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

  // Kế hoạch các bước trợ lý cho TỪNG cửa hàng.
  // Affree đặt hộ bằng tài khoản Affree trên nguồn — khách KHÔNG dừng ở bước đăng nhập/OTP,
  // chỉ còn pause ở thanh toán (QR/thẻ).
  type AgentStep = { label: string; pause?: "pay-qr" | "pay-card"; ok?: boolean };
  const agentPlan = useMemo(() => storeGroups.map((g) => {
    const cfg = getOrderConfig(g.chain);
    const steps: AgentStep[] = [{ label: t("Mở website {chain}…", { chain: g.storeName }) }];
    steps.push({ label: t("Thêm {n} sản phẩm vào giỏ…", { n: g.items.length }) });
    steps.push({ label: t("Điền thông tin nhận hàng: địa chỉ + SĐT {phone}…", { phone: phone || t("(của bạn)") }) });
    if (cfg.needSlot) steps.push({ label: t('Chọn khung giờ "{slot}"…', { slot: t(slotOf(g.storeId)) }) });
    // Thanh toán ngay tại cửa hàng — QR để quét / nhập thẻ (tuỳ phương thức đã chọn ở giỏ).
    if (payMethod === "qr") steps.push({ label: t("Quét QR chuyển khoản cho {chain}…", { chain: g.storeName }), pause: "pay-qr" });
    else if (payMethod === "card") steps.push({ label: t("Nhập thẻ thanh toán…"), pause: "pay-card" });
    else if (payMethod === "cod") steps.push({ label: t("Thanh toán khi nhận hàng (COD)…") });
    steps.push({ label: t("Xác nhận & gửi đơn tới {chain}…", { chain: g.storeName }) });
    steps.push({ label: t("Đặt thành công tại {chain}", { chain: g.storeName }), ok: true });
    return { group: g, steps };
  }), [storeGroups, phone, storeSlots, payMethod, t]);

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
            buyerNote: [group.needSlot ? slotOf(group.storeId) : "", storeExtras[group.storeId]?.email || "", storeExtras[group.storeId]?.note?.trim() || ""]
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
    setOrderCode("AFF-" + String(Date.now()).slice(-6) + "-" + Math.floor(Math.random() * 900 + 100));
    setPhase("done");
    const okStoreIds = Object.entries(next).filter(([, v]) => v === "ok").map(([id]) => id);
    if (okStoreIds.length) onOrdered?.(okStoreIds);
  }

  // Bấm "Để trợ lý đặt giúp" → khởi động mô phỏng trợ lý (thay vì đặt tức thì).
  function startAgent() {
    flushProfile({ name, phone, address });
    setAgentKis(storeGroups.map(() => 0));
    // Thẻ đã điền ĐỦ ở giỏ → coi như xác nhận luôn, trợ lý tự thanh toán không dừng hỏi.
    setCardConfirmed(payMethod === "card" && cardReady);
    // Thẻ MỚI hợp lệ → lưu lại (localStorage, không CVV) cho lần mua sau chọn nhanh.
    if (payMethod === "card" && !usingSavedCard && newCardReady) {
      saveCard({ number: cardNumber, name: cardName, exp: cardExp, brand: detectCardBrand(cardNumber) });
    }
    setPhase("agent");
  }

  // Sang bước kế tiếp của MỘT cửa hàng (auto-tick lẫn khi user xác nhận thanh toán).
  function advanceStore(i: number) {
    setAgentKis((prev) => {
      const len = agentPlan[i]?.steps.length ?? 0;
      if (!len || (prev[i] ?? 0) >= len - 1) return prev;
      const next = [...prev];
      next[i] = (next[i] ?? 0) + 1;
      return next;
    });
  }

  // Auto chạy các bước không cần bạn — từng cửa hàng tick ĐỘC LẬP, chỉ dừng ở
  // bước pause (thanh toán QR/thẻ) của riêng nó.
  useEffect(() => {
    if (phase !== "agent") return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    agentPlan.forEach((sp, i) => {
      const ki = agentKis[i] ?? 0;
      const cur = sp.steps[ki];
      if (!cur || ki >= sp.steps.length - 1) return;
      // Bước thẻ đã xác nhận (từ giỏ / cửa hàng khác) → không dừng, tự chạy qua.
      const paused = cur.pause && !(cur.pause === "pay-card" && cardConfirmed);
      if (paused) return;
      // Lệch nhịp nhẹ giữa các cửa hàng cho cảm giác nhiều trợ lý chạy song song.
      timers.push(setTimeout(() => advanceStore(i), (cur.ok ? 550 : 850) + i * 180));
    });
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, agentKis, agentPlan, cardConfirmed]);

  // Mọi cửa hàng đã tới bước cuối → chốt đơn.
  useEffect(() => {
    if (phase !== "agent" || !agentPlan.length) return;
    const allDone = agentPlan.every((sp, i) => (agentKis[i] ?? 0) >= sp.steps.length - 1);
    if (!allDone) return;
    const timer = setTimeout(() => void finalizeOrder(), 600);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, agentKis, agentPlan]);

  const totalItems = items.reduce((s, i) => s + i.qty, 0);

  // Cửa hàng ĐẦU TIÊN đang dừng chờ nhập thẻ — chỉ hiện form thẻ ở đó (nhập 1 lần,
  // xác nhận xong mọi cửa hàng đang chờ thẻ tự chạy tiếp).
  const firstCardPauseIdx =
    phase === "agent" && !cardConfirmed
      ? agentPlan.findIndex((sp, i) => sp.steps[agentKis[i] ?? 0]?.pause === "pay-card")
      : -1;

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
            /* Success screen — đầy đủ như Mua ngay / Mua cả túi: mã đơn + chi tiết món + giao/thanh toán/tổng */
            <div className="flex flex-col items-center py-4 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100">
                <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
              </div>
              <h3 className="mt-3 text-lg font-bold text-slate-900">{t("Đã ghi nhận đơn hàng!")}</h3>
              <p className="mt-1 text-sm text-slate-500">
                {t("Trợ lý đã đặt {n} món từ {m} nguồn. Mã đơn:", { n: totalItems, m: new Set(storeGroups.map((g) => g.chain)).size })}
              </p>
              <p className="mt-1 text-base font-bold tracking-wide text-emerald-600">{orderCode}</p>

              <div className="mt-4 w-full space-y-2 rounded-xl bg-slate-50 p-3 text-left text-sm">
                {storeGroups.map((g) => (
                  <div key={g.storeId}>
                    <p className={`flex items-center gap-1.5 text-xs font-semibold ${results[g.storeId] === "err" ? "text-rose-600" : "text-slate-800"}`}>
                      <span>{results[g.storeId] === "err" ? "✗" : "✓"}</span>
                      <span>{g.storeName}</span>
                      {results[g.storeId] === "err" && <span className="font-normal">· {t("Lỗi, thử lại sau")}</span>}
                    </p>
                    {g.items.map((it) => (
                      // Đơn giá × số lượng (không phải thành tiền ×SL — dễ đọc nhầm)
                      <Row key={it.product.id} k={it.product.name} v={`${formatMoney(it.offer.price, g.currency)}${it.qty > 1 ? ` ×${it.qty}` : ""}`} />
                    ))}
                    {g.needSlot && <Row k={t("Khung giờ")} v={t(slotOf(g.storeId))} />}
                  </div>
                ))}
                <div className="border-t border-slate-200 pt-2">
                  <Row k={t("Giao tới")} v={address} />
                  <Row k={t("Thanh toán")} v={payMethod === "qr" ? t("QR chuyển khoản") : payMethod === "card" ? maskedCardLabel : "COD"} />
                  <Row k={t("Tổng")} v={formatMoney(grandTotal, storeGroups[0]?.currency ?? "VND")} strong />
                </div>
              </div>

              <button
                onClick={onClose}
                className="mt-4 w-full rounded-xl border border-slate-200 bg-emerald-600 py-3 text-sm font-semibold text-white transition hover:bg-emerald-700"
              >
                {t("Xong")}
              </button>
            </div>
          ) : phase === "agent" ? (
            /* ── NHIỀU trợ lý đặt SONG SONG tại các cửa hàng bằng tài khoản Affree.
                  Mỗi cửa hàng: recap (thông tin bên trái + QR riêng bên phải) rồi mới
                  tới tiến trình — QR của TẤT CẢ source hiện đồng thời ngay từ đầu. ── */
            <>
              <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50/60 px-3 py-2.5 text-xs text-amber-800">
                🤖 {t("Affree chạy nhiều trợ lý đặt đồng thời tại các cửa hàng bằng tài khoản Affree — mỗi cửa hàng chỉ dừng ở bước thanh toán của nó.")}
              </div>
              {agentPlan.map((sp, i) => {
                const g = sp.group;
                const ki = agentKis[i] ?? 0;
                const doneStore = ki >= sp.steps.length - 1;
                const curStep = sp.steps[ki];
                const waitingPay = !doneStore && Boolean(curStep?.pause) && !(curStep?.pause === "pay-card" && cardConfirmed);
                return (
                  <section
                    key={g.storeId}
                    className={`mb-3 rounded-2xl border p-3 ${doneStore ? "border-slate-200" : "border-emerald-300"}`}
                  >
                    <div className="mb-2 flex items-center gap-2">
                      <span className="relative flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-emerald-100 text-xs font-bold text-emerald-700 ring-1 ring-slate-200">
                        {g.storeName.slice(0, 2).toUpperCase()}
                        {chainLogo(g.chain) && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={chainLogo(g.chain)} alt={g.storeName} className="absolute inset-0 h-full w-full bg-white object-contain p-0.5" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
                        )}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-slate-800">{g.storeName}</p>
                        <p className="text-xs text-slate-500">
                          {g.items.length} {t("sản phẩm")} ·{" "}
                          <span className="font-medium text-rose-600">{formatMoney(g.total, g.currency)}</span>
                        </p>
                      </div>
                      {doneStore ? (
                        <span className="text-sm font-bold text-emerald-600">✓</span>
                      ) : waitingPay ? (
                        <span className="text-xs font-medium text-amber-600">{t("Chờ bạn thanh toán…")}</span>
                      ) : (
                        <span className="inline-block h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-slate-300 border-t-emerald-500" />
                      )}
                    </div>

                    {/* Recap: sản phẩm tham khảo bên trái (style như giỏ) + QR riêng của source bên phải */}
                    <div className="mb-2 flex items-stretch gap-3">
                      <div className="min-w-0 flex-1 space-y-2">
                        {g.items.slice(0, 3).map((item) => (
                          <div key={item.product.id} className="flex items-center gap-2 rounded-xl bg-slate-50 p-2">
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
                                {formatMoney(item.offer.price, g.currency)}
                                {item.qty > 1 && (
                                  <span className="ml-1 font-normal text-slate-400">× {item.qty}</span>
                                )}
                              </p>
                              {(item.autoQty ?? 0) > 0 && (
                                <p className="mt-0.5 text-[10px] font-medium text-blue-500">
                                  +{item.autoQty} tự thêm để đủ mua tối thiểu {chainMinOrder(g.chain as Parameters<typeof chainMinOrder>[0]) > 0 ? `(${formatMoney(chainMinOrder(g.chain as Parameters<typeof chainMinOrder>[0]), g.currency)})` : ""}
                                </p>
                              )}
                            </div>
                          </div>
                        ))}
                        {g.items.length > 3 && (
                          <p className="text-xs text-slate-500">{t("+{n} sản phẩm khác", { n: g.items.length - 3 })}</p>
                        )}
                      </div>
                      {payMethod === "qr" && (
                        <div className="flex w-28 shrink-0 flex-col items-center justify-center gap-1 rounded-xl border border-slate-200 bg-white p-2">
                          <div data-qr={g.storeId} className="w-full rounded bg-white">
                            <QRCode
                              value={`Chuyen khoan: ${g.storeName} | So tien: ${g.total} VND | SDT: ${phone} | ${g.storeId}`}
                              size={80}
                              level="M"
                              style={{ height: "auto", maxWidth: "100%", width: "100%" }}
                            />
                          </div>
                          <p className="text-[11px] font-bold text-rose-600">{formatMoney(g.total, g.currency)}</p>
                          <button
                            type="button"
                            onClick={() => downloadQr(g.storeId, g.storeName)}
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-medium text-slate-600 transition hover:bg-slate-50"
                          >
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
                            {t("Tải QR")}
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Tiến trình của trợ lý cửa hàng này */}
                    {(
                      <div className="space-y-1.5">
                        {sp.steps.map((st, k) => {
                          const show = doneStore || k <= ki;
                          if (!show) return null;
                          const stepDone = doneStore || k < ki;
                          const isCurrent = !doneStore && k === ki;
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
                                  {st.pause === "pay-card" && cardConfirmed
                                    ? t("Thanh toán bằng thẻ đã lưu…") + (cardLast4 ? ` (${maskedCardLabel})` : "")
                                    : st.label}
                                </span>
                              </div>

                              {/* Thanh toán QR — mã đã hiện sẵn ở recap phía trên, chỉ cần xác nhận */}
                              {isCurrent && st.pause === "pay-qr" && (
                                <div className="mt-1.5 pl-5">
                                  <button
                                    onClick={() => advanceStore(i)}
                                    className="rounded-lg bg-emerald-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700"
                                  >
                                    {t("Tôi đã chuyển khoản")}
                                  </button>
                                </div>
                              )}

                              {/* Thanh toán Thẻ — fallback khi CHƯA điền thẻ ở giỏ. Nhiều cửa hàng
                                  có thể cùng dừng chờ thẻ (chạy song song) → chỉ hiện form ở cửa hàng
                                  ĐẦU TIÊN; xác nhận xong các cửa hàng còn lại tự dùng lại thẻ. */}
                              {isCurrent && st.pause === "pay-card" && !cardConfirmed && i === firstCardPauseIdx && (
                                <div className="mt-1.5 space-y-2 pl-5">
                                  {brandChipsRow}
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
                                    onClick={() => { setCardConfirmed(true); advanceStore(i); }}
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
              {/* Thông tin chung — module chung với Mua ngay / Mua cả túi (OrderInfoSection) */}
              <OrderInfoSection
                lang={lang}
                className="mb-4"
                name={name}
                phone={phone}
                address={address}
                onName={setName}
                onPhone={setPhone}
                onAddress={setAddress}
              />

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
                    {group.needSlot && (
                      <Field label={t("Khung giờ giao")}>
                        <select
                          value={slotOf(group.storeId)}
                          onChange={(e) => setStoreSlots((prev) => ({ ...prev, [group.storeId]: e.target.value }))}
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

              {/* QR/COD: chỉ chọn ở giỏ, thao tác ở bước trợ lý. */}
              {(payMethod === "qr" || payMethod === "cod") && (
                <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
                  {payMethod === "qr"
                    ? "📱 " + t("Trợ lý sẽ hiện mã QR để bạn quét tại từng cửa hàng khi đặt.")
                    : "💵 " + t("Thanh toán khi nhận hàng (COD) — nhân viên giao hàng thu tiền mặt.")}
                </p>
              )}

              {/* Thẻ: có thẻ ĐÃ LƯU (lần mua trước) → mặc định chọn lại, 👁 + OTP mô phỏng
                  để xem full số. Chưa có / "Dùng thẻ khác" → điền ngay tại giỏ. */}
              {payMethod === "card" && usingSavedCard && savedCard && (
                <div className="space-y-2">
                  <p className="text-[10px] text-slate-400">{t("Chọn thẻ")}:</p>
                  <div className="flex items-center gap-2 rounded-xl border border-emerald-400 bg-emerald-50/60 px-3 py-2 ring-1 ring-emerald-200">
                    <span className={`rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${cardBrand ? CARD_BRAND_STYLE[cardBrand] : "border-slate-300 text-slate-500"}`}>
                      {cardBrand ?? t("Thẻ")}
                    </span>
                    <span className="flex-1 truncate font-mono text-sm text-slate-800">
                      {cardRevealed ? savedCard.number : `****${cardLast4}`}
                    </span>
                    <button
                      type="button"
                      onClick={requestRevealCard}
                      aria-label={cardRevealed ? t("Ẩn số thẻ") : t("Xem số thẻ")}
                      title={cardRevealed ? t("Ẩn số thẻ") : t("Xem số thẻ (cần OTP)")}
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-slate-400 transition hover:bg-white hover:text-slate-700"
                    >
                      {cardRevealed ? (
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" /><line x1="1" y1="1" x2="23" y2="23" /></svg>
                      ) : (
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z" /><circle cx="12" cy="12" r="3" /></svg>
                      )}
                    </button>
                  </div>

                  {/* OTP mô phỏng: khung "tin nhắn" chứa mã + ô nhập, đúng mã mới hiện số thẻ */}
                  {otpCode && !cardRevealed && (
                    <div className="space-y-1.5 rounded-lg bg-slate-50 px-3 py-2 ring-1 ring-slate-200">
                      <p className="text-[11px] text-slate-500">
                        📩 {t("(Mô phỏng) OTP đã gửi tới SĐT")} ****{phone.replace(/\D/g, "").slice(-3) || "•••"}: <b className="font-mono text-slate-700">{otpCode}</b>
                      </p>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          inputMode="numeric"
                          maxLength={6}
                          value={otpInput}
                          onChange={(e) => { setOtpInput(e.target.value.replace(/\D/g, "")); setOtpError(false); }}
                          placeholder={t("Nhập OTP 6 số")}
                          className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-mono outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                        />
                        <button
                          type="button"
                          onClick={verifyOtp}
                          disabled={otpInput.length < 6}
                          className="shrink-0 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:bg-slate-300"
                        >
                          {t("Xác nhận")}
                        </button>
                      </div>
                      {otpError && <p className="text-[11px] text-rose-600">{t("OTP chưa đúng — thử lại.")}</p>}
                    </div>
                  )}

                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[11px] text-slate-400">
                      {"✓ " + t("{card} sẽ được trợ lý dùng thanh toán tự động.", { card: maskedCardLabel })}
                    </p>
                    <button
                      type="button"
                      onClick={() => { setUseNewCard(true); setCardRevealed(false); setOtpCode(null); setOtpInput(""); setOtpError(false); }}
                      className="shrink-0 text-[11px] font-medium text-emerald-600 underline-offset-2 hover:underline"
                    >
                      {t("Dùng thẻ khác")}
                    </button>
                  </div>
                </div>
              )}

              {payMethod === "card" && !usingSavedCard && (
                <div className="space-y-2">
                  {savedCard && (
                    <button
                      type="button"
                      onClick={() => setUseNewCard(false)}
                      className="text-[11px] font-medium text-emerald-600 underline-offset-2 hover:underline"
                    >
                      ← {t("Dùng thẻ đã lưu")} ({savedCard.brand ?? t("Thẻ")} ****{savedCard.number.replace(/\D/g, "").slice(-4)})
                    </button>
                  )}
                  {brandChipsRow}
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={19}
                    value={cardNumber}
                    onChange={(e) => setCardNumber(e.target.value.replace(/\D/g, "").replace(/(.{4})/g, "$1 ").trim())}
                    placeholder={t("Số thẻ") + " 0000 0000 0000 0000"}
                    className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-mono outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                  />
                  <input
                    type="text"
                    value={cardName}
                    onChange={(e) => setCardName(e.target.value.toUpperCase())}
                    placeholder={t("Tên chủ thẻ")}
                    className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-mono outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                  />
                  <div className="flex gap-2">
                    <input
                      type="text"
                      maxLength={5}
                      value={cardExp}
                      onChange={(e) => { const v = e.target.value.replace(/\D/g, ""); setCardExp(v.length > 2 ? `${v.slice(0, 2)}/${v.slice(2)}` : v); }}
                      placeholder="MM/YY"
                      className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-mono outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                    />
                    <input
                      type="password"
                      maxLength={4}
                      value={cardCvv}
                      onChange={(e) => setCardCvv(e.target.value.replace(/\D/g, ""))}
                      placeholder="CVV"
                      className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-mono outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                    />
                  </div>
                  <p className="text-[11px] text-slate-400">
                    {cardReady
                      ? "✓ " + t("{card} sẽ được trợ lý dùng thanh toán tự động.", { card: maskedCardLabel })
                      : "💳 " + t("Điền đủ để trợ lý tự thanh toán — hoặc bỏ trống, nhập ở bước đặt hàng.")}
                  </p>
                </div>
              )}
            </section>
            </>
          )}
        </div>

        {/* Footer — chỉ ở bước giỏ (bước trợ lý có nút thanh toán riêng inline) */}
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

/** Dòng "nhãn — giá trị" trong khối tổng kết đơn (đồng bộ với Mua ngay / Mua cả túi). */
function Row({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5">
      <span className="shrink-0 text-xs text-slate-500">{k}</span>
      <span className={`min-w-0 truncate text-right ${strong ? "text-sm font-bold text-emerald-600" : "text-xs font-medium text-slate-800"}`}>{v}</span>
    </div>
  );
}
