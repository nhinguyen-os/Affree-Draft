import { NextResponse } from "next/server";
import { cleanLabel, areaFromAddress } from "@/lib/geocode";

export const revalidate = 0;

const HCM_VIEWBOX = "106.30,11.20,107.05,10.30";

async function internalSearch(q: string): Promise<any[]> {
  const baseUrl = (process.env.NEXT_GEO_API_BASE_URL || "https://api.goollow.org/api/full").replace(/\/$/, "");
  const apiKey = process.env.NEXT_GEO_API_KEY || "";
  const url = `${baseUrl}/place/autocomplete/json?input=${encodeURIComponent(q)}&limit=6&strictbounds=0`;
  const headers: Record<string, string> = {
    "Accept-Language": "vi",
  };
  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }
  try {
    const res = await fetch(url, { headers });
    if (!res.ok) return [];
    const data = await res.json();
    if (data && Array.isArray(data.predictions)) {
      return data.predictions
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
    return [];
  } catch {
    return [];
  }
}

async function nominatimSearch(q: string, bounded: boolean): Promise<any[]> {
  const url =
    `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}` +
    `&addressdetails=1&limit=6` +
    `&viewbox=${HCM_VIEWBOX}${bounded ? "&bounded=1" : ""}`;
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Affree/1.0 (gia-quanh-day price comparison prototype)",
        "Accept-Language": "vi",
      },
      next: { revalidate: 86400 }, // Cache Nominatim search for 24h
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (Array.isArray(data) ? data : [])
      .map((d: any) => ({
        label: cleanLabel(d.address, d.display_name ?? ""),
        lat: parseFloat(d.lat ?? ""),
        lng: parseFloat(d.lon ?? ""),
        area: areaFromAddress(d.address),
        cc: (d.address?.country_code ?? "").toLowerCase(),
      }))
      .filter((r: any) => Number.isFinite(r.lat) && Number.isFinite(r.lng));
  } catch {
    return [];
  }
}

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get("q")?.trim();
  if (!q || q.length < 3) {
    return NextResponse.json([]);
  }

  try {
    // 1) Thử API nội bộ trước
    const inHcmInternal = await internalSearch(q);
    if (inHcmInternal.length) {
      return NextResponse.json(inHcmInternal);
    }

    // 2) Fallback sang Nominatim (bounded)
    const inHcmNominatim = await nominatimSearch(q, true);
    if (inHcmNominatim.length) {
      return NextResponse.json(inHcmNominatim);
    }

    // 3) Cuối cùng Nominatim (unbounded)
    const globalNominatim = await nominatimSearch(q, false);
    return NextResponse.json(globalNominatim);
  } catch (err) {
    return NextResponse.json([]);
  }
}
