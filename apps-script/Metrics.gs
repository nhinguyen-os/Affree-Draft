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
    sh.getRange("A2:A4").setValues([["visits"], ["orders"], ["carts"]]);
    sh.getRange("B2:B4").setValues([[0], [0], [0]]);
  }

  var row = { visit: 2, order: 3, cart: 4 };
  if (action === "metric_incr" && row[event]) {
    var c = sh.getRange(row[event], 2);
    c.setValue((Number(c.getValue()) || 0) + 1);
  }

  var totals = {
    visits: Number(sh.getRange(2, 2).getValue()) || 0,
    orders: Number(sh.getRange(3, 2).getValue()) || 0,
    carts: Number(sh.getRange(4, 2).getValue()) || 0,
  };

  try { lock.releaseLock(); } catch (e) {}

  return ContentService
    .createTextOutput(JSON.stringify({ totals: totals }))
    .setMimeType(ContentService.MimeType.JSON);
}
