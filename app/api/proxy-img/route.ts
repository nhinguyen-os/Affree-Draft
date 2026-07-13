import { NextRequest, NextResponse } from "next/server";

/**
 * Proxy ảnh logo từ domain bên ngoài để bypass CORS — cho phép client đọc pixel
 * (Canvas getImageData) phục vụ tính năng dò màu nền chủ đạo + cắt lề rỗng.
 *
 *   GET /api/proxy-img?u=<URL ảnh đã encode>
 *
 * Re-serves with `Access-Control-Allow-Origin: *` và `Cache-Control` 1 ngày
 * để client side cache lại, đỡ gọi liên tục.
 */
export const runtime = "edge";

export async function GET(req: NextRequest) {
  const u = req.nextUrl.searchParams.get("u");
  if (!u) return new NextResponse("missing ?u=", { status: 400 });

  let target: URL;
  try {
    target = new URL(u);
  } catch {
    return new NextResponse("bad URL", { status: 400 });
  }
  // Chỉ cho phép http(s) — chặn javascript:/file:/data:… để tránh SSRF/abuse.
  if (target.protocol !== "https:" && target.protocol !== "http:") {
    return new NextResponse("scheme not allowed", { status: 400 });
  }

  try {
    const res = await fetch(target.toString(), {
      headers: { "User-Agent": "Affree-Logo-Proxy/1.0" },
      cache: "force-cache",
    });
    if (!res.ok) return new NextResponse(`upstream ${res.status}`, { status: 502 });
    const buf = await res.arrayBuffer();
    return new NextResponse(buf, {
      headers: {
        "Content-Type": res.headers.get("Content-Type") || "image/png",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=86400, immutable",
      },
    });
  } catch (e) {
    return new NextResponse("proxy error: " + (e as Error).message, { status: 502 });
  }
}
