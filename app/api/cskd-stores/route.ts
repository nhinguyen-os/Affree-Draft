import { NextResponse } from "next/server";
import { fetchCskdStores } from "@/lib/sheet-cskd";

export const revalidate = 300;

export async function GET() {
  const stores = await fetchCskdStores();
  return NextResponse.json({ stores }, { headers: { "Cache-Control": "public, max-age=0, s-maxage=600, stale-while-revalidate=86400" } });
}
