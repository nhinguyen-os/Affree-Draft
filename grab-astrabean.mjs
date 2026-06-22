import { chromium } from "playwright";
import { writeFileSync } from "fs";

const URL = "https://day-sales.com/store/astrabean/product";
const captures = [];
const reqLog = [];

const browser = await chromium.launch({ headless: false });
const page = await browser.newPage({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36" });

page.on("request", (r) => {
  const u = r.url();
  if (/\/api\//.test(u) || /core\.day-sales/.test(u)) reqLog.push(r.method() + " " + u);
});
page.on("response", async (res) => {
  const u = res.url();
  const ct = res.headers()["content-type"] || "";
  if (!/json/.test(ct)) return;
  if (!/\/api\//.test(u) && !/core\.day-sales/.test(u)) return;
  try {
    const j = await res.json();
    const s = JSON.stringify(j);
    captures.push({
      url: u, status: res.status(),
      hasProducts: /"price"|"product_name"|"sale_price"|"unit_price"|"sku"|"products"/.test(s),
      body: j,
    });
  } catch {}
});

await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 60000 }).catch((e) => console.log("goto err", e.message));
await page.waitForTimeout(6000);
for (let i = 0; i < 6; i++) { await page.mouse.wheel(0, 5000); await page.waitForTimeout(1200); }

const title = await page.title();
const bodyText = (await page.evaluate(() => document.body.innerText)).slice(0, 800);
await page.screenshot({ path: "/tmp/astrabean.png", fullPage: false }).catch(() => {});
await browser.close();

console.log("title:", title);
console.log("=== request log (", reqLog.length, ") ===");
reqLog.slice(0, 40).forEach((r) => console.log(r));
console.log("=== json captures (", captures.length, ") ===");
for (const c of captures) {
  const b = c.body;
  const arr = Array.isArray(b?.data) ? b.data : Array.isArray(b?.data?.data) ? b.data.data : Array.isArray(b) ? b : null;
  console.log(`[${c.status}] prod=${c.hasProducts} len=${arr ? arr.length : "-"} ${c.url}`);
}
console.log("=== body text ===\n", bodyText);
writeFileSync("/tmp/astrabean-api.json", JSON.stringify(captures, null, 1));
