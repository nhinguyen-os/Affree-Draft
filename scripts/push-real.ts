/**
 * Đẩy data THẬT (scripts/real-snapshot.json) lên Google Sheet (tab catalog)
 * qua Apps Script set_catalog.
 *
 * Snapshot lưu giá/url/tồn ở cấp CHUỖI (mỗi chuỗi 1 entry). Script này fan-out
 * mỗi chuỗi ra tất cả cửa hàng vật lý của chuỗi đó trong lib/stores.ts, dùng
 * chung giá/url/tồn thật (cùng 1 web bán hàng → cùng giá online).
 *
 * Chạy: CATALOG_API_URL=<exec_url> npx tsx scripts/push-real.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PRODUCTS } from "../lib/seed-catalog";
import { STORES } from "../lib/stores";
import type { Chain } from "../lib/types";

const url = process.env.CATALOG_API_URL || process.argv[2];
if (!url) {
  console.error("Thiếu URL. Dùng: CATALOG_API_URL=<exec_url> npx tsx scripts/push-real.ts");
  process.exit(1);
}

type SnapEntry = {
  name?: string;
  price?: number;
  url?: string;
  in_stock?: number;
  match: "exact" | "size" | "brand" | "none";
  note?: string;
};
type Snapshot = { data: Record<string, Partial<Record<Chain, SnapEntry>>> };

const snap = JSON.parse(
  readFileSync(join(__dirname, "..", "lib", "scrape", "real-snapshot.json"), "utf8"),
) as Snapshot;

const now = new Date().toISOString();
const rows: Record<string, string | number>[] = [];

for (const product of PRODUCTS) {
  const byChain = snap.data[product.id] ?? {};
  for (const store of STORES) {
    const entry = byChain[store.chain];
    // bỏ qua nếu chuỗi không bán sp này (none / thiếu giá / thiếu url)
    if (!entry || entry.match === "none" || entry.price == null || !entry.url) continue;
    rows.push({
      product_id: product.id,
      product_name: product.name,
      brand: product.brand,
      category: product.category,
      unit: product.unit,
      chain: store.chain,
      store_id: store.id,
      price: entry.price,
      in_stock: entry.in_stock ? 1 : 0,
      product_url: entry.url,
      last_checked: now,
    });
  }
}

(async () => {
  console.log(`Đẩy ${rows.length} dòng thật lên catalog…`);
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "set_catalog", rows }),
  });
  console.log("set_catalog:", res.status, await res.text());
})();
