"use client";

/** Geocode địa chỉ → toạ độ qua /api/geocode (Nominatim/OSM). Lỗi → null. */
export async function geocode(
  q: string
): Promise<{ lat: number; lng: number; label?: string } | null> {
  const query = q.trim();
  if (query.length < 4) return null;
  try {
    const res = await fetch(`/api/geocode?q=${encodeURIComponent(query)}`);
    const d = await res.json();
    if (d?.found) return { lat: d.lat, lng: d.lng, label: d.label };
    return null;
  } catch {
    return null;
  }
}
