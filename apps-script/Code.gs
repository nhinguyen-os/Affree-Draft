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
// Cột "tệp"/nhóm tuỳ chọn: nếu muốn gắn tay, THÊM Ở CUỐI bảng (sau last_checked),
// tên cột "danh_muc". KHÔNG chèn vào giữa kẻo lệch toàn bộ cột phía sau.
var PURCHASE_HEADERS = [
  "id", "bought_at", "product_id", "product_name",
  "chain", "store_id", "store_name", "qty", "unit_price", "total",
  "buyer_lat", "buyer_lng", "buyer_addr"
];
var ALERT_HEADERS = [
  "id", "created_at", "phone", "product_id", "product_name", "price_at_signup"
];
var BUYER_HEADERS = [
  "phone", "name", "address", "created_at", "updated_at"
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
  ensureSheet_("buyers", BUYER_HEADERS);
}

/** Menu tùy chỉnh trong Google Sheet để bấm cào tay. */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("Giá Quanh Đây")
    .addItem("Cào lại ngay", "menuScrapeNow_")
    .addSeparator()
    .addItem("Cấu hình URL scrape…", "menuSetScrapeUrl_")
    .addSeparator()
    .addItem("① Tạo tab Tệp + cột tệp (dropdown)", "menuSetupTep_")
    .addItem("② Tự gán tệp cho sản phẩm (gợi ý)", "menuAutoFillTep_")
    .addItem("③ Tạo tab Ưu tiên hiển thị + cột ưu tiên", "menuSetupPriority_")
    .addSeparator()
    .addItem("④ Điền giá niêm yết + % KM (từ master sheet)", "menuFillNiemYetKM_")
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

// ───────────────────────── CẤU HÌNH TỆP (DANH MỤC) ─────────────────────────
// Tên tab cấu hình tệp + tên cột tệp trong tab catalog (web đọc qua alias "tệp").
var TEP_TAB = "tệp";
var TEP_COL = "tệp";
// Danh sách tệp chuẩn để seed tab "tệp". Mỗi dòng = [tệp, emoji, link].
// - link rỗng  → ô LỌC sản phẩm theo tệp.
// - link là URL → ô mở trang dịch vụ ngoài (Đi chợ / Định giá / Xây dựng / Nhà đất).
// - link = "soon" → ô "sắp ra mắt" (Cầm đồ).
var TEP_SEED = [
  ["Đi chợ", "🧺", "https://dicho-storefront.vercel.app/"],
  ["Thực phẩm", "🍜", ""],
  ["Sữa", "🥛", ""],
  ["Đồ uống", "🥤", ""],
  ["Chăm sóc cá nhân", "💄", ""],
  ["Nhà cửa & vệ sinh", "🧴", ""],
  ["Trang sức", "💍", ""],
  ["Mẹ & bé", "🍼", ""],
  ["Khác", "🛒", ""],
  ["Cầm đồ", "🏦", "soon"],
  ["Định giá", "📊", "https://homeinfo68.com"],
  ["Xây dựng", "🏗️", "https://housecons68.com"],
  ["Nhà đất", "🏠", "https://homeinfo68.com"]
];
var TEP_HEADERS = ["tệp", "emoji", "link", "ghi_chu", "ưu tiên"];

// ───────────────────────── ƯU TIÊN HIỂN THỊ (THEO CHUỖI) ─────────────────────────
// Tab cấu hình "ưu tiên hiển thị": mỗi dòng = 1 hồ sơ ưu tiên, liệt kê các CHUỖI (store_id,
// vd THXL, TDAT) theo THỨ TỰ ưu tiên giảm dần (cách nhau bởi dấu phẩy).
//   - "ưu tiên" : tên hồ sơ (để cột "ưu tiên" của tab "tệp" tham chiếu qua dropdown).
//   - "chuỗi"   : danh sách store_id, vd "THXL, TDAT" → THXL hiện trước, rồi TDAT.
// Tệp nào KHÔNG gán hồ sơ (ô "ưu tiên" trống) → hiển thị bình thường.
var PRIORITY_TAB = "ưu tiên hiển thị";
var PRIORITY_HEADERS = ["ưu tiên", "chuỗi", "ghi_chu"];
var PRIORITY_SEED = [
  ["Mặc định", "THXL, TDAT", "Áp cho trang chủ / khi không lọc tệp"],
  ["Ưu tiên THXL", "THXL, TDAT", "Ưu tiên hiển thị sản phẩm nguồn THXL rồi đến TDAT"]
];

