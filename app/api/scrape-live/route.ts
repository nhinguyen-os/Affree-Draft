import { NextResponse, after } from "next/server";
import {
  fetchScrapeTargets,
  fetchCatalogScrapeTargets,
  type ScrapeTarget,
  type CatalogScrapeTarget,
} from "@/lib/sheet-catalog";
import { fetchLive, type LiveResult } from "@/lib/scrape/live";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Nguồn cào được bằng fetch + JSON-LD (đã verify). BHX/Aeon/sàn online chặn bot → bỏ qua. */
const SCRAPABLE = new Set(["concung", "coop"]);
const CONCURRENCY = 6;
/** Mỗi lần gọi hàm Vercel tối đa 60s → chỉ cào ~30 sp/mẻ cho an toàn, phần còn lại tự nối mẻ. */
const SWEEP_BATCH = 30;
/** Ngừng cào trong mẻ khi đã chạy quá ngần này (chừa thời gian ghi sheet + nối mẻ). */
const TIME_BUDGET_MS = 45000;

interface LiveRow {
  sku: string;
  url: string;
  name: string;
  source: string;
  price: number | null;
  inStock: boolean | null;
  exists: boolean;
}

/**
 * CÀO GIÁ THẬT từ link sản phẩm rồi ghi ngược vào master sheet (Apps Script live_upsert):
 * cập nhật GIA_LIVE, TON_KHO_LIVE, CON_TON_TAI, LAST_CHECKED_LIVE theo link.
 * Sản phẩm 404/410 → CON_TON_TAI=0 → web tự ẩn.
 *
 * 2 chế độ:
 *   - Mặc định (mẻ lẻ): cào `limit` sp LÂU NHẤT chưa kiểm tra (nút "Cào ngay" ở /admin).
 *   - ?all=1 (quét toàn bộ): cào HẾT tất cả sp cào được, tự NỐI MẺ (after → gọi lại chính
 *     nó với offset kế tiếp) cho tới khi phủ hết. Cron 7h sáng dùng chế độ này.
 *
 * Query: ?write=1 (ghi sheet) · ?all=1 · ?offset=N (nội bộ khi nối mẻ) · ?limit · ?source
 * Bảo vệ bằng CRON_SECRET (?secret= hoặc Bearer).
 */
async function run(req: Request) {
  const secret = process.env.CRON_SECRET;
  const url = new URL(req.url);
  if (secret) {
    const q = url.searchParams.get("secret");
    const h = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (q !== secret && h !== secret) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
  }

  const write = url.searchParams.get("write") === "1";
  const sweepAll = url.searchParams.get("all") === "1";
  const onlySource = url.searchParams.get("source");

  // Đích cào: "catalog" = tab catalog (Apps Script), "master" = master sheet.
  // Không truyền ?target → tự suy từ CATALOG_SOURCE (web đang chạy theo nguồn nào thì cào nguồn đó).
  const targetParam = url.searchParams.get("target");
  const useCatalog =
    targetParam === "catalog" ||
    (!targetParam && process.env.CATALOG_SOURCE === "catalog-tab");
  if (useCatalog) {
    return NextResponse.json(await runCatalog(write));
  }

  const everything = await fetchScrapeTargets();
  const pool = everything.filter((t) =>
    onlySource ? t.chain === onlySource : SCRAPABLE.has(t.chain),
  );

  let targets: ScrapeTarget[];
  let offset = 0;
  if (sweepAll) {
    // Quét toàn bộ: sắp xếp ỔN ĐỊNH theo sku để offset nối mẻ không lệch giữa các lần gọi.
    pool.sort((a, b) => a.sku.localeCompare(b.sku));
    offset = Math.max(0, Number(url.searchParams.get("offset")) || 0);
    targets = pool.slice(offset, offset + SWEEP_BATCH);
  } else {
    // Mẻ lẻ: ưu tiên sp lâu nhất chưa kiểm tra (rỗng = chưa từng).
    pool.sort((a, b) => (a.lastCheckedLive || "").localeCompare(b.lastCheckedLive || ""));
    const limit = Math.min(Number(url.searchParams.get("limit")) || 40, 80);
    targets = pool.slice(0, limit);
  }

  const started = Date.now();
  const rows: LiveRow[] = [];
  let okCount = 0;
  let goneCount = 0;
  let processed = 0;
  for (let i = 0; i < targets.length; i += CONCURRENCY) {
    if (Date.now() - started > TIME_BUDGET_MS) break; // hết thời gian → ghi phần đã có, nối mẻ tiếp
    const batch = targets.slice(i, i + CONCURRENCY);
    const settled = await Promise.all(batch.map((t) => scrapeOne(t)));
    for (const row of settled) {
      if (row.price != null) okCount++;
      if (!row.exists) goneCount++;
      rows.push(row);
    }
    processed += batch.length;
  }

  let upstream: unknown = null;
  if (write && rows.length) {
    upstream = await writeBack(rows);
  }

  // Nối mẻ kế tiếp nếu còn sp chưa quét (chỉ trong chế độ ?all=1 và có ghi sheet).
  const nextOffset = offset + processed;
  const hasMore = sweepAll && write && nextOffset < pool.length && processed > 0;
  if (hasMore) {
    const nextUrl = new URL(url.toString());
    nextUrl.searchParams.set("offset", String(nextOffset));
    const auth = secret ? { Authorization: `Bearer ${secret}` } : undefined;
    after(async () => {
      // Thử lại tối đa 3 lần để tránh rớt mẻ do cold-start tạm thời.
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const r = await fetch(nextUrl.toString(), { method: "POST", headers: auth });
          if (r.ok) return;
        } catch {
          /* thử lại */
        }
        await new Promise((res) => setTimeout(res, 1500));
      }
      // Hết lượt thử → cron hôm sau quét lại từ đầu.
    });
  }

  return NextResponse.json({
    ok: true,
    mode: sweepAll ? "sweep-all" : "batch",
    scrapableTotal: pool.length,
    offset,
    attempted: processed,
    pricesFound: okCount,
    markedGone: goneCount,
    wrote: write,
    chainedNext: hasMore ? nextOffset : null,
    upstream,
  });
}

