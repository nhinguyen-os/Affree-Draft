"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import QRCode from "react-qr-code";
import type { CartItem, RankedOffer } from "@/lib/types";
import { chainLabel, chainMinOrder, storeCurrency } from "@/lib/stores";
import { ChainBadge } from "./ChainBadge";
import { MarqueeText } from "./MarqueeText";
import { geocode } from "@/lib/geocode";
import { distanceKm, formatMoney } from "@/lib/util";
import { flushProfile, getProfile } from "@/lib/profile";
import { getSavedCard, saveCard, fetchAccountCard, type SavedCard } from "@/lib/cards";
import { addPurchase } from "@/lib/purchases";
import { ensureAccount } from "@/lib/auth";
import { getOrderConfig } from "@/lib/orderConfig";
import { bumpMetric } from "@/lib/metrics";
import { type Lang, tr } from "@/lib/i18n";
import { ContactReveal } from "@/components/ContactReveal";
import { acquireBodyScrollLock } from "@/lib/scroll-lock";
import OrderInfoSection from "./OrderInfoSection";

const SLOTS = [
  "Trong hôm nay (2–4 giờ)",
  "Tối nay (18:00–21:00)",
  "Sáng mai (8:00–11:00)",
  "Chiều mai (14:00–17:00)",
];
const DELIVERY_LEAD_MINUTES = 180;

function slotRange(label: string) {
  const normalized = label
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "d")
    .toLowerCase();
  if (normalized.includes("toi")) return { from: 18 * 60, to: 21 * 60 };
  if (normalized.includes("sang")) return { from: 8 * 60, to: 11 * 60 };
  if (normalized.includes("chieu")) return { from: 14 * 60, to: 17 * 60 };
  return { from: 0, to: 24 * 60 };
}

function isSlotPast(label: string) {
  const normalized = label
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "d")
    .toLowerCase();
  if (normalized.includes("ngay mai") || /\bmai\b/.test(normalized)) return false;
  const range = slotRange(label);
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes() + DELIVERY_LEAD_MINUTES >= range.to;
}

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
  /** Tên cửa hàng chi tiết (chi nhánh cụ thể, vd "BHX 223 Nguyễn Trọng Tuyển") — hiện dưới tên chuỗi. */
  storeDetail: string;
  chain: string;
  currency: string;
  items: CartItem[];
  needEmail: boolean;
  needStorePick: boolean;
  needSlot: boolean;
  total: number;
};

type PayMethod = "qr" | "card" | "cod";