/**
 * Tạo/đảm bảo tab "tệp" (4 cột: tệp | emoji | link | ghi_chu).
 * MERGE an toàn: bổ sung các tệp chuẩn còn thiếu (vd các ô có link), GIỮ NGUYÊN
 * giá trị bạn đã sửa tay, và giữ các tệp tự đặt thêm. Chạy lại nhiều lần đều OK.
 */
function ensureTepTab_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(TEP_TAB);
  if (!sh) sh = ss.insertSheet(TEP_TAB);
  sh.getRange(1, 1, 1, TEP_HEADERS.length).setValues([TEP_HEADERS]);
  sh.setFrozenRows(1);

  // Đọc các dòng hiện có → tách thành "trùng tệp chuẩn" (để merge) và "tự đặt" (giữ).
  // Đọc đủ TEP_HEADERS.length cột để KHÔNG mất cột "ưu tiên" (cột 5) bạn đã nhập tay.
  var W = TEP_HEADERS.length;
  var seedKeys = {};
  TEP_SEED.forEach(function (s) { seedKeys[s[0].toLowerCase()] = true; });
  var existing = {};
  var extras = [];
  if (sh.getLastRow() >= 2) {
    var cur = sh.getRange(2, 1, sh.getLastRow() - 1, Math.max(W, sh.getLastColumn())).getValues();
    for (var i = 0; i < cur.length; i++) {
      var label = String(cur[i][0] || "").trim();
      if (!label) continue;
      var key = label.toLowerCase();
      if (seedKeys[key]) existing[key] = cur[i];
      else extras.push([label, String(cur[i][1] || ""), String(cur[i][2] || ""), String(cur[i][3] || ""), String(cur[i][4] || "")]);
    }
  }

  // Dựng lại: tệp chuẩn theo thứ tự seed (ưu tiên giá trị bạn đã nhập), rồi tệp tự đặt.
  // Cột "ưu tiên" (index 4) luôn giữ nguyên giá trị bạn đã chọn.
  var out = [];
  TEP_SEED.forEach(function (s) {
    var ex = existing[s[0].toLowerCase()];
    out.push(ex
      ? [s[0], String(ex[1] || "").trim() || s[1], String(ex[2] || "").trim() || s[2], ex[3] || "", String(ex[4] || "")]
      : [s[0], s[1], s[2], "", ""]);
  });
  out.push.apply(out, extras);

  if (sh.getLastRow() > 1) {
    sh.getRange(2, 1, sh.getLastRow() - 1, Math.max(W, sh.getLastColumn())).clearContent();
  }
  sh.getRange(2, 1, out.length, W).setValues(out);
  return sh;
}

/** Đọc tab "tệp" → [{label, emoji, link, note, priority}] cho web dựng ô dịch vụ + ưu tiên. */
function readTep_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(TEP_TAB);
  if (!sh || sh.getLastRow() < 2) return [];
  // Đọc theo HEADER để không phụ thuộc thứ tự cột (cột "ưu tiên" có thể ở vị trí khác).
  var cLabel = headerCol_(sh, "tệp") || 1;
  var cEmoji = headerCol_(sh, "emoji");
  var cLink = headerCol_(sh, "link");
  var cNote = headerCol_(sh, "ghi_chu");
  var cPrio = headerCol_(sh, "ưu tiên");
  var vals = sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues();
  var out = [];
  for (var i = 0; i < vals.length; i++) {
    var label = String(vals[i][cLabel - 1] || "").trim();
    if (!label) continue;
    out.push({
      label: label,
      emoji: cEmoji ? String(vals[i][cEmoji - 1] || "").trim() : "",
      link: cLink ? String(vals[i][cLink - 1] || "").trim() : "",
      note: cNote ? String(vals[i][cNote - 1] || "").trim() : "",
      priority: cPrio ? String(vals[i][cPrio - 1] || "").trim() : ""
    });
  }
  return out;
}

