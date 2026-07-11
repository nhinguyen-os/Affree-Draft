"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode, type WheelEvent } from "react";
import type { RankedOffer } from "@/lib/types";
import { chainLabel, storeCurrency } from "@/lib/stores";
import { formatMoney } from "@/lib/util";
import { type Lang, tr } from "@/lib/i18n";
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
  lang = "vi",
}: {
  offer: RankedOffer;
  defaultName?: string;
  defaultPhone?: string;
  defaultAddress?: string;
  defaultQty?: number;
  onClose: () => void;
  onPlaced: (orderCode: string, chosen: RankedOffer) => void;
  lang?: Lang;
}) {
  const t = (vi: string, vars?: Record<string, string | number>) => tr(lang, vi, vars);
  const currency = storeCurrency(offer.store.id);
  const chain = chainLabel(offer.store.chain);
  const [phase, setPhase] = useState<Phase>("form");
  const [qty, setQty] = useState(defaultQty && defaultQty > 0 ? Math.floor(defaultQty) : 1);
  const defaultNameParts = (defaultName || "").trim().split(/\s+/).filter(Boolean);
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState(defaultPhone || "");
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
  const wsRef = useRef<WebSocket | null>(null);
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
      const ws = wsRef.current;
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "user_cancelled" }));
      }
      ws?.close();
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
  const canStart = Boolean(offer.productUrl)
    && qty > 0
    && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
    && Boolean(phone.trim() && firstName.trim() && lastName.trim() && street.trim() && city.trim() && stateCode && zipCode.trim());

  const steps = useMemo(
    () => [
      t("Mở Walmart.com..."),
      t("Đăng nhập tài khoản Walmart đặt hộ..."),
      t('Thêm "{product}" vào giỏ (SL {qty})...', { product: offer.product.name, qty }),
      t("Mở checkout để bạn nhập địa chỉ và tiếp tục..."),
    ],
    [offer.product.name, qty, t],
  );

  function updateProgress(message: string) {
    const normalized = message.toLowerCase();
    setAgentMessage(message);
    if (/đăng nhập thành công|xác nhận đã đăng nhập/.test(normalized)) setRunIdx((value) => Math.max(value, 2));
    if (/thêm sản phẩm vào giỏ thành công|added to cart|đã thêm.*giỏ/.test(normalized)) setRunIdx((value) => Math.max(value, 3));
    if (/checkout|kiểm tra đơn|review/.test(normalized)) setRunIdx((value) => Math.max(value, steps.length - 1));
  }

  function sendOrder(ws: WebSocket) {
    ws.send(JSON.stringify({
      type: "run_order",
      payload: {
        url: offer.productUrl,
        productUrl: offer.productUrl,
        productName: offer.product.name,
        qty,
        buyerName: `${firstName} ${lastName}`.trim(),
        buyerPhone: phone.trim(),
        buyerAddress: [street, apt, city, stateCode, zipCode, "United States"].filter(Boolean).join(", "),
        chain: "walmart",
        customer: { name: `${firstName} ${lastName}`.trim(), phone: phone.trim(), email: email.trim() },
        address: {
          country: "United States",
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          street: street.trim(),
          apt: apt.trim(),
          city: city.trim(),
          state: stateCode,
          zipCode: zipCode.trim(),
          phone: phone.trim(),
          email: email.trim(),
        },
      },
    }));
  }

  async function startAgentOrder() {
    if (!canStart) return;
    wsRef.current?.close();
    setAgentError("");
    setAgentMessage(t("Đang kết nối trợ lý AAAI Walmart..."));
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
            setPhase("running");
          } else if (message.phase === "waiting_user_input") {
            const reason = String(message.pauseReason || message.reason || "other");
            const pauseMessage = String(message.reason || t("Vui lòng thao tác trên màn hình rồi bấm Tiếp tục."));
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
            const code = String(message.orderId || message.orderCode || `WM-${String(Date.now()).slice(-8)}`);
            setOrderCode(code);
            setRunIdx(steps.length);
            setPauseContext(null);
            setPhase("done");
            onPlaced(code, offer);
          } else if (message.phase === "failed" || message.phase === "cancelled") {
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
        if (wsRef.current === ws) wsRef.current = null;
      };
    } catch (error) {
      setAgentError(error instanceof Error ? error.message : t("Không mở được phiên Walmart."));
      setPhase("failed");
    }
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
    setPauseContext(null);
    setPhase("running");
    setAgentMessage(t("Đang áp dụng màu và kích thước trên Walmart..."));
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
  const showInteractiveScreen = phase === "interactive" && Boolean(pauseContext) && !showNativeVariantForm;
  const frameAspectRatio = `${Math.max(1, frame.width || 1)} / ${Math.max(1, frame.height || 1)}`;

  return (
    <div
      className="fixed inset-0 z-[2300] flex items-center justify-center p-4"
      style={{ background: "rgba(15,23,42,0.38)", backdropFilter: "blur(9px)", WebkitBackdropFilter: "blur(9px)" }}
    >
      <div
        className={`relative flex max-h-[92vh] w-full flex-col overflow-hidden rounded-3xl border border-white/60 bg-white/90 shadow-[0_28px_80px_rgba(15,23,42,0.28),inset_0_1px_0_rgba(255,255,255,0.72)] backdrop-blur-2xl transition-[max-width] duration-300 ${showInteractiveScreen ? "h-[92vh] max-w-[1180px]" : "max-w-[430px]"}`}
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
          <button type="button" onClick={onClose} className="shrink-0 rounded-full p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700" aria-label={t("Đóng")}>
            <CloseIcon />
          </button>
        </div>

        <div className={`min-h-0 flex-1 ${showInteractiveScreen ? "grid overflow-hidden lg:grid-cols-[390px_minmax(0,1fr)]" : "overflow-y-auto"}`}>
          <div className={`min-h-0 touch-pan-y overscroll-contain px-3 py-3 [scrollbar-gutter:stable] ${showInteractiveScreen ? "h-full overflow-y-auto border-r border-slate-200" : "pb-28"}`}>
          <Notice>
            {phase === "form"
              ? t("Affree sẽ tự đăng nhập, mở đúng sản phẩm và thêm vào giỏ. Màn hình chỉ hiện khi bạn cần thao tác hoặc khi tới checkout.")
              : t("Đang chạy luồng Walmart thật. Affree sẽ dừng đúng lúc cần bạn hỗ trợ.")}
          </Notice>

          {phase === "form" && (
            <div className="space-y-4">
              <ProductSummary
                offer={offer}
                qty={qty}
                setQty={setQty}
                total={total}
                currency={currency}
                t={t}
              />

              <Section title={t("Thông tin liên hệ và địa chỉ giao hàng")}>
                <div className="grid grid-cols-2 gap-3">
                  <Field label={t("First name")}>
                    <input value={firstName} onChange={(event) => setFirstName(event.target.value)} className="walmart-input" autoComplete="given-name" />
                  </Field>
                  <Field label={t("Last name")}>
                    <input value={lastName} onChange={(event) => setLastName(event.target.value)} className="walmart-input" autoComplete="family-name" />
                  </Field>
                </div>
                <Field label={t("Email")}>
                  <input value={email} onChange={(event) => setEmail(event.target.value)} className="walmart-input" inputMode="email" autoComplete="email" placeholder="name@example.com" />
                </Field>
                <Field label={t("Phone number")}>
                  <input value={phone} onChange={(event) => setPhone(event.target.value)} className="walmart-input" inputMode="tel" autoComplete="tel" placeholder="+1 555 123 4567" />
                </Field>
                <Field label={t("Street address")}>
                  <div className="relative">
                    <input
                      value={street}
                      onChange={(event) => { setStreet(event.target.value); setAddressSuggestionOpen(true); }}
                      onFocus={() => setAddressSuggestionOpen(true)}
                      className="walmart-input"
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
                            className="block w-full border-t border-slate-100 px-3 py-2 text-left text-xs font-medium leading-5 text-slate-700 hover:bg-blue-50"
                          >
                            {suggestion.label}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </Field>
                <Field label={t("Apt, suite, etc. (tuỳ chọn)")}>
                  <input value={apt} onChange={(event) => setApt(event.target.value)} className="walmart-input" autoComplete="address-line2" />
                </Field>
                <div className="grid grid-cols-[1fr_82px_100px] gap-2">
                  <Field label={t("City")}>
                    <input value={city} onChange={(event) => setCity(event.target.value)} className="walmart-input" autoComplete="address-level2" />
                  </Field>
                  <Field label={t("State")}>
                    <input value={stateCode} onChange={(event) => setStateCode(event.target.value.toUpperCase().slice(0, 2))} className="walmart-input" autoComplete="address-level1" placeholder="CA" />
                  </Field>
                  <Field label={t("ZIP")}>
                    <input value={zipCode} onChange={(event) => setZipCode(event.target.value)} className="walmart-input" inputMode="numeric" autoComplete="postal-code" />
                  </Field>
                </div>
                <p className="text-xs font-medium leading-5 text-slate-500">
                  {t("Affree dùng tài khoản đặt hộ từ hệ thống. Nếu Walmart yêu cầu CAPTCHA, màn hình xác minh sẽ tự xuất hiện.")}
                </p>
              </Section>

            </div>
          )}

          {(phase === "connecting" || phase === "running" || phase === "interactive") && (
            <div className="space-y-3">
              <Timeline steps={steps} activeIndex={runIdx} />
              {agentMessage && (
                <div className="rounded-xl border border-blue-100 bg-blue-50 px-3 py-2 text-xs font-medium leading-5 text-blue-800">
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
              {showNativeVariantForm && pauseContext.optionGroups && (
                <VariantSelector
                  groups={pauseContext.optionGroups}
                  selections={variantSelections}
                  onSelect={(group, option) => {
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
              {pauseContext && !["address", "review", "checkout_options", "payment", "captcha", "variant"].includes(pauseContext.reason) && (
                <button
                  type="button"
                  onClick={resumeAgent}
                  disabled={pauseContext.reason === "otp" && !otp.trim()}
                  className="flex h-11 w-full items-center justify-center rounded-xl bg-[#0071dc] text-sm font-bold text-white transition hover:bg-[#045ba8] disabled:bg-slate-300"
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
              onClose={onClose}
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
          <div className="border-t border-slate-200/70 bg-white/95 px-4 py-3 backdrop-blur">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm font-semibold text-slate-800">{t("Tạm tính")}</span>
              <span className="text-base font-bold text-[#0071dc]">{formatMoney(total, currency)}</span>
            </div>
            <button
              type="button"
              disabled={!canStart}
              onClick={startAgentOrder}
              className="flex h-11 w-full items-center justify-center rounded-xl bg-[#0071dc] text-sm font-bold text-white shadow-[0_10px_24px_rgba(0,113,220,0.18)] transition hover:bg-[#045ba8] disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500 disabled:shadow-none"
            >
              {t("Để trợ lý AAAI đặt giúp →").replace(/\s*→\s*/g, "")} (1 {t("cửa hàng")})
            </button>
            <p className="mt-2 text-center text-xs font-medium text-slate-400">
              {canStart
                ? t("Trợ lý AAAI sẽ dùng tài khoản đặt hộ, cho chọn biến thể nếu có, rồi mới thêm vào giỏ.")
                : t("Nhập đủ email, số điện thoại và địa chỉ giao hàng tại Mỹ để bắt đầu.")}
            </p>
            <p className="mt-1.5 text-center text-[10px] text-slate-400">
              {t("Phục vụ bởi Affree Agentic AI - AAAI")}
            </p>
          </div>
        )}
      </div>

      <style jsx global>{`
        .walmart-input {
          width: 100%;
          min-height: 2.75rem;
          border-radius: 0.75rem;
          border: 1px solid #cbd5e1;
          background: rgba(255,255,255,0.82);
          padding: 0.5rem 0.75rem;
          font-size: 0.875rem;
          color: #0f172a;
          outline: none;
          transition: border-color 0.15s, box-shadow 0.15s, background 0.15s;
        }
        .walmart-input::placeholder { color: #94a3b8; }
        .walmart-input:focus {
          border-color: #0071dc;
          background: white;
          box-shadow: 0 0 0 3px rgba(0,113,220,0.14);
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
}: {
  offer: RankedOffer;
  qty: number;
  setQty: (qty: number) => void;
  total: number;
  currency: string;
  t: (vi: string, vars?: Record<string, string | number>) => string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3">
      <div className="flex items-center gap-3">
        {offer.product.image ? (
          <img src={offer.product.image} alt={offer.product.name} className="h-14 w-14 shrink-0 rounded-lg bg-white object-contain p-1" />
        ) : (
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-white text-sm font-bold text-[#0071dc]">W</div>
        )}
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-sm font-bold text-slate-900">{offer.product.name}</p>
          <p className="mt-0.5 truncate text-xs text-slate-500">{offer.store.name}</p>
          <p className="mt-1 text-base font-bold text-[#0071dc]">{formatMoney(offer.price, currency)}</p>
        </div>
        <div className="shrink-0 text-right">
          <p className="mb-1 text-[11px] font-semibold text-slate-400">{t("Số lượng")}</p>
          <div className="flex items-center rounded-xl border border-slate-300 bg-white">
            <button type="button" className="flex h-8 w-8 items-center justify-center text-lg font-medium text-slate-700" onClick={() => setQty(Math.max(1, qty - 1))}>−</button>
            <span className="flex h-8 min-w-7 items-center justify-center text-sm font-semibold text-slate-900">{qty}</span>
            <button type="button" className="flex h-8 w-8 items-center justify-center text-lg font-medium text-slate-700" onClick={() => setQty(qty + 1)}>+</button>
          </div>
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between rounded-xl bg-white px-3 py-2 text-sm">
        <span className="font-semibold text-slate-600">{t("Tạm tính")}</span>
        <span className="font-bold text-[#0071dc]">{formatMoney(total, currency)}</span>
      </div>
    </div>
  );
}

function VariantSelector({
  groups,
  selections,
  onSelect,
  onSubmit,
  t,
}: {
  groups: VariantGroup[];
  selections: Record<string, VariantSelection>;
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
                    disabled={option.disabled}
                    onClick={() => onSelect(group.key, option)}
                    title={option.label}
                    aria-label={`${group.title}: ${option.label}`}
                    aria-pressed={selected}
                    className={`relative flex min-h-[82px] flex-col items-center justify-start rounded-xl border px-1.5 py-2 transition ${selected ? "border-[#0071dc] bg-blue-50 ring-2 ring-[#0071dc]/20" : "border-slate-200 bg-white hover:border-slate-400"} disabled:cursor-not-allowed disabled:opacity-45`}
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
                    disabled={option.disabled}
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
        disabled={!complete || hasDisabledSelection}
        className="flex h-11 w-full items-center justify-center rounded-xl bg-[#0071dc] text-sm font-bold text-white transition hover:bg-[#045ba8] disabled:cursor-not-allowed disabled:bg-slate-300"
      >
        {hasDisabledSelection ? t("Size đã chọn hết hàng, vui lòng chọn lại") : t("Dùng màu và size này")}
      </button>
    </Section>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-3">
      <h3 className="mb-3 text-sm font-bold text-slate-900">{title}</h3>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold text-slate-700">{label}</span>
      {children}
    </label>
  );
}

function Notice({ children }: { children: ReactNode }) {
  return (
    <div className="mb-3 rounded-xl border border-[#ffc220]/70 bg-[#fff7df] px-3 py-2 text-xs font-medium leading-5 text-[#7a4d00]">
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
