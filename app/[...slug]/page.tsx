/**
 * Catch-all route — render lại trang chủ. State (sản phẩm/brand/ngành hàng) được
 * Home component đọc trực tiếp từ `usePathname()` rồi map qua slug helpers
 * (xem [[lib/slug.ts]]) thành filter/selected. URL ↔ state đồng bộ 2 chiều.
 */
"use client";
export { default } from "../page";
