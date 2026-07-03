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
