import { NextResponse } from "next/server";
import { fetchCskdStoresFromApi } from "@/lib/api-cskd-stores";

export const revalidate = 300;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const lat = searchParams.get("lat") ?? undefined;
  const lng = searchParams.get("lng") ?? undefined;
  const radius = searchParams.get("radius") ?? undefined;
  const limit = searchParams.get("limit") ?? undefined;

  const stores = await fetchCskdStoresFromApi({ lat, lng, radius, limit });
  return NextResponse.json({ stores }, { headers: { "Cache-Control": "public, max-age=300, s-maxage=300, stale-while-revalidate=86400" } });
}

