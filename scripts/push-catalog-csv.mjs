/**
 * Đẩy catalog.csv (giá thật cào 2026-06-18) lên tab "catalog" của Google Sheet
 * qua Apps Script action set_catalog (ghi đè toàn bộ).
 * Chạy: node scripts/push-catalog-csv.mjs
 */
import { readFileSync } from "node:fs";

const url = process.env.CATALOG_API_URL || process.argv[2];
if (!url) {
  console.error("Thiếu CATALOG_API_URL (đọc từ .env.local).");
  process.exit(1);
}

const csv = readFileSync(new URL("../catalog.csv", import.meta.url), "utf8").trim();
const [headerLine, ...lines] = csv.split(/\r?\n/);
const headers = headerLine.split(",").map((h) => h.trim());
const rows = lines.map((line) => {
  const cells = line.split(",").map((c) => c.trim());
  const obj = {};
  headers.forEach((h, i) => (obj[h] = cells[i]));
  obj.price = Number(obj.price);
  return obj;
});

const res = await fetch(url, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ action: "set_catalog", rows }),
});
console.log(`set_catalog → HTTP ${res.status}`);
console.log(await res.text());
console.log(`Gửi ${rows.length} dòng.`);
