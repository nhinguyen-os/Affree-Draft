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
  `${INPUT_CLS} ${invalid ? "border-rose-400" : "border-slate-200"}`;

export default function OrderInfoSection({
  lang = "vi",
  name,
  phone,
  address = "",
  onName,
  onPhone,
  onAddress,
  showAddress = true,
  currency,
  slot,
  slots,
  onSlot,
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
  /** Tiền tệ cửa hàng → định dạng SĐT theo quốc gia (lib/phone.ts). */
  currency?: string;
  /** Truyền slot + slots khi form cần chọn khung giờ giao (giỏ hàng). */
  slot?: string;
  slots?: readonly string[];
  onSlot?: (v: string) => void;
  className?: string;
}) {
  const t = (vi: string, vars?: Record<string, string | number>) => tr(lang, vi, vars);
  // Không truyền currency → mặc định VND (app VN): placeholder + validate kiểu SĐT Việt Nam.
  const rule = useMemo(() => phoneRule(currency ?? "VND"), [currency]);
  const phoneError = phone.trim().length > 0 && !rule.test(phone);

  return (
    <section className={`rounded-2xl border border-slate-200 p-3 ${className}`}>
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
        {showAddress && (
          <Field label={t("Địa chỉ giao hàng")}>
            <textarea
              value={address}
              onChange={(e) => onAddress?.(e.target.value)}
              rows={2}
              placeholder={t("Số nhà, đường, phường, quận…")}
              className={`${inputCls()} resize-none`}
            />
          </Field>
        )}
        {slots && onSlot && (
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold text-slate-800">{label}</span>
      {children}
    </label>
  );
}
