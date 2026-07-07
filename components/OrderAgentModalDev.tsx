"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { RankedOffer } from "@/lib/types";
import { chainLabel, storeCurrency } from "@/lib/stores";
import { distanceKm, formatMoney } from "@/lib/util";
import { flushProfile, getProfile, saveProfile } from "@/lib/profile";
import { geocode } from "@/lib/geocode";
import { getOrderConfig } from "@/lib/orderConfig";
import { phoneRule } from "@/lib/phone";
import { type Lang, tr } from "@/lib/i18n";
import { MarqueeText } from "./MarqueeText";
import type { OrderRequiredInput, PublicOrderSessionState } from "@/lib/order-agent/types";

/**
 * BẢN GIẢ LẬP (mock) — không gọi web thật.
 * Mô phỏng "trợ lý ảo" tự thao tác đặt hàng trên web cửa hàng, và DỪNG LẠI
 * ở những bước chỉ con người làm được: nhập OTP, xác minh CAPTCHA, và bấm
 * xác nhận đặt hàng cuối cùng. Mục đích: cho thấy CƠ CHẾ pause → user nhập →
 * resume trước khi làm thật.
 */

type StepKind = "auto" | "otp" | "login" | "captcha" | "qr" | "confirm" | "success";
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

type CoopStepId = "account" | "otp" | "delivery" | "payment" | "review" | "paymentQr" | "paymentGateway" | "success";

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

type PaymentChoice = {
  code: string;
  name: string;
  description?: string;
  icon?: string;
  disabled?: boolean;
  maxTransactionAmount?: number;
  paymentMethodType?: string;
};

