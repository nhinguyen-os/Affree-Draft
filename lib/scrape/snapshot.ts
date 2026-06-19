import type { Chain } from "@/lib/types";
import { PRODUCTS } from "@/lib/seed-catalog";
import { STORES } from "@/lib/stores";
import type { ScrapedRow } from "./types";
import snapshot from "./real-snapshot.json";

type SnapEntry = {
  name?: string;
  price?: number;
  url?: string;
  in_stock?: number;
  match: "exact" | "size" | "brand" | "none";
  note?: string;
};

const DATA = (snapshot as { data: Record<string, Partial<Record<Chain, SnapEntry>>> }).data;

/**
 * Nguồn data THẬT cho 1 chuỗi, dựng từ real-snapshot.json (chụp thủ công qua
 * trình duyệt). Giá/url/tồn ở cấp chuỗi được fan-out ra mọi cửa hàng vật lý của
 * chuỗi đó (cùng web bán hàng → cùng giá online). Bỏ qua sp chuỗi không bán.
 *
 * Thay thế simulateChain (giả lập từ seed) để pipeline cào (cron/menu/route)
 * luôn ghi data thật, không đè lên bằng link tìm kiếm. Khi có scraper HTTP thật
 * theo thời gian thực, thay file chuỗi tương ứng để gọi API/web thật.
 */
export function snapshotChain(chain: Chain): ScrapedRow[] {
  const now = new Date().toISOString();
  const storesOfChain = STORES.filter((s) => s.chain === chain);
  const rows: ScrapedRow[] = [];

  for (const product of PRODUCTS) {
    const entry = DATA[product.id]?.[chain];
    if (!entry || entry.match === "none" || entry.price == null || !entry.url) continue;
    for (const store of storesOfChain) {
      rows.push({
        product_id: product.id,
        product_name: product.name,
        brand: product.brand,
        category: product.category,
        unit: product.unit,
        chain,
        store_id: store.id,
        price: entry.price,
        in_stock: entry.in_stock ? 1 : 0,
        product_url: entry.url,
        last_checked: now,
      });
    }
  }
  return rows;
}
