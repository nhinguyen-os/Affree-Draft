import { NextRequest, NextResponse } from "next/server";
import { getCoopProduct } from "@/integrations/coop/backend/client";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const sku = url.searchParams.get("sku") ?? "";

  if (!sku.trim()) {
    return NextResponse.json({ error: "Missing sku" }, { status: 400 });
  }

  try {
    const product = await getCoopProduct({
      sku,
      terminalCode: url.searchParams.get("terminal") ?? undefined,
    });

    if (!product) {
      return NextResponse.json({ error: "Product not found", sku }, { status: 404 });
    }

    return NextResponse.json({ source: "cooponline", product });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
