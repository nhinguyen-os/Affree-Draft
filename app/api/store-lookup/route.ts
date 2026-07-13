import { NextResponse } from "next/server";
import { fetchSheetStores } from "@/lib/sheet-stores";

export const revalidate = 60;

/**
 * Tra 1 cửa hàng theo store_id (cột store_id trong sheet "Cửa hàng").
 * Dùng cho deep-link QR ?storeid=… khi store_id KHÔNG nằm trong danh sách cửa hàng
 * đang tải ở client (client chỉ có cửa hàng quanh vị trí từ Map Server). Nhờ đó link
 * mở đúng trang cửa hàng dù người quét QR đang ở tỉnh khác.
 */
export async function GET(req: Request) {
  const id = (new URL(req.url).searchParams.get("id") || "").trim();
  if (!id) return NextResponse.json({ store: null });
  const stores = await fetchSheetStores(60);
  const store = stores?.find((s) => s.id === id) ?? null;
  return NextResponse.json(
    { store },
    { headers: { "Cache-Control": "public, max-age=0, s-maxage=60, stale-while-revalidate=600" } }
  );
}
