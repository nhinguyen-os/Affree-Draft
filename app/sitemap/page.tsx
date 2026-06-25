/**
 * Trang sitemap: liệt kê toàn bộ URL của web — cố định + động (từ catalog).
 * Là chỗ "lưu trữ" route cho dev/SEO, cũng có thể share cho user xem mục lục.
 */
"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { Catalog } from "@/lib/types";
import { slugify } from "@/lib/slug";

const STATIC_ROUTES: Array<{ path: string; label: string; note?: string }> = [
  { path: "/", label: "Trang chủ", note: "Danh mục, gợi ý, deal quanh đây" },
  { path: "/admin", label: "Admin", note: "Bảng quản trị nội bộ" },
  { path: "/history", label: "Lịch sử mua", note: "Đơn đã đặt của user (lưu local)" },
  { path: "/sitemap", label: "Sitemap", note: "Trang này" },
];

const API_ROUTES: Array<{ path: string; note: string }> = [
  { path: "/api/catalog", note: "JSON: products + offers + groups + sponsors" },
  { path: "/api/stores", note: "JSON: danh sách cửa hàng vật lý" },
  { path: "/api/geocode", note: "Reverse geocode (lat,lng → địa chỉ)" },
  { path: "/api/poi", note: "POI quanh vị trí" },
  { path: "/api/alerts", note: "Đăng ký báo giá giảm" },
  { path: "/api/buyer", note: "Lưu thông tin người mua" },
  { path: "/api/purchases", note: "Lịch sử đơn (server)" },
  { path: "/api/scrape", note: "Chạy scrape định kỳ (CRON)" },
  { path: "/api/scrape-live", note: "Scrape on-demand" },
];

