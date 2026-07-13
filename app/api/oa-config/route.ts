import { NextResponse } from "next/server";
import { fetchOaConfig } from "@/lib/oa-config";

export const revalidate = 60; // 60s — sửa tab config OA là app cập nhật trong ~1 phút

export async function GET() {
  const oa = await fetchOaConfig();
  return NextResponse.json(
    { oa },
    { headers: { "Cache-Control": "public, max-age=0, s-maxage=60, stale-while-revalidate=600" } }
  );
}