async function scrapeOne(t: ScrapeTarget): Promise<LiveRow> {
  const live = await fetchLive(t.url);
  return {
    sku: t.sku,
    url: t.url,
    name: t.name,
    source: t.chain,
    price: live.price,
    inStock: live.inStock,
    exists: live.exists,
  };
}

/** POST kết quả về Apps Script để upsert vào master sheet theo link. */
async function writeBack(rows: LiveRow[]): Promise<unknown> {
  const target = process.env.CATALOG_API_URL || process.env.PURCHASE_WEBHOOK_URL;
  if (!target) return { ok: false, error: "CATALOG_API_URL/PURCHASE_WEBHOOK_URL chưa cấu hình" };
  try {
    const res = await fetch(target, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "live_upsert", rows }),
    });
    return await res.json().catch(() => ({ ok: res.ok }));
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

/** Một dòng đầy đủ theo CATALOG_HEADERS để upsert_catalog (ghi đè cả dòng). */
interface CatalogWriteRow {
  product_id: string;
  product_name: string;
  brand: string;
  category: string;
  unit: string;
  chain: string;
  store_id: string;
  price: number;
  in_stock: string;
  product_url: string;
  last_checked: string;
}

/** Dựng full dòng catalog từ target + kết quả cào (giữ lại giá/tồn cũ nếu cào không ra). */
function catalogRow(t: CatalogScrapeTarget, live: LiveResult): CatalogWriteRow {
  const price = live.price != null ? live.price : t.sheetPrice;
  const stock = !live.exists
    ? false
    : live.inStock != null
      ? live.inStock
      : t.sheetInStock;
  return {
    product_id: t.productId,
    product_name: t.product.name,
    brand: t.product.brand,
    category: t.product.category,
    unit: t.product.unit,
    chain: t.chain,
    store_id: t.storeId,
    price,
    in_stock: stock ? "1" : "0",
    product_url: t.url,
    last_checked: new Date().toISOString(),
  };
}

/**
 * CÀO GIÁ THẬT cho sản phẩm trong TAB CATALOG (theo link concung/coop) rồi ghi ngược
 * vào chính tab catalog (upsert_catalog). Tab catalog nhỏ (~20 sp cào được) nên cào
 * gọn 1 mẻ, không cần nối mẻ. 404/410 → in_stock=0.
 */
async function runCatalog(write: boolean) {
  const targets = (await fetchCatalogScrapeTargets()).filter((t) => SCRAPABLE.has(t.chain));
  const started = Date.now();
  const rows: CatalogWriteRow[] = [];
  let okCount = 0;
  let goneCount = 0;
  let processed = 0;
  for (let i = 0; i < targets.length; i += CONCURRENCY) {
    if (Date.now() - started > TIME_BUDGET_MS) break;
    const batch = targets.slice(i, i + CONCURRENCY);
    const settled = await Promise.all(
      batch.map(async (t) => ({ t, live: await fetchLive(t.url) })),
    );
    for (const { t, live } of settled) {
      if (live.price != null) okCount++;
      if (!live.exists) goneCount++;
      rows.push(catalogRow(t, live));
    }
    processed += batch.length;
  }

  let upstream: unknown = null;
  if (write && rows.length) upstream = await writeBackCatalog(rows);

  return {
    ok: true,
    mode: "catalog" as const,
    scrapableTotal: targets.length,
    offset: 0,
    attempted: processed,
    pricesFound: okCount,
    markedGone: goneCount,
    wrote: write,
    chainedNext: null,
    upstream,
  };
}

/** POST full dòng về Apps Script để upsert vào tab catalog. */
async function writeBackCatalog(rows: CatalogWriteRow[]): Promise<unknown> {
  const target = process.env.CATALOG_API_URL || process.env.PURCHASE_WEBHOOK_URL;
  if (!target) return { ok: false, error: "CATALOG_API_URL chưa cấu hình" };
  try {
    const res = await fetch(target, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "upsert_catalog", rows }),
    });
    return await res.json().catch(() => ({ ok: res.ok }));
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

export async function GET(req: Request) {
  return run(req);
}

export async function POST(req: Request) {
  return run(req);
}
