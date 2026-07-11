"use client";

/**
 * Theo dõi sản phẩm "vừa xem" + đếm lượt xem để sắp xếp "phổ biến" — lưu localStorage
 * (theo thiết bị, không cần backend). Mỗi lần mở chi tiết 1 sản phẩm gọi recordView().
 *
 * GHI CHÚ: đây là độ phổ biến THEO THIẾT BỊ. Muốn "được tìm nhiều nhất" trên toàn hệ
 * thống thì cần log lượt xem lên Google Sheet rồi tổng hợp (giống purchases/alerts) —
 * có thể nâng cấp sau mà không đổi UI.
 */

const RECENT_KEY = "gqd_recent"; // mảng productId, mới nhất đứng đầu
const COUNT_KEY = "gqd_views"; // { [productId]: số lượt xem }
const RECENT_MAX = 12;

function read<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    return JSON.parse(localStorage.getItem(key) || "null") ?? fallback;
  } catch {
    return fallback;
  }
}

/** Danh sách id sản phẩm đã xem, mới nhất đứng đầu. */
export function getRecentIds(): string[] {
  return read<string[]>(RECENT_KEY, []);
}

/** Bản đồ số lượt xem theo sản phẩm (để sắp "phổ biến"). */
export function getViewCounts(): Record<string, number> {
  return read<Record<string, number>>(COUNT_KEY, {});
}

/** Ghi nhận 1 lượt xem: đẩy lên đầu danh sách "vừa xem" + tăng bộ đếm. */
export function recordView(productId: string) {
  if (typeof window === "undefined") return;
  const recent = getRecentIds().filter((id) => id !== productId);
  recent.unshift(productId);
  localStorage.setItem(RECENT_KEY, JSON.stringify(recent.slice(0, RECENT_MAX)));

  const counts = getViewCounts();
  counts[productId] = (counts[productId] ?? 0) + 1;
  localStorage.setItem(COUNT_KEY, JSON.stringify(counts));
}

/** Xoá lịch sử "vừa xem" (giữ nguyên bộ đếm phổ biến). */
export function clearRecent() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(RECENT_KEY);
}
