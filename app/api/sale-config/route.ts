import { NextResponse } from "next/server";
import { fetchSaleConfig } from "@/lib/sale-config";

export const revalidate = 60; // 60s — sửa sheet là app cập nhật trong ~1 phút

export async function GET() {
  const sales = await fetchSaleConfig();
  return NextResponse.json(
    { sales },
    { headers: { "Cache-Control": "public, max-age=0, s-maxage=60, stale-while-revalidate=600" } }
  );
}
