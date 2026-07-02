import { NextResponse } from "next/server";
import { cleanLabel, areaFromAddress, regionForAddress } from "@/lib/geocode";

export const revalidate = 0;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const lat = searchParams.get("lat");
  const lng = searchParams.get("lng");
  if (!lat || !lng) {
    return NextResponse.json({ label: "", area: "", cc: "" });
  }

  const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`;

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Affree/1.0 (gia-quanh-day price comparison prototype)",
        "Accept-Language": "vi",
      },
      // cache cùng địa chỉ trong 1 ngày để đỡ gọi lại Nominatim
      next: { revalidate: 86400 },
    });
    if (!res.ok) return NextResponse.json({ label: "", area: "", cc: "" });
    const data = await res.json();
    const a = data?.address ?? {};
    return NextResponse.json({
      label: cleanLabel(a, data?.display_name ?? ""),
      area: areaFromAddress(a),
      cc: (a.country_code ?? "").toLowerCase(),
      region: regionForAddress(a),
    });
  } catch {
    return NextResponse.json({ label: "", area: "", cc: "" });
  }
}
