"use client";

/**
 * Khoá cuộn nền (body) dùng CHUNG cho mọi modal — đếm tham chiếu (refcount).
 *
 * Vì sao cần: trước đây mỗi modal tự save/restore `body.style.overflow` ("prev").
 * Khi 2 modal mở/đóng KHÔNG theo thứ tự LIFO (vd giỏ hàng → trợ lý đặt hàng, đóng giỏ
 * trước), modal đóng sau restore "prev" đã cũ = "hidden" → body kẹt overflow:hidden
 * vĩnh viễn → trang không cuộn được, phải reload. Refcount: chỉ khi TẤT CẢ lock đã nhả
 * (count = 0) mới trả overflow về "" — không còn phụ thuộc thứ tự đóng.
 */

let count = 0;

/** Khoá cuộn nền. Trả về hàm nhả khoá (idempotent — gọi nhiều lần chỉ nhả 1 lần). */
export function acquireBodyScrollLock(): () => void {
  count++;
  document.body.style.overflow = "hidden";
  let released = false;
  return () => {
    if (released) return;
    released = true;
    count = Math.max(0, count - 1);
    if (count === 0) document.body.style.overflow = "";
  };
}

/** Còn lock nào đang giữ không — để safeguard bên ngoài biết có nên ép mở khoá. */
export function hasActiveScrollLock(): boolean {
  return count > 0;
}
