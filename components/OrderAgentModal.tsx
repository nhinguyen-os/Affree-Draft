"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { RankedOffer } from "@/lib/types";
import { chainLabel, storeCurrency } from "@/lib/stores";
import { distanceKm, formatMoney } from "@/lib/util";
import { flushProfile, getProfile, saveProfile } from "@/lib/profile";
import { geocode } from "@/lib/geocode";
import { getOrderConfig } from "@/lib/orderConfig";
import { type Lang, tr } from "@/lib/i18n";
import type { OrderRequiredInput, PublicOrderSessionState } from "@/lib/order-agent/types";

type StepKind = "auto" | "otp" | "login" | "captcha" | "confirm" | "success";
type Step = { kind: StepKind; label: string };

const SLOTS = [
  "Trong hôm nay (2–4 giờ)",
  "Tối nay (18:00–21:00)",
  "Sáng mai (8:00–11:00)",
  "Chiều mai (14:00–17:00)",
];

export default function OrderAgentModal({
  offer,
  alternatives = [],
  geoAddr,
  defaultName,
  defaultPhone,
  defaultAddress,
  onClose,
  onPlaced,
  lang = "vi",
}: {
  offer: RankedOffer;
  /** Các nơi bán khác cùng món này (đã xếp hạng) — để gợi ý chọn lại. */
  alternatives?: RankedOffer[];
  /** Địa chỉ theo định vị — so với địa chỉ giao để biết có lệch không. */
  geoAddr?: string;
  defaultName?: string;
  defaultPhone?: string;
  defaultAddress?: string;
  onClose: () => void;
  onPlaced: (orderCode: string, chosen: RankedOffer) => void;
  lang?: Lang;
}) {
  const t = (vi: string, vars?: Record<string, string | number>) => tr(lang, vi, vars);
  const [phase, setPhase] = useState<"form" | "running" | "done">("form");

  const [activeOffer, setActiveOffer] = useState<RankedOffer>(offer);
  const chain = chainLabel(activeOffer.store.chain);
  const cfg = useMemo(() => getOrderConfig(activeOffer.store.chain), [activeOffer.store.chain]);

  const saved = useMemo(() => getProfile(), []);
  const [name, setName] = useState(defaultName || saved.name);
  const [phone, setPhone] = useState(defaultPhone || saved.phone);
  const [address, setAddress] = useState(defaultAddress || saved.address);
  const [email, setEmail] = useState("");
  const [qty, setQty] = useState(1);
  const [slot, setSlot] = useState(SLOTS[0]);

  const firstRender = useRef(true);
  const placedRef = useRef(false);
  const [otp, setOtp] = useState("");
  const [otpError, setOtpError] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [serverState, setServerState] = useState<PublicOrderSessionState | null>(null);
  const [submitError, setSubmitError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [orderCode, setOrderCode] = useState("");

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    saveProfile({ name, phone, address });
  }, [name, phone, address]);

  useEffect(() => {
    if (phase !== "running" || !sessionId) return;
    let alive = true;

    const poll = async () => {
      try {
        const res = await fetch(`/api/order-sessions/${sessionId}`, { cache: "no-store" });
        const data = (await res.json()) as { ok: boolean; error?: string; state?: PublicOrderSessionState };
        if (!alive) return;
        if (!res.ok || !data.ok || !data.state) {
          setSubmitError(data.error || t("Không đọc được trạng thái phiên đặt hàng."));
          return;
        }
        setServerState(data.state);
      } catch {
        if (!alive) return;
        setSubmitError(t("Không đọc được trạng thái phiên đặt hàng."));
      }
    };

    void poll();
    const timer = window.setInterval(poll, 1200);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [phase, sessionId, t]);

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
  }, [serverState, activeOffer, onPlaced]);

  const total = activeOffer.price * qty;

  const phoneDigits = phone.replace(/[\s.\-()]/g, "").replace(/^(\+?84)/, "0");
  const phoneValid = /^0[35789]\d{8}$/.test(phoneDigits);
  const phoneError = phone.trim().length > 0 && !phoneValid;

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const emailError = cfg.needEmail && email.trim().length > 0 && !emailValid;
  const canStart =
    !!name.trim() && phoneValid && !!address.trim() && (!cfg.needEmail || emailValid) && !submitting;

  const requiredInput = serverState?.requiredInput;
  const currentStepKind: StepKind =
    requiredInput === "otp"
      ? "otp"
      : requiredInput === "captcha"
        ? "captcha"
        : requiredInput === "login"
          ? "login"
          : requiredInput === "final_confirmation"
            ? "confirm"
            : serverState?.status === "completed"
              ? "success"
              : "auto";

  const steps: Step[] = useMemo(() => {
    if (!serverState) return [];
    const timeline: Step[] = serverState.timeline.map((item) => ({ kind: "auto", label: item.message }));
    if (serverState.status === "completed") {
      timeline.push({ kind: "success", label: t("Đặt hàng thành công") });
    } else if (serverState.requiredInput) {
      timeline.push({ kind: currentStepKind, label: serverState.message });
    }
    return timeline;
  }, [currentStepKind, serverState, t]);

  const current = steps[steps.length - 1];

  async function createSession() {
    flushProfile({ name, phone, address });
    placedRef.current = false;
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
      const loc = await geocode(address);
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

  return (
    <div
      className="fixed inset-0 z-[1100] flex items-end justify-center bg-slate-900/50 p-0 sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[92vh] w-full max-w-md flex-col overflow-hidden rounded-t-2xl bg-white sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <div className="min-w-0">
            <h2 className="truncate text-base font-bold text-slate-900">
              {phase === "done" ? t("Đã đặt hàng") : t("Phục vụ bởi Agentic AI")}
              {/* tên cũ: "Đặt hàng bằng trợ lý ảo" */}
            </h2>
            <p className="truncate text-xs text-slate-500">
              {activeOffer.product.name} · {chain}
            </p>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 rounded-full p-1.5 text-slate-400 hover:bg-slate-100"
            aria-label={t("Đóng")}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="overflow-y-auto px-4 py-4">
          {/* Banner: bản mô phỏng */}
          <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            ⚙️ {t("Bản mô phỏng — chưa kết nối web thật. Dùng để xem cơ chế trợ lý tự thao tác và dừng lại khi cần bạn.")}
          </div>

          {/* PHASE 1: form thông tin cần có */}
          {phase === "form" && (
            <div className="space-y-3">
              {/* Mỗi nguồn yêu cầu khác nhau */}
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
                <p className="text-xs font-medium text-slate-500">
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
                  <p className="mt-1.5 text-[11px] text-slate-500">ℹ️ {t(cfg.note)}</p>
                )}
              </div>

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
                {phoneError && (
                  <span className="mt-1 block text-xs text-rose-600">
                    {t("Số điện thoại không hợp lệ — cần 10 số, bắt đầu bằng 03/05/07/08/09.")}
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
                      className={`rounded-md px-3 py-1 transition ${
                        repickSort === "near"
                          ? "bg-emerald-600 text-white"
                          : "text-slate-600 hover:bg-slate-100"
                      }`}
                    >
                      {t("Gần nhất")}
                    </button>
                    <button
                      onClick={() => setRepickSort("cheap")}
                      className={`rounded-md px-3 py-1 transition ${
                        repickSort === "cheap"
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
                          className={`flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-sm transition ${
                            active
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

              <div className={cfg.needSlot ? "grid grid-cols-2 gap-3" : ""}>
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
              </div>

              <div className="rounded-lg bg-slate-50 px-3 py-2.5 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">{t("Thanh toán")}</span>
                  <span className="font-semibold text-slate-800">{t("COD (tiền mặt khi nhận)")}</span>
                </div>
                <p className="mt-1 text-[11px] text-slate-400">
                  {t("{chain} hỗ trợ: {payments}. Affree chỉ đặt COD — không thu thập thông tin thẻ.", { chain, payments: cfg.payments.join(" · ") })}
                </p>
              </div>

              <div className="flex items-center justify-between border-t border-slate-200 pt-3">
                <span className="text-sm text-slate-500">{t("Tạm tính")}</span>
                <span className="text-lg font-bold text-emerald-600">{formatMoney(total, storeCurrency(activeOffer.store.id))}</span>
              </div>

              <button
                disabled={!canStart}
                onClick={createSession}
                className="w-full rounded-xl bg-emerald-600 py-3 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submitting ? t("Đang tạo phiên đặt hàng…") : t("Để trợ lý đặt giúp →")}
              </button>
              {!canStart && (
                <p className="text-center text-xs text-slate-400">
                  {t("Nhập đủ tên, số điện thoại và địa chỉ để bắt đầu.")}
                </p>
              )}
              {submitError && phase === "form" && (
                <p className="text-center text-xs font-medium text-rose-600">{submitError}</p>
              )}
            </div>
          )}

          {/* PHASE 2: trợ lý chạy */}
          {phase === "running" && (
            <div className="space-y-3">
              {serverState && (
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
                  <div className="flex items-center justify-between gap-3 text-xs text-slate-500">
                    <span>{t("Mã phiên")}: {serverState.id.slice(0, 8)}</span>
                    <span>{serverState.progress}%</span>
                  </div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200">
                    <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${serverState.progress}%` }} />
                  </div>
                  <p className="mt-2 text-sm font-medium text-slate-700">{serverState.message}</p>
                </div>
              )}

              <ol className="space-y-2.5">
                {steps.map((s, i) => {
                  const isCurrent = i === steps.length - 1;
                  const done = i < steps.length - 1;
                  return (
                    <li key={`${s.label}-${i}`} className="flex items-start gap-2.5">
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
                        <p className={`text-sm ${done ? "text-slate-400" : "font-medium text-slate-800"}`}>
                          {s.label}
                        </p>

                        {isCurrent && s.kind === "login" && (
                          <PauseBox tone="blue" hint={t("🔐 Giai đoạn này cần bạn tự tiếp tục trên website nguồn nếu worker yêu cầu đăng nhập.")}>
                            <a
                              href={serverState?.handoffUrl || activeOffer.productUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="mb-2 block rounded-lg border border-blue-200 bg-white px-3 py-2 text-center text-sm font-semibold text-blue-700 hover:bg-blue-50"
                            >
                              {t("Mở trang nguồn")}
                            </a>
                            <button
                              onClick={() => void sendSessionEvent({ type: "choose_handoff" })}
                              className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700"
                            >
                              {t("Chuyển sang tiếp tục thủ công")}
                            </button>
                          </PauseBox>
                        )}

                        {isCurrent && s.kind === "otp" && (
                          <PauseBox tone="blue" hint={t("🔐 Worker đang chờ OTP từ bạn để tiếp tục.")}>
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
                                disabled={otp.length < 4}
                                onClick={() => {
                                  if (otp.length < 4) {
                                    setOtpError(true);
                                    return;
                                  }
                                  void sendSessionEvent({ type: "otp_submitted", otp });
                                  setOtp("");
                                }}
                                className="shrink-0 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-50"
                              >
                                {t("Gửi")}
                              </button>
                            </div>
                            {otpError && (
                              <p className="mt-1.5 text-xs font-medium text-rose-600">
                                {t("Nhập OTP hợp lệ để tiếp tục.")}
                              </p>
                            )}
                          </PauseBox>
                        )}

                        {isCurrent && s.kind === "captcha" && (
                          <PauseBox tone="amber" hint={t("🤖 Worker đang chờ bạn xác minh CAPTCHA để tiếp tục.")}>
                            <button
                              onClick={() => void sendSessionEvent({ type: "captcha_completed" })}
                              className="flex w-full items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-left text-sm hover:bg-slate-50"
                            >
                              <span className="flex h-5 w-5 items-center justify-center rounded border-2 border-slate-400 text-emerald-600">
                                ✓
                              </span>
                              {t("Tôi đã xác minh CAPTCHA xong")}
                            </button>
                          </PauseBox>
                        )}

                        {isCurrent && s.kind === "confirm" && (
                          <PauseBox tone="emerald" hint={t("✋ Bước cuối không thể hoàn tác — bạn duyệt rồi worker mới gửi đơn.")}>
                            <div className="space-y-1.5 rounded-lg bg-white p-2.5 text-sm">
                              <Row k={t("Món")} v={`${activeOffer.product.name} ×${qty}`} />
                              <Row k={t("Nơi bán")} v={`${chain} · ${activeOffer.store.name}`} />
                              <Row k={t("Giao tới")} v={address} />
                              {cfg.needEmail && email.trim() && <Row k="Email" v={email} />}
                              {cfg.needSlot && <Row k={t("Khung giờ")} v={t(slot)} />}
                              <Row k={t("Thanh toán")} v="COD" />
                              <Row k={t("Tổng")} v={formatMoney(total, storeCurrency(activeOffer.store.id))} strong />
                            </div>
                            <button
                              onClick={() => void sendSessionEvent({ type: "confirm_final_action" })}
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

              {submitError && (
                <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
                  <p className="font-medium">{submitError}</p>
                  {serverState?.handoffUrl && (
                    <a
                      href={serverState.handoffUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-2 inline-block rounded-lg border border-rose-200 bg-white px-3 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-100"
                    >
                      {t("Mở trang nguồn để xử lý thủ công")}
                    </a>
                  )}
                </div>
              )}

              {serverState?.status === "running" || serverState?.requiredInput ? (
                <button
                  onClick={() => void sendSessionEvent({ type: "cancel" })}
                  className="w-full rounded-xl border border-slate-300 py-2.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-50"
                >
                  {t("Hủy phiên")}
                </button>
              ) : null}
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
              <h3 className="mt-3 text-lg font-bold text-slate-900">{t("Đặt hàng thành công!")}</h3>
              <p className="mt-1 text-sm text-slate-500">
                {t("Trợ lý đã đặt đơn trên {chain}. Mã đơn:", { chain })}
              </p>
              <p className="mt-1 text-base font-bold tracking-wide text-emerald-600">{orderCode}</p>

              <div className="mt-4 w-full space-y-1.5 rounded-xl bg-slate-50 p-3 text-left text-sm">
                <Row k={t("Món")} v={`${activeOffer.product.name} ×${qty}`} />
                <Row k={t("Nơi bán")} v={`${chain} · ${activeOffer.store.name}`} />
                <Row k={t("Giao tới")} v={address} />
                {cfg.needEmail && email.trim() && <Row k="Email" v={email} />}
                {cfg.needSlot && <Row k={t("Khung giờ")} v={t(slot)} />}
                <Row k={t("Thanh toán")} v="COD" />
                <Row k={t("Tổng")} v={formatMoney(total, storeCurrency(activeOffer.store.id))} strong />
              </div>

              <button
                onClick={onClose}
                className="mt-4 w-full rounded-xl bg-emerald-600 py-3 text-sm font-semibold text-white transition hover:bg-emerald-700"
              >
                {t("Xong")}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* tiện ích style cho input/select/textarea dùng chung */}
      <style jsx global>{`
        .input {
          width: 100%;
          border-radius: 0.5rem;
          border: 1px solid #cbd5e1;
          padding: 0.5rem 0.75rem;
          font-size: 0.875rem;
          outline: none;
          transition: border-color 0.15s, box-shadow 0.15s;
        }
        .input:focus {
          border-color: #10b981;
          box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.15);
        }
      `}</style>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-500">{label}</span>
      {children}
    </label>
  );
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
