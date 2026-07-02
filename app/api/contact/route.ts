import { NextResponse } from "next/server";
import { PURCHASE_WEBHOOK_URL, ALLOW_SHEET_WRITE } from "@/lib/config";

/**
 * Lưu lead liên hệ "Liên hệ dịch vụ - Affree".
 * Apps Script handler đợi action "save_contact" → ghi vào tab "contact_leads"
 * (tự upsert theo phone + kind nếu cần). Nếu chưa cấu hình webhook → trả ok
 * và client vẫn lưu localStorage.
 */
type ContactRecord = {
  kind: string; // tu-van | hop-tac | b2b | khac | loi-yeu-thuong | nhac-ban-quyen
  name: string;
  phone: string;
  area?: string;
  email?: string;
  msg?: string;
  recipient?: string; // form "lời yêu thương": tên người thân sẽ nhận lời nhắn
};

export async function POST(req: Request) {
  let record: ContactRecord;
  try {
    record = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }

  if (!record.kind) {
    return NextResponse.json({ ok: false, error: "missing fields" }, { status: 400 });
  }
  // Form "Gửi lời yêu thương" không bắt buộc tên/SĐT (chỉ cần lời nhắn) → vẫn cho lưu.
  if (record.kind !== "loi-yeu-thuong" && (!record.phone || !record.name)) {
    return NextResponse.json({ ok: false, error: "missing fields" }, { status: 400 });
  }

  const webhook = PURCHASE_WEBHOOK_URL;
  if (!webhook) {
    return NextResponse.json({ ok: true, persisted: "client-only" });
  }
  // Chỉ ghi vào sheet ở production thật — local/preview bỏ qua (vẫn trả ok cho client).
  if (!ALLOW_SHEET_WRITE) {
    return NextResponse.json({ ok: true, persisted: "skipped-non-prod" });
  }

  try {
    const res = await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "save_contact", record }),
    });
    const text = await res.text();
    return NextResponse.json({ ok: res.ok, persisted: "sheet", upstream: text.slice(0, 500) });
  } catch (err) {
    return NextResponse.json({ ok: false, persisted: "client-only", error: String(err) });
  }
}
