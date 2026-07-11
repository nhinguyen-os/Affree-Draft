import { NextResponse } from "next/server";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const lat = searchParams.get("lat");
  const lng = searchParams.get("lng");
  const r = searchParams.get("r") ?? "600";

  if (!lat || !lng) return NextResponse.json({ elements: [] });

  const query = `[out:json][timeout:15];
(
  node["amenity"]["name"](around:${r},${lat},${lng});
  node["shop"]["name"](around:${r},${lat},${lng});
  node["tourism"]["name"](around:${r},${lat},${lng});
  node["leisure"]["name"](around:${r},${lat},${lng});
);
out body qt 120;`;

  try {
    const res = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      headers: { "Content-Type": "text/plain", "User-Agent": "Affree/1.0" },
      body: query,
      signal: AbortSignal.timeout(16000),
    });
    const data = await res.json();
    return NextResponse.json(data, {
      headers: { "Cache-Control": "public, max-age=300, s-maxage=300" },
    });
  } catch {
    return NextResponse.json({ elements: [] });
  }
}
