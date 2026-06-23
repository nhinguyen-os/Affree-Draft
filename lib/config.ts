/**
 * Endpoint Apps Script Web App (/exec) để GHI dữ liệu (đơn mua, người mua, báo giá)
 * vào Google Sheet trong folder Affree mới — gắn với sheet "Danh sách sản phẩm".
 * URL /exec là web app công khai (không phải secret) nên để default ngay trong code,
 * tránh phụ thuộc env trên Vercel. Vẫn cho override bằng env PURCHASE_WEBHOOK_URL.
 */
export const PURCHASE_WEBHOOK_URL =
  process.env.PURCHASE_WEBHOOK_URL ||
  "https://script.google.com/macros/s/AKfycbyZxPaIbYLWoGP8OhfeBtzvIsafAS2mvAAkRnmS8WnJeNWwY58GmAjydxb5uUdOGmcsnw/exec";
