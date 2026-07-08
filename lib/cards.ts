"use client";

/**
 * Thẻ thanh toán đã lưu (mô phỏng) — CHỈ localStorage, KHÔNG đẩy lên sheet/webhook
 * (khác lib/profile.ts: số thẻ là dữ liệu nhạy cảm, không rời khỏi máy người dùng).
 * CVV không bao giờ lưu. Xem full số thẻ phải qua bước OTP (mô phỏng) ở CartModal.
 */

export type SavedCard = {
  number: string; // đã format "0000 0000 0000 0000"
  name: string;
  exp: string; // "MM/YY"
  brand: string | null; // "Visa" | "Mastercard" | … (từ detectCardBrand lúc lưu)
  savedAt: number;
};

const KEY = "gqd_saved_card";

export function getSavedCard(): SavedCard | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "null");
    if (!raw?.number || !raw?.exp) return null;
    return raw as SavedCard;
  } catch {
    return null;
  }
}

export function saveCard(card: Omit<SavedCard, "savedAt">): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...card, savedAt: Date.now() }));
  } catch {
    // localStorage đầy/không khả dụng → bỏ qua, lần sau nhập lại
  }
}

export function clearSavedCard(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // noop
  }
}

/**
 * Thẻ ĐÃ CHE lấy từ tài khoản (sheet) qua /api/account — dùng khi máy hiện tại chưa có
 * thẻ ở localStorage (vd đăng nhập máy khác / điền thẳng vào sheet). CHỈ có 4 số cuối +
 * hãng + hạn: `number` chứa phần đã che (không phải full số), đủ để hiện & chọn "thẻ đã
 * lưu" ở checkout (thanh toán mô phỏng). Chưa đăng nhập → /api/account trả 401 → null.
 */
export async function fetchAccountCard(): Promise<SavedCard | null> {
  if (typeof window === "undefined") return null;
  try {
    const res = await fetch("/api/account", { cache: "no-store" });
    if (!res.ok) return null;
    const data = await res.json();
    const a = data?.account;
    const last4 = String(a?.cardLast4 || "").trim();
    if (!last4) return null;
    return {
      number: last4, // đã che (server không lưu full số) — hiển thị dạng ****{last4}
      name: a?.name || "",
      exp: a?.cardExp || "",
      brand: a?.cardBrand || null,
      savedAt: 0,
    };
  } catch {
    return null;
  }
}
