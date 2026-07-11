import { NextResponse } from "next/server";
import { cleanLabel, areaFromAddress, regionForAddress } from "@/lib/geocode";

export const revalidate = 0;

const HCM_VIEWBOX = "106.30,11.20,107.05,10.30";

async function internalSearch(q: string): Promise<any[]> {
  const baseUrl = (process.env.NEXT_GEO_API_BASE_URL || "https://api.goollow.org/api/full").replace(/\/$/, "");
  const apiKey = process.env.NEXT_GEO_API_KEY || "";
  const url = `${baseUrl}/place/autocomplete/json?input=${encodeURIComponent(q)}&limit=6&strictbounds=0`;
  const headers: Record<string, string> = {
    "Accept-Language": "vi",
  };
  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }
  try {
    const res = await fetch(url, { headers });
    if (!res.ok) return [];
    const data = await res.json();
    if (data && Array.isArray(data.predictions)) {
      return data.predictions
        .map((d: any) => {
          const coords = d.geometry?.coordinates || [];
          const lngVal = coords[0];
          const latVal = coords[1];
          const ccVal = d.country_code ?? "";
          return {
            label: d.description ?? d.address ?? "",
            lat: typeof latVal === "number" ? latVal : parseFloat(latVal ?? ""),
            lng: typeof lngVal === "number" ? lngVal : parseFloat(lngVal ?? ""),
            cc: (ccVal ?? "").toLowerCase(),
            area: d.area ?? "",
          };
        })
        .filter((r: any) => Number.isFinite(r.lat) && Number.isFinite(r.lng));
    }
    return [];
  } catch {
    return [];
  }
}

async function nominatimSearch(q: string, bounded: boolean): Promise<any[]> {
  const url =
    `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}` +
    `&addressdetails=1&limit=6` +
    `&viewbox=${HCM_VIEWBOX}${bounded ? "&bounded=1" : ""}`;
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Affree/1.0 (gia-quanh-day price comparison prototype)",
        "Accept-Language": "vi",
      },
      next: { revalidate: 86400 }, // Cache Nominatim search for 24h
    });
    if (!res.ok) return [];
    const data = await res.json();
    // Nếu query bắt đầu bằng số nhà (vd "234 nguyễn...") nhưng Nominatim không trả house_number,
    // tự prepend số nhà vào label để gợi ý hiển thị đúng địa chỉ user đang tìm.
    const houseNumMatch = q.trim().match(/^(\d+[-/]?\d*[a-zA-Z]?)\s/);
    const queryHouseNum = houseNumMatch ? houseNumMatch[1] : null;
    const results = (Array.isArray(data) ? data : [])
      .map((d: { display_name?: string; lat?: string; lon?: string; address?: Record<string, string> }) => {
        let label = cleanLabel(d.address, d.display_name ?? "");
        if (queryHouseNum && !d.address?.house_number && !/^\d/.test(label)) {
          label = `${queryHouseNum} ${label}`;
        }
        return {
          label,
          lat: parseFloat(d.lat ?? ""),
          lng: parseFloat(d.lon ?? ""),
          area: areaFromAddress(d.address),
          cc: (d.address?.country_code ?? "").toLowerCase(),
          region: regionForAddress(d.address),
          street: [d.address?.house_number, d.address?.road].filter(Boolean).join(" "),
          city: d.address?.city || d.address?.town || d.address?.village || "",
          state: d.address?.["ISO3166-2-lvl4"]?.split("-").at(-1) || d.address?.state || "",
          zipCode: d.address?.postcode || "",
        };
      })
      .filter((r: any) => Number.isFinite(r.lat) && Number.isFinite(r.lng));
    return results;
  } catch {
    return [];
  }
}

/**
 * Photon (komoot, OSM-based) — geocoder GLOBAL chạy được từ IP server cloud (Vercel).
 * Dùng thay Nominatim cho query nước ngoài vì Nominatim CHẶN/rate-limit IP datacenter
 * (local IP nhà thì OK nên chỉ lỗi trên production). Trả cùng shape với nominatimSearch.
 */
