import { NextResponse } from "next/server";
import { APP_VERSION, VERSION_HISTORY, ROADMAP } from "@/lib/version";
import { fetchSheetVersion } from "@/lib/sheet-version";

// Nội dung popup "i Version" đọc từ Google Sheet (workbook "i Version") mỗi request,
// fallback về hằng số tĩnh trong lib/version.ts khi sheet lỗi/hụt. Response gọn (<50KB)
// nên cache CDN thoải mái.
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  // Nhận diện bản build đang chạy (debug "deploy đã lên chưa") — Vercel gắn sẵn các env này.
  const build = {
    commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || "local",
    branch: process.env.VERCEL_GIT_COMMIT_REF || "",
    commitMessage: (process.env.VERCEL_GIT_COMMIT_MESSAGE || "").split("\n")[0],
  };
  try {
    const data = await fetchSheetVersion(60);
    if (data) {
      return NextResponse.json(
        { source: "sheet", build, ...data },
        { headers: { "Cache-Control": "public, max-age=0, s-maxage=300, stale-while-revalidate=86400" } },
      );
    }
  } catch {
    /* rơi xuống fallback tĩnh */
  }
  return NextResponse.json(
    { source: "static", build, appVersion: APP_VERSION, history: VERSION_HISTORY, roadmap: ROADMAP },
    { headers: { "Cache-Control": "public, max-age=0, s-maxage=30, stale-while-revalidate=300" } },
  );
}
