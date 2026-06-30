/**
 * Endpoint Apps Script Web App (/exec) để GHI dữ liệu (đơn mua, người mua, báo giá)
 * vào Google Sheet trong folder Affree mới — gắn với sheet "Danh sách sản phẩm".
 * URL /exec là web app công khai (không phải secret) nên để default ngay trong code,
 * tránh phụ thuộc env trên Vercel. Vẫn cho override bằng env PURCHASE_WEBHOOK_URL.
 */
export const PURCHASE_WEBHOOK_URL =
  process.env.PURCHASE_WEBHOOK_URL ||
  "https://script.google.com/macros/s/AKfycby9bNlCEXk3NnU2i3oxOppNvkCQ85jDq1AggT-_mAEYnByrcUJD_S0-F_nhS6_Mt6eiuw/exec";

/**
 * Chỉ GHI dữ liệu vào Google Sheet khi chạy ở PRODUCTION THẬT (Vercel production deploy).
 * Local (next dev) và bản preview → KHÔNG ghi, để dữ liệu thật không lẫn bản test.
 * Cần test ghi tạm ở local thì đặt env ALLOW_SHEET_WRITE=1.
 */
export const ALLOW_SHEET_WRITE =
  process.env.ALLOW_SHEET_WRITE === "1" || process.env.VERCEL_ENV === "production";
