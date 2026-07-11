import { NextResponse } from "next/server";
import { DEFAULT_WIDGET, buildWidget } from "@/lib/khuccham-widget";

/**
 * GET /api/khuccham-widget → { widget } đọc từ Google Sheet:
 *   - workbook "cài đặt" (SHEET_ID): tab "KhucChamCaiDat" (key/value) + "KhucChamPill" (list pill)
 *   - workbook RIÊNG cho LOGO (LOGO_SHEET_ID): 1 ô chứa URL ảnh logo Khúc Chạm.
 *     → logo ở sheet riêng này (nếu có) ĐÈ logo trong KhucChamCaiDat. Sửa sheet là app đổi theo.
 * Lỗi/tab trống → fallback DEFAULT_WIDGET.
 *
 * ⚠️ Sheet + file ảnh Drive PHẢI chia sẻ "Bất kỳ ai có đường liên kết"; nếu riêng tư,
 * link CSV/ảnh trả về trang HTML đăng nhập → app không đọc được.
 */
const SHEET_ID =
  process.env.KHUCCHAM_SHEET_ID || "1sZTv7FHGEq6V_d8wiFKd-7cVFjpURUcAeDPVI_1WiJo";
// Sheet riêng "Khúc chạm" cấu hình logo (A: nhãn, B: URL ảnh). gid=0.
const LOGO_SHEET_ID =
  process.env.KHUCCHAM_LOGO_SHEET_ID || "1iHJnjq01xB62vRk0Ery199mLBuYsGCS-vjkdQDB_CCQ";
const csvUrl = (tab: string) =>
  `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(tab)}`;
const logoCsvUrl = `https://docs.google.com/spreadsheets/d/${LOGO_SHEET_ID}/export?format=csv&gid=0`;

/** Chuẩn hoá link Google Drive file/view → URL ảnh trực tiếp lh3.googleusercontent.com/d/<id>. */
function normDrive(u: string): string {
  if (/drive\.google\.com\/(drive\/|.*\/folders\/)/.test(u)) return "";
  const mFile = u.match(/drive\.google\.com\/file\/d\/([^/?#]+)/);
  if (mFile) return `https://lh3.googleusercontent.com/d/${mFile[1]}`;
  const mId = u.match(/drive\.google\.com\/[^?]*\?[^#]*\bid=([^&#]+)/);
  if (mId) return `https://lh3.googleusercontent.com/d/${mId[1]}`;
  return u;
}

/** Lấy URL logo đầu tiên tìm thấy trong CSV sheet logo (ô nào là http/https hoặc Drive). */
function extractLogoUrl(csv: string): string {
  if (!csv || /^\s*<!doctype html/i.test(csv)) return ""; // sheet riêng tư → trang HTML, bỏ
  const m = csv.match(/https?:\/\/[^\s",]+/);
  return m ? normDrive(m[0]) : "";
}

export async function GET() {
  try {
    const [s, p, l] = await Promise.all([
      fetch(csvUrl("KhucChamCaiDat"), { next: { revalidate: 30 } }),
      fetch(csvUrl("KhucChamPill"), { next: { revalidate: 30 } }),
      fetch(logoCsvUrl, { next: { revalidate: 30 } }),
    ]);
    const settingsCsv = s.ok ? await s.text() : "";
    const pillsCsv = p.ok ? await p.text() : "";
    const logoOverride = l.ok ? extractLogoUrl(await l.text()) : "";

    const widget = buildWidget(settingsCsv, pillsCsv);
    if (logoOverride) widget.logo = logoOverride; // sheet logo riêng ĐÈ mọi nguồn khác

    return NextResponse.json({ widget }, { headers: { "Cache-Control": "public, max-age=0, s-maxage=60, stale-while-revalidate=3600" } });
  } catch {
    return NextResponse.json({ widget: DEFAULT_WIDGET }, { headers: { "Cache-Control": "public, max-age=0, s-maxage=15, stale-while-revalidate=60" } });
  }
}