export default function SitemapPage() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  useEffect(() => {
    fetch("/api/catalog").then((r) => r.json()).then(setCatalog).catch(() => {});
  }, []);

  // Rút brand / category / product id duy nhất, đã sort.
  const brands = useMemo(() => {
    if (!catalog) return [] as string[];
    const set = new Set<string>();
    for (const p of catalog.products) if (p.brand) set.add(p.brand);
    return [...set].sort((a, b) => a.localeCompare(b, "vi"));
  }, [catalog]);

  const categories = useMemo(() => {
    if (!catalog) return [] as string[];
    const set = new Set<string>();
    // Gộp TỆP (tab "tệp" — Đồ ăn, Đồ uống, Trang sức…) + CATEGORY (cấp ngành con).
    // URL /nganh/<slug> phục vụ cả 2 — xem effect URL→state ở [[app/page.tsx]].
    if (catalog.groups) for (const g of catalog.groups) if (g.label) set.add(g.label);
    for (const p of catalog.products) {
      if (p.group) set.add(p.group);
      if (p.category) set.add(p.category);
    }
    return [...set].sort((a, b) => a.localeCompare(b, "vi"));
  }, [catalog]);

  const products = useMemo(() => catalog?.products ?? [], [catalog]);

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:py-10">
      <header className="mb-6">
        <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-600">Affree</p>
        <h1 className="mt-1 text-2xl font-bold text-slate-900">Sitemap — Mục lục URL</h1>
        <p className="mt-1 text-sm text-slate-500">
          Toàn bộ đường dẫn cố định và động của web. Cập nhật tự động từ catalog (
          {products.length} sản phẩm · {brands.length} nhãn hàng · {categories.length} ngành hàng).
        </p>
      </header>

      <Section title="Trang cố định" count={STATIC_ROUTES.length}>
        <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl ring-1 ring-slate-200">
          {STATIC_ROUTES.map((r) => (
            <li key={r.path} className="flex items-center justify-between gap-3 bg-white px-4 py-2.5 hover:bg-slate-50">
              <div className="min-w-0">
                <Link href={r.path} className="font-mono text-sm font-semibold text-emerald-700 hover:underline">
                  {r.path}
                </Link>
                <p className="text-xs text-slate-500">{r.label}{r.note ? ` — ${r.note}` : ""}</p>
              </div>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Nhãn hàng (brand)" count={brands.length}>
        <p className="mb-2 text-xs text-slate-500">Cú pháp: <code className="rounded bg-slate-100 px-1.5 py-0.5">/nhan/&lt;brand-slug&gt;</code></p>
        <div className="flex flex-wrap gap-1.5">
          {brands.map((b) => {
            const slug = slugify(b);
            return (
              <Link
                key={b}
                href={`/nhan/${slug}`}
                className="rounded-full bg-white px-3 py-1 text-xs font-medium text-slate-700 ring-1 ring-slate-200 transition hover:bg-emerald-50 hover:text-emerald-700 hover:ring-emerald-300"
              >
                {b}
                <span className="ml-1.5 text-[10px] text-slate-400">/nhan/{slug}</span>
              </Link>
            );
          })}
        </div>
      </Section>

      <Section title="Ngành hàng (category)" count={categories.length}>
        <p className="mb-2 text-xs text-slate-500">Cú pháp: <code className="rounded bg-slate-100 px-1.5 py-0.5">/nganh/&lt;cat-slug&gt;</code></p>
        <div className="flex flex-wrap gap-1.5">
          {categories.map((c) => {
            const slug = slugify(c);
            return (
              <Link
                key={c}
                href={`/nganh/${slug}`}
                className="rounded-full bg-white px-3 py-1 text-xs font-medium text-slate-700 ring-1 ring-slate-200 transition hover:bg-emerald-50 hover:text-emerald-700 hover:ring-emerald-300"
              >
                {c}
                <span className="ml-1.5 text-[10px] text-slate-400">/nganh/{slug}</span>
              </Link>
            );
          })}
        </div>
      </Section>

      <Section title="Brand + Ngành hàng" count={null}>
        <p className="text-xs text-slate-500">Cú pháp: <code className="rounded bg-slate-100 px-1.5 py-0.5">/nhan/&lt;brand-slug&gt;/&lt;cat-slug&gt;</code> — lồng brand &amp; category. Mọi cặp hợp lệ đều hoạt động (vd: <Link href="/nhan/pnj/trang-suc" className="text-emerald-700 hover:underline">/nhan/pnj/trang-suc</Link>).</p>
      </Section>

      <Section title={`Sản phẩm chi tiết (${products.length})`} count={null}>
        <p className="mb-2 text-xs text-slate-500">Cú pháp: <code className="rounded bg-slate-100 px-1.5 py-0.5">/p/&lt;product-id&gt;</code> hoặc slug của tên.</p>
        <details className="rounded-xl bg-white p-3 ring-1 ring-slate-200">
          <summary className="cursor-pointer text-sm font-medium text-slate-700">Hiện danh sách {products.length} URL sản phẩm</summary>
          <ul className="mt-3 max-h-96 space-y-0.5 overflow-y-auto pr-1 text-xs">
            {products.map((p) => (
              <li key={p.id} className="flex justify-between gap-3 py-0.5">
                <Link href={`/p/${p.id}`} className="truncate font-mono text-emerald-700 hover:underline">
                  /p/{p.id}
                </Link>
                <span className="shrink-0 truncate text-slate-400">{p.name}</span>
              </li>
            ))}
          </ul>
        </details>
      </Section>

      <Section title="API endpoints (nội bộ)" count={API_ROUTES.length}>
        <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl ring-1 ring-slate-200">
          {API_ROUTES.map((r) => (
            <li key={r.path} className="flex items-center justify-between gap-3 bg-white px-4 py-2.5">
              <code className="font-mono text-xs font-semibold text-slate-700">{r.path}</code>
              <span className="truncate text-xs text-slate-500">{r.note}</span>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}

function Section({ title, count, children }: { title: string; count: number | null; children: React.ReactNode }) {
  return (
    <section className="mb-7">
      <h2 className="mb-2 flex items-center gap-2 text-base font-semibold text-slate-800">
        {title}
        {count !== null && (
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-600">{count}</span>
        )}
      </h2>
      {children}
    </section>
  );
}
