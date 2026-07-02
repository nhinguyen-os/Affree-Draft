"use client";

import { type Lang, tr } from "@/lib/i18n";

const LINKS = [
  {
    group: "Công ty",
    items: [
      { vi: "Giới thiệu", en: "About us", href: "/gioi-thieu" },
      { vi: "Liên hệ", en: "Contact", href: "/lien-he" },
      { vi: "Tuyển dụng", en: "Careers", href: "/tuyen-dung" },
    ],
  },
  {
    group: "Hỗ trợ",
    items: [
      { vi: "CSKH", en: "Customer support", href: "/ho-tro" },
      { vi: "Câu hỏi thường gặp", en: "FAQ", href: "/faq" },
      { vi: "Hướng dẫn mua hàng", en: "Buying guide", href: "/huong-dan" },
    ],
  },
  {
    group: "Pháp lý",
    items: [
      { vi: "Chính sách bảo mật", en: "Privacy policy", href: "/chinh-sach-bao-mat" },
      { vi: "Điều khoản sử dụng", en: "Terms of use", href: "/dieu-khoan" },
      { vi: "Chính sách cookie", en: "Cookie policy", href: "/cookie" },
    ],
  },
];

export function AppFooter({ lang = "vi" }: { lang?: Lang }) {
  const t = (vi: string) => tr(lang, vi);

  return (
    <footer className="mt-10 border-t border-slate-200 bg-slate-50 px-4 pb-8 pt-8 text-sm text-slate-600">
      <div className="mx-auto max-w-2xl">
        {/* Brand */}
        <div className="mb-6">
          <p className="text-base font-bold text-slate-800">Affree</p>
          <p className="mt-1 text-xs text-slate-500 leading-relaxed">
            {t("Kết nối mua bán · Không thu phí · Giá hời quanh đây")}
          </p>
          <p className="mt-1 text-xs text-slate-400">
            {t("Vận hành bởi")} One Solution JSC ·{" "}
            <a href="mailto:support@affree.vn" className="hover:underline">
              support@affree.vn
            </a>
          </p>
        </div>

        {/* Link groups */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          {LINKS.map((group) => (
            <div key={group.group}>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                {t(group.group)}
              </p>
              <ul className="space-y-1.5">
                {group.items.map((item) => (
                  <li key={item.href}>
                    <a
                      href={item.href}
                      className="text-xs text-slate-500 hover:text-emerald-600 hover:underline"
                    >
                      {lang === "en" ? item.en : item.vi}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Legal note */}
        <div className="border-t border-slate-200 pt-4 text-[11px] text-slate-400 leading-relaxed">
          <p>
            {t("Affree là nền tảng so sánh giá và kết nối mua bán, không trực tiếp kinh doanh hàng hóa.")}
            {" "}{t("Thông tin giá có thể thay đổi — vui lòng xác nhận với cửa hàng trước khi đặt mua.")}
          </p>
          <p className="mt-1">© {new Date().getFullYear()} One Solution JSC. {t("Bảo lưu mọi quyền.")}</p>
        </div>
      </div>
    </footer>
  );
}