/** Tạo/đảm bảo tab "ưu tiên hiển thị" (ưu tiên | chuỗi | ghi_chu); seed nếu trống, không ghi đè dữ liệu đã nhập. */
function ensurePriorityTab_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(PRIORITY_TAB);
  if (!sh) sh = ss.insertSheet(PRIORITY_TAB);
  sh.getRange(1, 1, 1, PRIORITY_HEADERS.length).setValues([PRIORITY_HEADERS]);
  sh.setFrozenRows(1);
  if (sh.getLastRow() < 2) {
    sh.getRange(2, 1, PRIORITY_SEED.length, PRIORITY_HEADERS.length).setValues(PRIORITY_SEED);
  }
  return sh;
}

/** Đọc tab "ưu tiên hiển thị" → [{name, chains:[...], note}]; chains là store_id IN HOA theo thứ tự. */
function readPriority_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(PRIORITY_TAB);
  if (!sh || sh.getLastRow() < 2) return [];
  var cName = headerCol_(sh, "ưu tiên") || 1;
  var cChains = headerCol_(sh, "chuỗi") || 2;
  var cNote = headerCol_(sh, "ghi_chu");
  var vals = sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues();
  var out = [];
  for (var i = 0; i < vals.length; i++) {
    var name = String(vals[i][cName - 1] || "").trim();
    if (!name) continue;
    var chains = String(vals[i][cChains - 1] || "")
      .split(/[,\n;]+/)
      .map(function (s) { return s.trim().toUpperCase(); })
      .filter(function (s) { return s; });
    out.push({ name: name, chains: chains, note: cNote ? String(vals[i][cNote - 1] || "").trim() : "" });
  }
  return out;
}

/** Vị trí (1-based) của cột header `name` trong tab; 0 nếu chưa có. */
function headerCol_(sh, name) {
  if (sh.getLastColumn() < 1) return 0;
  var head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  for (var i = 0; i < head.length; i++) {
    if (String(head[i]).trim().toLowerCase() === String(name).trim().toLowerCase()) return i + 1;
  }
  return 0;
}

/**
 * ① Tạo tab "tệp" + thêm cột "tệp" Ở CUỐI tab catalog, gắn dropdown lấy từ tab "tệp".
 * An toàn: nếu cột "tệp" đã có thì không thêm lại; chèn ở CUỐI nên không lệch cột cũ.
 */
function menuSetupTep_() {
  var ui = SpreadsheetApp.getUi();
  var tepTab = ensureTepTab_();
  var cat = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("catalog");
  if (!cat) { ui.alert("Không tìm thấy tab 'catalog'."); return; }

  var col = headerCol_(cat, TEP_COL);
  if (col === 0) {
    col = cat.getLastColumn() + 1; // thêm Ở CUỐI để không lệch cột
    cat.getRange(1, col).setValue(TEP_COL);
  }
  cat.setFrozenRows(1);

  // Dropdown: giá trị phải nằm trong danh sách tệp (cột A của tab "tệp").
  var lastRow = Math.max(cat.getLastRow(), 2);
  var rule = SpreadsheetApp.newDataValidation()
    .requireValueInRange(tepTab.getRange("A2:A"), true)
    .setAllowInvalid(true)
    .build();
  cat.getRange(2, col, lastRow - 1, 1).setDataValidation(rule);

  ui.alert(
    "Đã xong:\n" +
    "• Tab '" + TEP_TAB + "' (tệp | emoji | link | ghi_chu). Thêm dòng = có tệp mới.\n" +
    "   - link trống → ô LỌC sản phẩm theo tệp.\n" +
    "   - link là URL → ô mở trang dịch vụ ngoài. link = 'soon' → ô sắp ra mắt.\n" +
    "• Cột '" + TEP_COL + "' ở cuối tab catalog, có dropdown chọn tệp.\n\n" +
    "Bước tiếp: bấm '② Tự gán tệp cho sản phẩm (gợi ý)' để điền nhanh."
  );
}

/**
 * ③ Tạo tab "ưu tiên hiển thị" + thêm cột "ưu tiên" Ở CUỐI tab "tệp", gắn dropdown lấy
 * tên hồ sơ từ tab "ưu tiên hiển thị". An toàn: cột đã có thì không thêm lại; chèn ở CUỐI.
 */
