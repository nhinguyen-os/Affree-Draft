"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Logo } from "@/components/Logo";
import { type Lang, langForCountry, readSavedCountry, tr } from "@/lib/i18n";
import { fetchMe, type AuthUser } from "@/lib/auth";
import { saveProfile } from "@/lib/profile";

/** Trang "Thông tin cá nhân" — CHỈ hồ sơ + thẻ đã lưu. Đơn hàng ở trang riêng /account/orders. */
export default function AccountPage() {
  const [lang, setLang] = useState<Lang>("vi");
  const t = (vi: string, vars?: Record<string, string | number>) => tr(lang, vi, vars);

  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [card, setCard] = useState<{ last4?: string; brand?: string; exp?: string }>({});
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState("");

  useEffect(() => {
    setLang(langForCountry(readSavedCountry()));
    (async () => {
      const u = await fetchMe();
      setUser(u);
      if (u) {
        setName(u.name || "");
        const accRes = await fetch("/api/account", { cache: "no-store" }).then((r) => r.json()).catch(() => null);
        if (accRes?.account) {
          const a = accRes.account;
          setName(a.name || u.name || "");
          setEmail(a.email || "");
          setAddress(a.address || "");
          setCard({ last4: a.cardLast4 || "", brand: a.cardBrand || "", exp: a.cardExp || "" });
        }
      }
      setLoading(false);
    })();
  }, []);

  async function handleSave() {
    if (saving) return;
    setSaving(true);
    setSavedMsg("");
    try {
      await fetch("/api/account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), email: email.trim(), address: address.trim() }),
      });
      saveProfile({ name: name.trim(), address: address.trim() });
      setUser((u) => (u ? { ...u, name: name.trim() } : u));
      setSavedMsg(t("Đã lưu"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3">
          <Link href="/" className="flex items-center gap-2 text-slate-500 hover:text-slate-900">
            <Logo size={28} />
            <span className="text-sm">{t("← Trang chính")}</span>
          </Link>
          <h1 className="text-lg font-bold">{t("Thông tin cá nhân")}</h1>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-5">
        {loading ? (
          <p className="text-slate-500">{t("Đang tải…")}</p>
        ) : !user ? (
          <div className="rounded-xl border border-slate-200 bg-white p-5 text-center">
            <p className="text-slate-600">{t("Bạn chưa đăng nhập.")}</p>
            <Link href="/" className="mt-3 inline-block rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700">
              {t("Về trang chính để đăng nhập")}
            </Link>
          </div>
        ) : (
          <>
            {/* Hồ sơ */}
            <section className="mb-4 rounded-xl border border-slate-200 bg-white p-4">
              <div className="space-y-3">
                <Field label={t("Số điện thoại / Zalo")}>
                  <input value={user.phone} disabled className="w-full rounded-lg border border-slate-200 bg-slate-100 px-3 py-2 text-sm text-slate-500" />
                </Field>
                <Field label={t("Họ tên")}>
                  <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nguyễn Văn A" className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100" />
                </Field>
                <Field label="Email">
                  <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="ban@email.com" className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100" />
                </Field>
                <Field label={t("Địa chỉ giao hàng")}>
                  <textarea value={address} onChange={(e) => setAddress(e.target.value)} rows={2} placeholder={t("Số nhà, đường, phường, quận…")} className="w-full resize-none rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100" />
                </Field>
                <div className="flex items-center gap-3">
                  <button onClick={handleSave} disabled={saving} className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:bg-slate-300">
                    {saving ? t("Đang lưu…") : t("Lưu thay đổi")}
                  </button>
                  {savedMsg && <span className="text-sm font-medium text-emerald-600">✓ {savedMsg}</span>}
                </div>
              </div>
            </section>

            {/* Thẻ đã lưu (ĐÃ CHE) — chỉ 4 số cuối + hãng + hạn */}
            {card.last4 && (
              <section className="mb-4 rounded-xl border border-slate-200 bg-white p-4">
                <h2 className="mb-3 text-sm font-bold text-slate-800">{t("Thẻ đã lưu")}</h2>
                <div className="flex items-center gap-3 rounded-lg border border-slate-100 bg-slate-50 p-3">
                  <span className="rounded border border-slate-300 px-2 py-1 text-[11px] font-bold uppercase tracking-wide text-slate-600">
                    {card.brand || t("Thẻ")}
                  </span>
                  <span className="font-mono text-sm font-semibold text-slate-800">•••• {card.last4}</span>
                  {card.exp && <span className="text-xs text-slate-400">{card.exp}</span>}
                </div>
                <p className="mt-2 text-[11px] text-slate-400">{t("Chỉ lưu 4 số cuối + hãng để hiển thị — không lưu số thẻ đầy đủ hay CVV.")}</p>
              </section>
            )}

          </>
        )}
      </main>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold text-slate-800">{label}</span>
      {children}
    </label>
  );
}
