import { NextResponse } from "next/server";
import { fetchLoaiCskdFromApi } from "@/lib/api-business-types";

export const revalidate = 3600;

export async function GET() {
  const taxonomy = await fetchLoaiCskdFromApi();
  return NextResponse.json({ taxonomy }, { headers: { "Cache-Control": "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400" } });
}
