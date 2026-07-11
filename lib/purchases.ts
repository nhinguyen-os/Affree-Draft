"use client";

import type { PurchaseRecord } from "./types";

const KEY = "gqd_purchases";

export function getPurchases(): PurchaseRecord[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(KEY) || "[]") as PurchaseRecord[];
  } catch {
    return [];
  }
}

/** Lưu localStorage ngay + đẩy lên Google Sheet qua /api/purchases (nếu cấu hình). */
export async function addPurchase(
  rec: Omit<PurchaseRecord, "id" | "boughtAt" | "total">
): Promise<PurchaseRecord> {
  const record: PurchaseRecord = {
    ...rec,
    id: crypto.randomUUID(),
    total: rec.unitPrice * rec.qty,
    boughtAt: new Date().toISOString(),
  };
  const all = getPurchases();
  all.unshift(record);
  localStorage.setItem(KEY, JSON.stringify(all));

  try {
    await fetch("/api/purchases", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(record),
    });
  } catch {
    // im lặng: vẫn còn bản localStorage
  }
  return record;
}

export function clearPurchases() {
  localStorage.removeItem(KEY);
}
