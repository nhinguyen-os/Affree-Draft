/**
 * i Version — tiện ích quản lý cột STT cho tab "versions" của workbook "i Version".
 *
 * CÁCH DÙNG:
 *  1. Mở workbook "i Version" → menu "Tiện ích mở rộng" → "Apps Script".
 *  2. Xoá code mẫu, DÁN toàn bộ file này vào → bấm Lưu (biểu tượng đĩa).
 *  3. Quay lại sheet, tải lại trang → xuất hiện menu "i Version" trên thanh menu.
 *  4. Bấm "i Version" → "Đánh lại STT (theo từng bản)".
 *     → Tự tạo cột `stt` (nếu chưa có) và điền số 1,2,3… cho từng gạch đầu dòng,
 *        đánh lại từ 1 trong MỖI sub_version (đúng như số hiển thị trên app).
 *  5. Muốn đổi thứ tự 1 dòng: sửa số trong cột `stt` (app sắp tăng dần theo số này).
 *     Dòng để trống STT sẽ bị đẩy xuống cuối bản đó.
 *
 * Lưu ý: app đọc cột theo TÊN header ("stt") nên đặt ở cột nào cũng được.
 */

var VERSIONS_SHEET = 'versions';

/** Tạo menu "i Version" mỗi khi mở bảng tính. */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('i Version')
    .addItem('Đánh lại STT (theo từng bản)', 'renumberSTT')
    .addToUi();
}

/** Tạo cột `stt` nếu thiếu và đánh số 1..N trong từng nhóm sub_version (theo thứ tự dòng hiện tại). */
function renumberSTT() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(VERSIONS_SHEET);
  if (!sh) { SpreadsheetApp.getUi().alert('Không thấy tab "' + VERSIONS_SHEET + '".'); return; }

  var values = sh.getDataRange().getValues();
  if (values.length < 2) return;

  // Dò cột theo tên header (không phụ thuộc thứ tự cột).
  var header = values[0].map(function (h) { return String(h).trim().toLowerCase(); });
  function col(keys) {
    for (var i = 0; i < header.length; i++) {
      for (var k = 0; k < keys.length; k++) if (header[i].indexOf(keys[k]) >= 0) return i;
    }
    return -1;
  }
  var cSub = col(['sub_version', 'sub']);
  var cHl = col(['highlight', 'nội dung', 'noi dung']);
  if (cSub < 0 || cHl < 0) { SpreadsheetApp.getUi().alert('Thiếu cột sub_version hoặc highlight.'); return; }

  // Đảm bảo có cột stt — chưa có thì thêm ở cột cuối cùng.
  var cStt = col(['stt', 'thứ tự', 'thu tu', 'order']);
  if (cStt < 0) {
    cStt = header.length;
    sh.getRange(1, cStt + 1).setValue('stt');
  }

  // Đánh số 1..N trong TỪNG sub_version, theo thứ tự dòng hiện tại.
  var counter = {};
  var out = [];
  for (var i = 1; i < values.length; i++) {
    var sub = String(values[i][cSub]).trim();
    var hl = String(values[i][cHl]).trim();
    if (!sub || !hl) { out.push(['']); continue; }
    counter[sub] = (counter[sub] || 0) + 1;
    out.push([counter[sub]]);
  }
  sh.getRange(2, cStt + 1, out.length, 1).setValues(out);
  ss.toast('Đã tạo/đánh lại cột STT theo từng bản.', 'i Version', 5);
}