function menuSetupPriority_() {
  var ui = SpreadsheetApp.getUi();
  var prioTab = ensurePriorityTab_();
  var tep = ensureTepTab_(); // đảm bảo tab "tệp" + đã có header "ưu tiên"

  var col = headerCol_(tep, "ưu tiên");
  if (col === 0) {
    col = tep.getLastColumn() + 1; // thêm Ở CUỐI để không lệch cột
    tep.getRange(1, col).setValue("ưu tiên");
  }
  tep.setFrozenRows(1);

  // Dropdown: giá trị phải nằm trong danh sách tên hồ sơ (cột A của tab "ưu tiên hiển thị").
  var lastRow = Math.max(tep.getLastRow(), 2);
  var rule = SpreadsheetApp.newDataValidation()
    .requireValueInRange(prioTab.getRange("A2:A"), true)
    .setAllowInvalid(true)
    .build();
  tep.getRange(2, col, lastRow - 1, 1).setDataValidation(rule);

  ui.alert(
    "Đã xong:\n" +
    "• Tab '" + PRIORITY_TAB + "' (ưu tiên | chuỗi | ghi_chu).\n" +
    "   - Mỗi dòng = 1 hồ sơ ưu tiên. Cột 'chuỗi' = store_id theo thứ tự, vd 'THXL, TDAT'.\n" +
    "• Cột 'ưu tiên' ở cuối tab '" + TEP_TAB + "', có dropdown chọn hồ sơ.\n\n" +
    "Tệp nào chọn hồ sơ → sản phẩm thuộc chuỗi đó hiện trước (THXL trước TDAT…).\n" +
    "Tệp để trống cột 'ưu tiên' → hiển thị bình thường.\n" +
    "Hồ sơ tên 'Mặc định' áp cho trang chủ (khi không lọc tệp)."
  );
}

/** Suy luận tệp từ category + tên + thương hiệu (port từ web categoryGroup). */
function classifyTep_(category, name, brand) {
  var s = (String(category || "") + " " + String(name || "") + " " + String(brand || ""))
    .normalize("NFC").toLowerCase();
  var R = [
    ["Mẹ & bé", /\bbé\b|\bmẹ\b|bỉm|bĩm|\btã\b|dinh dưỡng cho mẹ/],
    ["Trang sức", /trang sức|bông tai|hoa tai|dây chuyền|mặt dây|\bnhẫn\b|lắc tay|vòng tay|vòng cổ|kim cương|ngọc trai|\bcharm\b|\bpnj\b|đồng vàng|vàng trắng|vàng 75|vàng 58|nữ trang/],
    ["Nhà cửa & vệ sinh", /nhà cửa|nhà bếp|giặt|hóa phẩm|đồ dùng gia đình|giấy vệ sinh|khăn giấy|chăm sóc gia đình|chăm sóc nhà|đời sống|lau sàn|lau nhà|rửa chén|rửa bát|nước rửa|nước tẩy|tẩy rửa|lau kính|xịt phòng|alo clean/],
    ["Chăm sóc cá nhân", /chăm sóc (da|tóc|cơ thể|cá nhân|sức khỏe|bé)|tắm gội|gel gội|gel tắm|gội đầu|dầu gội|dưỡng tóc|sữa tắm|sữa rửa mặt|sắc đẹp|sức khỏe|trang điểm|mỹ phẩm|nước hoa|vitamin|vatamin|răng miệng|kem đánh răng|dầu xả|làm đẹp|son môi|kem dưỡng|kem chống nắng|toner|serum|tẩy trang|xà bông|xà phòng|mencode|keyone men|beauty republic/],
    ["Đồ uống", /bia|rượu|nước giải khát|nước uống|đồ uống|thức uống|\btrà\b|trà xanh|cà phê|nước ngọt|coca|pepsi|7 ?up|nước suối|nước chanh|nước ép|nước dừa|soda|sinh tố|trà sữa|nước cam/],
    ["Sữa", /\bsữa\b|sữa tươi|sữa đặc|sữa chua/],
    ["Thực phẩm", /thịt|cá|trứng|hải sản|rau|củ|quả|nấm|trái cây|gạo|bột|đồ khô|mì|miến|cháo|phở|nui|bún|dầu ăn|nước chấm|gia vị|mắm|tương|sốt|đồ hộp|đóng hộp|thực phẩm|bánh|kẹo|snack|kem|ngũ cốc|lạp xưởng|xúc xích|hạt|sấy|mứt|thạch|rong biển|thức ăn|đồ ăn|nếp|đậu|bách hóa|cơm|teppan|hầm|nướng|chiên|đường|hạt nêm|bột ngọt|hủ tiếu|hủ tíu|xào|lẩu|canh|súp|gỏi|chè|bò|gà|heo|tôm|mực|salad|pizza|burger|sandwich|nem|chả|giò|long monaco/]
  ];
  for (var i = 0; i < R.length; i++) if (R[i][1].test(s)) return R[i][0];
  return "Khác";
}

