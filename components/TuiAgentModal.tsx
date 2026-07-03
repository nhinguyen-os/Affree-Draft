"use client";

import { useEffect, useMemo, useState } from "react";
import QRCode from "react-qr-code";
import { formatMoney } from "@/lib/util";
import { flushProfile, getProfile, saveProfile } from "@/lib/profile";
import { chainLogo } from "@/lib/stores";
import { phoneRule } from "@/lib/phone";
import { type Lang, tr } from "@/lib/i18n";
import { acquireBodyScrollLock } from "@/lib/scroll-lock";
import OrderInfoSection from "./OrderInfoSection";
import PaymentSection, { CardInputs, usePaymentState } from "./PaymentSection";

/**
 * BẢN GIẢ LẬP (mock) — màn agentic đặt CẢ TÚI: liệt kê các món gom theo NGUỒN ĐÍCH
 * (chuỗi/nguồn thật sự bán món đó — bhx/THXL/coop/spe…) rồi đặt 1 lượt tại từng nguồn.
 * Form ĐỒNG BỘ với form giỏ hàng (CartModal): Thông tin chung (OrderInfoSection) +
 * section từng nguồn kiểu giỏ + Thanh toán chọn QR/Thẻ/COD (PaymentSection); trợ lý
 * chỉ dừng ở bước thanh toán (quét QR từng nguồn / nhập thẻ 1 lần).
 */
export interface TuiAgentLine {
  productId: string;
  name: string;
  image?: string;
  /** Nhãn NGUỒN ĐÍCH nơi mua món này (vd "Bách Hóa Xanh", "Tạp Hóa Xe Lam"). */
  sourceLabel: string;
  /** Mã nguồn (bhx/THXL/coop/spe…) — để lấy logo nguồn giống section giỏ hàng. */
  chain?: string;
  storeName: string;
  price: number;
  qty: number;
}

type Step = { label: string; pause?: "pay-qr" | "pay-card"; source?: string; amount?: number };

