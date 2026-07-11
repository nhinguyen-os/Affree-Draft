import { NextResponse } from "next/server";
import { APP_VERSION, VERSION_HISTORY, ROADMAP } from "@/lib/version";
import { fetchSheetVersion } from "@/lib/sheet-version";

// Nội dung popup "i Version" đọc từ Google Sheet (workbook "i Version") mỗi request,
// fallback về hằng số tĩnh trong lib/version.ts khi sheet lỗi/hụt. Response gọn (<50KB)
// nên cache CDN thoải mái.
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    const data = await fetchSheetVersion(60);
    if (data) {
      return NextResponse.json(
        { source: "sheet", ...data },
        { headers: { "Cache-Control": "public, max-age=0, s-maxage=300, stale-while-revalidate=86400" } },
      );
    }
  } catch {
    /* rơi xuống fallback tĩnh */
  }
  return NextResponse.json(
    { source: "static", appVersion: APP_VERSION, history: VERSION_HISTORY, roadmap: ROADMAP },
    { headers: { "Cache-Control": "public, max-age=0, s-maxage=30, stale-while-revalidate=300" } },
  );
}
