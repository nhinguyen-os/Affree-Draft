import { NextResponse } from "next/server";
import { fetchVersionInfo } from "@/lib/sheet-version";

export const revalidate = 60; // 60s — sửa sheet Phiên bản là app cập nhật trong ~1 phút

export async function GET() {
  const info = await fetchVersionInfo();
  return NextResponse.json(info, {
    headers: {
      "Cache-Control": "public, max-age=0, s-maxage=60, stale-while-revalidate=600",
    },
  });
}
