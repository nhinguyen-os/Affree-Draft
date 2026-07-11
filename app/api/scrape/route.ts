import { NextResponse } from "next/server";
import { scrapeAll } from "@/lib/scrape";
import type { Chain } from "@/lib/types";

export const dynamic = "force-dynamic"; // không cache, mỗi lần gọi là cào mới
export const maxDuration = 60;

const ALL_CHAINS: Chain[] = ["bhx", "concung", "coop", "aeon"];

/**
 * Endpoint cào data → upsert vào Google Sheet (qua Apps Script action upsert_catalog).
 * Gọi bởi:
 *   - Vercel Cron (GET theo lịch trong vercel.json; Vercel tự gửi Authorization: Bearer CRON_SECRET).
 *   - Menu Google Sheet "Cào lại ngay" (POST tới URL có ?secret=...).
 * Bảo vệ bằng env CRON_SECRET nếu được set.
 *
 * Query tùy chọn: ?chains=bhx,coop để chỉ cào vài chuỗi.
 */
async function run(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const url = new URL(req.url);
    const fromQuery = url.searchParams.get("secret");
    const fromHeader = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (fromQuery !== secret && fromHeader !== secret) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
  }

  const url = new URL(req.url);
  const chainsParam = url.searchParams.get("chains");
  const only = chainsParam
    ? (chainsParam.split(",").map((c) => c.trim()).filter((c): c is Chain => ALL_CHAINS.includes(c as Chain)))
    : undefined;

  const { rows, perChain, errors } = await scrapeAll(only);

  const target = process.env.CATALOG_API_URL;
  if (!target) {
    return NextResponse.json(
      { ok: false, error: "CATALOG_API_URL chưa cấu hình", scraped: rows.length, perChain, errors },
      { status: 500 },
    );
  }

  try {
    const res = await fetch(target, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "upsert_catalog", rows }),
    });
    const upstream = await res.json().catch(() => ({}));
    return NextResponse.json({ ok: res.ok, scraped: rows.length, perChain, errors, upstream });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: String(err), scraped: rows.length, perChain, errors },
      { status: 502 },
    );
  }
}

export async function GET(req: Request) {
  return run(req);
}

export async function POST(req: Request) {
  return run(req);
}
