"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { RankedOffer } from "@/lib/types";
import { chainLabel, storeCurrency } from "@/lib/stores";
import { distanceKm, formatMoney } from "@/lib/util";
import { flushProfile, getProfile, saveProfile } from "@/lib/profile";
import { geocode } from "@/lib/geocode";
import { getOrderConfig } from "@/lib/orderConfig";
import { type Lang, tr } from "@/lib/i18n";

/**
 * BẢN GIẢ LẬP (mock) — không gọi web thật.
 * Mô phỏng "trợ lý ảo" tự thao tác đặt hàng trên web cửa hàng, và DỪNG LẠI
 * ở những bước chỉ con người làm được: nhập OTP, xác minh CAPTCHA, và bấm
 * xác nhận đặt hàng cuối cùng. Mục đích: cho thấy CƠ CHẾ pause → user nhập →
 * resume trước khi làm thật.
 */

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
  initialQty,
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
  initialQty?: number;
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

  // Thông tin cần có để đặt món này — tự điền lại từ hồ sơ đã lưu (nếu có)
  const saved = useMemo(() => getProfile(), []);
  const [name, setName] = useState(defaultName || saved.name);
  const [phone, setPhone] = useState(defaultPhone || saved.phone);
  const [address, setAddress] = useState(defaultAddress || saved.address);
  const [email, setEmail] = useState("");
  const [qty, setQty] = useState(initialQty && initialQty > 0 ? initialQty : 1);
  const [slot, setSlot] = useState(SLOTS[0]);

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
  const [otp, setOtp] = useState("");
  const [otpError, setOtpError] = useState(false);
  // Mã OTP MÔ PHỎNG (bản demo chưa kết nối SMS thật): sinh ngẫu nhiên 6 số khi tới bước OTP,
  // hiển thị như "tin nhắn" để bạn nhập thử. KHÔNG phải mã thật từ cửa hàng.
  const [simOtp, setSimOtp] = useState("");
  const [orderCode, setOrderCode] = useState("");

  const steps: Step[] = useMemo(() => {
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
  }, [chain, cfg, phone, email, address, qty, slot, activeOffer.product.name, activeOffer.store.name, lang]);

  const current = steps[stepIndex];

  // Bước "auto" thì tự chạy tiếp sau 1 nhịp; bước cần người thì đứng chờ thao tác.
  useEffect(() => {
    if (phase !== "running") return;
    if (!current) return;
    if (current.kind === "auto") {
      const t = setTimeout(() => setStepIndex((i) => i + 1), 1000);
      return () => clearTimeout(t);
    }
    // Tới bước OTP → "cửa hàng gửi mã" (mô phỏng): sinh mã 6 số sau 1 nhịp như đợi SMS.
    if (current.kind === "otp" && !simOtp) {
      const t = setTimeout(
        () => setSimOtp(String(Math.floor(100000 + Math.random() * 900000))),
        800
      );
      return () => clearTimeout(t);
    }
    if (current.kind === "success") {
      const code = `#${activeOffer.store.chain.toUpperCase().slice(0, 4)}-${Math.floor(
        100000 + Math.random() * 900000
      )}`;
      setOrderCode(code);
      setPhase("done");
      onPlaced(code, activeOffer);
    }
  }, [phase, stepIndex, current, activeOffer, onPlaced, simOtp]);

  const total = activeOffer.price * qty;

  // Kiểm tra SĐT di động VN: 10 số, đầu 0, số thứ 2 thuộc {3,5,7,8,9}.
  // Chấp nhận cả tiền tố +84 / 84 và khoảng trắng/dấu chấm/gạch.
  const phoneDigits = phone.replace(/[\s.\-()]/g, "").replace(/^(\+?84)/, "0");
  const phoneValid = /^0[35789]\d{8}$/.test(phoneDigits);
  const phoneError = phone.trim().length > 0 && !phoneValid;

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const emailError = cfg.needEmail && email.trim().length > 0 && !emailValid;
  const canStart =
    !!name.trim() && phoneValid && !!address.trim() && (!cfg.needEmail || emailValid);

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
      className="fixed inset-0 z-[1100] flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.35)", backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)" }}
      onClick={onClose}
    >
      <div
        className="relative flex max-h-[92vh] w-full max-w-md flex-col overflow-hidden rounded-3xl"
        onClick={(e) => e.stopPropagation()}
        style={{
          backdropFilter: "blur(64px) saturate(180%)",
          WebkitBackdropFilter: "blur(64px) saturate(180%)",
          backgroundColor: "rgba(255,255,255,0.28)",
          boxShadow: "0 0 0 1px rgba(255,255,255,0.35), 0 0 0 0.5px rgba(255,255,255,0.2), 0 16px 48px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.6)",
        }}
      >
        {/* Glass top highlight — specular reflection */}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-20 rounded-t-3xl" style={{ background: "linear-gradient(170deg, rgba(255,255,255,0.38) 0%, rgba(255,255,255,0.06) 60%, rgba(255,255,255,0) 100%)" }} />
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/20 px-4 py-3">
          <div className="min-w-0">
            <h2 className="truncate text-base font-bold text-slate-900">
              {phase === "done" ? t("Đã đặt hàng") : t("Phục vụ bởi Agentic AI")}
              {/* tên cũ: "Đặt hàng bằng trợ lý ảo" */}
            </h2>
            <p className="truncate text-xs text-slate-700">
              {activeOffer.product.name} · {chain}
            </p>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 rounded-full p-1.5 text-slate-500 hover:bg-white/40"
            aria-label={t("Đóng")}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="overflow-y-auto overscroll-contain px-4 py-4">
          {/* Banner: bản mô phỏng */}
          <div className="mb-4 rounded-lg border border-amber-300/40 bg-amber-100/30 px-3 py-2 text-xs text-amber-900">
            ⚙️ {t("Bản mô phỏng — chưa kết nối web thật. Dùng để xem cơ chế trợ lý tự thao tác và dừng lại khi cần bạn.")}
          </div>

          {/* PHASE 1: form thông tin cần có */}
          {phase === "form" && (
            <div className="space-y-3">
              {/* Sản phẩm đang đặt — qty control nằm bên phải */}
              <div className="flex items-center gap-3 rounded-xl border border-white/30 bg-white/20 p-3">
                {activeOffer.product.image ? (
                  <img
                    src={activeOffer.product.image}
                    alt={activeOffer.product.name}
                    className="h-14 w-14 shrink-0 rounded-lg object-contain bg-white/30"
                  />
                ) : (
                  <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-2xl">
                    🛒
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-slate-900">{activeOffer.product.name}</p>
                  <p className="mt-0.5 truncate text-xs text-slate-700">{chain} · {activeOffer.store.name}</p>
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
                      className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/40 bg-white/25 text-base font-medium hover:bg-white/40"
                    >
                      −
                    </button>
                    <span className="w-6 text-center text-sm font-semibold">{qty}</span>
                    <button
                      onClick={() => setQty((q) => q + 1)}
                      className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/40 bg-white/25 text-base font-medium hover:bg-white/40"
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

              {/* Mỗi nguồn yêu cầu khác nhau */}
              <div className="rounded-lg border border-white/25 bg-white/15 px-3 py-2.5">
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

              <div className="rounded-lg bg-white/20 px-3 py-2.5 text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-slate-800">{t("Thanh toán")}</span>
                  <span className="font-semibold text-slate-800">{t("COD (tiền mặt khi nhận)")}</span>
                </div>
                <p className="mt-1 text-[11px] text-slate-600">
                  {t("{chain} hỗ trợ: {payments}. Affree chỉ đặt COD — không thu thập thông tin thẻ.", { chain, payments: cfg.payments.join(" · ") })}
                </p>
              </div>

              <div className="flex items-center justify-between border-t border-white/25 pt-3">
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
                className="w-full rounded-xl bg-emerald-600 py-3 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {t("Để trợ lý đặt giúp →")}
              </button>
              {!canStart && (
                <p className="text-center text-xs text-slate-400">
                  {t("Nhập đủ tên, số điện thoại và địa chỉ để bắt đầu.")}
                </p>
              )}
            </div>
          )}

          {/* PHASE 2: trợ lý chạy */}
          {phase === "running" && (
            <div className="space-y-1">
              <ol className="space-y-2.5">
                {steps.slice(0, stepIndex + 1).map((s, i) => {
                  const isCurrent = i === stepIndex;
                  const done = i < stepIndex;
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
                          className={`text-sm ${
                            done ? "text-slate-400" : "font-medium text-slate-800"
                          }`}
                        >
                          {s.label}
                        </p>

                        {/* Khối tương tác khi tới bước cần người */}
                        {isCurrent && s.kind === "login" && (
                          <PauseBox tone="blue" hint={t("🔐 Trợ lý KHÔNG nhập mật khẩu giúp bạn. Bạn tự đăng nhập rồi bấm tiếp.")}>
                            <button
                              onClick={() => setStepIndex((x) => x + 1)}
                              className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700"
                            >
                              {t("Tôi đã đăng nhập xong →")}
                            </button>
                          </PauseBox>
                        )}

                        {isCurrent && s.kind === "otp" && (
                          <PauseBox tone="blue" hint={t("🔐 Trợ lý không tự đọc được OTP — bạn nhập mã giúp.")}>
                            {/* "Tin nhắn" OTP mô phỏng: hiện mã để bạn nhập thử (bản demo, không phải SMS thật). */}
                            {!simOtp ? (
                              <div className="mb-2 flex items-center gap-2 rounded-lg bg-white px-2.5 py-2 text-xs text-slate-500">
                                <Spinner />
                                {t("Đang chờ {chain} gửi mã…", { chain })}
                              </div>
                            ) : (
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
                            )}
                            <div className="flex gap-2">
                              <input
                                value={otp}
                                onChange={(e) => {
                                  setOtp(e.target.value.replace(/\D/g, "").slice(0, 6));
                                  setOtpError(false);
                                }}
                                inputMode="numeric"
                                placeholder={t("Nhập mã OTP")}
                                className="input flex-1"
                                autoFocus
                              />
                              <button
                                disabled={otp.length < 4 || !simOtp}
                                onClick={() => {
                                  if (otp !== simOtp) {
                                    setOtpError(true);
                                    return;
                                  }
                                  setOtp("");
                                  setOtpError(false);
                                  setSimOtp("");
                                  setStepIndex((x) => x + 1);
                                }}
                                className="shrink-0 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-50"
                              >
                                {t("Gửi")}
                              </button>
                            </div>
                            {otpError && (
                              <p className="mt-1.5 text-xs font-medium text-rose-600">
                                {t("Mã chưa đúng — nhập đúng {otp} (hoặc bấm “Điền giúp”).", { otp: simOtp })}
                              </p>
                            )}
                          </PauseBox>
                        )}

                        {isCurrent && s.kind === "captcha" && (
                          <PauseBox tone="amber" hint={t("🤖 Trợ lý không vượt CAPTCHA. Bạn xác minh giúp (mô phỏng).")}>
                            <button
                              onClick={() => setStepIndex((x) => x + 1)}
                              className="flex w-full items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-left text-sm hover:bg-slate-50"
                            >
                              <span className="flex h-5 w-5 items-center justify-center rounded border-2 border-slate-400 text-emerald-600">
                                ✓
                              </span>
                              {t("Tôi không phải là người máy")}
                            </button>
                          </PauseBox>
                        )}

                        {isCurrent && s.kind === "confirm" && (
                          <PauseBox tone="emerald" hint={t("✋ Bước cuối không thể hoàn tác — bạn duyệt rồi trợ lý mới đặt.")}>
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
                              onClick={() => setStepIndex((x) => x + 1)}
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
      `}</style>
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