/** ② Điền tệp gợi ý cho các dòng còn TRỐNG ở cột "tệp" (không ghi đè ô đã có). */
function menuAutoFillTep_() {
  var ui = SpreadsheetApp.getUi();
  var cat = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("catalog");
  if (!cat) { ui.alert("Không tìm thấy tab 'catalog'."); return; }
  var tepCol = headerCol_(cat, TEP_COL);
  if (tepCol === 0) { ui.alert("Chưa có cột '" + TEP_COL + "'. Bấm '① Tạo tab Tệp…' trước."); return; }

  var catCol = headerCol_(cat, "category");
  var nameCol = headerCol_(cat, "product_name");
  var brandCol = headerCol_(cat, "brand");
  var lastRow = cat.getLastRow();
  if (lastRow < 2) { ui.alert("Tab catalog chưa có dữ liệu."); return; }

  var data = cat.getRange(2, 1, lastRow - 1, cat.getLastColumn()).getValues();
  var out = [];
  var filled = 0;
  for (var r = 0; r < data.length; r++) {
    var cur = String(data[r][tepCol - 1] || "").trim();
    if (cur) { out.push([cur]); continue; }
    var g = classifyTep_(
      catCol ? data[r][catCol - 1] : "",
      nameCol ? data[r][nameCol - 1] : "",
      brandCol ? data[r][brandCol - 1] : ""
    );
    out.push([g]);
    filled++;
  }
  cat.getRange(2, tepCol, out.length, 1).setValues(out);
  ui.alert("Đã gán tệp cho " + filled + " dòng còn trống (giữ nguyên ô đã nhập tay).");
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
  if (action === "save_buyer") {
    return json_(saveBuyer_(body.record || {}));
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

  // Cột tồn kho "dễ tính": ngoài "in_stock" còn nhận các tên hay gặp khi nhập tay.
  var stockIdx = col.in_stock;
  if (stockIdx === -1) {
    var STOCK_ALIASES = [
      "stock", "in stock", "instock", "ton_kho", "tonkho", "ton kho", "ton",
      "con_hang", "con hang", "conhang", "còn hàng", "tinh_trang", "tinh trang",
      "tình trạng", "status", "available", "con"
    ];
    for (var a = 0; a < STOCK_ALIASES.length; a++) {
      var ai = head.indexOf(STOCK_ALIASES[a]);
      if (ai !== -1) { stockIdx = ai; break; }
    }
  }

  // Cột "tệp"/nhóm danh mục (tuỳ chọn, thường ở CUỐI bảng): ngoài "danh_muc"
  // còn nhận vài tên hay gặp khi nhập tay. Không có → để trống, web tự suy luận.
  var groupIdx = head.indexOf("danh_muc");
  if (groupIdx === -1) {
    var GROUP_ALIASES = [
      "tệp", "tep", "nhom", "nhóm", "nhom_dm", "nhom_danh_muc",
      "danh muc", "danhmuc", "danh_muc_sp", "group", "tep_sp"
    ];
    for (var gi = 0; gi < GROUP_ALIASES.length; gi++) {
      var gx = head.indexOf(GROUP_ALIASES[gi]);
      if (gx !== -1) { groupIdx = gx; break; }
    }
  }

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
        group: groupIdx === -1 ? "" : String(r[groupIdx] || "").trim(),
        unit: String(r[col.unit] || "").trim(),
        image: String(r[col.image] || "").trim()
      };
    }
    // Không có cột tồn kho → mặc định còn hàng. Có cột → coi là HẾT khi giá trị
    // nằm trong danh sách "hết" (kể cả rỗng); còn lại (TRUE/1/còn/yes...) = còn hàng.
    var stock = stockIdx === -1 ? null : String(r[stockIdx]).trim().toLowerCase();
    var OUT_OF_STOCK = ["0", "false", "f", "het", "hết", "het hang", "hết hàng",
      "no", "n", "out", "khong", "không", "khong con", "không còn", "unavailable", ""];
    offers.push({
      productId: pid,
      storeId: sid,
      price: Number(String(r[col.price]).replace(/[^\d.]/g, "")) || 0,
      inStock: stock === null ? true : OUT_OF_STOCK.indexOf(stock) === -1,
      productUrl: String(r[col.product_url] || "").trim(),
      lastChecked: String(r[col.last_checked] || "").trim()
    });
  }
  var products = Object.keys(productMap).map(function (k) { return productMap[k]; });
  return { products: products, offers: offers, groups: readTep_(), priorities: readPriority_() };
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
    // Toạ độ: lưu dạng TEXT (dấu ') để Sheet locale VN không hiểu dấu chấm là
    // ngăn cách nghìn (106.6938 → "1.066.938"). Giữ nguyên giá trị gốc.
    rec.buyerLat != null && rec.buyerLat !== "" ? ("'" + String(rec.buyerLat)) : "",
    rec.buyerLng != null && rec.buyerLng !== "" ? ("'" + String(rec.buyerLng)) : "",
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

