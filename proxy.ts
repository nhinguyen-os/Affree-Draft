import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Subdomain nhãn/chuỗi/tệp: `<slug>.affree.vn` (hoặc `<slug>.localhost:3210` khi dev)
 * → rewrite trang gốc về URL ngắn `/<slug>` — client tự resolve chain → brand → tệp
 * → danh mục → sản phẩm (cùng thứ tự với URL ngắn, xem sync URL trong app/page.tsx).
 * Vd: pnj.affree.vn → /nhan/pnj (brand), astrabean.affree.vn → trang chuỗi.
 *
 * Lưu ý hạ tầng: *.vercel.app KHÔNG hỗ trợ sub-subdomain (SSL chỉ phủ 1 cấp) nên
 * proxy này chỉ có tác dụng khi project gắn custom domain + wildcard `*.<domain>`,
 * hoặc khi chạy local (trình duyệt tự trỏ *.localhost về 127.0.0.1).
 */
const RESERVED_SUBS = new Set(["www", "api", "admin", "app", "static", "assets", "mail"]);

export function proxy(req: NextRequest) {
  const hostname = (req.headers.get("host") || "").split(":")[0].toLowerCase();
  const parts = hostname.split(".");

  let sub = "";
  if (parts.length === 2 && parts[1] === "localhost") {
    // dev: pnj.localhost
    sub = parts[0];
  } else if (parts.length >= 3 && !hostname.endsWith(".vercel.app")) {
    // custom domain: pnj.affree.vn (vercel.app bỏ qua — không có sub-subdomain)
    sub = parts[0];
  }

  if (!sub || RESERVED_SUBS.has(sub)) return NextResponse.next();

  const url = req.nextUrl.clone();
  url.pathname = `/${sub}`;
  return NextResponse.rewrite(url);
}

export const config = {
  // Chỉ chạy ở trang gốc — các path khác (assets, /p/…, /nhan/…) giữ nguyên trên subdomain.
  matcher: ["/"],
};
