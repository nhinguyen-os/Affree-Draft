import { NextResponse } from "next/server";

export const revalidate = 86400; // Cache 1 ngày

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);

  const transport = searchParams.get("transport"); // car | bike | pedestrian
  const x1 = searchParams.get("x1"); // lng điểm bắt đầu
  const y1 = searchParams.get("y1"); // lat điểm bắt đầu
  const x2 = searchParams.get("x2"); // lng điểm kết thúc
  const y2 = searchParams.get("y2"); // lat điểm kết thúc

  if (!transport || !x1 || !y1 || !x2 || !y2) {
    return NextResponse.json({ error: "Missing required params: transport, x1, y1, x2, y2" }, { status: 400 });
  }

  if (!["car", "bike", "pedestrian"].includes(transport)) {
    return NextResponse.json({ error: "Invalid transport type. Must be car, bike, or pedestrian." }, { status: 400 });
  }

  const baseUrl = (process.env.NEXT_GEO_API_BASE_URL || "https://api-staging.timdaythay.com/api/full").replace(/\/$/, "");
  const apiKey = process.env.NEXT_GEO_API_KEY || "";

  const params = new URLSearchParams({ x1, y1, x2, y2 });
  const url = `${baseUrl}/routings/getrouting/${transport}?${params}`;

  const headers: Record<string, string> = {
    "Accept-Language": "vi",
  };
  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }

  try {
    // Cho phép Next.js và fetch cache kết quả (mặc định nextjs cache fetch)
    const res = await fetch(url, { 
      headers,
      next: { revalidate: 86400 } // Cache 24h
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return NextResponse.json({ error: `Upstream error ${res.status}`, detail: text }, { status: res.status });
    }
    const data = await res.json();
    return NextResponse.json(data, {
      headers: { 
        "Cache-Control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800" 
      },
    });
  } catch (err) {
    return NextResponse.json({ error: "Failed to fetch routing", detail: String(err) }, { status: 502 });
  }
}
