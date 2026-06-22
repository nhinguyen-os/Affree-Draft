import { NextResponse } from "next/server";
import { fetchSheetStores } from "@/lib/sheet-stores";
import { STORES } from "@/lib/stores";

export const revalidate = 300; // cache 5 phút

/**
 * Danh sách cửa hàng vật lý (store_id, toạ độ, địa chỉ…) cho client dựng marker bản đồ
 * và tính khoảng cách. Ưu tiên tab "stores" trên Google Sheet → fallback STORES tĩnh.
 */
export async function GET() {
  const sheet = await fetchSheetStores(revalidate);
  if (sheet && sheet.length) {
    return NextResponse.json({ source: "stores-tab", stores: sheet });
  }
  return NextResponse.json({ source: "static", stores: STORES });
}
