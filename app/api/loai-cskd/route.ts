import { NextResponse } from "next/server";
import { fetchLoaiCskdTaxonomy } from "@/lib/sheet-cskd";

export const revalidate = 3600;

export async function GET() {
  const taxonomy = await fetchLoaiCskdTaxonomy();
  return NextResponse.json({ taxonomy }, { headers: { "Cache-Control": "public, max-age=0, s-maxage=600, stale-while-revalidate=86400" } });
}
