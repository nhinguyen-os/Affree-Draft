import { SEED_CATALOG } from "../lib/seed-catalog";
import { getStore } from "../lib/stores";

const url = process.env.CATALOG_API_URL || process.argv[2];
if (!url) {
  console.error("Thiếu URL. Dùng: node scripts/push-seed.ts <exec_url>");
  process.exit(1);
}

const rows = SEED_CATALOG.offers.map((o) => {
  const store = getStore(o.storeId)!;
  const p = SEED_CATALOG.products.find((x) => x.id === o.productId)!;
  return {
    product_id: p.id,
    product_name: p.name,
    brand: p.brand,
    category: p.category,
    unit: p.unit,
    chain: store.chain,
    store_id: store.id,
    price: o.price,
    in_stock: o.inStock ? 1 : 0,
    product_url: o.productUrl,
    last_checked: o.lastChecked,
  };
});

(async () => {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "set_catalog", rows }),
  });
  console.log("set_catalog:", res.status, await res.text());
})();
