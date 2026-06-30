import { NextResponse } from "next/server";
import { fetchNearbyStores } from "@/lib/api-stores";

export const revalidate = 30; // 30s — đồng bộ với các nguồn sheet khác (sửa → reload ~30s là thấy)

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const lat = searchParams.get("lat");
  const lng = searchParams.get("lng");
  const radius = searchParams.get("radius") || "1000";
  const limit = searchParams.get("limit") || "500";
  const category = searchParams.get("category");

  const result = await fetchNearbyStores({
    lat,
    lng,
    radius,
    limit,
    category
  });

  return NextResponse.json(result);
}