export default function TuiAgentModal({
  tuiName,
  lines,
  comboPrice,
  lang = "vi",
  defaultName,
  defaultPhone,
  defaultAddress,
  onClose,
  onPlaced,
}: {
  tuiName: string;
  lines: TuiAgentLine[];
  comboPrice: number;
  lang?: Lang;
  defaultName?: string;
  defaultPhone?: string;
  defaultAddress?: string;
  onClose: () => void;
  onPlaced: (orderCode: string) => void;
}) {
  const t = (vi: string, vars?: Record<string, string | number>) => tr(lang, vi, vars);
  const [phase, setPhase] = useState<"form" | "running" | "done">("form");
  const saved = useMemo(() => getProfile(), []);
  const [name, setName] = useState(defaultName || saved.name);
  const [phone, setPhone] = useState(defaultPhone || saved.phone);
  const [address, setAddress] = useState(defaultAddress || saved.address);
  const [orderCode, setOrderCode] = useState("");
  const [runIdx, setRunIdx] = useState(0);
  // Thanh toán — module chung với giỏ hàng (QR/Thẻ/COD + thẻ đã lưu).
  const pay = usePaymentState();
  // Thẻ nhập/xác nhận 1 lần — các nguồn sau tự dùng lại (giống giỏ).
  const [cardConfirmed, setCardConfirmed] = useState(false);

  // Gom món theo NGUỒN ĐÍCH để hiển thị + đặt theo từng nguồn.
  const groups = useMemo(() => {
    const m = new Map<string, TuiAgentLine[]>();
    for (const l of lines) {
      if (!m.has(l.sourceLabel)) m.set(l.sourceLabel, []);
      m.get(l.sourceLabel)!.push(l);
    }
    return [...m.entries()].map(([source, items]) => ({
      source,
      chain: items[0]?.chain || "",
      items,
      total: items.reduce((s, it) => s + it.price * it.qty, 0),
    }));
  }, [lines]);

  // Cùng rule VND với OrderInfoSection để gating khớp với lỗi hiển thị trong form.
  const rule = useMemo(() => phoneRule("VND"), []);
  const phoneValid = rule.test(phone);
  const infoReady = !!name.trim() && phoneValid && !!address.trim();
  // Giống giỏ: đủ thông tin giao + đã CHỌN phương thức (QR/thẻ thao tác ở bước trợ lý).
  const canStart = infoReady && pay.method !== null;
  const orderHint = !infoReady
    ? t("Nhập đủ tên, số điện thoại và địa chỉ để bắt đầu.")
    : !pay.method
      ? t("Chọn phương thức thanh toán để tiếp tục.")
      : "";
  const maskedCardLabel = `${pay.cardBrand ?? t("Thẻ")} ****${pay.cardLast4}`;

  // Khoá scroll nền (refcount chung — lib/scroll-lock.ts) + lưu hồ sơ khi gõ.
  useEffect(() => acquireBodyScrollLock(), []);
  useEffect(() => { saveProfile({ name, phone, address }); }, [name, phone, address]);

  // Các bước trợ lý: mỗi nguồn 1 bước "đặt" + 1 bước thanh toán (QR dừng từng nguồn,
  // thẻ dừng 1 lần, COD tự chạy) — giống kế hoạch từng cửa hàng của giỏ.
  const steps = useMemo(() => {
    const s: Step[] = [];
    for (const g of groups) {
      s.push({ label: t("Đặt {n} món trên {source}…", { n: g.items.length, source: g.source }) });
      if (pay.method === "qr") {
        s.push({ label: t("Quét QR chuyển khoản cho {chain}…", { chain: g.source }), pause: "pay-qr", source: g.source, amount: g.total });
      } else if (pay.method === "card") {
        s.push({ label: t("Nhập thẻ thanh toán…"), pause: "pay-card", source: g.source, amount: g.total });
      } else {
        s.push({ label: t("Thanh toán khi nhận hàng (COD)…") });
      }
    }
    s.push({ label: t("Điền thông tin giao hàng…") });
    s.push({ label: t("Xác nhận & gửi đơn…") });
    return s;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups, pay.method, lang]);

  // Auto-advance khi đang chạy — dừng ở bước pause (QR từng nguồn / thẻ chưa xác nhận);
  // xong hết thì sinh mã đơn + báo về.
  useEffect(() => {
    if (phase !== "running") return;
    if (runIdx >= steps.length) {
      const code = "AFF-" + String(Date.now()).slice(-6) + "-" + Math.floor(Math.random() * 900 + 100);
      setOrderCode(code);
      setPhase("done");
      onPlaced(code);
      return;
    }
    const cur = steps[runIdx];
    const paused = cur.pause && !(cur.pause === "pay-card" && cardConfirmed);
    if (paused) return;
    const id = setTimeout(() => setRunIdx((i) => i + 1), 750);
    return () => clearTimeout(id);
  }, [phase, runIdx, steps, cardConfirmed, onPlaced]);

  const total = comboPrice || lines.reduce((s, l) => s + l.price * l.qty, 0);

  // Bấm "Để trợ lý đặt cả túi" — giống startAgent của giỏ.
  const startAgent = () => {
    flushProfile({ name, phone, address });
    // Thẻ đã điền ĐỦ ở form → coi như xác nhận luôn, trợ lý tự thanh toán không dừng hỏi.
    setCardConfirmed(pay.method === "card" && pay.cardReady);
    // Thẻ MỚI hợp lệ → lưu lại (localStorage, không CVV) cho lần mua sau chọn nhanh.
    pay.commitCard();
    setRunIdx(0);
    setPhase("running");
  };

  return (
    <div
      className="fixed inset-0 z-[2200] flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.35)", backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)" }}
      onClick={onClose}
    >
      <div
        className="relative flex max-h-[92vh] w-full max-w-md flex-col overflow-hidden rounded-3xl"
        onClick={(e) => e.stopPropagation()}
        style={{
          backdropFilter: "blur(24px) saturate(160%)",
          WebkitBackdropFilter: "blur(24px) saturate(160%)",
          backgroundColor: "rgba(255,255,255,0.88)",
          boxShadow: "0 0 0 1px rgba(255,255,255,0.5), 0 16px 48px rgba(0,0,0,0.18), inset 0 1px 0 rgba(255,255,255,0.7)",
        }}
      >
        <div className="pointer-events-none absolute inset-x-0 top-0 h-20 rounded-t-3xl" style={{ background: "linear-gradient(170deg, rgba(255,255,255,0.38) 0%, rgba(255,255,255,0.06) 60%, rgba(255,255,255,0) 100%)" }} />
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/20 px-4 py-3">
          <div className="min-w-0">
            <h2 className="truncate text-base font-bold text-slate-900">
              {phase === "done" ? t("Đã đặt cả túi") : t("Phục vụ bởi Affree Agentic AI - AAAI")}
            </h2>
            <p className="truncate text-xs text-slate-700">
              🛍️ {tuiName} · {lines.length} {t("món")} · {groups.length} {t("nguồn")}
            </p>
          </div>
          <button onClick={onClose} className="shrink-0 rounded-full p-1.5 text-slate-500 hover:bg-white/40" aria-label={t("Đóng")}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 py-4">
          <div className="mb-4 rounded-lg border border-amber-300/40 bg-amber-100/30 px-3 py-2 text-xs text-amber-900">
            ⚙️ {t("Bản mô phỏng — chưa kết nối web thật. Trợ lý đặt cả túi tại từng nguồn đích.")}
          </div>

          {/* PHASE 1: form — Thông tin chung + từng nguồn + Thanh toán (đồng bộ giỏ hàng) */}
          {phase === "form" && (
            <div className="space-y-3">
              {/* ── Thông tin chung — MODULE CHUNG với form giỏ hàng / Mua ngay ── */}
              <OrderInfoSection
                lang={lang}
                name={name}
                phone={phone}
                address={address}
                onName={setName}
                onPhone={setPhone}
                onAddress={setAddress}
              />

              {/* ── Section từng NGUỒN — cùng cấu trúc với section từng cửa hàng của giỏ ── */}
              {groups.map((g) => (
                <section key={g.source} className="rounded-2xl border border-slate-200 p-3">
                  <div className="mb-2.5 flex items-center gap-2">
                    <span className="relative flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-emerald-100 text-xs font-bold text-emerald-700 ring-1 ring-slate-200">
                      {g.source.slice(0, 2).toUpperCase()}
                      {g.chain && chainLogo(g.chain) && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={chainLogo(g.chain)}
                          alt={g.source}
                          className="absolute inset-0 h-full w-full bg-white object-contain p-0.5"
                          onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                        />
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-slate-800">{g.source}</p>
                      <p className="text-xs text-slate-500">
                        {g.items.length} {t("món")} ·{" "}
                        <span className="font-medium text-rose-600">{formatMoney(g.total)}</span>
                      </p>
                    </div>
                  </div>

                  <div className="space-y-2">
                    {g.items.map((it) => (
                      <div key={it.productId} className="flex items-center gap-2 rounded-xl bg-slate-50 p-2">
                        {it.image ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={it.image} alt={it.name} className="h-12 w-12 shrink-0 rounded-lg bg-white object-contain" />
                        ) : (
                          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-white text-lg">🛒</div>
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="line-clamp-2 text-xs font-medium leading-tight text-slate-700">{it.name}</p>
                          <p className="mt-0.5 text-xs font-semibold text-rose-600">
                            {formatMoney(it.price)}
                            {it.qty > 1 && <span className="ml-1 font-normal text-slate-400">× {it.qty}</span>}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              ))}

              {/* ── Thanh toán — MODULE CHUNG với form giỏ hàng (QR/Thẻ/COD + thẻ đã lưu) ── */}
              <PaymentSection
                pay={pay}
                lang={lang}
                phone={phone}
                qrHintVi="Trợ lý sẽ hiện mã QR để bạn quét tại từng nguồn khi đặt."
              />
              <p className="px-1 text-[11px] text-slate-500">
                {t("Túi gom món từ {n} nguồn → trợ lý đặt trực tiếp tại từng nguồn đích, giao theo từng nguồn.", { n: groups.length })}
              </p>
            </div>
          )}

          {/* PHASE 2: trợ lý chạy — dừng ở bước thanh toán (QR từng nguồn / thẻ 1 lần) */}
          {phase === "running" && (
            <div className="space-y-2 py-1">
              {steps.map((st, i) => {
                const done = i < runIdx;
                const active = i === runIdx;
                const pausedHere = active && !!st.pause && !(st.pause === "pay-card" && cardConfirmed);
                const label =
                  st.pause === "pay-card" && cardConfirmed
                    ? t("Thanh toán bằng thẻ đã lưu…") + (pay.cardLast4 ? ` (${maskedCardLabel})` : "")
                    : st.label;
                return (
                  <div key={i} className={`rounded-lg px-2.5 py-2 text-sm ${active ? "bg-white" : ""}`}>
                    <div className="flex items-center gap-2.5">
                      {done ? <CheckIcon /> : pausedHere ? <span className="shrink-0">🔒</span> : active ? <Spinner /> : <PauseDot />}
                      <span className={done ? "text-slate-500" : active ? "font-medium text-slate-800" : "text-slate-400"}>{label}</span>
                    </div>

                    {/* Thanh toán QR — quét mã của nguồn này rồi xác nhận (giống bước trợ lý của giỏ) */}
                    {pausedHere && st.pause === "pay-qr" && (
                      <div className="mt-1.5 pl-7">
                        <div className="flex items-center gap-3 rounded-xl bg-slate-50 p-2.5">
                          <div className="shrink-0 rounded-lg bg-white p-1.5 shadow-sm">
                            <QRCode
                              value={`Chuyen khoan: ${st.source} | So tien: ${st.amount} VND | SDT: ${phone}`}
                              size={72}
                              level="M"
                            />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-xs text-slate-500">{t("Quét QR để chuyển khoản")}</p>
                            <p className="mt-1 text-sm font-bold text-rose-600">{formatMoney(st.amount || 0)}</p>
                          </div>
                        </div>
                        <button
                          onClick={() => setRunIdx((i2) => i2 + 1)}
                          className="mt-2 rounded-lg bg-emerald-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700"
                        >
                          {t("Tôi đã chuyển khoản")}
                        </button>
                      </div>
                    )}

                    {/* Thanh toán Thẻ — fallback khi CHƯA điền thẻ ở form: nhập 1 lần, các nguồn sau dùng lại */}
                    {pausedHere && st.pause === "pay-card" && (
                      <div className="mt-1.5 space-y-2 pl-7">
                        <CardInputs pay={pay} lang={lang} />
                        <button
                          onClick={() => { pay.commitCard(); setCardConfirmed(true); setRunIdx((i2) => i2 + 1); }}
                          disabled={!pay.newCardReady}
                          className="rounded-lg bg-emerald-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:bg-slate-300"
                        >
                          {t("Thanh toán {amount}", { amount: formatMoney(st.amount || 0) })}
                        </button>
                        <p className="mt-1 text-[11px] text-slate-400">{t("Nhập 1 lần — các cửa hàng sau tự dùng lại thẻ này.")}</p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* PHASE 3: xong */}
          {phase === "done" && (
            <div className="flex flex-col items-center py-4 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100">
                <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
              </div>
              <h3 className="mt-3 text-lg font-bold text-slate-900">{t("Đã đặt cả túi thành công!")}</h3>
              <p className="mt-1 text-sm text-slate-500">
                {t("Trợ lý đã đặt {n} món từ {m} nguồn. Mã đơn:", { n: lines.length, m: groups.length })}
              </p>
              <p className="mt-1 text-base font-bold tracking-wide text-emerald-600">{orderCode}</p>

              <div className="mt-4 w-full space-y-2 rounded-xl bg-slate-50 p-3 text-left text-sm">
                {groups.map((g) => (
                  <div key={g.source}>
                    <p className="text-xs font-semibold text-slate-800">{g.source}</p>
                    {g.items.map((it) => (
                      <Row key={it.productId} k={it.name} v={`${formatMoney(it.price * it.qty)}${it.qty > 1 ? ` ×${it.qty}` : ""}`} />
                    ))}
                  </div>
                ))}
                <div className="border-t border-slate-200 pt-2">
                  <Row k={t("Giao tới")} v={address} />
                  <Row k={t("Thanh toán")} v={pay.method === "qr" ? t("QR chuyển khoản") : pay.method === "card" ? maskedCardLabel : "COD"} />
                  <Row k={t("Tổng")} v={formatMoney(total)} strong />
                </div>
              </div>

              <button onClick={onClose} className="mt-4 w-full rounded-xl border border-slate-200 bg-emerald-600 py-3 text-sm font-semibold text-white transition hover:bg-emerald-700">
                {t("Xong")}
              </button>
            </div>
          )}
        </div>

        {/* Footer: tạm tính + nút đặt (chỉ ở phase form) */}
        {phase === "form" && (
          <div className="border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur-sm">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-medium text-slate-800">{t("Tạm tính cả túi")}</span>
              <span className="text-lg font-bold text-emerald-600">{formatMoney(total)}</span>
            </div>
            <button
              disabled={!canStart}
              onClick={startAgent}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-emerald-600 py-3 text-sm font-semibold text-white shadow-[0_4px_14px_rgba(16,185,129,0.35),inset_0_1px_0_rgba(255,255,255,0.25)] transition-all duration-150 hover:bg-emerald-700 active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500 disabled:shadow-none disabled:hover:bg-slate-300"
            >
              {t("Để trợ lý đặt cả túi →")}
            </button>
            {orderHint && (
              <p className="mt-1.5 text-center text-xs text-slate-400">{orderHint}</p>
            )}
          </div>
        )}
      </div>

    </div>
  );
}

function Row({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="shrink-0 text-slate-500">{k}</span>
      <span className={`text-right ${strong ? "font-bold text-emerald-600" : "font-medium text-slate-800"}`}>{v}</span>
    </div>
  );
}

function CheckIcon() {
  return (
    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-100">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
    </span>
  );
}
function Spinner() { return <span className="block h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-emerald-200 border-t-emerald-600" />; }
function PauseDot() { return <span className="block h-5 w-5 shrink-0 rounded-full border-2 border-dashed border-slate-300" />; }
