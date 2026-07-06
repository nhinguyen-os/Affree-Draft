"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import QRCode from "react-qr-code";
import type { RankedOffer } from "@/lib/types";
import { chainLabel, chainMinOrder, storeCurrency } from "@/lib/stores";
import { distanceKm, formatMoney } from "@/lib/util";
import { flushProfile, getProfile, saveProfile } from "@/lib/profile";
import { geocode } from "@/lib/geocode";
import { getOrderConfig } from "@/lib/orderConfig";
import { phoneRule } from "@/lib/phone";
import { getSavedCard, saveCard, fetchAccountCard, type SavedCard as SavedCardType } from "@/lib/cards";
import { type Lang, tr } from "@/lib/i18n";
import { acquireBodyScrollLock } from "@/lib/scroll-lock";
import OrderInfoSection from "./OrderInfoSection";
import { detectCardBrand, CARD_BRANDS, CARD_BRAND_STYLE } from "./PaymentSection";
import { ChainBadge } from "./ChainBadge";
import { MarqueeText } from "./MarqueeText";
import type { OrderRequiredInput, PublicOrderSessionState } from "@/lib/order-agent/types";

/**
 * BẢN GIẢ LẬP (mock) — không gọi web thật.
 * Mô phỏng "trợ lý ảo" tự thao tác đặt hàng trên web cửa hàng, và DỪNG LẠI
 * ở những bước chỉ con người làm được: nhập OTP, xác minh CAPTCHA, và bấm
 * xác nhận đặt hàng cuối cùng. Mục đích: cho thấy CƠ CHẾ pause → user nhập →
 * resume trước khi làm thật.
 */

type StepKind = "auto" | "otp" | "login" | "captcha" | "qr" | "confirm" | "success" | "payment-select";
type DemoPayMethod = "cod" | "qr" | "card";
type Step = { kind: StepKind; label: string };
type CoopOrderResult = {
  phase?: "otp" | "cart" | "ordered";
  flowId?: string;
  error?: string;
  code?: string;
  productName?: string;
  lineTotal?: number;
  minOrderTotal?: number;
  terminalCode?: string;
  cartToken?: string;
  checkoutFlowId?: string;
  cartUrl?: string;
  checkoutUrl?: string;
  alreadyRegistered?: boolean;
  usedTokenCache?: boolean;
  browserSession?: {
    accessToken?: string;
    tokenType?: string;
    refreshToken?: string;
    userId?: string;
    phone?: string;
    name?: string;
    email?: string;
    address?: string;
    terminalCode?: string;
    terminalId?: string;
    terminalName?: string;
    terminalAddress?: string;
    siteId?: number;
  };
  deliveryCheck?: {
    serviceName?: string;
    requireDeliveryTimeSlot?: string;
    fullAddress?: string;
    availableDates?: string[];
    availableTimeSlots?: Array<{ from: string; to: string; disabled?: boolean }>;
    availableSlotsByDate?: Record<string, Array<{ from: string; to: string; disabled?: boolean }>>;
    selectedDate?: string | null;
    selectedSlotFrom?: string | null;
    selectedSlotTo?: string | null;
    message?: string;
  };
  paymentCheck?: {
    selectedMethodCode?: string;
    selectedMethodName?: string;
    codAvailable?: boolean;
    codSelected?: boolean;
    methods?: Array<{
      icon?: string;
      methodCode?: string;
      methodGroupCode?: string;
      merchantMethodCode?: string;
      name?: string;
      description?: string;
      isSelected?: boolean;
      isDisabled?: boolean;
      warning?: unknown;
      amount?: number | null;
      maxTransactionAmount?: number;
      paymentMethodType?: string;
    }>;
    message?: string;
  };
  addressSync?: {
    action?: "created" | "updated" | "existing" | "missing";
    addressId?: string;
    isDefault?: boolean;
  };
  cartCleared?: boolean;
  order?: {
    code?: string;
    orderId?: string;
    createdAt?: string;
    grandTotal?: number;
    totalPaid?: number;
    paymentMethodCode?: string;
    paymentUrl?: string;
  };
  paymentUrl?: string;
  cancelledOrderCode?: string;
};

type CoopStepId = "account" | "otp" | "delivery" | "payment" | "review" | "success";

type CoopTerminalChoice = {
  terminalId?: number | string;
  terminalCode?: string;
  terminalName?: string;
  name?: string;
  address?: string;
  fullAddress?: string;
  distance?: number | string;
  distanceKm?: number | string;
  siteId?: number | string;
  [key: string]: unknown;
};

type CoopLocationOption = {
  id?: string;
  code: string;
  name: string;
  govCode?: string;
};

type CoopAddressParts = {
  addressLine: string;
  provinceCode: string;
  provinceName: string;
  districtCode: string;
  districtName: string;
  wardCode: string;
  wardName: string;
};

const SLOTS = [
  "Trong hôm nay (2–4 giờ)",
  "Tối nay (18:00–21:00)",
  "Sáng mai (8:00–11:00)",
  "Chiều mai (14:00–17:00)",
];

const COOP_TIME_SLOTS: Array<{ from: string; to: string; disabled?: boolean }> = [
  { from: "10:00", to: "12:00" },
  { from: "12:00", to: "14:00" },
  { from: "14:00", to: "16:00" },
  { from: "16:00", to: "18:00" },
  { from: "18:00", to: "20:00" },
];
const COOP_DELIVERY_LEAD_MINUTES = 180;
const HCM_PROVINCE = { code: "79", name: "Thành phố Hồ Chí Minh" };
const KNOWN_COOP_LOCATION_CODES: Array<Pick<CoopAddressParts, "provinceCode" | "provinceName" | "districtCode" | "districtName" | "wardCode" | "wardName">> = [
  { provinceCode: "79", provinceName: "Thành phố Hồ Chí Minh", districtCode: "7907", districtName: "Quận Tân Bình", wardCode: "790701", wardName: "Phường 02" },
  { provinceCode: "79", provinceName: "Thành phố Hồ Chí Minh", districtCode: "7908", districtName: "Quận Tân Phú", wardCode: "790801", wardName: "Phường Tân Sơn Nhì" },
];

function normalizeCoopText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "d")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeCoopProvince(value: string) {
  const normalized = normalizeCoopText(value);
  if (normalized === "tphcm" || normalized === "tp.hcm" || normalized === "tp hcm" || normalized.includes("ho chi minh")) {
    return HCM_PROVINCE.name;
  }
  return value.trim();
}

function normalizeCoopWard(value: string) {
  const normalized = normalizeCoopText(value);
  if (normalized.includes("tan son hoa")) return "Phường 02";
  return value.trim();
}

function inferCoopDistrictFromWard(wardName: string) {
  const ward = normalizeCoopText(wardName);
  if (ward.includes("tan son hoa") || ward === "phuong 2" || ward === "phuong 02") return "Quận Tân Bình";
  if (ward.includes("tan son nhi")) return "Quận Tân Phú";
  return "";
}

function applyKnownCoopLocationCodes(parts: CoopAddressParts): CoopAddressParts {
  const province = normalizeCoopText(parts.provinceName);
  const district = normalizeCoopText(parts.districtName);
  const ward = normalizeCoopText(parts.wardName);
  const known = KNOWN_COOP_LOCATION_CODES.find(
    (item) =>
      normalizeCoopText(item.provinceName) === province &&
      normalizeCoopText(item.districtName) === district &&
      normalizeCoopText(item.wardName) === ward,
  );
  return known ? { ...parts, ...known } : parts;
}

function parseCoopAddressParts(fullAddress: string): CoopAddressParts {
  const parts = fullAddress.split(",").map((item) => item.trim()).filter(Boolean);
  const provinceName = normalizeCoopProvince(parts.at(-1) || HCM_PROVINCE.name);
  let districtName = parts.length >= 4 ? parts.at(-2) || "" : "";
  let wardName = parts.length >= 3 ? normalizeCoopWard(parts.at(-3) || "") : "";
  let addressLine = parts.length >= 4 ? parts.slice(0, -3).join(", ") : parts[0] || "";
  if (parts.length === 3) {
    const middle = normalizeCoopWard(parts[1] || "");
    wardName = middle;
    districtName = inferCoopDistrictFromWard(middle);
    addressLine = parts[0] || "";
  }
  if (!districtName && wardName) districtName = inferCoopDistrictFromWard(wardName);
  const withProvinceCode = normalizeCoopText(provinceName).includes("ho chi minh") ? HCM_PROVINCE.code : "";
  return applyKnownCoopLocationCodes({
    addressLine,
    provinceCode: withProvinceCode,
    provinceName,
    districtCode: "",
    districtName,
    wardCode: "",
    wardName,
  });
}

function composeCoopFullAddress(parts: CoopAddressParts) {
  return [parts.addressLine, parts.wardName, parts.districtName, parts.provinceName].map((item) => item.trim()).filter(Boolean).join(", ");
}

function findCoopLocationByName(items: CoopLocationOption[], name: string) {
  const normalized = normalizeCoopText(name);
  return items.find((item) => normalizeCoopText(item.name) === normalized || normalizeCoopText(item.name).includes(normalized));
}

async function fetchCoopLocations(level: "provinces" | "districts" | "wards", params: Record<string, string> = {}) {
  const search = new URLSearchParams({ level, ...params });
  const res = await fetch(`/api/coop/locations?${search.toString()}`, { cache: "no-store" });
  const data = (await res.json().catch(() => ({}))) as { items?: CoopLocationOption[]; error?: string };
  if (!res.ok || data.error) throw new Error(data.error || "Không tải được danh mục địa chỉ Co.op.");
  return data.items || [];
}

async function getAgentWsUrl(sessionId: string, chain?: string) {
  const baseUrl = process.env.NEXT_PUBLIC_ORDER_AGENT_SERVER_URL || "ws://localhost:8080";
  const separator = baseUrl.includes("?") ? "&" : "?";
  try {
    const res = await fetch(`/api/agent/token?sessionId=${sessionId}`);
    if (res.ok) {
      const data = await res.json();
      if (data.token) {
        return `${baseUrl}${separator}sessionId=${sessionId}${chain ? `&chain=${encodeURIComponent(chain)}` : ""}&timestamp=${data.timestamp}&token=${data.token}`;
      }
    }
  } catch (err) {
    console.error("Error fetching agent token:", err);
  }
  return `${baseUrl}${separator}sessionId=${sessionId}${chain ? `&chain=${encodeURIComponent(chain)}` : ""}`;
}

