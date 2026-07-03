import { NextResponse } from "next/server";
import { fetchNearbyStores } from "@/lib/api-stores";
import { fetchBusinessTypeTaxonomy } from "@/lib/api-business-types";

export const revalidate = 30; // 30s — đồng bộ với các nguồn khác

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const lat = searchParams.get("lat");
  const lng = searchParams.get("lng");
  const radius = searchParams.get("radius") || "1000";
  const limit = searchParams.get("limit") || "500";
  // businesstypeid ưu tiên hơn category (legacy).
  // Caller (trang chủ / CSKD map) truyền thẳng danh sách ID ngăn cách "," hoặc chữ "cskd" để tự lấy tất cả.
  let businesstypeid = searchParams.get("businesstypeid");
  const category = searchParams.get("category");

  let typeIdToLabel: Map<number, string> | undefined;

  if (businesstypeid === "cskd") {
    const { allSubTypeIds, typeIdToLabel: mapping } = await fetchBusinessTypeTaxonomy();
    businesstypeid = allSubTypeIds.join(",");
    typeIdToLabel = mapping;
  }

  // Chỉ lấy cửa hàng quanh vị trí từ Map Server API
  const result = await fetchNearbyStores({
    lat,
    lng,
    radius,
    limit,
    businesstypeid,
    category,
    typeIdToLabel,
  });

  return NextResponse.json(result, { headers: { "Cache-Control": "public, max-age=60, s-maxage=60, stale-while-revalidate=3600" } });
}


