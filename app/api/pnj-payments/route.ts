import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/pnj-payments
 *
 * Proxy tới https://edge-cf-api.pnj.io/ecom-frontend/v1/get-list-payment
 * để tránh CORS khi gọi từ browser.
 *
 * Body: { cart, customerPhone, deliveryType, products }
 * Trả về: { data: [...] } — mảng phương thức thanh toán PNJ
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const res = await fetch(
      "https://edge-cf-api.pnj.io/ecom-frontend/v1/get-list-payment",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "Accept-Language": "vi-VN,vi;q=0.9",
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
          Origin: "https://www.pnj.com.vn",
          Referer: "https://www.pnj.com.vn/",
        },
        body: JSON.stringify(body),
        // cache: không cache vì giá trị is_available thay đổi theo tổng đơn / SĐT
        cache: "no-store",
      }
    );

    if (!res.ok) {
      return NextResponse.json(
        { error: `PNJ API returned ${res.status}` },
        { status: res.status }
      );
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
