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

/**
 * Google Sheet chứa tab "Thông tin tài khoản" người dùng (KHÁC spreadsheet Apps Script
 * đang gắn → Apps Script phải openById). Chỉ là ID, không phải secret.
 */
export const ACCOUNTS_SHEET_ID =
  process.env.ACCOUNTS_SHEET_ID || "1VLihAZ5pt96_g7s-Xosrcl0LCPkAh3UkdvsfnsbTUTY";

/**
 * Khoá ký HMAC cho OTP challenge + cookie phiên. BẮT BUỘC đặt ở production
 * (Vercel env AUTH_SECRET). Local có default để chạy dev — cảnh báo nếu prod mà thiếu.
 */
export const AUTH_SECRET = (() => {
  const s = process.env.AUTH_SECRET;
  if (!s) {
    if (process.env.NODE_ENV === "production") {
      console.warn("[auth] THIẾU AUTH_SECRET ở production — phiên đăng nhập KHÔNG an toàn!");
    }
    return "affree-dev-insecure-secret-change-me";
  }
  return s;
})();

/** Thời hạn OTP (ms). */
export const OTP_TTL_MS = Number(process.env.OTP_TTL_MS || 5 * 60 * 1000);

/**
 * Chế độ demo OTP: CHƯA có cổng SMS → trả OTP về client để hiển thị cho người dùng.
 * Đặt OTP_DEMO_MODE=0 sau khi ghép SMS thật để KHÔNG lộ OTP qua API.
 */
export const OTP_DEMO_MODE = process.env.OTP_DEMO_MODE !== "0";
