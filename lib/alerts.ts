"use client";

import type { PriceAlert } from "./types";

const KEY = "gqd_alerts";

export function getAlerts(): PriceAlert[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(KEY) || "[]") as PriceAlert[];
  } catch {
    return [];
  }
}

/** Lưu localStorage ngay + đẩy lên Google Sheet qua /api/alerts (nếu cấu hình). */
export async function addAlert(
  rec: Omit<PriceAlert, "id" | "createdAt">
): Promise<PriceAlert> {
  const record: PriceAlert = {
    ...rec,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
  };
  const all = getAlerts();
  all.unshift(record);
  localStorage.setItem(KEY, JSON.stringify(all));

  try {
    await fetch("/api/alerts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(record),
    });
  } catch {
    // im lặng: vẫn còn bản localStorage
  }
  return record;
}

/** Đăng ký báo giá (nếu có) cho 1 sản phẩm trên thiết bị này. */
export function getAlertForProduct(productId: string): PriceAlert | null {
  return getAlerts().find((a) => a.productId === productId) ?? null;
}

/** Xoá 1 đăng ký báo giá khỏi localStorage (theo id). */
export function removeAlert(id: string) {
  if (typeof window === "undefined") return;
  const all = getAlerts().filter((a) => a.id !== id);
  localStorage.setItem(KEY, JSON.stringify(all));
}
