import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/pnj-sizes?url=https://www.pnj.com.vn/site/san-pham/...html
 *
 * Proxy: tải trang sản phẩm PNJ, parse __NEXT_DATA__ để lấy:
 *   - size_modifier_prices → sizes[]
 *   - productCode          → dùng cho /api/pnj-payments thay vì product.id
 * Trả về { sizes: string[], productCode: string }
 */
export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url") ?? "";

  if (!url || !url.includes("pnj.com.vn")) {
    return NextResponse.json({ sizes: [], productCode: "" });
  }

  try {
    const res = await fetch(url, {
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "vi-VN,vi;q=0.9",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
      },
      next: { revalidate: 300 },
    });

    if (!res.ok) return NextResponse.json({ sizes: [], productCode: "" });

    const html = await res.text();

    const match = html.match(
      /<script id="__NEXT_DATA__"[^>]*>(\{[\s\S]*?\})<\/script>/
    );
    if (!match) return NextResponse.json({ sizes: [], productCode: "" });

    const nextData = JSON.parse(match[1]) as {
      props?: {
        pageProps?: {
          dataServerSide?: {
            size_modifier_prices?: Record<
              string,
              { price: number; net_price: number }
            >;
            productCode?: string;
          };
        };
      };
    };

    const dataServerSide = nextData?.props?.pageProps?.dataServerSide;
    const sizeMap = dataServerSide?.size_modifier_prices ?? {};
    const productCode = dataServerSide?.productCode ?? "";

    const sizes = Object.keys(sizeMap).sort((a, b) => {
      const na = Number(a),
        nb = Number(b);
      if (!isNaN(na) && !isNaN(nb)) return na - nb;
      return a.localeCompare(b);
    });

    // sizePrices: map size -> price (dùng để check transferAmount)
    const sizePrices: Record<string, number> = {};
    for (const [size, val] of Object.entries(sizeMap)) {
      sizePrices[size] = val.price;
    }

    return NextResponse.json({ sizes, productCode, sizePrices });
  } catch {
    return NextResponse.json({ sizes: [], productCode: "" });
  }
}
