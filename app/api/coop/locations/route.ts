import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const LOCATION_API_URL = "https://location.tekoapis.com/api/v1/location";

type CoopLocationLevel = "provinces" | "districts" | "wards";

function normalizeList(data: unknown, level: CoopLocationLevel) {
  const root = data as {
    result?: {
      provinces?: unknown[];
      districts?: unknown[];
      wards?: unknown[];
    };
  };
  const key = level;
  return Array.isArray(root.result?.[key]) ? root.result[key] : [];
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const level = url.searchParams.get("level") as CoopLocationLevel | null;
  if (!level || !["provinces", "districts", "wards"].includes(level)) {
    return NextResponse.json({ error: "Invalid location level" }, { status: 400 });
  }

  const upstream = new URL(`${LOCATION_API_URL}/${level}`);
  const provinceCode = url.searchParams.get("provinceCode");
  const districtCode = url.searchParams.get("districtCode");
  if (level === "districts" && provinceCode) upstream.searchParams.set("provinceCode", provinceCode);
  if (level === "wards" && districtCode) upstream.searchParams.set("districtCode", districtCode);

  try {
    const res = await fetch(upstream, {
      headers: {
        accept: "application/json, text/plain, */*",
        origin: "https://cooponline.vn",
        referer: "https://cooponline.vn/",
      },
      cache: "no-store",
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return NextResponse.json({ error: "Co.op location API failed", detail: data }, { status: 502 });
    }
    return NextResponse.json({ source: "cooponline", level, items: normalizeList(data, level) });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
