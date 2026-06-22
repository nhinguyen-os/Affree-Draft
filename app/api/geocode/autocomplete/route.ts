import { NextResponse } from "next/server";

export const revalidate = 0;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const input = searchParams.get("input") || "";
  const location = searchParams.get("location") || "";
  const limit = searchParams.get("limit") || "6";
  const strictbounds = searchParams.get("strictbounds") || "0";

  const baseUrl = (process.env.NEXT_GEO_API_BASE_URL || "https://api.goollow.org/api/full").replace(/\/$/, "");
  const apiKey = process.env.NEXT_GEO_API_KEY || "";

  const url = `${baseUrl}/place/autocomplete/json?input=${encodeURIComponent(input)}&location=${encodeURIComponent(location)}&limit=${limit}&strictbounds=${strictbounds}`;

  const headers: Record<string, string> = {
    "Accept-Language": "vi",
  };
  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }

  try {
    const res = await fetch(url, { headers });
    if (!res.ok) {
      return NextResponse.json([]);
    }
    const data = await res.json();
    
    let predictions = [];
    if (data && Array.isArray(data.predictions)) {
      predictions = data.predictions
        .map((d: any) => {
          const coords = d.geometry?.coordinates || [];
          const lngVal = coords[0];
          const latVal = coords[1];
          const ccVal = d.country_code ?? "";
          return {
            label: d.description ?? d.address ?? "",
            lat: typeof latVal === "number" ? latVal : parseFloat(latVal ?? ""),
            lng: typeof lngVal === "number" ? lngVal : parseFloat(lngVal ?? ""),
            cc: (ccVal ?? "").toLowerCase(),
            area: d.area ?? "",
          };
        })
        .filter((r: any) => Number.isFinite(r.lat) && Number.isFinite(r.lng));
    }

    return NextResponse.json(predictions);
  } catch (err) {
    return NextResponse.json([]);
  }
}