export default function OrderAgentModal({
  offer,
  alternatives = [],
  geoAddr,
  geoLat,
  geoLng,
  defaultName,
  defaultPhone,
  defaultAddress,
  defaultQty,
  onClose,
  onPlaced,
  lang = "vi",
}: {
  offer: RankedOffer;
  /** Các nơi bán khác cùng món này (đã xếp hạng) — để gợi ý chọn lại. */
  alternatives?: RankedOffer[];
  /** Địa chỉ theo định vị — so với địa chỉ giao để biết có lệch không. */
  geoAddr?: string;
  /** Toạ độ theo định vị của người dùng — dùng làm fallback khi geocode địa chỉ thất bại. */
  geoLat?: number;
  geoLng?: number;
  defaultName?: string;
  defaultPhone?: string;
  defaultAddress?: string;
  defaultQty?: number;
  onClose: () => void;
  onPlaced: (orderCode: string, chosen: RankedOffer, note?: string) => void;
  lang?: Lang;
}) {
  const t = (vi: string, vars?: Record<string, string | number>) => tr(lang, vi, vars);
  const [phase, setPhase] = useState<"form" | "running" | "done">("form");

  // Nơi mua đang chọn — user có thể đổi nếu địa chỉ giao khác vị trí định vị.
  const [activeOffer, setActiveOffer] = useState<RankedOffer>(offer);
  const chain = chainLabel(activeOffer.store.chain);
  // Mỗi nguồn cần thông tin/đăng nhập khác nhau → form + các bước chạy theo đó.
  const cfg = useMemo(() => getOrderConfig(activeOffer.store.chain), [activeOffer.store.chain]);
  // DEMO_MODE: tắt tích hợp thật (BHX/Coop/TXNN cần agent-server/kết nối) → mọi nguồn
  // chạy luồng mô phỏng để test 3 phương thức thanh toán không cần kết nối.
  const DEMO_MODE = true;
  const isCoopReal = !DEMO_MODE && activeOffer.store.chain === "coop";
  const isTXNNReal = !DEMO_MODE && activeOffer.store.chain === "tuoixanhnhanhngon";
  const isBHXReal = !DEMO_MODE && activeOffer.store.chain === "bhx";

  // Thông tin cần có để đặt món này — tự điền lại từ hồ sơ đã lưu (nếu có)
  const saved = useMemo(() => getProfile(), []);
  const oldCoopAddress = defaultAddress || saved.address;
  const initialAddress = oldCoopAddress;
  const initialCoopAddressParts = useMemo(() => parseCoopAddressParts(initialAddress), [initialAddress]);
  const [name, setName] = useState(defaultName || saved.name);
  const [phone, setPhone] = useState(defaultPhone || saved.phone);
  const [coopAddressLine, setCoopAddressLine] = useState(initialCoopAddressParts.addressLine);
  const [coopProvinceCode, setCoopProvinceCode] = useState(initialCoopAddressParts.provinceCode);
  const [coopProvinceName, setCoopProvinceName] = useState(initialCoopAddressParts.provinceName);
  const [coopDistrictCode, setCoopDistrictCode] = useState(initialCoopAddressParts.districtCode);
  const [coopDistrictName, setCoopDistrictName] = useState(initialCoopAddressParts.districtName);
  const [coopWardCode, setCoopWardCode] = useState(initialCoopAddressParts.wardCode);
  const [coopWardName, setCoopWardName] = useState(initialCoopAddressParts.wardName);
  const [address, setAddress] = useState(composeCoopFullAddress(initialCoopAddressParts) || initialAddress);
  const [email, setEmail] = useState("");
  const [qty, setQty] = useState(defaultQty && defaultQty > 0 ? Math.floor(defaultQty) : 1);
  // Phần SL "tự thêm" để đủ mức mua tối thiểu của chuỗi (vd Co.op 200k) — bơm 1 lần lúc mở
  // form, y như giỏ hàng bake vào item.qty. Bấm +/- (chỉnh tay) sẽ reset về 0 → counter thuần.
  const [autoQty, setAutoQty] = useState(0);
  const [slot, setSlot] = useState(SLOTS[0]);
  // Ghi chú cho cửa hàng — đồng bộ cấu trúc với ô ghi chú từng cửa hàng của giỏ (CartModal).
  const [note, setNote] = useState("");
  const [coopDeliveryDate, setCoopDeliveryDate] = useState("");
  const [coopSlotFrom, setCoopSlotFrom] = useState("");
  const [coopSlotTo, setCoopSlotTo] = useState("");

  // Khoá scroll body khi modal mở (refcount chung — lib/scroll-lock.ts)
  useEffect(() => acquireBodyScrollLock(), []);

  // Cứ gõ là lưu — không cần rời khỏi ô. localStorage tức thì + đẩy lên Sheet (debounce).
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    saveProfile({ name, phone, address });
  }, [name, phone, address]);

  // Trạng thái chạy của trợ lý
  const [stepIndex, setStepIndex] = useState(0);
  const placedRef = useRef(false);
  const [otp, setOtp] = useState("");
  const [otpError, setOtpError] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [serverState, setServerState] = useState<PublicOrderSessionState | null>(null);
  const [popupViewerOpen, setPopupViewerOpen] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [paymentConfirmSubmitting, setPaymentConfirmSubmitting] = useState(false);
  const closingSessionRef = useRef(false);
  const sessionIdRef = useRef<string | null>(null);
  const sessionStatusRef = useRef<PublicOrderSessionState["status"] | undefined>(undefined);
  // Mã OTP MÔ PHỎNG (bản demo chưa kết nối SMS thật): sinh ngẫu nhiên 6 số khi tới bước OTP,
  // hiển thị như "tin nhắn" để bạn nhập thử. KHÔNG phải mã thật từ cửa hàng.
  const [simOtp, setSimOtp] = useState("");
  // KHÔNG mặc định chọn phương thức thanh toán — user tự chọn (null = chưa chọn).
  const [demoPayMethod, setDemoPayMethod] = useState<DemoPayMethod | null>(null);
  const [cardNum, setCardNum] = useState("");
  const [cardExp, setCardExp] = useState("");
  const [cardCvv, setCardCvv] = useState("");
  const [cardSaved, setCardSaved] = useState(true);
  // Thẻ đã lưu từ lần mua trước (localStorage) — có thì mặc định dùng lại (như giỏ hàng).
  const [savedCard, setSavedCard] = useState<SavedCardType | null>(() => getSavedCard());
  // Máy này chưa có thẻ ở localStorage → thử lấy thẻ đã che từ tài khoản (sheet) để hiện
  // "thẻ đã lưu" khi đăng nhập mua lại. Có thẻ local rồi thì ưu tiên local (đủ full số).
  useEffect(() => {
    if (getSavedCard()) return;
    let alive = true;
    void fetchAccountCard().then((c) => { if (alive && c) setSavedCard(c); });
    return () => { alive = false; };
  }, []);
  const [useNewCard, setUseNewCard] = useState(false);
  const usingSavedCard = !!savedCard && !useNewCard;
  // Thẻ "sẵn sàng" — thẻ đã lưu, hoặc thẻ mới điền đủ ngay ở form (số + hạn + CVV) — như giỏ hàng.
  const newCardReady = cardNum.replace(/\s/g, "").length >= 12 && /^\d{2}\/\d{2}$/.test(cardExp) && cardCvv.length >= 3;
  const cardReady = usingSavedCard || newCardReady;
  const cardLast4 = (usingSavedCard && savedCard ? savedCard.number : cardNum).replace(/\D/g, "").slice(-4);
  // Loại thẻ + số che ****: hiện ở chỗ tóm tắt "Thanh toán" (đồng bộ maskedCardLabel của giỏ/túi).
  const cardBrand = usingSavedCard && savedCard ? savedCard.brand : detectCardBrand(cardNum);
  const maskedCardLabel = `${cardBrand ?? t("Thẻ")} ****${cardLast4}`;
  // Hàng chip "Chấp nhận: VISA MASTERCARD…" — đồng bộ với giỏ hàng (CartModal.brandChipsRow).
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
  // Snapshot lúc bấm chạy (như CartModal): thẻ đã đủ ở form → bước thẻ TỰ CHẠY, không hỏi nhập lại.
  const [cardConfirmed, setCardConfirmed] = useState(false);
  // Xem full số thẻ đã lưu: bấm 👁 → OTP (mô phỏng) gửi tới SĐT → nhập đúng mới hiện (như giỏ hàng).
  const [cardOtpCode, setCardOtpCode] = useState<string | null>(null);
  const [cardOtpInput, setCardOtpInput] = useState("");
  const [cardOtpError, setCardOtpError] = useState(false);
  const [cardRevealed, setCardRevealed] = useState(false);
  const requestRevealCard = () => {
    if (cardRevealed) {
      setCardRevealed(false);
      setCardOtpCode(null);
      setCardOtpInput("");
      setCardOtpError(false);
      return;
    }
    setCardOtpCode(String(Math.floor(100000 + Math.random() * 900000)));
    setCardOtpInput("");
    setCardOtpError(false);
  };
  const verifyCardOtp = () => {
    if (cardOtpInput === cardOtpCode) {
      setCardRevealed(true);
      setCardOtpCode(null);
      setCardOtpError(false);
    } else {
      setCardOtpError(true);
    }
  };
  // Chọn "Thẻ" + dùng thẻ đã lưu → prefill số/hạn thẻ để bước trợ lý hiện sẵn, không bắt nhập lại.
  useEffect(() => {
    if (demoPayMethod === "card" && usingSavedCard && savedCard && !cardNum) {
      setCardNum(savedCard.number);
      setCardExp(savedCard.exp);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demoPayMethod, usingSavedCard]);
  const [orderCode, setOrderCode] = useState("");
  const [coopBusy, setCoopBusy] = useState(false);
  const [coopFlowId, setCoopFlowId] = useState("");
  const [coopError, setCoopError] = useState("");
  const [coopResult, setCoopResult] = useState<CoopOrderResult | null>(null);
  const [coopCheckoutPrepared, setCoopCheckoutPrepared] = useState(false);
  const [coopStep, setCoopStep] = useState<CoopStepId>("account");
  const [coopBrowserVisible, setCoopBrowserVisible] = useState(false);
  const [coopBrowserStatus, setCoopBrowserStatus] = useState("");
  const [coopBrowserFrame, setCoopBrowserFrame] = useState("");
  const [coopBrowserSize, setCoopBrowserSize] = useState({ width: 1024, height: 768 });
  const [coopAddressBusy, setCoopAddressBusy] = useState(false);
  const [coopAddressChecked, setCoopAddressChecked] = useState(false);
  const [coopLocationsBusy, setCoopLocationsBusy] = useState(false);
  const [coopProvinces, setCoopProvinces] = useState<CoopLocationOption[]>([]);
  const [coopDistricts, setCoopDistricts] = useState<CoopLocationOption[]>([]);
  const [coopWards, setCoopWards] = useState<CoopLocationOption[]>([]);
  const [coopTerminals, setCoopTerminals] = useState<CoopTerminalChoice[]>([]);
  const [coopSelectedTerminalCode, setCoopSelectedTerminalCode] = useState("");
  const [coopSelectedPaymentCode, setCoopSelectedPaymentCode] = useState("COD");
  const [coopGeo, setCoopGeo] = useState<{ lat: number; lng: number } | null>(null);
  const [bhxMessages, setBhxMessages] = useState<Array<{ message: string; status?: string }>>([]);
  const [bhxBusy, setBhxBusy] = useState(false);
  const [bhxDeliveryHtml, setBhxDeliveryHtml] = useState("");
  const [bhxSelectedDeliveryText, setBhxSelectedDeliveryText] = useState("");
  const [bhxBrowserFrame, setBhxBrowserFrame] = useState("");
  const [bhxBrowserSize, setBhxBrowserSize] = useState({ width: 1024, height: 768 });
  const [bhxShowScreencast, setBhxShowScreencast] = useState(false);
  const bhxShowScreencastRef = useRef(false);
  const [bhxOtpVisible, setBhxOtpVisible] = useState(false);
  const [bhxOtp, setBhxOtp] = useState("");
  const coopBrowserWsRef = useRef<WebSocket | null>(null);
  const coopStreamWheelRef = useRef<HTMLDivElement | null>(null);
  const coopStreamImageRef = useRef<HTMLImageElement | null>(null);
  const lastCoopLookupAddressRef = useRef("");
  const coopCompletionHandledRef = useRef(false);
  const bhxBrowserWsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    bhxShowScreencastRef.current = bhxShowScreencast;
  }, [bhxShowScreencast]);

  const requiredInput = serverState?.requiredInput;
  const currentStepKind: StepKind =
    requiredInput === "otp"
      ? "otp"
      : requiredInput === "captcha"
        ? "captcha"
        : requiredInput === "login"
          ? "login"
          : requiredInput === "qr_payment"
            ? "qr"
            : requiredInput === "final_confirmation"
              ? "confirm"
              : serverState?.status === "completed"
                ? "success"
                : "auto";

  const steps: Step[] = useMemo(() => {
    // BLOCK 2: Nếu có trạng thái từ server, hiển thị timeline thực tế từ server
    if (serverState) {
      const timeline: Step[] = serverState.timeline.map((item) => ({
        kind: "auto",
        label: item.message,
      }));

      if (serverState.status === "completed") {
        timeline.push({ kind: "success", label: t("Đặt hàng thành công") });
      } else if (serverState.requiredInput) {
        timeline.push({ kind: currentStepKind, label: serverState.message });
      }

      return timeline;
    }

    // BLOCK 1: Nếu chưa có serverState, hiển thị danh sách các bước dự kiến (mặc định)
    const s: Step[] = [{ kind: "auto", label: t("Mở website {chain}…", { chain }) }];

    // Affree đặt hộ bằng tài khoản Affree trên nguồn — khách KHÔNG cần đăng nhập/OTP.
    // (SĐT khách chỉ dùng làm liên hệ nhận hàng, điền cùng bước địa chỉ giao.)

    s.push({ kind: "auto", label: t('Thêm "{name}" vào giỏ (SL {qty})…', { name: activeOffer.product.name, qty }) });

    if (cfg.needStorePick) {
      s.push({ kind: "auto", label: t("Chọn điểm giao: {store}…", { store: activeOffer.store.name }) });
    }

    s.push({ kind: "auto", label: t("Điền thông tin nhận hàng: {address} · SĐT {phone}…", { address: address || t("(địa chỉ của bạn)"), phone: phone || t("(của bạn)") }) });

    if (cfg.needEmail) {
      s.push({ kind: "auto", label: t("Điền email nhận hoá đơn: {email}…", { email: email || t("(email của bạn)") }) });
    }

    if (cfg.needSlot) {
      s.push({ kind: "auto", label: t('Chọn khung giờ "{slot}"…', { slot: t(slot) }) });
    }

    // Phương thức thanh toán đã chọn ở form đặt hàng — trợ lý áp dụng luôn, không hỏi lại.
    // QR/Thẻ vẫn dừng để khách quét mã / nhập thẻ; COD chạy thẳng.
    if (demoPayMethod === "qr") {
      s.push({ kind: "payment-select", label: t("Thanh toán QR chuyển khoản") });
    } else if (demoPayMethod === "card") {
      // Thẻ đã đủ ở form (đã lưu / vừa nhập) → bước thẻ tự chạy như giỏ hàng, không hỏi lại.
      s.push(cardConfirmed
        ? { kind: "auto", label: t("Thanh toán bằng thẻ ****{last4}…", { last4: cardLast4 }) }
        : { kind: "payment-select", label: t("Nhập thông tin thẻ") });
    } else {
      s.push({ kind: "auto", label: demoPayMethod === "cod" ? t("Chọn thanh toán COD — tiền mặt khi nhận hàng…") : t("Chọn phương thức thanh toán…") });
    }

    s.push({ kind: "confirm", label: t("Kiểm tra & xác nhận đơn hàng") });
    s.push({ kind: "auto", label: t("Đang gửi đơn tới {chain}…", { chain }) });
    s.push({ kind: "success", label: t("Đặt hàng thành công") });

    return s;
  }, [
    serverState,
    currentStepKind,
    chain,
    cfg,
    phone,
    email,
    address,
    qty,
    slot,
    demoPayMethod,
    cardConfirmed,
    cardLast4,
    activeOffer.product.name,
    activeOffer.store.name,
    lang,
    t
  ]);


  const usesServerTimeline = !isCoopReal && Boolean(serverState);
  const visibleSteps = usesServerTimeline ? steps : steps.slice(0, stepIndex + 1);
  const currentStepIndex = usesServerTimeline ? Math.max(0, visibleSteps.length - 1) : stepIndex;
  const current = visibleSteps[currentStepIndex] ?? steps[steps.length - 1];

  const isTerminalSessionStatus = (status?: PublicOrderSessionState["status"]) =>
    status === "completed" || status === "failed" || status === "cancelled" || status === "expired";

  useEffect(() => {
    sessionIdRef.current = sessionId;
    sessionStatusRef.current = serverState?.status;
  }, [sessionId, serverState?.status]);

  // Bước "auto" thì tự chạy tiếp sau 1 nhịp; bước cần người thì đứng chờ thao tác.
  useEffect(() => {
    if (phase !== "running" || !sessionId) return;
    let alive = true;
    let inFlight = false;
    let timer: number | null = null;
    let consecutiveIdlePolls = 0;
    let consecutivePollErrors = 0;
    let lastSeenUpdatedAt: string | null = null;

    const nextDelay = (status?: PublicOrderSessionState["status"], options?: { idle?: number; errors?: number }) => {
      const idle = options?.idle ?? 0;
      const errors = options?.errors ?? 0;

      if (errors > 0) {
        return Math.min(30000, 12000 + (errors - 1) * 6000);
      }

      if (status === "running" || status === "verifying_payment") {
        return Math.min(20000, 8000 + idle * 4000);
      }

      if (status?.startsWith("waiting_for_")) {
        return Math.min(30000, 15000 + idle * 5000);
      }

      return Math.min(20000, 10000 + idle * 4000);
    };

    const schedule = (status?: PublicOrderSessionState["status"], options?: { idle?: number; errors?: number }) => {
      if (!alive || isTerminalSessionStatus(status)) return;
      timer = window.setTimeout(() => {
        void poll();
      }, nextDelay(status, options));
    };

    const poll = async () => {
      if (!alive || inFlight) return;
      inFlight = true;
      try {
        const res = await fetch(`/api/order-sessions/${sessionId}`, { cache: "no-store" });
        const data = (await res.json()) as { ok: boolean; error?: string; state?: PublicOrderSessionState };
        if (!alive) return;
        if (!res.ok || !data.ok || !data.state) {
          consecutivePollErrors += 1;
          setSubmitError(data.error || t("Không đọc được trạng thái phiên đặt hàng."));
          schedule(undefined, { errors: consecutivePollErrors });
          return;
        }
        consecutivePollErrors = 0;
        const unchanged = lastSeenUpdatedAt === data.state.updatedAt;
        consecutiveIdlePolls = unchanged ? consecutiveIdlePolls + 1 : 0;
        lastSeenUpdatedAt = data.state.updatedAt;
        setServerState(data.state);
        schedule(data.state.status, { idle: consecutiveIdlePolls });
      } catch {
        if (!alive) return;
        consecutivePollErrors += 1;
        setSubmitError(t("Không đọc được trạng thái phiên đặt hàng."));
        schedule(undefined, { errors: consecutivePollErrors });
      } finally {
        inFlight = false;
      }
    };

    void poll();
    return () => {
      alive = false;
      if (timer) window.clearTimeout(timer);
    };
  }, [phase, sessionId, lang]);

  useEffect(() => {
    if (!serverState) return;
    if (serverState.status === "completed" && serverState.orderCode && !placedRef.current) {
      placedRef.current = true;
      setOrderCode(serverState.orderCode);
      setPhase("done");
      onPlaced(serverState.orderCode, activeOffer, note);
      return;
    }
    if (["failed", "cancelled", "expired"].includes(serverState.status)) {
      setSubmitError(serverState.error || serverState.message);
    }
  }, [serverState, phase, stepIndex, current, activeOffer, onPlaced, simOtp, note]);

  // Demo: tự chạy qua bước "auto" sau 1.2s; đến bước "success" → chuyển phase done.
  useEffect(() => {
    if (phase !== "running" || sessionId || !current) return;
    if (current.kind === "success") {
      const timer = window.setTimeout(() => {
        setOrderCode("DEMO-" + Math.random().toString(36).slice(2, 8).toUpperCase());
        setPhase("done");
        onPlaced("DEMO", activeOffer, note);
      }, 800);
      return () => window.clearTimeout(timer);
    }
    if (current.kind === "auto") {
      const timer = window.setTimeout(() => setStepIndex((x) => x + 1), 1200);
      return () => window.clearTimeout(timer);
    }
    if (current.kind === "otp") {
      const code = String(Math.floor(100000 + Math.random() * 900000));
      const timer = window.setTimeout(() => setSimOtp(code), 2000);
      return () => window.clearTimeout(timer);
    }
  }, [phase, sessionId, current, stepIndex, activeOffer, onPlaced, note]);

  const total = activeOffer.price * qty;
  const coopMinTotal = 200000;
  const coopBelowMinimum = isCoopReal && total < coopMinTotal;
  // Ràng buộc tối thiểu: số lượng từ cfg (mặc định 1); giá mua tối thiểu lấy từ sheet
  // "Giá tối thiểu" qua chainMinOrder (0 = không ràng buộc).
  const minQty = cfg.minQty ?? 1;
  const minOrderRaw = chainMinOrder(activeOffer.store.chain);
  const minOrder = minOrderRaw > 0 ? minOrderRaw : null;
  const curCode = storeCurrency(activeOffer.store.id);
  const belowMinOrder = minOrder != null && total < minOrder;
  // Tự bơm số lượng cho đủ mức mua tối thiểu — 1 lần khi mở form / đổi sản phẩm (như giỏ hàng
  // lúc thêm vào giỏ). Sau đó user bấm +/- thì thôi (setAutoQty(0) ở nút), không kéo ngược.
  const minPumpKey = `${activeOffer.store.id}:${activeOffer.product.id}`;
  const minPumpedRef = useRef<string | null>(null);
  useEffect(() => {
    if (minPumpedRef.current === minPumpKey) return;
    minPumpedRef.current = minPumpKey;
    const price = activeOffer.price;
    if (minOrder == null || price <= 0) return;
    const base = price * qty;
    if (base >= minOrder) return;
    const add = Math.ceil((minOrder - base) / price);
    setAutoQty(add);
    setQty(qty + add);
    // qty cố ý bỏ khỏi deps: chỉ bơm 1 lần/offer lúc mở (guard bằng minPumpedRef).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minPumpKey, minOrder, activeOffer.price]);
  const todayInput = formatDateInput(new Date());
  const coopDeliveryDates = (coopResult?.deliveryCheck?.availableDates ?? []).filter((date) => date >= todayInput);
  const coopDeliverySlots =
    (coopDeliveryDate ? coopResult?.deliveryCheck?.availableSlotsByDate?.[coopDeliveryDate] : undefined) ??
    coopResult?.deliveryCheck?.availableTimeSlots ??
    [];
  const coopSavedAddress = coopResult?.deliveryCheck?.fullAddress || "";
  const coopPaymentMethods = (coopResult?.paymentCheck?.methods ?? []).filter((method) => method.methodCode);
  const selectedCoopPaymentMethod =
    coopPaymentMethods.find((method) => method.methodCode === coopSelectedPaymentCode) ??
    coopPaymentMethods.find((method) => method.isSelected);
  const coopSelectedPaymentName =
    selectedCoopPaymentMethod?.name ||
    coopResult?.paymentCheck?.selectedMethodName ||
    coopSelectedPaymentCode ||
    coopResult?.paymentCheck?.selectedMethodCode ||
    "";
  const coopSelectedPaymentIsOnline =
    selectedCoopPaymentMethod?.paymentMethodType === "online" || Boolean(selectedCoopPaymentMethod?.methodCode && selectedCoopPaymentMethod.methodCode !== "COD");
  const effectiveCoopDeliverySlots = getEffectiveCoopDeliverySlots(
    coopDeliverySlots.length ? coopDeliverySlots : COOP_TIME_SLOTS,
    coopDeliveryDate,
  );
  const activeCoopTerminalCode = activeOffer.store.id.replace(/^coop-/, "");
  const coopTerminalCode = coopSelectedTerminalCode || activeCoopTerminalCode;
  const selectedCoopTerminal =
    coopTerminals.find((item) => getCoopTerminalCode(item) === coopTerminalCode) ?? null;

  const resetCoopAddressLookup = () => {
    setCoopAddressChecked(false);
    setCoopSelectedTerminalCode("");
    setCoopTerminals([]);
    setCoopGeo(null);
    setCoopCheckoutPrepared(false);
    lastCoopLookupAddressRef.current = "";
  };

  const coopAddressParts = applyKnownCoopLocationCodes({
    addressLine: coopAddressLine.trim(),
    provinceCode: coopProvinceCode,
    provinceName: coopProvinceName,
    districtCode: coopDistrictCode,
    districtName: coopDistrictName,
    wardCode: coopWardCode,
    wardName: coopWardName,
  });

  const updateCoopAddress = (patch: Partial<CoopAddressParts>) => {
    const next = applyKnownCoopLocationCodes({ ...coopAddressParts, ...patch });
    setCoopAddressLine(next.addressLine);
    setCoopProvinceCode(next.provinceCode);
    setCoopProvinceName(next.provinceName);
    setCoopDistrictCode(next.districtCode);
    setCoopDistrictName(next.districtName);
    setCoopWardCode(next.wardCode);
    setCoopWardName(next.wardName);
    setAddress(composeCoopFullAddress(next));
    resetCoopAddressLookup();
  };

  // Kiểm tra SĐT theo quốc gia của cửa hàng (suy từ tiền tệ): VN / US / quốc tế.
  const rule = useMemo(
    () => phoneRule(storeCurrency(activeOffer.store.id)),
    [activeOffer.store.id]
  );
  const phoneDigits = phone.replace(/[\s.\-()]/g, "").replace(/^(\+?84)/, "0");
  const phoneValid = rule.test(phone);
  const phoneError = phone.trim().length > 0 && !phoneValid;

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const emailError = cfg.needEmail && email.trim().length > 0 && !emailValid;
  const coopDeliveryReady = !!coopDeliveryDate && !!coopSlotFrom && !!coopSlotTo;
  const coopStructuredAddressReady = Boolean(
    coopAddressParts.addressLine &&
    coopAddressParts.provinceCode &&
    coopAddressParts.districtCode &&
    coopAddressParts.wardCode,
  );
  const coopCanStart =
    !!name.trim() &&
    phoneValid &&
    coopStructuredAddressReady &&
    coopAddressChecked &&
    !!coopTerminalCode &&
    !coopBelowMinimum &&
    qty > 0;
  // Nhánh nào hiện tabs QR/Thẻ/COD (BHX + demo) → bắt buộc CHỌN phương thức mới cho đặt.
  const payTabsShown = isBHXReal || (!isCoopReal && !isTXNNReal);
  const canStart =
    !!name.trim() &&
    phoneValid &&
    !!address.trim() &&
    qty >= minQty &&
    !belowMinOrder &&
    (!cfg.needEmail || emailValid) &&
    (!payTabsShown || demoPayMethod !== null) &&
    (!isCoopReal || coopCanStart);

  // BHX cho khách tự chọn COD / QR / Thẻ (demoPayMethod). QR & Thẻ = thanh toán online.
  const bhxPayOnline = isBHXReal && (demoPayMethod === "qr" || demoPayMethod === "card");
  const usesQrPayment =
    isTXNNReal ||
    bhxPayOnline ||
    steps.some((item) => item.kind === "qr") ||
    serverState?.status === "waiting_for_qr_payment" ||
    serverState?.status === "verifying_payment";
  const paymentLabel = isTXNNReal
    ? t("QR chuyển khoản")
    : isBHXReal || (!sessionId && !isCoopReal)
      ? demoPayMethod === "qr" ? t("QR chuyển khoản") : demoPayMethod === "card" ? (cardLast4 ? maskedCardLabel : t("Thẻ tín dụng/ghi nợ")) : demoPayMethod === "cod" ? t("COD (tiền mặt khi nhận)") : t("Chưa chọn")
      : usesQrPayment ? t("QR chuyển khoản") : t("COD (tiền mặt khi nhận)");
  const paymentConfirmBusy = paymentConfirmSubmitting || serverState?.status === "verifying_payment";
  const popupFrameTs = serverState?.popup?.updatedAt || serverState?.updatedAt;
  const popupFrameSrc = sessionId && popupFrameTs
    ? `/api/order-sessions/${sessionId}/popup-frame?ts=${encodeURIComponent(popupFrameTs)}`
    : null;
  const popupCurrentView = serverState?.popup?.view || (serverState?.popupFrameAvailable ? "full" : undefined);
  const popupShowingQr = popupCurrentView !== "confirm";

  useEffect(() => {
    if (!popupViewerOpen) return;
    if (!sessionId || !serverState?.popupFrameAvailable || !serverState?.popup) {
      setPopupViewerOpen(false);
    }
  }, [popupViewerOpen, sessionId, serverState?.popupFrameAvailable, serverState?.popup]);

  useEffect(() => {
    if (!popupViewerOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setPopupViewerOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [popupViewerOpen]);

  function handlePopupFrameClick(event: React.MouseEvent<HTMLImageElement>) {
    if (!serverState?.popupFrameAvailable) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const xRatio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    const yRatio = Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height));
    void sendSessionEvent({ type: "popup_click", xRatio, yRatio });
  }

  async function switchPopupView(view: "qr" | "confirm" | "full") {
    await sendSessionEvent({ type: "popup_switch_view", view });
  }


  async function createSession() {
    flushProfile({ name, phone, address });
    placedRef.current = false;
    closingSessionRef.current = false;
    setPaymentConfirmSubmitting(false);
    setSessionId(null);
    setServerState(null);
    setOrderCode("");
    setOtp("");
    setOtpError(false);
    setSubmitError("");
    setSubmitting(true);

    try {
      const res = await fetch("/api/order-sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: "tuoixanhnhanhngon",
          offer: {
            productId: activeOffer.product.id,
            productName: activeOffer.product.name,
            productUrl: activeOffer.productUrl,
            storeId: activeOffer.store.id,
            price: activeOffer.price,
          },
          quantity: qty,
          customer: {
            name,
            phone,
            address,
          },
          delivery: cfg.needSlot ? { slot } : undefined,
          idempotencyKey: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${activeOffer.store.id}`,
        }),
      });
      const data = (await res.json()) as { ok: boolean; error?: string; sessionId?: string; state?: PublicOrderSessionState };
      if (!res.ok || !data.ok || !data.sessionId || !data.state) {
        throw new Error(data.error || t("Không tạo được phiên đặt hàng."));
      }
      setSessionId(data.sessionId);
      setServerState(data.state);
      setPhase("running");
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : t("Không tạo được phiên đặt hàng."));
    } finally {
      setSubmitting(false);
    }
  }

  async function sendSessionEvent(event: Record<string, unknown>) {
    if (!sessionId) return;
    setSubmitError("");
    try {
      const res = await fetch(`/api/order-sessions/${sessionId}/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(event),
      });
      const data = (await res.json()) as { ok: boolean; error?: string; state?: PublicOrderSessionState | null };
      if (!res.ok || !data.ok || !data.state) {
        throw new Error(data.error || t("Không gửi được thao tác cho phiên đặt hàng."));
      }
      setServerState(data.state);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : t("Không gửi được thao tác cho phiên đặt hàng."));
    }
  }

  async function submitPaymentConfirmed() {
    if (paymentConfirmBusy) return;
    setPaymentConfirmSubmitting(true);
    try {
      await sendSessionEvent({ type: "payment_submitted" });
    } finally {
      setPaymentConfirmSubmitting(false);
    }
  }

  async function releaseCurrentSession(options?: { keepalive?: boolean }) {
    if (!sessionId || isTerminalSessionStatus(serverState?.status) || closingSessionRef.current) return;
    closingSessionRef.current = true;
    try {
      await fetch(`/api/order-sessions/${sessionId}/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "cancel" }),
        keepalive: options?.keepalive,
      });
    } catch {
      // Đóng modal vẫn nên tiếp tục ngay cả khi request cancel bị lỗi mạng.
    }
  }

  async function handleCloseModal() {
    setPopupViewerOpen(false);
    await releaseCurrentSession();
    onClose();
  }

  useEffect(() => {
    return () => {
      const activeSessionId = sessionIdRef.current;
      const activeStatus = sessionStatusRef.current;
      if (!activeSessionId || isTerminalSessionStatus(activeStatus) || closingSessionRef.current) return;
      closingSessionRef.current = true;
      void fetch(`/api/order-sessions/${activeSessionId}/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "cancel" }),
        keepalive: true,
      }).catch(() => undefined);
    };
  }, []);

  const postCoopOrder = async (payload: Record<string, unknown>) => {
    const res = await fetch("/api/coop/order", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = (await res.json().catch(() => ({}))) as CoopOrderResult;
    if (!res.ok || data.error) {
      const err = new Error(data.error || t("Co.op đang lỗi, vui lòng thử lại."));
      (err as Error & { code?: string }).code = data.code;
      throw err;
    }
    return data;
  };

  const coopPayload = () => ({
    phone: phoneDigits,
    name,
    address,
    addressLine: coopAddressParts.addressLine,
    provinceId: coopAddressParts.provinceCode,
    provinceName: coopAddressParts.provinceName,
    districtId: coopAddressParts.districtCode,
    districtName: coopAddressParts.districtName,
    wardId: coopAddressParts.wardCode,
    wardName: coopAddressParts.wardName,
    quantity: qty,
    price: activeOffer.price,
    sku: activeOffer.productId,
    productId: activeOffer.product.id,
    productName: activeOffer.product.name,
    productUrl: activeOffer.productUrl,
    terminalCode: coopTerminalCode,
    terminalName: selectedCoopTerminal ? getCoopTerminalName(selectedCoopTerminal) : activeOffer.store.name,
    terminalAddress: selectedCoopTerminal ? getCoopTerminalAddress(selectedCoopTerminal) : activeOffer.store.address,
    fullAddress: address,
    siteId: getCoopTerminalNumber(selectedCoopTerminal, "siteId"),
    terminalId: selectedCoopTerminal?.terminalId,
    lat: coopGeo?.lat,
    lng: coopGeo?.lng,
  });

  const applyCoopDeliverySelection = (data: CoopOrderResult) => {
    const dates = (data.deliveryCheck?.availableDates ?? []).filter((date) => date >= todayInput);
    const selectedDate = data.deliveryCheck?.selectedDate && data.deliveryCheck.selectedDate >= todayInput
      ? data.deliveryCheck.selectedDate
      : dates[0] || coopDeliveryDate || "";
    if (selectedDate) setCoopDeliveryDate(selectedDate);

    const candidateSlots = getEffectiveCoopDeliverySlots(
      selectedDate && data.deliveryCheck?.availableSlotsByDate?.[selectedDate]?.length
        ? data.deliveryCheck.availableSlotsByDate[selectedDate]
        : data.deliveryCheck?.availableTimeSlots?.length
          ? data.deliveryCheck.availableTimeSlots
          : COOP_TIME_SLOTS,
      selectedDate,
    );
    const selectedSlot =
      candidateSlots.find(
        (item) =>
          item.from === data.deliveryCheck?.selectedSlotFrom &&
          item.to === data.deliveryCheck?.selectedSlotTo &&
          !item.disabled,
      ) ??
      candidateSlots.find((item) => !item.disabled) ??
      candidateSlots[0];
    if (selectedSlot) {
      setCoopSlotFrom(selectedSlot.from);
      setCoopSlotTo(selectedSlot.to);
    } else {
      setCoopSlotFrom("");
      setCoopSlotTo("");
    }
  };

  const setCoopCartReady = (data: CoopOrderResult) => {
    setCoopResult(data);
    setCoopFlowId("");
    setOtp("");
    setCoopCheckoutPrepared(false);
    setCoopStep("delivery");
    setStepIndex(2);
    setCoopSelectedPaymentCode(data.paymentCheck?.selectedMethodCode || "COD");
    applyCoopDeliverySelection(data);
  };

  const startBHXOrder = async () => {
    if (bhxBrowserWsRef.current) {
      bhxBrowserWsRef.current.close();
    }

    setStepIndex(0);
    setOtp("");
    setOtpError(false);
    setSimOtp("");
    setPhase("running");
    setBhxBusy(true);
    setBhxMessages([{ message: t("Đang kết nối agent-server…") }]);
    setBhxDeliveryHtml("");
    setBhxSelectedDeliveryText("");
    setBhxBrowserFrame("");
    setBhxBrowserSize({ width: 1024, height: 768 });
    setBhxShowScreencast(false);
    bhxShowScreencastRef.current = false;
    setBhxOtpVisible(false);
    setBhxOtp("");

    const wsSessionId = `bhx-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
    const wsUrl = await getAgentWsUrl(wsSessionId, activeOffer.store.chain);
    const ws = new WebSocket(wsUrl);
    bhxBrowserWsRef.current = ws;

    const sendBHXOrderRequest = () => {
      try {
        ws.send(
          JSON.stringify({
            type: "run_order",
            payload: {
              url: activeOffer.productUrl,
              productName: activeOffer.product.name,
              qty,
              buyerName: name,
              buyerPhone: phone,
              buyerAddress: address,
              chain: activeOffer.store.chain,
              paymentMethod: demoPayMethod ?? "cod",
            },
          }),
        );
      } catch (err) {
        setBhxBusy(false);
        setBhxMessages((logs) => [
          ...logs,
          { message: err instanceof Error ? err.message : String(err), status: "error" },
        ]);
      }
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(String(event.data)) as {
          type?: string;
          message?: string;
          status?: string;
          phase?: string;
          content?: string;
          data?: string;
          width?: number;
          height?: number;
        };
        if (message.type === "screencast" && message.data) {
          if (bhxShowScreencastRef.current) {
            setBhxBrowserFrame(`data:image/jpeg;base64,${message.data}`);
            if (message.width && message.height) setBhxBrowserSize({ width: message.width, height: message.height });
          }
        } else if (message.type === "message" && message.content) {
          setBhxMessages((logs) => [...logs, { message: message.content || "", status: 'success' }]);
        } else if (message.type === "status") {
          if (message.phase === 'ready') {
            setBhxMessages((logs) => [...logs, { message: t("Agent-server đã sẵn sàng, bắt đầu chạy Bách Hóa Xanh."), status: "success" }]);
            sendBHXOrderRequest();
          } else if (message.phase === "failed" || message.phase === "done" || message.phase === "success") {
            setBhxBusy(false);
          }
        } else if (message.type === 'popup_delivery_time' && message.content) {
          setBhxDeliveryHtml(message.content);
        } else if (message.type === 'order_success' && message.content) {
          setBhxBusy(false);
          bhxShowScreencastRef.current = true;
          setBhxShowScreencast(true);
          setBhxDeliveryHtml("");
          setBhxMessages((logs) => [...logs, { message: message.content || "", status: "success" }]);
        } else if (message.type === 'input_otp') {
          setBhxOtpVisible(true);
          setBhxOtp("");
          setBhxMessages((logs) => [...logs, { message: message.content || t("Vui lòng nhập mã OTP."), status: "warning" }]);
        }
      } catch (err) {
        console.error("Error handling BHX agent message:", err);
      }
    };
    ws.onerror = () => {
      setBhxBusy(false);
      setBhxMessages((logs) => [...logs, { message: t("Không kết nối được agent-server BHX."), status: "error" }]);
    };
    ws.onclose = () => {
      setBhxBusy(false);
      setBhxMessages((logs) => [...logs, { message: t("Kết nối agent-server đã đóng."), status: "info" }]);
    };
  };

  const handleBHXDeliveryChoice = (event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (!target) return;

    const dateEl = target.closest<HTMLElement>("[data-delivery-date]");
    const labelEl = target.closest<HTMLElement>("label.radio-wrapper");
    const optionEl = labelEl || dateEl;
    if (!optionEl) return;

    const selectedText =
      labelEl?.querySelector<HTMLElement>(".line-clamp-1")?.textContent?.trim() ||
      dateEl?.textContent?.trim() ||
      optionEl.textContent?.trim() ||
      "";
    const price = labelEl?.querySelector<HTMLElement>(".text-right")?.textContent?.trim() || "";
    const deliveryDate = dateEl?.dataset.deliveryDate || "";
    const kind = dateEl ? "date" : "time";
    const compactText = selectedText.replace(/\s+/g, " ").trim();

    if (!compactText) return;
    setBhxSelectedDeliveryText(price ? `${compactText} - ${price}` : compactText);

    if (kind === "time") {
      const radio = labelEl?.querySelector<HTMLInputElement>('input[type="radio"]');
      if (radio) radio.checked = true;
      setBhxMessages((logs) => [
        ...logs,
        {
          message: price
            ? t("Bạn đã chọn: {choice} - {price}", { choice: compactText, price })
            : t("Bạn đã chọn: {choice}", { choice: compactText }),
          status: "success",
        },
      ]);
    }

    const ws = bhxBrowserWsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      setBhxMessages((logs) => [...logs, { message: t("Chưa kết nối agent-server để gửi lựa chọn giao hàng."), status: "error" }]);
      return;
    }
    ws.send(
      JSON.stringify({
        type: "delivery_time_selected",
        kind,
        selectedText: compactText,
        price,
        deliveryDate,
      }),
    );
    if (kind === "time") {
      setBhxDeliveryHtml("");
    }
  };

  const submitBHXOtp = () => {
    const code = bhxOtp.trim();
    if (!code) return;

    const ws = bhxBrowserWsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      setBhxMessages((logs) => [...logs, { message: t("Chưa kết nối agent-server để gửi OTP."), status: "error" }]);
      return;
    }

    ws.send(JSON.stringify({ type: "submit_otp", otp: code }));
    setBhxOtpVisible(false);
    setBhxMessages((logs) => [...logs, { message: t("Đã gửi OTP tới agent-server."), status: "success" }]);
  };

  const startCoopOrder = async () => {
    setCoopBusy(true);
    setCoopError("");
    setCoopResult(null);
    setCoopFlowId("");
    setCoopCheckoutPrepared(false);
    setCoopStep("account");
    setCoopBrowserVisible(false);
    setCoopBrowserFrame("");
    setCoopBrowserStatus("");
    coopCompletionHandledRef.current = false;
    setOtp("");
    setOrderCode("");
    setPhase("running");
    setStepIndex(0);
    try {
      const data = await postCoopOrder({ action: "register", ...coopPayload() });
      setCoopResult(data);
      if (data.phase === "otp" && data.flowId) {
        setCoopResult(data);
        setCoopFlowId(data.flowId);
        setCoopStep("otp");
        setStepIndex(1);
        return;
      }
      if (data.phase === "cart") {
        setCoopCartReady(data);
        return;
      }
      throw new Error(t("Co.op trả kết quả chưa hỗ trợ."));
    } catch (err) {
      setCoopError(err instanceof Error ? err.message : String(err));
      const code = (err as Error & { code?: string }).code;
      if (code === "COOP_DEFAULT_ADDRESS_MISSING" || code === "COOP_TOKEN_CACHE_MISSING") {
        setCoopBrowserStatus(t("Co.op cần cập nhật hồ sơ trước. Đang mở màn hình để tự điền thông tin..."));
        openCoopBrowserAssist(undefined, "profileSetup");
      }
      setPhase("form");
    } finally {
      setCoopBusy(false);
    }
  };

  const confirmCoopOtp = async () => {
    if (!coopFlowId || otp.length !== 6) return;
    setCoopBusy(true);
    setCoopError("");
    try {
      const data = await postCoopOrder({ action: "confirm", flowId: coopFlowId, code: otp });
      setCoopCartReady(data);
    } catch (err) {
      setCoopError(err instanceof Error ? err.message : String(err));
    } finally {
      setCoopBusy(false);
    }
  };

  const resendCoopOtp = async () => {
    if (!coopFlowId) return;
    setCoopBusy(true);
    setCoopError("");
    try {
      await postCoopOrder({ action: "resend", flowId: coopFlowId });
    } catch (err) {
      setCoopError(err instanceof Error ? err.message : String(err));
    } finally {
      setCoopBusy(false);
    }
  };

  const prepareCoopCheckout = async () => {
    if (!coopResult?.checkoutFlowId || !coopDeliveryReady) return;
    setCoopBusy(true);
    setCoopError("");
    setCoopCheckoutPrepared(false);
    try {
      const data = await postCoopOrder({
        action: "prepareCheckout",
        checkoutFlowId: coopResult.checkoutFlowId,
        deliveryDate: coopDeliveryDate,
        slotFrom: coopSlotFrom,
        slotTo: coopSlotTo,
        paymentMethodCode: coopSelectedPaymentCode || "COD",
      });
      const nextResult = { ...(coopResult ?? {}), ...data };
      setCoopResult(nextResult);
      applyCoopDeliverySelection(nextResult);
      setCoopSelectedPaymentCode(nextResult.paymentCheck?.selectedMethodCode || coopSelectedPaymentCode || "COD");
      setCoopCheckoutPrepared(true);
      setCoopStep("review");
      setCoopBrowserStatus("");
      const preparedPaymentCode = nextResult.paymentCheck?.selectedMethodCode || coopSelectedPaymentCode || "COD";
      const shouldOpenCheckoutStream = preparedPaymentCode === "COD";
      if (shouldOpenCheckoutStream) {
        setCoopBrowserStatus(t("Đã cập nhật lịch giao và COD. Đang mở checkout Co.op để bạn đặt hàng..."));
        openCoopBrowserAssist(nextResult, "checkout");
      }
    } catch (err) {
      setCoopError(err instanceof Error ? err.message : String(err));
    } finally {
      setCoopBusy(false);
    }
  };

  const placeCoopOrder = async () => {
    if (!coopResult?.checkoutFlowId || !coopCheckoutPrepared) return;
    if (!coopSelectedPaymentIsOnline) {
      setCoopError("");
      setCoopStep("review");
      setCoopBrowserStatus(t("Đang mở màn hình checkout Co.op để bạn đặt hàng..."));
      openCoopBrowserAssist(coopResult, "checkout");
      return;
    }
    setCoopBusy(true);
    setCoopError("");
    try {
      const data = await postCoopOrder({
        action: "placeOrder",
        checkoutFlowId: coopResult.checkoutFlowId,
        confirmFinal: true,
      });
      setCoopResult((current) => ({ ...(current ?? {}), ...data }));
      const code = data.order?.code || data.order?.orderId || `COOP-${Date.now().toString().slice(-6)}`;
      const paymentUrl = data.paymentUrl || data.order?.paymentUrl;
      if (paymentUrl) {
        setOrderCode(code);
        setCoopStep("review");
        setCoopBrowserStatus(t("Đang mở màn hình thanh toán để bạn hoàn tất giao dịch..."));
        openCoopBrowserAssist({ ...(coopResult ?? {}), ...data, paymentUrl }, "paymentScreen");
        return;
      }
      if (coopSelectedPaymentIsOnline) {
        throw new Error(t("Co.op đã tạo đơn nhưng chưa trả link thanh toán online. Vui lòng gửi log response để kiểm tra tiếp."));
      }
      setOrderCode(code);
      setCoopStep("success");
      setPhase("done");
      onPlaced(code, activeOffer, note);
    } catch (err) {
      setCoopError(err instanceof Error ? err.message : String(err));
    } finally {
      setCoopBusy(false);
    }
  };

  const sendCoopBrowserMessage = (message: Record<string, unknown>) => {
    const ws = coopBrowserWsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  };

  const closeCoopBrowser = () => {
    const ws = coopBrowserWsRef.current;
    coopBrowserWsRef.current = null;
    setCoopBrowserVisible(false);
    setCoopBrowserFrame("");
    setCoopBrowserStatus("");
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      ws.close();
    }
  };

  const selectCoopPaymentMethod = async (paymentMethodCode: string) => {
    if (!paymentMethodCode || paymentMethodCode === coopSelectedPaymentCode) return;
    const placedOrderCode = coopResult?.order?.orderId || coopResult?.order?.code;
    const placedPaymentMethodCode = coopResult?.order?.paymentMethodCode;

    if (placedOrderCode && placedPaymentMethodCode === "COD") {
      setCoopError(t("Đơn thanh toán khi nhận hàng đã được đặt và không thể đổi phương thức thanh toán."));
      return;
    }

    if (placedOrderCode) {
      if (!coopResult?.checkoutFlowId) return;
      setCoopBusy(true);
      setCoopError("");
      try {
        const cancelled = await postCoopOrder({
          action: "cancelOrder",
          checkoutFlowId: coopResult.checkoutFlowId,
        });
        closeCoopBrowser();
        setCoopResult((current) => ({
          ...(current ?? {}),
          ...cancelled,
          phase: "cart",
          order: undefined,
          paymentUrl: undefined,
        }));
        setOrderCode("");
        coopCompletionHandledRef.current = false;
      } catch (err) {
        setCoopError(err instanceof Error ? err.message : String(err));
        return;
      } finally {
        setCoopBusy(false);
      }
    }

    setCoopSelectedPaymentCode(paymentMethodCode);
    setCoopCheckoutPrepared(false);
    setCoopStep("payment");
  };

  const openCoopBrowserAssist = async (nextResult?: CoopOrderResult, mode: "checkout" | "profileSetup" | "paymentScreen" = "checkout") => {
    const result = nextResult ?? coopResult;
    setCoopBrowserVisible(true);
    setCoopBrowserStatus(t("Đang mở màn hình thao tác Co.op…"));
    setCoopBrowserFrame("");
    try {
      coopBrowserWsRef.current?.close();
      const wsSessionId = `coop-assist-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
      const wsUrl = await getAgentWsUrl(wsSessionId, activeOffer.store.chain);
      const ws = new WebSocket(wsUrl);
      coopBrowserWsRef.current = ws;
      let opened = false;
      let receivedFrame = false;
      let commandAcknowledged = false;
      let commandAttempts = 0;
      let lastCommandAt = 0;
      const preparedDeliveryDate = result?.deliveryCheck?.selectedDate || coopDeliveryDate;
      const preparedSlotFrom = result?.deliveryCheck?.selectedSlotFrom || coopSlotFrom;
      const preparedSlotTo = result?.deliveryCheck?.selectedSlotTo || coopSlotTo;
      const buildOpenMessage = () =>
        mode === "paymentScreen"
          ? {
            type: "coop_payment_screen",
            paymentUrl: result?.paymentUrl || result?.order?.paymentUrl,
            orderCode: result?.order?.code || result?.order?.orderId || orderCode,
            paymentMethodCode: result?.order?.paymentMethodCode || coopSelectedPaymentCode,
            paymentMethodName: coopSelectedPaymentName,
          }
          : mode === "profileSetup"
            ? {
              type: "coop_profile_setup",
              phone: phoneDigits,
              name,
              email,
              address,
              addressLine: coopAddressParts.addressLine,
              provinceCode: coopAddressParts.provinceCode,
              provinceName: coopAddressParts.provinceName,
              districtCode: coopAddressParts.districtCode,
              districtName: coopAddressParts.districtName,
              wardCode: coopAddressParts.wardCode,
              wardName: coopAddressParts.wardName,
              terminalCode: coopTerminalCode,
              terminalName: selectedCoopTerminal ? getCoopTerminalName(selectedCoopTerminal) : activeOffer.store.name,
              terminalAddress: selectedCoopTerminal ? getCoopTerminalAddress(selectedCoopTerminal) : activeOffer.store.address,
              terminalId: selectedCoopTerminal?.terminalId,
              siteId: getCoopTerminalNumber(selectedCoopTerminal, "siteId"),
            }
            : result?.cartToken
              ? {
                type: "coop_show_cart",
                cartToken: result.cartToken,
                terminalCode: result.terminalCode || coopTerminalCode,
                terminalName: result.browserSession?.terminalName,
                terminalAddress: result.browserSession?.terminalAddress,
                terminalId: result.browserSession?.terminalId,
                siteId: result.browserSession?.siteId,
                deliveryDate: preparedDeliveryDate,
                slotFrom: preparedSlotFrom,
                slotTo: preparedSlotTo,
                address,
                addressLine: coopAddressParts.addressLine,
                provinceCode: coopAddressParts.provinceCode,
                provinceName: coopAddressParts.provinceName,
                districtCode: coopAddressParts.districtCode,
                districtName: coopAddressParts.districtName,
                wardCode: coopAddressParts.wardCode,
                wardName: coopAddressParts.wardName,
                name,
                email,
                phone: phoneDigits,
                checkoutUrl: result.checkoutUrl || "https://cooponline.vn/checkout",
                browserSession: result.browserSession,
              }
              : { type: "navigate", url: result?.checkoutUrl || result?.cartUrl || "https://cooponline.vn" };
      const sendOpenCommand = () => {
        if (ws.readyState !== WebSocket.OPEN) return;
        const message = buildOpenMessage();
        if (mode === "paymentScreen" && !message.paymentUrl) {
          setCoopBrowserStatus(t("Co.op đã tạo đơn nhưng chưa trả link thanh toán để mở QR."));
          setCoopError(t("Co.op đã tạo đơn nhưng chưa trả link thanh toán online. Vui lòng thử bấm Thanh toán ngay trong trang Co.op."));
          window.clearInterval(commandRetry);
          return;
        }
        commandAttempts += 1;
        lastCommandAt = Date.now();
        ws.send(JSON.stringify(message));
      };
      const connectionTimeout = window.setTimeout(() => {
        if (ws.readyState !== WebSocket.OPEN) {
          setCoopBrowserStatus(t("Chưa thấy agent-server. Chạy `npm run agent-server` rồi bấm mở lại."));
          ws.close();
        }
      }, 2500);
      const commandRetry = window.setInterval(() => {
        if (!opened || commandAcknowledged || ws.readyState !== WebSocket.OPEN) return;
        if (commandAttempts >= 12) {
          setCoopBrowserStatus(t("Đã kết nối agent-server nhưng Co.op chưa nhận lệnh mở màn hình. Vui lòng bấm Đóng màn hình rồi mở lại."));
          window.clearInterval(commandRetry);
          return;
        }
        if (commandAttempts === 0 || Date.now() - lastCommandAt > 1500) {
          sendOpenCommand();
        }
      }, 1000);
      const frameTimeout = window.setTimeout(() => {
        if (opened && !receivedFrame) {
          setCoopBrowserStatus(t("Đã kết nối agent-server nhưng chưa nhận được ảnh. Đang thử nạp lại màn hình Co.op…"));
          sendOpenCommand();
        }
      }, 7000);
      ws.onopen = () => {
        opened = true;
        window.clearTimeout(connectionTimeout);
        setCoopBrowserStatus(t("Đã kết nối agent-server, đang chờ trình duyệt sẵn sàng…"));
        window.setTimeout(sendOpenCommand, 250);
      };
      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(String(event.data)) as {
            type?: string;
            data?: string;
            message?: string;
            status?: string;
            phase?: string;
            error?: string;
            width?: number;
            height?: number;
            orderCode?: string;
            orderUrl?: string;
            totalText?: string;
          };
          if (message.type === "screencast" && message.data) {
            receivedFrame = true;
            window.clearTimeout(frameTimeout);
            setCoopBrowserFrame(`data:image/jpeg;base64,${message.data}`);
            if (message.width && message.height) setCoopBrowserSize({ width: message.width, height: message.height });
          }
          if (message.type === "log" && message.message) {
            setCoopBrowserStatus(message.message);
            if (/khởi tạo trình duyệt|khoi tao trinh duyet|browser/i.test(message.message)) {
              window.setTimeout(sendOpenCommand, 100);
            }
            if (/Co\.opmart|Co\.op/i.test(message.message)) {
              commandAcknowledged = true;
              window.clearInterval(commandRetry);
            }
          }
          if (message.type === "status" && message.phase === "failed") {
            commandAcknowledged = true;
            window.clearInterval(commandRetry);
            const reason = message.error ? String(message.error) : t("Không mở được màn hình thanh toán Co.op.");
            setCoopBrowserStatus(reason === "missing_payment_url" ? t("Co.op đã tạo đơn nhưng chưa trả link thanh toán để mở QR.") : reason);
            setCoopError(reason === "missing_payment_url" ? t("Co.op đã tạo đơn nhưng chưa trả link thanh toán online. Vui lòng thử bấm Thanh toán ngay trong trang Co.op.") : reason);
          }
          if (message.type === "status" && message.phase?.startsWith("coop_assist_")) {
            commandAcknowledged = true;
            window.clearInterval(commandRetry);
            if (message.phase === "coop_assist_ready") {
              setCoopBrowserStatus(t("Màn hình Co.op đã sẵn sàng, bạn có thể click/gõ trực tiếp tại đây."));
            }
            if (message.phase === "coop_assist_manual") {
              setCoopBrowserStatus(t("Co.op cần bạn thao tác tiếp trên màn hình đang mở."));
            }
          }
          if (message.type === "status" && message.phase === "coop_payment_ready") {
            commandAcknowledged = true;
            window.clearInterval(commandRetry);
            setCoopBrowserStatus(t("Màn hình thanh toán đã sẵn sàng. Affree sẽ tự ghi nhận khi giao dịch thành công."));
          }
          if (message.type === "status" && message.phase === "coop_payment_failed") {
            commandAcknowledged = true;
            window.clearInterval(commandRetry);
            setCoopBrowserStatus(t("Giao dịch chưa thành công hoặc đã hủy. Bạn có thể thử lại trên màn hình, hoặc đóng để chọn phương thức khác."));
            setCoopError(t("Thanh toán Co.op chưa hoàn tất. Vui lòng thử lại hoặc chọn phương thức thanh toán khác."));
          }
          if (message.type === "status" && message.phase === "completed" && !coopCompletionHandledRef.current) {
            coopCompletionHandledRef.current = true;
            const code = message.orderCode || orderCode || `COOP-${Date.now().toString().slice(-6)}`;
            setOrderCode(code);
            setCoopBrowserVisible(false);
            setCoopBrowserFrame("");
            setCoopBrowserStatus("");
            setCoopStep("success");
            setPhase("done");
            setCoopResult((current) => ({
              ...(current ?? {}),
              phase: "ordered",
              order: {
                ...(current?.order ?? {}),
                code,
                orderId: code,
                paymentUrl: message.orderUrl,
              },
            }));
            onPlaced(code, activeOffer, note);
            ws.close();
          }
        } catch {
          // Ignore malformed frames from local agent server.
        }
      };
      ws.onerror = () => setCoopBrowserStatus(t("Chưa kết nối được agent-server. Chạy `npm run agent-server` rồi thử lại."));
      ws.onclose = () => {
        window.clearTimeout(connectionTimeout);
        window.clearTimeout(frameTimeout);
        window.clearInterval(commandRetry);
        if (!opened) setCoopBrowserStatus(t("Agent-server chưa chạy hoặc cổng 8080 chưa mở."));
        if (coopBrowserWsRef.current === ws) coopBrowserWsRef.current = null;
      };
    } catch {
      setCoopBrowserStatus(t("Không mở được màn hình Co.op."));
    }
  };

  const getCoopBrowserPoint = (event: { currentTarget: HTMLElement; clientX: number; clientY: number }) => {
    const image = coopStreamImageRef.current;
    const rect = (image ?? event.currentTarget).getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const frameAspect = coopBrowserSize.width / coopBrowserSize.height;
    const boxAspect = rect.width / rect.height;
    const contentWidth = boxAspect > frameAspect ? rect.height * frameAspect : rect.width;
    const contentHeight = boxAspect > frameAspect ? rect.height : rect.width / frameAspect;
    const contentLeft = rect.left + (rect.width - contentWidth) / 2;
    const contentTop = rect.top + (rect.height - contentHeight) / 2;
    const relativeX = Math.min(Math.max((event.clientX - contentLeft) / contentWidth, 0), 1);
    const relativeY = Math.min(Math.max((event.clientY - contentTop) / contentHeight, 0), 1);
    const x = Math.round(relativeX * coopBrowserSize.width);
    const y = Math.round(relativeY * coopBrowserSize.height);
    return { x, y };
  };

  const clickCoopBrowser = (event: React.MouseEvent<HTMLImageElement>) => {
    const point = getCoopBrowserPoint(event);
    if (!point) return;
    sendCoopBrowserMessage({ type: "click", ...point });
  };

  const focusCoopBrowser = (event: React.MouseEvent<HTMLDivElement>) => {
    event.currentTarget.focus();
  };

  useEffect(() => {
    if (!coopBrowserVisible) return;
    const target = coopStreamWheelRef.current;
    if (!target) return;

    const onWheel = (event: WheelEvent) => {
      const point = getCoopBrowserPoint({ currentTarget: target, clientX: event.clientX, clientY: event.clientY });
      if (!point) return;
      event.preventDefault();
      event.stopPropagation();
      sendCoopBrowserMessage({
        type: "wheel",
        ...point,
        deltaX: Math.round(event.deltaX),
        deltaY: Math.round(event.deltaY),
      });
    };

    target.addEventListener("wheel", onWheel, { passive: false });
    return () => target.removeEventListener("wheel", onWheel);
  }, [coopBrowserVisible, coopBrowserSize.width, coopBrowserSize.height]);

  const keyCoopBrowser = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!coopBrowserVisible) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key.length === 1) {
      sendCoopBrowserMessage({ type: "type", text: event.key });
      event.preventDefault();
      return;
    }
    const supported = new Set(["Enter", "Backspace", "Delete", "Tab", "Escape", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);
    if (supported.has(event.key)) {
      sendCoopBrowserMessage({ type: "keypress", key: event.key });
      event.preventDefault();
    }
  };

  const checkCoopAddress = async () => {
    if (!address.trim()) return;
    lastCoopLookupAddressRef.current = address.trim();
    setCoopAddressBusy(true);
    setCoopAddressChecked(false);
    setCoopError("");
    try {
      const loc =
        (await safeGeocode(address)) ??
        (Number.isFinite(geoLat) && Number.isFinite(geoLng) && (geoLat !== 0 || geoLng !== 0)
          ? { lat: geoLat as number, lng: geoLng as number }
          : null);
      setCoopGeo(loc ? { lat: loc.lat, lng: loc.lng } : null);
      const params = new URLSearchParams({
        address: address.trim(),
      });
      if (loc) {
        params.set("lat", String(loc.lat));
        params.set("lng", String(loc.lng));
      }
      const res = await fetch(`/api/coop/terminals?${params.toString()}`, { cache: "no-store" });
      const data = (await res.json().catch(() => ({}))) as {
        selectedTerminalCode?: string;
        terminals?: CoopTerminalChoice[];
        error?: string;
      };
      if (!res.ok || data.error) throw new Error(data.error || t("Co.op chưa trả danh sách kho gần địa chỉ này."));
      const terminals = (data.terminals || []).filter((item) => getCoopTerminalCode(item));
      if (!terminals.length) throw new Error(t("Không tìm thấy kho Co.op phù hợp với địa chỉ này."));
      const selectedCode = data.selectedTerminalCode || getCoopTerminalCode(terminals[0]);
      setCoopTerminals(terminals);
      setCoopSelectedTerminalCode(selectedCode);
      setCoopAddressChecked(true);
      const matchingOffer = alternatives.find(
        (item) => item.store.chain === "coop" && item.store.id.replace(/^coop-/, "") === selectedCode,
      );
      if (matchingOffer) setActiveOffer(matchingOffer);
    } catch (err) {
      setCoopTerminals([]);
      setCoopSelectedTerminalCode("");
      setCoopError(err instanceof Error ? err.message : String(err));
    } finally {
      setCoopAddressBusy(false);
    }
  };

  useEffect(() => {
    if (!isCoopReal) return;
    let alive = true;
    setCoopLocationsBusy(true);
    fetchCoopLocations("provinces")
      .then((items) => {
        if (!alive) return;
        setCoopProvinces(items);
        const selected = coopProvinceCode ? items.find((item) => item.code === coopProvinceCode) : findCoopLocationByName(items, coopProvinceName || HCM_PROVINCE.name);
        if (selected) {
          setCoopProvinceCode(selected.code);
          setCoopProvinceName(selected.name);
        }
      })
      .catch((err) => setCoopError(err instanceof Error ? err.message : String(err)))
      .finally(() => {
        if (alive) setCoopLocationsBusy(false);
      });
    return () => {
      alive = false;
    };
  }, [isCoopReal]);

  useEffect(() => {
    if (!isCoopReal || !coopProvinceCode) return;
    let alive = true;
    setCoopLocationsBusy(true);
    fetchCoopLocations("districts", { provinceCode: coopProvinceCode })
      .then((items) => {
        if (!alive) return;
        setCoopDistricts(items);
        const selected = coopDistrictCode ? items.find((item) => item.code === coopDistrictCode) : findCoopLocationByName(items, coopDistrictName);
        if (selected) {
          setCoopDistrictCode(selected.code);
          setCoopDistrictName(selected.name);
        }
      })
      .catch((err) => setCoopError(err instanceof Error ? err.message : String(err)))
      .finally(() => {
        if (alive) setCoopLocationsBusy(false);
      });
    return () => {
      alive = false;
    };
  }, [isCoopReal, coopProvinceCode]);

  useEffect(() => {
    if (!isCoopReal || !coopDistrictCode) return;
    let alive = true;
    setCoopLocationsBusy(true);
    fetchCoopLocations("wards", { districtCode: coopDistrictCode })
      .then((items) => {
        if (!alive) return;
        setCoopWards(items);
        const selected = coopWardCode ? items.find((item) => item.code === coopWardCode) : findCoopLocationByName(items, coopWardName);
        if (selected) {
          setCoopWardCode(selected.code);
          setCoopWardName(selected.name);
        }
      })
      .catch((err) => setCoopError(err instanceof Error ? err.message : String(err)))
      .finally(() => {
        if (alive) setCoopLocationsBusy(false);
      });
    return () => {
      alive = false;
    };
  }, [isCoopReal, coopDistrictCode]);

  useEffect(() => {
    if (!isCoopReal) return;
    const nextAddress = composeCoopFullAddress(coopAddressParts);
    if (nextAddress && nextAddress !== address) setAddress(nextAddress);
  }, [
    isCoopReal,
    coopAddressParts.addressLine,
    coopAddressParts.provinceCode,
    coopAddressParts.provinceName,
    coopAddressParts.districtCode,
    coopAddressParts.districtName,
    coopAddressParts.wardCode,
    coopAddressParts.wardName,
    address,
  ]);

  useEffect(() => {
    const lookupAddress = address.trim();
    if (!isCoopReal || phase !== "form" || !lookupAddress || coopAddressBusy || coopAddressChecked) return;
    if (lastCoopLookupAddressRef.current === lookupAddress) return;
    const timer = window.setTimeout(() => {
      void checkCoopAddress();
    }, 350);
    return () => window.clearTimeout(timer);
  }, [address, isCoopReal, phase, coopAddressBusy, coopAddressChecked]);

  useEffect(() => {
    return () => {
      coopBrowserWsRef.current?.close();
    };
  }, []);

  // So địa chỉ giao với địa chỉ định vị (nếu có) để biết có lệch không.
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
  const addressReady = address.trim().length >= 6;
  const addressChanged =
    !!geoAddr && addressReady && norm(address) !== norm(geoAddr);
  // Cần định vị lại theo địa chỉ giao khi địa chỉ đủ rõ VÀ (chưa định vị GPS
  // HOẶC địa chỉ giao khác vị trí định vị). Nhờ vậy dù chưa bấm định vị, gõ
  // địa chỉ giao xong là vẫn tính lại khoảng cách theo nơi giao.
  const shouldGeocode = addressReady && (!geoAddr || addressChanged);

  // Geocode địa chỉ giao (debounce) để tính lại khoảng cách CHÍNH XÁC theo nơi giao.
  const [deliveryLoc, setDeliveryLoc] = useState<{ lat: number; lng: number } | null>(null);
  const [geocoding, setGeocoding] = useState(false);
  useEffect(() => {
    if (!shouldGeocode) {
      setDeliveryLoc(null);
      return;
    }
    let alive = true;
    setGeocoding(true);
    const t = setTimeout(async () => {
      const loc = await safeGeocode(address);
      if (!alive) return;
      setDeliveryLoc(loc);
      setGeocoding(false);
    }, 900);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [address, shouldGeocode]);

  // Lọc nơi mua theo "gần" hoặc "rẻ".
  const [repickSort, setRepickSort] = useState<"near" | "cheap">("near");

  // Nơi bán cùng món TRONG CÙNG CHUỖI đang mua (Coop → chỉ Co.opmart) — nếu
  // đã geocode được địa chỉ giao thì tính lại km theo đó.
  const choiceList = useMemo(() => {
    const list = alternatives.filter(
      (o) =>
        o.store.chain === activeOffer.store.chain &&
        (o.inStock || o.store.id === activeOffer.store.id)
    );
    if (!deliveryLoc) return list;
    return list.map((o) => {
      const s = o.store;
      const km =
        s.lat != null && s.lng != null
          ? distanceKm(deliveryLoc, { lat: s.lat, lng: s.lng })
          : null;
      return { ...o, distanceKm: km } as RankedOffer;
    });
  }, [alternatives, activeOffer.store.id, activeOffer.store.chain, deliveryLoc]);

  // Gắn tag: nơi RẺ NHẤT và nơi GẦN NHẤT.
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
      repickSort === "cheap"
        ? a.price - b.price
        : (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity)
    );
    return arr;
  }, [choiceList, repickSort]);

  const showRepick = shouldGeocode && storeChoices.length > 1;

  useEffect(() => {
    if (coopDeliveryDate && coopDeliveryDate < todayInput) {
      setCoopDeliveryDate("");
      setCoopCheckoutPrepared(false);
    }
  }, [coopDeliveryDate, todayInput]);

  useEffect(() => {
    if (!coopDeliveryDate || !effectiveCoopDeliverySlots.length) return;
    // Đã có slot đang chọn (do user chọn hoặc prepareCheckout set) → giữ nguyên,
    // KHÔNG tự xoá và KHÔNG reset coopCheckoutPrepared (tránh disable nút đặt hàng).
    if (coopSlotFrom && coopSlotTo) return;
    const nextSlot = effectiveCoopDeliverySlots.find((item) => !item.disabled);
    if (nextSlot) {
      setCoopSlotFrom(nextSlot.from);
      setCoopSlotTo(nextSlot.to);
    }
  }, [coopDeliveryDate, effectiveCoopDeliverySlots, coopSlotFrom, coopSlotTo]);

  if (isCoopReal) {
    const coopWizard = [
      { id: "account" as CoopStepId, label: "Nhập tài khoản và địa chỉ" },
      { id: "otp" as CoopStepId, label: "Nhập OTP nếu Co.op gửi" },
      { id: "delivery" as CoopStepId, label: "Chọn ngày và khung giờ" },
      { id: "payment" as CoopStepId, label: "Chọn phương thức thanh toán" },
      { id: "review" as CoopStepId, label: "Xác nhận đặt hàng" },
    ];
    const visibleStep = phase === "done" ? "success" : coopStep;
    const currentCoopRank = coopStepRank(visibleStep);
    const hasCoopBrowser = coopBrowserVisible;
    const coopBrowserPanel = (
      <div
        className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-slate-950 shadow-sm"
        tabIndex={0}
        onKeyDown={keyCoopBrowser}
        onMouseDown={focusCoopBrowser}
      >
        <div className="flex items-center justify-between gap-3 px-3 py-2 text-xs text-white">
          <span className="truncate">{coopBrowserStatus || t("Màn hình Co.op")}</span>
          <button type="button" onClick={closeCoopBrowser} className="shrink-0 rounded bg-white/10 px-2 py-1 font-semibold hover:bg-white/20">
            {t("Đóng màn hình")}
          </button>
        </div>
        <div
          ref={coopStreamWheelRef}
          className="coop-stream-wheel-capture flex min-h-0 flex-1 items-center justify-center bg-white"
        >
          {coopBrowserFrame ? (
            <img
              ref={coopStreamImageRef}
              src={coopBrowserFrame}
              alt="Co.op checkout thao tác"
              className="h-full max-h-full w-full cursor-crosshair object-contain"
              onClick={clickCoopBrowser}
            />
          ) : (
            <div className="flex h-full min-h-[320px] items-center justify-center text-sm text-slate-500">
              <Spinner />
              <span className="ml-2">{t("Đang chờ ảnh từ agent-server…")}</span>
            </div>
          )}
        </div>
        <div className="border-t border-white/10 px-3 py-2 text-[11px] leading-4 text-white/60">
          {t("Click trực tiếp vào màn hình để chọn. Khi cần nhập chữ/số, bấm vào khung này rồi gõ bàn phím.")}
        </div>
      </div>
    );

    return (
      <div
        className="fixed inset-0 z-[1100] flex items-end justify-center bg-slate-900/50 p-0 sm:items-center sm:p-4"
        role="dialog"
        aria-modal="true"
        onClick={handleCloseModal}
      >
        <div
          className="flex min-h-0 w-full flex-col rounded-t-2xl bg-white sm:rounded-2xl"
          style={{
            width: hasCoopBrowser ? "min(98vw, 1500px)" : "min(96vw, 620px)",
            maxWidth: hasCoopBrowser ? 1500 : 620,
            height: hasCoopBrowser ? "min(90dvh, 860px)" : "min(78dvh, 760px)",
            maxHeight: "calc(100dvh - 24px)",
            display: "flex",
            flexDirection: "column",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between border-b border-emerald-100 px-3 py-2.5">
            <div className="min-w-0">
              <h2 className="truncate text-base font-bold text-emerald-700">
                {phase === "done" ? "Đã đặt hàng Co.op" : "Đặt hàng Co.op"}
              </h2>
              <p className="truncate text-xs text-slate-500">
                {activeOffer.product.name} · {chain}
              </p>
            </div>
            <button onClick={handleCloseModal} className="rounded-full p-1.5 text-slate-400 hover:bg-slate-100" aria-label={t("Đóng")}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className={`coop-modal-body min-h-0 flex-1 overflow-hidden ${hasCoopBrowser ? "coop-modal-body--split" : "coop-modal-body--single"}`}>
            <div className={`coop-popup-scroll min-h-0 overscroll-contain ${hasCoopBrowser ? "coop-left-pane rounded-xl border border-slate-200 bg-white px-3 py-3" : "flex flex-col px-3 py-3"}`}>
              <div className="space-y-3">
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                  <div className="flex items-center gap-2.5">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-emerald-100 text-sm font-bold text-emerald-700">
                      {qty}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-slate-900">{activeOffer.product.name}</p>
                      <p className="mt-0.5 truncate text-xs text-slate-500">
                        {activeOffer.store.name} · {formatMoney(activeOffer.price, storeCurrency(activeOffer.store.id))}
                      </p>
                    </div>
                  </div>
                </div>

                <ol className="grid grid-cols-1 gap-1 rounded-lg bg-slate-50 p-1.5 sm:grid-cols-2">
                  {coopWizard.map((item) => {
                    const done = currentCoopRank > coopStepRank(item.id);
                    const active = visibleStep === item.id;
                    return (
                      <li key={item.id} className={`flex items-center gap-2 rounded-md px-2 py-1 ${active ? "bg-white shadow-sm" : ""}`}>
                        <span className="shrink-0">
                          {done ? <CheckIcon /> : active ? <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-100 text-xs font-bold text-blue-700">{coopStepRank(item.id) + 1}</span> : <PauseDot />}
                        </span>
                        <span className={`truncate text-xs font-semibold ${active ? "text-slate-900" : done ? "text-slate-500" : "text-slate-300"}`}>
                          {t(item.label)}
                        </span>
                      </li>
                    );
                  })}
                </ol>

                {phase === "form" && (
                  <div className="space-y-2.5 rounded-lg border border-slate-200 bg-white p-2.5">
                    <p className="text-sm font-bold text-slate-900">Thông tin Co.op</p>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <Field label={t("Người nhận")}>
                        <input
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                          placeholder={t("Họ và tên")}
                          className="input"
                        />
                      </Field>
                      <Field label={t("Số điện thoại")}>
                        <input
                          value={phone}
                          onChange={(e) => setPhone(e.target.value)}
                          inputMode="tel"
                          placeholder={t("VD: 0901234567")}
                          aria-invalid={phoneError}
                          className="input"
                          style={phoneError ? { borderColor: "#ef4444" } : undefined}
                        />
                        {phoneError && <span className="mt-1 block text-xs text-rose-600">{t("Số điện thoại không hợp lệ.")}</span>}
                      </Field>
                    </div>

                    <div className="grid gap-2 sm:grid-cols-2">
                      <Field label={t("Tỉnh/Thành phố")}>
                        <select
                          value={coopProvinceCode}
                          onChange={(e) => {
                            const selected = coopProvinces.find((item) => item.code === e.target.value);
                            updateCoopAddress({
                              provinceCode: selected?.code || "",
                              provinceName: selected?.name || "",
                              districtCode: "",
                              districtName: "",
                              wardCode: "",
                              wardName: "",
                            });
                            setCoopDistricts([]);
                            setCoopWards([]);
                          }}
                          className="input"
                        >
                          <option value="">{coopLocationsBusy ? t("Đang tải…") : t("Chọn tỉnh/thành phố")}</option>
                          {coopProvinces.map((item) => (
                            <option key={item.code} value={item.code}>{item.name}</option>
                          ))}
                        </select>
                      </Field>
                      <Field label={t("Quận/Huyện")}>
                        <select
                          value={coopDistrictCode}
                          onChange={(e) => {
                            const selected = coopDistricts.find((item) => item.code === e.target.value);
                            updateCoopAddress({
                              districtCode: selected?.code || "",
                              districtName: selected?.name || "",
                              wardCode: "",
                              wardName: "",
                            });
                            setCoopWards([]);
                          }}
                          disabled={!coopProvinceCode}
                          className="input"
                        >
                          <option value="">{coopProvinceCode ? t("Chọn quận/huyện") : t("Chọn tỉnh trước")}</option>
                          {coopDistricts.map((item) => (
                            <option key={item.code} value={item.code}>{item.name}</option>
                          ))}
                        </select>
                      </Field>
                      <Field label={t("Phường/Xã")}>
                        <select
                          value={coopWardCode}
                          onChange={(e) => {
                            const selected = coopWards.find((item) => item.code === e.target.value);
                            updateCoopAddress({
                              wardCode: selected?.code || "",
                              wardName: selected?.name || "",
                            });
                          }}
                          disabled={!coopDistrictCode}
                          className="input"
                        >
                          <option value="">{coopDistrictCode ? t("Chọn phường/xã") : t("Chọn quận trước")}</option>
                          {coopWards.map((item) => (
                            <option key={item.code} value={item.code}>{item.name}</option>
                          ))}
                        </select>
                      </Field>
                      <Field label={t("Số nhà, tên đường")}>
                        <input
                          value={coopAddressLine}
                          onChange={(e) => updateCoopAddress({ addressLine: e.target.value })}
                          placeholder={t("VD: 17 Đống Đa")}
                          className="input"
                        />
                      </Field>
                    </div>

                    <button
                      type="button"
                      disabled={!address.trim() || coopAddressBusy}
                      onClick={() => void checkCoopAddress()}
                      className="w-full rounded-lg border border-emerald-200 bg-emerald-50 py-2 text-sm font-semibold text-emerald-700 transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {coopAddressBusy ? t("Đang tìm cửa hàng gần nhất…") : coopAddressChecked ? t("Cập nhật lại cửa hàng gần nhất") : t("Đang tự tìm cửa hàng gần nhất")}
                    </button>

                    {coopTerminals.length > 0 && (
                      <div className="rounded-lg border border-emerald-100 bg-emerald-50 p-2">
                        <div className="mb-1.5 flex items-center justify-between gap-2">
                          <p className="text-xs font-bold text-emerald-800">Cửa hàng Co.op gần địa chỉ giao</p>
                          <span className="text-[11px] font-medium text-emerald-700">{coopTerminals.length} cửa hàng</span>
                        </div>
                        <div className="coop-store-scroll space-y-1.5 overflow-y-auto overscroll-contain pr-1" style={{ maxHeight: 260 }}>
                          {coopTerminals.map((terminal) => {
                            const code = getCoopTerminalCode(terminal);
                            const active = code === coopTerminalCode;
                            return (
                              <button
                                key={code}
                                type="button"
                                onClick={() => {
                                  setCoopSelectedTerminalCode(code);
                                  setCoopAddressChecked(true);
                                  const matchingOffer = alternatives.find(
                                    (item) => item.store.chain === "coop" && item.store.id.replace(/^coop-/, "") === code,
                                  );
                                  if (matchingOffer) setActiveOffer(matchingOffer);
                                }}
                                className={`w-full rounded-lg border px-3 py-2 text-left transition ${active ? "border-emerald-500 bg-white ring-1 ring-emerald-500" : "border-emerald-100 bg-white/70 hover:bg-white"
                                  }`}
                              >
                                <div className="flex items-start justify-between gap-3">
                                  <span className="min-w-0">
                                    <span className="block truncate text-xs font-semibold text-slate-900">{getCoopTerminalName(terminal)}</span>
                                    <span className="mt-0.5 block line-clamp-2 text-[11px] leading-4 text-slate-500">{getCoopTerminalAddress(terminal)}</span>
                                  </span>
                                  <span className="shrink-0 text-[11px] font-bold text-emerald-700">{getCoopTerminalDistance(terminal)}</span>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    <Field label={t("Số lượng")}>
                      <div className="flex items-center gap-2">
                        <button onClick={() => { setAutoQty(0); setQty((q) => Math.max(1, q - 1)); }} className="h-9 w-9 rounded-lg border border-slate-300 text-lg font-medium hover:bg-slate-100">−</button>
                        <span className="w-8 text-center text-sm font-semibold">{qty}</span>
                        <button onClick={() => { setAutoQty(0); setQty((q) => q + 1); }} className="h-9 w-9 rounded-lg border border-slate-300 text-lg font-medium hover:bg-slate-100">+</button>
                      </div>
                    </Field>

                    <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm">
                      <Row k={t("Kho Co.op")} v={coopAddressChecked ? coopTerminalCode : t("Chưa chọn")} />
                      <Row k={t("Phương thức thanh toán")} v={t("Chọn ở bước checkout")} />
                      <Row k={t("Tạm tính")} v={formatMoney(total, storeCurrency(activeOffer.store.id))} strong />
                    </div>

                    {coopBelowMinimum && (
                      <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                        {t("Co.op chỉ cho thanh toán khi đơn từ 200.000đ. Tăng số lượng hoặc chọn sản phẩm khác để tiếp tục.")}
                      </div>
                    )}
                    {coopError && <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{coopError}</div>}
                    <button
                      disabled={!coopCanStart || coopBusy}
                      onClick={() => {
                        flushProfile({ name, phone, address });
                        void startCoopOrder();
                      }}
                      className="w-full rounded-xl bg-emerald-600 py-3 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {coopBusy ? t("Đang kết nối Co.op…") : t("Kết nối Co.op và thêm vào giỏ")}
                    </button>
                    {!coopCanStart && (
                      <p className="text-center text-xs text-slate-400">
                        {t("Nhập đủ tên, số điện thoại, xem cửa hàng gần nhất và đảm bảo đơn từ 200.000đ.")}
                      </p>
                    )}
                  </div>
                )}

                {phase === "running" && coopStep === "otp" && (
                  <PauseBox tone="blue" hint={t("Mã này đến từ Co.op. Affree không đọc SMS giúp bạn.")}>
                    <p className="text-sm font-semibold text-slate-900">{t("Nhập OTP Co.op gửi về {phone}", { phone: phoneDigits })}</p>
                    <div className="mt-3 flex gap-2">
                      <input
                        value={otp}
                        onChange={(e) => {
                          setOtp(e.target.value.replace(/\D/g, "").slice(0, 6));
                          setCoopError("");
                        }}
                        inputMode="numeric"
                        placeholder={t("6 SỐ OTP")}
                        className="input flex-1 text-center text-lg font-semibold tracking-[0.35em]"
                        autoComplete="one-time-code"
                        autoFocus
                      />
                      <button disabled={otp.length !== 6 || coopBusy} onClick={() => void confirmCoopOtp()} className="shrink-0 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-50">
                        {coopBusy ? t("Đang gửi…") : t("Xác thực")}
                      </button>
                    </div>
                    <button type="button" disabled={coopBusy} onClick={() => void resendCoopOtp()} className="mt-2 text-xs font-semibold text-blue-700 hover:text-blue-800 disabled:opacity-50">
                      {t("Gửi lại OTP")}
                    </button>
                    {coopError && <p className="mt-2 text-xs font-medium text-rose-600">{coopError}</p>}
                  </PauseBox>
                )}

                {phase === "running" && (coopStep === "delivery" || coopStep === "payment" || coopStep === "review") && (
                  <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-3">
                    <p className="text-sm font-bold text-slate-900">{t("Checkout Co.op")}</p>
                    <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
                      <Row k={t("Người nhận")} v={`${name} · ${phoneDigits}`} />
                      <Row k={t("Địa chỉ Co.op")} v={coopSavedAddress || address} />
                      <Row k={t("Kho Co.op")} v={coopResult?.terminalCode || coopTerminalCode} />
                    </div>

                    <Field label={t("Chọn ngày nhận hàng")}>
                      <div className="relative max-w-[280px]">
                        <select
                          value={coopDeliveryDate}
                          onChange={(e) => {
                            setCoopDeliveryDate(e.target.value);
                            setCoopCheckoutPrepared(false);
                            setCoopStep("delivery");
                          }}
                          className="coop-date-select input h-11 appearance-none text-slate-700"
                          style={{ paddingLeft: "44px", paddingRight: "40px", WebkitAppearance: "none", appearance: "none" }}
                        >
                          <option value="">{t("dd/mm/yyyy")}</option>
                          {coopDeliveryDates.map((date) => (
                            <option key={date} value={date}>{formatCoopDate(date)}</option>
                          ))}
                        </select>
                        <svg className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M8 2v4M16 2v4M3 10h18" />
                          <rect x="3" y="4" width="18" height="18" rx="2" />
                        </svg>
                        <svg className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-500" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                          <path d="m7 10 5 5 5-5H7Z" />
                        </svg>
                      </div>
                    </Field>

                    <div>
                      <p className="mb-2 text-xs font-medium text-slate-500">{t("Chọn khung giờ")}</p>
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                        {effectiveCoopDeliverySlots.map((timeSlot) => {
                          const selected = coopSlotFrom === timeSlot.from && coopSlotTo === timeSlot.to;
                          return (
                            <button
                              key={`${timeSlot.from}-${timeSlot.to}`}
                              type="button"
                              disabled={timeSlot.disabled}
                              onClick={() => {
                                setCoopSlotFrom(timeSlot.from);
                                setCoopSlotTo(timeSlot.to);
                                setCoopCheckoutPrepared(false);
                                setCoopStep("delivery");
                              }}
                              className={`h-11 rounded-lg border px-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400 ${selected ? "border-emerald-500 bg-emerald-50 text-emerald-700 ring-1 ring-emerald-500" : "border-slate-300 bg-white text-slate-700 hover:border-slate-400"
                                }`}
                            >
                              {timeSlot.from} - {timeSlot.to}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {coopDeliveryReady && (
                      <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
                        <Row k={t("Ngày nhận")} v={formatCoopDate(coopDeliveryDate)} />
                        <Row k={t("Khung giờ")} v={`${coopSlotFrom} - ${coopSlotTo}`} />
                      </div>
                    )}

                    {coopPaymentMethods.length > 0 && (
                      <div>
                        <p className="mb-2 text-xs font-medium text-slate-500">{t("Phương thức thanh toán")}</p>
                        <div className="grid gap-2">
                          {coopPaymentMethods.map((method) => {
                            const selected = method.methodCode === coopSelectedPaymentCode;
                            const disabled = Boolean(method.isDisabled);
                            return (
                              <button
                                key={method.methodCode}
                                type="button"
                                disabled={disabled || coopBusy}
                                onClick={() => void selectCoopPaymentMethod(method.methodCode || "COD")}
                                className={`flex min-h-[58px] items-center gap-3 rounded-lg border px-3 py-2 text-left transition disabled:cursor-not-allowed disabled:opacity-45 ${selected
                                  ? "border-emerald-500 bg-emerald-50 ring-1 ring-emerald-500"
                                  : "border-slate-200 bg-white hover:border-slate-300"
                                  }`}
                              >
                                {method.icon ? (
                                  <img src={method.icon} alt="" className="h-7 w-7 shrink-0 rounded object-contain" />
                                ) : (
                                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[11px] font-bold text-slate-600">
                                    {method.methodCode === "COD" ? "COD" : "PAY"}
                                  </span>
                                )}
                                <span className="min-w-0 flex-1">
                                  <span className="block text-sm font-semibold text-slate-800">{method.name || method.methodCode}</span>
                                  {method.description && (
                                    <span className="mt-0.5 block text-xs text-slate-500">{method.description}</span>
                                  )}
                                  {method.maxTransactionAmount ? (
                                    <span className="mt-0.5 block text-[11px] text-slate-400">
                                      {t("Tối đa")} {formatMoney(method.maxTransactionAmount, storeCurrency(activeOffer.store.id))}
                                    </span>
                                  ) : null}
                                </span>
                                <span
                                  className={`h-4 w-4 shrink-0 rounded-full border ${selected ? "border-emerald-500 bg-emerald-500 shadow-[inset_0_0_0_3px_white]" : "border-slate-300"
                                    }`}
                                />
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {coopCheckoutPrepared && (
                      <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700">
                        {t("Đã cập nhật lịch giao và phương thức thanh toán. Chưa gửi đơn thật sang Co.op.")}
                      </div>
                    )}
                    {coopError && <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-600">{coopError}</p>}

                    <button
                      type="button"
                      disabled={!coopDeliveryReady || coopBusy || !coopResult?.checkoutFlowId}
                      onClick={prepareCoopCheckout}
                      className="w-full rounded-xl bg-emerald-600 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {coopBusy ? t("Đang cập nhật Co.op…") : t("Cập nhật lịch giao & phương thức thanh toán")}
                    </button>

                  </div>
                )}

                {phase === "running" && coopStep === "review" && (
                  <PauseBox
                    tone="emerald"
                    hint={
                      coopSelectedPaymentIsOnline
                        ? t("Bấm nút dưới đây mới tạo đơn và mở màn hình thanh toán online.")
                        : t("Bấm nút dưới đây để mở checkout Co.op; bạn sẽ đặt hàng trực tiếp trên màn hình bên phải.")
                    }
                  >
                    <div className="space-y-1.5 rounded-lg bg-white p-2.5 text-sm">
                      <Row k={t("Món")} v={`${activeOffer.product.name} ×${qty}`} />
                      <Row k={t("Giao tới")} v={coopSavedAddress || address} />
                      <Row k={t("Ngày nhận")} v={formatCoopDate(coopDeliveryDate)} />
                      <Row k={t("Khung giờ")} v={`${coopSlotFrom} - ${coopSlotTo}`} />
                      <Row k={t("Phương thức thanh toán")} v={coopSelectedPaymentName || t("Đã chọn trên Co.op")} />
                      <Row k={t("Tổng")} v={formatMoney(coopResult?.lineTotal || total, storeCurrency(activeOffer.store.id))} strong />
                    </div>
                    <button
                      type="button"
                      disabled={coopBusy || !coopCheckoutPrepared}
                      onClick={() => void placeCoopOrder()}
                      className="mt-2 w-full rounded-lg bg-emerald-600 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-50"
                    >
                      {coopBusy
                        ? t("Đang gửi sang Co.op…")
                        : coopSelectedPaymentIsOnline
                          ? t("Tạo đơn & mở màn hình thanh toán")
                          : t("Mở checkout Co.op")}
                    </button>
                  </PauseBox>
                )}

                {phase === "done" && (
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-center">
                    <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100">
                      <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M20 6 9 17l-5-5" />
                      </svg>
                    </div>
                    <h3 className="mt-3 text-lg font-bold text-slate-900">{t("Đặt hàng Co.op thành công")}</h3>
                    <p className="mt-1 text-sm text-slate-600">{orderCode}</p>
                    <button onClick={handleCloseModal} className="mt-4 w-full rounded-xl bg-emerald-600 py-3 text-sm font-semibold text-white transition hover:bg-emerald-700">
                      {t("Xong")}
                    </button>
                  </div>
                )}
              </div>
            </div>
            {hasCoopBrowser && (
              <div className="coop-stream-pane min-h-0 min-w-0">
                {coopBrowserPanel}
              </div>
            )}
          </div>

          <style jsx global>{`
            .coop-modal-body--single {
              display: flex;
              flex-direction: column;
            }
            .coop-modal-body--single .coop-popup-scroll {
              overflow-y: auto;
            }
	            .coop-modal-body--split {
	              display: grid;
	              grid-template-columns: minmax(340px, 390px) minmax(0, 980px);
	              column-gap: 20px;
	              align-items: stretch;
	              justify-content: center;
	              padding: 14px;
	              background: #f8fafc;
	              overscroll-behavior: contain;
	            }
            .coop-left-pane {
              position: relative;
              max-height: 100%;
              overflow-y: scroll;
              scrollbar-gutter: stable;
            }
	            .coop-stream-pane {
	              align-self: center;
	              width: 100%;
	              max-width: 960px;
	              height: auto;
	              max-height: 100%;
	              aspect-ratio: 4 / 3;
	              overflow: hidden;
	              overscroll-behavior: contain;
	            }
	            .coop-stream-pane > div {
	              height: 100%;
	            }
	            .coop-stream-wheel-capture {
	              overscroll-behavior: contain;
	              touch-action: none;
	            }
            @media (max-width: 900px) {
              .coop-modal-body--split {
                grid-template-columns: 1fr;
                row-gap: 14px;
                overflow-y: auto;
              }
              .coop-left-pane {
                max-height: none;
                overflow-y: visible;
              }
              .coop-stream-pane {
                height: min(52dvh, 420px);
                max-width: none;
              }
            }
            .input {
              width: 100%;
              border: 1px solid #cbd5e1;
              border-radius: 0.75rem;
              padding: 0.65rem 0.8rem;
              font-size: 0.875rem;
              outline: none;
              transition: border-color 0.15s, box-shadow 0.15s;
            }
            .input:focus {
              border-color: #10b981;
              box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.15);
            }
            .coop-date-select {
              min-width: 240px;
              background-color: #ffffff;
              line-height: 1.25rem;
            }
            .coop-popup-scroll,
            .coop-store-scroll {
              scrollbar-width: thin;
              scrollbar-color: #cbd5e1 transparent;
              scrollbar-gutter: stable;
            }
            .coop-popup-scroll::-webkit-scrollbar,
            .coop-store-scroll::-webkit-scrollbar {
              width: 8px;
              height: 8px;
            }
            .coop-popup-scroll::-webkit-scrollbar-thumb,
            .coop-store-scroll::-webkit-scrollbar-thumb {
              background-color: #cbd5e1;
              border-radius: 4px;
              border: 2px solid transparent;
              background-clip: content-box;
            }
            .coop-popup-scroll::-webkit-scrollbar-thumb:hover,
            .coop-store-scroll::-webkit-scrollbar-thumb:hover {
              background-color: #94a3b8;
            }
            .coop-popup-scroll::-webkit-scrollbar-track,
            .coop-store-scroll::-webkit-scrollbar-track {
              background: transparent;
            }
          `}</style>
        </div>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-[2200] flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.35)", backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)" }}
      onClick={handleCloseModal}
    >
      <div
        className="relative flex max-h-[92vh] w-full max-w-md flex-col overflow-hidden rounded-3xl"
        onClick={(e) => e.stopPropagation()}
        style={{
          // Liquid glass kiểu "trắng sữa trong" (giống popup filter bản đồ): bg trắng
          // ~88% để content trong popup (form, label, text) RÕ NÉT, không bị backdrop
          // tối làm mờ. Blur giữ ở 24px (đủ thấy mờ-nền sau popup, không cần quá nặng).
          backdropFilter: "blur(24px) saturate(160%)",
          WebkitBackdropFilter: "blur(24px) saturate(160%)",
          backgroundColor: "rgba(255,255,255,0.88)",
          boxShadow: "0 0 0 1px rgba(255,255,255,0.5), 0 16px 48px rgba(0,0,0,0.18), inset 0 1px 0 rgba(255,255,255,0.7)",
        }}
      >
        {/* Glass top highlight — specular reflection */}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-20 rounded-t-3xl" style={{ background: "linear-gradient(170deg, rgba(255,255,255,0.38) 0%, rgba(255,255,255,0.06) 60%, rgba(255,255,255,0) 100%)" }} />
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/20 px-4 py-3">
          <div className="min-w-0">
            <h2 className="truncate text-base font-bold text-slate-900">
              {
                phase === "done"
                  ? isCoopReal
                    ? t("Đã tạo giỏ Co.op")
                    : t("Đã đặt hàng")
                  : t("Phục vụ bởi Affree Agentic AI - AAAI")
              }
              {/* tên cũ: "Đặt hàng bằng trợ lý ảo" */}
            </h2 >
            <p className="truncate text-xs text-slate-700">
              {activeOffer.product.name} · {chain}
            </p>
          </div >
          <button
            onClick={handleCloseModal}
            className="shrink-0 rounded-full p-1.5 text-slate-500 hover:bg-white/40"
            aria-label={t("Đóng")}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div >

        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 py-4">
          {/* Banner: trợ lý thật, có human-gated checkpoints */}
          {/* Banner: bản mô phỏng */}
          <div
            className={`mb-4 rounded-lg border px-3 py-2 text-xs ${isTXNNReal
              ? "border-emerald-200 bg-emerald-50 text-amber-900" :
              isCoopReal
                ? "border-emerald-200 bg-emerald-50 text-amber-900"
                : "border-amber-300/40 bg-amber-100/30 text-amber-900"
              }`}
          >
            {
              isTXNNReal
                ? "🤝 " + t("Trợ lý đang điều phối phiên đặt hàng thật trên website nguồn và sẽ dừng ở các bước cần bạn xác nhận / OTP / thanh toán.")
                : isCoopReal
                  ? t("Co.op đang dùng luồng thật: Affree đăng nhập bằng tài khoản Affree rồi thêm sản phẩm vào giỏ Co.op — bạn không cần tài khoản.")
                  : t("Bản mô phỏng — chưa kết nối web thật. Dùng để xem cơ chế trợ lý tự thao tác và dừng lại khi cần bạn.")}
          </div>

          {/* Recap khi trợ lý chạy: sản phẩm + QR của source đặt TRÊN, tiến trình nằm dưới */}
          {phase === "running" && (
            <div className="mb-4 flex items-stretch gap-3">
              <div className="flex min-w-0 flex-1 items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                {activeOffer.product.image ? (
                  <img
                    src={activeOffer.product.image}
                    alt={activeOffer.product.name}
                    className="h-12 w-12 shrink-0 rounded-lg bg-white object-contain"
                  />
                ) : (
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-xl">
                    🛒
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-slate-900">{activeOffer.product.name}</p>
                  <p className="mt-0.5 truncate text-xs text-slate-700">{chain} · {activeOffer.store.name}</p>
                  <div className="mt-1 flex items-center gap-2">
                    <span className="text-sm font-bold text-emerald-600">
                      {formatMoney(total, storeCurrency(activeOffer.store.id))}
                    </span>
                    {qty > 1 && (
                      <span className="text-xs text-slate-600">
                        ({formatMoney(activeOffer.price, storeCurrency(activeOffer.store.id))} × {qty})
                      </span>
                    )}
                  </div>
                </div>
              </div>
              {/* QR chỉ hiện khi ĐÃ CHỌN thanh toán QR (như giỏ hàng) — thẻ/COD không liên quan QR */}
              {demoPayMethod === "qr" && (
                <div className="flex w-28 shrink-0 flex-col items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white p-2">
                  <QRCode value={`AFFREE|${phone || "..."}|${total}`} size={80} style={{ height: "auto", maxWidth: "100%", width: "100%" }} />
                  <p className="w-full break-words text-center text-[10px] leading-tight text-slate-400">
                    {t("Nội dung: AFFREE {phone}", { phone: phone || "..." })}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* PHASE 1: form thông tin cần có */}
          {phase === "form" && (
            <div className="space-y-3">
              {/* ── Thông tin chung — MODULE CHUNG với form giỏ hàng / Mua cả túi ── */}
              <OrderInfoSection
                lang={lang}
                name={name}
                phone={phone}
                address={address}
                onName={setName}
                onPhone={setPhone}
                onAddress={setAddress}
                currency={storeCurrency(activeOffer.store.id)}
              />

              {/* ── Cửa hàng & sản phẩm — như section từng cửa hàng của giỏ ── */}
              <section className="space-y-3 rounded-2xl border border-slate-200 p-3">
              {/* Sản phẩm đang đặt — qty control nằm bên phải; màn hẹp thì xuống dòng, khỏi đè chữ giá */}
              <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                {activeOffer.product.image ? (
                  <img
                    src={activeOffer.product.image}
                    alt={activeOffer.product.name}
                    className="h-14 w-14 shrink-0 rounded-lg object-contain bg-white"
                  />
                ) : (
                  <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-2xl">
                    🛒
                  </div>
                )}
                <div className="min-w-[9rem] flex-1">
                  <p className="truncate text-sm font-semibold text-slate-900">{activeOffer.product.name}</p>
                  <p className="mt-0.5 truncate text-xs text-slate-700">{chain} · {activeOffer.store.name}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2">
                    <span className="text-base font-bold text-emerald-600">
                      {formatMoney(activeOffer.price * qty, storeCurrency(activeOffer.store.id))}
                    </span>
                    {qty > 1 && (
                      <span className="text-xs text-slate-600">
                        ({formatMoney(activeOffer.price, storeCurrency(activeOffer.store.id))} × {qty})
                      </span>
                    )}
                  </div>
                </div>
                {/* Qty control */}
                <div className="flex shrink-0 flex-col items-center gap-1 ml-auto">
                  <span className="text-[10px] font-medium text-slate-400">{t("Số lượng")}</span>
                  <div className="flex items-center gap-1">
                    <button
                      // Ở mức tối thiểu (thường = 1) bấm − nữa → xoá món & huỷ đơn (đóng form),
                      // đồng bộ với giỏ hàng — không để nút − thành nút chết bấm không ăn.
                      onClick={() => (qty <= minQty ? onClose() : (setAutoQty(0), setQty((q) => Math.max(minQty, q - 1))))}
                      className="flex h-7 w-7 items-center justify-center rounded-lg border border-slate-300 bg-white text-base font-medium hover:bg-slate-100"
                    >
                      −
                    </button>
                    <span className="w-6 text-center text-sm font-semibold">{qty}</span>
                    <button
                      onClick={() => { setAutoQty(0); setQty((q) => q + 1); }}
                      className="flex h-7 w-7 items-center justify-center rounded-lg border border-slate-300 bg-white text-base font-medium hover:bg-slate-100"
                    >
                      +
                    </button>
                    {/* Thùng rác: mua ngay chỉ có 1 sản phẩm → xoá món = huỷ đơn, đóng form
                        (khỏi bấm − từng nấc khi số lượng lớn — đồng bộ hành vi với giỏ hàng). */}
                    <button
                      onClick={onClose}
                      aria-label={t("Xoá sản phẩm & huỷ đơn")}
                      title={t("Xoá sản phẩm & huỷ đơn")}
                      className="ml-1 flex h-7 w-7 items-center justify-center rounded-lg border border-slate-300 bg-white text-rose-500 hover:border-rose-300 hover:bg-rose-50"
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><line x1="10" y1="11" x2="10" y2="17" /><line x1="14" y1="11" x2="14" y2="17" /></svg>
                    </button>
                  </div>
                </div>
              </div>

              {/* Ghi chú tối thiểu cho KH biết */}
              {(minQty > 1 || minOrder != null) && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-700">
                  {minQty > 1 && <div>{t("Số lượng tối thiểu: {n} sản phẩm/đơn.", { n: minQty })}</div>}
                  {minOrder != null && (
                    <div>
                      {t("Mua tối thiểu: {amount}.", { amount: formatMoney(minOrder, curCode) })}
                      {autoQty > 0 ? (
                        <span className="ml-1 font-semibold text-emerald-700">
                          {t("(+{n} tự thêm để đủ)", { n: autoQty })}
                        </span>
                      ) : belowMinOrder ? (
                        <span className="ml-1 font-semibold text-rose-600">
                          {t("(còn thiếu {amount})", { amount: formatMoney(minOrder - total, curCode) })}
                        </span>
                      ) : null}
                    </div>
                  )}
                </div>
              )}

              {/* Khung giờ giao — chỉ hiện khi cần */}
              {cfg.needSlot && (
                <Field label={t("Khung giờ giao")}>
                  <select
                    value={slot}
                    onChange={(e) => setSlot(e.target.value)}
                    className="input"
                  >
                    {SLOTS.map((s) => (
                      <option key={s} value={s}>
                        {t(s)}
                      </option>
                    ))}
                  </select>
                </Field>
              )}

              {/* Mỗi nguồn yêu cầu khác nhau */}
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
                <p className="text-xs font-semibold text-slate-800">
                  {t("{chain} yêu cầu để đặt món này:", { chain })}
                </p>
                <ul className="mt-1 space-y-0.5">
                  {cfg.requirements.map((r) => (
                    <li key={r} className="flex items-start gap-1.5 text-xs text-slate-700">
                      <span className="mt-[3px] h-1 w-1 shrink-0 rounded-full bg-slate-400" />
                      {t(r)}
                    </li>
                  ))}
                </ul>
                {cfg.note && (
                  <p className="mt-1.5 text-[11px] text-slate-700">ℹ️ {t(cfg.note)}</p>
                )}
              </div>

              {cfg.needEmail && (
                <Field label={t("Email (nhận hoá đơn)")}>
                  <input
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    inputMode="email"
                    placeholder="email@vidu.com"
                    aria-invalid={emailError}
                    className="input"
                    style={emailError ? { borderColor: "#ef4444" } : undefined}
                  />
                  {emailError && (
                    <span className="mt-1 block text-xs text-rose-600">
                      {t("Email không hợp lệ.")}
                    </span>
                  )}
                </Field>
              )}

              {/* Ghi chú cho cửa hàng — đồng bộ với ô ghi chú từng cửa hàng của giỏ */}
              <Field label={t("Ghi chú")}>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={2}
                  placeholder={t("Ghi chú (tuỳ chọn): màu sắc, kích cỡ, thời gian nhận…")}
                  className="input resize-none"
                />
              </Field>
              </section>

              {/* Địa chỉ giao khác vị trí định vị → gợi ý chọn lại nơi mua */}
              {showRepick && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
                  <p className="text-xs text-amber-800">
                    📍 {geoAddr ? t("Địa chỉ giao khác với vị trí định vị của bạn — ") : t("Định vị theo địa chỉ giao — ")}
                    {geocoding
                      ? t("đang định vị & tính khoảng cách theo địa chỉ giao…")
                      : deliveryLoc
                        ? t("khoảng cách dưới đây tính từ địa chỉ giao, gần nhất xếp trên. Chọn lại nơi mua:")
                        : t("chưa xác định được toạ độ địa chỉ giao (khoảng cách tạm tính từ vị trí cũ). Chọn lại nơi mua:")}
                  </p>

                  {/* Lọc: gần / rẻ */}
                  <div className="mt-2 inline-flex rounded-lg border border-slate-200 bg-white p-0.5 text-xs font-medium">
                    <button
                      onClick={() => setRepickSort("near")}
                      className={`rounded-md px-3 py-1 transition ${repickSort === "near"
                        ? "bg-emerald-600 text-white"
                        : "text-slate-600 hover:bg-slate-100"
                        }`}
                    >
                      {t("Gần nhất")}
                    </button>
                    <button
                      onClick={() => setRepickSort("cheap")}
                      className={`rounded-md px-3 py-1 transition ${repickSort === "cheap"
                        ? "bg-emerald-600 text-white"
                        : "text-slate-600 hover:bg-slate-100"
                        }`}
                    >
                      {t("Rẻ nhất")}
                    </button>
                  </div>

                  <div className="mt-2 max-h-64 space-y-1.5 overflow-y-auto overscroll-contain pr-0.5">
                    {storeChoices.map((o) => {
                      const active = o.store.id === activeOffer.store.id;
                      return (
                        <button
                          key={o.store.id}
                          onClick={() => setActiveOffer(o)}
                          className={`flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-sm transition ${active
                            ? "border-emerald-500 bg-emerald-50 ring-1 ring-emerald-500"
                            : "border-slate-200 bg-white hover:border-slate-300"
                            }`}
                        >
                          <ChainBadge chain={o.store.chain} />
                          <span className="flex min-w-0 flex-1 flex-col">
                            <span className="flex min-w-0">
                              <MarqueeText className="font-medium text-slate-800">
                                {o.store.name}
                              </MarqueeText>
                            </span>
                            <span className="mt-0.5 flex flex-wrap items-center gap-1">
                              <span className="text-xs text-slate-500">
                                {o.distanceKm != null
                                  ? `${o.distanceKm.toFixed(1)} km`
                                  : t("Online")}
                              </span>
                              {o.store.id === cheapestId && (
                                <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">
                                  {t("Rẻ nhất")}
                                </span>
                              )}
                              {o.store.id === nearestId && (
                                <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700">
                                  {t("Gần nhất")}
                                </span>
                              )}
                            </span>
                          </span>
                          <span className="shrink-0 text-right">
                            <span className="block font-semibold text-emerald-600">
                              {formatMoney(o.price, storeCurrency(o.store.id))}
                            </span>
                            {active && (
                              <span className="text-[11px] font-medium text-emerald-600">
                                {t("Đang chọn")}
                              </span>
                            )}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* ── Thanh toán — tabs ngang CÙNG CẤU TRÚC với form giỏ hàng ── */}
              {isBHXReal || (!isCoopReal && !isTXNNReal) ? (
                <section className="rounded-2xl border border-slate-200 p-3">
                  <h3 className="mb-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    {t("Thanh toán")}
                  </h3>
                  <div className="mb-3 flex gap-1.5">
                    {(["qr", "card", "cod"] as DemoPayMethod[]).map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setDemoPayMethod(m)}
                        className={`flex-1 rounded-lg border py-1.5 text-xs font-semibold transition-colors ${demoPayMethod === m ? "border-emerald-500 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"}`}
                      >
                        {m === "qr" ? "📱 QR" : m === "card" ? "💳 " + t("Thẻ") : "💵 COD"}
                      </button>
                    ))}
                  </div>
                  {demoPayMethod === null ? (
                    <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
                      {t("Chọn phương thức thanh toán để tiếp tục.")}
                    </p>
                  ) : (
                    <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
                      {demoPayMethod === "cod"
                        ? "💵 " + t("Trợ lý sẽ đặt đơn COD — trả tiền mặt khi nhận hàng.")
                        : (demoPayMethod === "qr" ? "📱 " : "💳 ") + t("Trợ lý sẽ dừng ở bước thanh toán để bạn hoàn tất trên website thật rồi xác nhận lại.")}
                    </p>
                  )}

                  {/* Chọn "Thẻ" → hiện NGAY thông tin thẻ (như giỏ hàng): thẻ đã lưu hoặc form nhập */}
                  {demoPayMethod === "card" && usingSavedCard && savedCard && (
                    <div className="mt-2.5 space-y-2">
                      <div className="flex items-center gap-2 rounded-xl border border-emerald-400 bg-emerald-50/60 px-3 py-2 ring-1 ring-emerald-200">
                        <span className="rounded border border-slate-300 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-600">
                          {savedCard.brand ?? t("Thẻ")}
                        </span>
                        <span className="flex-1 truncate font-mono text-sm text-slate-800">
                          {cardRevealed ? savedCard.number : `****${savedCard.number.replace(/\D/g, "").slice(-4)}`}
                        </span>
                        <span className="font-mono text-xs text-slate-500">{savedCard.exp}</span>
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
                      {cardOtpCode && !cardRevealed && (
                        <div className="space-y-1.5 rounded-lg bg-slate-50 px-3 py-2 ring-1 ring-slate-200">
                          <p className="text-[11px] text-slate-500">
                            📩 {t("(Mô phỏng) OTP đã gửi tới SĐT")} ****{phone.replace(/\D/g, "").slice(-3) || "•••"}: <b className="font-mono text-slate-700">{cardOtpCode}</b>
                          </p>
                          <div className="flex gap-2">
                            <input
                              type="text"
                              inputMode="numeric"
                              maxLength={6}
                              value={cardOtpInput}
                              onChange={(e) => { setCardOtpInput(e.target.value.replace(/\D/g, "")); setCardOtpError(false); }}
                              placeholder={t("Nhập OTP 6 số")}
                              className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-mono outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                            />
                            <button
                              type="button"
                              onClick={verifyCardOtp}
                              disabled={cardOtpInput.length < 6}
                              className="shrink-0 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:bg-slate-300"
                            >
                              {t("Xác nhận")}
                            </button>
                          </div>
                          {cardOtpError && <p className="text-[11px] text-rose-600">{t("OTP chưa đúng — thử lại.")}</p>}
                        </div>
                      )}
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-[11px] text-slate-400">
                          {"✓ " + t("Thẻ đã lưu sẽ được trợ lý dùng thanh toán tự động.")}
                        </p>
                        <button
                          type="button"
                          onClick={() => setUseNewCard(true)}
                          className="shrink-0 text-[11px] font-medium text-emerald-600 underline-offset-2 hover:underline"
                        >
                          {t("Dùng thẻ khác")}
                        </button>
                      </div>
                    </div>
                  )}
                  {demoPayMethod === "card" && !usingSavedCard && (
                    <div className="mt-2.5 space-y-2">
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
                        value={cardNum}
                        onChange={(e) => setCardNum(e.target.value.replace(/\D/g, "").slice(0, 16).replace(/(.{4})/g, "$1 ").trim())}
                        placeholder={t("Số thẻ") + " 0000 0000 0000 0000"}
                        className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-mono outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                      />
                      <div className="flex gap-2">
                        <input
                          type="text"
                          maxLength={5}
                          value={cardExp}
                          onChange={(e) => {
                            const v = e.target.value.replace(/\D/g, "").slice(0, 4);
                            setCardExp(v.length > 2 ? v.slice(0, 2) + "/" + v.slice(2) : v);
                          }}
                          placeholder="MM/YY"
                          className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-mono outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                        />
                        <input
                          type="password"
                          maxLength={4}
                          value={cardCvv}
                          onChange={(e) => setCardCvv(e.target.value.replace(/\D/g, "").slice(0, 3))}
                          placeholder="CVV •••"
                          className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-mono outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                        />
                      </div>
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
              ) : (
                <section className="rounded-2xl border border-slate-200 p-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t("Thanh toán")}</h3>
                    <span className="text-sm font-semibold text-slate-800">{paymentLabel}</span>
                  </div>
                  <p className="mt-1 text-[11px] text-slate-400">
                    {usesQrPayment
                      ? t("Flow TXNN live sẽ dừng ở bước QR để bạn thanh toán trên website thật rồi xác nhận lại cho trợ lý.")
                      : isCoopReal
                        ? t("{chain} hỗ trợ: {payments}. Affree sẽ mở màn hình thanh toán khi cần bạn hoàn tất giao dịch.", { chain, payments: cfg.payments.join(" · ") })
                        : t("{chain} hỗ trợ: {payments}. Affree chỉ đặt COD — không thu thập thông tin thẻ.", { chain, payments: cfg.payments.join(" · ") })}
                  </p>
                </section>
              )}

              {
                coopBelowMinimum && (
                  <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                    {t("Co.op chỉ cho thanh toán khi đơn từ 200.000đ. Tăng số lượng hoặc chọn sản phẩm khác để tiếp tục.")}
                  </div>
                )
              }

              {
                coopError && (
                  <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                    {coopError}
                  </div>
                )
              }

            </div >
          )
          }

          {/* PHASE 2: trợ lý chạy */}
          {phase === "running" && isCoopReal && (
            <div className="space-y-3">
              <ol className="space-y-2.5">
                <li className="flex items-start gap-2.5">
                  <span className="mt-0.5 shrink-0">
                    <CheckIcon />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-slate-400">
                      {coopResult?.usedTokenCache
                        ? t("Đã dùng token cache Co.op để vào giỏ")
                        : coopResult?.alreadyRegistered
                          ? t("Affree đã đăng nhập Co.op bằng tài khoản Affree")
                          : t("Đã gửi yêu cầu kết nối Co.op")}
                    </p>
                  </div>
                </li>
                <li className="flex items-start gap-2.5">
                  <span className="mt-0.5 shrink-0">
                    {coopBusy ? <Spinner /> : <PauseDot />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-800">
                      {t("Nhập OTP thật Co.op gửi về {phone}", { phone: phoneDigits })}
                    </p>
                    <PauseBox tone="blue" hint={t("Mã này đến từ Co.op, Affree không đọc SMS giúp bạn.")}>
                      <div className="flex gap-2">
                        <input
                          value={otp}
                          onChange={(e) => {
                            setOtp(e.target.value.replace(/\D/g, "").slice(0, 6));
                            setCoopError("");
                          }}
                          inputMode="numeric"
                          placeholder={t("6 SỐ OTP")}
                          className="input flex-1"
                          autoFocus
                        />
                        <button
                          disabled={otp.length !== 6 || coopBusy}
                          onClick={() => void confirmCoopOtp()}
                          className="shrink-0 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-50"
                        >
                          {coopBusy ? t("Đang gửi…") : t("Xác thực")}
                        </button>
                      </div>
                      <button
                        type="button"
                        disabled={coopBusy}
                        onClick={() => void resendCoopOtp()}
                        className="mt-2 text-xs font-semibold text-blue-700 hover:text-blue-800 disabled:opacity-50"
                      >
                        {t("Gửi lại OTP")}
                      </button>
                      {coopError && (
                        <p className="mt-2 text-xs font-medium text-rose-600">{coopError}</p>
                      )}
                    </PauseBox>
                  </div>
                </li>
                <li className="flex items-start gap-2.5">
                  <span className="mt-0.5 shrink-0">
                    <PauseDot />
                  </span>
                  <p className="text-sm text-slate-500">
                    {t("Sau OTP: login OAuth, tạo cart Co.op, add sản phẩm, validate đơn tối thiểu 200.000đ và đọc ngày/khung giờ giao hợp lệ.")}
                  </p>
                </li>
              </ol>
            </div>
          )}

          {phase === "running" && isBHXReal && (
            <div className="space-y-3">
              <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2.5">
                <div className="flex items-center gap-2">
                  {bhxBusy ? <Spinner /> : <CheckIcon />}
                  <p className="text-sm font-semibold text-slate-900">
                    {bhxBusy ? t("Đang chạy agent Bách Hóa Xanh…") : t("Agent Bách Hóa Xanh đã dừng")}
                  </p>
                </div>
                <p className="mt-1 text-xs text-slate-600">
                  {t("Log từ agent-server sẽ hiển thị bên dưới.")}
                </p>
              </div>

              <ol className="max-h-[420px] space-y-2 overflow-y-auto pr-1">
                {bhxMessages.map((log, i) => {
                  const tone =
                    log.status === "error"
                      ? "border-rose-200 bg-rose-50 text-rose-700"
                      : log.status === "warning"
                        ? "border-amber-200 bg-amber-50 text-amber-800"
                        : log.status === "success"
                          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                          : "border-slate-200 bg-white text-slate-700";
                  return (
                    <li key={`${i}-${log.message}`} className={`rounded-lg border px-3 py-2 text-sm ${tone}`}>
                      <div className="flex items-start gap-2">
                        <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-70" />
                        <span className="min-w-0 whitespace-pre-wrap break-words">{log.message}</span>
                      </div>
                    </li>
                  );
                })}
              </ol>

              {bhxOtpVisible && (
                <div className="rounded-xl border border-blue-200 bg-blue-50 p-3">
                  <p className="mb-2 text-sm font-semibold text-blue-800">
                    {t("Nhập OTP Bách Hóa Xanh")}
                  </p>
                  <div className="flex gap-2">
                    <input
                      value={bhxOtp}
                      onChange={(e) => setBhxOtp(e.target.value.replace(/\D/g, "").slice(0, 8))}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") submitBHXOtp();
                      }}
                      inputMode="numeric"
                      placeholder={t("Nhập mã OTP")}
                      className="input flex-1 bg-white"
                      autoFocus
                    />
                    <button
                      type="button"
                      disabled={!bhxOtp.trim()}
                      onClick={submitBHXOtp}
                      className="shrink-0 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {t("Gửi")}
                    </button>
                  </div>
                </div>
              )}

              {bhxShowScreencast && (
                <div className="rounded-xl border border-emerald-200 bg-white p-2">
                  <p className="mb-2 px-1 text-sm font-semibold text-emerald-700">
                    {t("Màn hình sau khi đặt hàng")}
                  </p>
                  <div
                    className="overflow-hidden rounded-lg bg-slate-950"
                    style={{ aspectRatio: `${bhxBrowserSize.width} / ${bhxBrowserSize.height}` }}
                  >
                    {bhxBrowserFrame ? (
                      <img
                        src={bhxBrowserFrame}
                        alt={t("Màn hình Bách Hóa Xanh")}
                        className="h-full w-full object-contain"
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center text-xs font-medium text-slate-300">
                        {t("Đang chờ ảnh màn hình...")}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {bhxDeliveryHtml && (
                <div className="rounded-xl border border-slate-200 bg-white p-2">
                  <p className="mb-2 px-1 text-sm font-semibold text-emerald-700">
                    {t("Chọn thời gian giao hàng")}
                  </p>
                  <div
                    className="bhx-delivery-html max-h-[360px] overflow-y-auto rounded-lg bg-slate-50"
                    onClick={handleBHXDeliveryChoice}
                    dangerouslySetInnerHTML={{ __html: bhxDeliveryHtml }}
                  />
                  {bhxSelectedDeliveryText && (
                    <p className="mt-2 rounded-lg bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700">
                      {t("Đã gửi lựa chọn: {choice}", { choice: bhxSelectedDeliveryText })}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {phase === "running" && !isCoopReal && !isBHXReal && (
            <div className="space-y-1">
              <ol className="space-y-2.5">
                {visibleSteps.map((s, i) => {
                  const isCurrent = i === currentStepIndex;
                  const done = i < currentStepIndex;
                  return (
                    <li key={i} className="flex items-start gap-2.5">
                      <span className="mt-0.5 shrink-0">
                        {done ? (
                          <CheckIcon />
                        ) : isCurrent && s.kind === "auto" ? (
                          <Spinner />
                        ) : (
                          <PauseDot />
                        )}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p
                          className={`text-sm ${done ? "text-slate-400" : "font-medium text-slate-800"
                            }`}
                        >
                          {s.label}
                        </p>

                        {/* Khối tương tác khi tới bước cần người */}
                        {isCurrent && s.kind === "login" && (
                          <PauseBox tone="blue" hint={t("🔐 Trợ lý KHÔNG nhập mật khẩu giúp bạn. Bạn tự đăng nhập rồi bấm tiếp.")}>
                            <button
                              onClick={() => {
                                if (usesServerTimeline) {
                                  void sendSessionEvent({ type: "login_completed" });
                                  return;
                                }
                                setStepIndex((x) => x + 1);
                              }}
                              className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700"
                            >
                              {t("Tôi đã đăng nhập xong →")}
                            </button>
                          </PauseBox>
                        )}

                        {isCurrent && s.kind === "otp" && (
                          <PauseBox tone="blue" hint={t("🔐 Trợ lý không tự đọc được OTP — bạn nhập mã giúp.")}>
                            {!usesServerTimeline && !simOtp ? (
                              <div className="mb-2 flex items-center gap-2 rounded-lg bg-white px-2.5 py-2 text-xs text-slate-500">
                                <Spinner />
                                {t("Đang chờ {chain} gửi mã…", { chain })}
                              </div>
                            ) : !usesServerTimeline && simOtp ? (
                              <div className="mb-2 rounded-lg border border-blue-200 bg-white px-2.5 py-2">
                                <p className="text-[11px] text-slate-500">
                                  💬 {t("Tin nhắn mô phỏng từ {chain}", { chain })}
                                </p>
                                <div className="mt-1 flex items-center justify-between gap-2">
                                  <span className="font-mono text-lg font-bold tracking-[0.3em] text-slate-900">
                                    {simOtp}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setOtp(simOtp);
                                      setOtpError(false);
                                    }}
                                    className="shrink-0 rounded-md border border-blue-300 bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-100"
                                  >
                                    {t("Điền giúp")}
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <div className="mb-2 rounded-lg border border-blue-200 bg-white px-3 py-2 text-xs text-slate-600">
                                {t("Nhập OTP thật bạn vừa nhận được rồi bấm Gửi để worker tiếp tục.")}
                              </div>
                            )}
                            <div className="flex gap-2">
                              <input
                                value={otp}
                                onChange={(e) => {
                                  setOtp(e.target.value.replace(/\D/g, "").slice(0, 8));
                                  setOtpError(false);
                                }}
                                inputMode="numeric"
                                placeholder={t("Nhập mã OTP")}
                                className="input flex-1"
                                autoFocus
                              />
                              <button
                                disabled={otp.length < 4 || (!usesServerTimeline && !simOtp)}
                                onClick={() => {
                                  if (!usesServerTimeline && otp !== simOtp) {
                                    setOtpError(true);
                                    return;
                                  }
                                  const submittedOtp = otp;
                                  setOtp("");
                                  setOtpError(false);
                                  if (usesServerTimeline) {
                                    void sendSessionEvent({ type: "otp_submitted", otp: submittedOtp });
                                    return;
                                  }
                                  setSimOtp("");
                                  setStepIndex((x) => x + 1);
                                }}
                                className="shrink-0 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-50"
                              >
                                {t("Gửi")}
                              </button>
                            </div>
                            {otpError && !usesServerTimeline && (
                              <p className="mt-1.5 text-xs font-medium text-rose-600">
                                {t("Mã chưa đúng — nhập đúng {otp} (hoặc bấm “Điền giúp”).", { otp: simOtp })}
                              </p>
                            )}
                          </PauseBox>
                        )}

                        {isCurrent && s.kind === "captcha" && (
                          <PauseBox tone="amber" hint={t("🤖 Trợ lý không vượt CAPTCHA. Bạn xác minh giúp (mô phỏng).")}>
                            <button
                              onClick={() => {
                                if (usesServerTimeline) {
                                  void sendSessionEvent({ type: "captcha_completed" });
                                  return;
                                }
                                setStepIndex((x) => x + 1);
                              }}
                              className="flex w-full items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-left text-sm hover:bg-slate-50"
                            >
                              <span className="flex h-5 w-5 items-center justify-center rounded border-2 border-slate-400 text-emerald-600">
                                ✓
                              </span>
                              {t("Tôi không phải là người máy")}
                            </button>
                          </PauseBox>
                        )}

                        {isCurrent && s.kind === "payment-select" && (
                          <PauseBox tone="blue" hint={demoPayMethod === "qr"
                            ? t("📱 Bạn đã chọn QR chuyển khoản từ đầu — quét mã rồi bấm xác nhận.")
                            : t("💳 Thông tin thẻ chưa đủ — bổ sung để trợ lý thanh toán giúp bạn.")}>
                            <div className="space-y-2">
                              {/* Phương thức đã chọn ở form đặt hàng — không hiện lại lựa chọn ở đây */}
                              {/* QR: KHÔNG vẽ lại ở bước này — mã đã hiện sẵn ở recap phía trên
                                  (đồng bộ với giỏ hàng: QR chỉ 1 chỗ, bước này chỉ còn nút xác nhận). */}

                              {/* Card form */}
                              {demoPayMethod === "card" && (
                                <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-3">
                                  {brandChipsRow}
                                  <div>
                                    <label className="text-[11px] font-medium text-slate-500">{t("Số thẻ")}</label>
                                    <input
                                      value={cardNum}
                                      onChange={(e) => setCardNum(e.target.value.replace(/\D/g, "").slice(0, 16).replace(/(.{4})/g, "$1 ").trim())}
                                      placeholder="1234 5678 9012 3456"
                                      className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-sm outline-none focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400"
                                    />
                                  </div>
                                  <div className="flex gap-2">
                                    <div className="flex-1">
                                      <label className="text-[11px] font-medium text-slate-500">{t("MM/YY")}</label>
                                      <input
                                        value={cardExp}
                                        onChange={(e) => {
                                          const v = e.target.value.replace(/\D/g, "").slice(0, 4);
                                          setCardExp(v.length > 2 ? v.slice(0,2) + "/" + v.slice(2) : v);
                                        }}
                                        placeholder="MM/YY"
                                        className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-sm outline-none focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400"
                                      />
                                    </div>
                                    <div className="flex-1">
                                      <label className="text-[11px] font-medium text-slate-500">CVV</label>
                                      <input
                                        value={cardCvv}
                                        onChange={(e) => setCardCvv(e.target.value.replace(/\D/g, "").slice(0, 3))}
                                        placeholder="•••"
                                        type="password"
                                        className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-sm outline-none focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400"
                                      />
                                    </div>
                                  </div>
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

                              <button
                                type="button"
                                onClick={() => setStepIndex((x) => x + 1)}
                                className="w-full rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-700"
                              >
                                {demoPayMethod === "qr" ? t("Đã chuyển khoản →") : t("Xác nhận thẻ →")}
                              </button>
                            </div>
                          </PauseBox>
                        )}

                        {isCurrent && s.kind === "qr" && (
                          <PauseBox tone="amber" hint={popupShowingQr
                            ? t("💳 Bước 1: worker đang ưu tiên cast vùng QR ở đầu popup để bạn quét/thanh toán trước.")
                            : t("✅ Bước 2: sau khi thanh toán, worker đang focus vùng cuối popup để bạn bấm nút xác nhận trên website thật.")}>
                            <div className="mb-2 space-y-2 rounded-lg border border-slate-200 bg-white p-3">
                              <p className="text-sm font-semibold text-slate-700">{t("Thông tin đặt hàng")}</p>
                              <div className="grid gap-2 sm:grid-cols-2">
                                <label className="block text-xs font-medium text-slate-500">
                                  {t("Tên người đặt")}
                                  <input value={name} readOnly className="input mt-1 bg-slate-50 text-slate-700" />
                                </label>
                                <label className="block text-xs font-medium text-slate-500">
                                  {t("Số điện thoại")}
                                  <input value={phone} readOnly className="input mt-1 bg-slate-50 text-slate-700" />
                                </label>
                              </div>
                              <p className="text-[11px] text-slate-400">
                                {t("Hai thông tin này đã được gửi sang worker từ lúc tạo phiên; nếu site nguồn hiện không render field tương ứng, trợ lý vẫn giữ đúng dữ liệu buyer để tiếp tục flow thanh toán.")}
                              </p>
                            </div>

                            {serverState?.popupFrameAvailable && serverState.popup && sessionId ? (
                              <div className="rounded-lg border border-emerald-200 bg-white p-3">
                                <div className="mb-2 flex items-start justify-between gap-3">
                                  <div>
                                    <p className="text-sm font-semibold text-slate-800">
                                      {popupShowingQr
                                        ? (serverState.popup.title || t("Bước 1: mã QR thanh toán"))
                                        : t("Bước 2: nút xác nhận cuối")}
                                    </p>
                                    <p className="mt-1 text-xs text-slate-500">
                                      {popupShowingQr
                                        ? t("Worker đang crop vùng QR trong popup thật. Quét/chuyển khoản xong thì bấm nút chuyển xuống nút xác nhận.")
                                        : t("Popup đang focus vùng cuối. Bạn có thể click trực tiếp vào ảnh bên dưới để bấm nút xác nhận trên website thật.")}
                                    </p>
                                  </div>
                                  <span className="rounded-full bg-emerald-100 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
                                    {serverState.popup.view || "popup-focus"}
                                  </span>
                                </div>
                                <img
                                  src={popupFrameSrc || undefined}
                                  alt={serverState.popup.title || t("Popup thanh toán")}
                                  className={`mx-auto max-h-[26rem] w-auto rounded-lg border border-slate-200 bg-white ${popupViewerOpen ? "cursor-zoom-in opacity-75" : "cursor-crosshair"}`}
                                  onClick={handlePopupFrameClick}
                                />
                                <div className="mt-2 space-y-1">
                                  {serverState.popup.text && (
                                    <p className="rounded-lg bg-slate-50 px-2.5 py-2 text-xs text-slate-600">
                                      {serverState.popup.text}
                                    </p>
                                  )}
                                  {serverState.popup.actions.length > 0 && (
                                    <p className="text-[11px] text-slate-500">
                                      {t("Nút phát hiện trong popup")}: {serverState.popup.actions.join(" · ")}
                                    </p>
                                  )}
                                  <div className="flex flex-wrap gap-2 pt-1">
                                    {!popupShowingQr && (
                                      <button
                                        type="button"
                                        onClick={() => void switchPopupView("qr")}
                                        className="inline-flex items-center rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                                      >
                                        {t("Hiện mã QR")}
                                      </button>
                                    )}
                                    {popupShowingQr && (
                                      <button
                                        type="button"
                                        onClick={() => void switchPopupView("confirm")}
                                        className="inline-flex items-center rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-100"
                                      >
                                        {t("Chuyển xuống nút xác nhận")}
                                      </button>
                                    )}
                                    <button
                                      type="button"
                                      onClick={() => setPopupViewerOpen(true)}
                                      className="inline-flex items-center rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-100"
                                    >
                                      {t("Mở popup lớn để thao tác")}
                                    </button>
                                  </div>
                                </div>
                              </div>
                            ) : serverState?.qrCodeAvailable && sessionId ? (
                              <div className="rounded-lg bg-white p-3">
                                <img
                                  src={`/api/order-sessions/${sessionId}/qrcode?ts=${encodeURIComponent(serverState.updatedAt)}`}
                                  alt={t("Mã QR thanh toán")}
                                  className="mx-auto max-h-72 w-auto rounded-lg border border-slate-200 bg-white"
                                />
                                <p className="mt-2 text-center text-xs text-slate-500">
                                  {t("Fallback QR: worker chưa cast được popup thanh toán thật. Bạn có thể quét mã này rồi báo lại cho trợ lý xác minh.")}
                                </p>
                              </div>
                            ) : (
                              <div className="rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm text-amber-800">
                                {t("Chưa lấy được popup-focus frame từ worker. Bạn có thể mở trang nguồn để thanh toán thủ công rồi quay lại báo hoàn tất.")}
                              </div>
                            )}

                            <div className="mt-2 space-y-2">
                              <button
                                onClick={() => {
                                  if (popupShowingQr) {
                                    void switchPopupView("confirm");
                                    return;
                                  }
                                  void submitPaymentConfirmed();
                                }}
                                disabled={paymentConfirmBusy}
                                className="w-full rounded-lg bg-emerald-600 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-emerald-300"
                              >
                                {paymentConfirmBusy
                                  ? t("Đang kiểm tra thanh toán...")
                                  : popupShowingQr
                                    ? t("Tôi đã thanh toán xong, xuống nút xác nhận")
                                    : t("Đã bấm xác nhận xong, bắt đầu kiểm tra")}
                              </button>
                              <a
                                href={serverState?.handoffUrl || activeOffer.productUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="block rounded-lg border border-slate-300 bg-white px-3 py-2 text-center text-sm font-semibold text-slate-700 hover:bg-slate-50"
                              >
                                {t("Mở trang nguồn")}
                              </a>
                            </div>
                          </PauseBox>
                        )}

                        {isCurrent && s.kind === "confirm" && (
                          <PauseBox tone="emerald" hint={t("✋ Bước cuối không thể hoàn tác — bạn duyệt rồi trợ lý mới đặt.")}>
                            <div className="space-y-1.5 rounded-lg bg-white p-2.5 text-sm">
                              <Row k={t("Tên người đặt")} v={name} />
                              <Row k={t("Số điện thoại")} v={phone} />
                              <Row k={t("Món")} v={`${activeOffer.product.name} ×${qty}`} />
                              <Row k={t("Nơi bán")} v={`${chain} · ${activeOffer.store.name}`} />
                              <Row k={t("Giao tới")} v={address} />
                              {cfg.needEmail && email.trim() && <Row k="Email" v={email} />}
                              {cfg.needSlot && !isCoopReal && <Row k={t("Khung giờ")} v={t(slot)} />}
                              <Row k={t("Thanh toán")} v={paymentLabel} />
                              <Row k={t("Tổng")} v={formatMoney(total, storeCurrency(activeOffer.store.id))} strong />
                            </div>
                            <button
                              onClick={() => {
                                if (usesServerTimeline) {
                                  void sendSessionEvent({ type: "confirm_final_action" });
                                  return;
                                }
                                setStepIndex((x) => x + 1);
                              }}
                              className="mt-2 w-full rounded-lg bg-emerald-600 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-700"
                            >
                              {t("Xác nhận đặt hàng")}
                            </button>
                          </PauseBox>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ol>
            </div>
          )}

          {/* PHASE 3: thành công */}
          {phase === "done" && (
            <div className="flex flex-col items-center py-4 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100">
                <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 6 9 17l-5-5" />
                </svg>
              </div>
              <h3 className="mt-3 text-lg font-bold text-slate-900">
                {isCoopReal ? t("Đã thêm vào giỏ Co.op!") : t("Đặt hàng thành công!")}
              </h3>
              <p className="mt-1 text-sm text-slate-500">
                {isCoopReal
                  ? t("Affree đã login bằng luồng thật và tạo giỏ trong tài khoản {chain}. Mã giỏ:", { chain })
                  : t("Trợ lý đã đặt đơn trên {chain}. Mã đơn:", { chain })}
              </p>
              <p className="mt-1 text-base font-bold tracking-wide text-emerald-600">{orderCode}</p>

              <div className="mt-4 w-full space-y-1.5 rounded-xl bg-slate-50 p-3 text-left text-sm">
                <Row k={t("Món")} v={`${activeOffer.product.name} ×${qty}`} />
                <Row k={t("Nơi bán")} v={`${chain} · ${activeOffer.store.name}`} />
                <Row k={t("Giao tới")} v={address} />
                {cfg.needEmail && email.trim() && <Row k="Email" v={email} />}
                {!isCoopReal && cfg.needSlot && <Row k={t("Khung giờ")} v={t(slot)} />}
                <Row k={t("Thanh toán")} v={paymentLabel} />
                <Row k={t("Tổng")} v={formatMoney(total, storeCurrency(activeOffer.store.id))} strong />
                {isCoopReal && coopResult?.terminalCode && (
                  <Row k={t("Kho Co.op")} v={coopResult.terminalCode} />
                )}
              </div>

              {isCoopReal && (
                <div className="mt-4 w-full rounded-xl border border-slate-200 bg-white p-3 text-left">
                  <div className="flex items-start gap-2">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-xs font-bold text-emerald-700">
                      2
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-slate-900">{t("Checkout Co.op")}</p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {t("Giỏ đã tạo xong. Chọn ngày nhận hàng và khung giờ trước, bước đặt hàng thật sẽ làm sau.")}
                      </p>
                    </div>
                  </div>

                  <div className="mt-4">
                    <Field label={t("Chọn ngày nhận hàng")}>
                      <div className="relative max-w-[260px]">
                        <select
                          value={coopDeliveryDate}
                          onChange={(e) => {
                            setCoopDeliveryDate(e.target.value);
                            setCoopCheckoutPrepared(false);
                          }}
                          className="coop-date-select input h-11 appearance-none text-slate-700"
                          style={{
                            paddingLeft: "44px",
                            paddingRight: "40px",
                            WebkitAppearance: "none",
                            appearance: "none",
                          }}
                        >
                          <option value="">{t("dd/mm/yyyy")}</option>
                          {(coopDeliveryDates.length ? coopDeliveryDates : [todayInput]).map((date) => (
                            <option key={date} value={date}>
                              {formatCoopDate(date)}
                            </option>
                          ))}
                        </select>
                        <svg
                          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"
                          width="18"
                          height="18"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M8 2v4M16 2v4M3 10h18" />
                          <rect x="3" y="4" width="18" height="18" rx="2" />
                        </svg>
                        <svg
                          className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-500"
                          width="16"
                          height="16"
                          viewBox="0 0 24 24"
                          fill="currentColor"
                        >
                          <path d="m7 10 5 5 5-5H7Z" />
                        </svg>
                      </div>
                    </Field>
                  </div>

                  <div className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
                    {coopSavedAddress ? (
                      <Row k={t("Địa chỉ Co.op")} v={coopSavedAddress} />
                    ) : (
                      <Row k={t("Địa chỉ Co.op")} v={t("Chưa thấy trong giỏ")} />
                    )}
                    <Row
                      k={t("Thanh toán Co.op")}
                      v={coopSelectedPaymentName || t("Chưa thấy")}
                    />
                    <Row
                      k={t("COD")}
                      v={
                        coopResult?.paymentCheck?.codSelected
                          ? t("Đang chọn")
                          : coopResult?.paymentCheck?.codAvailable
                            ? t("Có hỗ trợ, chưa chọn")
                            : t("Chưa khả dụng")
                      }
                    />
                  </div>

                  <div className="mt-4">
                    <p className="mb-2 text-xs font-medium text-slate-500">{t("Chọn khung giờ")}</p>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                      {effectiveCoopDeliverySlots.map((timeSlot) => {
                        const selected = coopSlotFrom === timeSlot.from && coopSlotTo === timeSlot.to;
                        return (
                          <button
                            key={`${timeSlot.from}-${timeSlot.to}`}
                            type="button"
                            disabled={timeSlot.disabled}
                            onClick={() => {
                              setCoopSlotFrom(timeSlot.from);
                              setCoopSlotTo(timeSlot.to);
                              setCoopCheckoutPrepared(false);
                            }}
                            className={`h-11 rounded-lg border px-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${selected
                              ? "border-emerald-500 bg-emerald-50 text-emerald-700 ring-1 ring-emerald-500"
                              : "border-slate-300 bg-white text-slate-700 hover:border-slate-400"
                              }`}
                          >
                            {timeSlot.from} - {timeSlot.to}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {coopDeliveryReady && (
                    <div className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
                      <Row k={t("Ngày nhận")} v={formatCoopDate(coopDeliveryDate)} />
                      <Row k={t("Khung giờ")} v={`${coopSlotFrom} - ${coopSlotTo}`} />
                    </div>
                  )}

                  {coopCheckoutPrepared && (
                    <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700">
                      {t("Đã cập nhật lịch giao và phương thức thanh toán vào giỏ Co.op. Chưa gửi đặt hàng thật sang Co.op.")}
                    </div>
                  )}

                  {coopError && (
                    <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-600">
                      {coopError}
                    </p>
                  )}

                  <button
                    type="button"
                    disabled={!coopDeliveryReady || coopBusy || !coopResult?.checkoutFlowId}
                    onClick={prepareCoopCheckout}
                    className="mt-3 w-full rounded-xl bg-emerald-600 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {coopBusy ? t("Đang cập nhật Co.op…") : t("Cập nhật lịch giao & phương thức thanh toán")}
                  </button>
                </div>
              )}

              {isCoopReal && (
                <p className="mt-3 text-xs leading-relaxed text-slate-500">
                  {t("Bước này chỉ cập nhật giỏ/checkout Co.op, chưa bấm Thanh toán và chưa tạo đơn thật.")}
                </p>
              )}

              {isCoopReal && coopResult?.cartUrl && (
                <a
                  href={coopResult.cartUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-3 w-full rounded-xl border border-emerald-200 bg-emerald-50 py-2.5 text-sm font-semibold text-emerald-700 transition hover:bg-emerald-100"
                >
                  {t("Mở giỏ Co.op")}
                </a>
              )}

              <button
                onClick={handleCloseModal}
                className="mt-4 w-full rounded-xl border border-slate-200 bg-emerald-600 py-3 text-sm font-semibold text-white transition hover:bg-emerald-700"
              >
                {t("Xong")}
              </button>
            </div>
          )
          }
        </div >

        {/* Footer sticky — Tạm tính + nút "Để trợ lý đặt giúp" luôn hiển thị (kể cả khi
            content trong popup dài tràn). Trước đây nút nằm trong vùng scroll → user
            phải cuộn xuống mới thấy, dễ tưởng popup bị cắt. */}
        {
          phase === "form" && (
            <div className="border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur-sm">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-medium text-slate-800">{t("Tạm tính")}</span>
                <span className="text-lg font-bold text-emerald-600">{formatMoney(total, storeCurrency(activeOffer.store.id))}</span>
              </div>
              <button
                disabled={!canStart || (isCoopReal || isBHXReal ? coopBusy : false)}
                onClick={() => {
                  flushProfile({ name, phone, address });
                  // Thẻ mới đủ thông tin + tick "Lưu thẻ" → nhớ lại cho lần sau (localStorage, không rời máy).
                  if (demoPayMethod === "card" && !usingSavedCard && cardSaved && cardNum.replace(/\s/g, "").length >= 12 && /^\d{2}\/\d{2}$/.test(cardExp)) {
                    saveCard({ number: cardNum, name: name.trim().toUpperCase(), exp: cardExp, brand: null });
                  }
                  // Snapshot: thẻ đã đủ ngay ở form → bước thẻ tự chạy, không hỏi nhập lại.
                  setCardConfirmed(demoPayMethod === "card" && cardReady);
                  if (isTXNNReal) {
                    void createSession();
                  } else if (isCoopReal) {
                    void startCoopOrder();
                  } else if (isBHXReal) {
                    startBHXOrder().catch((err) => {
                      console.error("Bach Hoa Xanh order error:", err);
                      alert(err instanceof Error ? err.message : String(err));
                    });
                  } else {
                    setStepIndex(0);
                    setOtp("");
                    setOtpError(false);
                    setSimOtp("");
                    setPhase("running");
                  }
                }}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-emerald-600 py-3 text-sm font-semibold text-white shadow-[0_4px_14px_rgba(16,185,129,0.35),inset_0_1px_0_rgba(255,255,255,0.25)] transition-all duration-150 hover:bg-emerald-700 active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500 disabled:shadow-none disabled:hover:bg-slate-300"
              >
                {isTXNNReal && submitting
                  ? t("Đang tạo phiên đặt hàng…")
                  : coopBusy
                    ? t("Đang kết nối Co.op…")
                    : isCoopReal
                      ? t("Kết nối Co.op và thêm vào giỏ →")
                      : t("Để trợ lý đặt giúp →")}
              </button>
              {!canStart && (
                <p className="mt-1.5 text-center text-xs text-slate-400">
                  {isCoopReal
                    ? t("Nhập đủ tên, số điện thoại, địa chỉ và đảm bảo đơn Co.op từ 200.000đ.")
                    : payTabsShown && demoPayMethod === null && name.trim() && phoneValid && address.trim()
                      ? t("Chọn phương thức thanh toán để tiếp tục.")
                      : t("Nhập đủ tên, số điện thoại và địa chỉ để bắt đầu.")}
                </p>
              )}
            </div>
          )
        }
      </div >

      {popupViewerOpen && serverState?.popup && popupFrameSrc && (
        <div
          className="fixed inset-0 z-[1200] flex items-center justify-center bg-slate-950/75 p-3 sm:p-6"
          role="dialog"
          aria-modal="true"
          aria-label={serverState.popup.title || t("Popup thanh toán")}
          onClick={() => setPopupViewerOpen(false)}
        >
          <div
            className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-slate-900 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 border-b border-white/10 px-4 py-3 text-white">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-emerald-300">
                  {serverState.popup.title || t("Popup thanh toán thật")}
                </p>
                <p className="mt-1 text-xs text-white/70">
                  {t("Ảnh bên dưới là vùng popup đang được worker cast ra. Click trực tiếp để thao tác trên website thật.")}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="rounded-full bg-emerald-500/15 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-emerald-300">
                  popup-focus
                </span>
                <button
                  type="button"
                  onClick={() => setPopupViewerOpen(false)}
                  className="rounded-full p-1.5 text-white/70 transition hover:bg-white/10 hover:text-white"
                  aria-label={t("Đóng popup lớn")}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M18 6 6 18M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-auto px-3 py-3 sm:px-5 sm:py-4">
              <div className="flex min-h-full flex-col gap-4 lg:flex-row">
                <div className="flex min-h-[320px] flex-1 items-center justify-center rounded-2xl border border-white/10 bg-black/20 p-2 sm:p-4">
                  <img
                    src={popupFrameSrc}
                    alt={serverState.popup.title || t("Popup thanh toán")}
                    className="max-h-[78vh] w-auto max-w-full cursor-crosshair rounded-xl border border-slate-700 bg-white object-contain"
                    onClick={handlePopupFrameClick}
                  />
                </div>

                <div className="w-full shrink-0 space-y-3 lg:w-80">
                  {serverState.popup.text && (
                    <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/85">
                      {serverState.popup.text}
                    </div>
                  )}

                  {serverState.popup.actions.length > 0 && (
                    <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/70">
                      <p className="font-semibold text-white/85">{t("Nút phát hiện trong popup")}</p>
                      <p className="mt-1 leading-relaxed">{serverState.popup.actions.join(" · ")}</p>
                    </div>
                  )}

                  <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-100">
                    {t("Mẹo: popup này đã được phóng to, nhưng click vẫn map theo đúng tỷ lệ về popup thật trên website nguồn.")}
                  </div>

                  <div className="space-y-2">
                    {!popupShowingQr && (
                      <button
                        type="button"
                        onClick={() => void switchPopupView("qr")}
                        className="w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2.5 text-sm font-semibold text-white transition hover:bg-white/10"
                      >
                        {t("Hiện lại mã QR")}
                      </button>
                    )}
                    {popupShowingQr && (
                      <button
                        type="button"
                        onClick={() => void switchPopupView("confirm")}
                        className="w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2.5 text-sm font-semibold text-white transition hover:bg-white/10"
                      >
                        {t("Tôi đã thanh toán xong, xuống nút xác nhận")}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => void submitPaymentConfirmed()}
                      disabled={paymentConfirmBusy || popupShowingQr}
                      className="w-full rounded-lg bg-emerald-500 px-3 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-emerald-200"
                    >
                      {paymentConfirmBusy ? t("Đang kiểm tra thanh toán...") : t("Đã bấm xác nhận xong, bắt đầu kiểm tra")}
                    </button>
                    <a
                      href={serverState.handoffUrl || activeOffer.productUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="block w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2.5 text-center text-sm font-semibold text-white transition hover:bg-white/10"
                    >
                      {t("Mở trang nguồn")}
                    </a>
                    <button
                      type="button"
                      onClick={() => setPopupViewerOpen(false)}
                      className="w-full rounded-lg border border-white/15 bg-transparent px-3 py-2.5 text-sm font-semibold text-white/80 transition hover:bg-white/10 hover:text-white"
                    >
                      {t("Thu nhỏ về modal chính")}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* tiện ích style cho input/select/textarea dùng chung */}
      <style jsx global>{`
        .bhx-delivery-html {
          color: #020617;
          font-size: 0.875rem;
        }
        .bhx-delivery-html > div {
          position: static !important;
          z-index: auto !important;
          margin-top: 0 !important;
          max-height: none !important;
          overflow: visible !important;
          border-radius: 0.5rem;
          background: #ffffff;
        }
        .bhx-delivery-html > * {
          max-width: 100%;
        }
        .bhx-delivery-html div,
        .bhx-delivery-html label {
          box-sizing: border-box;
        }
        .bhx-delivery-html .flex {
          display: flex;
        }
        .bhx-delivery-html .flex-col {
          flex-direction: column;
        }
        .bhx-delivery-html .flex-wrap {
          flex-wrap: wrap;
        }
        .bhx-delivery-html .flex-nowrap {
          flex-wrap: nowrap;
        }
        .bhx-delivery-html .items-center {
          align-items: center;
        }
        .bhx-delivery-html .justify-between {
          justify-content: space-between;
        }
        .bhx-delivery-html .justify-start {
          justify-content: flex-start;
        }
        .bhx-delivery-html .gap-1 {
          gap: 0.25rem;
        }
        .bhx-delivery-html .gap-2 {
          gap: 0.5rem;
        }
        .bhx-delivery-html .w-full {
          width: 100%;
        }
        .bhx-delivery-html .overflow-hidden {
          overflow: hidden;
        }
        .bhx-delivery-html .overflow-auto {
          overflow: auto;
        }
        .bhx-delivery-html .whitespace-nowrap {
          white-space: nowrap;
        }
        .bhx-delivery-html .select-none {
          user-select: none;
        }
        .bhx-delivery-html .text-right {
          text-align: right;
        }
        .bhx-delivery-html .font-bold,
        .bhx-delivery-html b {
          font-weight: 700;
        }
        .bhx-delivery-html .relative {
          position: relative;
        }
        .bhx-delivery-html .inline-block {
          display: inline-block;
        }
        .bhx-delivery-html .bg-basic-100 {
          background: #f4f6f8;
        }
        .bhx-delivery-html .bg-white {
          background: #ffffff;
        }
        .bhx-delivery-html .text-basic-800,
        .bhx-delivery-html .text-\\[\\#222B45\\] {
          color: #0f172a;
        }
        .bhx-delivery-html .text-primary-400,
        .bhx-delivery-html .\\!text-\\[\\#FF7B01\\] {
          color: #059669;
        }
        .bhx-delivery-html .border,
        .bhx-delivery-html .border-basic-400 {
          border: 1px solid #e2e8f0;
        }
        .bhx-delivery-html .rounded-md,
        .bhx-delivery-html .rounded-\\[8px\\] {
          border-radius: 0.5rem;
        }
        .bhx-delivery-html .p-2 {
          padding: 0.5rem;
        }
        .bhx-delivery-html .py-\\[10px\\] {
          padding-top: 10px;
          padding-bottom: 10px;
        }
        .bhx-delivery-html .px-3 {
          padding-left: 0.75rem;
          padding-right: 0.75rem;
        }
        .bhx-delivery-html .mx-2 {
          margin-left: 0.5rem;
          margin-right: 0.5rem;
        }
        .bhx-delivery-html .mr-2 {
          margin-right: 0.5rem;
        }
        .bhx-delivery-html .line-clamp-1,
        .bhx-delivery-html .line-clamp-2 {
          overflow: hidden;
          display: -webkit-box;
          -webkit-box-orient: vertical;
        }
        .bhx-delivery-html .line-clamp-1 {
          -webkit-line-clamp: 1;
        }
        .bhx-delivery-html .line-clamp-2 {
          -webkit-line-clamp: 2;
        }
        .bhx-delivery-html .radio-wrapper {
          position: relative;
          display: block;
          min-height: 48px;
          padding: 0.75rem 0.75rem 0.75rem 2.5rem !important;
          border-radius: 0.5rem;
          background: #ffffff;
        }
        .bhx-delivery-html .radio-wrapper input[type="radio"] {
          position: absolute;
          left: 0.75rem;
          top: 50%;
          width: 18px;
          height: 18px;
          transform: translateY(-50%);
        }
        .bhx-delivery-html .radio-wrapper .checkmark {
          display: none;
        }
        .bhx-delivery-html .no-scrollbar {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 0.5rem;
          overflow: visible;
          padding-bottom: 0.5rem;
        }
        .bhx-delivery-html [data-delivery-date] {
          border: 1px solid #e2e8f0;
          border-radius: 0.5rem;
          background: #ffffff;
          padding: 0.75rem;
          text-align: center;
          color: #0f172a;
        }
        .bhx-delivery-html [data-delivery-date]:first-child,
        .bhx-delivery-html .\\!border-primary-400 {
          border-color: #10b981;
          color: #059669;
        }
        .bhx-delivery-html label,
        .bhx-delivery-html [role="button"],
        .bhx-delivery-html button,
        .bhx-delivery-html input[type="radio"] {
          cursor: pointer;
        }
        .bhx-delivery-html input[type="radio"] {
          accent-color: #059669;
        }
        .bhx-delivery-html img,
        .bhx-delivery-html svg {
          max-width: 100%;
          height: auto;
        }
        .input {
          width: 100%;
          border-radius: 0.5rem;
          border: 1px solid rgba(255,255,255,0.4);
          background: rgba(255,255,255,0.35);
          backdrop-filter: blur(8px);
          -webkit-backdrop-filter: blur(8px);
          padding: 0.5rem 0.75rem;
          font-size: 0.875rem;
          color: #0f172a;
          outline: none;
          transition: border-color 0.15s, box-shadow 0.15s, background 0.15s;
        }
        .input::placeholder { color: rgba(100,116,139,0.7); }
        .input:focus {
          border-color: rgba(16,185,129,0.7);
          background: rgba(255,255,255,0.5);
          box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.18);
        }
        .coop-date-select {
          min-width: 240px;
          background-color: #ffffff;
          line-height: 1.25rem;
        }
      `}</style>
    </div >
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

function formatCoopDate(value: string) {
  const [year, month, day] = value.split("-");
  return year && month && day ? `${day}/${month}/${year}` : value;
}

function formatDateInput(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseSlotStartMinutes(value: string) {
  const [hour, minute] = value.split(":").map(Number);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return 0;
  return hour * 60 + minute;
}

function getEffectiveCoopDeliverySlots(
  slots: Array<{ from: string; to: string; disabled?: boolean }>,
  selectedDate: string,
) {
  if (!selectedDate || selectedDate !== formatDateInput(new Date())) return slots;
  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const earliestStartMinutes = currentMinutes + COOP_DELIVERY_LEAD_MINUTES;
  return slots.map((slot) => ({
    ...slot,
    disabled: slot.disabled || parseSlotStartMinutes(slot.from) <= earliestStartMinutes,
  }));
}

function coopStepRank(step: CoopStepId | "success") {
  const order: Array<CoopStepId | "success"> = ["account", "otp", "delivery", "payment", "review", "success"];
  const index = order.indexOf(step);
  return index >= 0 ? index : 0;
}

function getUnknownText(value: unknown) {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

function getCoopTerminalCode(terminal: CoopTerminalChoice | null | undefined) {
  return getUnknownText(terminal?.terminalCode) || getUnknownText(terminal?.code);
}

async function safeGeocode(address: string) {
  try {
    return await geocode(address);
  } catch {
    return null;
  }
}

function getCoopTerminalName(terminal: CoopTerminalChoice | null | undefined) {
  return (
    getUnknownText(terminal?.terminalName) ||
    getUnknownText(terminal?.name) ||
    getCoopTerminalCode(terminal) ||
    "Co.opmart"
  );
}

function getCoopTerminalAddress(terminal: CoopTerminalChoice | null | undefined) {
  return getUnknownText(terminal?.fullAddress) || getUnknownText(terminal?.address) || "Co.op Online";
}

function getCoopTerminalDistance(terminal: CoopTerminalChoice | null | undefined) {
  const raw = terminal?.distanceKm ?? terminal?.distance;
  const n = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(n) ? `${n.toFixed(1)} km` : "";
}

function getCoopTerminalNumber(terminal: CoopTerminalChoice | null | undefined, key: string) {
  const raw = terminal?.[key];
  const n = typeof raw === "number" ? raw : Number(getUnknownText(raw));
  return Number.isFinite(n) ? n : undefined;
}

function Row({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="shrink-0 text-slate-500">{k}</span>
      <span className={`text-right ${strong ? "font-bold text-emerald-600" : "font-medium text-slate-800"}`}>
        {v}
      </span>
    </div>
  );
}

function PauseBox({
  children,
  hint,
  tone,
}: {
  children: React.ReactNode;
  hint: string;
  tone: "blue" | "amber" | "emerald";
}) {
  const toneCls = {
    blue: "border-blue-200 bg-blue-50",
    amber: "border-amber-200 bg-amber-50",
    emerald: "border-emerald-200 bg-emerald-50",
  }[tone];
  return (
    <div className={`mt-2 rounded-xl border p-2.5 ${toneCls}`}>
      <p className="mb-2 text-xs text-slate-600">{hint}</p>
      {children}
    </div>
  );
}

function CheckIcon() {
  return (
    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-100">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 6 9 17l-5-5" />
      </svg>
    </span>
  );
}

function Spinner() {
  return (
    <span className="block h-5 w-5 animate-spin rounded-full border-2 border-emerald-200 border-t-emerald-600" />
  );
}

function PauseDot() {
  return <span className="block h-5 w-5 rounded-full border-2 border-dashed border-slate-300" />;
}
