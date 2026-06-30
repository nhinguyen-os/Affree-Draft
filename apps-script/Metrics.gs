/**
 * ============================================================================
 *  BỘ ĐẾM THỐNG KÊ TRANG (Affree) — file BỔ SUNG cho Apps Script Web App.
 * ============================================================================
 *
 *  CÁCH GẮN (2 bước, KHÔNG đụng/đè code cũ — tránh sập catalog/đơn/buyer):
 *
 *  BƯỚC 1 — Thêm file này:
 *    Apps Script → bên trái bấm "+" cạnh "Files" → Script → đặt tên "Metrics"
 *    → dán TOÀN BỘ nội dung file này vào → lưu (Ctrl/Cmd + S).
 *
 *  BƯỚC 2 — Mở file có sẵn hàm doPost(e), thêm 2 DÒNG NÀY vào NGAY DÒNG ĐẦU
 *           bên trong doPost (trước mọi xử lý khác):
 *
 *        var __b = JSON.parse(e.postData.contents || "{}");
 *        if (__b.action === "metric_incr" || __b.action === "metrics_get") return handleMetrics_(__b.action, __b.event);
 *
 *  BƯỚC 3 — Deploy → Manage deployments → ✏️ (Edit) → Version: New version → Deploy.
 *           (Giữ NGUYÊN URL /exec — không tạo deployment mới để khỏi đổi URL.)
 *
 *  Xong: web tự đếm Lượt truy cập / Đơn đã tạo / Lượt thêm giỏ (sheet "Metrics").
 * ============================================================================
 */

function handleMetrics_(action, event) {
  var lock = LockService.getScriptLock();
  try { lock.tryLock(5000); } catch (e) {}

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName("Metrics");
  if (!sh) {
    sh = ss.insertSheet("Metrics");
    sh.getRange("A1:B1").setValues([["key", "value"]]);
    sh.getRange("A2:A7").setValues([["visits"], ["orders"], ["carts"], ["products"], ["stores"], ["brands"]]);
    sh.getRange("B2:B7").setValues([[0], [0], [0], [0], [0], [0]]);
  } else {
    // Đảm bảo 3 row mới tồn tại nếu sheet cũ chỉ có 3 dòng.
    if (!sh.getRange(5, 1).getValue()) {
      sh.getRange("A5:A7").setValues([["products"], ["stores"], ["brands"]]);
      sh.getRange("B5:B7").setValues([[0], [0], [0]]);
    }
  }

  var row = { visit: 2, order: 3, cart: 4 };
  if (action === "metric_incr" && row[event]) {
    var c = sh.getRange(row[event], 2);
    c.setValue((Number(c.getValue()) || 0) + 1);
  }

  // Snapshot: cập nhật số sản phẩm / điểm bán / nhãn hiệu từ catalog.
  if (action === "metrics_snapshot") {
    if (event && event.products !== undefined) sh.getRange(5, 2).setValue(Number(event.products) || 0);
    if (event && event.stores !== undefined)   sh.getRange(6, 2).setValue(Number(event.stores)   || 0);
    if (event && event.brands !== undefined)   sh.getRange(7, 2).setValue(Number(event.brands)   || 0);
  }

  var totals = {
    visits:   Number(sh.getRange(2, 2).getValue()) || 0,
    orders:   Number(sh.getRange(3, 2).getValue()) || 0,
    carts:    Number(sh.getRange(4, 2).getValue()) || 0,
    products: Number(sh.getRange(5, 2).getValue()) || 0,
    stores:   Number(sh.getRange(6, 2).getValue()) || 0,
    brands:   Number(sh.getRange(7, 2).getValue()) || 0,
  };

  try { lock.releaseLock(); } catch (e) {}

  return ContentService
    .createTextOutput(JSON.stringify({ totals: totals }))
    .setMimeType(ContentService.MimeType.JSON);
}
