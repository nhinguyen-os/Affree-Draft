"use client";

import Link from "next/link";
import { useState } from "react";
import { Logo } from "@/components/Logo";

interface LiveResult {
  ok: boolean;
  scrapableTotal?: number;
  attempted?: number;
  pricesFound?: number;
  markedGone?: number;
  wrote?: boolean;
  chainedNext?: number | null;
  upstream?: { ok?: boolean; updated?: number; created?: number; gone?: number; error?: string };
  error?: string;
}

export default function AdminPage() {
  const [secret, setSecret] = useState("");
  const [loading, setLoading] = useState(false);
  const [res, setRes] = useState<LiveResult | null>(null);
  const [err, setErr] = useState("");

  async function scrapeNow() {
    setLoading(true);
    setErr("");
    setRes(null);
    try {
      // all=1: quét HẾT toàn bộ, tự nối mẻ ở chế độ nền cho tới khi xong.
      const r = await fetch(`/api/scrape-live?write=1&all=1`, {
        method: "POST",
        headers: secret ? { Authorization: `Bearer ${secret}` } : {},
      });
      const data = (await r.json()) as LiveResult;
      if (!r.ok) setErr(data.error || `HTTP ${r.status}`);
      setRes(data);
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3">
          <Link href="/" className="flex items-center gap-2 text-slate-500 hover:text-slate-900">
            <Logo size={28} />
            <span className="text-sm">← Trang chính</span>
          </Link>
          <h1 className="text-lg font-bold">Cào giá thật</h1>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-4 px-4 py-5">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-sm text-slate-600">
            Cào giá + tồn kho thật từ link sản phẩm (ConCung, Co.op) rồi ghi vào master sheet.
            Bấm <b>Cào hết ngay</b> sẽ quét <b>toàn bộ</b> sản phẩm cào được; mẻ đầu chạy ngay,
            phần còn lại tự chạy tiếp ở chế độ nền (~vài phút). Sản phẩm bị gỡ (404) sẽ được
            đánh dấu để ẩn khỏi web. Cron cũng tự quét hết mỗi sáng 7h.
          </p>

          <label className="mt-4 block text-sm font-medium text-slate-700">
            Mã bảo mật (CRON_SECRET)
          </label>
          <input
            type="password"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            placeholder="dán CRON_SECRET"
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />

          <button
            onClick={scrapeNow}
            disabled={loading}
            className="mt-4 w-full rounded-lg bg-emerald-600 px-4 py-2.5 font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {loading ? "Đang cào…" : "Cào hết ngay"}
          </button>
        </div>

        {err && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            Lỗi: {err}
          </div>
        )}

        {res && (
          <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm">
            <div className="mb-2 font-semibold">Kết quả mẻ đầu</div>
            <ul className="space-y-1 text-slate-700">
              <li>Tổng sp cào được (ConCung+Coop): <b>{res.scrapableTotal ?? "-"}</b></li>
              <li>Mẻ đầu đã cào: <b>{res.attempted ?? "-"}</b></li>
              <li>Lấy được giá: <b>{res.pricesFound ?? "-"}</b></li>
              <li>Đánh dấu đã gỡ (404): <b>{res.markedGone ?? 0}</b></li>
              {res.wrote && res.upstream && (
                <li className="pt-1 text-slate-500">
                  Ghi vào sheet → cập nhật {res.upstream.updated ?? 0}, thêm mới{" "}
                  {res.upstream.created ?? 0}
                  {res.upstream.error ? ` · lỗi: ${res.upstream.error}` : ""}
                </li>
              )}
            </ul>
            {res.chainedNext != null ? (
              <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-amber-700">
                ⏳ Đang cào tiếp các mẻ còn lại ở chế độ nền (từ sp #{res.chainedNext}). Đợi
                vài phút rồi xem master sheet — các ô GIA_LIVE sẽ đầy dần tới hết.
              </p>
            ) : (
              <p className="mt-2 rounded-lg bg-emerald-50 px-3 py-2 text-emerald-700">
                ✓ Đã quét hết toàn bộ.
              </p>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
