import { NextResponse } from "next/server";
import { PURCHASE_WEBHOOK_URL, ALLOW_SHEET_WRITE } from "@/lib/config";

/**
 * Ghi nhận "đã quan tâm Zalo OA" (giả lập — zalo_id mô phỏng, xem lib/oa.ts).
 * Cùng pattern add_alert/add_purchase:
 *  - Có PURCHASE_WEBHOOK_URL (Apps Script /exec) → POST action add_oa_follower →
 *    ghi vào tab "oa_followers" của Google Sheet (cần thêm case trong Code.gs, redeploy).
 *  - Chưa cấu hình → trả ok để client vẫn giữ danh sách ở localStorage.
 *
 * Cột sheet oa_followers: zalo_id | name | phone | source | ts
 */
type OaFollower = { zalo_id?: string; name?: string; phone?: string; source?: string; ts?: string };

export async function POST(req: Request) {
  let record: OaFollower;
  try {
    record = (await req.json()) as OaFollower;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }
  if (!record?.zalo_id) {
    return NextResponse.json({ ok: false, error: "missing zalo_id" }, { status: 400 });
  }

  const webhook = PURCHASE_WEBHOOK_URL;
  if (!webhook) return NextResponse.json({ ok: true, persisted: "client-only" });
  if (!ALLOW_SHEET_WRITE) return NextResponse.json({ ok: true, persisted: "skipped-non-prod" });

  try {
    const res = await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "add_oa_follower", record }),
    });
    const text = await res.text();
    return NextResponse.json({ ok: res.ok, persisted: "sheet", upstream: text.slice(0, 500) });
  } catch (err) {
    return NextResponse.json({ ok: false, persisted: "client-only", error: String(err) });
  }
}
