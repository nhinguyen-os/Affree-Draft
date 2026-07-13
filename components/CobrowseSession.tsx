"use client";

import { useEffect, useRef, useState } from "react";
import QRCode from "react-qr-code";
import { formatMoney } from "@/lib/util";
import { getProfile, saveProfile } from "@/lib/profile";
import { type Lang, tr } from "@/lib/i18n";
import { Logo } from "@/components/Logo";
import type { Chain } from "@/lib/types";
import { ChainBadge } from "@/components/ChainBadge";

/**
 * CobrowseSession — MÀN ĐẶT ĐƠN co-browse mô phỏng, 3 BƯỚC:
 *   1) FORM điền thông tin  →  2) chọn TÀI KHOẢN + xin phép  →  3) màn 2 CỘT.
 *
 * Từ BƯỚC 2, bố cục ĐÃ LÀ 2 CỘT: đơn nháp được "đẩy" qua cột TRÁI (hiệu ứng trượt),
 * các câu hỏi (tài khoản → quyền riêng tư) trượt vào cột PHẢI; trả lời xong thì
 * cột phải chuyển thành trang cửa hàng — không còn màn hỏi chiếm toàn trang.
 *
 * BƯỚC 3 (co-browse): PHẢI = "trang cửa hàng" TƯƠNG TÁC — user tăng/giảm số lượng, thêm
 * sản phẩm (gợi ý demo), nhập mã khuyến mãi → TRÁI (Affree) cập nhật giỏ/tổng theo THỜI GIAN
 * THỰC (state chung, không iframe). Trợ lý (bot) TỰ ĐIỀN thông tin nhận hàng + TỰ CHỌN thanh
 * toán; user chỉ kiểm tra và bấm "Đặt hàng". Mỗi cửa hàng đặt xong → overlay "Đặt hàng thành
 * công tại …" (kèm mã đơn) NGAY TRONG khung web; xong hết → card "🎉 Hoàn tất n/n" dưới khung
 * (theo prototype — KHÔNG popup che màn).
 *
 * Tài khoản theo TỪNG cửa hàng (bước 2 = mặc định chung). Cửa "của tôi" → dừng cho user đăng nhập.
 */

export type CobrowseField = {
  label: string;
  src?: "name" | "phone" | "address";
  fixed?: string;
  sensitive?: boolean;
  /** Trường khung giờ giao — hiện dropdown cho user tự chọn (mỗi cửa hàng chọn riêng). */
  slot?: boolean;
};

export type CobrowseProduct = {
  emoji?: string;
  image?: string;
  name: string;
  qty: number;
  unitPrice: number;
  lineTotal: number;
};

/** Món gợi ý "mua thêm" trên trang cửa hàng (sản phẩm thật của cửa hàng, hoặc demo). */
export type CobrowseSuggestion = { emoji?: string; image?: string; name: string; price: number };

export type CobrowseStore = {
  key: string;
  name: string;
  branch?: string;
  color: string;
  icon?: string;
  /** Key chuỗi (vd "coop", "bhx") → hiện LOGO THẬT từ sheet "Logo nguồn" qua ChainBadge. */
  chain?: string;
  domain?: string;
  currency?: string;
  /** Skin nhận diện THẬT của chuỗi cho trang mô phỏng (header/màu/bố cục giống web thật). */
  skin?: "bhx" | "coop";
  /** Gợi ý "mua thêm" = sản phẩm THẬT của cửa hàng (từ catalog Affree). Trống → fallback demo. */
  suggestions?: CobrowseSuggestion[];
  products: CobrowseProduct[];
  ship?: number;
  total: number;
  fields: CobrowseField[];
};

export type CobrowseBuyer = { name: string; phone: string; address: string };
type AccountMode = "affree" | "self";
type Status = "idle" | "login" | "filling" | "review" | "placed";
type Step = "form" | "account" | "consent" | "session";
type PayMethod = "qr" | "card" | "cod";
type Line = { emoji?: string; image?: string; name: string; qty: number; unitPrice: number };

// Gợi ý "mua thêm" (DEMO) — chưa có catalog thật từng cửa hàng nên dùng vài món phổ biến.
const SUGGESTIONS: { emoji: string; name: string; price: number }[] = [
  { emoji: "🛍️", name: "Túi vải Affree", price: 15000 },
  { emoji: "🧻", name: "Giấy vệ sinh (lốc 10)", price: 52000 },
  { emoji: "🧼", name: "Nước rửa tay 500ml", price: 39000 },
  { emoji: "😷", name: "Khẩu trang (hộp 50)", price: 45000 },
];
// Khung giờ giao — danh sách chọn (đồng bộ với giỏ hàng / TuiAgentModal).
const SLOTS = [
  "Trong hôm nay (2–4 giờ)",
  "Tối nay (18:00–21:00)",
  "Sáng mai (8:00–11:00)",
  "Chiều mai (14:00–17:00)",
];
// Mã khuyến mãi DEMO.
const PROMOS: Record<string, number> = { AFFREE10: 0.1, SALE20: 0.2 };
// Danh sách mã để xổ ra cho user chọn (kèm % giảm).
const PROMO_OPTIONS = Object.entries(PROMOS).map(([code, rate]) => ({
  code,
  pct: Math.round(rate * 100),
}));

