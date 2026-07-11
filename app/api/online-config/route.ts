import { NextResponse } from "next/server";
import { fetchOnlineConfig } from "@/lib/sheet-online-config";

// Cấu hình cho trang cửa hàng không bán online (dịch vụ tạo web, số liên hệ, Zalo OA).
// Đọc từ Google Sheet; sheet trống → default trong lib. Cache CDN 300s + SWR.
export async function GET() {
  const cfg = await fetchOnlineConfig();
  return NextResponse.json(cfg, {
    headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" },
  });
}
