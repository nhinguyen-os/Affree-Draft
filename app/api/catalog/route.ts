import { NextResponse } from "next/server";
import { PRODUCT_IMAGES, SEED_CATALOG } from "@/lib/seed-catalog";
import { fetchMasterCatalog } from "@/lib/sheet-catalog";
import { fetchSheetGroups } from "@/lib/sheet-groups";
import { fetchSimilarGroups } from "@/lib/sheet-similar";
import { fetchTui } from "@/lib/sheet-tui";
import { fetchDiscountMap } from "@/lib/sheet-discount";
import { fetchSheetStores } from "@/lib/sheet-stores";
import { setDynamicStores } from "@/lib/stores";
import type { Catalog, Chain, Offer, Product } from "@/lib/types";

// Cache 30s ở Vercel edge — request đầu mỗi 30s mới đập Google Sheets (~3.5s), các request
// sau lấy từ cache (~100ms). Sửa sheet hiện sau ≤30s. Trade-off chấp nhận: trước đây
// revalidate=0 khiến mọi user đợi 3.5s; giờ chỉ 1 user/30s phải đợi.
export const revalidate = 30;

// Nguồn catalog CHÍNH: Google Sheet "Danh sách sản phẩm" (định dạng product_id) trong
// folder Affree mới. Đọc trực tiếp CSV (không qua Apps Script). Override bằng env CATALOG_CSV_URL.
const CATALOG_CSV_URL =
  process.env.CATALOG_CSV_URL ||
  // Đọc ĐÚNG tab đang nhập liệu (gid=1049432260) qua link export — bản LIVE, phản ánh ngay
  // giá vừa điền. (gviz theo tên "catalog" trước đây trỏ vào tab khác/đang bị cache, thiếu giá.)
  "https://docs.google.com/spreadsheets/d/1Gr93tqONyaV5sxuckgyxdRXrQYt6suZdF-2y2RyA6ns/export?format=csv&gid=1049432260";

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
  // Mọi nguồn sheet (admin sửa) dùng chung 30s để sửa sheet → reload là thấy gần như ngay.
  const [, sheetGroups, similarGroups, discountMap, tui] = await Promise.all([
    fetchSheetStores(30).then(setDynamicStores),
    fetchSheetGroups(30),
    fetchSimilarGroups(30),
    fetchDiscountMap(30),
    fetchTui(30),
  ]);

  /**
   * Gắn cấu hình tệp/ưu tiên từ Google Sheet vào catalog — CHỈ khi catalog chưa
   * tự khai báo (nguồn catalog-tab/apps-script có thể đã trả groups riêng).
   */
  // Override `product.group` + `product.groups[]` theo `product_id` từ tab SanPham (1sZTv) —
  // mỗi product_id có thể xuất hiện nhiều dòng với danh_muc khác nhau → gom thành array để
  // sản phẩm xuất hiện ở NHIỀU section (vd Mì Hảo Hảo vừa "Giỏ tạp hóa" vừa "Worldcup").
  const applyGroupOverrides = (catalog: Catalog): Catalog => {
    const overrides = sheetGroups.sanPhamGroupOverrides;
    const hasGroups = overrides && overrides.size > 0;
    const hasDiscounts = discountMap && discountMap.size > 0;
    if (!hasGroups && !hasDiscounts) return catalog;
    return {
      ...catalog,
      products: catalog.products.map((p) => {
        const gs = hasGroups ? overrides!.get(p.id) : undefined;
        const d = hasDiscounts ? discountMap.get(p.id) : undefined;
        // Sheet "giá hời" là single source of truth — khi tab có entries (hasDiscounts),
        // xoá discountPct gốc từ catalog (% khuyến mãi cũ) cho sp KHÔNG có trong sheet,
        // để section "Giá hời" chỉ hiện đúng list trong sheet.
        const next: Product = { ...p };
        if (gs && gs.length) {
          next.group = gs[0];
          next.groups = gs;
        }
        if (hasDiscounts) {
          if (d != null) next.discountPct = d;
          else delete next.discountPct;
        }
        return next;
      }),
    };
  };
  const withGroups = (catalog: Catalog): Catalog => applyGroupOverrides({
    ...catalog,
    groups: catalog.groups?.length ? catalog.groups : sheetGroups.groups,
    danhMucGroups: catalog.danhMucGroups?.length ? catalog.danhMucGroups : sheetGroups.danhMucGroups,
    priorities: catalog.priorities?.length ? catalog.priorities : sheetGroups.priorities,
    sponsors: catalog.sponsors?.length ? catalog.sponsors : sheetGroups.sponsors,
    similarGroups: similarGroups.length ? similarGroups : catalog.similarGroups,
    tui: tui.length ? tui : catalog.tui,
    mealTitles: catalog.mealTitles?.length ? catalog.mealTitles : sheetGroups.mealTitles,
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
    info: ["info", "mo_ta", "mô tả", "mo ta", "description", "ghi_chu", "ghi chú"].map(idx).find((i) => i >= 0) ?? -1,
    certifications: ["chung_nhan", "chứng nhận", "chung nhan", "certifications", "certification", "cert", "anh_chung_nhan", "ảnh chứng nhận"].map(idx).find((i) => i >= 0) ?? -1,
    chain: idx("chain"),
    storeId: idx("store_id"),
    price: idx("price"),
    listedPrice: ["gia_niem_yet", "giá niêm yết", "gia niem yet", "msrp", "list_price", "listed_price", "gia_bao_bi", "giá bao bì"].map(idx).find((i) => i >= 0) ?? -1,
    discountPct: ["%_khuyen_mai", "%_km", "phan_tram_km", "% khuyến mãi", "% khuyen mai", "khuyen_mai", "khuyến mãi", "discount", "discount_pct"].map(idx).find((i) => i >= 0) ?? -1,
    inStock: idx("in_stock"),
    productUrl: idx("product_url"),
    lastChecked: idx("last_checked"),
  };

  // Cột cấu hình ẩn/hiện sản phẩm trên web (nhiều tên header chấp nhận được).
  // Quy ước: để TRỐNG hoặc 1/x/có/hiện → HIỆN; điền 0/ẩn/off/no/false/không → ẨN.
  // Đánh dấu ở 1 dòng bất kỳ của sản phẩm là ẩn cả sản phẩm đó.
  const showCol = ["hiển thị", "hien_thi", "hienthi", "hiện", "hien", "show", "an_hien", "ẩn/hiện"]
    .map(idx)
    .find((i) => i >= 0) ?? -1;
  const HIDE = new Set(["0", "false", "no", "off", "ẩn", "an", "hide", "hidden", "không", "khong", "ko", "n"]);
  const hiddenIds = new Set<string>();
  if (showCol >= 0) {
    for (let i = 1; i < rows.length; i++) {
      const pid = (rows[i][ci.productId] ?? "").trim();
      if (!pid) continue;
      const v = (rows[i][showCol] ?? "").trim().toLowerCase();
      if (HIDE.has(v)) hiddenIds.add(pid);
    }
  }

  const productMap = new Map<string, Product>();
  const offers: Offer[] = [];

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const productId = (r[ci.productId] ?? "").trim();
    const storeId = (r[ci.storeId] ?? "").trim();
    if (!productId || !storeId) continue;
    if (hiddenIds.has(productId)) continue; // sản phẩm bị tắt hiển thị

    if (!productMap.has(productId)) {
      const listedRaw = ci.listedPrice >= 0
        ? (r[ci.listedPrice] ?? "").replace(/\.(?=\d{3}\b)/g, "").replace(",", ".").replace(/[^\d.]/g, "")
        : "";
      const listedPrice = listedRaw ? Number(listedRaw) : 0;
      let discountPct: number | undefined;
      if (ci.discountPct >= 0) {
        const raw = (r[ci.discountPct] ?? "").trim().replace("%", "").replace(",", ".");
        const n = parseFloat(raw);
        if (isFinite(n) && n > 0) discountPct = n > 1 ? n / 100 : n;
      }
      productMap.set(productId, {
        id: productId,
        name: (r[ci.name] ?? productId).trim(),
        brand: (r[ci.brand] ?? "").trim(),
        category: (r[ci.category] ?? "").trim(),
        group: ci.group >= 0 ? (r[ci.group] ?? "").trim() || undefined : undefined,
        unit: (r[ci.unit] ?? "").trim(),
        image: ci.image >= 0 ? (r[ci.image] ?? "").trim() || undefined : undefined,
        info: ci.info >= 0 ? (r[ci.info] ?? "").trim() || undefined : undefined,
        certifications: (() => {
          if (ci.certifications < 0) return undefined;
          const urls = (r[ci.certifications] ?? "")
            .split(/[;,\n]+/)
            .map((u) => u.trim())
            .filter((u) => /^https?:\/\//i.test(u));
          return urls.length ? urls : undefined;
        })(),
        listedPrice: listedPrice > 0 ? listedPrice : undefined,
        discountPct,
      });
    }

    // Giá có thể là số thuần ("95931"), VND có dấu chấm NGĂN NGHÌN ("40.500" = 40500đ),
    // hoặc USD thập phân ("6.49"). Quy ước: dấu chấm theo sau ĐÚNG 3 chữ số = ngăn nghìn → bỏ;
    // dấu chấm còn lại (1-2 số) = thập phân → giữ. (Giống parseLiveVnd ở sheet-catalog.ts.)
    const priceRaw = (r[ci.price] ?? "")
      .replace(/\.(?=\d{3}\b)/g, "") // "40.500" → "40500"; KHÔNG đụng "6.49"
      .replace(",", ".") // phẩy thập phân → chấm
      .replace(/[^\d.]/g, "");
    const stockRaw = (r[ci.inStock] ?? "").trim().toLowerCase();
    offers.push({
      productId,
      storeId,
      price: priceRaw ? Number(priceRaw) : 0,
      inStock: !["0", "false", "het", "hết", "no", "out"].includes(stockRaw),
      productUrl: (r[ci.productUrl] ?? "").trim(),
      lastChecked: ((r[ci.lastChecked] ?? "").trim() || new Date().toISOString()),
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
