"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode, type WheelEvent } from "react";
import type { RankedOffer, Store } from "@/lib/types";
import { chainLabel, storeCurrency } from "@/lib/stores";
import { formatMoney } from "@/lib/util";
import { type Lang, tr } from "@/lib/i18n";
import { getSavedCard, saveCard, type SavedCard } from "@/lib/cards";
import { MarqueeText } from "./MarqueeText";

type Phase = "form" | "connecting" | "running" | "interactive" | "done" | "failed";
type VariantOption = {
  id: string;
  label: string;
  price?: string;
  compareAt?: string;
  swatchImage?: string;
  previewImage?: string;
  disabled?: boolean;
  selected?: boolean;
};
type VariantGroup = { key: string; title: string; selectedLabel?: string; options: VariantOption[] };
type VariantSelection = { id: string; label: string };
type AddressSuggestion = { label: string; street?: string; city?: string; state?: string; zipCode?: string; cc?: string };
type PauseContext = { reason: string; message: string; nativeForm?: boolean; optionGroups?: VariantGroup[] };
type AgentFrame = { data: string; width: number; height: number; sourceX: number; sourceY: number; mode: string };

const US_STATE_CODES: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA", colorado: "CO",
  connecticut: "CT", delaware: "DE", florida: "FL", georgia: "GA", hawaii: "HI", idaho: "ID",
  illinois: "IL", indiana: "IN", iowa: "IA", kansas: "KS", kentucky: "KY", louisiana: "LA",
  maine: "ME", maryland: "MD", massachusetts: "MA", michigan: "MI", minnesota: "MN",
  mississippi: "MS", missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV",
  "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY",
  "north carolina": "NC", "north dakota": "ND", ohio: "OH", oklahoma: "OK", oregon: "OR",
  pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC", "south dakota": "SD",
  tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT", virginia: "VA", washington: "WA",
  "west virginia": "WV", wisconsin: "WI", wyoming: "WY", "district of columbia": "DC",
};

function normalizeUsState(value: string) {
  const normalized = value.trim().replace(/^US-/i, "");
  if (/^[A-Z]{2}$/i.test(normalized)) return normalized.toUpperCase();
  return US_STATE_CODES[normalized.toLowerCase()] || "";
}

function parseUsAddress(value: string) {
  const parts = String(value || "").split(",").map((part) => part.trim()).filter(Boolean);
  const tail = parts.at(-1) || "";
  const previous = parts.at(-2) || "";
  const stateZipMatch = `${previous} ${tail}`.match(/\b([A-Z]{2})\s+(\d{5})(?:-\d{4})?\b/i);
  return {
    street: parts[0] || value,
    city: stateZipMatch ? (parts.at(-3) || parts.at(-2) || "").replace(/\b[A-Z]{2}\s+\d{5}.*$/i, "").trim() : "",
    state: stateZipMatch ? stateZipMatch[1].toUpperCase() : "",
    zipCode: stateZipMatch ? stateZipMatch[2] : "",
  };
}

function extractUsPhoneDigits(value: string) {
  const raw = String(value || "").trim();
  const digits = raw.replace(/\D/g, "");
  if (/^\+?\s*1\b/.test(raw) && digits.startsWith("1")) return digits.slice(1, 11);
  if (digits.startsWith("1") && digits.length > 10) return digits.slice(1, 11);
  return digits.slice(0, 10);
}

