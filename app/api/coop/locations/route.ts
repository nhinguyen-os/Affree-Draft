import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const LOCATION_API_URL = "https://location.tekoapis.com/api/v1/location";
const COOP_LOCATION_TIMEOUT_MS = 8000;
const COOP_LOCATION_ATTEMPTS = 3;

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

async function fetchLocationJson(url: URL) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= COOP_LOCATION_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), COOP_LOCATION_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        headers: {
          accept: "application/json, text/plain, */*",
          "accept-language": "vi",
          origin: "https://cooponline.vn",
          referer: "https://cooponline.vn/",
          "user-agent": "Mozilla/5.0",
        },
        cache: "no-store",
        signal: controller.signal,
      });
      const data = await res.json().catch(() => ({}));
      return { res, data, attempt };
    } catch (err) {
      lastError = err;
      if (attempt < COOP_LOCATION_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
      }
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError;
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
    const { res, data, attempt } = await fetchLocationJson(upstream);
    if (!res.ok) {
      return NextResponse.json({ error: "Co.op location API failed", detail: data, attempt }, { status: 502 });
    }
    return NextResponse.json({ source: "cooponline", level, items: normalizeList(data, level), attempt });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
