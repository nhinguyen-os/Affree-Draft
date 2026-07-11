"use client";

import { useState, useEffect, useRef } from "react";
import QRCode from "react-qr-code";
import type { RankedOffer } from "@/lib/types";
import { formatMoney } from "@/lib/util";
import { storeCurrency, chainLogo } from "@/lib/stores";
import { flushProfile, getProfile, saveProfile } from "@/lib/profile";

type PayMethod = "qr" | "card" | "cod";

/* ─── PNJ payment method from API ────────────────────────────────────────── */
type PnjPayment = {
  payment_id: number;
  payment_method: string; // "BANK_TRANS" | "COD" | "PAYOO_CC" | …
  payment: string;        // tên hiển thị
  is_available: boolean;
  is_default: boolean;
  icon: string;
  notes: string;
  unavailable_reason: string;
};

const PAYMENT_EMOJI: Record<string, string> = {
  BANK_TRANS:   "🏦",
  COD:          "💵",
  PAYOO_CC:     "💳",
  VNPAY:        "🔵",
  MOMO:         "🟣",
  ZALOPAY:      "⚡",
  PAYOO:        "💰",
  PAYOO_QRCODE: "📱",
};

/* ─── shared input style ──────────────────────────────────────────────── */
const INPUT_CLS =
  "w-full rounded-lg border border-slate-300 bg-white/60 px-3 py-2 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 placeholder:text-slate-400";
const INPUT_ERR =
  "w-full rounded-lg border border-rose-400 bg-white/60 px-3 py-2 text-sm outline-none focus:border-rose-500 focus:ring-2 focus:ring-rose-100 placeholder:text-slate-400";

