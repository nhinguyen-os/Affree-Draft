import { NextResponse } from "next/server";
import { DEFAULT_WIDGET, buildWidget } from "@/lib/khuccham-widget";

/**
 * GET /api/khuccham-widget → { widget } đọc 2 tab Google Sheet (cùng sheet với tab nhạc):
 *   - "KhucChamCaiDat": cài đặt chung (key/value)
 *   - "KhucChamPill":   danh sách pill
 * Lỗi/tab trống → fallback DEFAULT_WIDGET.
 */
const SHEET_ID =
  process.env.KHUCCHAM_SHEET_ID || "1sZTv7FHGEq6V_d8wiFKd-7cVFjpURUcAeDPVI_1WiJo";
const csvUrl = (tab: string) =>
  `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(tab)}`;

export async function GET() {
  try {
    const [s, p] = await Promise.all([
      fetch(csvUrl("KhucChamCaiDat"), { next: { revalidate: 30 } }),
      fetch(csvUrl("KhucChamPill"), { next: { revalidate: 30 } }),
    ]);
    const settingsCsv = s.ok ? await s.text() : "";
    const pillsCsv = p.ok ? await p.text() : "";
    return NextResponse.json({ widget: buildWidget(settingsCsv, pillsCsv) });
  } catch {
    return NextResponse.json({ widget: DEFAULT_WIDGET });
  }
}
