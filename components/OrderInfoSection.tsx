"use client";

import { useMemo } from "react";
import { phoneRule } from "@/lib/phone";
import { type Lang, tr } from "@/lib/i18n";

/**
 * MODULE CHUNG — section "Thông tin chung" (Họ tên · SĐT/Zalo · Địa chỉ · Khung giờ)
 * dùng cho MỌI form đặt hàng: giỏ hàng (CartModal), Mua ngay (OrderAgentModal),
 * Mua cả túi (TuiAgentModal), đặt nhạc (MusicOrderModal). Cấu trúc + style lấy theo
 * form giỏ hàng làm chuẩn; sửa ở đây là đồng bộ mọi nơi.
 */

// Style input chuẩn của form giỏ hàng.
const INPUT_CLS =
  "w-full rounded-lg border px-3 py-2 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100";
const inputCls = (invalid?: boolean) =>
  `${INPUT_CLS} ${invalid ? "border-rose-400" : "border-slate-300"}`;

export type DeliveryMode = "delivery" | "pickup";

/**
 * Chỉ áp cho đơn 1 chuỗi DUY NHẤT là BHX (mua ngay): thay ô địa chỉ bằng cặp tab
 * "Giao tận nơi / Nhận tại cửa hàng". Chọn "Nhận tại cửa hàng" → ẩn ô địa chỉ + khung giờ.
 * `storeLabel` = cửa hàng nguồn của sản phẩm.
 */
export interface PickupOption {
  mode: DeliveryMode;
  onMode: (m: DeliveryMode) => void;
  storeLabel: string;
}

export default function OrderInfoSection({
  lang = "vi",
  name,
  phone,
  address = "",
  onName,
  onPhone,
  onAddress,
  showAddress = true,
  addressError,
  currency,
  slot,
  slots,
  onSlot,
  pickup,
  className = "",
}: {
  lang?: Lang;
  name: string;
  phone: string;
  address?: string;
  onName: (v: string) => void;
  onPhone: (v: string) => void;
  onAddress?: (v: string) => void;
  /** false cho sản phẩm số (nhạc) — không cần địa chỉ giao. */
  showAddress?: boolean;
  addressError?: string;
  /** Tiền tệ cửa hàng → định dạng SĐT theo quốc gia (lib/phone.ts). */
  currency?: string;
  /** Truyền slot + slots khi form cần chọn khung giờ giao (giỏ hàng). */
  slot?: string;
  slots?: readonly string[];
  onSlot?: (v: string) => void;
  /** Đơn 1 chuỗi BHX: bật cặp tab Giao tận nơi / Nhận tại cửa hàng thay cho ô địa chỉ. */
  pickup?: PickupOption;
  className?: string;
}) {
  const t = (vi: string, vars?: Record<string, string | number>) => tr(lang, vi, vars);
  // Không truyền currency → mặc định VND (app VN): placeholder + validate kiểu SĐT Việt Nam.
  const rule = useMemo(() => phoneRule(currency ?? "VND"), [currency]);
  const phoneError = phone.trim().length > 0 && !rule.test(phone);

  return (
    <section className={`rounded-2xl border border-slate-400 p-3 ${className}`}>
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
        {t("Thông tin chung")}
      </h3>
      <div className="space-y-2.5">
        <Field label={t("Họ tên")}>
          <input
            type="text"
            value={name}
            onChange={(e) => onName(e.target.value)}
            placeholder={t("Nguyễn Văn A")}
            className={inputCls()}
          />
        </Field>
        <Field label={t("Số điện thoại / Zalo")}>
          <input
            type="tel"
            inputMode="tel"
            value={phone}
            onChange={(e) => onPhone(e.target.value)}
            placeholder={t(rule.placeholderVi)}
            aria-invalid={phoneError}
            className={inputCls(phoneError)}
          />
          {phoneError && (
            <span className="mt-1 block text-xs text-rose-600">{t(rule.errorVi)}</span>
          )}
        </Field>
        {showAddress && pickup ? (
          // ── Đơn 1 chuỗi BHX: 2 tab Giao tận nơi / Nhận tại cửa hàng ──
          <div>
            {/* Nhãn "Không phí SHIP" canh phải, không đè chữ tab */}
            <div className="mb-1 flex justify-end">
              <span className="text-[10px] font-medium text-slate-400">{t("Không phí SHIP")}</span>
            </div>
            {/* Cặp tab pill */}
            <div className="flex gap-1 rounded-2xl bg-slate-100 p-1">
              {(["delivery", "pickup"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => pickup.onMode(m)}
                  className={`flex-1 rounded-xl px-3 py-2 text-sm font-semibold transition-colors ${
                    pickup.mode === m
                      ? "bg-white text-slate-900 shadow-sm"
                      : "text-slate-500 hover:text-slate-700"
                  }`}
                >
                  {m === "delivery" ? t("Giao tận nơi") : t("Nhận tại cửa hàng")}
                </button>
              ))}
            </div>
            {pickup.mode === "delivery" ? (
              <div className="mt-2.5 space-y-2.5">
                <Field label={t("Địa chỉ giao hàng")}>
                  <textarea
                    value={address}
                    onChange={(e) => onAddress?.(e.target.value)}
                    rows={2}
                    placeholder={t("Số nhà, đường, phường, quận…")}
                    aria-invalid={Boolean(addressError)}
                    className={`${inputCls(Boolean(addressError))} resize-none`}
                  />
                  {addressError && (
                    <span className="mt-1 block text-xs text-rose-600">{addressError}</span>
                  )}
                </Field>
                <StoreRow prefix={t("Giao từ:")} label={pickup.storeLabel} />
              </div>
            ) : (
              <div className="mt-2.5">
                <StoreRow prefix={t("Cửa hàng nhận:")} label={pickup.storeLabel} />
              </div>
            )}
          </div>
        ) : (
          showAddress && (
            <Field label={t("Địa chỉ giao hàng")}>
              <textarea
                value={address}
                onChange={(e) => onAddress?.(e.target.value)}
                rows={2}
                placeholder={t("Số nhà, đường, phường, quận…")}
                aria-invalid={Boolean(addressError)}
                className={`${inputCls(Boolean(addressError))} resize-none`}
              />
              {addressError && (
                <span className="mt-1 block text-xs text-rose-600">{addressError}</span>
              )}
            </Field>
          )
        )}
        {slots && onSlot && !(pickup && pickup.mode === "pickup") && (
          <Field label={t("Khung giờ giao")}>
            <select value={slot} onChange={(e) => onSlot(e.target.value)} className={inputCls()}>
              {slots.map((s) => (
                <option key={s} value={s}>
                  {t(s)}
                </option>
              ))}
            </select>
          </Field>
        )}
      </div>
    </section>
  );
}

// Hàng hiện cửa hàng nguồn (Giao từ / Cửa hàng nhận) — box con giữ viền slate-200.
function StoreRow({ prefix, label }: { prefix: string; label: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
      <p className="text-sm text-slate-700">
        <span className="font-semibold text-slate-800">{prefix} </span>
        {label}
      </p>
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
