/**
 * Scraper THẬT bằng Playwright (trình duyệt headless) cho 4 chuỗi.
 * Mở đúng route tìm kiếm của từng chuỗi như người dùng thật → vượt SPA/anti-bot,
 * lấy tên/giá/url/tồn THẬT của sản phẩm gần nhất với mỗi món trong PRODUCTS,
 * rồi POST `upsert_catalog` lên Google Sheet (Apps Script).
 *
 * Chạy local:  CATALOG_API_URL=<exec_url> npx tsx scripts/scrape-live.ts
 * Chạy 1 chuỗi: CHAINS=bhx,coop CATALOG_API_URL=<...> npx tsx scripts/scrape-live.ts
 * Trên CI: GitHub Actions (.github/workflows/scrape.yml) chạy theo lịch.
 *
 * Cơ chế chọn sản phẩm: với mỗi (món × chuỗi) search bằng `q`, lấy kết quả ĐẦU TIÊN
 * có tên chứa đủ từ khoá `must` (lọc rác). Chuỗi nào không có kết quả khớp → bỏ qua
 * (app sẽ hiển thị chuỗi đó không bán món này). Giá/url/tồn ở cấp chuỗi được fan-out
 * ra mọi cửa hàng vật lý của chuỗi trong lib/stores.ts.
 *
 * Lưu ý: web hay đổi layout/route → nếu một chuỗi trả 0 kết quả hàng loạt, kiểm tra
 * lại selector/route trong file này.
 */
import { chromium, type Browser, type Page } from "playwright";
import { PRODUCTS } from "../lib/seed-catalog";
import { STORES } from "../lib/stores";
import type { Chain } from "../lib/types";

type Plan = {
  id: string;
  q: string;
  must: string[]; // tên phải chứa đủ các từ này (lowercase) — lọc đúng loại sp
  mustNot?: string[]; // loại bỏ nếu tên chứa bất kỳ từ nào (combo, đồ chơi…)
  prefer?: string[]; // ưu tiên kết quả khớp size/loại đúng nếu có (vd "1 lít")
};

/** Query + bộ lọc để chọn đúng sản phẩm gần nhất, tránh match rác. */
const PLAN: Plan[] = [
  { id: "milk-vnm-1l", q: "sữa tươi vinamilk có đường", must: ["vinamilk"], prefer: ["1 lít", "1l", "1 l"] },
  { id: "oil-tuongan-1l", q: "dầu ăn tường an", must: ["tường an"], mustNot: ["combo"], prefer: ["1 lít", "1l", "1 l"] },
  { id: "diaper-bobby-m64", q: "tã dán bobby size m", must: ["bobby"], prefer: ["m "] },
  { id: "dish-sunlight-750", q: "nước rửa chén sunlight chanh", must: ["sunlight"], mustNot: ["vim", "combo"], prefer: ["750"] },
  { id: "rice-st25-5kg", q: "gạo st25 5kg", must: ["st25"], prefer: ["5kg", "5 kg"] },
  { id: "formula-friso4-850", q: "friso gold 4 850", must: ["friso"], prefer: ["4"] },
  { id: "noodle-haohao-30", q: "mì hảo hảo thùng", must: ["hảo hảo"], prefer: ["tôm chua cay"] },
  { id: "egg-cp-10", q: "trứng gà hộp 10", must: ["trứng gà"], mustNot: ["khủng long", "đồ chơi", "vịt", "cút"], prefer: ["10"] },
];

const SEARCH_URL: Record<Chain, (q: string) => string> = {
  bhx: (q) => `https://www.bachhoaxanh.com/tim-kiem?key=${encodeURIComponent(q)}`,
  concung: (q) => `https://concung.com/search?search_query=${encodeURIComponent(q)}`,
  coop: (q) => `https://cooponline.vn/search?router=productListing&query=${encodeURIComponent(q)}`,
  aeon: (q) => `https://aeoneshop.com/products/search/${encodeURIComponent(q)}`,
};

