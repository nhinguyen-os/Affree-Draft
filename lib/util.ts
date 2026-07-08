import type { Catalog, Offer, Product, RankedOffer, Store } from "./types";
import { chainFromStoreId, chainLabel, getStore, storeCurrency } from "./stores";

export function formatVnd(n: number): string {
  return new Intl.NumberFormat("vi-VN").format(Math.round(n)) + "₫";
}

/**
 * Định dạng giá theo tiền tệ của cửa hàng.
 * - "USD" → "$6.50" (en-US, 2 số lẻ).
 * - "VND"/trống → "50.000₫" (vi-VN, làm tròn nguyên).
 * - Tiền tệ khác → "6.5 EUR" (giữ tối đa 2 số lẻ + mã tiền).
 */
export function formatMoney(n: number, currency?: string): string {
  const cur = (currency || "VND").toUpperCase();
  if (cur === "VND") return formatVnd(n);
  if (cur === "USD")
    return (
      "$" +
      new Intl.NumberFormat("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(n)
    );
  return (
    new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(n) +
    " " +
    cur
  );
}

/** Bỏ dấu tiếng Việt + lowercase để tìm kiếm không phân biệt dấu. */
export function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "d")
    .toLowerCase()
    .trim();
}

/** Khoảng cách Haversine giữa 2 toạ độ (km). */
export function distanceKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function searchProducts(catalog: Catalog, query: string): Product[] {
  const q = normalize(query);
  if (!q) return catalog.products;
  return catalog.products.filter((p) => {
    const hay = normalize(`${p.name} ${p.brand} ${p.category}`);
    return q.split(/\s+/).every((token) => hay.includes(token));
  });
}

/** Levenshtein có chặn sớm — đủ để dung sai gõ sai vài ký tự, không cần thư viện. */
function editDistance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 2) return 99;
  const dp = Array.from({ length: a.length + 1 }, (_, i) => i);
  for (let j = 1; j <= b.length; j++) {
    let prev = dp[0];
    dp[0] = j;
    for (let i = 1; i <= a.length; i++) {
      const tmp = dp[i];
      dp[i] = Math.min(dp[i] + 1, dp[i - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[a.length];
}

/**
 * Tìm kiếm "thông minh": không dấu, nhiều từ khoá (AND), CÓ dung sai gõ sai
 * (vd "netpune" vẫn ra "Neptune") và xếp theo độ liên quan. Mỗi từ khoá phải
 * khớp (chuỗi con hoặc gần đúng) ít nhất 1 từ trong tên/thương hiệu/danh mục.
 */
export function searchProductsRanked(catalog: Catalog, query: string): Product[] {
  const q = normalize(query);
  if (!q) return catalog.products;
  const tokens = q.split(/\s+/).filter(Boolean);

  const scored: { p: Product; score: number }[] = [];
  for (const p of catalog.products) {
    const hay = normalize(`${p.name} ${p.brand} ${p.category}`);
    const words = hay.split(/\s+/).filter(Boolean);
    let total = 0;
    let matchedAll = true;
    for (const t of tokens) {
      let best = 0;
      if (hay.includes(t)) {
        best = hay.startsWith(t) ? 4 : 3; // khớp đầu chuỗi ưu tiên hơn
      } else {
        // Từ ngắn (≤4) bắt buộc khớp chính xác (substring) — KHÔNG fuzzy, tránh "giặt"→"gia",
        // "mắm"→"mì"... lọt nhầm. Chỉ cho sai chính tả với từ ≥5 ký tự.
        const thr = t.length <= 4 ? 0 : t.length <= 7 ? 1 : 2;
        let minD = 99;
        for (const w of words) minD = Math.min(minD, editDistance(t, w));
        if (minD <= thr) best = 2 - minD * 0.5; // gần đúng: điểm thấp hơn khớp thật
      }
      if (best === 0) {
        matchedAll = false;
        break;
      }
      total += best;
    }
    if (matchedAll) scored.push({ p, score: total });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.map((s) => s.p);
}

/**
 * Lấy các offer của 1 sản phẩm, gắn store + khoảng cách, sắp xếp giá rẻ → đắt
 * (hết hàng đẩy xuống cuối). Cửa hàng đầu danh sách còn hàng = rẻ nhất.
 */
export function rankOffersForProduct(
  catalog: Catalog,
  product: Product,
  userLoc: { lat: number; lng: number } | null
): RankedOffer[] {
  const ranked: RankedOffer[] = [];
  for (const offer of catalog.offers) {
    if (offer.productId !== product.id) continue;
    const store = getStore(offer.storeId) ?? fallbackStoreFromOffer(offer);
    const hasCoords = Number.isFinite(store.lat) && Number.isFinite(store.lng);
    const hasUserLoc = !!userLoc && Number.isFinite(userLoc.lat) && Number.isFinite(userLoc.lng);
    ranked.push({
      ...offer,
      store,
      product,
      distanceKm:
        hasUserLoc && hasCoords
          ? distanceKm(userLoc, { lat: store.lat as number, lng: store.lng as number })
          : null,
    });
  }
  ranked.sort((a, b) => {
    if (a.inStock !== b.inStock) return a.inStock ? -1 : 1;
    if (a.price !== b.price) return a.price - b.price;
    // Cùng giá → cửa hàng gần hơn lên trước (khi đã bật định vị).
    return (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity);
  });
  return ranked;
}

function fallbackStoreFromOffer(offer: Offer): Store {
  // Suy chain từ storeId khi chưa nạp được store thật (getStore trượt), theo quy tắc chung
  // chainFromStoreId. Nhờ vậy chainLogo/chainLabel/storeCurrency (slug-hoá / SOURCE_META)
  // vẫn khớp đúng nguồn → hiện đúng logo, tên chuỗi và TIỀN TỆ thay vì mã ID + đ mặc định.
  const chain = chainFromStoreId(offer.storeId);
  return {
    id: offer.storeId,
    chain,
    name: chainLabel(chain),
    address: "Mua online",
    website: offer.productUrl || "",
    online: true,
    currency: storeCurrency(offer.storeId),
  };
}

export function cheapestInStock(offers: RankedOffer[]): RankedOffer | null {
  return offers.find((o) => o.inStock) ?? null;
}

export function directionsUrl(store: Store): string {
  if (store.lat == null || store.lng == null) return store.website || "";
  return `https://www.google.com/maps/dir/?api=1&destination=${store.lat},${store.lng}`;
}