/**
 * Lưu hồ sơ người mua — UPSERT theo SĐT (1 SĐT 1 dòng, sửa nhiều lần không đẻ dòng).
 * rec = { phone, name, address }
 */
function saveBuyer_(rec) {
  var phone = rec.phone ? String(rec.phone).trim() : "";
  if (!phone) return { ok: false, error: "missing phone" };

  var sh = ensureSheet_("buyers", BUYER_HEADERS);
  var data = sh.getDataRange().getValues();
  var now = new Date().toISOString();
  // Cột 1 = phone (lưu kèm dấu ' để Sheet không cắt số 0 đầu).
  for (var i = 1; i < data.length; i++) {
    var cell = String(data[i][0] || "").replace(/^'/, "").trim();
    if (cell === phone) {
      sh.getRange(i + 1, 1, 1, BUYER_HEADERS.length).setValues([[
        "'" + phone,
        rec.name || data[i][1] || "",
        rec.address || data[i][2] || "",
        data[i][3] || now,
        now
      ]]);
      return { ok: true, mode: "update" };
    }
  }
  sh.appendRow(["'" + phone, rec.name || "", rec.address || "", now, now]);
  return { ok: true, mode: "create" };
}

/**
 * Ghi đè toàn bộ catalog. rows = mảng object theo CATALOG_HEADERS.
 * An toàn với cột phụ (vd "tệp" ở cuối): ghi theo ĐÚNG bề rộng thực tế của sheet,
 * map giá trị theo TÊN cột header, cột phụ để trống.
 */
function setCatalog_(rows) {
  var sh = ensureSheet_("catalog", CATALOG_HEADERS);
  var W = Math.max(CATALOG_HEADERS.length, sh.getLastColumn());
  var head = sh.getRange(1, 1, 1, W).getValues()[0].map(function (h) { return String(h).trim().toLowerCase(); });
  var col = {};
  CATALOG_HEADERS.forEach(function (h) { var i = head.indexOf(h); col[h] = i >= 0 ? i : CATALOG_HEADERS.indexOf(h); });
  if (sh.getLastRow() > 1) {
    sh.getRange(2, 1, sh.getLastRow() - 1, W).clearContent();
  }
  if (!rows.length) return { ok: true, written: 0 };
  var matrix = rows.map(function (row) {
    var a = new Array(W); for (var i = 0; i < W; i++) a[i] = "";
    CATALOG_HEADERS.forEach(function (h) { a[col[h]] = row[h] != null ? row[h] : ""; });
    return a;
  });
  sh.getRange(2, 1, matrix.length, W).setValues(matrix);
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
  // Bề rộng thực tế (gồm cột phụ như "tệp" ở cuối) — KHÔNG hardcode 12 cột.
  var W = Math.max(CATALOG_HEADERS.length, sh.getLastColumn());
  var head = data.length
    ? data[0].map(function (h) { return String(h).trim().toLowerCase(); })
    : CATALOG_HEADERS.slice();
  var col = {};
  CATALOG_HEADERS.forEach(function (h) {
    var i = head.indexOf(h);
    col[h] = i >= 0 ? i : CATALOG_HEADERS.indexOf(h);
  });

  // Chuẩn hoá mọi dòng cũ về đúng W cột (giữ nguyên giá trị cột phụ như "tệp").
  var body = data.slice(1).map(function (r) {
    var a = r.slice(0, W); while (a.length < W) a.push(""); return a;
  });
  var index = {};
  body.forEach(function (r, i) {
    var pid = String(r[col.product_id] || "").trim();
    var sid = String(r[col.store_id] || "").trim();
    if (pid && sid) index[pid + "|" + sid] = i;
  });

  var updated = 0, created = 0;
  rows.forEach(function (row) {
    var key = String(row.product_id) + "|" + String(row.store_id);
    if (index.hasOwnProperty(key)) {
      // Cập nhật: chỉ ghi đè các cột catalog, GIỮ NGUYÊN cột phụ (tệp) của dòng đó.
      var a = body[index[key]];
      CATALOG_HEADERS.forEach(function (h) { a[col[h]] = row[h] != null ? row[h] : ""; });
      updated++;
    } else {
      var b = new Array(W); for (var i = 0; i < W; i++) b[i] = "";
      CATALOG_HEADERS.forEach(function (h) { b[col[h]] = row[h] != null ? row[h] : ""; });
      index[key] = body.length;
      body.push(b);
      created++;
    }
  });

  if (sh.getLastRow() > 1) {
    sh.getRange(2, 1, sh.getLastRow() - 1, W).clearContent();
  }
  if (body.length) {
    sh.getRange(2, 1, body.length, W).setValues(body);
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

/**
 * Fill 2 cột "gia_niem_yet" + "%_khuyen_mai" trong tab "Danh sách sản phẩm" (gid 1049432260)
 * dựa vào master sheet (sheet ID 1akbwYjARnr2imdlFvPi6o12ktlj-0KXQfoDeroTpq1c, gid 169511719).
 * Match theo cột A (product_id ↔ SKU). Chạy 1 lần qua menu "Giá Quanh Đây → Điền giá niêm yết + KM".
 */
function menuFillNiemYetKM_() {
  var SOURCE_SHEET_ID = "1akbwYjARnr2imdlFvPi6o12ktlj-0KXQfoDeroTpq1c";
  var SOURCE_GID = 169511719;
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ui = SpreadsheetApp.getUi();

  // Tab đích = "Danh sách sản phẩm" (tab đang nhập liệu giá; nếu sheet ko có tên này, dùng tab active).
  var tgt = ss.getSheetByName("Danh sách sản phẩm") || ss.getActiveSheet();
  if (!tgt) { ui.alert("Không tìm thấy tab đích"); return; }

  // Mở source sheet & tìm tab theo gid.
  var src;
  try {
    src = SpreadsheetApp.openById(SOURCE_SHEET_ID);
  } catch (e) {
    ui.alert("Không mở được source sheet. Cần quyền View. ID: " + SOURCE_SHEET_ID);
    return;
  }
  var srcSheet = null;
  src.getSheets().forEach(function (s) { if (s.getSheetId() === SOURCE_GID) srcSheet = s; });
  if (!srcSheet) { ui.alert("Không tìm thấy tab gid=" + SOURCE_GID + " trong source"); return; }

  // Đọc source: cột A = SKU, cột I (9) = GIA_BAO_BI_VAT, cột K (11) = %_KHUYEN_MAI.
  // DÙNG getDisplayValues() để lấy đúng text hiển thị (vd "127,440") — getValues() trả về
  // raw number bị diễn dịch sai locale (127.44 → ghi qua target ra 12 nghìn tỷ).
  var srcLast = srcSheet.getLastRow();
  if (srcLast < 2) { ui.alert("Source rỗng"); return; }
  var srcText = srcSheet.getRange(2, 1, srcLast - 1, 11).getDisplayValues();
  var map = {};
  srcText.forEach(function (r) {
    var sku = String(r[0] || "").trim();
    if (!sku) return;
    var gia = String(r[8] || "").trim();   // cột 9 (index 8) — GIA_BAO_BI_VAT
    var km = String(r[10] || "").trim();   // cột 11 (index 10) — %_KHUYEN_MAI
    // gia displayed dạng "127,440" — chuyển sang số nguyên VND (bỏ , và .).
    var giaDigits = gia.replace(/[^\d]/g, "");
    var giaNum = giaDigits ? Number(giaDigits) : "";
    // km displayed dạng "7%" hoặc "0,07" — bóc thành số nguyên 0..100.
    var kmRaw = km.replace("%", "").replace(",", ".").trim();
    var kmNum = "";
    if (kmRaw) {
      var n = parseFloat(kmRaw);
      if (isFinite(n)) kmNum = n <= 1 ? Math.round(n * 100) : Math.round(n);
    }
    map[sku] = { gia: giaNum, km: kmNum };
  });

  // Tìm cột đích trong tab đích.
  var head = tgt.getRange(1, 1, 1, tgt.getLastColumn()).getValues()[0];
  function findCol(names) {
    for (var i = 0; i < head.length; i++) {
      var h = String(head[i] || "").toLowerCase().trim();
      for (var j = 0; j < names.length; j++) if (h === names[j]) return i + 1;
    }
    return -1;
  }
  var pidCol = findCol(["product_id", "sku", "mã sản phẩm"]);
  var giaCol = findCol(["gia_niem_yet", "giá niêm yết", "gia niem yet", "gia_bao_bi", "gia_bao_bi_vat", "gia bao bi", "giá bao bì", "gia bao bi (+vat) (gia_bao_bi_vat)"]);
  var kmCol = findCol(["%_khuyen_mai", "%_khuyenmai", "% khuyến mãi", "% khuyen mai", "khuyen_mai", "khuyến mãi", "khuyenmai"]);
  var priceCol = findCol(["price", "gia", "giá", "giá bán"]);
  if (pidCol < 0 || giaCol < 0 || kmCol < 0) {
    ui.alert("Thiếu cột. Cần: product_id, gia_niem_yet, %_khuyen_mai. Đang có: " + head.join(" | "));
    return;
  }

  var tgtLast = tgt.getLastRow();
  if (tgtLast < 2) { ui.alert("Tab đích rỗng"); return; }
  var pids = tgt.getRange(2, pidCol, tgtLast - 1, 1).getValues();
  var giaCur = tgt.getRange(2, giaCol, tgtLast - 1, 1).getValues();
  var kmCur = tgt.getRange(2, kmCol, tgtLast - 1, 1).getValues();
  // Lấy price dạng text (display) để fallback giá niêm yết = price khi SKU không có trong master.
  var priceText = priceCol > 0 ? tgt.getRange(2, priceCol, tgtLast - 1, 1).getDisplayValues() : null;
  var filledFromMaster = 0, filledFallback = 0;
  for (var i = 0; i < pids.length; i++) {
    var pid = String(pids[i][0] || "").trim();
    if (!pid) continue;
    var m = map[pid];
    if (m) {
      giaCur[i][0] = m.gia;
      kmCur[i][0] = m.km;
      filledFromMaster++;
    } else if (priceText) {
      // Không có trong master → fallback: gia_niem_yet = price, % KM = 0.
      var pTxt = String(priceText[i][0] || "").trim();
      var pDigits = pTxt.replace(/[^\d]/g, "");
      if (pDigits) {
        giaCur[i][0] = Number(pDigits);
        kmCur[i][0] = 0;
        filledFallback++;
      }
    }
  }
  tgt.getRange(2, giaCol, tgtLast - 1, 1).setValues(giaCur);
  tgt.getRange(2, kmCol, tgtLast - 1, 1).setValues(kmCur);
  ui.alert("Xong!\n• Từ master: " + filledFromMaster + " dòng\n• Fallback (= price, KM=0): " + filledFallback + " dòng\n• Tổng: " + (tgtLast - 1) + " dòng");
}
