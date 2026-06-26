import { NextRequest, NextResponse } from "next/server";
import { searchCoopProducts } from "@/integrations/coop/backend/client";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const query = url.searchParams.get("q") ?? url.searchParams.get("query") ?? "";

  if (!query.trim()) {
    return NextResponse.json({ error: "Missing q" }, { status: 400 });
  }

  try {
    const lat = Number(url.searchParams.get("lat"));
    const lng = Number(url.searchParams.get("lng"));
    const data = await searchCoopProducts({
      query,
      terminalCode: url.searchParams.get("terminal") ?? undefined,
      location:
        Number.isFinite(lat) && Number.isFinite(lng)
          ? {
              lat,
              lng,
              address: url.searchParams.get("address") ?? undefined,
            }
          : undefined,
      page: Number(url.searchParams.get("page") ?? 1),
      pageSize: Number(url.searchParams.get("pageSize") ?? url.searchParams.get("limit") ?? 20),
      storeLimit: Number(url.searchParams.get("storeLimit") ?? 50),
    });
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
