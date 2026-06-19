import { NextResponse } from "next/server";
import { PRODUCT_IMAGES, SEED_CATALOG } from "@/lib/seed-catalog";
import { fetchMasterCatalog } from "@/lib/sheet-catalog";
import type { Catalog, Chain, Offer, Product } from "@/lib/types";

export const revalidate = 300; // cache 5 phút

/** Gắn ảnh thật theo product_id cho sp nào chưa có ảnh (vd data từ Google Sheet). */
function withImages(catalog: Catalog): Catalog {
  return {
    ...catalog,
    products: catalog.products.map((p) => ({
      ...p,
      image: p.image || PRODUCT_IMAGES[p.id],
    })),
  };
}

/** Đọc tab "catalog" qua Apps Script doGet (?type=catalog) → Catalog | null. */
async function fetchCatalogTab(): Promise<Catalog | null> {
  const apiUrl = process.env.CATALOG_API_URL;
  if (!apiUrl) return null;
  try {
    const res = await fetch(apiUrl, { next: { revalidate } });
    if (!res.ok) return null;
    const data = (await res.json()) as Catalog;
    return data?.products?.length ? data : null;
  } catch {
    return null;
  }
}

/**
 * Nguồn data sản phẩm/giá.
 * - CATALOG_SOURCE=catalog-tab → ƯU TIÊN đọc tab "catalog" (Apps Script). Dùng khi team
 *   muốn web chạy theo tab catalog tự nhập/cào (menu trong sheet). Tab rỗng/lỗi → seed.
 * - Mặc định → master sheet (1645 sp thật) → apps-script → CSV → seed.
 *
 * Đổi nguồn KHÔNG cần sửa code: set/xoá env CATALOG_SOURCE trên Vercel rồi redeploy.
 */
export async function GET() {
  // Công tắc: lấy data từ tab catalog làm nguồn chính.
  if (process.env.CATALOG_SOURCE === "catalog-tab") {
    const tab = await fetchCatalogTab();
    if (tab) return NextResponse.json({ source: "catalog-tab", ...withImages(tab) });
    return NextResponse.json({
      source: "seed-fallback",
      error: "tab catalog rỗng hoặc lỗi",
      ...SEED_CATALOG,
    });
  }

  // 0. Master sheet (1645 sp: giá + ảnh + link thật) — nguồn chính mặc định.
  const master = await fetchMasterCatalog(revalidate);
  if (master) {
    return NextResponse.json({ source: "master-sheet", ...withImages(master) });
  }

  const tab = await fetchCatalogTab();
  if (tab) {
    return NextResponse.json({ source: "apps-script", ...withImages(tab) });
  }

  const csvUrl = process.env.SHEET_CSV_URL;
  if (csvUrl) {
    try {
      const res = await fetch(csvUrl, { next: { revalidate } });
      if (!res.ok) throw new Error(`Sheet HTTP ${res.status}`);
      const catalog = withImages(parseCsv(await res.text()));
      return NextResponse.json({ source: "sheet-csv", ...catalog });
    } catch (err) {
      return NextResponse.json({ source: "seed-fallback", error: String(err), ...SEED_CATALOG });
    }
  }

  return NextResponse.json({ source: "seed", ...SEED_CATALOG });
}

function parseCsv(csv: string): Catalog {
  const rows = splitRows(csv);
  if (rows.length < 2) return { products: [], offers: [] };
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const idx = (name: string) => header.indexOf(name);

  const ci = {
    productId: idx("product_id"),
    name: idx("product_name"),
    brand: idx("brand"),
    category: idx("category"),
    unit: idx("unit"),
    image: idx("image"),
    chain: idx("chain"),
    storeId: idx("store_id"),
    price: idx("price"),
    inStock: idx("in_stock"),
    productUrl: idx("product_url"),
    lastChecked: idx("last_checked"),
  };

  const productMap = new Map<string, Product>();
  const offers: Offer[] = [];

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const productId = (r[ci.productId] ?? "").trim();
    const storeId = (r[ci.storeId] ?? "").trim();
    if (!productId || !storeId) continue;

    if (!productMap.has(productId)) {
      productMap.set(productId, {
        id: productId,
        name: (r[ci.name] ?? productId).trim(),
        brand: (r[ci.brand] ?? "").trim(),
        category: (r[ci.category] ?? "").trim(),
        unit: (r[ci.unit] ?? "").trim(),
        image: ci.image >= 0 ? (r[ci.image] ?? "").trim() || undefined : undefined,
      });
    }

    const priceRaw = (r[ci.price] ?? "").replace(/[^\d]/g, "");
    const stockRaw = (r[ci.inStock] ?? "").trim().toLowerCase();
    offers.push({
      productId,
      storeId,
      price: priceRaw ? Number(priceRaw) : 0,
      inStock: !["0", "false", "het", "hết", "no", "out"].includes(stockRaw),
      productUrl: (r[ci.productUrl] ?? "").trim(),
      lastChecked: (r[ci.lastChecked] ?? new Date().toISOString()).trim(),
    });
    void (ci.chain as Chain | number); // chain suy ra từ store
  }

  return { products: [...productMap.values()], offers };
}

/** Tách CSV thành mảng hàng × cột, hỗ trợ field có dấu " và dấu phẩy bên trong. */
function splitRows(csv: string): string[][] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  const text = csv.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}
