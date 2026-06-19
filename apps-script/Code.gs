/**
 * Apps Script Web App cho "Giá Quanh Đây".
 * Gắn với Google Sheet chứa 2 tab:
 *   - "catalog"   : data cào sản phẩm/giá (scraper ghi vào: set_catalog | upsert_catalog)
 *   - "purchases" : lịch sử mua hàng (app ghi vào)
 *
 * CÁCH DÙNG:
 * 1. Mở sheet → Extensions → Apps Script → dán toàn bộ file này.
 * 2. Chạy 1 lần hàm setup() để tự tạo 2 tab + header (cấp quyền khi được hỏi).
 * 3. Deploy → New deployment → type "Web app":
 *      - Execute as: Me
 *      - Who has access: Anyone
 *    → copy URL dạng .../exec
 * 4. Dán URL đó vào .env.local của app:
 *      CATALOG_API_URL=<exec_url>
 *      PURCHASE_WEBHOOK_URL=<exec_url>
 *
 * Mỗi lần SỬA code phải tạo deployment mới (hoặc Manage deployments → edit → version: New)
 * nếu không /exec sẽ chạy bản CŨ.
 */

var CATALOG_HEADERS = [
  "product_id", "product_name", "brand", "category", "unit", "image",
  "chain", "store_id", "price", "in_stock", "product_url", "last_checked"
];
var PURCHASE_HEADERS = [
  "id", "bought_at", "product_id", "product_name",
  "chain", "store_id", "store_name", "qty", "unit_price", "total",
  "buyer_lat", "buyer_lng", "buyer_addr"
];
var ALERT_HEADERS = [
  "id", "created_at", "phone", "product_id", "product_name", "price_at_signup"
];

/**
 * MASTER SHEET (1645 sp do team nhập tay) — KHÁC sheet này. live_upsert ghi giá thật
 * cào được vào ĐÚNG sheet đó (mở bằng ID + tìm tab theo gid). Tài khoản chạy script
 * phải có quyền sửa master sheet (cùng tài khoản team là được).
 */
var MASTER_SHEET_ID = "1NFcjrJGlWzxB8N7A_Hn0iELBJf7FRjvssa0iqlHOeI8";
var MASTER_SHEET_GID = 1729803430;
// Tên 4 cột live — PHẢI khớp LIVE_COLS trong lib/sheet-catalog.ts.
var LIVE_COLS = ["GIA_LIVE", "TON_KHO_LIVE", "CON_TON_TAI", "LAST_CHECKED_LIVE"];
function setup() {
  ensureSheet_("catalog", CATALOG_HEADERS);
  ensureSheet_("purchases", PURCHASE_HEADERS);
  ensureSheet_("alerts", ALERT_HEADERS);
}

/** Menu tùy chỉnh trong Google Sheet để bấm cào tay. */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("Giá Quanh Đây")
    .addItem("Cào lại ngay", "menuScrapeNow_")
    .addSeparator()
    .addItem("Cấu hình URL scrape…", "menuSetScrapeUrl_")
    .addToUi();
}

function menuSetScrapeUrl_() {
  var ui = SpreadsheetApp.getUi();
  var props = PropertiesService.getScriptProperties();
  var cur = props.getProperty("SCRAPE_URL") || "(chưa có)";
  var res = ui.prompt(
    "URL scrape (Vercel)",
    "Dán URL dạng:\nhttps://<app>.vercel.app/api/scrape?secret=<CRON_SECRET>\n\nHiện tại: " + cur,
    ui.ButtonSet.OK_CANCEL
  );
  if (res.getSelectedButton() === ui.Button.OK) {
    props.setProperty("SCRAPE_URL", res.getResponseText().trim());
    ui.alert("Đã lưu URL scrape.");
  }
}

function menuScrapeNow_() {
  var ui = SpreadsheetApp.getUi();
  var url = PropertiesService.getScriptProperties().getProperty("SCRAPE_URL");
  if (!url) {
    ui.alert("Chưa cấu hình URL scrape.\nDùng menu 'Cấu hình URL scrape…' trước.");
    return;
  }
  try {
    var resp = UrlFetchApp.fetch(url, { method: "post", muteHttpExceptions: true });
    ui.alert("Kết quả cào:\n\n" + resp.getContentText().slice(0, 800));
  } catch (err) {
    ui.alert("Lỗi gọi scrape: " + err);
  }
}

function ensureSheet_(name, headers) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  // Luôn đồng bộ dòng header với `headers` (để khi thêm/bớt cột không bị lệch data).
  sh.getRange(1, 1, 1, headers.length).setValues([headers]);
  sh.setFrozenRows(1);
  return sh;
}

/** GET ?type=catalog → { products:[...], offers:[...] } */
function doGet(e) {
  var type = (e && e.parameter && e.parameter.type) || "catalog";
  if (type === "catalog") {
    return json_(readCatalog_());
  }
  return json_({ error: "unknown type" });
}

