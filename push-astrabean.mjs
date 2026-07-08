import { readFileSync } from "fs";

// đọc CATALOG_API_URL từ .env.local (KHÔNG in ra)
const env = readFileSync(new URL("./.env.local", import.meta.url), "utf8");
const m = env.match(/^CATALOG_API_URL=(.+)$/m);
if (!m) { console.error("CATALOG_API_URL not found in .env.local"); process.exit(1); }
const EXEC = m[1].trim();

const H = { headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" } };

// resolve packing units
const md = await (await fetch("https://day-sales.com/api/public/products/master-data", H)).json();
const unitMap = {};
for (const u of (md.data?.packing_units || md.packing_units || [])) unitMap[u.code] = u.name;

const products = JSON.parse(readFileSync(new URL("/tmp/astrabean-products.json", "file:///"), "utf8"));
const now = new Date().toISOString();

const rows = products.map((p) => {
  const img = p.images?.[0]?.url?.medium || p.images?.[0]?.url?.original || "";
  return {
    product_id: "astrabean-" + p.id,
    product_name: p.name,
    brand: p.brand?.name || "ASTRABEAN",
    category: p.category?.name || "",
    unit: unitMap[p.packing_unit_code] || "",
    image: img,
    chain: "astrabean",
    store_id: "astrabean",
    price: p.sale_price ?? p.price ?? 0,
    in_stock: (p.active && (p.quantity == null || p.quantity > 0)) ? "TRUE" : "FALSE",
    product_url: "https://day-sales.com/store/astrabean/product/" + p.slug,
    last_checked: now,
  };
});

console.log("Sẽ đẩy", rows.length, "sản phẩm. Mẫu 3 dòng:");
console.log(JSON.stringify(rows.slice(0, 3), null, 1));

const res = await fetch(EXEC, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ action: "upsert_catalog", rows }),
});
const txt = await res.text();
console.log("=== upsert response [", res.status, "] ===");
console.log(txt.slice(0, 500));
