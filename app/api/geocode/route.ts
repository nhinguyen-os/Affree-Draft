import { NextResponse } from "next/server";

/**
 * Geocode địa chỉ → toạ độ, dùng Nominatim (OpenStreetMap) miễn phí.
 * Proxy qua server để: (1) gắn User-Agent đúng yêu cầu Nominatim, (2) tránh CORS,
 * (3) cache nhẹ. Giới hạn VN cho kết quả sát hơn.
 */
export const revalidate = 0;

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get("q")?.trim();
  if (!q || q.length < 4) {
    return NextResponse.json({ found: false });
  }

  const url =
    "https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=vn&q=" +
    encodeURIComponent(q);

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Affree/1.0 (gia-quanh-day price comparison prototype)",
        "Accept-Language": "vi",
      },
      // cache cùng địa chỉ trong 1 ngày để đỡ gọi lại Nominatim
      next: { revalidate: 86400 },
    });
    if (!res.ok) return NextResponse.json({ found: false });
    const data = (await res.json()) as Array<{ lat: string; lon: string; display_name?: string }>;
    if (!data.length) return NextResponse.json({ found: false });
    return NextResponse.json({
      found: true,
      lat: Number(data[0].lat),
      lng: Number(data[0].lon),
      label: data[0].display_name || "",
    });
  } catch (err) {
    return NextResponse.json({ found: false, error: String(err) });
  }
}
