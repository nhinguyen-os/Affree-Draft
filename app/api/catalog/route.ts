import { NextResponse } from "next/server";
import { PRODUCT_IMAGES, SEED_CATALOG } from "@/lib/seed-catalog";
import { fetchMasterCatalog } from "@/lib/sheet-catalog";
import { fetchSheetGroups } from "@/lib/sheet-groups";
import { fetchSheetStores } from "@/lib/sheet-stores";
import { setDynamicStores } from "@/lib/stores";
import type { Catalog, Chain, Offer, Product } from "@/lib/types";

export const revalidate = 60; // cache 1 phút — sửa sheet (tệp/emoji/ngành hàng) hiện nhanh hơn

// Nguồn catalog CHÍNH: Google Sheet "Danh sách sản phẩm" (định dạng product_id) trong
// folder Affree mới. Đọc trực tiếp CSV (không qua Apps Script). Override bằng env CATALOG_CSV_URL.
const CATALOG_CSV_URL =
  process.env.CATALOG_CSV_URL ||
  "https://docs.google.com/spreadsheets/d/1Gr93tqONyaV5sxuckgyxdRXrQYt6suZdF-2y2RyA6ns/export?format=csv&gid=0";

/**
 * Dọn tên sản phẩm cào/nhập tay: bỏ dấu phẩy/chấm thừa, gộp khoảng trắng, bỏ ký tự
 * rác ở đầu/cuối. VD "Sữa tươi , Vinamilk ." → "Sữa tươi, Vinamilk".
 */
function cleanName(raw: string): string {
  return (raw || "")
    .replace(/\s+/g, " ") // gộp nhiều khoảng trắng
    .replace(/\s+([,.;:])/g, "$1") // bỏ khoảng trắng trước dấu câu
    .replace(/([,.;:]){2,}/g, "$1") // gộp dấu câu lặp ",," "..." → "," "."
    .replace(/^[\s,.;:]+|[\s,.;:]+$/g, "") // bỏ dấu câu/khoảng trắng đầu & cuối
    .trim();
}

/** Gắn ảnh thật theo product_id cho sp nào chưa có ảnh (vd data từ Google Sheet). */
function withImages(catalog: Catalog): Catalog {
  return {
    ...catalog,
    products: catalog.products.map((p) => ({
      ...p,
      name: cleanName(p.name),
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
  // Nạp danh sách cửa hàng vật lý từ tab "stores" + cấu hình tệp/ưu tiên hiển thị
  // (tab "tệp" & "ưu tiên hiển thị") song song TRƯỚC khi parse catalog.
  const [, sheetGroups] = await Promise.all([
    fetchSheetStores(revalidate).then(setDynamicStores),
    fetchSheetGroups(revalidate),
  ]);

  /**
   * Gắn cấu hình tệp/ưu tiên từ Google Sheet vào catalog — CHỈ khi catalog chưa
   * tự khai báo (nguồn catalog-tab/apps-script có thể đã trả groups riêng).
   */
  const withGroups = (catalog: Catalog): Catalog => ({
    ...catalog,
    groups: catalog.groups?.length ? catalog.groups : sheetGroups.groups,
    priorities: catalog.priorities?.length ? catalog.priorities : sheetGroups.priorities,
  });

  // Nguồn CHÍNH: đọc catalog thẳng từ sheet "Danh sách sản phẩm" (CSV). Lỗi/rỗng → rơi
  // xuống các nguồn dự phòng bên dưới (catalog-tab / master / seed).
  if (CATALOG_CSV_URL) {
    try {
      const res = await fetch(CATALOG_CSV_URL, { next: { revalidate } });
      if (res.ok) {
        const parsed = parseCsv(await res.text());
        if (parsed.products.length) {
          return NextResponse.json({ source: "sheet-csv", ...withGroups(withImages(parsed)) });
        }
      }
    } catch {
      // rơi xuống nguồn dự phòng
    }
  }

  // Công tắc: lấy data từ tab catalog làm nguồn chính.
  if (process.env.CATALOG_SOURCE === "catalog-tab") {
    const tab = await fetchCatalogTab();
    if (tab) return NextResponse.json({ source: "catalog-tab", ...withGroups(withImages(tab)) });
    return NextResponse.json({
      source: "seed-fallback",
      error: "tab catalog rỗng hoặc lỗi",
      ...withGroups(SEED_CATALOG),
    });
  }

  // 0. Master sheet (1645 sp: giá + ảnh + link thật) — nguồn chính mặc định.
  const master = await fetchMasterCatalog(revalidate);
  if (master) {
    return NextResponse.json({ source: "master-sheet", ...withGroups(withImages(master)) });
  }

  const tab = await fetchCatalogTab();
  if (tab) {
    return NextResponse.json({ source: "apps-script", ...withGroups(withImages(tab)) });
  }

  const csvUrl = process.env.SHEET_CSV_URL;
  if (csvUrl) {
    try {
      const res = await fetch(csvUrl, { next: { revalidate } });
      if (!res.ok) throw new Error(`Sheet HTTP ${res.status}`);
      const catalog = withGroups(withImages(parseCsv(await res.text())));
      return NextResponse.json({ source: "sheet-csv", ...catalog });
    } catch (err) {
      return NextResponse.json({ source: "seed-fallback", error: String(err), ...withGroups(SEED_CATALOG) });
    }
  }

  return NextResponse.json({ source: "seed", ...withGroups(SEED_CATALOG) });
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
    group: idx("danh_muc") >= 0 ? idx("danh_muc") : idx("tệp"),
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
        group: ci.group >= 0 ? (r[ci.group] ?? "").trim() || undefined : undefined,
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