type CoopPayloadOverride = {
  terminalCode?: string;
  selectedTerminal?: CoopTerminalChoice | null;
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
const COOP_PAYMENT_ICONS: Record<string, string> = {
  COD: "https://lh3.googleusercontent.com/vzs07tUAXXmWYUJ1p-RWyjLRoJ6XJi1QtF-yaERNwjdPDK53lNkCbUoyU2pV2x5obGe7aCLBxMd9Y5Qv60KquH73zl3wZ3U7cA",
  VNPAY_GATEWAY_QR: "https://lh3.googleusercontent.com/gslmOSe5k3U9zFW6KMKAufCG0aMNlA8yxaqqVXrLGrx9OlI75ojG3zE_2DsJtpxBHoE87kcPfdIVB11VmUKVBEErN_uDrLaXlw",
  VNPAY_GATEWAY_MOBILE_BANKING: "https://lh3.googleusercontent.com/CzNJ4ZEkhLTIgsyyux1IVi6TfNyoUAQyWmVk-0sVjGI4diP1uH3YoxHY4R6JsKsp6GZ9sDT9WJqeMU8gPHl58lT3v7vIkwcR",
  VNPAY_GATEWAY_ATM: "https://lh3.googleusercontent.com/tbPtyOQO_hC6pB5ONVlsX-dtr2YektoIEhlxKoggGOIRe3j9MsaDCQiIqnKQENvlF0DyCMWu1GaShvfncEkelrSg-7OZP6uK",
  VNPAY_GATEWAY_INTERNATIONAL_CARD: "https://lh3.googleusercontent.com/3lUKQWHdrRxuggI3RPQFFw3MvGSzylpx0zkzt1kTGsCApNfePiSGi1VUPs674q1QZQAjNkJAlkVy8wH60uBvUDJGHGlvHA67UQ",
  MOMO_GATEWAY: "https://lh3.googleusercontent.com/6XbFLBLDoji7E2Y544SocPUkP4QKPU0p8AVe7qaS79hXSJ8FMVOn9Q6iOMY4CamYLe7dmU2bmmAC8MJvy2vgWGpRVmVd4_c",
};
const COOP_HEADLESS_QR_PAYMENT_CODES = new Set(["VNPAY_GATEWAY_QR", "MOMO_GATEWAY"]);
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

async function getAgentWsUrl(sessionId: string) {
  const baseUrl = process.env.NEXT_PUBLIC_ORDER_AGENT_SERVER_URL || "ws://localhost:8080";
  const separator = baseUrl.includes("?") ? "&" : "?";
  try {
    const res = await fetch(`/api/agent/token?sessionId=${sessionId}`);
    if (res.ok) {
      const data = await res.json();
      if (data.token) {
        return `${baseUrl}${separator}sessionId=${sessionId}&timestamp=${data.timestamp}&token=${data.token}`;
      }
    }
  } catch (err) {
    console.error("Error fetching agent token:", err);
  }
  return `${baseUrl}${separator}sessionId=${sessionId}`;
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
  onPlaced: (orderCode: string, chosen: RankedOffer) => void;
  lang?: Lang;
}) {
  const t = (vi: string, vars?: Record<string, string | number>) => tr(lang, vi, vars);
  const [phase, setPhase] = useState<"form" | "running" | "done">("form");

  // Nơi mua đang chọn — user có thể đổi nếu địa chỉ giao khác vị trí định vị.
  const [activeOffer, setActiveOffer] = useState<RankedOffer>(offer);
  const chain = chainLabel(activeOffer.store.chain);
  // Mỗi nguồn cần thông tin/đăng nhập khác nhau → form + các bước chạy theo đó.
  const cfg = useMemo(() => getOrderConfig(activeOffer.store.chain), [activeOffer.store.chain]);
  const isCoopReal = activeOffer.store.chain === "coop";
  const isTXNNReal = activeOffer.store.chain === "tuoixanhnhanhngon";
  const isBHXReal = activeOffer.store.chain === "bhx";

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
  const [password, setPassword] = useState("");
  const [qty, setQty] = useState(defaultQty && defaultQty > 0 ? Math.floor(defaultQty) : 1);
  const [slot, setSlot] = useState(SLOTS[0]);
  const [coopDeliveryDate, setCoopDeliveryDate] = useState("");
  const [coopSlotFrom, setCoopSlotFrom] = useState("");
  const [coopSlotTo, setCoopSlotTo] = useState("");

  // Khoá scroll body khi modal mở
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

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
  const [coopPaymentQrImage, setCoopPaymentQrImage] = useState("");
  const [coopPaymentQrContentType, setCoopPaymentQrContentType] = useState("image/jpeg");
  const [coopPaymentQrUrl, setCoopPaymentQrUrl] = useState("");
  const [coopPaymentQrStatus, setCoopPaymentQrStatus] = useState("");
  const [coopPaymentQrBusy, setCoopPaymentQrBusy] = useState(false);
  const [coopAddressBusy, setCoopAddressBusy] = useState(false);
  const [coopAddressChecked, setCoopAddressChecked] = useState(false);
  const [coopLocationsBusy, setCoopLocationsBusy] = useState(false);
  const [coopProvinces, setCoopProvinces] = useState<CoopLocationOption[]>([]);
  const [coopDistricts, setCoopDistricts] = useState<CoopLocationOption[]>([]);
  const [coopWards, setCoopWards] = useState<CoopLocationOption[]>([]);
  const [coopTerminals, setCoopTerminals] = useState<CoopTerminalChoice[]>([]);
  const [coopSelectedTerminalCode, setCoopSelectedTerminalCode] = useState("");
  const [coopSelectedPaymentCode, setCoopSelectedPaymentCode] = useState("COD");
  const [prototypePaymentCode, setPrototypePaymentCode] = useState("COD");
  const [paymentPickerOpen, setPaymentPickerOpen] = useState(false);
  const [cardDraft, setCardDraft] = useState({
    holder: "",
    number: "",
    expiry: "",
    securityCode: "",
  });
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
  const autoPrepareCoopCheckoutRef = useRef(false);
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

    // Đăng nhập/định danh — khác nhau theo từng nguồn.
    if (cfg.auth === "guest-phone") {
      s.push({ kind: "auto", label: t("Điền số điện thoại {phone} (mua nhanh, không cần đăng nhập)…", { phone: phone || t("(của bạn)") }) });
    } else if (cfg.auth === "phone-otp") {
      s.push({ kind: "auto", label: t("Nhập số điện thoại {phone}…", { phone: phone || t("(của bạn)") }) });
      s.push({ kind: "otp", label: t("{chain} gửi mã OTP về {phone}", { chain, phone: phone || t("điện thoại của bạn") }) });
    } else {
      s.push({ kind: "login", label: t("Đăng nhập tài khoản {chain}{email}", { chain, email: cfg.needEmail ? ` (${email || t("email của bạn")})` : "" }) });
    }

    s.push({ kind: "auto", label: t('Thêm "{name}" vào giỏ (SL {qty})…', { name: activeOffer.product.name, qty }) });

    if (cfg.needStorePick) {
      s.push({ kind: "auto", label: t("Chọn điểm giao: {store}…", { store: activeOffer.store.name }) });
    }

    s.push({ kind: "auto", label: t("Điền địa chỉ giao: {address}…", { address: address || t("(địa chỉ của bạn)") }) });

    if (cfg.needEmail) {
      s.push({ kind: "auto", label: t("Điền email nhận hoá đơn: {email}…", { email: email || t("(email của bạn)") }) });
    }

    if (cfg.needSlot) {
      s.push({ kind: "auto", label: t('Chọn khung giờ "{slot}"…', { slot: t(slot) }) });
    }

    s.push({ kind: "auto", label: t("Chọn thanh toán COD…") });

    if (cfg.captcha) {
      s.push({ kind: "captcha", label: t('{chain} yêu cầu xác minh "Tôi không phải robot"', { chain }) });
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
      onPlaced(serverState.orderCode, activeOffer);
      return;
    }
    if (["failed", "cancelled", "expired"].includes(serverState.status)) {
      setSubmitError(serverState.error || serverState.message);
    }
  }, [serverState, phase, stepIndex, current, activeOffer, onPlaced, simOtp]);

  const total = activeOffer.price * qty;
  const coopMinTotal = 200000;
  const coopBelowMinimum = isCoopReal && total < coopMinTotal;
  const todayInput = formatDateInput(new Date());
  const tomorrowInput = formatDateInput(addDays(new Date(), 1));
  const coopDeliveryDates = (coopResult?.deliveryCheck?.availableDates ?? []).filter((date) => date >= todayInput);
  const coopFallbackDeliveryDates = [todayInput, tomorrowInput];
  const coopDeliverySlots =
    (coopDeliveryDate ? coopResult?.deliveryCheck?.availableSlotsByDate?.[coopDeliveryDate] : undefined) ??
    coopResult?.deliveryCheck?.availableTimeSlots ??
    [];
  const visibleCoopDeliveryDates = Array.from(
    new Set([...(coopDeliveryDates.length ? coopDeliveryDates : []), ...coopFallbackDeliveryDates]),
  ).filter((date) => date >= todayInput).sort();
  const visibleCoopDeliveryDate = coopDeliveryDate || visibleCoopDeliveryDates[0] || todayInput;
  const visibleCoopDeliverySlots = getEffectiveCoopDeliverySlots(
    coopDeliverySlots.length ? coopDeliverySlots : COOP_TIME_SLOTS,
    visibleCoopDeliveryDate,
  );
  const firstAvailableCoopSlot = visibleCoopDeliverySlots.find((item) => !item.disabled) ?? visibleCoopDeliverySlots[0];
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
    selectedCoopPaymentMethod?.paymentMethodType === "online" ||
    Boolean(selectedCoopPaymentMethod?.methodCode && selectedCoopPaymentMethod.methodCode !== "COD") ||
    Boolean(coopSelectedPaymentCode && coopSelectedPaymentCode !== "COD");
  const fallbackPaymentChoices: PaymentChoice[] = isCoopReal
    ? [
      { code: "COD", name: t("COD (tiền mặt khi nhận)"), description: t("Thanh toán khi nhận hàng"), icon: COOP_PAYMENT_ICONS.COD },
      { code: "VNPAY_GATEWAY_QR", name: t("Thanh toán VNPAY-QR"), description: t("Hiển thị mã QR sau khi tạo đơn"), icon: COOP_PAYMENT_ICONS.VNPAY_GATEWAY_QR },
      { code: "MOMO_GATEWAY", name: t("Ví MoMo hoặc Chuyển khoản"), description: t("Mở trang thanh toán ví/chuyển khoản"), icon: COOP_PAYMENT_ICONS.MOMO_GATEWAY },
      { code: "VNPAY_GATEWAY_ATM", name: t("ATM nội địa"), description: t("Chọn ngân hàng và nhập thông tin thanh toán"), icon: COOP_PAYMENT_ICONS.VNPAY_GATEWAY_ATM },
      { code: "VNPAY_GATEWAY_INTERNATIONAL_CARD", name: t("Thẻ thanh toán quốc tế"), description: t("Visa/Master/JCB"), icon: COOP_PAYMENT_ICONS.VNPAY_GATEWAY_INTERNATIONAL_CARD },
      { code: "VNPAY_GATEWAY_MOBILE_BANKING", name: t("Ứng dụng Mobile Banking"), description: t("Thanh toán qua Internet Banking"), icon: COOP_PAYMENT_ICONS.VNPAY_GATEWAY_MOBILE_BANKING },
    ]
    : [
      { code: "COD", name: t("COD (tiền mặt khi nhận)"), description: t("Thanh toán khi nhận hàng") },
      { code: "QR", name: t("QR chuyển khoản"), description: t("Affree sẽ hiển thị mã QR khi nguồn bán trả về") },
      { code: "MOMO_ZALOPAY", name: t("MoMo/ZaloPay"), description: t("Ví điện tử") },
      { code: "ATM_CARD", name: t("Thẻ ATM nội địa"), description: t("Nhập thông tin thẻ trước khi trợ lý chuyển tiếp") },
      { code: "CREDIT_CARD", name: t("Thẻ Visa/Master/JCB"), description: t("Nhập thông tin thẻ trước khi trợ lý chuyển tiếp") },
    ];
  const paymentChoices: PaymentChoice[] =
    isCoopReal && coopPaymentMethods.length > 0
      ? coopPaymentMethods.map((method) => ({
        code: method.methodCode || "",
        name: method.name || method.methodCode || t("Phương thức thanh toán"),
        description: method.description || undefined,
        icon: method.icon || COOP_PAYMENT_ICONS[method.methodCode || ""],
        disabled: Boolean(method.isDisabled),
        maxTransactionAmount: method.maxTransactionAmount,
        paymentMethodType: method.paymentMethodType,
      })).filter((method) => method.code)
      : fallbackPaymentChoices;
  const selectedPaymentCode = isCoopReal ? coopSelectedPaymentCode : prototypePaymentCode;
  const selectedPaymentChoice =
    paymentChoices.find((method) => method.code === selectedPaymentCode) ||
    paymentChoices.find((method) => method.code === "COD") ||
    paymentChoices[0];
  const coopSelectedPaymentUsesHeadlessQr = COOP_HEADLESS_QR_PAYMENT_CODES.has(coopSelectedPaymentCode);
  const paymentRequiresCardInput = Boolean(selectedPaymentChoice?.code && (
    selectedPaymentChoice.code.includes("CARD") ||
    selectedPaymentChoice.code.includes("ATM") ||
    selectedPaymentChoice.code.includes("INTERNATIONAL")
  ));
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
  const updateCoopPrototypeAddress = (value: string) => {
    setAddress(value);
    const parsed = parseCoopAddressParts(value);
    setCoopAddressLine(parsed.addressLine || value);
    setCoopProvinceCode(parsed.provinceCode);
    setCoopProvinceName(parsed.provinceName);
    setCoopDistrictCode(parsed.districtCode);
    setCoopDistrictName(parsed.districtName);
    setCoopWardCode(parsed.wardCode);
    setCoopWardName(parsed.wardName);
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
  const passwordError = isCoopReal && password.length > 0 && password.length < 6;
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
    password.length >= 6 &&
    coopStructuredAddressReady &&
    coopAddressChecked &&
    !!coopTerminalCode &&
    !coopBelowMinimum &&
    qty > 0;
  const coopPrototypeCanStart =
    !!name.trim() &&
    phoneValid &&
    password.length >= 6 &&
    coopStructuredAddressReady &&
    !coopBelowMinimum &&
    qty > 0;
  const canStart =
    !!name.trim() &&
    phoneValid &&
    !!address.trim() &&
    (!cfg.needEmail || emailValid) &&
    (!isCoopReal || coopCanStart);

  const usesQrPayment =
    isTXNNReal ||
    isBHXReal ||
    steps.some((item) => item.kind === "qr") ||
    serverState?.status === "waiting_for_qr_payment" ||
    serverState?.status === "verifying_payment";
  const paymentLabel = selectedPaymentChoice?.name || (usesQrPayment ? t("QR chuyển khoản") : t("COD (tiền mặt khi nhận)"));
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
    closeCoopBrowser();
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

  const coopPayload = (override?: CoopPayloadOverride) => {
    const terminalForPayload = override?.selectedTerminal ?? selectedCoopTerminal;
    const terminalCodeForPayload = override?.terminalCode || coopTerminalCode;
    return {
      phone: phoneDigits,
      password,
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
      terminalCode: terminalCodeForPayload,
      allowPasswordLogin: true,
      terminalName: terminalForPayload ? getCoopTerminalName(terminalForPayload) : activeOffer.store.name,
      terminalAddress: terminalForPayload ? getCoopTerminalAddress(terminalForPayload) : activeOffer.store.address,
      fullAddress: address,
      siteId: getCoopTerminalNumber(terminalForPayload, "siteId"),
      terminalId: terminalForPayload?.terminalId,
      lat: coopGeo?.lat,
      lng: coopGeo?.lng,
    };
  };

  const applyCoopDeliverySelection = (data: CoopOrderResult) => {
    const dates = (data.deliveryCheck?.availableDates ?? []).filter((date) => date >= todayInput);
    const selectedDate = data.deliveryCheck?.selectedDate && data.deliveryCheck.selectedDate >= todayInput
      ? data.deliveryCheck.selectedDate
      : coopDeliveryDate && (!dates.length || dates.includes(coopDeliveryDate))
        ? coopDeliveryDate
        : dates[0] || coopDeliveryDate || todayInput;
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
      candidateSlots.find((item) => item.from === coopSlotFrom && item.to === coopSlotTo && !item.disabled) ??
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
    const apiSelectedPaymentCode = data.paymentCheck?.selectedMethodCode || "COD";
    const requestedPaymentCode = coopSelectedPaymentCode || prototypePaymentCode || apiSelectedPaymentCode;
    const availablePaymentCodes = new Set([
      ...(data.paymentCheck?.methods ?? []).map((method) => method.methodCode).filter(Boolean),
      ...fallbackPaymentChoices.map((method) => method.code).filter(Boolean),
    ]);
    const nextPaymentCode =
      requestedPaymentCode && availablePaymentCodes.has(requestedPaymentCode)
        ? requestedPaymentCode
        : apiSelectedPaymentCode;

    setCoopResult(data);
    setCoopFlowId("");
    setOtp("");
    setCoopCheckoutPrepared(false);
    setCoopStep("delivery");
    setStepIndex(2);
    setCoopSelectedPaymentCode(nextPaymentCode);
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
    const wsUrl = await getAgentWsUrl(wsSessionId);
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

  const startCoopOrder = async (payloadOverride?: CoopPayloadOverride) => {
    setCoopBusy(true);
    setCoopError("");
    setCoopResult(null);
    setCoopFlowId("");
    setCoopCheckoutPrepared(false);
    setCoopStep("account");
    setCoopBrowserVisible(false);
    setCoopBrowserFrame("");
    setCoopBrowserStatus("");
    setCoopPaymentQrImage("");
    setCoopPaymentQrContentType("image/jpeg");
    setCoopPaymentQrUrl("");
    setCoopPaymentQrStatus("");
    setCoopPaymentQrBusy(false);
    coopCompletionHandledRef.current = false;
    autoPrepareCoopCheckoutRef.current = false;
    setOtp("");
    setOrderCode("");
    setPhase("running");
    setStepIndex(0);
    try {
      const data = await postCoopOrder({ action: "register", ...coopPayload(payloadOverride) });
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
      closeCoopBrowser();
    } catch (err) {
      setCoopError(err instanceof Error ? err.message : String(err));
    } finally {
      setCoopBusy(false);
    }
  };

  useEffect(() => {
    if (!isCoopReal || phase !== "running" || coopStep !== "delivery") return;
    if (!coopResult?.checkoutFlowId || coopCheckoutPrepared || coopBusy || !coopDeliveryReady) return;
    if (autoPrepareCoopCheckoutRef.current) return;
    autoPrepareCoopCheckoutRef.current = true;
    void prepareCoopCheckout();
  }, [
    isCoopReal,
    phase,
    coopStep,
    coopResult?.checkoutFlowId,
    coopCheckoutPrepared,
    coopBusy,
    coopDeliveryReady,
    coopDeliveryDate,
    coopSlotFrom,
    coopSlotTo,
    coopSelectedPaymentCode,
  ]);

  const placeCoopOrder = async () => {
    if (!coopResult?.checkoutFlowId || !coopCheckoutPrepared) return;
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
        const nextResult = { ...(coopResult ?? {}), ...data, paymentUrl };
        if (coopSelectedPaymentUsesHeadlessQr) {
          setCoopStep("paymentQr");
          openCoopPaymentQrSnapshot(nextResult);
        } else {
          setCoopStep("paymentGateway");
          setCoopBrowserStatus(t("Đang mở màn hình thanh toán để bạn hoàn tất giao dịch..."));
          openCoopBrowserAssist(nextResult, "paymentScreen");
        }
        return;
      }
      if (coopSelectedPaymentIsOnline) {
        throw new Error(t("Co.op đã tạo đơn nhưng chưa trả link thanh toán online. Vui lòng gửi log response để kiểm tra tiếp."));
      }
      setOrderCode(code);
      closeCoopBrowser();
      setCoopStep("success");
      setPhase("done");
      onPlaced(code, activeOffer);
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

  const openCoopPaymentQrSnapshot = async (nextResult?: CoopOrderResult) => {
    const result = nextResult ?? coopResult;
    const paymentUrl = result?.paymentUrl || result?.order?.paymentUrl;
    if (!paymentUrl) {
      setCoopError(t("Co.op đã tạo đơn nhưng chưa trả link thanh toán online. Vui lòng thử lại."));
      return;
    }

    setCoopBrowserVisible(false);
    setCoopBrowserFrame("");
    setCoopBrowserStatus("");
    setCoopPaymentQrImage("");
    setCoopPaymentQrContentType("image/jpeg");
    setCoopPaymentQrUrl(paymentUrl);
    setCoopPaymentQrStatus(t("Đang lấy mã QR thanh toán từ VNPAY..."));
    setCoopPaymentQrBusy(true);

    try {
      coopBrowserWsRef.current?.close();
      const wsSessionId = `coop-qr-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
      const wsUrl = await getAgentWsUrl(wsSessionId);
      const ws = new WebSocket(wsUrl);
      coopBrowserWsRef.current = ws;
      let opened = false;
      let commandAcknowledged = false;
      let commandAttempts = 0;
      let lastCommandAt = 0;
      let commandRetry = 0;
      let connectionTimeout = 0;

      const clearQrTimers = () => {
        if (connectionTimeout) window.clearTimeout(connectionTimeout);
        if (commandRetry) window.clearInterval(commandRetry);
        connectionTimeout = 0;
        commandRetry = 0;
      };

      const markCommandAcknowledged = () => {
        commandAcknowledged = true;
        if (commandRetry) {
          window.clearInterval(commandRetry);
          commandRetry = 0;
        }
      };

      const sendOpenCommand = () => {
        if (ws.readyState !== WebSocket.OPEN || commandAcknowledged || commandAttempts >= 12) return;
        commandAttempts += 1;
        lastCommandAt = Date.now();
        if (commandAttempts > 1) {
          setCoopPaymentQrStatus(t("Đang gửi lại lệnh lấy mã QR thanh toán..."));
        }
        ws.send(JSON.stringify({
          type: "coop_payment_qr_snapshot",
          paymentUrl,
          orderCode: result?.order?.code || result?.order?.orderId || orderCode,
          paymentMethodCode: result?.order?.paymentMethodCode || coopSelectedPaymentCode,
          paymentMethodName: coopSelectedPaymentName,
        }));
      };

      connectionTimeout = window.setTimeout(() => {
        if (ws.readyState !== WebSocket.OPEN) {
          setCoopPaymentQrStatus(t("Chưa thấy agent-server. Chạy `npm run agent-server` rồi thử lại."));
          setCoopPaymentQrBusy(false);
          ws.close();
        }
      }, 2500);

      ws.onopen = () => {
        opened = true;
        window.clearTimeout(connectionTimeout);
        setCoopPaymentQrStatus(t("Đã kết nối agent-server, đang mở trang thanh toán để lấy QR..."));
        sendOpenCommand();
        commandRetry = window.setInterval(() => {
          if (commandAcknowledged || ws.readyState !== WebSocket.OPEN) return;
          if (commandAttempts >= 12) {
            setCoopPaymentQrBusy(false);
            setCoopPaymentQrStatus(t("Agent-server chưa nhận lệnh lấy mã QR. Vui lòng thử lại."));
            window.clearInterval(commandRetry);
            commandRetry = 0;
            ws.close();
            return;
          }
          if (Date.now() - lastCommandAt >= 1500) sendOpenCommand();
        }, 1000);
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(String(event.data)) as {
            type?: string;
            message?: string;
            status?: string;
            phase?: string;
            error?: string;
            orderCode?: string;
            orderUrl?: string;
            qrImageBase64?: string;
            qrContentType?: string;
            paymentUrl?: string;
            paymentMethodCode?: string;
            qrSource?: string;
          };
          if (message.type === "log" && message.message) {
            const logMessage = message.message;
            const normalizedLog = logMessage.toLowerCase();
            if (/khởi tạo trình duyệt|khoi tao trinh duyet|initialized browser/.test(normalizedLog)) {
              window.setTimeout(sendOpenCommand, 100);
            } else if (/mở trang thanh toán|mo trang thanh toan|lấy mã qr|lay ma qr|mã qr|ma qr|thanh toán|thanh toan|payment|co\.opmart/.test(normalizedLog)) {
              setCoopPaymentQrStatus(logMessage);
            }
            if (/mở trang thanh toán|mo trang thanh toan|lấy mã qr|lay ma qr/.test(normalizedLog)) {
              markCommandAcknowledged();
            }
          }
          if (message.type === "status" && message.phase === "coop_payment_qr_ready") {
            markCommandAcknowledged();
            if (message.qrImageBase64) {
              setCoopPaymentQrImage(`data:${message.qrContentType || "image/jpeg"};base64,${message.qrImageBase64}`);
              setCoopPaymentQrContentType(message.qrContentType || "image/jpeg");
            }
            if (message.paymentUrl) setCoopPaymentQrUrl(message.paymentUrl);
            if (message.orderCode) setOrderCode(message.orderCode);
            setCoopPaymentQrBusy(false);
            setCoopPaymentQrStatus(t("Mã QR đã sẵn sàng. Affree sẽ tự ghi nhận khi giao dịch thành công."));
          }
          if (message.type === "status" && message.phase === "failed") {
            markCommandAcknowledged();
            const reason = message.error ? String(message.error) : t("Không lấy được mã QR thanh toán.");
            setCoopPaymentQrBusy(false);
            setCoopPaymentQrStatus(reason);
            setCoopError(reason === "missing_payment_url" ? t("Co.op đã tạo đơn nhưng chưa trả link thanh toán online.") : reason);
          }
          if (message.type === "status" && message.phase === "coop_payment_failed") {
            markCommandAcknowledged();
            setCoopPaymentQrBusy(false);
            setCoopPaymentQrStatus(t("Giao dịch chưa thành công hoặc đã hủy. Bạn có thể chọn phương thức khác hoặc tạo lại đơn."));
            setCoopError(t("Thanh toán Co.op chưa hoàn tất. Vui lòng thử lại hoặc chọn phương thức thanh toán khác."));
          }
          if (message.type === "status" && message.phase === "completed" && !coopCompletionHandledRef.current) {
            markCommandAcknowledged();
            coopCompletionHandledRef.current = true;
            const code = message.orderCode || orderCode || `COOP-${Date.now().toString().slice(-6)}`;
            setOrderCode(code);
            setCoopPaymentQrBusy(false);
            setCoopPaymentQrStatus("");
            setCoopPaymentQrImage("");
            setCoopPaymentQrUrl("");
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
            onPlaced(code, activeOffer);
            ws.close();
          }
        } catch {
          // Ignore malformed frames from local agent server.
        }
      };

      ws.onerror = () => {
        clearQrTimers();
        setCoopPaymentQrBusy(false);
        setCoopPaymentQrStatus(t("Chưa kết nối được agent-server. Chạy `npm run agent-server` rồi thử lại."));
      };
      ws.onclose = () => {
        clearQrTimers();
        if (!opened) {
          setCoopPaymentQrBusy(false);
          setCoopPaymentQrStatus(t("Agent-server chưa chạy hoặc cổng 8080 chưa mở."));
        }
        if (coopBrowserWsRef.current === ws) coopBrowserWsRef.current = null;
      };
    } catch {
      setCoopPaymentQrBusy(false);
      setCoopPaymentQrStatus(t("Không lấy được mã QR thanh toán."));
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
    setCoopPaymentQrImage("");
    setCoopPaymentQrUrl("");
    setCoopPaymentQrStatus("");
    setCoopPaymentQrBusy(false);
    setCoopCheckoutPrepared(false);
    setCoopStep("payment");
  };

  const choosePaymentMethod = async (paymentMethodCode: string) => {
    if (!paymentMethodCode) return;
    if (isCoopReal) {
      if (coopPaymentMethods.length > 0) {
        await selectCoopPaymentMethod(paymentMethodCode);
      } else {
        setCoopSelectedPaymentCode(paymentMethodCode);
        setCoopCheckoutPrepared(false);
        setCoopStep("payment");
      }
    } else {
      setPrototypePaymentCode(paymentMethodCode);
    }
    setPaymentPickerOpen(false);
  };

  const startCoopFromPrototype = async () => {
    flushProfile({ name, phone, address });
    let payloadOverride: CoopPayloadOverride | undefined;
    if (!coopAddressChecked || !coopTerminalCode) {
      const lookup = await checkCoopAddress();
      if (!lookup) return;
      payloadOverride = {
        terminalCode: lookup.selectedCode,
        selectedTerminal: lookup.selectedTerminal,
      };
    }
    void startCoopOrder(payloadOverride);
  };

  const openCoopBrowserAssist = async (nextResult?: CoopOrderResult, mode: "checkout" | "profileSetup" | "paymentScreen" = "checkout") => {
    const result = nextResult ?? coopResult;
    setCoopBrowserVisible(false);
    setCoopBrowserStatus(t("Affree đang tự chuẩn bị checkout Co.op…"));
    setCoopBrowserFrame("");
    try {
      coopBrowserWsRef.current?.close();
      const wsSessionId = `coop-assist-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
      const wsUrl = await getAgentWsUrl(wsSessionId);
      const ws = new WebSocket(wsUrl);
      coopBrowserWsRef.current = ws;
      let opened = false;
      let receivedFrame = false;
      let commandAcknowledged = false;
      let canDisplayStream = false;
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
              password,
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
              password,
              checkoutUrl: result.checkoutUrl || "https://cooponline.vn/checkout",
              browserSession: result.browserSession,
            }
          : { type: "navigate", url: result?.checkoutUrl || result?.cartUrl || "https://cooponline.vn" };
      const revealCoopStream = () => {
        canDisplayStream = true;
        setCoopBrowserVisible(true);
      };
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
        if (opened && canDisplayStream && !receivedFrame) {
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
            if (!canDisplayStream) return;
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
              revealCoopStream();
              setCoopBrowserStatus(t("Màn hình Co.op đã sẵn sàng, bạn có thể click/gõ trực tiếp tại đây."));
            }
            if (message.phase === "coop_assist_manual") {
              revealCoopStream();
              setCoopBrowserStatus(t("Co.op cần bạn thao tác tiếp trên màn hình đang mở."));
            }
          }
          if (message.type === "status" && message.phase === "coop_payment_ready") {
            commandAcknowledged = true;
            window.clearInterval(commandRetry);
            revealCoopStream();
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
            onPlaced(code, activeOffer);
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
    if (!address.trim()) return null;
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
      const selectedTerminal =
        terminals.find((item) => getCoopTerminalCode(item) === selectedCode) ?? terminals[0] ?? null;
      setCoopTerminals(terminals);
      setCoopSelectedTerminalCode(selectedCode);
      setCoopAddressChecked(true);
      const matchingOffer = alternatives.find(
        (item) => item.store.chain === "coop" && item.store.id.replace(/^coop-/, "") === selectedCode,
      );
      if (matchingOffer) setActiveOffer(matchingOffer);
      return { selectedCode, selectedTerminal };
    } catch (err) {
      setCoopTerminals([]);
      setCoopSelectedTerminalCode("");
      setCoopError(err instanceof Error ? err.message : String(err));
      return null;
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

  // Nơi bán cùng món — nếu đã geocode được địa chỉ giao thì tính lại km theo đó.
  const choiceList = useMemo(() => {
    const list = alternatives.filter(
      (o) => o.inStock || o.store.id === activeOffer.store.id
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
  }, [alternatives, activeOffer.store.id, deliveryLoc]);

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

  const paymentSummaryCard = (
    <button
      type="button"
      onClick={() => setPaymentPickerOpen(true)}
      className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-left transition hover:border-emerald-200 hover:bg-emerald-50/60"
    >
      <div className="flex items-start justify-between gap-3">
        <span className="shrink-0 text-sm font-semibold text-slate-700">{t("Thanh toán")}</span>
        <span className="min-w-0 text-right text-sm font-bold text-slate-900">{paymentLabel}</span>
      </div>
      <p className="mt-1 text-xs leading-5 text-slate-500">
        {isCoopReal
          ? t("{chain} hỗ trợ: {payments}. Chọn trước tại Affree, trợ lý sẽ chuyển đúng phương thức sang Co.op.", { chain, payments: cfg.payments.join(" · ") })
          : t("{chain} hỗ trợ: {payments}. Chọn trước tại Affree để trợ lý chuẩn bị đúng bước thanh toán.", { chain, payments: cfg.payments.join(" · ") })}
      </p>
    </button>
  );

  const paymentCardInputs = paymentRequiresCardInput ? (
    <div className="grid gap-2 rounded-xl border border-slate-200 bg-white p-3 sm:grid-cols-2">
      <Field label={t("Tên chủ thẻ")}>
        <input
          value={cardDraft.holder}
          onChange={(e) => setCardDraft((current) => ({ ...current, holder: e.target.value }))}
          placeholder={t("Nhập tên trên thẻ")}
          className="input"
          autoComplete="cc-name"
        />
      </Field>
      <Field label={t("Số thẻ")}>
        <input
          value={cardDraft.number}
          onChange={(e) => setCardDraft((current) => ({ ...current, number: e.target.value.replace(/[^\d\s]/g, "").slice(0, 23) }))}
          placeholder="•••• •••• •••• ••••"
          inputMode="numeric"
          className="input"
          autoComplete="cc-number"
        />
      </Field>
      <Field label={t("Hết hạn")}>
        <input
          value={cardDraft.expiry}
          onChange={(e) => setCardDraft((current) => ({ ...current, expiry: e.target.value.replace(/[^\d/]/g, "").slice(0, 5) }))}
          placeholder="MM/YY"
          inputMode="numeric"
          className="input"
          autoComplete="cc-exp"
        />
      </Field>
      <Field label={t("Mã bảo mật/PIN")}>
        <input
          value={cardDraft.securityCode}
          onChange={(e) => setCardDraft((current) => ({ ...current, securityCode: e.target.value.replace(/\D/g, "").slice(0, 6) }))}
          placeholder="•••"
          inputMode="numeric"
          type="password"
          className="input"
          autoComplete="cc-csc"
        />
      </Field>
    </div>
  ) : null;

  const paymentPickerModal = paymentPickerOpen ? (
    <div
      className="fixed inset-0 z-[2600] flex items-center justify-center bg-slate-950/45 p-4"
      role="dialog"
      aria-modal="true"
      onClick={(event) => {
        event.stopPropagation();
        setPaymentPickerOpen(false);
      }}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-white p-4 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-bold text-slate-900">{t("Chọn phương thức thanh toán")}</h3>
            <p className="mt-0.5 text-xs text-slate-500">{activeOffer.product.name}</p>
          </div>
          <button
            type="button"
            onClick={() => setPaymentPickerOpen(false)}
            className="rounded-full p-1.5 text-slate-400 hover:bg-slate-100"
            aria-label={t("Đóng")}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="mt-4 space-y-2">
          {paymentChoices.map((method) => {
            const selected = method.code === selectedPaymentCode;
            return (
              <button
                key={method.code}
                type="button"
                disabled={method.disabled || coopBusy}
                onClick={() => void choosePaymentMethod(method.code)}
                className={`flex min-h-[62px] w-full items-center gap-3 rounded-xl border px-3 py-2 text-left transition disabled:cursor-not-allowed disabled:opacity-45 ${selected
                  ? "border-emerald-500 bg-emerald-50 ring-1 ring-emerald-500"
                  : "border-slate-200 bg-white hover:border-slate-300"
                  }`}
              >
                {method.icon ? (
                  <img src={method.icon} alt="" className="h-8 w-8 shrink-0 rounded object-contain" />
                ) : (
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[10px] font-bold text-slate-600">
                    {method.code === "COD" ? "COD" : "PAY"}
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-slate-900">{method.name}</span>
                  {method.description && <span className="mt-0.5 block text-xs text-slate-500">{method.description}</span>}
                  {method.maxTransactionAmount ? (
                    <span className="mt-0.5 block text-[11px] text-slate-400">
                      {t("Tối đa")} {formatMoney(method.maxTransactionAmount, storeCurrency(activeOffer.store.id))}
                    </span>
                  ) : null}
                </span>
                <span className={`h-4 w-4 shrink-0 rounded-full border ${selected ? "border-emerald-500 bg-emerald-500 shadow-[inset_0_0_0_3px_white]" : "border-slate-300"}`} />
              </button>
            );
          })}
        </div>
      </div>
    </div>
  ) : null;

  if (isCoopReal) {
    const visibleStep = phase === "done" ? "success" : coopStep;
    const currentCoopRank = coopStepRank(visibleStep);
    const selectedSlotText =
      coopSlotFrom && coopSlotTo
        ? `${coopSlotFrom} - ${coopSlotTo}`
        : firstAvailableCoopSlot
          ? `${firstAvailableCoopSlot.from} - ${firstAvailableCoopSlot.to}`
          : t("Chưa chọn");
    const coopProgressItems = [
      t("Mở website Co.opmart..."),
      t("Nhập số điện thoại {phone}...", { phone: phoneDigits || phone }),
      t("Co.opmart gửi mã OTP về {phone}", { phone: phoneDigits || phone }),
      t("Thêm \"{product}\" vào giỏ (SL {qty})...", { product: activeOffer.product.name, qty }),
      t("Chọn điểm giao: {store}...", { store: activeOffer.store.name }),
      t("Điền địa chỉ giao: {address}...", { address: coopSavedAddress || address }),
      t("Chọn khung giờ \"{slot}\"...", { slot: selectedSlotText }),
      t("Chọn thanh toán {payment}...", { payment: paymentLabel }),
      t("Kiểm tra & xác nhận đơn hàng"),
      ...(coopSelectedPaymentUsesHeadlessQr ? [t("Hiển thị mã QR thanh toán")] : []),
      ...(coopSelectedPaymentIsOnline && !coopSelectedPaymentUsesHeadlessQr ? [t("Hoàn tất thanh toán tại VNPAY")] : []),
    ];
    const coopProgressIndex =
      phase === "done"
        ? coopProgressItems.length
        : coopStep === "paymentQr"
          ? coopPaymentQrImage
            ? coopProgressItems.length
            : Math.max(0, coopProgressItems.length - 1)
        : coopStep === "paymentGateway"
          ? Math.max(0, coopProgressItems.length - 1)
        : coopStep === "review"
          ? 8
          : coopStep === "payment"
            ? 7
            : coopStep === "delivery"
              ? 6
              : coopStep === "otp"
                ? 2
                : phase === "running"
                  ? 1
                  : 0;
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
        className="fixed inset-0 z-[2200] flex items-center justify-center p-4"
        role="dialog"
        aria-modal="true"
        style={{ background: "rgba(0,0,0,0.35)", backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)" }}
        onClick={handleCloseModal}
      >
        <div
          className="relative flex min-h-0 w-full flex-col overflow-hidden rounded-3xl"
          style={{
            width: hasCoopBrowser ? "min(98vw, 1500px)" : "min(96vw, 430px)",
            maxWidth: hasCoopBrowser ? 1500 : 430,
            height: hasCoopBrowser ? "min(90dvh, 860px)" : "min(90dvh, 820px)",
            maxHeight: "calc(100dvh - 24px)",
            display: "flex",
            flexDirection: "column",
            backdropFilter: "blur(24px) saturate(160%)",
            WebkitBackdropFilter: "blur(24px) saturate(160%)",
            backgroundColor: "rgba(255,255,255,0.88)",
            boxShadow: "0 0 0 1px rgba(255,255,255,0.5), 0 16px 48px rgba(0,0,0,0.18), inset 0 1px 0 rgba(255,255,255,0.7)",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="pointer-events-none absolute inset-x-0 top-0 h-20 rounded-t-3xl" style={{ background: "linear-gradient(170deg, rgba(255,255,255,0.38) 0%, rgba(255,255,255,0.06) 60%, rgba(255,255,255,0) 100%)" }} />
          <div className="relative flex items-center justify-between border-b border-white/20 px-4 py-3">
            <div className="min-w-0">
              <h2 className="truncate text-base font-bold text-slate-800">
                {phase === "done" ? t("Đã đặt hàng Co.op") : t("Phục vụ bởi Affree Agentic AI - AAAI")}
              </h2>
              <p className="truncate text-xs text-slate-600">
                {activeOffer.product.name} · {chain}
              </p>
            </div>
            <button onClick={handleCloseModal} className="rounded-full p-1.5 text-slate-400 hover:bg-slate-100" aria-label={t("Đóng")}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className={`coop-modal-body relative min-h-0 flex-1 overflow-hidden ${hasCoopBrowser ? "coop-modal-body--split" : "coop-modal-body--single"}`}>
            <div className={`coop-popup-scroll min-h-0 overscroll-contain ${hasCoopBrowser ? "coop-left-pane rounded-xl border border-slate-200 bg-white px-3 py-3" : "flex flex-col px-3 py-3"}`}>
              <div className="space-y-3">
                {!hasCoopBrowser && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50/70 px-3 py-2 text-xs leading-5 text-amber-900">
                    {t("Giao diện theo prototype: bạn kiểm tra thông tin tại Affree, trợ lý vẫn dùng luồng Co.op thật ở bước đặt hàng.")}
                  </div>
                )}

                {phase === "form" && (
                  <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3">
                    <div className="flex items-center gap-3">
                      {activeOffer.product.image ? (
                        <img
                          src={activeOffer.product.image}
                          alt={activeOffer.product.name}
                          className="h-14 w-14 shrink-0 rounded-lg bg-white object-contain"
                        />
                      ) : (
                        <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-sm font-bold text-emerald-700">
                          {qty}
                        </span>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="line-clamp-2 text-sm font-bold text-slate-900">{activeOffer.product.name}</p>
                        <p className="mt-0.5 truncate text-xs text-slate-500">{activeOffer.store.name}</p>
                        <p className="mt-1 text-base font-bold text-emerald-600">
                          {formatMoney(activeOffer.price, storeCurrency(activeOffer.store.id))}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="mb-1 text-[11px] font-semibold text-slate-400">{t("Số lượng")}</p>
                        <div className="flex items-center gap-2">
                          <button onClick={() => setQty((q) => Math.max(1, q - 1))} className="h-8 w-8 rounded-lg border border-slate-300 bg-white text-lg font-medium hover:bg-slate-100">−</button>
                          <span className="w-6 text-center text-sm font-semibold">{qty}</span>
                          <button onClick={() => setQty((q) => q + 1)} className="h-8 w-8 rounded-lg border border-slate-300 bg-white text-lg font-medium hover:bg-slate-100">+</button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {phase !== "form" && !hasCoopBrowser && (
                  <ol className="space-y-3">
                    {coopProgressItems.slice(0, Math.min(coopProgressItems.length, Math.max(3, coopProgressIndex + 1))).map((label, index) => {
                      const done = index < coopProgressIndex || phase === "done";
                      const active = index === coopProgressIndex && phase !== "done";
                      return (
                        <li key={`${index}-${label}`} className="flex items-start gap-3">
                          <span className="shrink-0">
                            {done ? <CheckIcon /> : active ? <Spinner /> : <PauseDot />}
                          </span>
                          <span className={`text-sm font-semibold leading-5 ${active ? "text-slate-800" : done ? "text-slate-400" : "text-slate-300"}`}>
                            {label}
                          </span>
                        </li>
                      );
                    })}
                  </ol>
                )}

                {phase === "form" && (
                  <>
                    <div className="rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-3 text-sm leading-6 text-slate-600">
                      <p className="font-bold text-slate-800">{t("Co.opmart yêu cầu để đặt món này:")}</p>
                      <p>• {t("Số điện thoại và mật khẩu Co.op")}</p>
                      <p>• {t("Địa chỉ giao đủ tỉnh/quận/phường/số nhà")}</p>
                      <p>• {t("Cửa hàng Co.op gần địa chỉ giao")}</p>
                      <p>• {t("Ngày nhận hàng và khung giờ giao hợp lệ")}</p>
                      <p className="mt-1 text-xs">{t("Freeship đơn từ 200.000đ trong bán kính 6km.")}</p>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field label={t("Người nhận")}>
                        <input
                          value={name}
                          onChange={(event) => setName(event.target.value)}
                          placeholder={t("Họ và tên")}
                          className="input"
                        />
                      </Field>

                      <Field label={t("Số điện thoại")}>
                        <input
                          value={phone}
                          onChange={(event) => setPhone(event.target.value)}
                          inputMode="tel"
                          placeholder={t("VD: 0901234567")}
                          aria-invalid={phoneError}
                          className="input"
                          style={phoneError ? { borderColor: "#ef4444" } : undefined}
                        />
                        {phoneError && <span className="mt-1 block text-xs text-rose-600">{t("Số điện thoại không hợp lệ.")}</span>}
                      </Field>
                    </div>

                    <Field label={t("Mật khẩu Co.op")}>
                      <input
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        type="password"
                        autoComplete="current-password"
                        placeholder={t("Mật khẩu tài khoản Co.op")}
                        aria-invalid={passwordError}
                        className="input"
                        style={passwordError ? { borderColor: "#ef4444" } : undefined}
                      />
                      {passwordError && (
                        <span className="mt-1 block text-xs text-rose-600">
                          {t("Mật khẩu Co.op cần tối thiểu 6 ký tự.")}
                        </span>
                      )}
                    </Field>

                    <div className="rounded-xl border border-slate-200 bg-white p-3">
                      <p className="text-sm font-bold text-slate-900">{t("Địa chỉ giao")}</p>
                      <div className="mt-3 grid gap-3 sm:grid-cols-2">
                        <Field label={t("Tỉnh/Thành phố")}>
                          <select
                            value={coopAddressParts.provinceCode}
                            onChange={(event) => {
                              const selected = coopProvinces.find((item) => item.code === event.target.value);
                              updateCoopAddress({
                                provinceCode: selected?.code || "",
                                provinceName: selected?.name || "",
                                districtCode: "",
                                districtName: "",
                                wardCode: "",
                                wardName: "",
                              });
                            }}
                            className="input"
                          >
                            <option value="">{t("Chọn tỉnh/thành phố")}</option>
                            {coopProvinces.map((item) => (
                              <option key={item.code} value={item.code}>{item.name}</option>
                            ))}
                          </select>
                        </Field>

                        <Field label={t("Quận/Huyện")}>
                          <select
                            value={coopAddressParts.districtCode}
                            onChange={(event) => {
                              const selected = coopDistricts.find((item) => item.code === event.target.value);
                              updateCoopAddress({
                                districtCode: selected?.code || "",
                                districtName: selected?.name || "",
                                wardCode: "",
                                wardName: "",
                              });
                            }}
                            className="input"
                            disabled={!coopAddressParts.provinceCode || coopLocationsBusy}
                          >
                            <option value="">{t("Chọn quận/huyện")}</option>
                            {coopDistricts.map((item) => (
                              <option key={item.code} value={item.code}>{item.name}</option>
                            ))}
                          </select>
                        </Field>

                        <Field label={t("Phường/Xã")}>
                          <select
                            value={coopAddressParts.wardCode}
                            onChange={(event) => {
                              const selected = coopWards.find((item) => item.code === event.target.value);
                              updateCoopAddress({
                                wardCode: selected?.code || "",
                                wardName: selected?.name || "",
                              });
                            }}
                            className="input"
                            disabled={!coopAddressParts.districtCode || coopLocationsBusy}
                          >
                            <option value="">{t("Chọn phường/xã")}</option>
                            {coopWards.map((item) => (
                              <option key={item.code} value={item.code}>{item.name}</option>
                            ))}
                          </select>
                        </Field>

                        <Field label={t("Số nhà, tên đường")}>
                          <input
                            value={coopAddressParts.addressLine}
                            onChange={(event) => updateCoopAddress({ addressLine: event.target.value })}
                            placeholder={t("Số nhà, ngõ, tên đường...")}
                            className="input"
                          />
                        </Field>
                      </div>
                    </div>

                    <div className="rounded-xl border border-emerald-100 bg-emerald-50/70 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-bold text-emerald-900">{t("Cửa hàng Co.op gần địa chỉ giao")}</p>
                        <span className="text-xs font-semibold text-emerald-700">
                          {coopTerminals.length ? t("{count} cửa hàng", { count: coopTerminals.length }) : t("Chưa chọn")}
                        </span>
                      </div>
                      <button
                        type="button"
                        disabled={!coopStructuredAddressReady || coopAddressBusy}
                        onClick={() => void checkCoopAddress()}
                        className="mt-3 w-full rounded-lg border border-emerald-200 bg-white px-3 py-2 text-sm font-semibold text-emerald-700 transition hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {coopAddressBusy ? t("Đang tìm cửa hàng gần nhất…") : t("Cập nhật lại cửa hàng gần nhất")}
                      </button>
                      {coopTerminals.length > 0 && (
                        <div className="coop-store-scroll mt-3 max-h-56 space-y-2 overflow-y-auto pr-1">
                          {coopTerminals.slice(0, 8).map((terminal) => {
                            const terminalCode = getCoopTerminalCode(terminal);
                            const selected = terminalCode === coopTerminalCode;
                            return (
                              <button
                                key={terminalCode}
                                type="button"
                                onClick={() => {
                                  setCoopSelectedTerminalCode(terminalCode);
                                  setCoopAddressChecked(true);
                                  setCoopCheckoutPrepared(false);
                                  const matchingOffer = alternatives.find(
                                    (item) => item.store.chain === "coop" && item.store.id.replace(/^coop-/, "") === terminalCode,
                                  );
                                  if (matchingOffer) setActiveOffer(matchingOffer);
                                }}
                                className={`w-full rounded-lg border px-3 py-2 text-left transition ${selected
                                  ? "border-emerald-500 bg-white ring-1 ring-emerald-500"
                                  : "border-emerald-100 bg-white/70 hover:border-emerald-300"
                                  }`}
                              >
                                <span className="flex items-start justify-between gap-3">
                                  <span className="min-w-0">
                                    <span className="block truncate text-sm font-bold text-slate-900">
                                      {getCoopTerminalName(terminal)}
                                    </span>
                                    <span className="mt-0.5 block text-xs leading-5 text-slate-500">
                                      {getCoopTerminalAddress(terminal)}
                                    </span>
                                  </span>
                                  <span className="shrink-0 text-xs font-bold text-emerald-700">
                                    {getCoopTerminalDistance(terminal)}
                                  </span>
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    <div className="rounded-xl border border-slate-200 bg-white p-3">
                      <p className="text-sm font-bold text-slate-900">{t("Ngày nhận hàng và khung giờ")}</p>
                      <div className="mt-3">
                        <Field label={t("Chọn ngày nhận hàng")}>
                          <select
                            value={visibleCoopDeliveryDate}
                            onChange={(event) => {
                              setCoopDeliveryDate(event.target.value);
                              setCoopSlotFrom("");
                              setCoopSlotTo("");
                              setCoopCheckoutPrepared(false);
                            }}
                            className="input"
                          >
                            {visibleCoopDeliveryDates.map((date) => (
                              <option key={date} value={date}>
                                {formatCoopDate(date)}
                              </option>
                            ))}
                          </select>
                        </Field>
                      </div>
                      <div className="mt-3">
                        <p className="mb-2 text-xs font-medium text-slate-500">{t("Chọn khung giờ")}</p>
                        <div className="grid grid-cols-2 gap-2">
                          {visibleCoopDeliverySlots.map((timeSlot) => {
                            const selected =
                              coopSlotFrom && coopSlotTo
                                ? coopSlotFrom === timeSlot.from && coopSlotTo === timeSlot.to
                                : firstAvailableCoopSlot?.from === timeSlot.from && firstAvailableCoopSlot?.to === timeSlot.to;
                            return (
                              <button
                                key={`${timeSlot.from}-${timeSlot.to}`}
                                type="button"
                                disabled={timeSlot.disabled}
                                onClick={() => {
                                  setCoopDeliveryDate(visibleCoopDeliveryDate);
                                  setCoopSlotFrom(timeSlot.from);
                                  setCoopSlotTo(timeSlot.to);
                                  setCoopCheckoutPrepared(false);
                                }}
                                className={`min-h-12 rounded-lg border px-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400 ${selected
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
                      <div className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
                        <Row k={t("Ngày nhận")} v={formatCoopDate(visibleCoopDeliveryDate)} />
                        <Row k={t("Khung giờ")} v={selectedSlotText} />
                      </div>
                    </div>

                    {paymentSummaryCard}
                    {paymentCardInputs}

                    {coopBelowMinimum && (
                      <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                        {t("Co.op yêu cầu đơn tối thiểu 200.000đ để thanh toán.")}
                      </div>
                    )}

                    {coopError && <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{coopError}</div>}

                    <div className="flex items-center justify-between border-t border-slate-200 pt-3">
                      <span className="text-sm font-medium text-slate-800">{t("Tạm tính")}</span>
                      <span className="text-lg font-bold text-emerald-600">{formatMoney(total, storeCurrency(activeOffer.store.id))}</span>
                    </div>
                    <button
                      disabled={!coopPrototypeCanStart || coopBusy || coopAddressBusy}
                      onClick={() => void startCoopFromPrototype()}
                      className="w-full rounded-xl bg-emerald-600 py-3 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {coopBusy || coopAddressBusy ? t("Đang chuẩn bị Co.op…") : t("Để trợ lý đặt giúp →")}
                    </button>
                    {!coopPrototypeCanStart && (
                      <p className="text-center text-xs text-slate-400">
                        {t("Nhập đủ tên, số điện thoại, mật khẩu Co.op, địa chỉ và chọn cửa hàng gần nhất để bắt đầu.")}
                      </p>
                    )}
                  </>
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

                {phase === "running" && (coopStep === "delivery" || coopStep === "payment") && (
                  <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-3">
                    <p className="text-sm font-bold text-slate-900">{t("Checkout Co.op")}</p>
                    <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
                      <Row k={t("Người nhận")} v={`${name} · ${phoneDigits}`} />
                      <Row k={t("Địa chỉ Co.op")} v={coopSavedAddress || address} />
                      <Row k={t("Kho Co.op")} v={coopResult?.terminalCode || coopTerminalCode} />
                      <Row k={t("Ngày nhận")} v={formatCoopDate(coopDeliveryDate || visibleCoopDeliveryDate)} />
                      <Row k={t("Khung giờ")} v={selectedSlotText} />
                      <Row k={t("Thanh toán")} v={paymentLabel} />
                    </div>

                    <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700">
                      {coopBusy
                        ? t("Affree đang tự cập nhật lịch giao và phương thức thanh toán sang Co.op...")
                        : t("Affree đang dùng lựa chọn từ popup đầu để cập nhật checkout Co.op.")}
                    </div>
                    {coopError && <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-600">{coopError}</p>}

                    {coopError && (
                      <button
                        type="button"
                        disabled={!coopDeliveryReady || coopBusy || !coopResult?.checkoutFlowId}
                        onClick={() => void prepareCoopCheckout()}
                        className="w-full rounded-xl bg-emerald-600 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {coopBusy ? t("Đang cập nhật Co.op…") : t("Thử cập nhật lại")}
                      </button>
                    )}

                  </div>
                )}

                {phase === "running" && coopStep === "review" && (
                  <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-3">
                    <p className="mb-3 text-xs font-medium leading-5 text-emerald-800">
                      {t("Bước cuối không thể hoàn tác — bạn duyệt rồi trợ lý mới đặt.")}
                    </p>
                    <div className="space-y-2 rounded-xl bg-white px-3 py-3 text-sm">
                      <Row k={t("Món")} v={`${activeOffer.product.name} ×${qty}`} />
                      <Row k={t("Nơi bán")} v={`${chain} · ${activeOffer.store.name}`} />
                      <Row k={t("Giao tới")} v={coopSavedAddress || address} />
                      <Row k={t("Khung giờ")} v={selectedSlotText} />
                      <Row k={t("Thanh toán")} v={paymentLabel} />
                      <Row k={t("Tổng")} v={formatMoney(coopResult?.lineTotal || total, storeCurrency(activeOffer.store.id))} strong />
                    </div>
                    <button
                      type="button"
                      disabled={coopBusy || !coopCheckoutPrepared}
                      onClick={() => void placeCoopOrder()}
                      className="mt-3 w-full rounded-xl bg-emerald-600 py-3 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-50"
                    >
                      {coopBusy ? t("Đang gửi sang Co.op…") : t("Xác nhận đặt hàng")}
                    </button>
                  </div>
                )}

                {phase === "running" && coopStep === "paymentQr" && (
                  <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-3">
                    <p className="mb-3 text-xs font-medium leading-5 text-emerald-800">
                      {t("Đơn đã tạo trên Co.op. Quét mã bên dưới để thanh toán, Affree sẽ tự ghi nhận khi giao dịch thành công.")}
                    </p>
                    <div className="space-y-2 rounded-xl bg-white px-3 py-3 text-sm">
                      <Row k={t("Mã đơn")} v={orderCode || coopResult?.order?.orderId || t("Đang cập nhật")} />
                      <Row k={t("Thanh toán")} v={paymentLabel} />
                      <Row k={t("Tổng")} v={formatMoney(coopResult?.lineTotal || total, storeCurrency(activeOffer.store.id))} strong />
                    </div>
                    <div className="mt-3 rounded-xl border border-slate-200 bg-white p-3 text-center">
                      {coopPaymentQrImage ? (
                        <img
                          src={coopPaymentQrImage}
                          alt={t("Mã QR thanh toán Co.op")}
                          className="mx-auto max-h-[360px] w-full max-w-[360px] rounded-lg object-contain"
                          data-content-type={coopPaymentQrContentType}
                        />
                      ) : (
                        <div className="flex min-h-[260px] flex-col items-center justify-center gap-3 text-slate-500">
                          <Spinner />
                          <span className="text-sm font-medium">{t("Đang lấy mã QR thanh toán...")}</span>
                        </div>
                      )}
                      {coopPaymentQrStatus && (
                        <p className="mt-3 text-xs font-medium leading-5 text-slate-500">{coopPaymentQrStatus}</p>
                      )}
                      {coopPaymentQrUrl && (
                        <a
                          href={coopPaymentQrUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-3 inline-flex rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                        >
                          {t("Mở trang thanh toán")}
                        </a>
                      )}
                    </div>
                    {coopError && <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-600">{coopError}</p>}
                    {coopPaymentQrBusy && (
                      <p className="mt-3 text-center text-xs text-slate-400">{t("Không đóng popup trong lúc Affree đang lấy mã QR.")}</p>
                    )}
                  </div>
                )}

                {phase === "running" && coopStep === "paymentGateway" && (
                  <div className="rounded-2xl border border-blue-200 bg-blue-50/70 p-3">
                    <p className="mb-3 text-xs font-medium leading-5 text-blue-800">
                      {t("Đơn đã tạo trên Co.op. Hoàn tất thanh toán trực tiếp trên trang VNPAY ở màn hình bên phải; Affree sẽ tự ghi nhận khi giao dịch thành công.")}
                    </p>
                    <div className="space-y-2 rounded-xl bg-white px-3 py-3 text-sm">
                      <Row k={t("Mã đơn")} v={orderCode || coopResult?.order?.orderId || t("Đang cập nhật")} />
                      <Row k={t("Thanh toán")} v={paymentLabel} />
                      <Row k={t("Tổng")} v={formatMoney(coopResult?.lineTotal || total, storeCurrency(activeOffer.store.id))} strong />
                    </div>
                    {!coopBrowserVisible && (
                      <button
                        type="button"
                        onClick={() => void openCoopBrowserAssist(undefined, "paymentScreen")}
                        className="mt-3 w-full rounded-xl bg-blue-600 py-3 text-sm font-semibold text-white transition hover:bg-blue-700"
                      >
                        {t("Mở lại màn hình thanh toán VNPAY")}
                      </button>
                    )}
                    {coopError && <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-600">{coopError}</p>}
                  </div>
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

          {paymentPickerModal}

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
                  ? t("Co.op đang dùng luồng thật: dùng token cache hoặc đăng nhập bằng mật khẩu, rồi thêm sản phẩm vào giỏ Co.op.")
                  : t("Bản mô phỏng — chưa kết nối web thật. Dùng để xem cơ chế trợ lý tự thao tác và dừng lại khi cần bạn.")}
          </div>

          {/* PHASE 1: form thông tin cần có */}
          {phase === "form" && (
            <div className="space-y-3">
              {/* Sản phẩm đang đặt — qty control nằm bên phải */}
              <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
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
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-slate-900">{activeOffer.product.name}</p>
                  <MarqueeText className="mt-0.5 text-xs text-slate-700">{`${chain} · ${activeOffer.store.name}`}</MarqueeText>
                  <div className="mt-1 flex items-center gap-2">
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
                <div className="flex shrink-0 flex-col items-center gap-1">
                  <span className="text-[10px] font-medium text-slate-400">{t("Số lượng")}</span>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setQty((q) => Math.max(1, q - 1))}
                      className="flex h-7 w-7 items-center justify-center rounded-lg border border-slate-300 bg-white text-base font-medium hover:bg-slate-100"
                    >
                      −
                    </button>
                    <span className="w-6 text-center text-sm font-semibold">{qty}</span>
                    <button
                      onClick={() => setQty((q) => q + 1)}
                      className="flex h-7 w-7 items-center justify-center rounded-lg border border-slate-300 bg-white text-base font-medium hover:bg-slate-100"
                    >
                      +
                    </button>
                  </div>
                </div>
              </div>

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
                  placeholder={t(rule.placeholderVi)}
                  aria-invalid={phoneError}
                  className="input"
                  style={phoneError ? { borderColor: "#ef4444" } : undefined}
                />
                {phoneError && (
                  <span className="mt-1 block text-xs text-rose-600">
                    {t(rule.errorVi)}
                  </span>
                )}
              </Field>

              {cfg.needEmail && (
                <Field label={t("Email (đăng nhập tài khoản)")}>
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

              {isCoopReal && (
                <Field label={t("Mật khẩu Co.op")}>
                  <input
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    type="password"
                    autoComplete="current-password"
                    placeholder={t("Tối thiểu 6 ký tự")}
                    aria-invalid={passwordError}
                    className="input"
                    style={passwordError ? { borderColor: "#ef4444" } : undefined}
                  />
                  {passwordError && (
                    <span className="mt-1 block text-xs text-rose-600">
                      {t("Mật khẩu Co.op cần tối thiểu 6 ký tự.")}
                    </span>
                  )}
                </Field>
              )}

              <Field label={t("Địa chỉ giao")}>
                <textarea
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  rows={2}
                  placeholder={t("Số nhà, đường, phường, quận…")}
                  className="input resize-none"
                />
              </Field>

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

                  <div className="mt-2 space-y-1.5">
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
                          <span className="min-w-0">
                            <span className="flex items-center gap-1.5">
                              <span className="truncate font-medium text-slate-800">
                                {chainLabel(o.store.chain)} · {o.store.name}
                              </span>
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

              <div className={cfg.needSlot && !isCoopReal ? "grid grid-cols-2 gap-3" : ""}>
                <Field label={t("Số lượng")}>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setQty((q) => Math.max(1, q - 1))}
                      className="h-9 w-9 shrink-0 rounded-lg border border-slate-300 text-lg font-medium hover:bg-slate-100"
                    >
                      −
                    </button>
                    <span className="w-8 text-center text-sm font-semibold">{qty}</span>
                    <button
                      onClick={() => setQty((q) => q + 1)}
                      className="h-9 w-9 shrink-0 rounded-lg border border-slate-300 text-lg font-medium hover:bg-slate-100"
                    >
                      +
                    </button>
                  </div>
                </Field>

                {cfg.needSlot && !isCoopReal && !isBHXReal && (
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
              </div>

              {paymentSummaryCard}
              {paymentCardInputs}

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

              <div className="flex items-center justify-between border-t border-slate-200 pt-3">
                <span className="text-sm text-slate-500">{t("Tạm tính")}</span>
                <span className="text-lg font-bold text-emerald-600">{formatMoney(total, storeCurrency(activeOffer.store.id))}</span>
              </div>
              {
                isTXNNReal && (
                  <button
                    disabled={!canStart}
                    onClick={createSession}
                    className="w-full rounded-xl bg-emerald-600 py-3 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {submitting ? t("Đang tạo phiên đặt hàng…") : t("Để trợ lý đặt giúp →")}
                  </button>)
              }
              {
                (isCoopReal || isBHXReal) && (
                  <button
                    disabled={!canStart || coopBusy}
                    onClick={() => {
                      flushProfile({ name, phone, address });
                      if (isCoopReal) {
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
                    className="w-full rounded-xl bg-emerald-600 py-3 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {coopBusy
                      ? t("Đang kết nối Co.op…")
                      : isCoopReal
                        ? t("Đăng nhập Co.op và thêm vào giỏ →")
                        : t("Để trợ lý đặt giúp →")}
                  </button>)
              }
              {
                !canStart && (
                  <p className="text-center text-xs text-slate-400">
                    {isCoopReal
                      ? t("Nhập đủ tên, số điện thoại, mật khẩu, địa chỉ và đảm bảo đơn Co.op từ 200.000đ.")
                      : t("Nhập đủ tên, số điện thoại và địa chỉ để bắt đầu.")}
                  </p>
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
                          ? t("Tài khoản Co.op đã đăng nhập bằng mật khẩu")
                          : t("Đã gửi yêu cầu đăng nhập Co.op")}
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
                <Row k={t("Thanh toán")} v="COD" />
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
                disabled={!canStart}
                onClick={() => {
                  flushProfile({ name, phone, address });
                  setStepIndex(0);
                  setOtp("");
                  setOtpError(false);
                  setSimOtp("");
                  setPhase("running");
                }}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-emerald-600 py-3 text-sm font-semibold text-white shadow-[0_4px_14px_rgba(16,185,129,0.35),inset_0_1px_0_rgba(255,255,255,0.25)] transition-all duration-150 hover:bg-emerald-700 active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500 disabled:shadow-none disabled:hover:bg-slate-300"
              >
                {t("Để trợ lý đặt giúp →")}
              </button>
              {!canStart && (
                <p className="mt-1.5 text-center text-xs text-slate-400">
                  {t("Nhập đủ tên, số điện thoại và địa chỉ để bắt đầu.")}
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

      {paymentPickerModal}

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

function addDays(value: Date, days: number) {
  const next = new Date(value);
  next.setDate(next.getDate() + days);
  return next;
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
  const order: Array<CoopStepId | "success"> = ["account", "otp", "delivery", "payment", "review", "paymentQr", "paymentGateway", "success"];
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