type Candidate = { name: string; price: number | null; url: string; oos: boolean };

/** Quét DOM trang kết quả tìm kiếm, trả danh sách sản phẩm ứng viên (chạy trong browser). */
function extractInPage(chain: Chain): Candidate[] {
  const ORIGIN: Record<string, string> = {
    bhx: "https://www.bachhoaxanh.com",
    concung: "",
    coop: "https://cooponline.vn",
    aeon: "https://aeoneshop.com",
  };
  const origin = ORIGIN[chain];
  const out: Candidate[] = [];
  const seen = new Set<string>();
  const anchors = Array.from(document.querySelectorAll("a[href]"));
  for (const a of anchors) {
    const href = a.getAttribute("href") || "";
    let ok = false;
    let url = "";
    if (chain === "bhx") {
      if (/^\/[a-z0-9-]+\/[a-z0-9-]+$/.test(href) && !/^\/(thuong-hieu|kinh-nghiem|tin-tuc)\//.test(href) && a.querySelector("img")) {
        ok = true;
        url = origin + href;
      }
    } else if (chain === "concung") {
      if (/\.html(\?|$)/.test(href)) {
        const clean = href.split("?")[0];
        if (/^https?:\/\//.test(clean)) {
          ok = true;
          url = clean;
        }
      }
    } else if (chain === "coop") {
      if (/--s\d+$/.test(href)) {
        ok = true;
        url = href.startsWith("http") ? href : origin + href;
      }
    } else if (chain === "aeon") {
      if (/^\/product\/\d+\//.test(href)) {
        ok = true;
        url = origin + href;
      }
    }
    if (!ok || seen.has(url)) continue;
    seen.add(url);
    const name = (a.getAttribute("title") || a.textContent || "").replace(/\s+/g, " ").trim();
    if (name.length < 5) continue;
    let card: Element | null = a;
    let price: number | null = null;
    let oos = false;
    for (let i = 0; i < 5 && card; i++) {
      card = card.parentElement;
      if (!card) break;
      const t = card.textContent || "";
      const m = t.match(/(\d{1,3}(?:[.,]\d{3})+)\s*(?:đ|₫)/);
      if (m && price == null) price = Number(m[1].replace(/[.,]/g, ""));
      if (/(hết hàng|tạm hết|ngừng kinh doanh)/i.test(t)) oos = true;
    }
    out.push({ name: name.slice(0, 80), price, url, oos });
  }
  return out;
}

/** Đợi tới khi trang render ra ứng viên (SPA) hoặc hết giờ. */
async function waitForCandidates(page: Page, chain: Chain, timeoutMs = 9000): Promise<Candidate[]> {
  const deadline = Date.now() + timeoutMs;
  let last: Candidate[] = [];
  while (Date.now() < deadline) {
    last = await page.evaluate(extractInPage, chain);
    if (last.length > 0) return last;
    await page.waitForTimeout(600);
  }
  return last;
}

/** Coop: giá thật nằm ở trang chi tiết (.att-product-detail-latest-price), không tin giá listing. */
async function coopDetailPrice(page: Page, url: string): Promise<number | null> {
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      const txt = await page.evaluate(() => {
        const el = document.querySelector('[class*="latest-pric"]');
        return el ? el.textContent || "" : "";
      });
      const m = txt.match(/(\d{1,3}(?:[.,]\d{3})+)/);
      if (m) return Number(m[1].replace(/[.,]/g, ""));
      await page.waitForTimeout(500);
    }
  } catch {
    /* ignore */
  }
  return null;
}

