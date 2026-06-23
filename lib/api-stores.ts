import { STORES, SOURCE_META } from "./stores";
import type { Store } from "./types";

const ASTRABEAN_STORE: Store = {
  id: "astrabean",
  chain: "astrabean",
  name: "Astrabean — PHIN LAB",
  address: "San Jose, CA, USA",
  lat: 37.3352,
  lng: -121.8811,
  website: "https://day-sales.com/store/astrabean/product",
  currency: "USD"
};

const CATEGORY_MAP: Record<string, string> = {
  "Đồ ăn": "2,7,16,33,38,61,67,79,83,84,88,138,145,158,164,183,215,222,228,257",
  "Đồ uống": "159,12,120,161,165",
  "Chăm sóc cá nhân": "14,15,45,90,111,112,119,143,144,175,176,177,303",
  "Nhà cửa & vệ sinh": "44,69,72,106,113,148,230,231,240,247,255,258,265,296,319,320,321",
  "Trang sức": "18,55,95,98",
  "Giỏ tạp hóa": "9,10,28,52,64,71,73,80,89,96,99,105,126,129,134,172,181,184,193,201,205,221,223,233,237,266,267,276,297,305,306,307,308,309,310,313"
};

const ALL_OTHER_TYPES = Object.values(CATEGORY_MAP).join(",");

export async function fetchNearbyStores(options: {
  lat: string | null;
  lng: string | null;
  radius?: string;
  limit?: string;
  category?: string | null;
}) {
  const { lat, lng, radius = "1000", limit = "1000", category } = options;

  const baseUrl = (process.env.NEXT_PUBLIC_GEO_API_BASE_URL || "https://api-staging.timdaythay.com/api/full").replace(/\/$/, "");
  const apiKey = process.env.NEXT_PUBLIC_GEO_API_KEY || "";

  const locationParam = lat && lng ? `${lat},${lng}` : "10.798005808,106.673447868";

  let url = `${baseUrl}/place/nearbystatistic/json?location=${encodeURIComponent(locationParam)}&radius=${radius}&limit=${limit}`;

  if (category) {
    const decodedCategory = decodeURIComponent(category);
    const businessTypeId = CATEGORY_MAP[decodedCategory] || ALL_OTHER_TYPES;
    url += `&businesstypeid=${encodeURIComponent(businessTypeId)}`;
  }

  const headers: Record<string, string> = {
    "Accept-Language": "vi",
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

    if (data && Array.isArray(data.results)) {
      for (const group of data.results) {
        if (group && Array.isArray(group.places)) {
          for (const place of group.places) {
            const placeId = place.place_id || place.id;
            if (!placeId || seenIds.has(placeId)) continue;
            seenIds.add(placeId);

            const name = place.name || "";
            const nameLower = name.toLowerCase();

            let chain = "other";
            if (nameLower.includes("bách hóa xanh") || nameLower.includes("bhx")) {
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
            }

            let website = place.website || "";
            if (!website && SOURCE_META[chain]) {
              website = SOURCE_META[chain].home || "";
            }

            const coords = place.location?.coordinates || [];
            const lngVal = coords[0];
            const latVal = coords[1];

            mappedStores.push({
              id: placeId,
              chain,
              name,
              address: place.formatted_address || "",
              lat: typeof latVal === "number" ? latVal : parseFloat(latVal ?? ""),
              lng: typeof lngVal === "number" ? lngVal : parseFloat(lngVal ?? ""),
              website,
            });
          }
        }
      }
    }

    if (!mappedStores.some(s => s.id === "astrabean")) {
      mappedStores.push(ASTRABEAN_STORE);
    }

    return { source: "api", stores: mappedStores };
  } catch (err) {
    return { source: "static-fallback", stores: [...STORES] };
  }
}
