import { NextResponse } from "next/server";
import { fetchNearbyStores } from "@/lib/api-stores";

export const revalidate = 0; // Dynamic route based on location query parameters

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