async function photonSearch(q: string): Promise<any[]> {
  const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=6`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Affree/1.0 (gia-quanh-day price comparison prototype)" },
      next: { revalidate: 86400 },
    });
    if (!res.ok) return [];
    const data = await res.json();
    const feats = Array.isArray(data?.features) ? data.features : [];
    const queryHouseNumber = q.trim().match(/^(\d+[-/]?\d*[a-zA-Z]?)\s/)?.[1] || "";
    return feats
      .map((f: any) => {
        const p = f?.properties ?? {};
        const c = f?.geometry?.coordinates ?? [];
        let line1 = [p.housenumber, p.street].filter(Boolean).join(" ") || p.name || "";
        if (queryHouseNumber && !p.housenumber && !/^\d/.test(line1)) line1 = `${queryHouseNumber} ${line1}`;
        const label = [line1, p.city && p.city !== p.name ? p.city : "", p.state, p.country]
          .filter(Boolean)
          .join(", ");
        return {
          label,
          lat: typeof c[1] === "number" ? c[1] : parseFloat(c[1] ?? ""),
          lng: typeof c[0] === "number" ? c[0] : parseFloat(c[0] ?? ""),
          area: p.district || p.city || "",
          cc: (p.countrycode ?? "").toLowerCase(),
          region: p.state || p.city || "",
          street: line1,
          city: p.city || p.locality || p.county || "",
          state: p.statecode || p.state || "",
          zipCode: p.postcode || "",
        };
      })
      .filter((r: any) => r.label && Number.isFinite(r.lat) && Number.isFinite(r.lng));
  } catch {
    return [];
  }
}

/** Bỏ dấu + lowercase để so khớp token không phân biệt dấu. */
function normalizeText(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase();
}

/** Tỉ lệ token của query xuất hiện trong label (0..1) — dùng re-rank kết quả merge. */
function matchScore(q: string, label: string): number {
  const tokens = normalizeText(q).split(/[\s,]+/).filter((t) => t.length > 0);
  if (!tokens.length) return 0;
  const hay = normalizeText(label);
  const hit = tokens.filter((t) => hay.includes(t)).length;
  return hit / tokens.length;
}

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get("q")?.trim();
  if (!q || q.length < 3) {
    return NextResponse.json([]);
  }

  try {
    // Chạy SONG SONG goollow (VN autocomplete) + Photon (global, chạy được trên Vercel).
    // Merge để địa chỉ VN vẫn ưu tiên goollow lên đầu, còn địa chỉ nước ngoài (New York,
    // Toronto…) vẫn ra kết quả toàn cầu. Photon THAY Nominatim làm nguồn global vì Nominatim
    // bị chặn/rate-limit từ IP Vercel. Nếu Photon lỗi/rỗng → fallback Nominatim (unbounded).
    const [internal, photon] = await Promise.all([
      internalSearch(q),
      photonSearch(q),
    ]);
    const global = photon.length ? photon : await nominatimSearch(q, false);
    const merged: any[] = [];
    const seen = new Set<string>();
    for (const list of [internal, global]) {
      for (const r of list) {
        // Khử trùng theo NHÃN (chuẩn hoá) — Photon/Nominatim hay trả nhiều node OSM cùng 1
        // địa chỉ, nhãn y hệt nhưng toạ độ lệch ở số lẻ nhỏ → dedup-theo-toạ-độ không gom được,
        // ra 5-6 dòng trùng. Nhãn rỗng thì mới fallback về toạ độ làm tròn.
        const label = normalizeText(r.label ?? "").replace(/\s+/g, " ").trim();
        const key = label || `${r.lat.toFixed(4)},${r.lng.toFixed(4)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push(r);
      }
    }
    // Re-rank theo mức khớp token với query — query nước ngoài ("1 Yonge Street
    // Toronto") khớp gần đủ token với label Nominatim nên nổi lên trên các
    // false-match VN chỉ khớp mỗi số nhà. Sort ổn định → cùng điểm giữ thứ tự
    // goollow-trước (địa chỉ VN không đổi hành vi).
    const ranked = merged
      .map((r, i) => ({ r, i, score: matchScore(q, r.label ?? "") }))
      .sort((a, b) => b.score - a.score || a.i - b.i)
      .slice(0, 8)
      .map((x) => x.r);
    return NextResponse.json(ranked);
  } catch (err) {
    return NextResponse.json([]);
  }
}
