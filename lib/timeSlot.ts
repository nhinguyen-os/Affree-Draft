import type { MealTitle } from "./types";

/**
 * Tên section trên trang chủ lấy TỪ GOOGLE SHEET (tab DanhMuc). RIÊNG section "Đồ ăn" đổi tên
 * theo BUỔI ĂN, lấy LIVE từ Google Sheet (tab gid=743152394) — xem pickMealTitle + sheet-groups.ts.
 * Sheet buổi-ăn cấp sẵn cả tên VI và EN.
 */

/** Bỏ dấu tiếng Việt + đ→d (để so khớp tên không phụ thuộc dấu). */
function stripDiacritics(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D");
}

/** true nếu là section "Đồ ăn" — section duy nhất đổi tên theo buổi ăn (từ sheet). */
export function isFoodSection(label: string): boolean {
  return stripDiacritics(label || "").toLowerCase().trim().replace(/\s+/g, " ") === "do an";
}

/**
 * Chọn tên buổi ăn theo `hour` (0–23). Mỗi dòng áp dụng TỪ `fromHour` đến trước fromHour kế tiếp;
 * giờ nhỏ hơn mốc đầu → thuộc mốc CUỐI (bao vòng qua nửa đêm). rows rỗng → null.
 */
export function pickMealTitle(rows: MealTitle[], hour: number): MealTitle | null {
  if (!rows.length) return null;
  const sorted = [...rows].sort((a, b) => a.fromHour - b.fromHour);
  let chosen = sorted[sorted.length - 1]; // mặc định = mốc cuối (bao vòng cho giờ trước mốc đầu)
  for (const r of sorted) {
    if (hour >= r.fromHour) chosen = r;
  }
  return chosen;
}
