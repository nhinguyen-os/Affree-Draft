"use client";

import { useEffect, useMemo, useState } from "react";
import { formatMoney } from "@/lib/util";
import { flushProfile, getProfile, saveProfile } from "@/lib/profile";
import { phoneRule } from "@/lib/phone";
import { type Lang, tr } from "@/lib/i18n";

/**
 * BẢN GIẢ LẬP (mock) — màn agentic đặt CẢ TÚI: liệt kê các món (gom theo nguồn/chuyên trang)
 * rồi đặt 1 lượt. Túi đa nguồn → mỗi nguồn là 1 chuyên trang riêng; trợ lý "đặt" lần lượt.
 */
export interface TuiAgentLine {
  productId: string;
  name: string;
  image?: string;
  /** Nhãn nguồn/chuyên trang nơi mua món này (vd "Bách Hóa Xanh", "Tươi Xanh"). */
  sourceLabel: string;
  storeName: string;
  price: number;
  qty: number;
}

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

  // Gom món theo nguồn/chuyên trang để hiển thị + đặt theo từng nguồn.
  const groups = useMemo(() => {
    const m = new Map<string, TuiAgentLine[]>();
    for (const l of lines) {
      if (!m.has(l.sourceLabel)) m.set(l.sourceLabel, []);
      m.get(l.sourceLabel)!.push(l);
    }
    return [...m.entries()].map(([source, items]) => ({ source, items }));
  }, [lines]);

  const rule = useMemo(() => phoneRule(), []);
  const phoneValid = rule.test(phone);
  const phoneError = phone.trim().length > 0 && !phoneValid;
  const canStart = !!name.trim() && phoneValid && !!address.trim();

  // Khoá scroll nền + lưu hồ sơ khi gõ.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);
  useEffect(() => { saveProfile({ name, phone, address }); }, [name, phone, address]);

  // Các bước trợ lý chạy: mỗi nguồn 1 bước "đặt", rồi giao hàng + xác nhận.
  const steps = useMemo(() => {
    const s = groups.map((g) =>
      t("Đặt {n} món trên {source}…", { n: g.items.length, source: g.source }),
    );
    s.push(t("Điền thông tin giao hàng…"));
    s.push(t("Xác nhận & gửi đơn (COD)…"));
    return s;
  }, [groups, lang]);

  // Auto-advance khi đang chạy; xong thì sinh mã đơn + báo về.
  useEffect(() => {
    if (phase !== "running") return;
    if (runIdx >= steps.length) {
      const code = "AFF-" + String(Date.now()).slice(-6) + "-" + Math.floor(Math.random() * 900 + 100);
      setOrderCode(code);
      setPhase("done");
      onPlaced(code);
      return;
    }
    const id = setTimeout(() => setRunIdx((i) => i + 1), 750);
    return () => clearTimeout(id);
  }, [phase, runIdx, steps.length, onPlaced]);

  const total = comboPrice || lines.reduce((s, l) => s + l.price * l.qty, 0);

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
              🛍️ {tuiName} · {lines.length} {t("món")} · {groups.length} {t("chuyên trang")}
            </p>
          </div>
          <button onClick={onClose} className="shrink-0 rounded-full p-1.5 text-slate-500 hover:bg-white/40" aria-label={t("Đóng")}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 py-4">
          <div className="mb-4 rounded-lg border border-amber-300/40 bg-amber-100/30 px-3 py-2 text-xs text-amber-900">
            ⚙️ {t("Bản mô phỏng — chưa kết nối web thật. Trợ lý đặt cả túi trên nhiều chuyên trang.")}
          </div>

          {/* PHASE 1: liệt kê các món trong túi (gom theo chuyên trang) + thông tin nhận */}
          {phase === "form" && (
            <div className="space-y-3">
              {/* ── Thông tin chung — CÙNG CẤU TRÚC với form giỏ hàng / Mua ngay ── */}
              <section className="rounded-2xl border border-slate-200 p-3">
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {t("Thông tin chung")}
                </h3>
                <div className="space-y-2.5">
                  <Field label={t("Họ tên")}>
                    <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("Nguyễn Văn A")} className="input" />
                  </Field>
                  <Field label={t("Số điện thoại / Zalo")}>
                    <input
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      inputMode="tel"
                      placeholder={t(rule.placeholderVi)}
                      aria-invalid={phoneError}
                      className="input"
                      style={phoneError ? { borderColor: "#ef4444" } : undefined}
                    />
                    {phoneError && <span className="mt-1 block text-xs text-rose-600">{t(rule.errorVi)}</span>}
                  </Field>
                  <Field label={t("Địa chỉ giao hàng")}>
                    <textarea value={address} onChange={(e) => setAddress(e.target.value)} rows={2} placeholder={t("Số nhà, đường, phường, quận…")} className="input resize-none" />
                  </Field>
                </div>
              </section>

              {/* ── Riêng từng chuyên trang: danh sách món trong túi ── */}
              {groups.map((g) => (
                <div key={g.source} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-slate-800">
                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-500" />
                    {g.source} · {g.items.length} {t("món")}
                  </p>
                  <div className="space-y-2">
                    {g.items.map((it) => (
                      <div key={it.productId} className="flex items-center gap-2.5">
                        {it.image ? (
                          <img src={it.image} alt={it.name} className="h-10 w-10 shrink-0 rounded-lg bg-white object-contain" />
                        ) : (
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white text-lg">🛒</div>
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-slate-800">{it.name}</p>
                          <p className="truncate text-[11px] text-slate-500">{it.storeName}</p>
                        </div>
                        <span className="shrink-0 text-sm font-semibold text-emerald-600">
                          {formatMoney(it.price * it.qty)}{it.qty > 1 ? ` ×${it.qty}` : ""}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}

              {/* ── Thanh toán — cùng kiểu section với form giỏ hàng ── */}
              <section className="rounded-2xl border border-slate-200 p-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t("Thanh toán")}</h3>
                  <span className="text-sm font-semibold text-slate-800">{t("COD (tiền mặt khi nhận)")}</span>
                </div>
                <p className="mt-1 text-[11px] text-slate-600">
                  {t("Túi mua trên {n} chuyên trang → trợ lý đặt lần lượt từng nơi, giao theo từng nguồn.", { n: groups.length })}
                </p>
              </section>
            </div>
          )}

          {/* PHASE 2: trợ lý chạy */}
          {phase === "running" && (
            <div className="space-y-2 py-1">
              {steps.map((label, i) => {
                const done = i < runIdx;
                const active = i === runIdx;
                return (
                  <div key={i} className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm ${active ? "bg-white" : ""}`}>
                    {done ? <CheckIcon /> : active ? <Spinner /> : <PauseDot />}
                    <span className={done ? "text-slate-500" : active ? "font-medium text-slate-800" : "text-slate-400"}>{label}</span>
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
                {t("Trợ lý đã đặt {n} món trên {m} chuyên trang. Mã đơn:", { n: lines.length, m: groups.length })}
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
                  <Row k={t("Thanh toán")} v="COD" />
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
              onClick={() => { flushProfile({ name, phone, address }); setRunIdx(0); setPhase("running"); }}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-emerald-600 py-3 text-sm font-semibold text-white shadow-[0_4px_14px_rgba(16,185,129,0.35),inset_0_1px_0_rgba(255,255,255,0.25)] transition-all duration-150 hover:bg-emerald-700 active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500 disabled:shadow-none disabled:hover:bg-slate-300"
            >
              {t("Để trợ lý đặt cả túi →")}
            </button>
            {!canStart && (
              <p className="mt-1.5 text-center text-xs text-slate-400">{t("Nhập đủ tên, số điện thoại và địa chỉ để bắt đầu.")}</p>
            )}
          </div>
        )}
      </div>

      <style jsx global>{`
        .input {
          width: 100%; border-radius: 0.5rem; border: 1px solid rgba(255,255,255,0.4);
          background: rgba(255,255,255,0.35); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
          padding: 0.5rem 0.75rem; font-size: 0.875rem; color: #0f172a; outline: none;
          transition: border-color 0.15s, box-shadow 0.15s, background 0.15s;
        }
        .input::placeholder { color: rgba(100,116,139,0.7); }
        .input:focus { border-color: rgba(16,185,129,0.7); background: rgba(255,255,255,0.5); box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.18); }
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