function formatUsPhone(value: string) {
  const digits = extractUsPhoneDigits(value);
  if (!digits) return "+1 ";
  if (digits.length <= 3) return `+1 (${digits}`;
  if (digits.length <= 6) return `+1 (${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `+1 (${digits.slice(0, 3)}) ${digits.slice(3, 6)} ${digits.slice(6, 10)}`;
}

function isTechnicalAgentLog(message: string) {
  const text = message.trim();
  return [
    /^\[?Turn\s+\d+\/\d+\]?/i,
    /^AI:/i,
    /^🔧\s*Tool:/i,
    /^Tool:/i,
    /^Click:/i,
    /^Type\s/i,
    /^Walmart:\s*Fast path/i,
    /^Walmart:\s*Đã click màu/i,
    /^Walmart:\s*Đã áp dụng lựa chọn/i,
    /^Walmart:\s*Phát hiện màu\/size/i,
    /^Walmart:\s*Không áp dụng được lựa chọn/i,
    /^\[SkillStore\]/i,
    /^\[SkillUpdater\]/i,
    /^\[AgentLogger\]/i,
    /^\[LOG\s*-/i,
    /^Session /i,
  ].some((pattern) => pattern.test(text)) || /gọi ai/i.test(text);
}

function toFriendlyAgentMessage(message: string, t: (vi: string, vars?: Record<string, string | number>) => string) {
  const normalized = message.toLowerCase();
  if (/captcha|xác minh/.test(normalized)) return t("Cần bạn xác minh trên Walmart để tiếp tục.");
  if (/otp|mã xác minh|verification code/.test(normalized)) return t("Walmart yêu cầu mã xác minh. Vui lòng nhập mã để tiếp tục.");
  if (/review|kiểm tra đơn|thẻ|card|payment/.test(normalized)) return t("Đã tới bước thanh toán. Vui lòng kiểm tra thông tin và tiếp tục.");
  return "";
}

async function getAgentWsUrl(sessionId: string) {
  const baseUrl = process.env.NEXT_PUBLIC_ORDER_AGENT_SERVER_URL || "ws://localhost:8080";
  const separator = baseUrl.includes("?") ? "&" : "?";
  const walmartParams = `chain=walmart&sessionId=${encodeURIComponent(sessionId)}`;
  try {
    const response = await fetch(`/api/agent/token?sessionId=${encodeURIComponent(sessionId)}`);
    if (response.ok) {
      const data = await response.json();
      if (data.token) {
        return `${baseUrl}${separator}${walmartParams}&timestamp=${encodeURIComponent(data.timestamp)}&token=${encodeURIComponent(data.token)}`;
      }
    }
  } catch (error) {
    console.error("Không lấy được token agent Walmart:", error);
  }
  return `${baseUrl}${separator}${walmartParams}`;
}

export default function WalmartAgentModal({
  offer,
  defaultName,
  defaultPhone,
  defaultAddress,
  defaultQty,
  onClose,
  onPlaced,
  onOpenStore,
  lang = "vi",
}: {
  offer: RankedOffer;
  defaultName?: string;
  defaultPhone?: string;
  defaultAddress?: string;
  defaultQty?: number;
  onClose: () => void;
  onPlaced: (orderCode: string, chosen: RankedOffer) => void;
  /** Click tên cửa hàng ở form → mở trang bán hàng của cửa hàng đó (cha đóng modal + mở StoreProductsPage). */
  onOpenStore?: (store: Store) => void;
  lang?: Lang;
}) {
  const t = (vi: string, vars?: Record<string, string | number>) => tr(lang, vi, vars);
  const currency = storeCurrency(offer.store.id);
  const chain = chainLabel(offer.store.chain);
  const [phase, setPhase] = useState<Phase>("form");
  const [qty, setQty] = useState(defaultQty && defaultQty > 0 ? Math.floor(defaultQty) : 1);
  const defaultNameParts = (defaultName || "").trim().split(/\s+/).filter(Boolean);
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState(() => formatUsPhone(defaultPhone || ""));
  const [firstName, setFirstName] = useState(defaultNameParts.slice(0, -1).join(" ") || defaultNameParts[0] || "");
  const [lastName, setLastName] = useState(defaultNameParts.length > 1 ? defaultNameParts.at(-1) || "" : "");
  const [street, setStreet] = useState(defaultAddress || "");
  const [apt, setApt] = useState("");
  const [city, setCity] = useState("");
  const [stateCode, setStateCode] = useState("");
  const [zipCode, setZipCode] = useState("");
  const [addressSuggestions, setAddressSuggestions] = useState<AddressSuggestion[]>([]);
  const [addressLoading, setAddressLoading] = useState(false);
  const [addressSuggestionOpen, setAddressSuggestionOpen] = useState(false);
  const [runIdx, setRunIdx] = useState(0);
  const [orderCode, setOrderCode] = useState("");
  const [pauseContext, setPauseContext] = useState<PauseContext | null>(null);
  const [agentMessage, setAgentMessage] = useState("");
  const [agentError, setAgentError] = useState("");
  const [frame, setFrame] = useState<AgentFrame>({ data: "", width: 1024, height: 768, sourceX: 0, sourceY: 0, mode: "full" });
  const [otp, setOtp] = useState("");
  const [variantSelections, setVariantSelections] = useState<Record<string, VariantSelection>>({});
  const [variantApplying, setVariantApplying] = useState(false);
  const [savedCard, setSavedCard] = useState<SavedCard | null>(() => getSavedCard());
  const [useNewCard, setUseNewCard] = useState(() => !getSavedCard());
  const [cardNumber, setCardNumber] = useState("");
  const [cardExpiry, setCardExpiry] = useState("");
  const [cardCvv, setCardCvv] = useState("");
  const [cardFirstName, setCardFirstName] = useState(defaultNameParts[0] || "");
  const [cardLastName, setCardLastName] = useState(defaultNameParts.slice(1).join(" ") || "");
  const [saveNewCard, setSaveNewCard] = useState(true);
  const [finalSubmitting, setFinalSubmitting] = useState(false);
  const [showOrderDetails, setShowOrderDetails] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const finalActionSentRef = useRef(false);
  const closeRequestedRef = useRef(false);
  const phaseRef = useRef<Phase>("form");
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const pointerDownRef = useRef(false);
  const lastPointerMoveAtRef = useRef(0);
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  useEffect(() => {
    const query = street.trim();
    if (phase !== "form" || query.length < 4 || !addressSuggestionOpen) {
      setAddressSuggestions([]);
      setAddressLoading(false);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setAddressLoading(true);
      try {
        const response = await fetch(`/api/geocode?q=${encodeURIComponent(`${query}, United States`)}`, { signal: controller.signal });
        const data = response.ok ? await response.json() : [];
        setAddressSuggestions((Array.isArray(data) ? data : []).filter((item) => item?.label && (!item.cc || item.cc === "us")).slice(0, 5));
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) setAddressSuggestions([]);
      } finally {
        if (!controller.signal.aborted) setAddressLoading(false);
      }
    }, 350);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [addressSuggestionOpen, phase, street]);

  useEffect(() => {
    return () => {
      if (!closeRequestedRef.current) return;
      const ws = wsRef.current;
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "user_cancelled" }));
        ws.close();
      }
      wsRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!frame.data || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const context2d = canvas.getContext("2d");
    if (!context2d) return;
    const image = new Image();
    image.onload = () => {
      context2d.clearRect(0, 0, canvas.width, canvas.height);
      context2d.drawImage(image, 0, 0, canvas.width, canvas.height);
    };
    image.src = `data:image/jpeg;base64,${frame.data}`;
  }, [frame, phase]);

  const total = offer.price * qty;
  const activeCardNumber = useNewCard ? cardNumber : savedCard?.number || "";
  const activeCardExpiry = useNewCard ? cardExpiry : savedCard?.exp || "";
  const cardReady = activeCardNumber.replace(/\D/g, "").length >= 12
    && /^\d{2}\/\d{2}$/.test(activeCardExpiry)
    && cardCvv.replace(/\D/g, "").length >= 3
    && (!useNewCard || Boolean(cardFirstName.trim() && cardLastName.trim()));
  const parsedAddress = useMemo(() => parseUsAddress(street), [street]);
  const effectiveCity = city.trim() || parsedAddress.city;
  const effectiveStateCode = stateCode || parsedAddress.state;
  const effectiveZipCode = zipCode.trim() || parsedAddress.zipCode;
  const effectiveFullName = `${firstName} ${lastName}`.trim();
  const effectiveFirstName = firstName.trim() || lastName.trim();
  const effectiveLastName = lastName.trim() || firstName.trim();
  const phoneDigits = extractUsPhoneDigits(phone);
  const canStart = Boolean(offer.productUrl)
    && qty > 0
    && Boolean(phoneDigits.length === 10 && effectiveFullName && street.trim());
  const startDisabledReason = !offer.productUrl
    ? t("Sản phẩm Walmart chưa có URL để đặt hàng.")
    : qty <= 0
      ? t("Số lượng phải lớn hơn 0.")
      : !effectiveFullName
        ? t("Nhập họ tên để bắt đầu.")
        : phoneDigits.length !== 10
          ? t("Số điện thoại Mỹ cần đủ 10 số (hiện có {count}/10).", { count: phoneDigits.length })
          : !street.trim()
            ? t("Nhập địa chỉ giao hàng để bắt đầu.")
            : "";

  const steps = useMemo(
    () => [
      t("Mở Walmart.com..."),
      t("Đăng nhập"),
      t("Điền thông tin nhận hàng: {address} · SĐT {phone}...", {
        address: street.trim() || t("địa chỉ giao hàng"),
        phone: phone.trim() !== "+1" ? phone.trim() : t("số điện thoại"),
      }),
      t('Thêm "{product}" vào giỏ (SL {qty})...', { product: offer.product.name, qty }),
      t("Chọn màu / kích thước sản phẩm"),
      t("Kiểm tra & xác nhận đơn hàng"),
      t("Đặt hàng thành công"),
    ],
    [offer.product.name, phone, qty, street, t],
  );

  function updateProgress(message: string) {
    const normalized = message.toLowerCase();
    if (isTechnicalAgentLog(message)) return;

    if (/mở walmart|đã mở walmart|open walmart/.test(normalized)) setRunIdx((value) => Math.max(value, 0));
    if (/đăng nhập thành công|xác nhận đã đăng nhập|phát hiện đã đăng nhập|login|signed in/.test(normalized)) setRunIdx((value) => Math.max(value, 2));
    if (/địa chỉ|address|giao hàng|shipping/.test(normalized)) setRunIdx((value) => Math.max(value, 2));
    if (/xóa giỏ|xoá giỏ|cart cũ|remove.*cart|clear.*cart/.test(normalized)) setRunIdx((value) => Math.max(value, 2));
    if (/thêm sản phẩm vào giỏ thành công|added to cart|đã thêm.*giỏ|thêm.*vào giỏ/.test(normalized)) setRunIdx((value) => Math.max(value, 4));
    if (/màu|size|kích thước|variant|lựa chọn/.test(normalized)) setRunIdx((value) => Math.max(value, 4));
    if (/checkout|thẻ|card|payment|thanh toán/.test(normalized)) setRunIdx((value) => Math.max(value, 5));
    if (/kiểm tra đơn|review|xác nhận đơn/.test(normalized)) setRunIdx((value) => Math.max(value, 5));

    const friendly = toFriendlyAgentMessage(message, t);
    if (friendly) setAgentMessage(friendly);
  }

  function sendOrder(ws: WebSocket) {
    ws.send(JSON.stringify({
      type: "run_order",
      payload: {
        url: offer.productUrl,
        productUrl: offer.productUrl,
        productName: offer.product.name,
        qty,
        buyerName: effectiveFullName,
        buyerPhone: phoneDigits,
        buyerAddress: [street, apt, effectiveCity, effectiveStateCode, effectiveZipCode, "United States"].filter(Boolean).join(", "),
        chain: "walmart",
        customer: { name: effectiveFullName, phone: phoneDigits, email: email.trim() },
        address: {
          country: "United States",
          firstName: effectiveFirstName,
          lastName: effectiveLastName,
          street: street.trim(),
          apt: apt.trim(),
          city: effectiveCity,
          state: effectiveStateCode,
          zipCode: effectiveZipCode,
          phone: phoneDigits,
          email: email.trim(),
        },
      },
    }));
  }

  async function startAgentOrder() {
    if (!canStart) return;
    wsRef.current?.close();
    setAgentError("");
    setAgentMessage("Đang kết nối trợ lý AAAI Walmart...");
    finalActionSentRef.current = false;
    setVariantApplying(false);
    setPauseContext(null);
    setRunIdx(0);
    setPhase("connecting");

    try {
      const sessionId = `walmart-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const ws = new WebSocket(await getAgentWsUrl(sessionId));
      wsRef.current = ws;

      ws.onopen = () => {
        setPhase("running");
        setRunIdx(1);
        setAgentMessage(t("Trợ lý AAAI đã kết nối, đang kiểm tra tài khoản Walmart..."));
        sendOrder(ws);
      };
      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          if (message.type === "screencast" && message.data) {
            setFrame({
              data: message.data,
              width: Number(message.width) || 1024,
              height: Number(message.height) || 768,
              sourceX: Number(message.sourceX) || 0,
              sourceY: Number(message.sourceY) || 0,
              mode: String(message.mode || "full"),
            });
            return;
          }
          if (message.type === "log" && message.message) {
            updateProgress(String(message.message));
            return;
          }
          if (message.type !== "status") return;
          if (message.phase === "running") {
            setPauseContext(null);
            setVariantApplying(false);
            setPhase("running");
          } else if (message.phase === "waiting_user_input") {
            const reason = String(message.pauseReason || message.reason || "other");
            const pauseMessage = String(message.reason || t("Vui lòng thao tác trên màn hình rồi bấm Tiếp tục."));
            setFinalSubmitting(false);
            finalActionSentRef.current = false;
            if (reason !== "variant") setVariantApplying(false);
            if (reason === "review" && /chưa|lỗi|không|invalid|not found/i.test(pauseMessage)) setAgentError(pauseMessage);
            if (reason === "address") setRunIdx(steps.length - 1);
            if (reason === "review") setRunIdx(steps.length - 1);
            const optionGroups = Array.isArray(message.optionGroups) ? message.optionGroups as VariantGroup[] : undefined;
            if (reason === "variant" && optionGroups?.length) {
              setPauseContext((prev) => ({
                ...(prev || { reason, message: pauseMessage, nativeForm: Boolean(message.nativeForm) }),
                optionGroups,
                reason,
                message: pauseMessage,
                nativeForm: Boolean(message.nativeForm),
              }));
              setVariantApplying(false);
              setVariantSelections((current) => {
                const defaults: Record<string, VariantSelection> = { ...current };
                for (const group of optionGroups) {
                  // Nếu selection hiện tại bị disabled trong groups mới → xoá để user chọn lại
                  const sel = defaults[group.key];
                  if (sel) {
                    const stillValid = group.options.find((o) => o.id === sel.id && !o.disabled);
                    if (!stillValid) delete defaults[group.key];
                  }
                  // Auto-select nếu chưa có selection
                  if (!defaults[group.key]) {
                    const selected = group.options.find((o) => o.selected && !o.disabled);
                    if (selected) defaults[group.key] = { id: selected.id, label: selected.label };
                  }
                }
                return defaults;
              });
              setPhase("interactive");
              return;
            }
            setPauseContext({ reason, message: pauseMessage, nativeForm: Boolean(message.nativeForm), optionGroups });
            setAgentMessage(pauseMessage);
            setPhase("interactive");
          } else if (message.phase === "completed") {
            setFinalSubmitting(false);
            finalActionSentRef.current = true;
            setVariantApplying(false);
            setCardCvv("");
            const code = String(message.orderId || message.orderCode || `WM-${String(Date.now()).slice(-8)}`);
            setOrderCode(code);
            setRunIdx(steps.length);
            setPauseContext(null);
            setPhase("done");
            onPlaced(code, offer);
          } else if (message.phase === "failed" || message.phase === "cancelled") {
            setFinalSubmitting(false);
            finalActionSentRef.current = false;
            setVariantApplying(false);
            setAgentError(String(message.error || t("Trợ lý AAAI Walmart chưa hoàn tất được đơn hàng.")));
            setPauseContext(null);
            setPhase("failed");
          }
        } catch (error) {
          console.error("Không đọc được phản hồi agent Walmart:", error);
        }
      };
      ws.onerror = () => {
        setAgentError(t("Không kết nối được agent-server. Hãy kiểm tra server cổng 8080."));
        setPhase("failed");
      };
      ws.onclose = () => {
        if (wsRef.current === ws) {
          wsRef.current = null;
          setVariantApplying(false);
          setFinalSubmitting(false);
          if (!closeRequestedRef.current && phaseRef.current !== "done") {
            setAgentError(t("Kết nối Walmart bị ngắt. Vui lòng thử lại từ bước hiện tại."));
          }
        }
      };
    } catch (error) {
      setAgentError(error instanceof Error ? error.message : t("Không mở được phiên Walmart."));
      setPhase("failed");
    }
  }

  function cancelAndClose() {
    closeRequestedRef.current = true;
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "user_cancelled" }));
      ws.close();
    }
    wsRef.current = null;
    onClose();
  }

  function resumeAgent() {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN || !pauseContext) return;
    if (pauseContext.reason === "otp" && otp.trim()) {
      ws.send(JSON.stringify({ type: "submit_otp", otp: otp.trim() }));
      setOtp("");
    } else if (pauseContext.reason === "captcha") {
      ws.send(JSON.stringify({ type: "captcha_completed" }));
    } else {
      ws.send(JSON.stringify({ type: "resume_agent", reason: pauseContext.reason }));
    }
    setPauseContext(null);
    setVariantApplying(false);
    setPhase("running");
    setAgentMessage(t("Đã nhận thao tác, trợ lý AAAI đang tiếp tục..."));
  }

  function handleColorSelect(group: string, option: VariantOption) {
    // Luôn update local state trước
    setVariantSelections((current) => ({ ...current, [group]: { id: option.id, label: option.label } }));
    // Nếu là màu → gửi color_preview lên server để click màu thật + lấy size mới
    if (group === "color" && !option.disabled) {
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        setVariantApplying(true);
        ws.send(JSON.stringify({
          type: "walmart_submit_options",
          stage: "color_preview",
          selections: { color: { id: option.id, label: option.label } },
        }));
      }
    }
  }

  function submitVariantSelections() {
    const ws = wsRef.current;
    const groups = pauseContext?.optionGroups || [];
    if (!ws || ws.readyState !== WebSocket.OPEN || pauseContext?.reason !== "variant") return;
    if (groups.some((group) => group.options.length > 0 && !variantSelections[group.key])) return;
    // Block nếu user chọn option đã hết hàng (disabled)
    for (const group of groups) {
      const sel = variantSelections[group.key];
      if (!sel) continue;
      const option = group.options.find((o) => o.id === sel.id);
      if (option?.disabled) return;
    }
    ws.send(JSON.stringify({ type: "walmart_submit_options", stage: "variant", selections: variantSelections }));
    setVariantApplying(true);
    setPauseContext(null);
    setPhase("running");
    setAgentMessage(t("Đang áp dụng màu và kích thước trên Walmart..."));
  }

  function confirmWalmartOrder() {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN || pauseContext?.reason !== "review" || !cardReady || finalSubmitting) return;
    const digits = activeCardNumber.replace(/\D/g, "");
    const [expiryMonth, expiryYear] = activeCardExpiry.split("/");
    if (useNewCard && saveNewCard) {
      const nextCard: SavedCard = {
        number: digits.replace(/(.{4})/g, "$1 ").trim(),
        name: `${firstName} ${lastName}`.trim().toUpperCase(),
        exp: activeCardExpiry,
        cvv: "",
        brand: null,
        savedAt: Date.now(),
      };
      saveCard({ number: nextCard.number, name: nextCard.name, exp: nextCard.exp, cvv: nextCard.cvv, brand: nextCard.brand });
      setSavedCard(nextCard);
    }
    setFinalSubmitting(true);
    setAgentError("");
    setAgentMessage(t("Đã xác nhận. Trợ lý đang điền thẻ và gửi đơn Walmart..."));
    ws.send(JSON.stringify({
      type: "walmart_confirm_order",
      payment: {
        cardNumber: digits,
        expiryMonth,
        expiryYear: `20${expiryYear}`,
        cvv: cardCvv.replace(/\D/g, ""),
        cardholderName: `${cardFirstName} ${cardLastName}`.trim() || effectiveFullName,
      },
    }));
  }

  function confirmFinalWalmartOrder() {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN || pauseContext?.reason !== "post_payment" || finalSubmitting || finalActionSentRef.current) return;
    finalActionSentRef.current = true;
    setFinalSubmitting(true);
    setAgentError("");
    setAgentMessage(t("Đã xác nhận. Walmart đang bấm Continue cuối cùng..."));
    ws.send(JSON.stringify({ type: "confirm_final_action", chain: "walmart" }));
  }

  function applyAddressSuggestion(suggestion: AddressSuggestion) {
    setStreet(suggestion.street || suggestion.label.split(",")[0] || suggestion.label);
    if (suggestion.city) setCity(suggestion.city);
    if (suggestion.state) setStateCode(normalizeUsState(suggestion.state));
    if (suggestion.zipCode) setZipCode(suggestion.zipCode);
    setAddressSuggestionOpen(false);
    setAddressSuggestions([]);
  }

  function sendPointer(event: MouseEvent<HTMLCanvasElement>, type: "click" | "mousedown" | "mouseup" | "mousemove") {
    const ws = wsRef.current;
    const canvas = canvasRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN || !canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = frame.sourceX + Math.round(((event.clientX - rect.left) / rect.width) * frame.width);
    const y = frame.sourceY + Math.round(((event.clientY - rect.top) / rect.height) * frame.height);
    ws.send(JSON.stringify({ type, x, y }));
  }

  function focusCanvas() {
    canvasRef.current?.focus({ preventScroll: true });
  }

  function handleMouseDown(event: MouseEvent<HTMLCanvasElement>) {
    focusCanvas();
    pointerDownRef.current = true;
    sendPointer(event, "mousedown");
  }

  function handleMouseUp(event: MouseEvent<HTMLCanvasElement>) {
    if (!pointerDownRef.current) return;
    pointerDownRef.current = false;
    sendPointer(event, "mouseup");
  }

  function handleMouseMove(event: MouseEvent<HTMLCanvasElement>) {
    const now = Date.now();
    if (!pointerDownRef.current && now - lastPointerMoveAtRef.current < 50) return;
    lastPointerMoveAtRef.current = now;
    sendPointer(event, "mousemove");
  }

  function handleWheel(event: WheelEvent<HTMLCanvasElement>) {
    event.preventDefault();
    focusCanvas();
    const ws = wsRef.current;
    const canvas = canvasRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN || !canvas) return;
    const rect = canvas.getBoundingClientRect();
    ws.send(JSON.stringify({
      type: "wheel",
      x: frame.sourceX + Math.round(((event.clientX - rect.left) / rect.width) * frame.width),
      y: frame.sourceY + Math.round(((event.clientY - rect.top) / rect.height) * frame.height),
      deltaX: event.deltaX,
      deltaY: event.deltaY,
    }));
  }

  function handleCanvasKey(event: KeyboardEvent<HTMLCanvasElement>) {
    event.preventDefault();
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: "keypress", key: event.key }));
  }

  const showNativeVariantForm = phase === "interactive"
    && pauseContext?.reason === "variant"
    && pauseContext.nativeForm
    && Boolean(pauseContext.optionGroups?.length);
  // Payment/review data is collected in the Affree form and filled into Walmart
  // deterministically. Only CAPTCHA and visual variant selection need a stream.
  const showInteractiveScreen = phase === "interactive"
    && Boolean(pauseContext)
    && !showNativeVariantForm
    && ["captcha", "variant"].includes(pauseContext?.reason || "");
  const frameAspectRatio = `${Math.max(1, frame.width || 1)} / ${Math.max(1, frame.height || 1)}`;

  return (
    <div
      className="fixed inset-0 z-[2200] flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.35)", backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)" }}
    >
      <div
        className={`relative flex max-h-[92vh] w-full flex-col overflow-hidden rounded-3xl transition-[max-width] duration-300 ${showInteractiveScreen ? "h-[92vh] max-w-[1180px]" : "max-w-md"}`}
        style={{
          backdropFilter: "blur(24px) saturate(160%)",
          WebkitBackdropFilter: "blur(24px) saturate(160%)",
          backgroundColor: "rgba(255,255,255,0.88)",
          boxShadow: "0 0 0 1px rgba(255,255,255,0.5), 0 16px 48px rgba(0,0,0,0.18), inset 0 1px 0 rgba(255,255,255,0.7)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-200/70 px-4 py-3">
          <div className="min-w-0 flex-1">
            {phase === "done" ? (
              <h2 className="truncate text-base font-bold text-slate-800">{t("Đã đặt hàng Walmart")}</h2>
            ) : (
              <MarqueeText className="text-base font-bold text-slate-800">
                {`${offer.product.name} · ${chain}`}
              </MarqueeText>
            )}
          </div>
          <button type="button" onClick={cancelAndClose} className="shrink-0 rounded-full p-1.5 text-slate-500 hover:bg-white/40" aria-label={t("Đóng")}>
            <CloseIcon />
          </button>
        </div>

        <div className={`min-h-0 flex-1 ${showInteractiveScreen ? "grid overflow-hidden lg:grid-cols-[390px_minmax(0,1fr)]" : "overflow-y-auto"}`}>
          <div className={`min-h-0 touch-pan-y overscroll-contain [scrollbar-gutter:stable] ${showInteractiveScreen ? "h-full overflow-y-auto border-r border-slate-200 px-4 py-4" : "px-4 py-4 pb-28"}`}>
          <Notice>
            {phase === "form"
              ? t("Affree sẽ tự đăng nhập, mở đúng sản phẩm và thêm vào giỏ. Màn hình chỉ hiện khi bạn cần thao tác hoặc khi tới checkout.")
              : t("Đang chạy luồng Walmart thật. Affree sẽ dừng đúng lúc cần bạn hỗ trợ.")}
          </Notice>

          {phase === "form" && (
            <div className="space-y-3">
              <Section title={t("THÔNG TIN CHUNG")}>
                <Field label={t("Họ tên")}>
                  <input
                    value={`${firstName}${lastName ? ` ${lastName}` : ""}`.trim()}
                    onChange={(event) => {
                      const parts = event.target.value.trim().split(/\s+/).filter(Boolean);
                      setFirstName(parts.slice(0, -1).join(" ") || parts[0] || "");
                      setLastName(parts.length > 1 ? parts.at(-1) || "" : "");
                    }}
                    className="walmart-input"
                    placeholder={t("Nguyễn Văn A")}
                    autoComplete="name"
                  />
                </Field>
                <Field label={t("Số điện thoại / Zalo")}>
                  <input
                    value={phone}
                    onChange={(event) => setPhone(formatUsPhone(event.target.value))}
                    onFocus={() => {
                      if (!extractUsPhoneDigits(phone)) setPhone("+1 ");
                    }}
                    className="walmart-input"
                    inputMode="tel"
                    autoComplete="tel"
                    placeholder="+1 (555) 123 4567"
                  />
                </Field>
                <Field label={t("Địa chỉ giao hàng")}>
                  <div className="relative">
                    <textarea
                      value={street}
                      onChange={(event) => { setStreet(event.target.value); setAddressSuggestionOpen(true); }}
                      onFocus={() => setAddressSuggestionOpen(true)}
                      className="walmart-input min-h-[4.5rem] resize-none"
                      rows={2}
                      autoComplete="off"
                      aria-autocomplete="list"
                      aria-expanded={addressSuggestionOpen && (addressLoading || addressSuggestions.length > 0)}
                    />
                    {addressSuggestionOpen && (addressLoading || addressSuggestions.length > 0) ? (
                      <div className="absolute left-0 right-0 top-[calc(100%+4px)] z-20 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
                        {addressLoading ? <p className="px-3 py-2 text-xs font-semibold text-slate-500">{t("Đang tìm địa chỉ...")}</p> : null}
                        {addressSuggestions.map((suggestion) => (
                          <button
                            key={`${suggestion.label}-${suggestion.zipCode || ""}`}
                            type="button"
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => applyAddressSuggestion(suggestion)}
                            className="block w-full border-t border-slate-100 px-3 py-2 text-left text-xs font-medium leading-5 text-slate-700 hover:bg-emerald-50"
                          >
                            {suggestion.label}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </Field>
              </Section>

              <ProductSummary
                offer={offer}
                qty={qty}
                setQty={setQty}
                total={total}
                currency={currency}
                t={t}
                onClose={cancelAndClose}
                onOpenStore={onOpenStore}
              />

              <PaymentMethodSelector t={t} />

            </div>
          )}

          {(phase === "connecting" || phase === "running" || phase === "interactive") && (
            <div className="space-y-3">
              <Timeline steps={steps} activeIndex={runIdx} />
              {agentMessage && (
                <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2 text-xs font-medium leading-5 text-emerald-800">
                  {agentMessage}
                </div>
              )}
              {pauseContext?.reason === "otp" && (
                <Field label={t("Mã xác minh Walmart")}>
                  <input value={otp} onChange={(event) => setOtp(event.target.value)} className="walmart-input" inputMode="numeric" autoFocus placeholder={t("Nhập mã OTP")} />
                </Field>
              )}
              {pauseContext?.reason === "captcha" && (
                <div className="rounded-xl border border-amber-100 bg-amber-50 px-3 py-2 text-xs font-semibold leading-5 text-amber-800">
                  {t("Hãy giải CAPTCHA trực tiếp trên màn hình Walmart. Affree sẽ tự phát hiện khi xác minh xong và tiếp tục, không cần bấm nút.")}
                </div>
              )}
              {pauseContext?.reason === "review" && (
                <Section title={t("Xác nhận thanh toán Walmart")}>
                  {savedCard && !useNewCard ? (
                    <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
                      <p className="text-sm font-bold text-slate-900">{savedCard.brand || t("Thẻ đã lưu")} ·•••• {savedCard.number.replace(/\D/g, "").slice(-4)}</p>
                      <p className="mt-1 text-xs text-slate-500">{savedCard.name} · {savedCard.exp}</p>
                      <button type="button" onClick={() => setUseNewCard(true)} className="mt-2 text-xs font-bold text-emerald-600">{t("Dùng thẻ khác")}</button>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <Field label={t("Số thẻ")}>
                        <input value={cardNumber} onChange={(event) => setCardNumber(event.target.value.replace(/\D/g, "").slice(0, 19).replace(/(.{4})/g, "$1 ").trim())} className="walmart-input font-mono" inputMode="numeric" autoComplete="cc-number" />
                      </Field>
                      <div className="grid grid-cols-2 gap-2">
                        <Field label={t("First name")}>
                          <input value={cardFirstName} onChange={(event) => setCardFirstName(event.target.value)} className="walmart-input" autoComplete="cc-given-name" />
                        </Field>
                        <Field label={t("Last name")}>
                          <input value={cardLastName} onChange={(event) => setCardLastName(event.target.value)} className="walmart-input" autoComplete="cc-family-name" />
                        </Field>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <Field label={t("MM/YY")}>
                          <input value={cardExpiry} onChange={(event) => { const value = event.target.value.replace(/\D/g, "").slice(0, 4); setCardExpiry(value.length > 2 ? `${value.slice(0, 2)}/${value.slice(2)}` : value); }} className="walmart-input font-mono" inputMode="numeric" autoComplete="cc-exp" />
                        </Field>
                        <Field label={t("CVV")}>
                          <input value={cardCvv} onChange={(event) => setCardCvv(event.target.value.replace(/\D/g, "").slice(0, 4))} className="walmart-input font-mono" type="password" inputMode="numeric" autoComplete="cc-csc" />
                        </Field>
                      </div>
                      <label className="flex items-center gap-2 text-xs font-medium text-slate-600"><input type="checkbox" checked={saveNewCard} onChange={(event) => setSaveNewCard(event.target.checked)} />{t("Lưu thẻ trên thiết bị này")}</label>
                      {savedCard ? <button type="button" onClick={() => setUseNewCard(false)} className="text-xs font-bold text-emerald-600">{t("Dùng lại thẻ đã lưu")}</button> : null}
                    </div>
                  )}
                  {!useNewCard ? (
                    <Field label={t("CVV")}>
                      <input value={cardCvv} onChange={(event) => setCardCvv(event.target.value.replace(/\D/g, "").slice(0, 4))} className="walmart-input font-mono" type="password" inputMode="numeric" autoComplete="cc-csc" autoFocus />
                    </Field>
                  ) : null}
                  {agentError ? <p className="text-xs font-semibold text-rose-600">{agentError}</p> : null}
                  <button type="button" disabled={!cardReady || finalSubmitting} onClick={confirmWalmartOrder} className="flex h-11 w-full items-center justify-center rounded-xl bg-emerald-600 text-sm font-bold text-white transition hover:bg-emerald-700 disabled:bg-slate-300">
                    {finalSubmitting ? t("Đang nhập thẻ trên Walmart...") : t("Tiếp tục tới bước kiểm tra đơn")}
                  </button>
                </Section>
              )}
              {pauseContext?.reason === "post_payment" && (
                <Section title={t("Kiểm tra & xác nhận đơn hàng")}>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <p className="text-sm font-bold text-slate-900">{offer.product.name}</p>
                    <p className="mt-1 text-xs font-medium text-slate-600">{offer.store.name} · SL {qty}</p>
                    <p className="mt-2 text-lg font-bold text-emerald-600">{formatMoney(total, currency)}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowOrderDetails((value) => !value)}
                    className="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-800 underline"
                  >
                    <span>{showOrderDetails ? t("Ẩn chi tiết") : t("Xem chi tiết")}</span>
                    <span className="text-xs text-slate-500">{qty} item</span>
                  </button>
                  {showOrderDetails ? (
                    <WalmartOrderDetails
                      offer={offer}
                      qty={qty}
                      total={total}
                      currency={currency}
                      t={t}
                    />
                  ) : null}
                  <div className="rounded-xl border border-slate-200 bg-white p-3 text-xs font-medium leading-5 text-slate-600">
                    <p><span className="font-bold text-slate-800">{t("Người nhận")}:</span> {effectiveFullName}</p>
                    <p><span className="font-bold text-slate-800">{t("SĐT")}:</span> {phone}</p>
                    <p><span className="font-bold text-slate-800">{t("Địa chỉ")}:</span> {street}</p>
                    <p><span className="font-bold text-slate-800">{t("Thanh toán")}:</span> {t("Thẻ")}</p>
                  </div>
                  <button
                    type="button"
                    onClick={confirmFinalWalmartOrder}
                    disabled={finalSubmitting}
                    className="flex h-11 w-full items-center justify-center rounded-xl bg-emerald-600 text-sm font-bold text-white transition hover:bg-emerald-700 disabled:bg-slate-300"
                  >
                    {finalSubmitting ? t("Đang xác nhận trên Walmart...") : t("Xác nhận đặt hàng")}
                  </button>
                  <p className="text-xs font-medium leading-5 text-slate-500">
                    {t("Affree sẽ bấm Continue cuối cùng trên Walmart sau khi bạn xác nhận.")}
                  </p>
                </Section>
              )}
              {showNativeVariantForm && pauseContext.optionGroups && (
                <VariantSelector
                  groups={pauseContext.optionGroups}
                  selections={variantSelections}
                  applying={variantApplying}
                  onSelect={(group, option) => {
                    if (variantApplying) return;
                    if (group === "color") {
                      handleColorSelect(group, option);
                    } else {
                      setVariantSelections((current) => ({
                        ...current,
                        [group]: { id: option.id, label: option.label },
                      }));
                    }
                  }}
                  onSubmit={submitVariantSelections}
                  t={t}
                />
              )}
              {pauseContext && !["address", "review", "post_payment", "checkout_options", "payment", "captcha", "variant"].includes(pauseContext.reason) && (
                <button
                  type="button"
                  onClick={resumeAgent}
                  disabled={pauseContext.reason === "otp" && !otp.trim()}
                  className="flex h-11 w-full items-center justify-center rounded-xl bg-emerald-600 text-sm font-bold text-white transition hover:bg-emerald-700 disabled:bg-slate-300"
                >
                  {pauseContext.reason === "otp"
                      ? t("Gửi mã và tiếp tục")
                      : pauseContext.reason === "variant"
                        ? t("Đã chọn màu và size, tiếp tục")
                        : t("Tiếp tục đặt hàng")}
                </button>
              )}
            </div>
          )}

          {phase === "failed" && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-3">
              <p className="text-sm font-semibold text-rose-700">{agentError}</p>
              <button type="button" onClick={() => setPhase("form")} className="mt-3 h-10 w-full rounded-xl border border-rose-300 bg-white text-sm font-bold text-rose-700">
                {t("Thử lại")}
              </button>
            </div>
          )}

          {phase === "done" && (
            <SuccessPanel
              t={t}
              code={orderCode}
              offer={offer}
              qty={qty}
              total={total}
              currency={currency}
              onClose={cancelAndClose}
            />
          )}
          </div>

          {showInteractiveScreen && (
            <div className="flex h-full min-h-0 flex-col bg-slate-950 p-3">
              <div className="mb-2 flex items-center justify-between gap-3 text-white">
                <div>
                  <p className="text-sm font-bold">
                    {pauseContext?.reason === "captcha"
                      ? t("Xác minh bạn là người thật")
                      : pauseContext?.reason === "variant"
                        ? t("Chọn màu và size sản phẩm")
                        : t("Màn hình Walmart checkout")}
                  </p>
                  <p className="text-xs text-slate-400">{t("Click, giữ chuột, cuộn và gõ trực tiếp trong màn hình.")}</p>
                </div>
                <span className="rounded-lg bg-amber-400/15 px-2 py-1 text-xs font-semibold text-amber-300">{t("Cần bạn thao tác")}</span>
              </div>
              <div
                className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-xl bg-white p-2"
                style={{ contain: "layout paint", isolation: "isolate" }}
              >
                {frame.data ? (
                  <canvas
                    ref={canvasRef}
                    width={frame.width}
                    height={frame.height}
                    tabIndex={0}
                    aria-label={t("Màn hình tương tác Walmart")}
                    className="block h-auto max-h-full w-auto max-w-full cursor-default outline-none"
                    style={{ aspectRatio: frameAspectRatio }}
                    onMouseDown={handleMouseDown}
                    onMouseUp={handleMouseUp}
                    onMouseLeave={handleMouseUp}
                    onMouseMove={handleMouseMove}
                    onWheel={handleWheel}
                    onKeyDown={handleCanvasKey}
                  />
                ) : (
                  <div className="flex min-h-[360px] items-center justify-center gap-2 text-sm font-semibold text-slate-500">
                    <Spinner /> {t("Đang nhận màn hình Walmart...")}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {phase === "form" && (
          <div className="border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur-sm">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm font-semibold text-slate-800">{t("Tạm tính")}</span>
              <span className="text-lg font-bold text-emerald-600">{formatMoney(total, currency)}</span>
            </div>
            <button
              type="button"
              disabled={!canStart}
              onClick={startAgentOrder}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-emerald-600 py-3 text-sm font-semibold text-white shadow-[0_4px_14px_rgba(16,185,129,0.35),inset_0_1px_0_rgba(255,255,255,0.25)] transition-all duration-150 hover:bg-emerald-700 active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500 disabled:shadow-none disabled:hover:bg-slate-300"
            >
              {t("Đặt hàng ngay →").replace(/\s*→\s*/g, "")} (1 {t("cửa hàng")})
            </button>
            <p className="mt-2 text-center text-xs font-medium text-slate-400">
              {canStart
                ? t("Trợ lý AAAI sẽ dùng tài khoản đặt hộ, cho chọn biến thể nếu có, rồi mới thêm vào giỏ.")
                : startDisabledReason}
            </p>
          </div>
        )}
      </div>

      <style jsx global>{`
        .walmart-input {
          width: 100%;
          border-radius: 0.5rem;
          border: 1px solid #e2e8f0;
          background: rgba(255,255,255,0.82);
          padding: 0.5rem 0.75rem;
          font-size: 0.875rem;
          color: #0f172a;
          outline: none;
          transition: border-color 0.15s, box-shadow 0.15s, background 0.15s;
        }
        .walmart-input::placeholder { color: #94a3b8; }
        .walmart-input:focus {
          border-color: #34d399;
          background: white;
          box-shadow: 0 0 0 2px rgba(16,185,129,0.12);
        }
      `}</style>
    </div>
  );
}

function ProductSummary({
  offer,
  qty,
  setQty,
  total,
  currency,
  t,
  onClose,
  onOpenStore,
}: {
  offer: RankedOffer;
  qty: number;
  setQty: (qty: number) => void;
  total: number;
  currency: string;
  t: (vi: string, vars?: Record<string, string | number>) => string;
  onClose: () => void;
  onOpenStore?: (store: Store) => void;
}) {
  return (
    <section className="space-y-3 rounded-2xl border border-slate-400 p-3">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
        {offer.product.image ? (
          <img src={offer.product.image} alt={offer.product.name} className="h-14 w-14 shrink-0 rounded-lg bg-white object-contain" />
        ) : (
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-2xl">🛒</div>
        )}
        <div className="min-w-[9rem] flex-1">
          <p className="truncate text-sm font-semibold text-slate-900">{offer.product.name}</p>
          {/* Click tên cửa hàng → mở trang bán hàng của cửa hàng đó */}
          <button
            type="button"
            disabled={!onOpenStore}
            onClick={() => onOpenStore?.(offer.store)}
            title={t("Xem tất cả sản phẩm của cửa hàng")}
            className="block w-full min-w-0 text-left enabled:cursor-pointer enabled:hover:underline enabled:hover:decoration-emerald-500"
          >
            <p className="mt-0.5 truncate text-xs text-slate-700">{offer.store.name}</p>
          </button>
          <div className="mt-1 flex flex-wrap items-center gap-x-2">
            <span className="text-base font-bold text-emerald-600">{formatMoney(total, currency)}</span>
            {qty > 1 ? (
              <span className="text-xs text-slate-600">({formatMoney(offer.price, currency)} × {qty})</span>
            ) : null}
          </div>
        </div>
        <div className="ml-auto flex shrink-0 flex-col items-center gap-1">
          <span className="text-[10px] font-medium text-slate-400">{t("Số lượng")}</span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => (qty <= 1 ? onClose() : setQty(Math.max(1, qty - 1)))}
              className="flex h-7 w-7 items-center justify-center rounded-lg border border-slate-300 bg-white text-base font-medium hover:bg-slate-100"
            >
              −
            </button>
            <span className="w-6 text-center text-sm font-semibold">{qty}</span>
            <button
              type="button"
              onClick={() => setQty(qty + 1)}
              className="flex h-7 w-7 items-center justify-center rounded-lg border border-slate-300 bg-white text-base font-medium hover:bg-slate-100"
            >
              +
            </button>
            <button
              type="button"
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
    </section>
  );
}

function VariantSelector({
  groups,
  selections,
  applying,
  onSelect,
  onSubmit,
  t,
}: {
  groups: VariantGroup[];
  selections: Record<string, VariantSelection>;
  applying: boolean;
  onSelect: (group: string, option: VariantOption) => void;
  onSubmit: () => void;
  t: (vi: string, vars?: Record<string, string | number>) => string;
}) {
  const complete = groups.every((group) => group.options.length === 0 || Boolean(selections[group.key]));
  const hasDisabledSelection = groups.some((group) => {
    const sel = selections[group.key];
    if (!sel) return false;
    return group.options.find((o) => o.id === sel.id)?.disabled === true;
  });

  return (
    <Section title={t("Chọn màu và kích thước")}>
      <div className="relative space-y-3">
      {groups.map((group) => (
        <div key={group.key}>
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-xs font-bold text-slate-800">{group.title}</p>
            <p className="truncate text-xs font-semibold text-slate-500">
              {selections[group.key]?.label || group.selectedLabel || t("Chưa chọn")}
            </p>
          </div>

          {group.key === "color" ? (
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-5">
              {group.options.map((option) => {
                const selected = selections[group.key]?.label === option.label;
                return (
                  <button
                    key={option.id}
                    type="button"
                    disabled={option.disabled || applying}
                    onClick={() => onSelect(group.key, option)}
                    title={option.label}
                    aria-label={`${group.title}: ${option.label}`}
                    aria-pressed={selected}
                    className={`relative flex min-h-[82px] flex-col items-center justify-start rounded-xl border px-1.5 py-2 transition ${selected ? "border-emerald-500 bg-emerald-50 ring-2 ring-emerald-500/20" : "border-slate-200 bg-white hover:border-slate-400"} disabled:cursor-not-allowed disabled:opacity-45`}
                  >
                    <span className={`relative h-11 w-11 overflow-hidden rounded-full border bg-slate-100 ${selected ? "ring-2 ring-slate-900 ring-offset-2" : "border-slate-300"}`}>
                      {option.swatchImage ? (
                        <img src={option.swatchImage} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <span className="flex h-full w-full items-center justify-center text-[10px] font-bold text-slate-500">{option.label.slice(0, 2)}</span>
                      )}
                      {option.disabled ? <span className="absolute left-[-8px] top-1/2 h-0.5 w-[64px] -translate-y-1/2 rotate-[-45deg] bg-slate-500" /> : null}
                    </span>
                    <span className="mt-2 line-clamp-1 w-full text-center text-[10px] font-semibold text-slate-700">{option.label}</span>
                    {option.price ? <span className="text-[10px] font-bold text-slate-500">{option.price}</span> : null}
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="grid grid-cols-4 gap-2">
              {group.options.map((option) => {
                const selected = selections[group.key]?.label === option.label;
                return (
                  <button
                    key={option.id}
                    type="button"
                    disabled={option.disabled || applying}
                    onClick={() => onSelect(group.key, option)}
                    aria-pressed={selected}
                    className={`relative flex h-11 items-center justify-center overflow-hidden rounded-xl border text-xs font-bold transition ${selected ? "border-slate-900 bg-white text-slate-900 ring-2 ring-slate-900" : "border-slate-300 bg-white text-slate-700 hover:border-slate-500"} disabled:cursor-not-allowed disabled:text-slate-400`}
                  >
                    {option.label}
                    {option.disabled ? <span className="absolute left-[-6px] top-1/2 h-0.5 w-[70px] -translate-y-1/2 rotate-[-42deg] bg-slate-400" /> : null}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      ))}
      <button
        type="button"
        onClick={onSubmit}
        disabled={!complete || hasDisabledSelection || applying}
        className="flex h-11 w-full items-center justify-center rounded-xl bg-emerald-600 text-sm font-bold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-300"
      >
        {applying ? t("Đang áp dụng trên Walmart...") : hasDisabledSelection ? t("Size đã chọn hết hàng, vui lòng chọn lại") : t("Dùng màu và size này")}
      </button>
      {applying ? (
        <div className="absolute inset-0 z-10 flex items-center justify-center rounded-2xl bg-white/70 backdrop-blur-sm">
          <div className="flex items-center gap-2 rounded-full border border-emerald-100 bg-white px-4 py-2 text-sm font-bold text-emerald-700 shadow-lg">
            <Spinner /> {t("Đang đợi Walmart áp dụng lựa chọn...")}
          </div>
        </div>
      ) : null}
      </div>
    </Section>
  );
}

function PaymentMethodSelector({ t }: { t: (vi: string, vars?: Record<string, string | number>) => string }) {
  return (
    <section className="rounded-2xl border border-slate-400 p-3">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">{t("PHƯƠNG THỨC THANH TOÁN")}</h3>
      <div className="grid grid-cols-3 gap-2">
        <button
          type="button"
          disabled
          className="flex min-h-[3.25rem] items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-2 text-center text-xs font-semibold text-slate-400 opacity-70"
          title={t("Walmart hiện chưa bật QR")}
        >
          <span className="text-base">▦</span>
          <span>{t("QR")}</span>
        </button>
        <button
          type="button"
          aria-pressed="true"
          className="flex min-h-[3.25rem] items-center justify-center gap-1.5 rounded-xl border border-emerald-300 bg-emerald-50 px-2 text-center text-xs font-bold text-emerald-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.65)]"
        >
          <span className="text-base">💳</span>
          <span>{t("Thẻ")}</span>
        </button>
        <button
          type="button"
          disabled
          className="flex min-h-[3.25rem] items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-2 text-center text-xs font-semibold text-slate-400 opacity-70"
          title={t("Walmart hiện chưa bật COD")}
        >
          <span className="text-base">💵</span>
          <span>{t("COD")}</span>
        </button>
      </div>
      <p className="mt-2 text-[11px] font-medium leading-4 text-slate-500">
        {t("Walmart hiện chỉ hỗ trợ thanh toán bằng thẻ. Affree sẽ hỏi thông tin thẻ ở bước checkout.")}
      </p>
    </section>
  );
}

function WalmartOrderDetails({
  offer,
  qty,
  total,
  currency,
  t,
}: {
  offer: RankedOffer;
  qty: number;
  total: number;
  currency: string;
  t: (vi: string, vars?: Record<string, string | number>) => string;
}) {
  const compareTotal = total > 0 ? total / 0.7 : total;
  const savings = Math.max(0, compareTotal - total);
  return (
    <div className="rounded-2xl border border-slate-400 bg-white p-3">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-extrabold text-slate-900">{t("Items details")}</h3>
          <p className="mt-2 text-sm font-extrabold text-slate-900">{t("Arrives by Fri, Jul 10")}</p>
        </div>
        <p className="text-sm font-semibold text-slate-500">{qty} item</p>
      </div>
      <div className="border-t border-slate-200 pt-3">
        <p className="text-sm font-medium text-slate-600">Sold by Levi&apos;s</p>
        <p className="mt-1 text-sm font-extrabold text-slate-700">Fulfilled by Walmart</p>
        <p className="text-sm font-semibold text-blue-700">Free shipping</p>
      </div>
      <div className="mt-3 grid grid-cols-[72px_minmax(0,1fr)_auto] gap-3">
        {offer.product.image ? (
          <img src={offer.product.image} alt={offer.product.name} className="h-[72px] w-[72px] rounded-lg object-contain" />
        ) : (
          <div className="flex h-[72px] w-[72px] items-center justify-center rounded-lg bg-slate-100">🛒</div>
        )}
        <div className="min-w-0">
          <p className="line-clamp-2 text-sm font-semibold text-slate-800">{offer.product.name}</p>
          <p className="mt-1 text-xs font-medium leading-5 text-slate-500">
            Actual Color: Throttle - Stretch,<br /> Clothing Size: 33x30
          </p>
          <p className="text-xs font-medium text-slate-500">{formatMoney(offer.price, currency)}/ea</p>
          <p className="mt-3 text-sm font-medium text-slate-500">
            <span className="font-semibold text-green-700">{formatMoney(savings, currency)}</span> from savings
          </p>
        </div>
        <div className="text-right">
          <p className="text-lg font-extrabold text-green-700">{formatMoney(total, currency)}</p>
          <p className="text-xs font-medium text-slate-500 line-through">{formatMoney(compareTotal, currency)}</p>
        </div>
      </div>
      <div className="mt-4 flex items-center justify-end gap-4">
        <button type="button" className="text-sm font-medium text-slate-900 underline" disabled>
          Remove
        </button>
        <div className="flex h-9 min-w-[108px] items-center justify-between rounded-full border border-slate-300 px-3 text-sm font-bold text-slate-900">
          <span>−</span>
          <span>{qty}</span>
          <span>＋</span>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-400 p-3">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</h3>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold text-slate-800">{label}</span>
      {children}
    </label>
  );
}

function Notice({ children }: { children: ReactNode }) {
  return (
    <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-amber-900">
      {children}
    </div>
  );
}

function Timeline({ steps, activeIndex }: { steps: string[]; activeIndex: number }) {
  return (
    <div className="py-1">
      <ol className="space-y-3">
        {steps.map((label, index) => {
          const done = index < activeIndex;
          const active = index === activeIndex;
          return (
            <li key={label} className={`flex items-start gap-3 ${active ? "rounded-xl bg-white px-2.5 py-2" : ""}`}>
              <span className="mt-0.5 shrink-0">{done ? <CheckIcon /> : active ? <Spinner /> : <IdleIcon />}</span>
              <span className={`text-sm font-semibold leading-5 ${active ? "text-slate-800" : done ? "text-slate-400" : "text-slate-300"}`}>
                {label}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function SuccessPanel({
  t,
  code,
  offer,
  qty,
  total,
  currency,
  onClose,
}: {
  t: (vi: string, vars?: Record<string, string | number>) => string;
  code: string;
  offer: RankedOffer;
  qty: number;
  total: number;
  currency: string;
  onClose: () => void;
}) {
  return (
    <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-center">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100">
        <CheckLargeIcon />
      </div>
      <h3 className="mt-4 text-lg font-bold text-slate-900">{t("Đặt hàng Walmart mô phỏng thành công")}</h3>
      <p className="mt-1 text-sm font-semibold text-slate-500">{code}</p>
      <div className="mt-4 rounded-xl bg-white p-3 text-left text-sm">
        <Row k={t("Món")} v={`${offer.product.name} ×${qty}`} />
        <Row k={t("Tổng")} v={formatMoney(total, currency)} strong />
      </div>
      <button type="button" onClick={onClose} className="mt-4 flex h-11 w-full items-center justify-center rounded-xl bg-emerald-600 text-sm font-bold text-white transition hover:bg-emerald-700">
        {t("Xong")}
      </button>
    </div>
  );
}

function Row({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5">
      <span className="shrink-0 font-medium text-slate-500">{k}</span>
      <span className={`text-right ${strong ? "font-bold text-emerald-600" : "font-semibold text-slate-900"}`}>{v}</span>
    </div>
  );
}

function CloseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-100">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 6 9 17l-5-5" />
      </svg>
    </span>
  );
}

function CheckLargeIcon() {
  return (
    <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function Spinner() {
  return <span className="block h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-emerald-200 border-t-emerald-600" />;
}

function IdleIcon() {
  return <span className="block h-5 w-5 shrink-0 rounded-full border-2 border-dashed border-slate-300" />;
}