/** POST { action, ... } */
function doPost(e) {
  var body = {};
  try { body = JSON.parse(e.postData.contents); } catch (err) {}
  var action = body.action;

  if (action === "add_purchase") {
    return json_(addPurchase_(body.record || {}));
  }
  if (action === "add_alert") {
    return json_(addAlert_(body.record || {}));
  }
  if (action === "set_catalog") {
    return json_(setCatalog_(body.rows || []));
  }
  if (action === "upsert_catalog") {
    return json_(upsertCatalog_(body.rows || []));
  }
  if (action === "live_upsert") {
    return json_(liveUpsert_(body.rows || []));
  }
  return json_({ ok: false, error: "unknown action" });
}

function readCatalog_() {
  var sh = ensureSheet_("catalog", CATALOG_HEADERS);
  var values = sh.getDataRange().getValues();
  if (values.length < 2) return { products: [], offers: [] };
  var head = values[0].map(function (h) { return String(h).trim().toLowerCase(); });
  var col = {};
  CATALOG_HEADERS.forEach(function (h) { col[h] = head.indexOf(h); });

  var productMap = {};
  var offers = [];
  for (var i = 1; i < values.length; i++) {
    var r = values[i];
    var pid = String(r[col.product_id] || "").trim();
    var sid = String(r[col.store_id] || "").trim();
    if (!pid || !sid) continue;
    if (!productMap[pid]) {
      productMap[pid] = {
        id: pid,
        name: String(r[col.product_name] || pid).trim(),
        brand: String(r[col.brand] || "").trim(),
        category: String(r[col.category] || "").trim(),
        unit: String(r[col.unit] || "").trim(),
        image: String(r[col.image] || "").trim()
      };
    }
    var stock = String(r[col.in_stock]).trim().toLowerCase();
    offers.push({
      productId: pid,
      storeId: sid,
      price: Number(String(r[col.price]).replace(/[^\d.]/g, "")) || 0,
      inStock: ["0", "false", "het", "hết", "no", "out", ""].indexOf(stock) === -1,
      productUrl: String(r[col.product_url] || "").trim(),
      lastChecked: String(r[col.last_checked] || "").trim()
    });
  }
  var products = Object.keys(productMap).map(function (k) { return productMap[k]; });
  return { products: products, offers: offers };
}

function addPurchase_(rec) {
  var sh = ensureSheet_("purchases", PURCHASE_HEADERS);
  // Bổ sung header buyer_* nếu sheet cũ chỉ có 10 cột.
  if (sh.getLastColumn() < PURCHASE_HEADERS.length) {
    sh.getRange(1, 1, 1, PURCHASE_HEADERS.length).setValues([PURCHASE_HEADERS]);
  }
  sh.appendRow([
    rec.id || Utilities.getUuid(),
    rec.boughtAt || new Date().toISOString(),
    rec.productId || "",
    rec.productName || "",
    rec.chain || "",
    rec.storeId || "",
    rec.storeName || "",
    rec.qty || 0,
    rec.unitPrice || 0,
    rec.total || 0,
    rec.buyerLat != null ? rec.buyerLat : "",
    rec.buyerLng != null ? rec.buyerLng : "",
    rec.buyerAddr || ""
  ]);
  return { ok: true };
}

function addAlert_(rec) {
  var sh = ensureSheet_("alerts", ALERT_HEADERS);
  sh.appendRow([
    rec.id || Utilities.getUuid(),
    rec.createdAt || new Date().toISOString(),
    rec.phone ? ("'" + String(rec.phone).trim()) : "",
    rec.productId || "",
    rec.productName || "",
    rec.priceAtSignup != null ? rec.priceAtSignup : ""
  ]);
  return { ok: true };
}

/** Ghi đè toàn bộ catalog. rows = mảng object theo CATALOG_HEADERS. */
function setCatalog_(rows) {
  var sh = ensureSheet_("catalog", CATALOG_HEADERS);
  if (sh.getLastRow() > 1) {
    sh.getRange(2, 1, sh.getLastRow() - 1, CATALOG_HEADERS.length).clearContent();
  }
  if (!rows.length) return { ok: true, written: 0 };
  var matrix = rows.map(function (row) {
    return CATALOG_HEADERS.map(function (h) { return row[h] != null ? row[h] : ""; });
  });
  sh.getRange(2, 1, matrix.length, CATALOG_HEADERS.length).setValues(matrix);
  return { ok: true, written: matrix.length };
}

/**
 * Upsert catalog theo khóa (product_id|store_id) — chỉ ghi vào tab "catalog":
 *   - đã có  → cập nhật dòng đó (giá, tồn, url, last_checked…)
 *   - chưa có → thêm dòng mới
 * rows = mảng object theo CATALOG_HEADERS.
 */