/* ─── small UI components ─────────────────────────────────────────────── */
function Spinner() {
  return (
    <svg className="h-4 w-4 animate-spin text-emerald-600" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
    </svg>
  );
}
function CheckIcon() {
  return (
    <svg className="h-4 w-4 text-emerald-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <path d="M20 6 9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
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

/* ─── log item — same as BHX log row ─────────────────────────────────── */
function LogItem({ message, status }: { message: string; status?: string }) {
  const tone =
    status === "error"
      ? "border-rose-200 bg-rose-50 text-rose-700"
      : status === "warning"
        ? "border-amber-200 bg-amber-50 text-amber-800"
        : status === "success"
          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
          : "border-slate-200 bg-white text-slate-700";
  return (
    <li className={`rounded-lg border px-3 py-2 text-sm ${tone}`}>
      <div className="flex items-start gap-2">
        <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-70" />
        <span className="min-w-0 whitespace-pre-wrap break-words">{message}</span>
      </div>
    </li>
  );
}

/* ─── main component ──────────────────────────────────────────────────── */
export default function PNJOrderModal({
  offer: initialOffer,
  alternatives = [],
  geoAddr,
  onClose,
  onPlaced,
}: {
  offer: RankedOffer;
  alternatives?: RankedOffer[];
  geoAddr?: string;
  onClose: () => void;
  onPlaced: (code: string, chosen: RankedOffer) => void;
}) {
  const saved = getProfile();

  /* selected store */
  const [selectedOffer, setSelectedOffer] = useState<RankedOffer>(initialOffer);

  /* form */
  const [name, setName] = useState(saved.name || "");
  const [phone, setPhone] = useState(saved.phone || "");
  const [rawAddress, setRawAddress] = useState(saved.address || "");
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [qty, setQty] = useState(1);

  /* ── Địa chỉ parsed (từ rawAddress) ── */
  const [parsedStreet, setParsedStreet] = useState("");
  const [parsedProvinceCode, setParsedProvinceCode] = useState("");
  const [parsedProvinceName, setParsedProvinceName] = useState("");
  const [parsedWardName, setParsedWardName] = useState("");
  const [addressValid, setAddressValid] = useState<boolean | null>(null);
  const [addressMsg, setAddressMsg] = useState("");
  const [checkingAddress, setCheckingAddress] = useState(false);

  /* provinces list — dùng để match tỉnh/thành */
  const [provinces, setProvinces] = useState<{ code: string; name: string }[]>([]);
  const [loadingProvinces, setLoadingProvinces] = useState(false);

  const [pnjPayments, setPnjPayments] = useState<PnjPayment[]>([]);
  const [loadingPayments, setLoadingPayments] = useState(false);
  const [selectedPnjPayment, setSelectedPnjPayment] = useState<string | null>("COD");

  /** Backward-compat: map payment_method → PayMethod for QR/COD display
   *  Hỗ trợ cả short key ("qr","cod") lẫn full code ("PAYOO_QRCODE","COD") */
  const payMethod: PayMethod | null =
    selectedPnjPayment === "BANK_TRANS" || selectedPnjPayment === "PAYOO_QRCODE" || selectedPnjPayment === "qr" ? "qr" :
    selectedPnjPayment === "COD" || selectedPnjPayment === "cod" ? "cod" :
    selectedPnjPayment ? "card" : null;

  /* store sort */
  const [storeSort, setStoreSort] = useState<"nearest" | "cheapest">("nearest");

  /* ── PNJ size picker ── */
  const [pnjSizes, setPnjSizes] = useState<string[]>([]);
  const [selectedSize, setSelectedSize] = useState<string>("");
  const [loadingSizes, setLoadingSizes] = useState(false);
  /* productCode lấy từ pnj-sizes API — dùng cho payment methods call */
  const [pnjProductCode, setPnjProductCode] = useState<string>("");
  /* giá theo từng size: map size → price (VND) */
  const [pnjSizePrices, setPnjSizePrices] = useState<Record<string, number>>({});

  /* fetch sizes khi đổi offer / product */
  useEffect(() => {
    const pnjUrl = selectedOffer.product.pnjUrl || selectedOffer.productUrl;
    if (!pnjUrl || !pnjUrl.includes("pnj.com.vn")) {
      setPnjSizes([]);
      setSelectedSize(selectedOffer.product.pnjSize || "");
      return;
    }
    setLoadingSizes(true);
    setPnjSizes([]);
    fetch(`/api/pnj-sizes?url=${encodeURIComponent(pnjUrl)}`)
      .then((r) => r.json())
      .then((json: { sizes?: string[]; productCode?: string; sizePrices?: Record<string, number> }) => {
        const sizes = json.sizes ?? [];
        setPnjSizes(sizes);
        /* lưu productCode từ API — dùng thay thế selectedOffer.product.id */
        if (json.productCode) setPnjProductCode(json.productCode);
        /* lưu giá theo size */
        if (json.sizePrices) setPnjSizePrices(json.sizePrices);
        /* pre-select: pnjSize từ seed nếu có, sau đó mới chọn size đầu tiên */
        const def = selectedOffer.product.pnjSize;
        setSelectedSize(def && sizes.includes(def) ? def : (sizes[0] ?? ""));
      })
      .catch(() => {
        setSelectedSize(selectedOffer.product.pnjSize || "");
      })
      .finally(() => setLoadingSizes(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedOffer.store.id]);

  /* ── phase + BHX-style running state ── */
  const [phase, setPhase] = useState<"form" | "running">("form");
  const [agentBusy, setAgentBusy] = useState(false);
  const [messages, setMessages] = useState<Array<{ message: string; status?: string }>>([]);
  /* payment pause: agent dừng chờ user xác nhận chuyển khoản */
  const [paymentPaused, setPaymentPaused] = useState(false);
  /* QR image thật từ Payoo (Step 8) */
  const [pnjQrImageUrl, setPnjQrImageUrl] = useState<string | null>(null);
  const [pnjPayooUrl, setPnjPayooUrl] = useState<string | null>(null);
  /* Direct QR API URL (fallback nếu base64 fetch fail) */
  const [pnjQrApiUrl, setPnjQrApiUrl] = useState<string | null>(null);
  /* Trạng thái thất bại thanh toán + đang check API */
  const [paymentFailed, setPaymentFailed] = useState(false);
  const [checkingPayment, setCheckingPayment] = useState(false);
  /* Thông báo kết quả check thanh toán — replace tại chỗ thay vì addMsg */
  const [paymentCheckMsg, setPaymentCheckMsg] = useState<{ text: string; ok: boolean } | null>(null);
  /* Màn hình thành công — hiện sau khi xác nhận thanh toán */
  const [showSuccess, setShowSuccess] = useState(false);
  const [successUrl, setSuccessUrl] = useState<string | null>(null);

  /* ── same flag pattern as isBHXReal in OrderAgentModal ── */
  const isPnjReal = !!process.env.NEXT_PUBLIC_PNJ_REAL;

  /* WebSocket ref — same as BHX */
  const wsRef = useRef<WebSocket | null>(null);
  /* demo timers — cleanup on unmount */
  const demoTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  /* auto-poll interval ref */
  const autoCheckRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const addMsg = (message: string, status?: string) =>
    setMessages((prev) => [...prev, { message, status }]);

  /* cleanup demo timers + auto-poll on unmount */
  useEffect(() => () => {
    demoTimersRef.current.forEach(clearTimeout);
    if (autoCheckRef.current) clearInterval(autoCheckRef.current);
  }, []);

  /* ── Hàm check thanh toán dùng chung cho manual + auto-poll ── */
  const PAYOO_FAIL_URLS = [
    'payoo.vn/v2/paynow/result/fail',
    'payoo.vn/v2/paynow/detail',
  ];
  const isPayooFailUrl = (url: string) =>
    PAYOO_FAIL_URLS.some(p => url.includes(p));

  const runPaymentCheck = async () => {
    let token: string | null = null;
    try {
      if (pnjPayooUrl) token = new URL(pnjPayooUrl).searchParams.get('_token');
    } catch { /* ignore */ }

    if (!token) {
      // Demo mode — không có token, xác nhận ngay
      if (autoCheckRef.current) clearInterval(autoCheckRef.current);
      onPlaced('PNJ-QR-OK', selectedOffer);
      return;
    }

    setCheckingPayment(true);
    try {
      const res = await fetch(`/api/payoo-check?token=${encodeURIComponent(token)}`);
      const data = await res.json() as {
        code?: number; url?: string;
        transferAmount?: string; confirmed?: string;
      };

      const rawUrl = (data.url ?? '').trim();
      const amount = parseFloat(data.transferAmount ?? '0');
      // Giá đơn vị: nếu có size đã chọn và có giá theo size → dùng giá size, else dùng product.price
      const unitPrice = (selectedSize && pnjSizePrices[selectedSize])
        ? pnjSizePrices[selectedSize]
        : (selectedOffer.price ?? 0);
      const productPrice = unitPrice * qty;
      console.log('[PNJ Payment] transferAmount từ API:', amount);
      console.log('[PNJ Payment] productPrice (giá SP × qty):', productPrice, '| unitPrice:', unitPrice, '| size:', selectedSize || '(không có size)');
      // Thành công: có URL, không phải URL fail/pending, và transferAmount >= giá sản phẩm
      const isSuccess = rawUrl !== '' && !isPayooFailUrl(rawUrl) && amount >= productPrice && productPrice > 0;

      if (isSuccess) {
        if (autoCheckRef.current) clearInterval(autoCheckRef.current);
        setSuccessUrl(rawUrl);
        setShowSuccess(true);
        setPaymentCheckMsg(null);
      } else {
        setPaymentCheckMsg({ text: '⏳ Chưa xác nhận được thanh toán — đang kiểm tra lại tự động...', ok: false });
      }
    } catch {
      setPaymentCheckMsg({ text: '⚠️ Lỗi kiểm tra thanh toán. Sẽ thử lại...', ok: false });
    } finally {
      setCheckingPayment(false);
    }
  };

  /* auto-poll theo NEXT_PUBLIC_TIME_CHECK_PAYMENT_PNJ (ms), mặc định 5000 */
  useEffect(() => {
    if (!paymentPaused) {
      if (autoCheckRef.current) { clearInterval(autoCheckRef.current); autoCheckRef.current = null; }
      return;
    }
    const intervalMs = parseInt(process.env.NEXT_PUBLIC_TIME_CHECK_PAYMENT_PNJ ?? '5000', 10) || 5000;
    autoCheckRef.current = setInterval(() => {
      runPaymentCheck();
    }, intervalMs);
    return () => {
      if (autoCheckRef.current) { clearInterval(autoCheckRef.current); autoCheckRef.current = null; }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paymentPaused, pnjPayooUrl]);

  /* derived */
  const phoneDigits = phone.replace(/[\s.\-()]/g, "").replace(/^(\+?84)/, "0");
  const phoneOk = /^0[35789]\d{8}$/.test(phoneDigits);
  const fullAddress = [parsedStreet, parsedWardName, parsedProvinceName].filter(Boolean).join(", ");
  const canStart = !!name.trim() && phoneOk && (addressValid === true) && !!selectedPnjPayment;

  /* ── normalize Vi string for fuzzy match ── */
  function normVi(s: string) {
    return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  }
  function stripGeo(s: string) {
    return normVi(s)
      .replace(/^(thanh pho|tp |tp\.|tinh|quan|q\.|huyen|h\.|phuong|p\.|xa|x\.|thi tran|thi xa)\s*/, '')
      .trim();
  }

  /* ── Fetch PNJ payment methods khi product / qty / size thay đổi ── */
  useEffect(() => {
    /* Dùng productCode từ sizes API (SNXM00K000139...) thay vì product.id số */
    const productCode = pnjProductCode || selectedOffer.product.id;
    if (!productCode) return;

    setLoadingPayments(true);
    const total = Math.round(selectedOffer.price * qty);

    fetch("/api/pnj-payments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        cart: { total },
        customerPhone: phoneDigits || "0900000000",
        deliveryType: "HD",
        products: [{
          productCode,
          quantity: qty,
          subTotal: total,
          sizePickerValue: selectedSize || "",
          plant: "",
          location: "",
          batch: "",
        }],
      }),
    })
      .then(r => r.json())
      .then(json => {
        const methods: PnjPayment[] = (json?.data ?? []).map(
          (item: Record<string, PnjPayment>) => {
            const key = Object.keys(item)[0];
            return item[key];
          }
        );
        setPnjPayments(methods);
        // Auto-select: ưu tiên is_default + is_available, rồi bất kỳ is_available
        const def = methods.find(m => m.is_default && m.is_available)
                 ?? methods.find(m => m.is_available);
        // Override bất kể prev (kể cả COD fallback) nếu API trả về method tốt hơn
        if (def) setSelectedPnjPayment(def.payment_method);
      })
      .catch(() => { /* giữ nguyên nếu lỗi */ })
      .finally(() => setLoadingPayments(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedOffer.store.id, qty, selectedSize, pnjProductCode]);


  const currency = storeCurrency(selectedOffer.store.id);
  const price = formatMoney(selectedOffer.price, currency);
  const totalAmt = formatMoney(selectedOffer.price * qty, currency);

  /* sorted alternatives */
  const allPnjOffers = (() => {
    const seen = new Set<string>();
    const list: RankedOffer[] = [];
    for (const o of [initialOffer, ...alternatives]) {
      if (!seen.has(o.store.id)) { seen.add(o.store.id); list.push(o); }
    }
    return list;
  })();

  const sortedOffers = [...allPnjOffers].sort((a, b) =>
    storeSort === "cheapest" ? a.price - b.price : (a.distanceKm ?? 999) - (b.distanceKm ?? 999)
  );

  /* fetch PNJ provinces */
  useEffect(() => {
    setLoadingProvinces(true);
    fetch("https://edge-api.pnj.io/ecom-caching/v2/get-list-province")
      .then((r) => r.json())
      .then((json) => setProvinces((json?.data ?? []).map((p: { code: string; name: string }) => ({ code: p.code, name: p.name }))))
      .catch(() => {})
      .finally(() => setLoadingProvinces(false));
  }, []);

  /* ── Parse full address input — debounce 800ms ── */
  useEffect(() => {
    if (!rawAddress.trim()) {
      setAddressValid(null);
      setAddressMsg("");
      setParsedStreet(""); setParsedProvinceName(""); setParsedProvinceCode(""); setParsedWardName("");
      return;
    }
    setCheckingAddress(true);
    const timer = setTimeout(async () => {
      try {
        const parts = rawAddress.split(',').map(p => p.trim()).filter(Boolean);
        if (parts.length < 2) {
          setAddressValid(false);
          setAddressMsg("⚠️ Cần ít nhất: Số nhà/đường, Phường/xã, Tỉnh/thành phố (cách bằng dấu phẩy)");
          setCheckingAddress(false);
          return;
        }
        const provinceCandidate = parts[parts.length - 1];
        const wardCandidate = parts.length >= 3 ? parts[parts.length - 2] : "";
        const streetParts = parts.slice(0, parts.length - (wardCandidate ? 2 : 1));

        // Match tỉnh/thành phố
        const normProv = stripGeo(provinceCandidate);
        const matchProv = provinces.find(p => {
          const n = stripGeo(p.name);
          return n === normProv || n.includes(normProv) || normProv.includes(n);
        });

        if (!matchProv) {
          setAddressValid(false);
          setAddressMsg(`❌ Địa chỉ không hợp lệ — không tìm thấy tỉnh/thành: "${provinceCandidate}"`);
          setParsedProvinceName(""); setParsedProvinceCode("");
          setCheckingAddress(false);
          return;
        }
        setParsedProvinceCode(matchProv.code);
        setParsedProvinceName(matchProv.name);
        setParsedStreet(streetParts.join(', '));

        if (wardCandidate) {
          // Load wards và match phường/xã
          const wRes = await fetch(`https://edge-api.pnj.io/ecom-caching/v2/get-list-ward?provinceId=${matchProv.code}`);
          const wJson = await wRes.json();
          const wList: { code: string; name: string }[] = (wJson?.data ?? []).map(
            (w: { code: string; name: string }) => ({ code: w.code, name: w.name })
          );
          const normWard = stripGeo(wardCandidate);
          const matchWard = wList.find(w => {
            const n = stripGeo(w.name);
            // Match chặt: exact hoặc ward API chứa input (input phải đủ dài ≥4 ký tự)
            return n === normWard || (normWard.length >= 4 && n.includes(normWard));
          });
          if (matchWard) {
            setParsedWardName(matchWard.name);
            setAddressValid(true);
            setAddressMsg(`✅ ${streetParts.join(', ')} · ${matchWard.name} · ${matchProv.name}`);
          } else {
            // Ward không khớp → invalid
            setParsedWardName('');
            setAddressValid(false);
            setAddressMsg(`❌ Không tìm thấy phường/xã “${wardCandidate}” trong ${matchProv.name} — kiểm tra lại`);
          }
        } else {
          // Thiếu phường/xã → invalid
          setParsedWardName('');
          setAddressValid(false);
          setAddressMsg('❌ Cần nhập đủ: Số nhà/đường, Phường/xã, Tỉnh/thành phố (đủ 3 phần cách dấu phẩy)');
        }
      } catch {
        setAddressValid(false);
        setAddressMsg("Lỗi kiểm tra địa chỉ. Vui lòng thử lại.");
      } finally {
        setCheckingAddress(false);
      }
    }, 800);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawAddress, provinces]);

  /* ── startDemoOrder — simulation (same as OrderAgentModal !isBHXReal) ── */
  const startDemoOrder = (addr: string, digits: string) => {
    setPhase("running");
    setAgentBusy(true);
    setMessages([]);
    setPaymentPaused(false);

    const steps: Array<{ msg: string; delay: number }> = [
      { msg: `Mở website PNJ…`, delay: 1000 },
      { msg: `Thêm “${selectedOffer.product.name}” vào giỏ (SL ${qty})…`, delay: 2200 },
      { msg: `Điền thông tin nhận hàng: ${addr || "(địa chỉ của bạn)"} · SĐT ${digits || "(của bạn)"}…`, delay: 3600 },

      ...(selectedSize ? [{ msg: `Chọn size ${selectedSize} cho sản phẩm…`, delay: 4200 }] : []),
      ...(email ? [{ msg: `Điền email nhận hoá đơn: ${email.slice(0, 8)}…`, delay: 4800 }] : []),
    ];

    const timers: ReturnType<typeof setTimeout>[] = [];

    steps.forEach(({ msg, delay }) => {
      timers.push(setTimeout(() => addMsg(msg, "success"), delay));
    });

    const payDelay = (steps[steps.length - 1]?.delay ?? 4800) + 1200;

    timers.push(setTimeout(() => {
      if (payMethod === "qr") {
        setAgentBusy(false);
        setPaymentPaused(true);
        addMsg("Thanh toán QR chuyển khoản");
      } else if (payMethod === "cod") {
        addMsg("Chọn thanh toán COD — tiền mặt khi nhận hàng…", "success");
        timers.push(setTimeout(() => {
          setAgentBusy(false);
          setPaymentPaused(true);
          addMsg("Đặt hàng thành công! 🎉", "success");
        }, 1200));
      } else {
        /* card */
        setAgentBusy(false);
        setPaymentPaused(true);
        addMsg("Nhập thông tin thẻ");
      }
    }, payDelay));

    demoTimersRef.current = timers;
  };

  /* ── startOrder — branch: isPnjReal → WebSocket thật (như BHX), !isPnjReal → demo ── */
  const startOrder = () => {
    flushProfile({ name, phone, address: fullAddress });
    if (!isPnjReal) {
      /* — DEMO MODE (như !isBHXReal trong OrderAgentModal) — */
      startDemoOrder(fullAddress, phoneDigits);
      return;
    }

    /* — REAL MODE: WebSocket agent-server (như isBHXReal) — */
    if (wsRef.current) wsRef.current.close();
    setPhase("running");
    setAgentBusy(true);
    setMessages([]);
    setPaymentPaused(false);

    const wsUrl = process.env.NEXT_PUBLIC_ORDER_AGENT_SERVER_URL || "ws://localhost:8080";
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    const sendPayload = () => {
      try {
        ws.send(JSON.stringify({
          type: "run_order",
          payload: {
            url: selectedOffer.productUrl || selectedOffer.product.pnjUrl || "https://www.pnj.com.vn",
            productName: selectedOffer.product.name,
            qty,
            buyerName: name,
            buyerPhone: phoneDigits,
            buyerEmail: email,
            buyerDob: "01/01/1993",
            buyerAddress: parsedStreet || rawAddress,
            buyerProvince: parsedProvinceName,
            buyerWard: parsedWardName,
            buyerNote: note,
            buyerGender: "chi",
            size: selectedSize || undefined,
            paymentMethod: selectedPnjPayment ?? "COD",
            paymentMethodDisplay: pnjPayments.find(m => m.payment_method === selectedPnjPayment)?.payment ?? "",
            chain: selectedOffer.store.chain,
            isRealOrder: process.env.DEMO_ORDER_PNJ === 'true',
          },
        }));
      } catch (err) {
        setAgentBusy(false);
        addMsg(err instanceof Error ? err.message : String(err), "error");
      }
    };

    /* ready-timeout: nếu server không gửi "ready" trong 3s vẫn bắt đầu */
    let payloadSent = false;
    const readyTimeout = setTimeout(() => {
      if (!payloadSent) {
        payloadSent = true;
        sendPayload();
      }
    }, 3000);

    /* milestones đã hiện — mỗi step chỉ hiện 1 lần */
    const shownSteps = new Set<string>();

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(String(ev.data)) as {
          type?: string;
          content?: string;
          status?: string;
          phase?: string;
          message?: string;
        };

        if (msg.type === "status" && msg.phase === "ready") {
          if (!payloadSent) {
            payloadSent = true;
            clearTimeout(readyTimeout);
            sendPayload();
          }
        } else if (msg.type === "log" && msg.message) {
          /* Map raw playbook logs → text thân thiện, mỗi step 1 lần */
          const raw: string = msg.message;

          // Bước 1: Mở website
          if (!shownSteps.has("open") && /th.ng URL|trang ch/i.test(raw)) {
            shownSteps.add("open");
            addMsg("Mở website PNJ…", "success");
          }
          // Bước 5: thêm vào giỏ (chỉ lần đầu tiên tick)
          else if (!shownSteps.has("cart") && /5].*tick/i.test(raw)) {
            shownSteps.add("cart");
            addMsg(`Thêm "${selectedOffer.product.name}" vào giỏ (SL ${qty})…`, "success");
          }
          // Bước 6 hoàn tất (check TRƯỚC thông tin để không bị bắt nhầm)
          else if (!shownSteps.has("done") && /ho.n t.t.*th.ng tin/i.test(raw)) {
            shownSteps.add("done");
            addMsg("Hoàn tất điền thông tin. Chuyển sang thanh toán…", "success");
          }
          // Bước 6 điền thông tin người mua
          else if (!shownSteps.has("info") && /6].*mua/i.test(raw)) {
            shownSteps.add("info");
            addMsg(`Điền thông tin nhận hàng: ${fullAddress || "(địa chỉ)"} · SĐT ${phoneDigits || "(SĐT)"}…`, "success");
          }

          // Bước 6 email
          else if (!shownSteps.has("email") && /6].*email/i.test(raw)) {
            shownSteps.add("email");
            addMsg(email ? `Điền email nhận hoá đơn: ${email.slice(0, 8)}…` : "Điền email nhận hoá đơn…", "success");
          }
        } else if (msg.type === "message" && msg.content) {
          /* sendMessage() từ server */
          addMsg(msg.content, "success");
        } else if (msg.type === "payment_waiting" || msg.type === "payment_required") {
          /* agent dừng chờ thanh toán — hiện QR / nút xác nhận */
          setAgentBusy(false);
          setPaymentPaused(true);
          addMsg(payMethod === "qr" ? "Thanh toán QR chuyển khoản" : payMethod === "cod" ? "Thanh toán khi nhận hàng (COD)" : "Nhập thông tin thẻ");
        } else if (msg.type === "status" && (msg.phase as string) === "pnj_payment_failed") {
          /* Step 8: Payoo báo lỗi timeout hoặc modal THÔNG BÁO */
          const d = msg as unknown as { reason?: string };
          setAgentBusy(false);
          setPaymentFailed(true);
          addMsg("❌ Thanh toán thất bại: " + (d.reason || "Payoo báo lỗi. Vui lòng thử lại."), "error");
        } else if (msg.type === "status" && (msg.phase as string) === "pnj_qr_ready") {
          /* Step 8: agent đã lấy QR từ Payoo → hiện trong modal
           * PHẢI đặt TRƯỚC generic "status" handler để không bị catch nhầm */
          const d = msg as unknown as { qrImageUrl?: string; payooUrl?: string; qrApiUrl?: string };
          if (d.qrImageUrl) setPnjQrImageUrl(d.qrImageUrl);
          if (d.payooUrl) setPnjPayooUrl(d.payooUrl);
          if (d.qrApiUrl) setPnjQrApiUrl(d.qrApiUrl);
          setAgentBusy(false);
          setPaymentPaused(true);
          addMsg("💳 QR thanh toán sẵn sàng — quét mã để thanh toán!", "success");
        } else if (msg.type === "status") {
          if (msg.message) addMsg(msg.message, msg.status);
          if (msg.phase === "failed") {
            setAgentBusy(false);
          } else if (msg.phase === "done" || msg.phase === "success") {
            setAgentBusy(false);
            /* nếu QR → pause, không gọi onPlaced ngay */
            if (payMethod === "qr" && !paymentPaused) {
              setPaymentPaused(true);
              addMsg("Thanh toán QR chuyển khoản");
            } else if (!paymentPaused) {
              onPlaced(msg.message || "PNJ-OK", selectedOffer);
            }
          }
        } else if (msg.type === "order_success" && msg.content) {
          setAgentBusy(false);
          addMsg(msg.content, "success");
          if (payMethod === "qr" && !paymentPaused) {
            setPaymentPaused(true);
          } else {
            onPlaced(msg.content || "PNJ-OK", selectedOffer);
          }
        }
      } catch { /* ignore parse errors */ }
    };

    ws.onerror = () => {
      clearTimeout(readyTimeout);
      setAgentBusy(false);
      addMsg("Không kết nối được agent-server PNJ.", "error");
    };

    ws.onclose = () => {
      clearTimeout(readyTimeout);
      setAgentBusy(false);
      addMsg("Kết nối agent-server đã đóng.", "info");
    };
  };

  /* ── Success screen — hiện sau khi xác nhận thanh toán QR thành công ── */
  const renderSuccess = () => (
    <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 py-6 space-y-4">
      {/* Icon + title */}
      <div className="flex flex-col items-center gap-3 py-2">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>
        <h2 className="text-lg font-bold text-slate-900">Đặt hàng thành công!</h2>
        <p className="text-xs text-slate-500 text-center">
          Trợ lý đã đặt đơn trên PNJ. Thanh toán QR đã xác nhận.
        </p>
      </div>

      {/* Order summary table */}
      <div className="rounded-xl border border-slate-200 overflow-hidden divide-y divide-slate-100 text-sm bg-white">
        {([
          ["Món", `${selectedOffer.product.name} ×${qty}`],
          ["Nơi bán", `${selectedOffer.store.chain?.toUpperCase() || "PNJ"} · ${selectedOffer.store.name}`],
          ["Giao tới", fullAddress || "(địa chỉ)"],
          ["Email", email || "(email)"],
          ["Thanh toán", payMethod === "qr" ? "QR chuyển khoản" : payMethod === "cod" ? "Tiền mặt (COD)" : "Thẻ"],
          ["Tổng", totalAmt],
        ] as [string, string][]).map(([label, value]) => (
          <div key={label} className="flex items-start justify-between gap-3 px-4 py-2.5">
            <span className="shrink-0 text-slate-500">{label}</span>
            <span className={`text-right break-words max-w-[60%] font-medium ${
              label === "Tổng" ? "text-emerald-600 font-bold" : "text-slate-800"
            }`}>{value}</span>
          </div>
        ))}
        {/* Link đơn hàng từ Payoo API */}
        {successUrl && (
          <div className="flex items-start justify-between gap-3 px-4 py-2.5">
            <span className="shrink-0 text-slate-500">Link đơn hàng</span>
            <a
              href={successUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-right text-[11px] text-emerald-600 underline break-all max-w-[65%]"
            >
              {successUrl}
            </a>
          </div>
        )}
      </div>

      {/* Done button */}
      <button
        onClick={() => onPlaced("PNJ-QR-OK", selectedOffer)}
        className="w-full rounded-xl bg-emerald-700 py-3 text-sm font-semibold text-white transition hover:bg-emerald-800">
        Xong
      </button>
    </div>
  );

  /* ── FORM render ── */
  const renderForm = () => (
    <>
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 py-4 space-y-3">

        {/* Info banner — demo hoặc real */}
        <div className={`rounded-lg border px-3 py-2 text-xs ${
          isPnjReal
            ? 'border-amber-300/40 bg-amber-100/30 text-amber-900'
            : 'border-amber-300/40 bg-amber-100/30 text-amber-900'
        }`}>
          {isPnjReal
            ? 'PNJ đang dùng luồng thật: Affree đăng nhập bằng tài khoản Affree rồi thêm sản phẩm vào giỏ PNJ — bạn không cần tài khoản.'
            : <>Bản mô phỏng — chưa kết nối web thật. Dùng để xem cơ chế trợ lý tự thao tác và dừng lại khi cần bạn.</>
          }
        </div>

        {/* THÔNG TIN CHUNG */}
        <section className="rounded-2xl border border-slate-400 p-3 rounded-2xl border border-slate-400 bg-white/50 p-3">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Thông tin chung</h3>
          <div className="space-y-2.5">
            <Field label="Họ tên">
              <input type="text" value={name}
                onChange={(e) => { setName(e.target.value); saveProfile({ name: e.target.value, phone, address: rawAddress }); }}
                placeholder="Nguyễn Văn A" className={INPUT_CLS} />
            </Field>
            <Field label="Số điện thoại / Zalo">
              <input type="tel" inputMode="tel" value={phone}
                onChange={(e) => { setPhone(e.target.value); saveProfile({ name, phone: e.target.value, address: rawAddress }); }}
                placeholder="0901234567"
                className={phone.trim().length > 0 && !phoneOk ? INPUT_ERR : INPUT_CLS} />
              {phone.trim().length > 0 && !phoneOk && (
                <span className="mt-1 block text-xs text-rose-600">SĐT không hợp lệ (10 số, bắt đầu bằng 03/05/07/08/09)</span>
              )}
            </Field>
            <Field label="Địa chỉ giao hàng">
              <textarea value={rawAddress} rows={2}
                onChange={(e) => { setRawAddress(e.target.value); saveProfile({ name, phone, address: e.target.value }); }}
                placeholder="Số nhà, đường, phường, thành phố"
                className={`${INPUT_CLS} resize-none ${
                  rawAddress.trim() && addressValid === false ? INPUT_ERR : ''
                }`} />
              {rawAddress.trim() && (
                <span className={`mt-1 block text-xs ${
                  checkingAddress
                    ? 'text-slate-400'
                    : addressValid === true
                      ? addressMsg.startsWith('⚠️') ? 'text-amber-600' : 'text-emerald-600'
                      : 'text-rose-600'
                }`}>
                  {checkingAddress ? '⏳ Đang kiểm tra địa chỉ…' : addressMsg}
                </span>
              )}
            </Field>
          </div>
        </section>


        {/* Product + store section */}
        <section className="space-y-3 rounded-2xl border border-slate-400 bg-white/50 p-3">
          {/* Product row — clone OrderAgentModal product card */}
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
            {selectedOffer.product.image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={selectedOffer.product.image} alt={selectedOffer.product.name}
                className="h-14 w-14 shrink-0 rounded-lg object-contain bg-white" />
            ) : (
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-2xl">🛒</div>
            )}
            <div className="min-w-[9rem] flex-1">
              <p className="truncate text-sm font-semibold text-slate-900">{selectedOffer.product.name}</p>
              <p className="mt-0.5 truncate text-xs text-slate-700">
                {selectedOffer.store.chain?.toUpperCase()} · {selectedOffer.store.name}
              </p>
              <div className="mt-1 flex flex-wrap items-center gap-x-2">
                <span className="text-base font-bold text-emerald-600">{totalAmt}</span>
                {qty > 1 && <span className="text-xs text-slate-600">({price} × {qty})</span>}
              </div>
            </div>
            {/* Qty — same as OrderAgentModal */}
            <div className="flex shrink-0 flex-col items-center gap-1 ml-auto">
              <span className="text-[10px] font-medium text-slate-400">Số lượng</span>
              <div className="flex items-center gap-1">
                <button onClick={() => setQty((q) => Math.max(1, q - 1))}
                  className="flex h-7 w-7 items-center justify-center rounded-lg border border-slate-300 bg-white text-base font-medium hover:bg-slate-100">−</button>
                <span className="w-6 text-center text-sm font-semibold">{qty}</span>
                <button onClick={() => setQty((q) => q + 1)}
                  className="flex h-7 w-7 items-center justify-center rounded-lg border border-slate-300 bg-white text-base font-medium hover:bg-slate-100">+</button>
                <button onClick={onClose} aria-label="Xoá sản phẩm & huỷ đơn"
                  className="ml-1 flex h-7 w-7 items-center justify-center rounded-lg border border-slate-300 bg-white text-rose-500 hover:border-rose-300 hover:bg-rose-50">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 6h18" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                    <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                    <line x1="10" y1="11" x2="10" y2="17" /><line x1="14" y1="11" x2="14" y2="17" />
                  </svg>
                </button>
              </div>
            </div>
          </div>

          {/* Size picker — hiện khi có size_modifier_prices từ PNJ API */}
          {(loadingSizes || pnjSizes.length > 0) && (
            <div>
              <span className="mb-1.5 block text-xs font-semibold text-slate-800">
                Size
                {loadingSizes && <span className="ml-1.5 text-[10px] font-normal text-slate-400">(đang tải…)</span>}
              </span>
              {loadingSizes ? (
                <div className="flex gap-1.5">
                  {[1,2,3,4].map((i) => (
                    <div key={i} className="h-8 w-10 animate-pulse rounded-lg bg-slate-200" />
                  ))}
                </div>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {pnjSizes.map((s) => (
                    <button key={s} onClick={() => setSelectedSize(s)}
                      className={`h-8 min-w-[2.5rem] rounded-lg border px-2.5 text-sm font-semibold transition ${
                        selectedSize === s
                          ? "border-emerald-500 bg-emerald-50 text-emerald-700 ring-1 ring-emerald-300"
                          : "border-slate-200 bg-white/60 text-slate-600 hover:bg-slate-50"
                      }`}>
                      {s}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <Field label="Email (nhận hoá đơn)">
            <input type="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder="email@vidu.com" className={INPUT_CLS} />
          </Field>

          <Field label="Ghi chú">
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2}
              placeholder="Ghi chú (tuỳ chọn): màu sắc, kích cỡ, thời gian nhận…"
              className={`${INPUT_CLS} resize-none`} />
          </Field>
        </section>

        {/* Store picker */}
        {sortedOffers.length >= 1 && (
          <section className="rounded-2xl border border-amber-200 bg-amber-50 p-3">
            {geoAddr && rawAddress && geoAddr !== rawAddress && (
              <p className="mb-2.5 text-xs text-amber-800">
                📍 Địa chỉ giao khác với vị trí định vị của bạn — khoảng cách dưới đây tính từ địa chỉ giao, gần nhất xếp trên. Chọn lại nơi mua:
              </p>
            )}
            <div className="mb-2.5 flex gap-2">
              {(["nearest", "cheapest"] as const).map((s) => (
                <button key={s} onClick={() => setStoreSort(s)}
                  className={`rounded-lg px-3 py-1 text-xs font-semibold transition ${storeSort === s ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
                  {s === "nearest" ? "Gần nhất" : "Rẻ nhất"}
                </button>
              ))}
            </div>
            <div className="max-h-52 overflow-y-auto space-y-1.5 overscroll-contain">
              {(() => {
                const minPrice = Math.min(...sortedOffers.map((o) => o.price));
                return sortedOffers.map((o) => {
                  const isSelected = o.store.id === selectedOffer.store.id;
                  const dist = o.distanceKm != null ? `${o.distanceKm.toFixed(1)} km` : "Online";
                  const isCheapest = o.price === minPrice;
                  const logo = chainLogo(o.store.chain as Parameters<typeof chainLogo>[0]);
                  return (
                    <button key={o.store.id} onClick={() => setSelectedOffer(o)}
                      className={`w-full flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition ${isSelected ? "border-emerald-400 bg-emerald-50 ring-1 ring-emerald-300" : "border-slate-200 bg-white/60 hover:bg-slate-50"}`}>
                      <span className="relative flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-amber-100 text-[8px] font-bold text-amber-700 ring-1 ring-slate-200">
                        {(o.store.chain?.toUpperCase() ?? "PNJ").slice(0, 2)}
                        {logo && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={logo} alt={o.store.name}
                            className="absolute inset-0 h-full w-full bg-white object-contain p-0.5"
                            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
                        )}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-semibold text-slate-800">{o.store.name}</p>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <p className="text-[11px] text-slate-400">{dist}</p>
                          {isCheapest && (
                            <span className="shrink-0 rounded px-1.5 py-px text-[10px] font-semibold bg-emerald-100 text-emerald-700">Rẻ nhất</span>
                          )}
                        </div>
                      </div>
                      <div className="shrink-0 flex flex-col items-end gap-px">
                        <span className={`text-xs font-bold ${isSelected ? "text-emerald-700" : "text-rose-600"}`}>
                          {formatMoney(o.price, storeCurrency(o.store.id))}
                        </span>
                        {isSelected && (
                          <span className="text-[10px] font-semibold text-emerald-600">Đang chọn</span>
                        )}
                      </div>
                    </button>
                  );
                });
              })()}
            </div>
          </section>
        )}

        {/* THANH TOÁN */}
        <section className="rounded-2xl border border-slate-400 bg-white/50 p-3">
          <h3 className="mb-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Thanh toán
            {loadingPayments && <span className="ml-1.5 text-[10px] font-normal text-slate-400">(đang tải…)</span>}
          </h3>

          {/* 3 nút cố định — xám nếu API trả is_available: false */}
          {(() => {
            // Map 3 nút → payment_method codes tương ứng trong PNJ API
            const BUTTON_DEFS: { key: "qr" | "card" | "cod"; label: string; emoji: string; codes: string[] }[] = [
              { key: "qr",   label: "QR",  emoji: "📱", codes: ["PAYOO_QRCODE"] },
              { key: "card", label: "Thẻ", emoji: "💳", codes: ["PAYOO_CC"] },
              { key: "cod",  label: "COD", emoji: "💵", codes: ["COD"] },
            ];

            return (
              <div className="flex gap-1.5">
                {BUTTON_DEFS.map(({ key, label, emoji, codes }) => {
                  // Nếu chưa load xong → xem là available (lạc quan)
                  const available = pnjPayments.length === 0
                    ? true
                    : codes.some(code => pnjPayments.find(p => p.payment_method === code)?.is_available);

                  const isSelected =
                    selectedPnjPayment === key ||
                    codes.some(c => c === selectedPnjPayment);

                  return (
                    <button
                      key={key}
                      onClick={() => available && setSelectedPnjPayment(key)}
                      disabled={!available}
                      className={[
                        "flex-1 rounded-lg border py-1.5 text-xs font-semibold transition-colors",
                        available
                          ? isSelected
                            ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                            : "border-slate-200 bg-white/60 text-slate-500 hover:bg-slate-50"
                          : "cursor-not-allowed border-slate-100 bg-slate-50 text-slate-300",
                      ].join(" ")}
                    >
                      {emoji} {label}
                    </button>
                  );
                })}
              </div>
            );
          })()}

          {/* Ghi chú phương thức được chọn */}
          {selectedPnjPayment === "qr"   && <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">📱 Trợ lý sẽ hiện mã QR để bạn quét khi đặt.</p>}
          {selectedPnjPayment === "cod"  && <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">💵 Thanh toán khi nhận hàng — nhân viên giao hàng thu tiền mặt.</p>}
          {selectedPnjPayment === "card" && <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">💳 Trợ lý sẽ hỗ trợ nhập thẻ thanh toán khi đặt hàng trên PNJ.</p>}
        </section>


      </div>

      {/* Footer pinned — shrink-0 so it never overlaps scroll */}
      <div className="shrink-0 border-t border-white/30 px-4 py-3 space-y-2">
        {!payMethod && (
          <p className="text-center text-xs text-amber-600">Chọn phương thức thanh toán để tiếp tục.</p>
        )}
        <div className="flex items-center justify-between text-sm">
          <span className="text-slate-600">Tạm tính</span>
          <span className="font-bold text-emerald-600">{totalAmt}</span>
        </div>
        <button disabled={!canStart} onClick={startOrder}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-emerald-600 py-3 text-sm font-semibold text-white shadow-[0_4px_14px_rgba(16,185,129,0.35),inset_0_1px_0_rgba(255,255,255,0.25)] transition-all duration-150 hover:bg-emerald-700 active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500 disabled:shadow-none disabled:hover:bg-slate-300">
          Để trợ lý đặt giúp →
        </button>
      </div>
    </>
  );

  /* ── RUNNING render — OrderAgentModal demo-mode step style + QR khi payment ── */
  const renderRunning = () => {
    const lastIdx = messages.length - 1;
    return (
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 py-4 space-y-3">

        {/* Product recap + QR code side-by-side (khi chọn QR) — clone OrderAgentModal */}
        <div className="flex items-stretch gap-3">
          <div className="flex min-w-0 flex-1 items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
            {selectedOffer.product.image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={selectedOffer.product.image} alt={selectedOffer.product.name}
                className="h-12 w-12 shrink-0 rounded-lg bg-white object-contain" />
            ) : (
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-xl">🛒</div>
            )}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-slate-900 leading-snug">{selectedOffer.product.name}</p>
              <p className="mt-0.5 text-xs text-slate-700">
                {selectedOffer.store.chain?.toUpperCase()} · {selectedOffer.store.name}
              </p>
              <span className="text-sm font-bold text-emerald-600">{totalAmt}</span>
            </div>
          </div>
          {/* QR thật từ Payoo — chỉ hiện sau khi Step 8 gửi về, KHÔNG hiện placeholder */}
          {(pnjQrImageUrl || pnjQrApiUrl) && (
            <div className="flex w-28 shrink-0 flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-emerald-400 bg-white p-1.5 shadow-lg">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={pnjQrImageUrl || pnjQrApiUrl!}
                alt="QR thanh toán Payoo"
                className="w-full h-auto object-contain"
              />
              <p className="w-full text-center text-[10px] leading-tight text-emerald-600 font-semibold">
                Quét mã Payoo
              </p>
            </div>
          )}
        </div>

        {/* Step list — ✓ checkmark done / spinner current / ○ pause */}
        <ol className="space-y-2.5">
          {messages.map((msg, i) => {
            const isCurrent = i === lastIdx;
            const isDone = i < lastIdx;
            return (
              <li key={i} className="flex items-start gap-2.5">
                <span className="mt-0.5 shrink-0">
                  {isDone ? (
                    <CheckIcon />
                  ) : isCurrent && agentBusy ? (
                    <Spinner />
                  ) : (
                    /* pause dot */
                    <span className="mt-1 flex h-4 w-4 items-center justify-center">
                      <span className="h-2 w-2 rounded-full border-2 border-slate-400" />
                    </span>
                  )}
                </span>
                <p className={`text-sm ${isDone ? "text-slate-400" : "font-medium text-slate-800"}`}>
                  {msg.message}
                </p>
              </li>
            );
          })}
        </ol>

        {/* Payment pause — QR xác nhận */}
        {(paymentPaused && (payMethod === "qr" || !!pnjQrImageUrl)) && (
          <div className="mt-2 rounded-xl border p-2.5 border-blue-200 bg-blue-50">
              <p className="mb-2 text-xs text-slate-600">
                📱 Bạn đã chọn QR chuyển khoản từ đầu — quét mã rồi bấm xác nhận.
              </p>
            <button
              disabled={checkingPayment}
              onClick={() => { setPaymentCheckMsg(null); runPaymentCheck(); }}
              className="w-full rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2">
              {checkingPayment ? (
                <><span className="animate-spin inline-block">⟳</span> Đang kiểm tra...</>
              ) : (
                'Đã chuyển khoản →'
              )}
            </button>
            {paymentCheckMsg && !checkingPayment && (
              <p className={`text-xs text-center mt-1 ${paymentCheckMsg.ok ? 'text-emerald-700' : 'text-amber-700'}`}>
                {paymentCheckMsg.text}
              </p>
            )}
          </div>
        )}

        {/* Thanh toán thất bại (Hình 1 & 2) */}
        {paymentFailed && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-3 space-y-2.5">
            <p className="text-xs font-semibold text-red-700">❌ Thanh toán đơn thất bại</p>
            <p className="text-xs text-red-600">
              Payoo báo lỗi hoặc hết thời gian giao dịch. Vui lòng thử lại.
            </p>
            {pnjPayooUrl && (
              <a href={pnjPayooUrl} target="_blank" rel="noopener noreferrer"
                className="block text-center text-[11px] text-red-700 underline">
                🔗 Mở lại trang Payoo
              </a>
            )}
            <button
              onClick={() => { setPaymentFailed(false); setPaymentPaused(false); }}
              className="w-full rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-semibold text-red-700 transition hover:bg-red-100">
              Thử lại
            </button>
          </div>
        )}

        {paymentPaused && payMethod === "cod" && (
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <p className="mb-2.5 text-xs text-slate-600">
              💵 Đơn đã đặt — nhân viên giao hàng sẽ thu tiền mặt khi giao.
            </p>
            <button
              onClick={() => onPlaced("PNJ-COD-OK", selectedOffer)}
              className="w-full rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-800">
              Xác nhận đơn COD →
            </button>
          </div>
        )}

      </div>
    );
  };

  /* ── Main render — liquid glass shell matching OrderAgentModal ── */
  return (
    <div
      className="fixed inset-0 z-[2200] flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.35)", backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)" }}
      onClick={onClose}
    >
      <div
        className="relative flex max-h-[92vh] w-full max-w-md flex-col overflow-hidden rounded-3xl"
        onClick={(e) => e.stopPropagation()}
        style={{
          backdropFilter: "blur(24px) saturate(160%)",
          WebkitBackdropFilter: "blur(24px) saturate(160%)",
          backgroundColor: "rgba(255,255,255,0.88)",
          boxShadow: "0 0 0 1px rgba(255,255,255,0.5), 0 16px 48px rgba(0,0,0,0.18), inset 0 1px 0 rgba(255,255,255,0.7)",
        }}
      >
        {/* Glass top highlight */}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-20 rounded-t-3xl"
          style={{ background: "linear-gradient(170deg, rgba(255,255,255,0.38) 0%, rgba(255,255,255,0.06) 60%, rgba(255,255,255,0) 100%)" }} />

        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/20 px-4 py-3 shrink-0">
          <div className="min-w-0">
            <h2 className="truncate text-base font-bold text-slate-900">
              {showSuccess ? "Đã đặt hàng" : phase === "running" ? "Trợ lý đang đặt hàng PNJ…" : "Phục vụ bởi Affree Agentic AI - AAAI"}
            </h2>
            <p className="truncate text-xs text-slate-700">
              {selectedOffer.product.name} · {selectedOffer.store.chain?.toUpperCase() || "PNJ"}
            </p>
          </div>
          <button onClick={onClose} className="shrink-0 rounded-full p-1.5 text-slate-500 hover:bg-white/40" aria-label="Đóng">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {phase === "form" ? renderForm() : showSuccess ? renderSuccess() : renderRunning()}
      </div>
    </div>
  );
}
