import { STORES, SOURCE_META } from "./stores";
import type { Store } from "./types";

export async function fetchNearbyStores(options: {
  lat: string | null;
  lng: string | null;
  radius?: string;
  limit?: string;
  /** Truyền thẳng businesstypeid (danh sách ID ngăn cách ",") vào API. Ưu tiên hơn category. */
  businesstypeid?: string | null;
  /** Tên category (legacy, dùng CATEGORY_MAP nội bộ). Bị bỏ qua nếu businesstypeid được truyền. */
  category?: string | null;
  /** Lookup map: type_id (số) → label "CATEGORY > Sub" để điền loaiCskd cho store. */
  typeIdToLabel?: Map<number, string>;
}) {
  const { lat, lng, radius = "1000", limit = "1000", businesstypeid, typeIdToLabel } = options;

  const baseUrl = (process.env.NEXT_GEO_API_BASE_URL || "https://api-staging.timdaythay.com/api/full").replace(/\/$/, "");
  const apiKey = process.env.NEXT_GEO_API_KEY || "";

  const locationParam = lat && lng ? `${lat},${lng}` : "10.798005808,106.673447868";

  let url = `${baseUrl}/place/aroundsearch/json?location=${encodeURIComponent(locationParam)}&radius=${radius}&limit=${limit}`;

  if (businesstypeid) {
    url += `&businesstypeid=${encodeURIComponent(businesstypeid)}`;
  }

  const headers: Record<string, string> = {
    "Accept-Language": "vi",
    "Cache-Control": "public, max-age=300, s-maxage=300"
  };
  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }

  try {
    const res = await fetch(url, { headers });
    if (!res.ok) {
      return { source: "static-fallback", stores: [...STORES] };
    }
    const data = await res.json();

    const mappedStores: Store[] = [];
    const seenIds = new Set<string>();

    if (data && Array.isArray(data.result)) {
      for (const place of data.result) {
        const placeId = place.chain_id || place.place_id;
        if (!placeId || seenIds.has(placeId) || !place.name) continue;
        seenIds.add(placeId);

        const name = place.name || "";
        const nameLower = name.toLowerCase();

        let chain = "other";
        if (place.owner_id) {
          chain = String(place.owner_id);
        } else if (nameLower.includes("bách hóa xanh") || nameLower.includes("bhx")) {
          chain = "bhx";
        } else if (nameLower.includes("con cưng") || nameLower.includes("concung")) {
          chain = "concung";
        } else if (nameLower.includes("co.opmart") || nameLower.includes("coopmart") || nameLower.includes("co.op mart") || nameLower.includes("coop mart") || nameLower.includes("co.op") || nameLower.includes("coop")) {
          chain = "coop";
        } else if (nameLower.includes("aeon")) {
          chain = "aeon";
        } else if (nameLower.includes("shopee")) {
          chain = "shopee";
        } else if (nameLower.includes("grabmart") || nameLower.includes("grab")) {
          chain = "grab";
        } else if (nameLower.includes("pnj")) {
          chain = "pnj";
        } else if (nameLower.includes("dalat hasfarm") || nameLower.includes("hasfarm") || nameLower.includes("dalathasfarm")) {
          chain = "dalathasfarm";
        } else if (nameLower.includes("ichiban")) {
          chain = "ichiban";
        } else if (nameLower.includes("lotte")) {
          chain = "lotte";
        } else if (nameLower.includes("korea mart") || nameLower.includes("xin chào korea mart") || nameLower.includes("krmart") || nameLower.includes("korea")) {
          chain = "krmart";
        } else if (nameLower.includes("astrabean") || nameLower.includes("phin lab")) {
          chain = "astrabean";
        } else if (nameLower.includes("gs25")) {
          chain = "GS25";
        } else if (nameLower.includes("circlek") || nameLower.includes("circle k")) {
          chain = "Circle K";
        } else if (nameLower.includes("7eleven") || nameLower.includes("7 eleven") || nameLower.includes("7-eleven")) {
          chain = "7-Eleven";
        } else if (nameLower.includes("phúc long") || nameLower.includes("phuclong")) {
          chain = "Phúc Long";
        } else if (nameLower.includes("highlands")) {
          chain = "Highlands Coffee";
        } else if (nameLower.includes("starbucks")) {
          chain = "Starbucks";
        } else if (nameLower.includes("premium outlets")) {
          chain = "Premium Outlets";
        } else if (nameLower.includes("walmart")) {
          chain = "Walmart";
        } else if (nameLower.includes("costco")) {
          chain = "Costco";
        }

        let website = place.website || "";
        if (!website && SOURCE_META[chain]) {
          website = SOURCE_META[chain].home || "";
        }

        const coords = place.geometry?.coordinates || [];
        const lngVal = coords[0];
        const latVal = coords[1];

        // Map type_id → loaiCskd label ("CATEGORY > Sub") nếu có lookup map
        let loaiCskd: string[] | undefined;
        if (typeIdToLabel && place.type_id != null) {
          const label = typeIdToLabel.get(Number(place.type_id));
          if (label) loaiCskd = [label];
        }

        mappedStores.push({
          id: placeId,
          chain,
          name,
          address: place.formatted_address || "",
          lat: typeof latVal === "number" ? latVal : parseFloat(latVal ?? ""),
          lng: typeof lngVal === "number" ? lngVal : parseFloat(lngVal ?? ""),
          website,
          phone: place.phone || undefined,
          ...(loaiCskd ? { loaiCskd } : {}),
        });
      }
    }

    return { source: "api", stores: mappedStores };
  } catch (err) {
    return { source: "static-fallback", stores: [...STORES] };
  }
}
