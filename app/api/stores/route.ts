import { NextResponse } from "next/server";
import { fetchNearbyStores } from "@/lib/api-stores";
import { fetchSheetStores } from "@/lib/sheet-stores";

export const revalidate = 30; // 30s — đồng bộ với các nguồn sheet khác (sửa → reload ~30s là thấy)

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const lat = searchParams.get("lat");
  const lng = searchParams.get("lng");
  const radius = searchParams.get("radius") || "1000";
  const limit = searchParams.get("limit") || "500";
  const category = searchParams.get("category");

  // Chạy song song: cửa hàng quanh vị trí (Map Server) + chi nhánh từ tab "stores" (Google Sheet).
  // Sheet stores bắt buộc phải có mặt vì offer trong catalog fan-out theo id chi nhánh của sheet
  // (coop-hoa-binh, bhx-…) — thiếu thì trang so sánh mất tên chi nhánh/địa chỉ/khoảng cách.
  const [result, sheetStores] = await Promise.all([
    fetchNearbyStores({
      lat,
      lng,
      radius,
      limit,
      category
    }),
    fetchSheetStores(30),
  ]);

  if (sheetStores?.length) {
    const seen = new Set(result.stores.map((s) => s.id));
    result.stores = [...result.stores, ...sheetStores.filter((s) => !seen.has(s.id))];
  }

  return NextResponse.json(result, { headers: { "Cache-Control": "public, max-age=0, s-maxage=60, stale-while-revalidate=3600" } });
}


