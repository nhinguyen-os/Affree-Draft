"use client";

/**
 * Lưu giỏ hàng vào localStorage (theo thiết bị, không cần backend) để giỏ không bị mất
 * khi F5 / đóng mở lại tab. Mỗi CartItem đã tự mang snapshot product + offer nên khôi
 * phục được ngay mà không phụ thuộc catalog load xong hay chưa. Giá có thể hơi cũ so với
 * catalog mới — chấp nhận được cho giỏ hàng; lần đặt sẽ tính lại theo offer đang giữ.
 */

import type { CartItem } from "@/lib/types";

const CART_KEY = "gqd_cart";

/** Đọc giỏ hàng đã lưu (mảng rỗng nếu chưa có / lỗi parse). */
export function getSavedCart(): CartItem[] {
  if (typeof window === "undefined") return [];
  try {
    const v = JSON.parse(localStorage.getItem(CART_KEY) || "null");
    return Array.isArray(v) ? (v as CartItem[]) : [];
  } catch {
    return [];
  }
}

/** Ghi đè giỏ hàng hiện tại xuống localStorage. */
export function saveCart(items: CartItem[]) {
  if (typeof window === "undefined") return;
  try {
    if (items.length === 0) localStorage.removeItem(CART_KEY);
    else localStorage.setItem(CART_KEY, JSON.stringify(items));
  } catch {
    /* quota / private mode — bỏ qua, giỏ vẫn chạy in-memory */
  }
}