export default function CartModal({
  items,
  onClose,
  onUpdateQty,
  onRemove,
  onOrderWithAgent,
  onOrdered,
  onSwitchStore,
  alternatives = [],
  geoAddr,
  lang = "vi",
}: {
  items: CartItem[];
  onClose: () => void;
  onUpdateQty: (productId: string, storeId: string, qty: number) => void;
  onRemove: (productId: string, storeId: string) => void;
  /** Đổi cửa hàng cho món (giỏ 1 sản phẩm) — giữ số lượng, thay offer. */
  onSwitchStore?: (productId: string, fromStoreId: string, offer: RankedOffer) => void;
  /** Các offer cùng món ở cửa hàng khác (dùng cho đề xuất "Chọn lại nơi mua" khi giỏ có 1 sản phẩm). */
  alternatives?: RankedOffer[];
  /** Địa chỉ đã định vị (để so với địa chỉ giao → tính lại khoảng cách). */
  geoAddr?: string;
  /** Trả true nếu đã tự xử lý (mở form khác) → cart không chạy mô phỏng trợ lý AAAI. */
  onOrderWithAgent?: (
    offers: RankedOffer[],
    context: {
      name: string;
      phone: string;
      address: string;
      payMethod: PayMethod | null;
      /** Thẻ nhập/lưu ở giỏ (đã che số) — trợ lý dùng đưa qua trang cửa hàng khi payMethod="card". */
      cardLabel: string | null;
      slotsByStoreId: Record<string, string>;
    },
  ) => boolean;
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
  // Mã đơn RIÊNG từng cửa hàng (storeId → mã) — đơn nhiều nguồn, hiện ở màn thành công.
  const [storeCodes, setStoreCodes] = useState<Record<string, string>>({});

  // Nhiều trợ lý AAAI chạy SONG SONG — agentKis[i] = bước hiện tại của cửa hàng thứ i.
  const [agentKis, setAgentKis] = useState<number[]>([]);
  // Thẻ nhập 1 lần cho mọi cửa hàng — xác nhận ở cửa hàng đầu, các cửa hàng sau tự dùng lại.
  const [cardConfirmed, setCardConfirmed] = useState(false);

  // Payment method — không mặc định chọn, user tự chọn (null = chưa chọn)
  const [payMethod, setPayMethod] = useState<PayMethod | null>(null);
  const [cardNumber, setCardNumber] = useState("");
  const [cardName, setCardName] = useState("");
  const [cardExp, setCardExp] = useState("");
  const [cardCvv, setCardCvv] = useState("");
  // Thẻ đã lưu từ lần mua trước (localStorage) — có thì mặc định dùng lại, khỏi nhập.
  const [savedCard, setSavedCard] = useState<SavedCard | null>(() => getSavedCard());
  // Chưa có thẻ local → lấy thẻ đã che từ tài khoản (sheet) khi đã đăng nhập (đồng bộ OrderAgentModal).
  useEffect(() => {
    if (getSavedCard()) return;
    let alive = true;
    void fetchAccountCard().then((c) => { if (alive && c) setSavedCard(c); });
    return () => { alive = false; };
  }, []);
  const [useNewCard, setUseNewCard] = useState(false);
  // Tick "Lưu thẻ để mua nhanh lần sau" — ĐỒNG BỘ với form Mua ngay (OrderAgentModal).
  const [cardSaved, setCardSaved] = useState(true);
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
        storeDetail: store.name || "",
        chain: store.chain,
        currency: storeCurrency(store.id),
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

  useEffect(() => {
    setStoreSlots((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const group of storeGroups) {
        if (!group.needSlot) continue;
        const current = next[group.storeId] ?? SLOTS[0];
        if (!isSlotPast(current)) continue;
        const replacement = SLOTS.find((slot) => !isSlotPast(slot));
        if (replacement && replacement !== current) {
          next[group.storeId] = replacement;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [storeGroups]);

  const grandTotal = storeGroups.reduce((s, g) => s + g.total, 0);

  // ── Đề xuất "Chọn lại nơi mua" — CHỈ khi giỏ có ĐÚNG 1 sản phẩm (ĐỒNG BỘ với form Mua ngay).
  // Cho đổi sang cửa hàng khác CÙNG CHUỖI của cùng món; đã có địa chỉ giao thì tính lại km theo đó.
  const singleItem = items.length === 1 ? items[0] : null;
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
  const addressReady = address.trim().length >= 6;
  const addressChanged = !!geoAddr && addressReady && norm(address) !== norm(geoAddr);
  const shouldGeocode = addressReady && (!geoAddr || addressChanged);
  const [deliveryLoc, setDeliveryLoc] = useState<{ lat: number; lng: number } | null>(null);
  const [geocoding, setGeocoding] = useState(false);
  useEffect(() => {
    if (!singleItem || !shouldGeocode) { setDeliveryLoc(null); return; }
    let alive = true;
    setGeocoding(true);
    const timer = setTimeout(async () => {
      const loc = await safeGeocode(address);
      if (!alive) return;
      setDeliveryLoc(loc);
      setGeocoding(false);
    }, 900);
    return () => { alive = false; clearTimeout(timer); };
  }, [address, shouldGeocode, singleItem]);
  const [repickSort, setRepickSort] = useState<"near" | "cheap">("near");
  const activeStoreId = singleItem?.offer.store.id;
  const activeChain = singleItem?.offer.store.chain;
  const choiceList = useMemo(() => {
    if (!singleItem) return [] as RankedOffer[];
    const list = alternatives.filter(
      (o) => o.store.chain === activeChain && (o.inStock || o.store.id === activeStoreId),
    );
    if (!deliveryLoc) return list;
    return list.map((o) => {
      const s = o.store;
      const km = s.lat != null && s.lng != null ? distanceKm(deliveryLoc, { lat: s.lat, lng: s.lng }) : null;
      return { ...o, distanceKm: km } as RankedOffer;
    });
  }, [alternatives, activeStoreId, activeChain, deliveryLoc, singleItem]);
  const cheapestId = useMemo(() => {
    let best: RankedOffer | null = null;
    for (const o of choiceList) if (!best || o.price < best.price) best = o;
    return best?.store.id;
  }, [choiceList]);
  const nearestId = useMemo(() => {
    let best: RankedOffer | null = null;
    for (const o of choiceList) {
      if (o.distanceKm == null) continue;
      if (!best || o.distanceKm < (best.distanceKm ?? Infinity)) best = o;
    }
    return best?.store.id;
  }, [choiceList]);
  const storeChoices = useMemo(() => {
    const arr = [...choiceList];
    arr.sort((a, b) =>
      repickSort === "cheap" ? a.price - b.price : (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity),
    );
    return arr;
  }, [choiceList, repickSort]);
  // Giỏ 1 sản phẩm: LUÔN gợi ý nơi mua khác khi có >1 cửa hàng (không đợi địa chỉ giao lệch
  // vị trí định vị như Mua ngay). Vẫn geocode để tính lại km khi user nhập địa chỉ giao khác.
  const showRepick = !!singleItem && storeChoices.length > 1;

  // Đang dùng thẻ ĐÃ LƯU (mặc định khi có) hay nhập thẻ mới.
  const usingSavedCard = !!savedCard && !useNewCard;
  // Thẻ hợp lệ — thẻ đã lưu coi như sẵn sàng (CVV không lưu, mô phỏng bỏ qua);
  // thẻ mới thì điền ngay Ở GIỎ (điền đủ → trợ lý AAAI tự thanh toán, bỏ trống → hỏi ở bước đặt).
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
  // Hàng chip "Chấp nhận: VISA MASTERCARD…" — dùng ở giỏ lẫn bước trợ lý AAAI cho đồng nhất.
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
  // User CHỌN thanh toán ở giỏ → qua trang cửa hàng (co-browse) bot tự chọn đúng phương thức này.
  const paymentOnStorePage = false;
  const paymentReady = payMethod !== null;
  const orderHint =
    !phone.trim() || !address.trim()
      ? t("Nhập đủ tên, số điện thoại và địa chỉ để tiếp tục.")
      : !payMethod
        ? t("Chọn phương thức thanh toán để tiếp tục.")
        : "";

  function setExtra(storeId: string, field: string, val: string) {
    setStoreExtras((prev) => ({
      ...prev,
      [storeId]: { ...prev[storeId], [field]: val },
    }));
  }

  // Kế hoạch các bước trợ lý AAAI cho TỪNG cửa hàng.
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

  // Ghi nhận đơn (localStorage + Sheet) rồi sang màn thành công — gọi khi trợ lý AAAI xong hết cửa hàng.
  async function finalizeOrder() {
    const next: Record<string, "ok" | "err"> = {};
    // Mã PHIÊN chung 1 lần mua (để lịch sử gom 1 dòng) + mã RIÊNG từng cửa hàng (đơn nhiều
    // nguồn → mỗi cửa hàng 1 mã đơn riêng, hiện ở màn thành công & chi tiết lịch sử).
    const ts = String(Date.now()).slice(-6);
    const code = "AFF-" + ts + "-" + Math.floor(Math.random() * 900 + 100);
    const codes: Record<string, string> = {};
    storeGroups.forEach((g, gi) => { codes[g.storeId] = "AFF-" + ts + "-" + String(101 + gi); });
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
            orderCode: code,
            storeOrderCode: codes[group.storeId],
            slot: group.needSlot ? slotOf(group.storeId) : undefined,
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
    setOrderCode(code);
    setStoreCodes(codes);
    setPhase("done");
    const okStoreIds = Object.entries(next).filter(([, v]) => v === "ok").map(([id]) => id);
    if (okStoreIds.length) onOrdered?.(okStoreIds);
  }

  // Bấm "Để trợ lý AAAI đặt giúp" → khởi động mô phỏng trợ lý AAAI (thay vì đặt tức thì).
  function startAgent() {
    flushProfile({ name, phone, address });
    setAgentKis(storeGroups.map(() => 0));
    // Thẻ đã điền ĐỦ ở giỏ → coi như xác nhận luôn, trợ lý AAAI tự thanh toán không dừng hỏi.
    setCardConfirmed(payMethod === "card" && cardReady);
    // Thẻ MỚI hợp lệ → lưu lại (localStorage, không CVV) cho lần mua sau chọn nhanh.
    if (payMethod === "card" && !usingSavedCard && newCardReady && cardSaved) {
      saveCard({ number: cardNumber, name: cardName, exp: cardExp, brand: detectCardBrand(cardNumber), cvv: cardCvv });
    }
    // Thanh toán thẻ → tạo tài khoản NGẦM theo SĐT + lưu thẻ ĐÃ CHE (4 số cuối + hãng + hạn).
    if (payMethod === "card" && phone.trim()) {
      ensureAccount(phone.trim(), name.trim(), {
        last4: cardLast4,
        brand: cardBrand,
        exp: usingSavedCard ? savedCard?.exp : cardExp,
      });
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

  // Auto chạy các bước không cần bạn — MỖI cửa hàng có timer RIÊNG (theo index), tick
  // ĐỘC LẬP và SONG SONG. Trước đây 1 effect chung xoá SẠCH mọi timer mỗi lần bất kỳ
  // cửa hàng nào nhảy bước rồi hẹn lại tất cả → cửa hàng #0 (không lệch nhịp) luôn bắn
  // trước, reset timer các cửa hàng sau trước khi chúng kịp chạy ⇒ chỉ chạy được khi #0
  // dừng ⇒ hoá TUẦN TỰ. Nay chỉ dời lại timer của ĐÚNG cửa hàng vừa đổi bước, timer các
  // cửa hàng khác giữ nguyên → chạy song song thật.
  const stepTimersRef = useRef<Map<number, { ki: number; timer: ReturnType<typeof setTimeout> }>>(new Map());
  useEffect(() => {
    if (phase !== "agent") {
      stepTimersRef.current.forEach((e) => clearTimeout(e.timer));
      stepTimersRef.current.clear();
      return;
    }
    agentPlan.forEach((sp, i) => {
      const ki = agentKis[i] ?? 0;
      const existing = stepTimersRef.current.get(i);
      // Đã hẹn giờ đúng cho bước hiện tại của cửa hàng này rồi → ĐỂ YÊN (không reset).
      if (existing && existing.ki === ki) return;
      if (existing) clearTimeout(existing.timer);
      stepTimersRef.current.delete(i);
      const cur = sp.steps[ki];
      if (!cur || ki >= sp.steps.length - 1) return; // xong
      // Chỉ dừng chờ ở bước nhập thẻ CHƯA xác nhận. Bước QR: bot tự dò giao dịch &
      // xác nhận khi nhận được tiền (khách không cần bấm) → chờ lâu hơn cho khách kịp CK.
      const paused = cur.pause === "pay-card" && !cardConfirmed;
      if (paused) return; // dừng chờ user nhập thẻ — xác nhận xong sẽ tự hẹn lại
      // Lệch nhịp nhẹ giữa các cửa hàng cho cảm giác nhiều trợ lý AAAI chạy song song.
      const delay = cur.pause === "pay-qr" ? 2800 + i * 200 : (cur.ok ? 550 : 850) + i * 180;
      const timer = setTimeout(() => {
        stepTimersRef.current.delete(i);
        advanceStore(i);
      }, delay);
      stepTimersRef.current.set(i, { ki, timer });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, agentKis, agentPlan, cardConfirmed]);
  // Dọn mọi timer khi unmount.
  useEffect(() => () => { stepTimersRef.current.forEach((e) => clearTimeout(e.timer)); }, []);

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
              {phase === "done"
                ? t("Đã ghi nhận đơn hàng")
                : <>{t("Giỏ hàng")} · {totalItems} {t("sản phẩm")}</>}
            </h2>
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
                {t("Trợ lý AAAI đã đặt {n} món từ {m} cửa hàng — mỗi cửa hàng 1 mã đơn riêng:", { n: totalItems, m: storeGroups.length })}
              </p>

              <div className="mt-4 w-full space-y-2.5 text-left text-sm">
                {/* Mỗi cửa hàng = 1 ĐƠN riêng: mã đơn riêng + SP + thành tiền riêng. */}
                {storeGroups.map((g) => (
                  <div key={g.storeId} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className={`flex min-w-0 items-center gap-1.5 text-xs font-semibold ${results[g.storeId] === "err" ? "text-rose-600" : "text-slate-800"}`}>
                        <span>{results[g.storeId] === "err" ? "✗" : "✓"}</span>
                        <span className="truncate">{g.storeName}</span>
                      </p>
                      <span className="shrink-0 font-mono text-[11px] font-bold tracking-wide text-emerald-600">{storeCodes[g.storeId] || orderCode}</span>
                    </div>
                    {results[g.storeId] === "err" && <p className="mt-0.5 text-xs text-rose-500">{t("Lỗi, thử lại sau")}</p>}
                    <div className="mt-1.5 space-y-0.5 border-t border-slate-200/70 pt-1.5">
                      {g.items.map((it) => (
                        // Đơn giá × số lượng (không phải thành tiền ×SL — dễ đọc nhầm)
                        <Row key={it.product.id} k={it.product.name} v={`${formatMoney(it.offer.price, g.currency)}${it.qty > 1 ? ` ×${it.qty}` : ""}`} />
                      ))}
                      {g.needSlot && <Row k={t("Khung giờ")} v={t(slotOf(g.storeId))} />}
                      <Row k={t("Thành tiền")} v={formatMoney(g.total, g.currency)} strong />
                    </div>
                  </div>
                ))}
                <div className="rounded-xl bg-slate-50 p-3">
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
            /* ── NHIỀU trợ lý AAAI đặt SONG SONG tại các cửa hàng bằng tài khoản Affree.
                  Mỗi cửa hàng: recap (thông tin bên trái + QR riêng bên phải) rồi mới
                  tới tiến trình — QR của TẤT CẢ source hiện đồng thời ngay từ đầu. ── */
            <>
              <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50/60 px-3 py-2.5 text-xs text-amber-800">
                🤖 {t("Affree chạy nhiều trợ lý AAAI đặt đồng thời tại các cửa hàng bằng tài khoản Affree — mỗi cửa hàng chỉ dừng ở bước thanh toán của nó.")}
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
                      <ChainBadge chain={g.chain} size={32} />
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
                        <span className="text-xs font-medium text-amber-600">
                          {curStep?.pause === "pay-qr" ? t("Đang chờ chuyển khoản…") : t("Chờ bạn thanh toán…")}
                        </span>
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
                                  {t("Mua tối thiểu: {amount}.", { amount: formatMoney(chainMinOrder(g.chain as Parameters<typeof chainMinOrder>[0]), g.currency) })}{" "}
                                  {t("(+{n} tự thêm để đủ)", { n: item.autoQty ?? 0 })}
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

                    {/* Tiến trình của trợ lý AAAI cửa hàng này */}
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
                                ) : isCurrent && st.pause === "pay-card" && !cardConfirmed ? (
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

                              {/* Thanh toán QR — mã đã hiện sẵn ở recap phía trên; bot tự dò
                                  giao dịch và xác nhận khi nhận được tiền, khách không cần bấm. */}
                              {isCurrent && st.pause === "pay-qr" && (
                                <div className="mt-1.5 flex items-center gap-2 pl-5 text-xs text-slate-500">
                                  <span className="inline-block h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-slate-300 border-t-emerald-500" />
                                  <span>{t("Bot đang chờ chuyển khoản — tự xác nhận khi nhận được tiền")}</span>
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
              {/* Banner bản mô phỏng — ĐỒNG BỘ với form Mua ngay (OrderAgentModal) */}
              <div className="mb-4 rounded-lg border border-amber-300/40 bg-amber-100/30 px-3 py-2 text-center text-xs text-amber-900">
                {t("Bản mô phỏng")}
              </div>
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
                  className="mb-3 rounded-2xl border border-slate-400 p-3"
                >
                  {/* Store header */}
                  <div className="mb-2.5 flex items-center gap-2">
                    <ChainBadge chain={group.chain} size={32} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-slate-800 truncate">{group.storeName}</p>
                      {group.storeDetail && group.storeDetail !== group.storeName && (
                        <p className="text-xs font-medium text-slate-600 truncate">{group.storeDetail}</p>
                      )}
                      <p className="text-xs text-slate-500">
                        {group.items.length} {t("sản phẩm")} ·{" "}
                        <span className="font-medium text-rose-600">
                          {formatMoney(group.total, group.currency)}
                        </span>
                      </p>
                      {group.items[0]?.offer.store.phone && (
                        <div className="mt-0.5">
                          <ContactReveal phone={group.items[0].offer.store.phone} lang={lang} source="cart" />
                        </div>
                      )}
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
                              {t("Mua tối thiểu: {amount}.", { amount: formatMoney(chainMinOrder(group.chain as Parameters<typeof chainMinOrder>[0]), group.currency) })}{" "}
                              {t("(+{n} tự thêm để đủ)", { n: item.autoQty ?? 0 })}
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
                          {/* Thùng rác: xoá món ngay không cần bấm − nhiều lần khi số lượng lớn. */}
                          <button
                            onClick={() => onRemove(item.product.id, group.storeId)}
                            aria-label={t("Xoá sản phẩm khỏi giỏ")}
                            title={t("Xoá sản phẩm khỏi giỏ")}
                            className="ml-1 flex h-7 w-7 items-center justify-center rounded-full border border-slate-200 bg-white text-rose-500 hover:border-rose-300 hover:bg-rose-50"
                          >
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><line x1="10" y1="11" x2="10" y2="17" /><line x1="14" y1="11" x2="14" y2="17" /></svg>
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
                          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                        >
                          {SLOTS.map((s) => (
                            <option key={s} value={s} disabled={isSlotPast(s)}>
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
                          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
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
                        className="w-full resize-none rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                      />
                    </Field>
                  </div>
                </section>
              ))}

            {/* Đề xuất "Chọn lại nơi mua" — CHỈ khi giỏ có đúng 1 sản phẩm (đồng bộ form Mua ngay) */}
            {showRepick && singleItem && (
              <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
                <p className="text-xs text-amber-800">
                  📍 {geocoding
                    ? t("đang định vị & tính khoảng cách theo địa chỉ giao…")
                    : deliveryLoc
                      ? t("khoảng cách dưới đây tính từ địa chỉ giao, gần nhất xếp trên. Chọn lại nơi mua:")
                      : t("Cùng món này còn bán ở cửa hàng khác — chọn lại nơi mua:")}
                </p>

                {/* Lọc: gần / rẻ */}
                <div className="mt-2 inline-flex rounded-lg border border-slate-200 bg-white p-0.5 text-xs font-medium">
                  <button
                    onClick={() => setRepickSort("near")}
                    className={`rounded-md px-3 py-1 transition ${repickSort === "near" ? "bg-emerald-600 text-white" : "text-slate-600 hover:bg-slate-100"}`}
                  >
                    {t("Gần nhất")}
                  </button>
                  <button
                    onClick={() => setRepickSort("cheap")}
                    className={`rounded-md px-3 py-1 transition ${repickSort === "cheap" ? "bg-emerald-600 text-white" : "text-slate-600 hover:bg-slate-100"}`}
                  >
                    {t("Rẻ nhất")}
                  </button>
                </div>

                <div className="mt-2 max-h-64 space-y-1.5 overflow-y-auto overscroll-contain pr-0.5">
                  {storeChoices.map((o) => {
                    const active = o.store.id === singleItem.offer.store.id;
                    return (
                      <button
                        key={o.store.id}
                        onClick={() => { if (!active) onSwitchStore?.(singleItem.product.id, singleItem.offer.store.id, o); }}
                        className={`flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-sm transition ${active ? "border-emerald-500 bg-emerald-50 ring-1 ring-emerald-500" : "border-slate-200 bg-white hover:border-slate-300"}`}
                      >
                        <ChainBadge chain={o.store.chain} />
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="flex min-w-0">
                            <MarqueeText className="font-medium text-slate-800">{o.store.name}</MarqueeText>
                          </span>
                          <span className="mt-0.5 flex flex-wrap items-center gap-1">
                            <span className="text-xs text-slate-500">
                              {o.distanceKm != null ? `${o.distanceKm.toFixed(1)} km` : t("Online")}
                            </span>
                            {o.store.id === cheapestId && (
                              <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">{t("Rẻ nhất")}</span>
                            )}
                            {o.store.id === nearestId && (
                              <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700">{t("Gần nhất")}</span>
                            )}
                          </span>
                        </span>
                        <span className="shrink-0 text-right">
                          <span className="block font-semibold text-emerald-600">{formatMoney(o.price, storeCurrency(o.store.id))}</span>
                          {active && (<span className="text-[11px] font-medium text-emerald-600">{t("Đang chọn")}</span>)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ── Thanh toán — ẩn khi chọn ở trang cửa hàng (co-browse) ── */}
            {!paymentOnStorePage && (
            <section className="mb-3 rounded-2xl border border-slate-400 p-3">
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

              {/* Chưa chọn phương thức → nhắc (amber), ĐỒNG BỘ form Mua ngay. */}
              {payMethod === null && (
                <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
                  {t("Chọn phương thức thanh toán để tiếp tục.")}
                </p>
              )}
              {/* Chú thích theo phương thức — ĐỒNG BỘ form Mua ngay: hiện cho cả QR / Thẻ / COD. */}
              {payMethod && (
                <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
                  {payMethod === "qr"
                    ? "📱 " + t("Trợ lý AAAI sẽ hiện mã QR để bạn quét tại từng cửa hàng khi đặt.")
                    : payMethod === "cod"
                      ? "💵 " + t("Trợ lý AAAI sẽ đặt đơn COD — trả tiền mặt khi nhận hàng.")
                      : "💳 " + t("Trợ lý AAAI sẽ dừng ở bước thanh toán để bạn hoàn tất trên website thật rồi xác nhận lại.")}
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

                  {/* Mở mắt (đã qua OTP) → hiện ĐẦY ĐỦ thông tin thẻ */}
                  {cardRevealed && (
                    <div className="space-y-1 rounded-lg bg-white px-3 py-2 ring-1 ring-emerald-200 text-left">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="text-[11px] text-slate-500">{t("Số thẻ")}</span>
                        <span className="font-mono text-sm font-semibold text-slate-800">{savedCard.number}</span>
                      </div>
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="text-[11px] text-slate-500">{t("Tên chủ thẻ")}</span>
                        <span className="font-mono text-xs font-medium text-slate-800">{savedCard.name || "—"}</span>
                      </div>
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="text-[11px] text-slate-500">{t("Hạn thẻ")}</span>
                        <span className="font-mono text-xs font-medium text-slate-800">{savedCard.exp}</span>
                      </div>
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="text-[11px] text-slate-500">{t("Loại thẻ")}</span>
                        <span className="text-xs font-medium text-slate-800">{savedCard.brand ?? "—"}</span>
                      </div>
                      {savedCard.savedAt && (
                        <div className="flex items-baseline justify-between gap-3">
                          <span className="text-[11px] text-slate-500">{t("Đã lưu")}</span>
                          <span className="text-xs font-medium text-slate-800">{new Date(savedCard.savedAt).toLocaleDateString("vi-VN")}</span>
                        </div>
                      )}
                    </div>
                  )}

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
                          className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-mono outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
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
                      {"✓ " + t("{card} sẽ được trợ lý AAAI dùng thanh toán tự động.", { card: maskedCardLabel })}
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
                    className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-mono outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                  />
                  <input
                    type="text"
                    value={cardName}
                    onChange={(e) => setCardName(e.target.value.toUpperCase())}
                    placeholder={t("Tên chủ thẻ")}
                    className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-mono outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                  />
                  <div className="flex gap-2">
                    <input
                      type="text"
                      maxLength={5}
                      value={cardExp}
                      onChange={(e) => { const v = e.target.value.replace(/\D/g, ""); setCardExp(v.length > 2 ? `${v.slice(0, 2)}/${v.slice(2)}` : v); }}
                      placeholder="MM/YY"
                      className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-mono outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                    />
                    <input
                      type="password"
                      maxLength={4}
                      value={cardCvv}
                      onChange={(e) => setCardCvv(e.target.value.replace(/\D/g, ""))}
                      placeholder="CVV •••"
                      className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-mono outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                    />
                  </div>
                  {/* Lưu thẻ + ghi chú bảo mật — ĐỒNG BỘ với form Mua ngay (OrderAgentModal) */}
                  <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-600">
                    <input type="checkbox" checked={cardSaved} onChange={(e) => setCardSaved(e.target.checked)} className="accent-emerald-600" />
                    {t("Lưu thẻ để mua nhanh lần sau")}
                  </label>
                  <div className="flex items-center gap-1.5 rounded-lg bg-slate-50 px-2.5 py-1.5 text-[11px] text-slate-500">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                    {t("Thông tin thẻ được mã hoá, không lưu số thẻ thật, không chia sẻ bên thứ 3.")}
                  </div>
                </div>
              )}
            </section>
            )}
            </>
          )}
        </div>

        {/* Footer — chỉ ở bước giỏ (bước trợ lý AAAI có nút thanh toán riêng inline) */}
        {phase === "cart" && (
          <div className="shrink-0 border-t border-slate-100 px-4 py-3">
            <div className="mb-2.5 flex items-baseline justify-between">
              <span className="text-sm text-slate-500">{t("Tổng cộng")}</span>
              <span className="text-lg font-bold text-rose-600">{formatMoney(grandTotal, storeGroups[0]?.currency ?? "VND")}</span>
            </div>
            <button
              onClick={() => {
                // onOrderWithAgent trả true nếu đã tự xử lý (vd giỏ toàn nhạc → mở form nhạc).
                // Trả false/không có → chạy mô phỏng trợ lý AAAI đặt từng cửa hàng (startAgent).
                const offers = storeGroups.map((g) => g.items[0].offer);
                if (onOrderWithAgent && onOrderWithAgent(offers, {
                  name,
                  phone,
                  address,
                  payMethod,
                  cardLabel: payMethod === "card" && cardLast4 ? maskedCardLabel : null,
                  slotsByStoreId: Object.fromEntries(storeGroups.map((group) => [group.storeId, slotOf(group.storeId)])),
                })) return;
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
              {t("Để trợ lý AAAI đặt giúp →").replace(/\s*→\s*/g, "")} ({storeGroups.length} {t("cửa hàng")})
            </button>
            {orderHint && (
              <p className="mt-1.5 text-center text-xs text-slate-400">
                {orderHint}
              </p>
            )}
            <p className="mt-1.5 text-center text-[10px] text-slate-400">
              {t("Phục vụ bởi Affree Agentic AI - AAAI")}
            </p>
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

/** Geocode địa chỉ giao, nuốt lỗi → null (đồng bộ với OrderAgentModal). */
async function safeGeocode(address: string) {
  try {
    return await geocode(address);
  } catch {
    return null;
  }
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
