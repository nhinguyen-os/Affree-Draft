import { NextRequest, NextResponse } from "next/server";
import { getCoopTerminalsByAddress, resolveCoopTerminal } from "@/integrations/coop/backend/client";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const lat = Number(url.searchParams.get("lat"));
  const lng = Number(url.searchParams.get("lng"));

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json({ error: "Missing lat/lng" }, { status: 400 });
  }

  const location = {
    lat,
    lng,
    address: url.searchParams.get("address") ?? undefined,
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