function pick(cands: Candidate[], plan: Plan): Candidate | null {
  const has = (c: Candidate, k: string) => c.name.toLowerCase().includes(k.toLowerCase());
  let ok = cands.filter(
    (c) => c.price != null && plan.must.every((k) => has(c, k)) && !(plan.mustNot || []).some((k) => has(c, k)),
  );
  if (!ok.length) return null;
  // ưu tiên: (đúng size/loại) > (còn hàng) > (đầu danh sách)
  const preferred = plan.prefer ? ok.filter((c) => plan.prefer!.some((k) => has(c, k))) : [];
  const pool = preferred.length ? preferred : ok;
  return pool.find((c) => !c.oos) || pool[0];
}

type Row = Record<string, string | number>;

async function scrapeChain(browser: Browser, chain: Chain): Promise<Row[]> {
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    viewport: { width: 1366, height: 900 },
    locale: "vi-VN",
    timezoneId: "Asia/Ho_Chi_Minh",
    extraHTTPHeaders: { "Accept-Language": "vi-VN,vi;q=0.9,en;q=0.8" },
  });
  // che dấu hiệu headless (một số site như AEON trả rỗng nếu phát hiện bot)
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    Object.defineProperty(navigator, "languages", { get: () => ["vi-VN", "vi", "en"] });
    Object.defineProperty(navigator, "plugins", { get: () => [1, 2, 3] });
  });
  const page = await context.newPage();
  const stores = STORES.filter((s) => s.chain === chain);
  const now = new Date().toISOString();
  const rows: Row[] = [];

  for (const plan of PLAN) {
    const product = PRODUCTS.find((p) => p.id === plan.id)!;
    try {
      await page.goto(SEARCH_URL[chain](plan.q), { waitUntil: "domcontentloaded", timeout: 25000 });
      const cands = await waitForCandidates(page, chain);
      const hit = pick(cands, plan);
      if (!hit) {
        console.log(`  [${chain}] ${plan.id}: không có kết quả khớp (${cands.length} ứng viên)`);
        continue;
      }
      let price = hit.price;
      if (chain === "coop") {
        const detail = await coopDetailPrice(page, hit.url);
        if (detail != null) price = detail;
      }
      if (price == null) {
        console.log(`  [${chain}] ${plan.id}: thiếu giá, bỏ qua`);
        continue;
      }
      console.log(`  [${chain}] ${plan.id}: ${hit.name} = ${price}đ ${hit.oos ? "(hết hàng)" : ""}`);
      for (const store of stores) {
        rows.push({
          product_id: product.id,
          product_name: product.name,
          brand: product.brand,
          category: product.category,
          unit: product.unit,
          chain,
          store_id: store.id,
          price,
          in_stock: hit.oos ? 0 : 1,
          product_url: hit.url,
          last_checked: now,
        });
      }
    } catch (err) {
      console.log(`  [${chain}] ${plan.id}: lỗi ${String(err).slice(0, 80)}`);
    }
  }
  await page.close();
  return rows;
}

async function main() {
  const target = process.env.CATALOG_API_URL;
  if (!target) {
    console.error("Thiếu CATALOG_API_URL.");
    process.exit(1);
  }
  const only = (process.env.CHAINS || "")
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean) as Chain[];
  const chains: Chain[] = only.length ? only : ["bhx", "concung", "coop", "aeon"];

  // headed thật (headless: false): AEON chặn mọi chế độ headless (kể cả --headless=new).
  // Trên CI bọc bằng `xvfb-run` để có display ảo (xem .github/workflows/scrape.yml).
  const browser = await chromium.launch({ headless: false });
  const rows: Row[] = [];
  try {
    for (const chain of chains) {
      console.log(`== Cào ${chain} ==`);
      rows.push(...(await scrapeChain(browser, chain)));
    }
  } finally {
    await browser.close();
  }

  console.log(`\nTổng ${rows.length} dòng. Đẩy upsert_catalog…`);
  if (!rows.length) {
    console.error("Không cào được dòng nào — KHÔNG đẩy (tránh xoá nhầm data).");
    process.exit(1);
  }
  const res = await fetch(target, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "upsert_catalog", rows }),
  });
  console.log("upsert_catalog:", res.status, await res.text());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