function upsertCatalog_(rows) {
  var sh = ensureSheet_("catalog", CATALOG_HEADERS);
  var data = sh.getDataRange().getValues();
  var head = data.length
    ? data[0].map(function (h) { return String(h).trim().toLowerCase(); })
    : CATALOG_HEADERS.slice();
  var col = {};
  CATALOG_HEADERS.forEach(function (h) {
    var i = head.indexOf(h);
    col[h] = i >= 0 ? i : CATALOG_HEADERS.indexOf(h);
  });

  var body = data.slice(1);
  var index = {};
  body.forEach(function (r, i) {
    var pid = String(r[col.product_id] || "").trim();
    var sid = String(r[col.store_id] || "").trim();
    if (pid && sid) index[pid + "|" + sid] = i;
  });

  var updated = 0, created = 0;
  rows.forEach(function (row) {
    var key = String(row.product_id) + "|" + String(row.store_id);
    var arr = CATALOG_HEADERS.map(function (h) { return row[h] != null ? row[h] : ""; });
    if (index.hasOwnProperty(key)) {
      body[index[key]] = arr;
      updated++;
    } else {
      index[key] = body.length;
      body.push(arr);
      created++;
    }
  });

  if (sh.getLastRow() > 1) {
    sh.getRange(2, 1, sh.getLastRow() - 1, CATALOG_HEADERS.length).clearContent();
  }
  if (body.length) {
    sh.getRange(2, 1, body.length, CATALOG_HEADERS.length).setValues(body);
  }
  return { ok: true, updated: updated, created: created };
}

/**
 * Ghi giá/tồn/tồn-tại cào được vào MASTER SHEET, khớp theo link sản phẩm.
 * rows = [{ url, sku, name, source, price, inStock, exists }]
 *   - link có trong sheet  → cập nhật 4 cột live của dòng đó.
 *   - link chưa có         → thêm dòng mới (sku/name/source/url + 4 cột live).
 * Trả { ok, updated, created, gone }.
 */
function liveUpsert_(rows) {
  if (!rows || !rows.length) return { ok: true, updated: 0, created: 0, gone: 0 };

  var ss = SpreadsheetApp.openById(MASTER_SHEET_ID);
  var sh = null, all = ss.getSheets();
  for (var s = 0; s < all.length; s++) {
    if (all[s].getSheetId() === MASTER_SHEET_GID) { sh = all[s]; break; }
  }
  if (!sh) return { ok: false, error: "Không tìm thấy tab gid=" + MASTER_SHEET_GID };

  var data = sh.getDataRange().getValues();
  if (data.length < 1) return { ok: false, error: "Master sheet rỗng" };
  var header = data[0];

  function findCol(keys) {
    for (var i = 0; i < header.length; i++) {
      var h = String(header[i]).toUpperCase();
      for (var k = 0; k < keys.length; k++) if (h.indexOf(keys[k]) !== -1) return i;
    }
    return -1;
  }
  var cUrl = findCol(["URL_SAN_PHAM", "URL"]);
  var cSku = findCol(["SKU", "MÃ SẢN PHẨM"]);
  var cName = findCol(["PRODUCT_NAME", "TÊN SẢN PHẨM"]);
  var cSource = findCol(["SOURCE"]);
  if (cUrl < 0) return { ok: false, error: "Master sheet không có cột URL" };

  // Đảm bảo 4 cột live tồn tại (thêm vào cuối nếu thiếu); giữ data hình chữ nhật.
  var liveIdx = {};
  for (var L = 0; L < LIVE_COLS.length; L++) {
    var name = LIVE_COLS[L];
    var idx = -1;
    for (var hi = 0; hi < header.length; hi++) {
      if (String(header[hi]).toUpperCase() === name) { idx = hi; break; }
    }
    if (idx < 0) {
      idx = header.length;
      header.push(name);
      for (var ri = 1; ri < data.length; ri++) data[ri].push("");
    }
    liveIdx[name] = idx;
  }
  var width = header.length;

  // Map link (chuẩn hoá) → chỉ số dòng trong data.
  function normUrl(u) { return String(u || "").trim().toLowerCase().replace(/\/+$/, ""); }
  var byUrl = {};
  for (var d = 1; d < data.length; d++) {
    var u = normUrl(data[d][cUrl]);
    if (u) byUrl[u] = d;
  }

  var now = new Date().toISOString();
  var updated = 0, created = 0, gone = 0;
  for (var r = 0; r < rows.length; r++) {
    var row = rows[r];
    var key = normUrl(row.url);
    if (!key) continue;
    var di = byUrl[key];
    if (di == null) {
      // Link mới — thêm dòng.
      var arr = [];
      for (var w = 0; w < width; w++) arr.push("");
      if (cSku >= 0) arr[cSku] = row.sku || "";
      if (cName >= 0) arr[cName] = row.name || "";
      if (cSource >= 0) arr[cSource] = row.source || "";
      arr[cUrl] = row.url || "";
      di = data.length;
      byUrl[key] = di;
      data.push(arr);
      created++;
    } else {
      updated++;
    }
    var exists = row.exists !== false;
    if (!exists) gone++;
    data[di][liveIdx["GIA_LIVE"]] = row.price != null ? row.price : "";
    data[di][liveIdx["TON_KHO_LIVE"]] = row.inStock == null ? "" : (row.inStock ? "1" : "0");
    data[di][liveIdx["CON_TON_TAI"]] = exists ? "1" : "0";
    data[di][liveIdx["LAST_CHECKED_LIVE"]] = now;
  }

  sh.getRange(1, 1, data.length, width).setValues(data);
  return { ok: true, updated: updated, created: created, gone: gone };
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
