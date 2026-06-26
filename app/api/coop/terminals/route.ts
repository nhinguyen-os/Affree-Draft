import { NextRequest, NextResponse } from "next/server";
import { getCoopTerminalsByAddress, resolveCoopTerminal } from "@/integrations/coop/backend/client";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const latParam = url.searchParams.get("lat");
  const lngParam = url.searchParams.get("lng");
  const lat = latParam == null ? undefined : Number(latParam);
  const lng = lngParam == null ? undefined : Number(lngParam);
  const address = url.searchParams.get("address")?.trim() || undefined;
  const hasLatLng = Number.isFinite(lat) && Number.isFinite(lng);

  if (!hasLatLng && !address) {
    return NextResponse.json({ error: "Missing address or lat/lng" }, { status: 400 });
  }

  const location = {
    lat: hasLatLng ? lat : undefined,
    lng: hasLatLng ? lng : undefined,
    address,
  };

  try {
    const terminals = await getCoopTerminalsByAddress(location);
    const selected = await resolveCoopTerminal({ location });
    return NextResponse.json({
      source: "cooponline",
      location,
      selectedTerminalCode: selected.terminalCode,
      selectedTerminal: selected.terminal,
      count: terminals.length,
      terminals,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
