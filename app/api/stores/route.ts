import { NextResponse } from "next/server";
import { fetchNearbyStores } from "@/lib/api-stores";
import { fetchBusinessTypeTaxonomy } from "@/lib/api-business-types";
import { fetchSheetStores } from "@/lib/sheet-stores";
import type { Store } from "@/lib/types";

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
  const [result, sheetStores] = await Promise.all([
    fetchNearbyStores({
      lat,
      lng,
      radius,
      limit,
      businesstypeid,
      category,
      typeIdToLabel,
    }),
    // Catalog dùng store_id của sheet. Cần đưa các store đó về client để offer
    // giữ được terminal_code, kể cả khi Map Server không trả đúng chi nhánh này.
    fetchSheetStores(30),
  ]);

  const storesById = new Map<string, Store>();
  for (const store of result.stores) storesById.set(store.id, store);
  for (const sheetStore of sheetStores ?? []) {
    const existing = storesById.get(sheetStore.id);
    // Map Server giữ dữ liệu theo vùng/CSKD; sheet là nguồn chuẩn cho terminal,
    // mã tiền tệ và metadata cửa hàng mà checkout cần.
    storesById.set(sheetStore.id, existing ? { ...existing, ...sheetStore } : sheetStore);
  }
  const stores = Array.from(storesById.values());

  return NextResponse.json(
    { ...result, stores },
    { headers: { "Cache-Control": "public, max-age=60, s-maxage=60, stale-while-revalidate=3600" } },
  );
}

