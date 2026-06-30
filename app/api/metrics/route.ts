import { NextResponse } from "next/server";
import { PURCHASE_WEBHOOK_URL, ALLOW_SHEET_WRITE } from "@/lib/config";

/**
 * Bộ đếm THẬT cho trang (lượt truy cập / đơn hàng / giỏ hàng), lưu qua Apps Script
 * Web App (PURCHASE_WEBHOOK_URL) → tab "Metrics" trong Google Sheet. Local & production
 * dùng CHUNG 1 counter này.
 *
 *  GET  /api/metrics            → { ok, totals:{visits,orders,carts} }
 *  POST /api/metrics { event }  → tăng 1, trả totals mới   (event: visit|order|cart)
 *
 * Chưa cấu hình webhook / script chưa có action metric → trả totals rỗng, UI tự ẩn phần đếm.
 */

export const runtime = "nodejs";
export const revalidate = 0;

// Chỉ PRODUCTION thật mới CỘNG đếm; local/preview chỉ ĐỌC số → giữ số production sạch.
// (Dùng chung cờ ALLOW_SHEET_WRITE với các route ghi khác.)
const CAN_INCR = ALLOW_SHEET_WRITE;

const EVENTS = new Set(["visit", "order", "cart"]);
type Totals = { visits: number; orders: number; carts: number; products: number; stores: number; brands: number };
const EMPTY: Totals = { visits: 0, orders: 0, carts: 0, products: 0, stores: 0, brands: 0 };

function parseTotals(text: string): Totals {
  try {
    const j = JSON.parse(text);
    const t = j.totals ?? j;
    return {
      visits:   Number(t.visits)   || 0,
      orders:   Number(t.orders)   || 0,
      carts:    Number(t.carts)    || 0,
      products: Number(t.products) || 0,
      stores:   Number(t.stores)   || 0,
      brands:   Number(t.brands)   || 0,
    };
  } catch {
    return { ...EMPTY };
  }
}

async function callWebhook(body: Record<string, unknown>): Promise<Totals> {
  const wh = PURCHASE_WEBHOOK_URL;
  if (!wh) return { ...EMPTY };
  const res = await fetch(wh, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  return parseTotals(await res.text());
}

export async function GET() {
  try {
    return NextResponse.json({ ok: true, totals: await callWebhook({ action: "metrics_get" }) });
  } catch (err) {
    return NextResponse.json({ ok: false, totals: EMPTY, error: String(err) });
  }
}

export async function POST(req: Request) {
  let body: { event?: string; snapshot?: { products: number; stores: number; brands: number } };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }

  // Snapshot catalog counts (products / stores / brands) — chỉ ghi production.
  if (body.snapshot) {
    if (!CAN_INCR) return NextResponse.json({ ok: true, wrote: false, totals: EMPTY });
    try {
      return NextResponse.json({
        ok: true, wrote: true,
        totals: await callWebhook({ action: "metrics_snapshot", event: body.snapshot }),
      });
    } catch (err) {
      return NextResponse.json({ ok: false, totals: EMPTY, error: String(err) });
    }
  }

  const event = String(body.event || "");
  if (!EVENTS.has(event)) {
    return NextResponse.json({ ok: false, error: "unknown event" }, { status: 400 });
  }
  try {
    const action = CAN_INCR ? "metric_incr" : "metrics_get";
    return NextResponse.json({ ok: true, wrote: CAN_INCR, totals: await callWebhook({ action, event }) });
  } catch (err) {
    return NextResponse.json({ ok: false, totals: EMPTY, error: String(err) });
  }
}