export default function CobrowseSession({
  lang = "vi",
  buyer,
  stores,
  startStep = "form",
  defaultPay,
  cardLabel,
  onClose,
  onPlaced,
}: {
  lang?: Lang;
  buyer: CobrowseBuyer;
  stores: CobrowseStore[];
  startStep?: "form" | "account";
  /** Phương thức thanh toán user ĐÃ CHỌN ở form bước 1 — bot tự chọn đúng cái này trên trang cửa hàng. */
  defaultPay?: PayMethod;
  /** Thẻ nhập/lưu ở Affree (đã che số, vd "Visa ****4242") — tài khoản Affree + thẻ: trợ lý đưa thẻ này qua web. */
  cardLabel?: string;
  onClose: () => void;
  onPlaced?: (store: CobrowseStore, code: string, slot?: string, pay?: PayMethod) => void;
}) {
  const t = (vi: string, vars?: Record<string, string | number>) => tr(lang, vi, vars);

  const [step, setStep] = useState<Step>(startStep);
  const [defaultMode, setDefaultMode] = useState<AccountMode>("affree");
  // Dải "Miễn trừ": mobile rút gọn 2 dòng — chạm để mở đủ / thu lại.
  const [discOpen, setDiscOpen] = useState(false);

  // Overlay cobrowse nằm DƯỚI header xanh của trang chính (z thấp hơn) → đo chiều cao
  // header sticky để đẩy toàn bộ nội dung (topbar + Miễn trừ + 2 cột) xuống, không bị che.
  // Trang standalone (không có header) → offset 0.
  const [headerOffset, setHeaderOffset] = useState(0);
  useEffect(() => {
    const measure = () => {
      let h = 0;
      document.querySelectorAll("header").forEach((el) => {
        if (el.closest(".cbz")) return; // bỏ qua header nội bộ (nếu có)
        const cs = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        if ((cs.position === "sticky" || cs.position === "fixed") && r.top <= 1 && r.height > 0) {
          h = Math.max(h, r.bottom);
        }
      });
      setHeaderOffset(h);
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  // Mobile: màn 2 cột thành 2 trang vuốt ngang (đơn hàng ⟷ phiên cửa hàng).
  const appRef = useRef<HTMLDivElement>(null);
  const [mobilePane, setMobilePane] = useState(0);
  const onAppScroll = () => {
    const el = appRef.current;
    if (el) setMobilePane(el.scrollLeft > el.clientWidth / 2 ? 1 : 0);
  };
  const scrollToPane = (i: number) => {
    const el = appRef.current;
    if (el) el.scrollTo({ left: i * el.clientWidth, behavior: "smooth" });
  };

  // Mobile (2 trang vuốt ngang): vào bước hỏi (tài khoản / xin phép) → tự lướt
  // sang trang phải để user thấy câu hỏi ngay; đơn nháp vẫn ở trang trái.
  useEffect(() => {
    if (step !== "account" && step !== "consent") return;
    if (!window.matchMedia("(max-width: 900px)").matches) return;
    const id = requestAnimationFrame(() => scrollToPane(1));
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  // Prop trống → tự điền lại từ hồ sơ đã lưu (localStorage) của lần nhập trước.
  const [name, setName] = useState(() => buyer.name || getProfile().name);
  const [phone, setPhone] = useState(() => buyer.phone || getProfile().phone);
  const [address, setAddress] = useState(() => buyer.address || getProfile().address);
  // Gõ/sửa thông tin ở đây cũng LƯU hồ sơ để mọi form khác tự điền lại.
  const skipFirstProfileSave = useRef(true);
  useEffect(() => {
    if (skipFirstProfileSave.current) { skipFirstProfileSave.current = false; return; }
    saveProfile({ name, phone, address });
  }, [name, phone, address]);
  const cust = { name, phone, address };

  const [active, setActive] = useState(-1);
  const [modes, setModes] = useState<AccountMode[]>(() => stores.map(() => "affree"));
  const [status, setStatus] = useState<Status[]>(() => stores.map(() => "idle"));
  const [typed, setTyped] = useState<Record<string, string>>({});
  const timers = useRef<ReturnType<typeof setInterval>[]>([]);
  // Hiệu ứng "chuẩn bị mở trang đích": cửa hàng đang mở phiên LẦN ĐẦU → khung phải hiện
  // màn loading (logo + vòng xoay + thanh tiến trình) ~1.6s rồi trang cửa hàng mới hiện.
  const [opening, setOpening] = useState<number | null>(null);
  const openingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const OPENING_MS = 1600;

  // ── GIỎ TƯƠNG TÁC theo từng cửa hàng (đồng bộ 2 cột) ──
  const [carts, setCarts] = useState<Line[][]>(() =>
    stores.map((s) => s.products.map((p) => ({ emoji: p.emoji, image: p.image, name: p.name, qty: p.qty, unitPrice: p.unitPrice }))),
  );
  const [promos, setPromos] = useState<(string | null)[]>(() => stores.map(() => null));
  // stores đổi độ dài sau khi mount (vd hot-reload giữ state cũ, hoặc prop cập nhật)
  // → đồng bộ lại giỏ/trạng thái theo stores mới, tránh crash carts[i] undefined.
  useEffect(() => {
    if (carts.length === stores.length) return;
    setCarts(stores.map((s) => s.products.map((p) => ({ emoji: p.emoji, image: p.image, name: p.name, qty: p.qty, unitPrice: p.unitPrice }))));
    setModes(stores.map(() => defaultMode));
    setStatus(stores.map(() => "idle"));
    setPromos(stores.map(() => null));
    setPays(stores.map(() => defaultPay ?? "qr"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stores.length]);
  // Bot tự chọn ĐÚNG phương thức user đã chọn ở form (mặc định QR nếu chưa có).
  const [pays, setPays] = useState<PayMethod[]>(() => stores.map(() => defaultPay ?? "qr"));
  const [codes, setCodes] = useState<Record<string, string>>({});
  // Khung giờ giao RIÊNG theo từng cửa hàng (mỗi cửa hàng chọn một khung khác nhau được).
  const [slots, setSlots] = useState<Record<number, string>>({});
  const slotOf = (i: number) => {
    const f = stores[i]?.fields.find((x) => x.slot);
    const def = f?.fixed && SLOTS.includes(f.fixed) ? f.fixed : SLOTS[0];
    return slots[i] ?? def;
  };

  useEffect(() => () => {
    timers.current.forEach(clearInterval);
    if (openingTimer.current) clearTimeout(openingTimer.current);
  }, []);

  const cur = stores[0]?.currency;
  const money = (n: number, c?: string) => formatMoney(n, c ?? cur);
  const allowSuggest = !cur || cur === "VND"; // giá gợi ý là VND

  // carts[i] có thể chưa kịp đồng bộ với stores (1 render sau hot-reload/prop đổi) → coi như giỏ rỗng.
  const subtotal = (i: number) => (carts[i] ?? []).reduce((s, it) => s + it.unitPrice * it.qty, 0);
  const discountRate = (i: number) => (promos[i] ? PROMOS[promos[i]!] || 0 : 0);
  const storeTotal = (i: number) => Math.round(subtotal(i) * (1 - discountRate(i))) + (stores[i].ship || 0);
  const grandTotal = stores.reduce((s, _st, i) => s + storeTotal(i), 0);

  function fieldValue(f: CobrowseField, i: number): string {
    if (f.slot) return slotOf(i);
    if (f.fixed) return f.fixed;
    if (f.src === "name") return name;
    if (f.src === "phone") return phone;
    if (f.src === "address") return address;
    return "";
  }

  // Đồng ý quyền riêng tư (3 mục, theo prototype) — hiện SAU bước chọn tài khoản.
  const [consents, setConsents] = useState([false, false, false]);
  const allConsented = consents.every(Boolean);

  function confirmAccount() {
    setModes(stores.map(() => defaultMode));
    setStep("consent");
  }

  function confirmConsent() {
    // Vào phiên: khung "Chưa có phiên đặt hàng nào" hiện MỘT NHỊP rồi TỰ MỞ cửa hàng
    // đầu tiên — hiệu ứng "chuẩn bị mở trang đích" chạy trước, xong mới lộ trang cửa hàng.
    setStep("session");
    if (stores.length) setTimeout(() => openStore(0), 450);
  }

  function openStore(i: number, modeOverride?: AccountMode) {
    setActive(i);
    setStatus((prev) => {
      if (prev[i] !== "idle") return prev;
      // Mở phiên LẦN ĐẦU → hiện màn "chuẩn bị mở trang đích" trước, hết loading mới lộ trang.
      setOpening(i);
      if (openingTimer.current) clearTimeout(openingTimer.current);
      openingTimer.current = setTimeout(() => setOpening(null), OPENING_MS);
      const m = modeOverride ?? modes[i];
      if (m === "self") return prev.map((s, k) => (k === i ? "login" : s));
      // Bot bắt đầu điền SAU khi trang cửa hàng đã hiện (hết loading + 0.5s như cũ).
      setTimeout(() => runBot(i), OPENING_MS + 500);
      return prev.map((s, k) => (k === i ? "filling" : s));
    });
  }

  function setStoreMode(i: number, m: AccountMode) {
    setModes((prev) => prev.map((x, k) => (k === i ? m : x)));
    setStatus((prev) => {
      if (prev[i] === "filling" || prev[i] === "review" || prev[i] === "placed") return prev;
      if (m === "self") return prev.map((s, k) => (k === i ? "login" : s));
      setTimeout(() => runBot(i), 400);
      return prev.map((s, k) => (k === i ? "filling" : s));
    });
  }

  function confirmLogin(i: number) {
    setStatus((prev) => prev.map((s, k) => (k === i ? "filling" : s)));
    setTimeout(() => runBot(i), 300);
  }

  // Bot tự điền thông tin + tự chọn thanh toán (mặc định QR chuyển khoản).
  function runBot(i: number) {
    const st = stores[i];
    const seq = st.fields.map((f, fi) => ({ fi, val: fieldValue(f, i) }));
    let k = 0;
    function nextField() {
      if (k >= seq.length) {
        // Bot chốt lại phương thức user đã chọn ở form (pays đã init theo defaultPay).
        setPays((prev) => prev.map((p, idx) => (idx === i ? (defaultPay ?? p) : p)));
        setStatus((prev) => prev.map((s, idx) => (idx === i ? "review" : s)));
        return;
      }
      const { fi, val } = seq[k];
      const key = `${i}-${fi}`;
      // Tiến độ theo THỜI GIAN THỰC (~0.8s/field): tick bị trình duyệt throttle (tab nền)
      // thì lần tick kế nhảy bù theo elapsed — không bao giờ kẹt ở giữa chừng.
      const start = Date.now();
      const DURATION = 800;
      const timer = setInterval(() => {
        const p = Math.min(val.length, Math.ceil((val.length * (Date.now() - start)) / DURATION));
        setTyped((prev) => ({ ...prev, [key]: val.slice(0, p) }));
        if (p >= val.length) {
          clearInterval(timer);
          k++;
          setTimeout(nextField, 180);
        }
      }, 34);
      timers.current.push(timer);
    }
    nextField();
  }

  // ── Thao tác giỏ trên trang cửa hàng (đồng bộ ngay sang cột trái) ──
  function changeQty(i: number, idx: number, delta: number) {
    setCarts((prev) =>
      prev.map((c, ci) => {
        if (ci !== i) return c;
        const next = c.map((it, k) => (k === idx ? { ...it, qty: it.qty + delta } : it)).filter((it) => it.qty > 0);
        return next;
      }),
    );
  }
  function addLine(i: number, sug: CobrowseSuggestion) {
    setCarts((prev) =>
      prev.map((c, ci) => {
        if (ci !== i) return c;
        const ex = c.findIndex((it) => it.name === sug.name);
        if (ex >= 0) return c.map((it, k) => (k === ex ? { ...it, qty: it.qty + 1 } : it));
        return [...c, { emoji: sug.emoji, image: sug.image, name: sug.name, qty: 1, unitPrice: sug.price }];
      }),
    );
  }

  function placeOrder(i: number) {
    const code = `${stores[i].key.toUpperCase().slice(0, 6)}-${100000 + (Math.floor((i + 1) * 12345) % 900000)}`;
    setStatus((prev) => prev.map((s, k) => (k === i ? "placed" : s)));
    setCodes((prev) => ({ ...prev, [stores[i].key]: code }));
    onPlaced?.(
      { ...stores[i], products: carts[i].map((l) => ({ ...l, lineTotal: l.unitPrice * l.qty })), total: storeTotal(i) },
      code,
      stores[i].fields.some((f) => f.slot) ? slotOf(i) : undefined,
      pays[i],
    );
  }

  // Cửa hàng đang chờ thanh toán QR Ở AFFREE (tài khoản Affree + QR): hệ thống
  // TỰ NHẬN BIẾT tiền vào (mô phỏng) rồi tự chốt đơn — không cần user bấm xác nhận.
  const [qrFor, setQrFor] = useState<number | null>(null);
  const [qrPaid, setQrPaid] = useState(false);
  useEffect(() => {
    if (qrFor === null) return;
    setQrPaid(false);
    // Mô phỏng: ~5s sau khi hiện QR thì "nhận được tiền", ~1.5s sau tự chốt đơn.
    const tDetect = setTimeout(() => setQrPaid(true), 5000);
    const tClose = setTimeout(() => {
      setQrFor(null);
      placeOrder(qrFor);
    }, 6500);
    return () => { clearTimeout(tDetect); clearTimeout(tClose); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qrFor]);
  function handlePlace(i: number) {
    if (modes[i] === "affree" && pays[i] === "qr") {
      setQrFor(i);
      return;
    }
    placeOrder(i);
  }

  // Tải QR thanh toán của cửa hàng về máy: SVG (react-qr-code) → canvas → PNG.
  function downloadQr(key: string, storeName: string) {
    const svg = document.querySelector(`[data-qr="${CSS.escape(key)}"] svg`);
    if (!svg) return;
    const xml = new XMLSerializer().serializeToString(svg);
    const img = new Image();
    img.onload = () => {
      const S = 480, PAD = 36;
      const canvas = document.createElement("canvas");
      canvas.width = S;
      canvas.height = S;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, S, S);
      ctx.drawImage(img, PAD, PAD, S - PAD * 2, S - PAD * 2);
      const a = document.createElement("a");
      a.href = canvas.toDataURL("image/png");
      a.download = `affree-qr-${storeName.replace(/[^\p{L}\p{N}]+/gu, "-").toLowerCase()}.png`;
      a.click();
    };
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(xml);
  }

  const allPlaced = status.length > 0 && status.every((s) => s === "placed");
  const orderTitle = stores.length === 1 ? stores[0].name : t("{n} cửa hàng", { n: stores.length });

  function statusText(s: Status): string {
    switch (s) {
      case "placed": return "✓ " + t("Đã đặt hàng thành công");
      case "login": return "● " + t("Chờ bạn đăng nhập");
      case "filling": return "● " + t("Trợ lý đang điền");
      case "review": return "● " + t("Chờ bạn xác nhận");
      default: return t("Chưa mở phiên");
    }
  }

  const phoneOk = phone.trim().length >= 8;

  // Danh sách cửa hàng ở cột trái — đọc GIỎ TƯƠNG TÁC (đồng bộ với web).
  const storeList = (withBadge: boolean) =>
    stores.map((st, i) => (
      <div className="store-block" key={st.key}>
        <div className="store-head">
          {st.chain ? (
            <ChainBadge chain={st.chain as Chain} size={26} />
          ) : (
            <div className="store-dot" style={{ background: st.color }}>{st.icon || st.name[0] || "•"}</div>
          )}
          <div style={{ flex: 1 }}>
            <div className="nm">{st.name}</div>
            <div className="sub">{st.branch || `${(carts[i] ?? []).length} ${t("sản phẩm")}`}</div>
            <div className="sub-total">{money(storeTotal(i), st.currency)}</div>
          </div>
          {withBadge && modes[i] !== "affree" && (
            <span className="acc-mini" title={t("Tài khoản của bạn")}>👤</span>
          )}
        </div>
        {(carts[i] ?? []).map((p, pi) => (
          <div className="item" key={pi}>
            {p.image ? (
              <img className="pimg" src={p.image} alt="" loading="lazy" />
            ) : (
              <span className="pimg pemoji">{p.emoji || "🛒"}</span>
            )}
            <span className="pnm">{p.name}</span>
            <span className="qty">×{p.qty}</span>
            <span className="price">{money(p.unitPrice * p.qty, st.currency)}</span>
          </div>
        ))}
        {discountRate(i) > 0 && (
          <div className="item" style={{ color: "#1E7A33" }}>
            <span className="pnm">{t("Giảm")} ({promos[i]})</span>
            <span className="price" style={{ color: "#1E7A33" }}>−{money(Math.round(subtotal(i) * discountRate(i)), st.currency)}</span>
          </div>
        )}
        <div className="item store-total-row">
          <span className="pnm">{t("Tổng đơn")}</span>
          <span className="price">{money(storeTotal(i), st.currency)}</span>
        </div>
        {withBadge && (
          <div className={`store-status ${status[i] === "placed" ? "st-done" : status[i] === "idle" ? "st-idle" : "st-live"}`}>
            {statusText(status[i])}
            {status[i] === "placed" && codes[st.key] && (
              <span className="order-code">{t("Mã đơn")}: <b>{codes[st.key]}</b></span>
            )}
            {/* Ghi nhận thêm giờ giao + thanh toán của cửa hàng ngay trong khối xác nhận.
                (Bỏ "Tổng tiền" — đã có dòng "Tổng đơn" phía trên khối.) */}
            {status[i] === "placed" && st.fields.some((f) => f.slot) && (
              <span className="order-code">{t("Giờ giao")}: <b>{t(slotOf(i))}</b></span>
            )}
            {status[i] === "placed" && (
              <span className="order-code">{t("Thanh toán")}: <b>{pays[i] === "card" ? "💳 " + t("Thẻ") : pays[i] === "cod" ? "💵 COD" : "📱 " + t("QR chuyển khoản")}</b></span>
            )}
          </div>
        )}
        {/* Thanh toán QR: chỉ hiện KHI trang cửa hàng bên phải đang hiện QR (đồng bộ với overlay qrFor). */}
        {withBadge && qrFor === i && (
          <div className="store-qr" data-qr={st.key}>
            <div className="qr-mini"><QRCode value={`AFFREE-PAY|${st.key}|${storeTotal(i)}`} size={72} /></div>
            <div className="qr-side">
              <div className="qr-lbl">📱 {t("QR thanh toán")} · <b>{money(storeTotal(i), st.currency)}</b></div>
              <div className="qr-hint">{t("Quét hoặc tải QR về để chuyển khoản cho cửa hàng.")}</div>
              <button className="qr-dl" onClick={() => downloadQr(st.key, st.name)}>⬇ {t("Tải QR về")}</button>
            </div>
          </div>
        )}
      </div>
    ));

  const infoFields = (
    <div className="sec">
      <div className="sec-label">{t("Thông tin chung")}</div>
      <div className="field"><label>{t("Họ tên")}</label><input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("Nguyễn Văn A")} /></div>
      <div className="field"><label>{t("Số điện thoại / Zalo")} <span className="shield" title={t("Trường nhạy cảm — che trong nhật ký phiên")}>🛡</span></label><input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="09xx xxx xxx" /></div>
      <div className="field"><label>{t("Địa chỉ giao hàng")} <span className="shield" title={t("Trường nhạy cảm — che trong nhật ký phiên")}>🛡</span></label><input value={address} onChange={(e) => setAddress(e.target.value)} placeholder={t("Số nhà, đường, phường, quận…")} /></div>
    </div>
  );

  const Header = (
    <>
      {/* Bỏ thanh "affree.vn" tối — header xanh trang chính đóng vai trò header.
          Giữ dòng Miễn trừ + đưa nút × đóng vào cuối dòng này. */}
      <div className="disclaimer-strip">
        <span className="d-ic" aria-hidden>i</span>
        <span
          className={`disclaimer-text ${discOpen ? "open" : ""}`}
          onClick={() => setDiscOpen((v) => !v)}
        ><b>{t("Miễn trừ:")}</b> {t("Affree không liên kết, không đại diện cho các nhà bán được hiển thị (Bách Hóa Xanh, Co.op Online…). Đơn hàng được xác lập trực tiếp giữa bạn và nhà bán trên website chính chủ của họ. Affree không nhìn thấy và không lưu thông tin thanh toán của bạn.")}</span>
        <button className="cbz-x" onClick={onClose} aria-label="Đóng">×</button>
      </div>
    </>
  );

  // ── BƯỚC 1: FORM ──────────────────────────────────────────────
  if (step === "form") {
    return (
      <div className="cbz cbz-full" role="dialog" aria-modal="true" style={{ paddingTop: headerOffset }}>
        <Style />
        {Header}
        <div className="cbz-center">
          <div className="panel" style={{ maxWidth: 460, width: "100%" }}>
            <h2>{t("Đơn hàng")} — {orderTitle} <small>· {t("đơn nháp")}</small></h2>
            {infoFields}
            <div className="sec">
              <div className="sec-label">{t("Cửa hàng trong đơn")}</div>
              {storeList(false)}
            </div>
            <div className="total-row"><span className="lbl">{t("Tổng cộng")}</span><span className="amt">{money(grandTotal)}</span></div>
            <button className="cta" disabled={!phoneOk} onClick={() => setStep("account")}>{t("Tiếp tục")} →</button>
            <div className="cta-sub">{t("Bước sau: chọn tài khoản đặt hàng.")}</div>
            <div className="cta-sub">{t("Trợ lý chỉ điền sẵn thông tin. Bạn kiểm tra và tự bấm \"Đặt hàng\" trên từng trang chính chủ.")}</div>
          </div>
        </div>
      </div>
    );
  }

  // ── BƯỚC 2: TÀI KHOẢN — thẻ câu hỏi hiện Ở CỘT PHẢI của màn 2 cột ──
  const gateAccount = (
    <div className="cbz-gate gate-in" key="gate-account">
      {startStep === "form" && <button className="cbz-back" onClick={() => setStep("form")}>← {t("Quay lại")}</button>}
            <div className="eyebrow">{t("Đặt hàng cùng trợ lý Affree")}</div>
            <h3>{t("Bạn muốn đặt bằng tài khoản nào?")}</h3>
            <p className="cbz-gate-sub">
              {stores.length > 1
                ? t("Đây là lựa chọn MẶC ĐỊNH cho cả {n} cửa hàng. Vào phiên, bạn có thể đổi riêng từng cửa hàng.", { n: stores.length })
                : t("Trợ lý sẽ điền sẵn thông tin và mở trang đặt hàng của cửa hàng. Bạn tự bấm nút Đặt hàng.")}
            </p>
            <button className={`cbz-acc ${defaultMode === "affree" ? "on" : ""}`} onClick={() => setDefaultMode("affree")}>
              <span className="ic"><Logo size={24} /></span>
              <span className="tx">
                <b>{t("Dùng tài khoản Affree")} <em className="cbz-badge-def">{t("Mặc định")}</em></b>
                <span>{t("Affree đặt hộ trên trang cửa hàng. Không cần nhớ mật khẩu cửa hàng — lỡ quên vẫn không bị văng khỏi Affree.")}</span>
              </span>
            </button>
            <button className={`cbz-acc ${defaultMode === "self" ? "on" : ""}`} onClick={() => setDefaultMode("self")}>
              <span className="ic">👤</span>
              <span className="tx">
                <b>{t("Dùng tài khoản của tôi")}</b>
                <span>
                  {stores.length > 1
                    ? t("Mỗi cửa hàng bạn tự đăng nhập trong phiên của cửa hàng đó. Affree không lưu mật khẩu.")
                    : t("Bạn tự đăng nhập tài khoản cửa hàng ngay trong phiên. Affree không lưu mật khẩu.")}
                </span>
              </span>
            </button>
      <button className="cbz-gate-cta" onClick={confirmAccount}>{t("Tiếp tục")} →</button>
      <div className="cta-sub" style={{ marginTop: 8 }}>{t("Trợ lý chỉ điền sẵn thông tin. Bạn kiểm tra và tự bấm \"Đặt hàng\" trên từng trang chính chủ.")}</div>
    </div>
  );

  // ── BƯỚC 2b: XIN PHÉP (consent) — thẻ câu hỏi kế tiếp Ở CỘT PHẢI ──
  const storeNames = Array.from(new Set(stores.map((s) => s.name))).join(" · ");
  const gateConsent = (
    <div className="cbz-gate gate-in" key="gate-consent" style={{ maxWidth: 560 }}>
      <button className="cbz-back" onClick={() => setStep("account")}>← {t("Quay lại")}</button>
            <div className="eyebrow">{t("Trước khi bắt đầu · Quyền riêng tư của bạn")}</div>
            <h3>{t("Cho phép trợ lý điền thông tin giúp bạn?")}</h3>
            <p className="cbz-gate-sub">
              {t("Để đặt hàng nhanh trên {n} cửa hàng, Affree cần sự đồng ý của bạn cho các hoạt động dưới đây (theo Luật Bảo vệ dữ liệu cá nhân). Bạn có thể rút lại sự đồng ý bất cứ lúc nào trong phần Cài đặt.", { n: stores.length })}
            </p>

            {[
              {
                b: t("Chia sẻ thông tin giao hàng sang trang nhà bán"),
                s: t("Họ tên, số điện thoại và địa chỉ trong đơn nháp sẽ được điền sẵn vào form của {stores} — chỉ cho đơn hàng này, không dùng cho mục đích khác.", { stores: storeNames }),
              },
              {
                b: t("Phiên duyệt được truyền qua máy chủ Affree"),
                s: t("Màn hình trang nhà bán được stream qua hạ tầng Affree. Chúng tôi KHÔNG ghi lại nội dung phiên; các trường nhạy cảm (SĐT, địa chỉ, thanh toán) được che trong nhật ký hệ thống."),
              },
              {
                b: t("Tôi sẽ kiểm tra thông tin trước khi Đặt hàng"),
                s: t("Trợ lý chỉ điền sẵn. Tôi có trách nhiệm xem lại sản phẩm, số lượng, địa chỉ và tự bấm nút \"Đặt hàng\" trên trang chính chủ của nhà bán."),
              },
            ].map((c, i) => (
              <label className={`cbz-consent ${consents[i] ? "on" : ""}`} key={i}>
                <input
                  type="checkbox"
                  checked={consents[i]}
                  onChange={(e) => setConsents((prev) => prev.map((v, k) => (k === i ? e.target.checked : v)))}
                />
                <span className="tx"><b>{c.b}</b><span>{c.s}</span></span>
              </label>
            ))}

      <div className="cbz-consent-foot">
        <div className="links">
          {t("Xem")} <a href="#" onClick={(e) => e.preventDefault()}>{t("Chính sách quyền riêng tư")}</a> · <a href="#" onClick={(e) => e.preventDefault()}>{t("Điều khoản sử dụng")}</a>
        </div>
        <button className="btn-ghost" onClick={() => setStep("account")}>{t("Để sau")}</button>
        <button className="cbz-gate-cta" style={{ width: "auto", marginTop: 0, padding: "11px 18px" }} disabled={!allConsented} onClick={confirmConsent}>
          {t("Đồng ý & bắt đầu")}
        </button>
      </div>
    </div>
  );

  // ── BƯỚC 2/2b/3: màn 2 CỘT — trái = đơn nháp (trượt vào), phải = câu hỏi → trang cửa hàng ──
  const inGate = step === "account" || step === "consent";
  return (
    <div className="cbz cbz-full" role="dialog" aria-modal="true" style={{ paddingTop: headerOffset }}>
      <Style />
      {Header}
      <div className="app" ref={appRef} onScroll={onAppScroll}>
        {/* TRÁI: đơn nháp / recap (đồng bộ với web) — hiệu ứng "đẩy" từ giữa qua trái */}
        <div className="panel panel-slide">
          <h2>{t("Đơn hàng")} — {orderTitle} <small>· {t("đơn nháp")}</small></h2>
          {infoFields}
          <div className="sec">
            <div className="sec-label">{t("Cửa hàng trong đơn")}</div>
            {storeList(!inGate)}
          </div>
          {!inGate && (
            <div className="sec">
              <div className="pay-note" style={{ marginTop: 0 }}>
                💳 {t("Thanh toán")}: <b>{defaultPay === "card" ? t("Thẻ") : defaultPay === "cod" ? "COD" : t("QR chuyển khoản")}</b> — {t("Bạn chọn và thực hiện thanh toán trên website của từng siêu thị. Affree không thu thập thông tin thanh toán.")}
              </div>
            </div>
          )}
          <div className="total-row"><span className="lbl">{t("Tổng cộng")}</span><span className="amt">{money(grandTotal)}</span></div>
          <div className="cta-sub" style={{ paddingTop: 12 }}>
            {inGate
              ? t("Trả lời câu hỏi ở khung bên phải để bắt đầu phiên đặt hàng.")
              : t("Chỉnh số lượng / thêm SP / mã KM ở khung bên phải — đơn bên trái tự cập nhật.")}
          </div>
        </div>

        {/* PHẢI: câu hỏi (tài khoản → xin phép) rồi tới trang cửa hàng TƯƠNG TÁC */}
        {inGate ? (
          <div className="session-area">
            <div className="gate-wrap">{step === "account" ? gateAccount : gateConsent}</div>
          </div>
        ) : (
        <div className="session-area sess-in">
          <div className="tabs">
            {stores.map((st, i) => {
              const s = status[i];
              return (
                <button
                  key={st.key}
                  className={`tab ${i === active ? "active" : ""} ${s === "filling" || s === "review" || s === "login" ? "live" : ""} ${s === "placed" ? "done" : ""}`}
                  onClick={() => openStore(i)}
                >
                  <span className="dot" />{modes[i] === "self" ? "👤 " : ""}{st.name}
                  <span style={{ fontWeight: 500, opacity: 0.7 }}> — {opening === i ? t("Đang mở…") : s === "placed" ? "✓ " + t("Đã đặt") : s === "idle" ? t("Chờ") : s === "login" ? t("Đăng nhập") : s === "filling" ? t("Đang điền…") : t("Chờ xác nhận")}</span>
                </button>
              );
            })}
          </div>

          {/* Chưa mở phiên nào → ghi chú giải thích ở khung phải (theo prototype). */}
          {active < 0 && (
            <div className="session-empty">
              <div className="ic">🖥️</div>
              <h4>{t("Chưa có phiên đặt hàng nào")}</h4>
              <p>{t("Affree sẽ mở phiên trình duyệt an toàn tới từng siêu thị, điền sẵn thông tin giao hàng từ đơn nháp — và chờ bạn xác nhận.")}</p>
            </div>
          )}
          {/* Đang chuẩn bị mở trang đích: logo cửa hàng + vòng xoay + thanh tiến trình,
              cùng phong cách khung "chưa có phiên" — hết loading thì trang cửa hàng hiện ra. */}
          {active >= 0 && opening === active && (
            <div className="session-opening" key={`opening-${stores[active].key}`}>
              <div className="op-logo">
                {stores[active].chain ? (
                  <ChainBadge chain={stores[active].chain as Chain} size={40} />
                ) : (
                  <div className="store-dot" style={{ background: stores[active].color, width: 40, height: 40, fontSize: 18 }}>
                    {stores[active].icon || stores[active].name[0] || "•"}
                  </div>
                )}
                <span className="op-ring" />
              </div>
              <h4>{t("Đang mở trang {store}…", { store: stores[active].name })}</h4>
              <p>{t("Kết nối phiên trình duyệt an toàn tới trang chính chủ — thông tin giao hàng sẽ được điền sẵn từ đơn nháp.")}</p>
              <div className="op-bar"><i /></div>
            </div>
          )}
          {active >= 0 && opening !== active && (
            <StoreBrowser
              key={stores[active].key}
              st={stores[active]}
              idx={active}
              status={status[active]}
              mode={modes[active]}
              typed={typed}
              cust={cust}
              cart={carts[active] ?? []}
              pay={pays[active] ?? defaultPay ?? "qr"}
              promo={promos[active]}
              slotValue={slotOf(active)}
              onSetSlot={(v) => setSlots((prev) => ({ ...prev, [active]: v }))}
              subtotal={subtotal(active)}
              discount={Math.round(subtotal(active) * discountRate(active))}
              total={storeTotal(active)}
              allowSuggest={allowSuggest}
              money={money}
              t={t}
              onSetMode={(m) => setStoreMode(active, m)}
              onLogin={() => confirmLogin(active)}
              onQty={(idx, d) => changeQty(active, idx, d)}
              onAdd={(sug) => addLine(active, sug)}
              onSelectPromo={(code) =>
                setPromos((prev) =>
                  prev.map((p, pi) => (pi === active ? (code && PROMOS[code] ? code : null) : p)),
                )
              }
              cardLabel={cardLabel}
              code={codes[stores[active].key]}
              onEditField={(src, v) => (src === "name" ? setName(v) : src === "phone" ? setPhone(v) : setAddress(v))}
              onSetPay={(m) => setPays((prev) => prev.map((x, k) => (k === active ? m : x)))}
              qrActive={qrFor === active}
              qrPaid={qrPaid}
              onQrLater={() => setQrFor(null)}
              onPlace={() => handlePlace(active)}
              onNext={() => { const n = status.findIndex((s) => s !== "placed"); if (n >= 0) openStore(n); }}
              nextName={(() => { const n = status.findIndex((s) => s !== "placed"); return n >= 0 ? stores[n].name : ""; })()}
            />
          )}

          {/* All-done card — theo prototype: nằm DƯỚI khung web, không che màn 2 cột. */}
          {allPlaced && (
            <div className="done-card">
              <div style={{ fontSize: 34 }}>🎉</div>
              <h3>{t("Hoàn tất — {n}/{n} đơn đã được bạn xác nhận", { n: stores.length })}</h3>
              <p>{t("Tổng giá trị {amt} trên {n} cửa hàng. Mọi đơn đều do bạn tự bấm \"Đặt hàng\" trên website chính chủ. Affree đã đóng toàn bộ phiên duyệt và không lưu nội dung phiên.", { amt: money(grandTotal), n: stores.length })}</p>
              <div className="row">
                <div className="pill"><span className="ok">✓</span> {t("Đồng ý dữ liệu đã ghi nhận — có thể rút trong Cài đặt")}</div>
                <div className="pill"><span className="ok">✓</span> {t("Không ghi log nội dung phiên, trường nhạy cảm được che")}</div>
                <div className="pill"><span className="ok">✓</span> {t("Thanh toán thực hiện tại nhà bán")}</div>
              </div>
              <button className="done-close" onClick={onClose}>{t("Xong — về Affree")}</button>
            </div>
          )}
        </div>
        )}
      </div>

      {/* Mobile: chỉ báo 2 trang vuốt ngang — CSS ẩn trên desktop. */}
      <div className="pane-dots" role="tablist">
        <button className={mobilePane === 0 ? "on" : ""} onClick={() => scrollToPane(0)}>
          <span className="dot" />{t("Đơn hàng")}
        </button>
        <button className={mobilePane === 1 ? "on" : ""} onClick={() => scrollToPane(1)}>
          <span className="dot" />{inGate ? t("Câu hỏi") : t("Cửa hàng")}
        </button>
      </div>

    </div>
  );
}

// ─── Trang cửa hàng mô phỏng (TƯƠNG TÁC) ───────────────────────
function StoreBrowser({
  st, idx, status, mode, typed, cust, cart, pay, promo, slotValue, subtotal, discount, total, allowSuggest,
  cardLabel, code, money, t, onSetMode, onLogin, onQty, onAdd, onSelectPromo, onSetSlot, onSetPay, onPlace, onNext, nextName,
  onEditField, qrActive, qrPaid, onQrLater,
}: {
  st: CobrowseStore;
  idx: number;
  status: Status;
  mode: AccountMode;
  typed: Record<string, string>;
  cust: CobrowseBuyer;
  cart: Line[];
  pay: PayMethod;
  promo: string | null;
  slotValue: string;
  subtotal: number;
  discount: number;
  total: number;
  allowSuggest: boolean;
  cardLabel?: string;
  code?: string;
  money: (n: number, c?: string) => string;
  t: (vi: string, vars?: Record<string, string | number>) => string;
  onSetMode: (m: AccountMode) => void;
  onLogin: () => void;
  onQty: (idx: number, delta: number) => void;
  onAdd: (sug: CobrowseSuggestion) => void;
  onSelectPromo: (code: string) => void;
  onSetSlot: (v: string) => void;
  onEditField: (src: "name" | "phone" | "address", v: string) => void;
  onSetPay: (m: PayMethod) => void;
  /* QR thanh toán hiện NGAY TRONG trang cửa hàng (không popup) khi bấm Đặt hàng với QR. */
  qrActive: boolean;
  qrPaid: boolean;
  onQrLater: () => void;
  onPlace: () => void;
  onNext: () => void;
  nextName: string;
}) {
  const reviewing = status === "review" || status === "placed";
  const lockedMode = status === "filling" || status === "review" || status === "placed";
  const editable = status === "filling" || status === "review"; // cho chỉnh giỏ khi phiên đang mở
  // Gợi ý mua thêm: ƯU TIÊN sản phẩm thật của cửa hàng (st.suggestions); trống → demo (chỉ VND).
  const realSuggest = Boolean(st.suggestions && st.suggestions.length);
  const suggPool: CobrowseSuggestion[] = realSuggest ? st.suggestions! : (allowSuggest ? SUGGESTIONS : []);
  const suggestable = suggPool.filter((s) => !cart.some((c) => c.name === s.name));
  // Ô TÌM KIẾM sản phẩm của cửa hàng (mua thêm bất kỳ món nào trong kho suggPool).
  const [searchQ, setSearchQ] = useState("");
  const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const searchResults = searchQ.trim()
    ? suggPool.filter((s) => norm(s.name).includes(norm(searchQ.trim()))).slice(0, 6)
    : suggestable.slice(0, 4);
  return (
    <div className="browser">
      <div className="chrome">
        <div className="dots"><i /><i /><i /></div>
        <div className="urlbar"><span className="lock">🔒</span> https://{st.domain || "www.cua-hang.vn/checkout"}</div>
        <div className="acc-toggle" title={lockedMode ? t("Đang xử lý — không đổi được") : t("Chọn tài khoản cho cửa hàng này")}>
          <button className={mode === "affree" ? "on" : ""} disabled={lockedMode} onClick={() => onSetMode("affree")}><Logo size={13} /> Affree</button>
          <button className={mode === "self" ? "on" : ""} disabled={lockedMode} onClick={() => onSetMode("self")}>👤 {t("Của tôi")}</button>
        </div>
      </div>

      <div className="botline">
        <div className="bot-ic">🤖</div>
        <div className="txt">
          {status === "login"
            ? <>🔐 {t("Đăng nhập tài khoản {store} của bạn để tiếp tục.", { store: st.name })}</>
            : status === "filling"
              ? t("Trợ lý đang điền thông tin & chọn thanh toán…")
              : status === "review"
                ? <>✅ {t("Đã điền xong.")} <b>{t("Đến lượt bạn:")}</b> {t("chỉnh giỏ nếu muốn rồi bấm \"Đặt hàng\".")}</>
                : status === "placed"
                  ? <>✓ {t("Đã đặt hàng tại {store}.", { store: st.name })}</>
                  : <>{mode === "affree" ? t("Affree dùng tài khoản đặt hộ — kết nối tới {store}…", { store: st.name }) : t("Kết nối tới {store}…", { store: st.name })}</>}
        </div>
      </div>

      {status === "review" && (
        <div className="review-banner">
          <span className="ic">⚠️</span>
          <div><b>{t("Kiểm tra kỹ trước khi Đặt hàng.")}</b> {t("Bạn có thể đổi số lượng, thêm sản phẩm, nhập mã khuyến mãi ngay trên trang này — đơn Affree cập nhật theo. Bạn là người xác nhận đơn với {store}.", { store: st.name })}</div>
        </div>
      )}

      <div className={`storepage ${st.skin ? `skin-${st.skin}` : ""}`}>
        {/* Header theo NHẬN DIỆN THẬT của chuỗi (mock từ web thật) */}
        {st.skin === "bhx" ? (
          <>
            <div className="sk-bhx-top">
              <div className="logo">Bách hoá <b>XANH</b></div>
              <div className="search">🔍 {t("Bạn tìm gì hôm nay?")}</div>
              <div className="deliver">📍 {t("Giao đến")}: <b>{cust.address || "—"}</b></div>
            </div>
            <div className="sk-bhx-sub">
              <span>☰ {t("DANH MỤC SẢN PHẨM")}</span>
              <span>👤 {t("Tài khoản")} · 🛒 {cart.length}</span>
            </div>
          </>
        ) : st.skin === "coop" ? (
          <>
            <div className="sk-coop-banner">🛒 MUA NHANH – GIAO NHANH – AN TÂM MỖI NGÀY</div>
            <div className="sk-coop-head">
              <div className="logo"><span className="c">ⓒ</span>coop <b>online</b></div>
              <span className="menu">☰ {t("Danh mục sản phẩm")}</span>
              <div className="search">{t("Bạn muốn mua gì hôm nay…")} 🔍</div>
              <div className="store">🏬 {st.branch || st.name}</div>
            </div>
            <div className="sk-coop-crumb">{t("Trang chủ")} / <b>{t("Giỏ hàng")} ({cart.length})</b></div>
          </>
        ) : (
          <div className="store-topbar" style={{ background: st.color }}>
            <span>{st.icon} {st.name}</span>
            {st.branch && <span style={{ fontWeight: 500, fontSize: 12, opacity: 0.9 }}>· {st.branch}</span>}
            <span className="cartic">{t("Giỏ")} ({cart.length})</span>
          </div>
        )}

        {status === "login" ? (
          <div className="login-wrap">
            <div className="login-card">
              <h3>🔐 {t("Đăng nhập {store}", { store: st.name })}</h3>
              <p className="login-note">{t("Bạn tự đăng nhập tài khoản của mình. Affree không nhìn thấy và không lưu mật khẩu.")}</p>
              <div className="f"><label>{t("Số điện thoại / Email")}</label><input placeholder={t("Tài khoản của bạn tại {store}", { store: st.name })} /></div>
              <div className="f"><label>{t("Mật khẩu")}</label><input type="password" placeholder="••••••••" /></div>
              <button className="order-btn" style={{ background: st.color }} onClick={onLogin}>{t("Tôi đã đăng nhập → tiếp tục")}</button>
              <div className="login-alt">
                {t("Không có tài khoản {store}?", { store: st.name })}{" "}
                <button className="link" onClick={() => onSetMode("affree")}>{t("Dùng tài khoản Affree đặt hộ")}</button>
              </div>
            </div>
          </div>
        ) : (
          <div className="store-body">
            <div className="form-card">
              <h3>{t("Thông tin nhận hàng")}</h3>
              {st.fields.map((f, fi) => {
                const key = `${idx}-${fi}`;
                const full = f.slot ? slotValue : (f.fixed || (f.src ? cust[f.src] : ""));
                const val = reviewing ? full : (typed[key] ?? "");
                const filling = status === "filling" && typed[key] !== undefined && val.length < full.length;
                // Khung giờ giao: tới lượt user (review) → cho chọn bằng dropdown.
                if (f.slot && status === "review") {
                  const opts = SLOTS.includes(slotValue) ? SLOTS : [slotValue, ...SLOTS];
                  return (
                    <div className="f" key={fi}>
                      <label>{f.label}</label>
                      <select className="slot-select" value={slotValue} onChange={(e) => onSetSlot(e.target.value)}>
                        {opts.map((s) => <option key={s} value={s}>{t(s)}</option>)}
                      </select>
                    </div>
                  );
                }
                // Tên/SĐT/địa chỉ: tới lượt user (review) → cho sửa trực tiếp, đồng bộ về đơn bên trái + hồ sơ.
                if (f.src && status === "review") {
                  return (
                    <div className="f" key={fi}>
                      <label>{f.label}</label>
                      <input value={cust[f.src]} className="filled" onChange={(e) => onEditField(f.src!, e.target.value)} />
                      {f.sensitive && <span className="sens" title={t("Che trong nhật ký phiên")}>🛡</span>}
                    </div>
                  );
                }
                return (
                  <div className="f" key={fi}>
                    <label>{f.label}</label>
                    <input readOnly value={f.slot && reviewing ? t(val) : val} className={reviewing ? "filled" : filling ? "filling" : ""} />
                    {f.sensitive && <span className="sens" title={t("Che trong nhật ký phiên")}>🛡</span>}
                  </div>
                );
              })}
              <div className="masknote">🛡 {t("Trang này hiển thị qua phiên mô phỏng của Affree. Affree không ghi lại và che các trường nhạy cảm.")}</div>
            </div>

            <div className="sum-card">
              <h3>{t("Đơn hàng")}</h3>
              {/* Sản phẩm — chỉnh số lượng */}
              {cart.map((p, pi) => (
                <div className="prod" key={pi}>
                  <div className="thumb">{p.image ? <img src={p.image} alt="" /> : (p.emoji || "🛍️")}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="nm">{p.name}</div>
                    <div style={{ fontSize: 11.5, color: "var(--ink-soft)" }}>{money(p.unitPrice, st.currency)}</div>
                  </div>
                  <div className="qtybox">
                    <button disabled={!editable} onClick={() => onQty(pi, -1)}>−</button>
                    <span>{p.qty}</span>
                    <button disabled={!editable} onClick={() => onQty(pi, 1)}>+</button>
                  </div>
                  <div className="pr">{money(p.unitPrice * p.qty, st.currency)}</div>
                </div>
              ))}

              {/* Mua thêm — TÌM KIẾM trong kho sản phẩm thật của cửa hàng + gợi ý sẵn */}
              {editable && suggPool.length > 0 && (
                <div className="suggest">
                  <div className="suggest-lbl">{searchQ.trim() ? t("Kết quả tìm kiếm") : t("Gợi ý mua thêm")} {!realSuggest && <span className="demo">demo</span>}</div>
                  <input
                    className="suggest-search"
                    value={searchQ}
                    onChange={(e) => setSearchQ(e.target.value)}
                    placeholder={"🔍 " + t("Tìm sản phẩm của {store} để mua thêm…", { store: st.name })}
                  />
                  {searchResults.map((s) => (
                    <button key={s.name} className="suggest-item" onClick={() => onAdd(s)}>
                      <span className="s-nm">
                        {s.image ? <img src={s.image} alt="" /> : <span className="s-emo">{s.emoji || "🛍️"}</span>}
                        <span className="s-txt">{s.name}</span>
                      </span>
                      <span className="add">+ {money(s.price, st.currency)}</span>
                    </button>
                  ))}
                  {searchQ.trim() && searchResults.length === 0 && (
                    <div className="suggest-empty">{t("Không tìm thấy \"{q}\" tại {store}.", { q: searchQ.trim(), store: st.name })}</div>
                  )}
                </div>
              )}

              {/* Mã khuyến mãi — xổ danh sách để chọn */}
              <div className="promo">
                <select
                  className="promo-select"
                  value={promo || ""}
                  disabled={!editable}
                  onChange={(e) => onSelectPromo(e.target.value)}
                >
                  <option value="">{t("Chọn mã khuyến mãi…")}</option>
                  {PROMO_OPTIONS.map((o) => (
                    <option key={o.code} value={o.code}>
                      {t("{code} — giảm {pct}%", { code: o.code, pct: o.pct })}
                    </option>
                  ))}
                </select>
              </div>

              <div className="sum-line"><span>{t("Tạm tính")}</span><span>{money(subtotal, st.currency)}</span></div>
              {discount > 0 && (
                <div className="sum-line" style={{ color: "#1E7A33" }}><span>{t("Giảm")} ({promo})</span><span>− {money(discount, st.currency)}</span></div>
              )}
              <div className="sum-line"><span>{t("Phí giao")}</span><span>{st.ship ? money(st.ship, st.currency) : t("Miễn phí")}</span></div>
              <div className="sum-line total"><span>{t("Tổng thanh toán")}</span><span className="v">{money(total, st.currency)}</span></div>

              {/* Thanh toán — TRỢ LÝ TỰ CHỌN (đổi được) */}
              <div className="payauto">
                <div className="payauto-lbl">🤖 {t("Trợ lý đã chọn thanh toán")} <span className="hint">({t("bạn đổi được")})</span></div>
                <div className="payauto-tabs">
                  {(["qr", "card", "cod"] as PayMethod[]).map((m) => (
                    <button key={m} disabled={!editable} className={pay === m ? "on" : ""} onClick={() => onSetPay(m)}>
                      {m === "qr" ? "📱 QR" : m === "card" ? "💳 " + t("Thẻ") : "💵 COD"}
                    </button>
                  ))}
                </div>
                {/* Tài khoản Affree: QR hiện Ở AFFREE; Thẻ dùng thẻ đã nhập ở Affree đưa qua web. */}
                {mode === "affree" && pay === "qr" && (
                  <p className="payauto-note">📱 {t("Bấm \"Đặt hàng\" xong, mã QR sẽ hiện Ở AFFREE — bạn quét và xác nhận đã thanh toán.")}</p>
                )}
                {mode === "affree" && pay === "card" && (
                  <p className="payauto-note ok">💳 {cardLabel ? t("Trợ lý dùng thẻ {card} đã nhập ở Affree, tự điền qua trang cửa hàng.", { card: cardLabel }) : t("Trợ lý dùng thẻ đã nhập ở Affree, tự điền qua trang cửa hàng.")}</p>
                )}
                {mode === "self" && (
                  <p className="payauto-note">{t("Bạn tự hoàn tất thanh toán trên trang cửa hàng bằng tài khoản của mình.")}</p>
                )}
              </div>

              <button className="order-btn" style={{ background: st.color }} disabled={status !== "review" || qrActive} onClick={onPlace}>
                {qrActive ? "📱 " + t("Đang chờ chuyển khoản…") : status === "review" ? "🛒 " + t("Đặt hàng") + " — " + money(total, st.currency) : status === "placed" ? "✓ " + t("Đã đặt hàng") : t("Đặt hàng (chờ điền xong)")}
              </button>

              {/* QR thanh toán hiện TRỰC TIẾP tại đây (không popup) sau khi bấm Đặt hàng. */}
              {qrActive && (
                <div className="qr-inline">
                  <div className="qr-brand">af<em>free</em>.vn · {t("Thanh toán qua Affree")}</div>
                  <h4>{t("Quét QR để thanh toán")}</h4>
                  <p className="qr-sub">{st.name} · <b>{money(total, st.currency)}</b></p>
                  <div className="qr-box">
                    <QRCode value={`AFFREE-PAY|${st.key}|${total}`} size={132} />
                  </div>
                  <p className="qr-note">🛡 {t("Bạn thanh toán qua QR của Affree; Affree chuyển khoản cho cửa hàng. Không lưu thông tin thanh toán.")}</p>
                  {qrPaid ? (
                    <div className="qr-status ok">✓ {t("Đã nhận thanh toán — đang chốt đơn…")}</div>
                  ) : (
                    <div className="qr-status"><span className="spin" /> {t("Đang chờ chuyển khoản… Hệ thống tự ghi nhận ngay khi nhận được tiền — không cần bấm gì.")}</div>
                  )}
                  {!qrPaid && <button className="qr-later" onClick={onQrLater}>{t("Để sau")}</button>}
                </div>
              )}
              <div style={{ fontSize: 10.5, color: "var(--ink-soft)", marginTop: 8, lineHeight: 1.5, textAlign: "center" }}>
                {t("Nút này thuộc trang {store}. Đơn xác lập trực tiếp giữa bạn và {store}.", { store: st.name })}
              </div>
            </div>
          </div>
        )}

        {st.skin === "coop" && (
          <div className="sk-coop-foot">
            <span>{t("VỀ CO.OP ONLINE")}</span><span>{t("CHÍNH SÁCH & ĐIỀU KHOẢN")}</span><span>{t("KẾT NỐI VỚI CO.OP ONLINE")}</span><span>{t("THÔNG TIN LIÊN HỆ")}</span>
          </div>
        )}

        {status === "placed" && (
          <div className="placed">
            <div className="check">✓</div>
            <h4>{t("Đặt hàng thành công tại {store}", { store: st.name })}</h4>
            <p>
              {code && <>{t("Mã đơn")} <b style={{ fontFamily: "var(--mono)" }}>{code}</b> · </>}
              {st.branch || st.name}. {t("Cửa hàng sẽ liên hệ và giao theo khung giờ bạn chọn. Phiên duyệt này đã được đóng và không lưu lại nội dung.")}
            </p>
            {nextName && <button onClick={onNext}>{t("Tiếp tục cửa hàng kế")} → {nextName}</button>}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── CSS (namespaced .cbz) ────────────────────────────────────
function Style() {
  return (
    <style>{`
.cbz{--ink:#14201F;--ink-soft:#4A5A58;--paper:#F7F8F6;--card:#fff;--line:#E3E8E4;--brand:#0E7C6B;--brand-deep:#0A5A4E;--amber:#F5A623;--amber-soft:#FFF4DE;--red:#D64545;--mono:'IBM Plex Mono',ui-monospace,monospace;position:fixed;inset:0;z-index:2000;background:var(--paper);color:var(--ink);font-size:14px;display:flex;flex-direction:column;overflow:hidden;-webkit-overflow-scrolling:touch}
.cbz *{box-sizing:border-box}
.cbz button{cursor:pointer;font:inherit}
.cbz input{font:inherit}
.cbz-center{flex:1;min-height:0;overflow-y:auto;display:flex;justify-content:center;align-items:flex-start;padding:22px 18px 40px}
.cbz-gate{position:relative;background:#fff;border-radius:18px;max-width:460px;width:100%;padding:26px 24px;box-shadow:0 12px 40px rgba(20,32,31,.08);border:1px solid var(--line)}
.cbz-gate .eyebrow{font-size:10.5px;font-weight:800;letter-spacing:1px;text-transform:uppercase;color:var(--brand)}
.cbz-gate h3{font-size:19px;margin:6px 0 6px}
.cbz-gate-sub{font-size:13px;color:var(--ink-soft);line-height:1.6;margin-bottom:16px}
.cbz-back{border:none;background:none;color:var(--ink-soft);font-size:12px;font-weight:600;padding:0 0 10px}
.cbz-acc{display:flex;gap:12px;width:100%;text-align:left;border:2px solid var(--line);background:#fff;border-radius:13px;padding:14px;margin-bottom:11px;transition:.15s}
.cbz-acc.on{border-color:var(--brand);background:#F3FAF8}
.cbz-acc .ic{font-size:22px;flex:none;display:inline-flex;align-items:center}
.cbz-acc .tx b{display:flex;align-items:center;gap:8px;font-size:14px;margin-bottom:3px}
.cbz-acc .tx span{font-size:12px;color:var(--ink-soft);line-height:1.55;display:block}
.cbz-badge-def{font-style:normal;font-size:10px;font-weight:700;background:var(--brand);color:#fff;border-radius:20px;padding:2px 8px}
.cbz-gate-cta{width:100%;margin-top:6px;background:var(--brand);color:#fff;border:none;border-radius:11px;padding:13px;font-size:14px;font-weight:700}
.cbz-gate-cta:hover{background:var(--brand-deep)}
.cbz-gate-cta:disabled{background:#B9CCC7;cursor:default}
/* consent (theo prototype) */
.cbz-consent{display:flex;gap:12px;border:1px solid var(--line);border-radius:11px;padding:13px;margin-bottom:10px;cursor:pointer;transition:border-color .15s,background .15s}
.cbz-consent.on{border-color:var(--brand);background:#F3FAF8}
.cbz-consent input{margin-top:2px;width:16px;height:16px;accent-color:var(--brand);flex:none;cursor:pointer}
.cbz-consent .tx b{display:block;font-size:13px;margin-bottom:3px}
.cbz-consent .tx span{font-size:12px;color:var(--ink-soft);line-height:1.55;display:block}
.cbz-consent-foot{display:flex;gap:10px;align-items:center;margin-top:4px}
.cbz-consent-foot .links{font-size:11.5px;color:var(--ink-soft);flex:1;line-height:1.5}
.cbz-consent-foot .links a{color:var(--brand);font-weight:600;text-decoration:none}
.cbz .btn-ghost{border:1px solid var(--line);background:#fff;border-radius:9px;padding:11px 16px;font-weight:600;font-size:13px;color:var(--ink-soft)}
.cbz-x{background:none;border:none;color:var(--ink-soft);font-size:22px;line-height:1;padding:0 4px;cursor:pointer;flex:none;opacity:.65;transition:opacity .15s}
.cbz-x:hover{opacity:1;color:var(--ink)}
/* Dải "Miễn trừ": nền sáng tông thương hiệu (bỏ khối đen), icon ⓘ, chữ dịu mắt.
   Mobile: rút gọn còn 2 dòng (…) — chạm vào chữ để xem đủ / thu lại. */
.cbz .disclaimer-strip{background:linear-gradient(90deg,#EEF7F4,#F8FBFA);border-bottom:1px solid var(--line);color:var(--ink-soft);font-size:11.5px;padding:9px 18px;line-height:1.55;display:flex;align-items:center;gap:10px}
.cbz .disclaimer-strip .d-ic{flex:none;width:17px;height:17px;border-radius:50%;background:var(--brand);color:#fff;font-size:11px;font-weight:800;font-style:italic;font-family:Georgia,'Times New Roman',serif;display:flex;align-items:center;justify-content:center;user-select:none}
.cbz .disclaimer-strip .disclaimer-text{flex:1}
.cbz .disclaimer-strip b{color:var(--brand-deep)}
@media(max-width:900px){
.cbz .disclaimer-strip{padding:8px 14px;font-size:11px;line-height:1.5}
.cbz .disclaimer-strip .disclaimer-text{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;cursor:pointer}
.cbz .disclaimer-strip .disclaimer-text.open{display:block;overflow:visible}
}
.cbz .app{flex:1;min-height:0;width:100%;display:grid;grid-template-columns:340px 1fr;grid-template-rows:minmax(0,1fr);gap:16px;padding:16px 18px;max-width:1440px;margin:0 auto}
.cbz .app>.panel{overflow-y:auto;min-height:0;align-self:start;max-height:100%}
.cbz .pane-dots{display:none}
@media(max-width:900px){
.cbz .app{display:flex;grid-template-columns:none;gap:12px;padding:12px 14px;overflow-x:auto;overflow-y:hidden;scroll-snap-type:x mandatory;-webkit-overflow-scrolling:touch;scrollbar-width:none}
.cbz .app::-webkit-scrollbar{display:none}
.cbz .app>.panel,.cbz .app>.session-area{flex:0 0 100%;min-width:0;scroll-snap-align:center;scroll-snap-stop:always;max-height:100%;overflow-y:auto}
.cbz .pane-dots{display:flex;justify-content:center;gap:8px;padding:8px 0 12px;background:var(--paper)}
.cbz .pane-dots button{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--line);background:#fff;border-radius:999px;padding:6px 14px;font-size:12px;font-weight:600;color:var(--ink-soft)}
.cbz .pane-dots button .dot{width:7px;height:7px;border-radius:50%;background:var(--line)}
.cbz .pane-dots button.on{border-color:var(--brand);color:var(--brand-deep);background:#EAF5F2}
.cbz .pane-dots button.on .dot{background:var(--brand)}
}
.cbz .panel{background:var(--card);border:1px solid var(--line);border-radius:14px;overflow:hidden}
.cbz .panel h2{font-size:13px;font-weight:700;padding:14px 16px 10px}
.cbz .panel h2 small{font-weight:500;color:var(--ink-soft)}
.cbz .sec{padding:0 16px 14px}
.cbz .sec-label{font-size:10.5px;font-weight:700;letter-spacing:.8px;text-transform:uppercase;color:var(--ink-soft);margin:10px 0 8px}
.cbz .field{margin-bottom:10px}
.cbz .field label{display:block;font-size:11.5px;color:var(--ink-soft);margin-bottom:4px;font-weight:500}
.cbz .field .shield{color:var(--brand);cursor:help}
.cbz .field input{width:100%;border:1px solid var(--line);border-radius:8px;padding:8px 10px;font-size:13px;background:#FBFCFB}
.cbz .store-block{border:1px solid var(--line);border-radius:10px;padding:12px;margin-bottom:10px}
.cbz .store-head{display:flex;align-items:center;gap:8px;margin-bottom:8px}
.cbz .store-dot{width:22px;height:22px;border-radius:6px;display:flex;align-items:center;justify-content:center;color:#fff;font-size:11px;font-weight:800;flex:none}
.cbz .store-head .nm{font-size:12.5px;font-weight:700}
.cbz .store-head .sub{font-size:11px;color:var(--ink-soft)}
.cbz .store-head .sub-total{font-size:11.5px;font-weight:700;color:var(--ink);margin-top:1px}
.cbz .store-total-row{border-top:1px solid var(--line);margin-top:6px;padding-top:6px;font-weight:700}
.cbz .store-total-row .price{font-weight:800}
.cbz .acc-mini{font-size:14px;flex:none;display:inline-flex;align-items:center}
.cbz .item{display:flex;gap:8px;align-items:flex-start;font-size:12.5px;margin-top:5px}
.cbz .item .pimg{width:30px;height:30px;flex:none;border-radius:7px;border:1px solid var(--line);background:#fff;object-fit:contain}
.cbz .item .pemoji{display:flex;align-items:center;justify-content:center;font-size:15px;background:#F4F7F5}
.cbz .item .pnm{flex:1}
.cbz .item .price{font-family:var(--mono);font-weight:600;color:var(--red);white-space:nowrap}
.cbz .item .qty{color:var(--ink-soft)}
.cbz .store-status{margin-top:8px;font-size:11px;font-weight:600;border-radius:6px;padding:5px 8px;display:inline-flex;align-items:center;gap:6px;flex-wrap:wrap}
.cbz .store-status .order-code{font-weight:500;border-left:1px solid rgba(30,122,51,.25);padding-left:6px}
.cbz .store-status .order-code b{font-family:var(--mono);font-weight:700}
.cbz .store-qr{display:flex;gap:10px;align-items:center;margin-top:8px;padding:8px;border:1px dashed var(--line);border-radius:8px;background:#FAFCFB}
.cbz .store-qr .qr-mini{flex:none;background:#fff;border:1px solid var(--line);border-radius:6px;padding:4px;line-height:0}
.cbz .store-qr .qr-side{flex:1;min-width:0}
.cbz .store-qr .qr-lbl{font-size:11.5px;font-weight:600}
.cbz .store-qr .qr-lbl b{font-family:var(--mono);color:var(--red)}
.cbz .store-qr .qr-hint{font-size:10.5px;color:var(--ink-soft);line-height:1.4;margin:2px 0 6px}
.cbz .store-qr .qr-dl{border:1px solid var(--line);background:#fff;border-radius:7px;padding:4px 10px;font-size:11px;font-weight:600;cursor:pointer;color:var(--brand-deep)}
.cbz .store-qr .qr-dl:hover{border-color:var(--brand-deep)}
.cbz .st-idle{background:#EFF3F1;color:var(--ink-soft)}
.cbz .st-live{background:#E3F4EF;color:var(--brand-deep)}
.cbz .st-done{background:#E7F6EA;color:#1E7A33}
.cbz .pay-note{font-size:11px;color:var(--ink-soft);line-height:1.5}
.cbz .total-row{display:flex;justify-content:space-between;align-items:baseline;padding:12px 16px;border-top:1px dashed var(--line)}
.cbz .total-row .lbl{font-size:13px;font-weight:600}
.cbz .total-row .amt{font-family:var(--mono);font-size:20px;font-weight:600;color:var(--red)}
.cbz .cta{margin:0 16px 8px;width:calc(100% - 32px);background:var(--brand);color:#fff;border:none;border-radius:10px;padding:13px;font-size:14px;font-weight:700}
.cbz .cta:hover{background:var(--brand-deep)}
.cbz .cta:disabled{background:#B9CCC7;cursor:default}
.cbz .cta-sub{font-size:11px;color:var(--ink-soft);text-align:center;padding:0 16px 14px;line-height:1.5}
.cbz .session-area{min-height:0;overflow-y:auto;display:flex;flex-direction:column;gap:12px}
.cbz .session-area>*{flex-shrink:0}
/* Hiệu ứng bước hỏi trong màn 2 cột: đơn nháp "đẩy" từ giữa qua trái, câu hỏi trượt vào bên phải.
   KHÔNG dùng delay/fill-mode — nếu animation không chạy (renderer throttle, reduced-motion…)
   phần tử vẫn nằm đúng vị trí cuối, không bị kẹt lệch giữa chừng. */
.cbz .panel-slide{animation:cbzPanelIn .55s cubic-bezier(.22,.85,.3,1)}
@keyframes cbzPanelIn{from{transform:translateX(min(30vw,320px));opacity:.25}to{transform:none;opacity:1}}
.cbz .gate-wrap{display:flex;justify-content:center;align-items:flex-start;padding-top:8px}
.cbz .gate-in{animation:cbzGateIn .5s cubic-bezier(.22,.85,.3,1)}
@keyframes cbzGateIn{from{transform:translateX(56px);opacity:0}to{transform:none;opacity:1}}
.cbz .sess-in{animation:cbzGateIn .45s cubic-bezier(.22,.85,.3,1)}
@media (prefers-reduced-motion: reduce){.cbz .panel-slide,.cbz .gate-in,.cbz .sess-in{animation:none}}
.cbz .tabs{display:flex;gap:8px;flex-wrap:wrap}
.cbz .tab{border:1px solid var(--line);background:var(--card);border-radius:10px;padding:8px 14px;font-size:12.5px;font-weight:600;color:var(--ink-soft);display:flex;align-items:center;gap:8px}
.cbz .tab.active{border-color:var(--brand);color:var(--brand-deep);background:#EFF8F5}
.cbz .tab .dot{width:8px;height:8px;border-radius:50%;background:#C6CFCB}
.cbz .tab.live .dot{background:var(--amber);animation:cbzpulse 1.2s infinite}
.cbz .tab.done .dot{background:#1E7A33}
@keyframes cbzpulse{0%,100%{opacity:1}50%{opacity:.35}}
.cbz .browser{background:var(--card);border:1px solid var(--line);border-radius:14px;overflow:hidden;box-shadow:0 10px 30px rgba(20,32,31,.07)}
.cbz .chrome{display:flex;align-items:center;gap:10px;background:#EEF1EF;border-bottom:1px solid var(--line);padding:8px 12px;flex-wrap:wrap}
.cbz .dots{display:flex;gap:5px}
.cbz .dots i{width:10px;height:10px;border-radius:50%}
.cbz .dots i:nth-child(1){background:#F26D6D}.cbz .dots i:nth-child(2){background:#F5C34D}.cbz .dots i:nth-child(3){background:#63C56E}
.cbz .urlbar{flex:1;min-width:140px;background:#fff;border:1px solid var(--line);border-radius:7px;padding:5px 10px;font-family:var(--mono);font-size:11.5px;color:var(--ink-soft);display:flex;align-items:center;gap:6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cbz .urlbar .lock{color:#1E7A33}
.cbz .acc-toggle{display:flex;gap:4px;background:#fff;border:1px solid var(--line);border-radius:8px;padding:2px}
.cbz .acc-toggle button{border:none;background:none;border-radius:6px;padding:4px 8px;font-size:11px;font-weight:600;color:var(--ink-soft);display:inline-flex;align-items:center;gap:4px}
.cbz .acc-toggle button.on{background:var(--brand);color:#fff}
.cbz .acc-toggle button:disabled{opacity:.5;cursor:default}
.cbz .botline{display:flex;align-items:center;gap:10px;background:#14201F;color:#DDEAE6;font-size:12px;padding:9px 18px}
.cbz .botline .bot-ic{width:22px;height:22px;border-radius:6px;background:var(--brand);display:flex;align-items:center;justify-content:center;font-size:12px;flex:none}
.cbz .botline .txt b{color:#fff}
.cbz .review-banner{display:flex;gap:10px;align-items:flex-start;background:var(--amber-soft);border-top:1px solid #F2D9A6;border-bottom:1px solid #F2D9A6;padding:11px 18px;font-size:12.5px;line-height:1.55}
.cbz .review-banner .ic{font-size:16px;flex:none}
.cbz .review-banner b{color:#8A5A00}
.cbz .storepage{min-height:420px;background:#F2F4F2;position:relative}
/* ── SKIN nhận diện thật từng chuỗi ── */
/* Bách Hóa Xanh: header xanh lá + search + Giao đến; thanh danh mục xanh đậm */
.cbz .sk-bhx-top{background:#00A651;color:#fff;padding:10px 16px;display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.cbz .sk-bhx-top .logo{font-weight:800;font-size:16px;font-style:italic;white-space:nowrap}
.cbz .sk-bhx-top .logo b{color:#FFE600}
.cbz .sk-bhx-top .search{flex:1;min-width:130px;background:#fff;border-radius:20px;padding:7px 12px;font-size:12px;color:#8a8f98}
.cbz .sk-bhx-top .deliver{font-size:11.5px;background:rgba(255,255,255,.18);border-radius:16px;padding:6px 10px;max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cbz .sk-bhx-sub{background:#007A33;color:#E8F5EE;display:flex;justify-content:space-between;gap:10px;padding:7px 16px;font-size:11.5px;font-weight:600;flex-wrap:wrap}
.cbz .skin-bhx{background:#F4F6F5}
.cbz .skin-bhx .order-btn{background:#00A651 !important}
.cbz .skin-bhx .payauto-tabs button.on{border-color:#00A651;background:#E9F8EF;color:#007A33}
.cbz .skin-bhx .qtybox button{border-color:#BFE3CC;color:#007A33}
.cbz .skin-bhx .f input.filled{border-color:#9ADBB4;background:#F0FBF4}
/* Co.op Online: banner gradient xanh dương + logo + breadcrumb + footer đậm */
.cbz .sk-coop-banner{background:linear-gradient(90deg,#0F2F7F,#1E56C8 60%,#0F2F7F);color:#fff;text-align:center;font-weight:800;font-size:12px;letter-spacing:.6px;padding:8px 12px}
.cbz .sk-coop-head{background:#fff;display:flex;align-items:center;gap:14px;padding:10px 16px;border-bottom:1px solid #E3E8E4;flex-wrap:wrap}
.cbz .sk-coop-head .logo{font-size:17px;font-weight:800;color:#0F2F7F;white-space:nowrap}
.cbz .sk-coop-head .logo .c{color:#00953A}
.cbz .sk-coop-head .menu{font-size:12px;color:#33415C;white-space:nowrap}
.cbz .sk-coop-head .search{flex:1;min-width:150px;border:1px solid #D8DEE9;border-radius:18px;padding:7px 12px;font-size:12px;color:#8a8f98}
.cbz .sk-coop-head .store{font-size:11.5px;color:#0F2F7F;font-weight:700;max-width:230px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cbz .sk-coop-crumb{padding:8px 16px;font-size:11.5px;color:#67708A;background:#fff;border-bottom:1px solid #EEF1F6}
.cbz .sk-coop-crumb b{color:#0F2F7F}
.cbz .skin-coop{background:#fff}
.cbz .skin-coop .order-btn{background:#1E56C8 !important;text-transform:uppercase;letter-spacing:.4px}
.cbz .skin-coop .payauto-tabs button.on{border-color:#1E56C8;background:#EDF3FE;color:#0F2F7F}
.cbz .skin-coop .qtybox button{border-color:#C9D7F2;color:#0F2F7F}
.cbz .skin-coop .f input.filled{border-color:#B9CDF0;background:#F3F7FE}
.cbz .sk-coop-foot{background:#0F2F7F;color:#CDD7F0;display:flex;gap:14px;justify-content:space-between;padding:12px 16px;font-size:10px;font-weight:800;flex-wrap:wrap;letter-spacing:.4px}
.cbz .store-topbar{color:#fff;padding:12px 18px;display:flex;align-items:center;gap:10px;font-weight:700;font-size:14px;flex-wrap:wrap}
.cbz .store-topbar .cartic{margin-left:auto;font-size:12px;font-weight:500;opacity:.9}
.cbz .store-body{display:grid;grid-template-columns:1fr 340px;gap:14px;padding:16px 18px}
@media(max-width:1100px){.cbz .store-body{grid-template-columns:1fr}}
.cbz .form-card,.cbz .sum-card{background:#fff;border:1px solid var(--line);border-radius:10px;padding:14px}
.cbz .form-card h3,.cbz .sum-card h3{font-size:13px;font-weight:700;margin-bottom:12px}
.cbz .f{margin-bottom:11px;position:relative}
.cbz .f label{display:block;font-size:11.5px;color:var(--ink-soft);margin-bottom:4px}
.cbz .f input{width:100%;border:1px solid var(--line);border-radius:7px;padding:8px 10px;font-size:13px;background:#fff}
.cbz .f input.filling{border-color:var(--amber);background:var(--amber-soft)}
.cbz .f input.filled{border-color:#BFE3CC;background:#F4FBF6}
.cbz .f .slot-select{width:100%;border:1px solid var(--brand);border-radius:7px;padding:8px 10px;font-size:13px;background:#F4FBF6;color:var(--ink);cursor:pointer;appearance:none;-webkit-appearance:none;background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'><path d='M2 4l4 4 4-4' fill='none' stroke='%23888' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'/></svg>");background-repeat:no-repeat;background-position:right 9px center;padding-right:28px}
.cbz .f .slot-select:focus{outline:none;border-color:var(--brand);box-shadow:0 0 0 2px rgba(14,124,107,.15)}
.cbz .f .sens{position:absolute;right:8px;top:29px;font-size:10px;color:var(--brand);background:#E7F1EF;border-radius:4px;padding:1px 5px;font-weight:700}
.cbz .login-wrap{padding:22px 18px;display:flex;justify-content:center}
.cbz .login-card{background:#fff;border:1px solid var(--line);border-radius:12px;padding:20px;max-width:380px;width:100%}
.cbz .login-card h3{font-size:15px;margin-bottom:6px}
.cbz .login-note{font-size:11.5px;color:var(--ink-soft);line-height:1.5;margin-bottom:14px}
.cbz .login-alt{font-size:11.5px;color:var(--ink-soft);text-align:center;margin-top:10px}
.cbz .login-alt .link{border:none;background:none;color:var(--brand);font-weight:600;text-decoration:underline;padding:0}
.cbz .prod{display:flex;gap:10px;align-items:center;border:1px solid var(--line);border-radius:8px;padding:8px 10px;margin-bottom:8px;background:#FBFCFB}
.cbz .prod .thumb{width:40px;height:40px;border-radius:6px;flex:none;display:flex;align-items:center;justify-content:center;font-size:18px;background:#EEF3EF}
.cbz .prod .nm{font-size:12.5px;font-weight:600;line-height:1.35}
.cbz .prod .pr{font-family:var(--mono);font-size:12px;color:var(--red);font-weight:600;white-space:nowrap;min-width:64px;text-align:right}
.cbz .qtybox{display:flex;align-items:center;gap:6px;flex:none}
.cbz .qtybox button{width:24px;height:24px;border-radius:6px;border:1px solid var(--line);background:#fff;font-size:15px;line-height:1;color:var(--ink)}
.cbz .qtybox button:disabled{opacity:.4;cursor:default}
.cbz .qtybox span{min-width:16px;text-align:center;font-weight:600;font-size:12.5px}
.cbz .suggest{border:1px dashed var(--line);border-radius:8px;padding:8px;margin:4px 0 10px}
.cbz .suggest-lbl{font-size:11px;font-weight:700;color:var(--ink-soft);text-transform:uppercase;letter-spacing:.4px;margin-bottom:6px}
.cbz .suggest-lbl .demo{background:var(--amber-soft);color:#8A5A00;border-radius:20px;padding:1px 6px;font-size:9px;margin-left:4px}
.cbz .suggest-item{display:flex;width:100%;justify-content:space-between;align-items:center;gap:8px;border:1px solid var(--line);border-radius:7px;padding:6px 9px;margin-bottom:5px;background:#fff;font-size:12px;color:var(--ink)}
.cbz .suggest-item:hover{border-color:var(--brand)}
.cbz .suggest-item .add{color:var(--brand);font-weight:700;font-family:var(--mono);white-space:nowrap}
.cbz .suggest-item .s-nm{display:flex;align-items:center;gap:8px;min-width:0;text-align:left}
.cbz .suggest-item .s-nm img{width:34px;height:34px;border-radius:6px;object-fit:contain;flex:none;background:transparent;mix-blend-mode:multiply}
.cbz .suggest-item .s-emo{width:34px;height:34px;border-radius:6px;background:#EEF3EF;display:flex;align-items:center;justify-content:center;flex:none}
.cbz .suggest-item .s-txt{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cbz .prod .thumb img{width:100%;height:100%;border-radius:6px;object-fit:contain;background:#fff}
.cbz .suggest-search{width:100%;border:1px solid var(--line);border-radius:8px;padding:8px 10px;font-size:12px;background:#fff;margin-bottom:7px}
.cbz .suggest-search:focus{outline:none;border-color:var(--brand)}
.cbz .suggest-empty{font-size:11.5px;color:var(--ink-soft);padding:8px 4px;text-align:center}
.cbz .promo{display:flex;gap:6px;margin:8px 0 10px}
.cbz .promo .promo-select{flex:1;min-width:0;border:1px solid var(--line);border-radius:7px;padding:7px 9px;font-size:12px;background:#fff;color:var(--ink);cursor:pointer;appearance:none;-webkit-appearance:none;background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'><path d='M2 4l4 4 4-4' fill='none' stroke='%23888' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'/></svg>");background-repeat:no-repeat;background-position:right 9px center;padding-right:28px}
.cbz .promo .promo-select:focus{outline:none;border-color:var(--brand)}
.cbz .promo .promo-select:disabled{opacity:.5;cursor:default}
.cbz .sum-line{display:flex;justify-content:space-between;font-size:12.5px;padding:4px 0;color:var(--ink-soft)}
.cbz .sum-line.total{border-top:1px dashed var(--line);margin-top:6px;padding-top:9px;color:var(--ink);font-weight:700}
.cbz .sum-line.total .v{font-family:var(--mono);color:var(--red);font-size:16px}
.cbz .payauto{margin:12px 0 4px;border-top:1px dashed var(--line);padding-top:10px}
.cbz .payauto-lbl{font-size:11.5px;color:var(--ink-soft);margin-bottom:6px}
.cbz .payauto-lbl .hint{opacity:.7}
.cbz .payauto-tabs{display:flex;gap:6px}
.cbz .payauto-tabs button{flex:1;border:1px solid var(--line);background:#fff;border-radius:7px;padding:6px 0;font-size:11.5px;font-weight:600;color:var(--ink-soft)}
.cbz .payauto-tabs button.on{border-color:var(--brand);background:#EFF8F5;color:var(--brand-deep)}
.cbz .payauto-tabs button:disabled{opacity:.55;cursor:default}
.cbz .payauto-note{margin-top:7px;font-size:11px;line-height:1.5;color:var(--ink-soft);background:#F0F5F3;border-radius:7px;padding:7px 9px}
.cbz .payauto-note.ok{background:#F4FBF6;color:#1E7A33}
/* QR thanh toán ở Affree */
/* QR thanh toán INLINE — nằm ngay trong cột "Đơn hàng" của trang cửa hàng (không popup). */
.cbz .qr-inline{margin-top:12px;border:1.5px solid var(--brand);border-radius:12px;padding:16px 14px;text-align:center;background:#F7FCFA}
.cbz .qr-inline .qr-brand{font-size:10.5px;font-weight:800;letter-spacing:.6px;text-transform:uppercase;color:var(--brand);margin-bottom:6px}
.cbz .qr-inline .qr-brand em{font-style:normal}
.cbz .qr-inline h4{font-size:15px;margin-bottom:3px}
.cbz .qr-inline .qr-sub{font-size:12.5px;color:var(--ink-soft);margin-bottom:10px}
.cbz .qr-inline .qr-sub b{font-family:var(--mono);color:var(--red)}
.cbz .qr-inline .qr-box{display:flex;justify-content:center;padding:12px;border:1px solid var(--line);border-radius:10px;background:#fff;margin-bottom:8px}
.cbz .qr-inline .qr-note{font-size:11px;color:var(--ink-soft);line-height:1.5;text-align:left;margin-bottom:10px}
.cbz .qr-inline .qr-later{margin-top:8px;border:none;background:none;color:var(--ink-soft);font-size:12px;font-weight:600;text-decoration:underline;cursor:pointer}
.cbz .qr-inline .qr-status{display:flex;align-items:center;justify-content:center;gap:8px;font-size:12px;font-weight:600;color:var(--ink-soft);background:#F4F6F5;border:1px solid var(--line);border-radius:9px;padding:9px 11px;line-height:1.45;text-align:left}
.cbz .qr-inline .qr-status.ok{color:#1E7A33;background:#E7F6EA;border-color:#BFE3CC}
.cbz .qr-inline .qr-status .spin{width:14px;height:14px;flex:none;border:2px solid var(--line);border-top-color:var(--brand);border-radius:50%;animation:cbzspin .8s linear infinite}
@keyframes cbzspin{to{transform:rotate(360deg)}}
.cbz .order-btn{width:100%;border:none;border-radius:9px;padding:13px;font-size:14px;font-weight:800;color:#fff;margin-top:12px;transition:filter .15s,opacity .15s}
.cbz .order-btn:disabled{opacity:.45;cursor:default}
.cbz .order-btn:not(:disabled):hover{filter:brightness(1.08)}
.cbz .placed{position:absolute;inset:0;background:rgba(247,251,248,.96);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;text-align:center;padding:30px}
.cbz .placed .check{width:56px;height:56px;border-radius:50%;background:#1E7A33;color:#fff;font-size:26px;display:flex;align-items:center;justify-content:center}
.cbz .placed h4{font-size:16px}
.cbz .placed p{font-size:12.5px;color:var(--ink-soft);max-width:380px;line-height:1.6}
.cbz .placed button{margin-top:6px;background:var(--brand);color:#fff;border:none;border-radius:9px;padding:10px 18px;font-weight:700}
/* all-done card (theo prototype) */
.cbz .session-empty{border:1.5px dashed var(--line);border-radius:14px;padding:48px 24px;text-align:center;color:var(--ink-soft)}
.cbz .session-empty .ic{font-size:30px;margin-bottom:10px}
.cbz .session-empty h4{font-size:15px;color:var(--ink);margin-bottom:6px}
.cbz .session-empty p{font-size:12.5px;line-height:1.6;max-width:420px;margin:0 auto}
/* Màn "chuẩn bị mở trang đích" — cùng phong cách khung session-empty + hiệu ứng loading. */
.cbz .session-opening{border:1.5px dashed var(--line);border-radius:14px;padding:48px 24px;text-align:center;color:var(--ink-soft);animation:cbzOpFade .3s ease-out}
.cbz .session-opening .op-logo{position:relative;display:inline-flex;align-items:center;justify-content:center;width:56px;height:56px;margin-bottom:14px}
.cbz .session-opening .op-ring{position:absolute;inset:-5px;border:2.5px solid var(--line);border-top-color:var(--brand);border-radius:50%;animation:cbzspin .9s linear infinite}
.cbz .session-opening h4{font-size:15px;color:var(--ink);margin-bottom:6px}
.cbz .session-opening p{font-size:12.5px;line-height:1.6;max-width:420px;margin:0 auto}
.cbz .session-opening .op-bar{width:min(300px,70%);height:5px;border-radius:99px;background:var(--line);margin:18px auto 0;overflow:hidden}
.cbz .session-opening .op-bar i{display:block;height:100%;border-radius:99px;background:var(--brand);animation:cbzOpBar 1.6s ease-in-out forwards}
@keyframes cbzOpBar{from{width:8%}to{width:97%}}
@keyframes cbzOpFade{from{opacity:0;transform:scale(.985)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion: reduce){.cbz .session-opening,.cbz .session-opening .op-ring,.cbz .session-opening .op-bar i{animation:none}.cbz .session-opening .op-bar i{width:97%}}
.cbz .done-card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:26px;text-align:center}
.cbz .done-card h3{font-size:17px;margin:10px 0 6px}
.cbz .done-card p{font-size:13px;color:var(--ink-soft);line-height:1.6;max-width:520px;margin:0 auto}
.cbz .done-card .row{display:flex;gap:10px;justify-content:center;margin-top:16px;flex-wrap:wrap}
.cbz .done-card .pill{border:1px solid var(--line);border-radius:9px;padding:9px 14px;font-size:12.5px;font-weight:600;display:flex;align-items:center;gap:7px}
.cbz .done-card .pill .ok{color:#1E7A33}
.cbz .done-close{margin-top:16px;background:var(--brand);color:#fff;border:none;border-radius:10px;padding:11px 24px;font-weight:700;font-size:14px}
`}</style>
  );
}
