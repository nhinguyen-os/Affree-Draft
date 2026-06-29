import { NextRequest, NextResponse } from "next/server";
import { getCoopTerminalsByAddress } from "@/integrations/coop/backend/client";

export const dynamic = "force-dynamic";

function terminalCodeOf(terminal: Record<string, unknown> | undefined) {
  const terminalCode = terminal?.terminalCode;
  const code = terminal?.code;
  return (typeof terminalCode === "string" ? terminalCode : typeof code === "string" ? code : "").trim();
}

function terminalDistance(terminal: Record<string, unknown>) {
  const raw = terminal.distanceKm ?? terminal.distance;
  const n = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(n) ? n : Number.POSITIVE_INFINITY;
}

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
    const selectedTerminal = [...terminals]
      .filter((item) => terminalCodeOf(item as Record<string, unknown>))
      .sort((a, b) => terminalDistance(a as Record<string, unknown>) - terminalDistance(b as Record<string, unknown>))[0];
    return NextResponse.json({
      source: "cooponline",
      location,
      selectedTerminalCode: terminalCodeOf(selectedTerminal as Record<string, unknown>) || "570_sgc",
      selectedTerminal,
      count: terminals.length,
      terminals,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
