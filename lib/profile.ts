"use client";

/**
 * Hồ sơ người mua — tên / SĐT / địa chỉ giao.
 * - Lưu localStorage NGAY (đồng bộ) để lần sau tự điền sẵn.
 * - Đẩy lên Google Sheet qua /api/buyer (debounce ~800ms) — không cần rời khỏi ô,
 *   cứ gõ là lưu. Upsert theo SĐT nên sửa nhiều lần không đẻ dòng mới.
 */

export type BuyerProfile = {
  name: string;
  phone: string;
  address: string;
};

const KEY = "gqd_buyer";

export function getProfile(): BuyerProfile {
  if (typeof window === "undefined") return { name: "", phone: "", address: "" };
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "null");
    return {
      name: raw?.name || "",
      phone: raw?.phone || "",
      address: raw?.address || "",
    };
  } catch {
    return { name: "", phone: "", address: "" };
  }
}

let netTimer: ReturnType<typeof setTimeout> | null = null;

/** Lưu (gộp) thông tin người mua. Field rỗng không ghi đè dữ liệu cũ. */
export function saveProfile(p: Partial<BuyerProfile>) {
  if (typeof window === "undefined") return;
  let next: BuyerProfile;
  try {
    const cur = getProfile();
    next = {
      name: p.name?.trim() || cur.name,
      phone: p.phone?.trim() || cur.phone,
      address: p.address?.trim() || cur.address,
    };
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    return; // localStorage không khả dụng
  }

  // Đẩy lên Google Sheet — gộp nhiều lần gõ thành 1 lần ghi.
  if (netTimer) clearTimeout(netTimer);
  const snapshot = next;
  netTimer = setTimeout(() => pushBuyer(snapshot), 800);
}

/** Gửi NGAY (không debounce) — dùng khi bấm bắt đầu đặt hàng. */
export function flushProfile(p?: Partial<BuyerProfile>) {
  if (p) saveProfile(p);
  if (netTimer) {
    clearTimeout(netTimer);
    netTimer = null;
  }
  pushBuyer(getProfile());
}

async function pushBuyer(p: BuyerProfile) {
  if (!p.phone) return; // cần SĐT làm khoá upsert
  try {
    await fetch("/api/buyer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(p),
    });
  } catch {
    // im lặng: vẫn còn bản localStorage
  }
}
