"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { PRODUCTS, SEED_CATALOG } from "@/lib/seed-catalog";
import { chainLabel, STORES, SOURCE_META } from "@/lib/stores";
import { formatMoney } from "@/lib/util";
import { getProfile } from "@/lib/profile";

type LogEntry = {
  time: string;
  message: string;
  status: "info" | "success" | "warning" | "error";
};

const WALMART_FULFILLMENTS = [
  { value: "shipping", label: "Shipping" },
  { value: "pickup", label: "Store pickup" },
  { value: "delivery", label: "Delivery from store" },
];

const WALMART_PAYMENTS = [
  { value: "card", label: "Credit / debit card" },
  { value: "paypal", label: "PayPal" },
  { value: "giftcard", label: "Walmart gift card" },
  { value: "ebt", label: "EBT/SNAP" },
];

const WALMART_STATES = ["CA", "TX", "NY", "FL", "WA", "IL", "NJ", "MA", "AZ", "GA"];

const AGENT_DEMO_PRODUCTS = [
  ...PRODUCTS,
  {
    id: "demo-cod-mw3-ps5",
    name: "Call of Duty: Modern Warfare III - PlayStation 5",
    brand: "Activision",
    category: "Game",
    unit: "PS5 disc",
  },
];

const AGENT_DEMO_OFFERS = [
  ...SEED_CATALOG.offers,
  {
    productId: "demo-cod-mw3-ps5",
    storeId: "walmart",
    price: 49.94,
    inStock: true,
    productUrl: "https://www.walmart.com/ip/Call-of-Duty-Modern-Warfare-III-PlayStation-5/2974504286",
    lastChecked: new Date().toISOString(),
  },
];

export default function AgentDemoPage() {
  // Trạng thái kết nối
  const [wsUrl, setWsUrl] = useState(process.env.NEXT_PUBLIC_ORDER_AGENT_SERVER_URL || "ws://localhost:8080");
  const [connStatus, setConnStatus] = useState<"disconnected" | "connecting" | "connected" | "error">("disconnected");

  // Trạng thái đơn hàng
  const savedProfile = useMemo(() => getProfile(), []);
  const [buyerName, setBuyerName] = useState(savedProfile.name || "Nguyễn Văn A");
  const [buyerPhone, setBuyerPhone] = useState(savedProfile.phone || "0912345678");
  const [buyerAddress, setBuyerAddress] = useState(savedProfile.address || "5 Đống Đa, Phường 2, Quận Tân Bình, Thành phố Hồ Chí Minh");
  const [buyerEmail, setBuyerEmail] = useState("");
  const [buyerNote, setBuyerNote] = useState("");

  // PNJ payment methods
  type PnjPay = { payment_id: number; payment_method: string; payment: string; is_available: boolean; is_default: boolean; };
  const [pnjPayments, setPnjPayments] = useState<PnjPay[]>([]);
  const [loadingPayments, setLoadingPayments] = useState(false);
  const [buyerPayment, setBuyerPayment] = useState<"qr" | "card" | "cod" | null>(null);
  const [isRealOrder, setIsRealOrder] = useState(false);
  const [pnjQrData, setPnjQrData] = useState<{ qrImageUrl: string | null; payooUrl: string } | null>(null);

  // Chọn sản phẩm test
  const [selectedProductId, setSelectedProductId] = useState(AGENT_DEMO_PRODUCTS[0].id);
  const [selectedChain, setSelectedChain] = useState("concung");
  const [qty, setQty] = useState(1);
  const [customUrl, setCustomUrl] = useState("");
  const [walmartEmail, setWalmartEmail] = useState("");
  const [walmartPassword, setWalmartPassword] = useState("");
  const [walmartStreet, setWalmartStreet] = useState("");
  const [walmartApt, setWalmartApt] = useState("");
  const [walmartCity, setWalmartCity] = useState("Houston");
  const [walmartState, setWalmartState] = useState("TX");
  const [walmartZip, setWalmartZip] = useState("77072");
  const [walmartFulfillment, setWalmartFulfillment] = useState("shipping");
  const [walmartPayment, setWalmartPayment] = useState("card");

  const activeProduct = useMemo(() => AGENT_DEMO_PRODUCTS.find((p) => p.id === selectedProductId)!, [selectedProductId]);
  const isWalmartSelected = selectedChain === "walmart";

  // eslint-disable-next-line react-hooks/exhaustive-deps
  // Tìm URL sản phẩm trong seed catalog tương ứng chuỗi
  const activeOffer = useMemo(() => {
    return AGENT_DEMO_OFFERS.find(
      (o) => o.productId === selectedProductId && o.storeId.startsWith(selectedChain)
    );
  }, [selectedProductId, selectedChain]);

  // Lấy URL thực tế hoặc URL mặc định của chuỗi để điều hướng
  const targetUrl = useMemo(() => {
    if (customUrl) return customUrl;
    if (activeOffer) return activeOffer.productUrl;
    // Fallback URL mặc định
    return SOURCE_META[selectedChain]?.home || "https://concung.com";
  }, [customUrl, activeOffer, selectedChain]);

  const walmartFullAddress = useMemo(() => {
    return [walmartStreet, walmartApt, walmartCity, walmartState, walmartZip]
      .map((item) => item.trim())
      .filter(Boolean)
      .join(", ");
  }, [walmartStreet, walmartApt, walmartCity, walmartState, walmartZip]);

  // Khi đổi chuỗi cửa hàng, tự chọn sản phẩm đầu tiên có hỗ trợ chuỗi đó
  useEffect(() => {
    const hasOffer = AGENT_DEMO_OFFERS.some(
      (o) => o.productId === selectedProductId && o.storeId.startsWith(selectedChain)
    );
    if (!hasOffer) {
      const firstValidOffer = AGENT_DEMO_OFFERS.find((o) => o.storeId.startsWith(selectedChain));
      if (firstValidOffer) {
        setSelectedProductId(firstValidOffer.productId);
      }
    }
  }, [selectedChain, selectedProductId]);

  // Fetch PNJ payment methods khi chain=pnj và sản phẩm/qty thay đổi
  useEffect(() => {
    if (selectedChain !== "pnj") { setPnjPayments([]); return; }
    const productCode = selectedProductId;
    if (!productCode) return;
    setLoadingPayments(true);
    const total = Math.round((activeOffer?.price ?? 0) * qty);
    fetch("/api/pnj-payments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        cart: { total },
        customerPhone: buyerPhone.replace(/[\s.\-()+]/g, "").replace(/^(\+?84)/, "0") || "0900000000",
        deliveryType: "HD",
        products: [{ productCode, quantity: qty, subTotal: total, sizePickerValue: "", plant: "", location: "", batch: "" }],
      }),
    })
      .then(r => r.json())
      .then(json => {
        const methods: PnjPay[] = (json?.data ?? []).map((item: Record<string, PnjPay>) => {
          const key = Object.keys(item)[0]; return item[key];
        });
        setPnjPayments(methods);
        // Auto-select default
        if (!buyerPayment) {
          const BUTTON_CODES: Record<string, string[]> = {
            qr: ["PAYOO_QRCODE"], card: ["PAYOO_CC"], cod: ["COD"]
          };
          const autoKey = (["qr", "card", "cod"] as const).find(k =>
            BUTTON_CODES[k].some(code => methods.find(m => m.payment_method === code)?.is_default && methods.find(m => m.payment_method === code)?.is_available)
          ) ?? (["qr", "card", "cod"] as const).find(k =>
            BUTTON_CODES[k].some(code => methods.find(m => m.payment_method === code)?.is_available)
          );
          if (autoKey) setBuyerPayment(autoKey);
        }
      })
      .catch(() => {})
      .finally(() => setLoadingPayments(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedChain, selectedProductId, qty]);

  // Log và Canvas Refs
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [agentPhase, setAgentPhase] = useState<string>("Nhập thông tin và kết nối Agent");
  const [inputText, setInputText] = useState(""); // Hỗ trợ gửi chuỗi text trực tiếp

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const logsEndRef = useRef<HTMLDivElement | null>(null);
  const isMouseDownRef = useRef(false);

  // Trạng thái pause / chờ can thiệp từ người dùng
  const [pauseContext, setPauseContext] = useState<{
    reason: string;
    message: string;
  } | null>(null);
  const [resumeNote, setResumeNote] = useState("");
  const [isPauseContextMinimized, setIsPauseContextMinimized] = useState(false);

  // Thêm log mới
  const addLog = (message: string, status: "info" | "success" | "warning" | "error" = "info") => {
    const time = new Date().toLocaleTimeString("vi-VN");
    setLogs((prev) => [...prev, { time, message, status }]);
  };

  // Cuộn xuống cuối bảng log khi có log mới
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  // Kết nối và ngắt kết nối WebSocket
  const connectAgent = () => {
    if (wsRef.current) {
      wsRef.current.close();
    }

    const wsSessionId = `demo-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
    const separator = wsUrl.includes("?") ? "&" : "?";

    addLog(`Đang kết nối tới Agent tại: ${wsUrl}...`, "info");
    setConnStatus("connecting");

    fetch(`/api/agent/token?sessionId=${wsSessionId}`)
      .then((res) => {
        if (!res.ok) throw new Error("API token fetch error");
        return res.json();
      })
      .then((data) => {
        const chainParam = selectedChain === "walmart" ? "&chain=walmart" : "";
        let finalUrl = `${wsUrl}${separator}sessionId=${wsSessionId}${chainParam}`;
        if (data.token) {
          finalUrl += `&timestamp=${data.timestamp}&token=${data.token}`;
        }
        const ws = new WebSocket(finalUrl);
        wsRef.current = ws;

        ws.onopen = () => {
          setConnStatus("connected");
          addLog("Kết nối thành công tới AI Agentic!", "success");
          setAgentPhase("Đã kết nối. Sẵn sàng nhận lệnh.");
        };

        ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data);

            if (msg.type === "screencast") {
              // Vẽ frame lên canvas
              const canvas = canvasRef.current;
              if (canvas) {
                const ctx = canvas.getContext("2d");
                if (ctx) {
                  const img = new Image();
                  img.onload = () => {
                    // Xóa và vẽ lại theo tỷ lệ phù hợp
                    ctx.clearRect(0, 0, canvas.width, canvas.height);
                    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                  };
                  img.src = `data:image/jpeg;base64,${msg.data}`;
                }
              }
            } else if (msg.type === "log") {
              addLog(msg.message, msg.status);
            } else if (msg.type === "status") {
              setAgentPhase(msg.phase);
              if (msg.phase === "completed") {
                addLog(`ĐẶT HÀNG THÀNH CÔNG! Đơn hàng hoàn tất tại: ${msg.orderUrl || ""}`, "success");
                setPauseContext(null);
                setIsPauseContextMinimized(false);
              } else if (msg.phase === "failed") {
                addLog(`ĐẶT HÀNG THẤT BẠI: ${msg.error || ""}`, "error");
                setPauseContext(null);
                setIsPauseContextMinimized(false);
              } else if (msg.phase === "running") {
                setPauseContext(null); // Reset khi AI chạy lại
                setIsPauseContextMinimized(false);
              } else if (msg.phase === "waiting_user_input") {
                const reason = msg.pauseReason || msg.reason || "other";
                const message = msg.reason || "Vui lòng thực hiện thao tác thủ công trên màn hình, sau đó bấm Tiếp tục.";
                setPauseContext({ reason, message });
                setIsPauseContextMinimized(false);
                addLog(`⧨ Tạm dừng: ${message}`, "warning");
              } else if (msg.phase === "pnj_qr_ready") {
                setPnjQrData({ qrImageUrl: msg.qrImageUrl || null, payooUrl: msg.payooUrl || "" });
                addLog("💳 QR thanh toán sẵn sàng — quét mã bên phải để thanh toán!", "success");
              }
            }
          } catch (err) {
            console.error("Lỗi parse dữ liệu từ WebSocket:", err);
          }
        };

        ws.onerror = (err) => {
          setConnStatus("error");
          addLog("Lỗi kết nối WebSocket. Hãy kiểm tra địa chỉ và đảm bảo server agent đang chạy.", "error");
          console.error(err);
        };

        ws.onclose = () => {
          setConnStatus("disconnected");
          addLog("Đã ngắt kết nối với AI Agentic.", "warning");
          setAgentPhase("Đã ngắt kết nối");

          // Xóa màn hình canvas
          const canvas = canvasRef.current;
          if (canvas) {
            const ctx = canvas.getContext("2d");
            ctx?.clearRect(0, 0, canvas.width, canvas.height);
          }
        };
      })
      .catch((err) => {
        console.error("Lỗi lấy token xác thực:", err);
        addLog("Lỗi bảo mật khi mở kết nối trình duyệt Co.op", "error");
        setConnStatus("error");
      });
  };

  const disconnectAgent = () => {
    if (wsRef.current) {
      wsRef.current.close();
    }
  };

  // Hủy kết nối khi thoát trang
  useEffect(() => {
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);

  // Gửi lệnh đặt hàng
  const triggerOrder = () => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      addLog("Không thể gửi lệnh: Chưa kết nối tới Agent.", "error");
      return;
    }

    addLog("Đang gửi lệnh đặt hàng tự động...", "info");

    wsRef.current.send(
      JSON.stringify({
        type: "run_order",
        payload: {
          url: targetUrl,
          productUrl: targetUrl,
          productName: activeProduct.name,
          // PNJ: danh mục và size từ seed-catalog (pnjCategory / pnjSize)
          category: activeProduct.pnjCategory ?? "",
          size: activeProduct.pnjSize ?? "",
          qty,
          buyerName,
          buyerPhone,
          buyerEmail: buyerEmail || undefined,
          buyerDob: "01/01/1993",
          buyerGender: "chi",
          buyerNote: buyerNote || undefined,
          paymentMethod: buyerPayment || undefined,
          // Parse địa chỉ: tách province/ward từ cuối chuỗi
          ...(() => {
            const parts = buyerAddress.split(',').map((p: string) => p.trim()).filter(Boolean);
            return {
              buyerProvince: parts.length >= 2 ? parts[parts.length - 1] : undefined,
              buyerWard: parts.length >= 3 ? parts[parts.length - 2] : undefined,
              buyerAddress: parts.length >= 3
                ? parts.slice(0, parts.length - 2).join(', ')
                : (isWalmartSelected ? walmartFullAddress || buyerAddress : buyerAddress),
            };
          })(),
          chain: selectedChain,
          isRealOrder: selectedChain === 'pnj' ? isRealOrder : undefined,
          ...(isWalmartSelected
            ? {
              account: {
                email: walmartEmail,
                password: walmartPassword,
              },
              customer: {
                name: buyerName,
                phone: buyerPhone,
                email: walmartEmail,
              },
              address: {
                street: walmartStreet,
                apt: walmartApt,
                city: walmartCity,
                state: walmartState,
                zip: walmartZip,
                full: walmartFullAddress,
              },
              fulfillment: walmartFulfillment,
              payment: {
                method: walmartPayment,
              },
            }
            : {}),
        }
      })
    );
  };

  // Điều hướng tự do tới URL bất kỳ
  const navigateToUrl = (url: string) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ type: "navigate", url }));
  };

  // Tương tác chuột trên Canvas (Click, Move, Mousedown, Mouseup, Mousemove)
  const handleCanvasInteraction = (
    e: React.MouseEvent<HTMLCanvasElement>,
    type: "click" | "move" | "mousedown" | "mouseup" | "mousemove"
  ) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    // Tọa độ tương đối trên canvas hiển thị
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;

    // Quy đổi ra tọa độ chuẩn 1024x768 của trình duyệt Agent
    const rx = Math.round((cx / rect.width) * 1024);
    const ry = Math.round((cy / rect.height) * 768);

    wsRef.current.send(
      JSON.stringify({
        type,
        x: rx,
        y: ry
      })
    );
  };

  // Gửi phím nhấn
  const handleKeyDown = (e: React.KeyboardEvent<HTMLCanvasElement>) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    e.preventDefault(); // Tránh cuộn trang khi nhấn phím mũi tên/space

    wsRef.current.send(
      JSON.stringify({
        type: "keydown",
        key: e.key
      })
    );
  };

  const handleKeyUp = (e: React.KeyboardEvent<HTMLCanvasElement>) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    e.preventDefault();

    wsRef.current.send(
      JSON.stringify({
        type: "keyup",
        key: e.key
      })
    );
  };

  // Gửi sự kiện cuộn chuột (wheel/scroll) đến trình duyệt Agent
  const handleCanvasWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const rx = Math.round(((e.clientX - rect.left) / rect.width) * 1024);
    const ry = Math.round(((e.clientY - rect.top) / rect.height) * 768);
    wsRef.current.send(JSON.stringify({
      type: "wheel",
      x: rx,
      y: ry,
      deltaX: e.deltaX,
      deltaY: e.deltaY,
    }));
  };

  // Attach wheel listener non-passive để preventDefault hoạt động (tránh cuộn trang)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => { e.preventDefault(); };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, []);

  // Gửi một chuỗi văn bản hoàn chỉnh
  const sendText = () => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN || !inputText) return;

    if (inputText === 'date') {
      wsRef.current.send(
        JSON.stringify({
          type: "delivery_time_selected",
          kind: 'date',
          selectedText: "Ngày mai (02/07)",
          price: "",
          deliveryDate: "02/07/2026",
        })
      );
    } else if (inputText === 'time') {
      wsRef.current.send(
        JSON.stringify({
          type: "delivery_time_selected",
          kind: 'time',
          selectedText: "Từ 07h00 - 08h00",
          price: "15.000đ",
          deliveryDate: "",
        })
      );
    }  else if (inputText.includes('otp')){
      wsRef.current.send(
        JSON.stringify({
          type: "submit_otp",
          otp: inputText.split('otp')[1].trim(),
        })
      );
    } else {
      wsRef.current.send(
        JSON.stringify({
          type: "type",
          text: inputText
        })
      );
    }
    addLog(`Đã gửi chuỗi văn bản: "${inputText}"`, "info");
    setInputText("");
  };

  // Gửi tín hiệu tiếp tục sau khi người dùng hoàn thành thao tác thủ công
  const resumeAgent = (reasonOverride?: string) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    const reason = reasonOverride || pauseContext?.reason || "manual_resume";
    wsRef.current.send(
      JSON.stringify({
        type: "resume_agent",
        reason,
        note: resumeNote || undefined,
      })
    );
    addLog(`✅ Đã gửi tín hiệu tiếp tục cho Agent (reason: ${reason}).`, "success");
    setResumeNote("");
    setPauseContext(null);
    setIsPauseContextMinimized(false);
  };

  // Status indicator colors
  const statusColorClass = {
    disconnected: "bg-slate-500",
    connecting: "bg-amber-500 animate-pulse",
    connected: "bg-emerald-500",
    error: "bg-rose-600"
  }[connStatus];

  const statusLabel = {
    disconnected: "Chưa kết nối",
    connecting: "Đang kết nối...",
    connected: "Đã kết nối",
    error: "Lỗi kết nối"
  }[connStatus];

  return (
    <div className="min-h-screen bg-slate-950 px-4 py-8 text-slate-100 font-sans">
      <div className="mx-auto max-w-7xl">
        {/* Header */}
        <header className="mb-6 flex flex-col justify-between gap-4 border-b border-slate-800 pb-5 sm:flex-row sm:items-center">
          <div>
            <h1 className="bg-gradient-to-r from-emerald-400 to-teal-500 bg-clip-text text-2xl font-bold tracking-tight text-transparent sm:text-3xl">
              AI Agentic Remote Control & Demo View
            </h1>
            <p className="mt-1 text-sm text-slate-400">
              Trang kiểm thử truyền phát và điều khiển tương tác trực tiếp với máy chủ AI Agentic Linux.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-2 rounded-full bg-slate-900 px-3.5 py-1.5 text-xs font-medium border border-slate-800">
              <span className={`h-2.5 w-2.5 rounded-full ${statusColorClass}`} />
              {statusLabel}
            </span>
            {connStatus === "connected" ? (
              <button
                onClick={disconnectAgent}
                className="rounded-lg bg-rose-600/25 px-4 py-1.5 text-xs font-semibold text-rose-400 border border-rose-500/20 hover:bg-rose-600 hover:text-white transition"
              >
                Ngắt kết nối
              </button>
            ) : (
              <button
                onClick={connectAgent}
                disabled={connStatus === "connecting"}
                className="rounded-lg bg-emerald-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50 transition"
              >
                Kết nối Agent
              </button>
            )}
          </div>
        </header>

        {/* Main Grid Layout */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">

          {/* CỘT TRÁI: Bảng điều khiển (5/12) */}
          <div className="space-y-6 lg:col-span-5">

            {/* 1. Cấu hình Kết nối & Máy chủ */}
            <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5 backdrop-blur-md">
              <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-emerald-400">
                1. Cấu hình Máy chủ Agent
              </h2>
              <div className="space-y-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-400">Địa chỉ WebSocket (ws://)</label>
                  <input
                    type="text"
                    value={wsUrl}
                    onChange={(e) => setWsUrl(e.target.value)}
                    disabled={connStatus === "connected"}
                    placeholder="ws://localhost:8080"
                    className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3.5 py-2 text-sm text-slate-200 outline-none focus:border-emerald-500 transition"
                  />
                </div>
                <p className="text-[11px] text-slate-500">
                  * Đảm bảo daemon `node agent-server/server.js` đang chạy trên máy Linux của bạn.
                </p>
              </div>
            </div>

            {/* 2. Chọn sản phẩm & Nguồn bán */}
            <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5 backdrop-blur-md">
              <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-emerald-400">
                2. Chọn Sản phẩm & Nơi bán
              </h2>
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-400">Sản phẩm thử nghiệm</label>
                    <select
                      value={selectedProductId}
                      onChange={(e) => setSelectedProductId(e.target.value)}
                      className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-300 outline-none focus:border-emerald-500"
                    >
                      {AGENT_DEMO_PRODUCTS.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-400">Chuỗi bán hàng</label>
                    <select
                      value={selectedChain}
                      onChange={(e) => setSelectedChain(e.target.value)}
                      className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-300 outline-none focus:border-emerald-500"
                    >
                      <option value="concung">Con Cưng</option>
                      <option value="coop">Co.opmart</option>
                      <option value="bhx">Bách Hóa Xanh</option>
                      <option value="aeon">AEON</option>
                      <option value="pnj">PNJ</option>
                      <option value="walmart">Walmart</option>
                    </select>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <div className="w-24">
                    <label className="mb-1 block text-xs font-medium text-slate-400">Số lượng</label>
                    <div className="flex items-center rounded-lg border border-slate-800 bg-slate-950">
                      <button
                        onClick={() => setQty((q) => Math.max(1, q - 1))}
                        className="flex h-8 w-8 items-center justify-center text-slate-400 hover:text-white"
                      >
                        −
                      </button>
                      <span className="flex-1 text-center text-xs font-semibold">{qty}</span>
                      <button
                        onClick={() => setQty((q) => q + 1)}
                        className="flex h-8 w-8 items-center justify-center text-slate-400 hover:text-white"
                      >
                        +
                      </button>
                    </div>
                  </div>
                  <div className="flex-1">
                    <label className="mb-1 block text-xs font-medium text-slate-400">
                      Giá niêm yết (Ước lượng)
                    </label>
                    <div className="flex h-8 items-center text-sm font-semibold text-rose-500">
                      {activeOffer ? formatMoney(activeOffer.price * qty, "VND") : "N/A"}
                    </div>
                  </div>
                </div>

                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-400">URL sản phẩm tùy chọn (Ghi đè)</label>
                  <input
                    type="text"
                    value={customUrl}
                    onChange={(e) => setCustomUrl(e.target.value)}
                    placeholder="Để trống để dùng URL mẫu trong Sheet..."
                    className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-300 outline-none focus:border-emerald-500"
                  />
                </div>
                {isWalmartSelected && (
                  <div className="rounded-xl border border-blue-500/20 bg-blue-950/20 p-3 text-xs leading-5 text-blue-100">
                    Walmart sẽ chạy agentic bằng Playwright context tạm. Agent bắt đầu từ /orders → Sign In, đăng nhập trước rồi mới mở URL sản phẩm cụ thể, không search lại.
                  </div>
                )}
              </div>
            </div>

            {/* 3. Thông tin người đặt mua */}
            <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5 backdrop-blur-md">
              <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-emerald-400">
                3. Thông tin người mua hàng
              </h2>
              <div className="space-y-3.5">
                {/* Họ tên + SĐT */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-400">Họ và tên</label>
                    <input type="text" value={buyerName} onChange={(e) => setBuyerName(e.target.value)}
                      className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-300 outline-none focus:border-emerald-500" />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-400">Số điện thoại</label>
                    <input type="text" value={buyerPhone} onChange={(e) => setBuyerPhone(e.target.value)}
                      className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-300 outline-none focus:border-emerald-500" />
                  </div>
                </div>
                {/* Email */}
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-400">Email</label>
                  <input type="email" value={buyerEmail} onChange={(e) => setBuyerEmail(e.target.value)}
                    placeholder="example@gmail.com"
                    className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-300 outline-none focus:border-emerald-500" />
                </div>
                {/* Địa chỉ nhận hàng — nhập đủ, tự parse */}
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-400">Địa chỉ nhận hàng</label>
                  <textarea value={buyerAddress} onChange={(e) => setBuyerAddress(e.target.value)} rows={2}
                    placeholder="Số nhà, đường, phường, thành phố"
                    className="w-full resize-none rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-300 outline-none focus:border-emerald-500" />
                </div>

                {/* Ghi chú đơn hàng */}
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-400">Ghi chú đơn hàng</label>
                  <textarea
                    value={buyerNote}
                    onChange={(e) => setBuyerNote(e.target.value)}
                    rows={2}
                    placeholder="Ghi chú thêm cho đơn hàng (tuỳ chọn)…"
                    className="w-full resize-none rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-300 outline-none focus:border-emerald-500 placeholder:text-slate-600"
                  />
                </div>

                {/* Phương thức thanh toán — chỉ hiện khi chọn PNJ */}
                {selectedChain === "pnj" && (
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-400">
                      Thanh toán
                      {loadingPayments && <span className="ml-1 text-[10px] text-slate-500"> (đang tải…)</span>}
                    </label>
                    <div className="flex gap-2">
                      {([
                        { key: "qr"   as const, label: "📱 QR",  codes: ["PAYOO_QRCODE"] },
                        { key: "card" as const, label: "💳 Thẻ", codes: ["PAYOO_CC"] },
                        { key: "cod"  as const, label: "💵 COD", codes: ["COD"] },
                      ]).map(({ key, label, codes }) => {
                        const available = pnjPayments.length === 0
                          ? true
                          : codes.some(code => pnjPayments.find(p => p.payment_method === code)?.is_available);
                        const isSelected = buyerPayment === key;
                        return (
                          <button key={key} type="button"
                            onClick={() => available && setBuyerPayment(key)}
                            disabled={!available}
                            className={[
                              "flex-1 rounded-lg border py-1.5 text-xs font-semibold transition-colors",
                              available
                                ? isSelected
                                  ? "border-emerald-500 bg-emerald-600/20 text-emerald-400 ring-1 ring-emerald-500/40"
                                  : "border-slate-700 bg-slate-900 text-slate-400 hover:border-slate-600"
                                : "cursor-not-allowed border-slate-800 bg-slate-900/40 text-slate-600",
                            ].join(" ")}>
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {selectedChain === "pnj" && (
                  <div className="flex items-center gap-2 rounded-lg border border-rose-900/40 bg-rose-950/20 px-3 py-2">
                    <input
                      id="real-order-toggle"
                      type="checkbox"
                      checked={isRealOrder}
                      onChange={e => setIsRealOrder(e.target.checked)}
                      className="h-3.5 w-3.5 accent-rose-500 cursor-pointer"
                    />
                    <label htmlFor="real-order-toggle" className="cursor-pointer select-none text-xs font-semibold text-rose-400">
                      🚀 Đặt hàng thật (click &quot;Tiếp tục không cần đăng nhập&quot;)
                    </label>
                    {!isRealOrder && (
                      <span className="ml-auto text-[10px] text-slate-500 italic">Demo mode</span>
                    )}
                  </div>
                )}

                {isWalmartSelected && (
                  <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
                    <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-blue-300">
                      Thông tin Walmart agentic
                    </h3>
                    <div className="space-y-3">
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="mb-1 block text-xs font-medium text-slate-400">Email Walmart</label>
                          <input
                            type="email"
                            value={walmartEmail}
                            onChange={(e) => setWalmartEmail(e.target.value)}
                            placeholder="name@example.com"
                            className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-300 outline-none focus:border-blue-500"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-xs font-medium text-slate-400">Mật khẩu Walmart</label>
                          <input
                            type="password"
                            value={walmartPassword}
                            onChange={(e) => setWalmartPassword(e.target.value)}
                            placeholder="Password"
                            className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-300 outline-none focus:border-blue-500"
                          />
                        </div>
                      </div>

                      <div>
                        <label className="mb-1 block text-xs font-medium text-slate-400">Street address</label>
                        <input
                          type="text"
                          value={walmartStreet}
                          onChange={(e) => setWalmartStreet(e.target.value)}
                          placeholder="702 SW 8th St"
                          className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-300 outline-none focus:border-blue-500"
                        />
                      </div>

                      <div className="grid grid-cols-[1fr_0.65fr_0.9fr] gap-3">
                        <div>
                          <label className="mb-1 block text-xs font-medium text-slate-400">City</label>
                          <input
                            type="text"
                            value={walmartCity}
                            onChange={(e) => setWalmartCity(e.target.value)}
                            className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-300 outline-none focus:border-blue-500"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-xs font-medium text-slate-400">State</label>
                          <select
                            value={walmartState}
                            onChange={(e) => setWalmartState(e.target.value)}
                            className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-300 outline-none focus:border-blue-500"
                          >
                            {WALMART_STATES.map((state) => (
                              <option key={state}>{state}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="mb-1 block text-xs font-medium text-slate-400">ZIP</label>
                          <input
                            type="text"
                            value={walmartZip}
                            onChange={(e) => setWalmartZip(e.target.value)}
                            inputMode="numeric"
                            className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-300 outline-none focus:border-blue-500"
                          />
                        </div>
                      </div>

                      <div>
                        <label className="mb-1 block text-xs font-medium text-slate-400">Apt, suite (tuỳ chọn)</label>
                        <input
                          type="text"
                          value={walmartApt}
                          onChange={(e) => setWalmartApt(e.target.value)}
                          placeholder="Apt 4B"
                          className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-300 outline-none focus:border-blue-500"
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="mb-1 block text-xs font-medium text-slate-400">Fulfillment</label>
                          <select
                            value={walmartFulfillment}
                            onChange={(e) => setWalmartFulfillment(e.target.value)}
                            className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-300 outline-none focus:border-blue-500"
                          >
                            {WALMART_FULFILLMENTS.map((item) => (
                              <option key={item.value} value={item.value}>{item.label}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="mb-1 block text-xs font-medium text-slate-400">Payment</label>
                          <select
                            value={walmartPayment}
                            onChange={(e) => setWalmartPayment(e.target.value)}
                            className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-300 outline-none focus:border-blue-500"
                          >
                            {WALMART_PAYMENTS.map((item) => (
                              <option key={item.value} value={item.value}>{item.label}</option>
                            ))}
                          </select>
                        </div>
                      </div>

                      <div className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-[11px] text-slate-400">
                        Payload sẽ gửi `account`, `address`, `fulfillment`, `payment` cho skill Walmart. Agent sẽ dừng nếu gặp OTP/CAPTCHA/review cuối.
                      </div>
                    </div>
                  </div>
                )}

                <div className="pt-2">
                  <button
                    onClick={triggerOrder}
                    disabled={connStatus !== "connected"}
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 py-3 text-sm font-semibold text-white shadow-lg shadow-emerald-900/20 hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50 transition"
                  >
                    🚀 Bắt đầu Đặt hàng tự động
                  </button>
                  {connStatus !== "connected" && (
                    <p className="mt-2 text-center text-xs text-amber-500">
                      * Bạn cần bấm &ldquo;Kết nối Agent&rdquo; trước khi đặt hàng.
                    </p>
                  )}
                </div>
              </div>
            </div>

          </div>

          {/* CỘT PHẢI: Remote Viewport & Logs (7/12) */}
          <div className="space-y-6 lg:col-span-7">

            {/* Trình chiếu màn hình ảo */}
            <div className="flex flex-col rounded-2xl border border-slate-800 bg-slate-900/40 overflow-hidden backdrop-blur-md">
              <div className="flex items-center justify-between border-b border-slate-800 bg-slate-900/70 px-4 py-3">
                <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-teal-400">
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-teal-400 opacity-75"></span>
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-teal-500"></span>
                  </span>
                  Màn hình truyền phát thực tế của Agent (Screencast)
                </span>
                <span className="rounded bg-slate-950 px-2 py-0.5 text-[10px] text-slate-400">
                  {agentPhase}
                </span>
              </div>

              {/* Canvas hiển thị screenshot của trình duyệt */}
              <div className="relative aspect-[4/3] w-full bg-slate-950 flex items-center justify-center">
                <canvas
                  ref={canvasRef}
                  width={1024}
                  height={768}
                  tabIndex={0}
                  onMouseDown={(e) => {
                    isMouseDownRef.current = true;
                    handleCanvasInteraction(e, "mousedown");
                  }}
                  onMouseMove={(e) => {
                    handleCanvasInteraction(e, "mousemove");
                  }}
                  onMouseUp={(e) => {
                    isMouseDownRef.current = false;
                    handleCanvasInteraction(e, "mouseup");
                  }}
                  onMouseLeave={(e) => {
                    if (isMouseDownRef.current) {
                      isMouseDownRef.current = false;
                      handleCanvasInteraction(e, "mouseup");
                    }
                  }}
                  onKeyDown={handleKeyDown}
                  onKeyUp={handleKeyUp}
                  onWheel={handleCanvasWheel}
                  className="h-full w-full cursor-crosshair object-contain outline-none focus:ring-1 focus:ring-emerald-500"
                />

                {connStatus !== "connected" && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/90 text-slate-400 p-6 text-center">
                    <span className="text-4xl mb-3">🖥️</span>
                    <p className="text-sm font-medium">Chưa có kết nối màn hình.</p>
                    <p className="mt-1 text-xs text-slate-500 max-w-xs">
                      Hãy kết nối với Máy chủ Agent và chọn &ldquo;Bắt đầu Đặt hàng&rdquo; để khởi động hiển thị màn hình trình duyệt của Agent.
                    </p>
                  </div>
                )}

                {/* Smart Pause Panel: hiện khi AI dừng chờ người dùng */}
                {pauseContext && !isPauseContextMinimized && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/80 backdrop-blur-sm p-5 z-10">
                    <div className="w-full max-w-sm rounded-2xl border border-amber-500/30 bg-slate-900 shadow-2xl shadow-amber-900/20 overflow-hidden">
                      {/* Header */}
                      <div className="flex items-center gap-3 border-b border-slate-800 bg-amber-500/10 px-4 py-3">
                        <span className="text-2xl">
                          {pauseContext.reason === "otp" && "📱"}
                          {pauseContext.reason === "captcha" && "🤖"}
                          {pauseContext.reason === "payment" && "💳"}
                          {pauseContext.reason === "address" && "📍"}
                          {pauseContext.reason === "review" && "✅"}
                          {pauseContext.reason === "stuck" && "🤔"}
                          {pauseContext.reason === "other" && "👉"}
                          {![
                            "otp","captcha","payment","address","review","stuck","other"
                          ].includes(pauseContext.reason) && "⏸️"}
                        </span>
                        <div>
                          <p className="text-sm font-bold text-amber-400">
                            {pauseContext.reason === "otp" && "Nhập mã OTP"}
                            {pauseContext.reason === "captcha" && "Giải CAPTCHA"}
                            {pauseContext.reason === "payment" && "Chọn thanh toán"}
                            {pauseContext.reason === "address" && "Chọn địa chỉ"}
                            {pauseContext.reason === "review" && "Xem lại đơn hàng"}
                            {pauseContext.reason === "stuck" && "AI cần hỗ trợ"}
                            {![
                              "otp","captcha","payment","address","review","stuck"
                            ].includes(pauseContext.reason) && "Cần thao tác thủ công"}
                          </p>
                          <p className="text-[11px] text-slate-400">AI Agent đang tạm dừng</p>
                        </div>
                      </div>

                      {/* Nội dung hướng dẫn */}
                      <div className="px-4 py-3 text-xs text-slate-300 leading-relaxed">
                        <p>{pauseContext.message}</p>
                      </div>

                      {/* Hướng dẫn cụ thể theo reason */}
                      {pauseContext.reason === "otp" && (
                        <div className="mx-4 mb-3 rounded-lg bg-slate-800 p-3 text-xs text-slate-400">
                          Bạn có thể nhập OTP bằng ô văn bản phía dưới màn hình (mục &ldquo;Gửi chữ&rdquo;) hoặc click trực tiếp vào ô nhập trên màn hình trình duyệt.
                        </div>
                      )}
                      {pauseContext.reason === "review" && (
                        <div className="mx-4 mb-3 rounded-lg bg-emerald-900/30 border border-emerald-700/20 p-3 text-xs text-emerald-400">
                          Kiểm tra kỹ thông tin đơn hàng. Nếu đồng ý, bấm &ldquo;Xác nhận & Đặt hàng&rdquo; — AI sẽ tự click nút xác nhận cuối.
                        </div>
                      )}

                      {/* Ô ghi chú tùy chọn */}
                      <div className="px-4 pb-3">
                        <input
                          type="text"
                          value={resumeNote}
                          onChange={(e) => setResumeNote(e.target.value)}
                          placeholder="Ghi chú cho AI (tùy chọn, ví dụ: đã chọn MoMo)..."
                          className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs text-slate-300 outline-none focus:border-amber-500 transition"
                        />
                      </div>

                      {/* Action buttons */}
                      <div className="flex flex-col gap-2 border-t border-slate-800 p-3">
                        <div className="flex gap-2">
                          {/* Button chính: Tiếp tục */}
                          <button
                            onClick={() => {
                              resumeAgent();
                              setIsPauseContextMinimized(false);
                            }}
                            className="flex-1 rounded-xl bg-emerald-600 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500 active:scale-95 transition-all shadow-lg shadow-emerald-900/30"
                          >
                            ▶ Tiếp tục đặt hàng
                          </button>

                          {/* Button xác nhận + click nút cuối (chỉ cho review) */}
                          {pauseContext.reason === "review" && (
                            <button
                              onClick={() => {
                                if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
                                wsRef.current.send(JSON.stringify({ type: "confirm_final_action" }));
                                addLog("Đã gửi lệnh xác nhận đặt hàng cuối cùng.", "success");
                                setPauseContext(null);
                                setIsPauseContextMinimized(false);
                              }}
                              className="rounded-xl bg-rose-600 px-3 py-2.5 text-xs font-semibold text-white hover:bg-rose-500 active:scale-95 transition-all"
                            >
                              🛒 Click Đặt hàng
                            </button>
                          )}

                          {/* Button hủy / chuyển thủ công */}
                          <button
                            onClick={() => {
                              if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
                              wsRef.current.send(JSON.stringify({ type: "choose_handoff" }));
                              setPauseContext(null);
                              setIsPauseContextMinimized(false);
                            }}
                            className="rounded-xl border border-slate-700 bg-slate-800 px-3 py-2.5 text-xs font-medium text-slate-400 hover:bg-slate-700 active:scale-95 transition-all"
                            title="Chuyển sang thao tác thủ công"
                          >
                            ✋
                          </button>
                        </div>

                        {/* Button Ẩn tạm thời để người dùng thao tác trực tiếp trên canvas */}
                        <button
                          onClick={() => setIsPauseContextMinimized(true)}
                          className="w-full rounded-xl bg-slate-800 border border-slate-700 hover:bg-slate-700 py-2 text-xs font-semibold text-slate-300 active:scale-95 transition-all flex items-center justify-center gap-1.5"
                          title="Tạm ẩn hướng dẫn để bạn thao tác giải captcha/click trực tiếp trên màn hình trình duyệt"
                        >
                          <span>🤏</span>
                          <span>Tạm ẩn để thao tác trực tiếp trên màn hình</span>
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Minimized smart pause panel floating in top-right */}
                {pauseContext && isPauseContextMinimized && (
                  <div className="absolute top-3 right-3 z-20 rounded-xl border border-amber-500/50 bg-slate-900/95 backdrop-blur-sm p-3 shadow-2xl flex flex-col gap-2 max-w-[240px]">
                    <div className="flex items-center gap-2 text-amber-400 font-bold text-xs">
                      <span className="text-base">
                        {pauseContext.reason === "otp" && "📱"}
                        {pauseContext.reason === "captcha" && "🤖"}
                        {pauseContext.reason === "payment" && "💳"}
                        {pauseContext.reason === "address" && "📍"}
                        {pauseContext.reason === "review" && "✅"}
                        {pauseContext.reason === "stuck" && "🤔"}
                        {pauseContext.reason === "other" && "👉"}
                      </span>
                      <span className="truncate">AI đang tạm dừng</span>
                    </div>
                    <p className="text-[10px] text-slate-300 leading-tight">
                      {pauseContext.reason === "captcha" ? "Vui lòng giải CAPTCHA trực tiếp trên màn hình." : pauseContext.message}
                    </p>
                    <div className="flex gap-1.5 mt-1">
                      <button
                        onClick={() => setIsPauseContextMinimized(false)}
                        className="flex-1 rounded-lg bg-slate-800 hover:bg-slate-700 px-2 py-1 text-[10px] font-semibold text-slate-300 border border-slate-700 transition"
                      >
                        🔍 Hiện lại
                      </button>
                      <button
                        onClick={() => {
                          resumeAgent();
                          setIsPauseContextMinimized(false);
                        }}
                        className="flex-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 px-2 py-1 text-[10px] font-bold text-white transition"
                      >
                        ▶ Tiếp tục
                      </button>
                    </div>
                  </div>
                )}

              </div>

              {/* Bảng gõ chữ trực tiếp */}
              {connStatus === "connected" && (
                <div className="flex items-center gap-2 border-t border-slate-800 bg-slate-900/60 p-3">
                  <input
                    type="text"
                    value={inputText}
                    onChange={(e) => setInputText(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && sendText()}
                    placeholder="Nhập chuỗi văn bản gửi tới Agent (như SĐT, OTP, Password)..."
                    className="flex-1 rounded-lg border border-slate-800 bg-slate-950 px-3.5 py-1.5 text-xs text-slate-200 outline-none focus:border-emerald-500"
                  />
                  <button
                    onClick={sendText}
                    className="rounded-lg bg-emerald-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 transition"
                  >
                    Gửi chữ
                  </button>
                </div>
              )}
            </div>

            {/* ── QR Thanh Toán Panel (hiện khi pnjQrData sẵn sàng) ─────── */}
            {pnjQrData && (
              <div className="rounded-2xl border border-emerald-700/40 bg-emerald-950/30 p-4 backdrop-blur-md">
                <div className="flex items-start gap-4">
                  {/* QR Image */}
                  <div className="shrink-0">
                    {pnjQrData.qrImageUrl ? (
                      <div className="rounded-xl overflow-hidden border-2 border-emerald-500/40 bg-white p-1.5 shadow-xl shadow-emerald-900/30">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={pnjQrData.qrImageUrl}
                          alt="QR thanh toán Payoo"
                          className="w-32 h-32 object-contain"
                          crossOrigin="anonymous"
                        />
                      </div>
                    ) : (
                      <div className="w-32 h-32 rounded-xl border-2 border-dashed border-emerald-700/40 flex items-center justify-center text-emerald-700">
                        <span className="text-3xl">📷</span>
                      </div>
                    )}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-bold text-emerald-400 mb-1">💳 Thanh toán QR</h3>
                    <p className="text-xs text-slate-300 mb-2">Quét mã QR bằng app ngân hàng hoặc ví điện tử để hoàn tất thanh toán.</p>
                    {pnjQrData.payooUrl && (
                      <a
                        href={pnjQrData.payooUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-[10px] text-emerald-500 hover:text-emerald-400 underline truncate max-w-full"
                      >
                        🔗 Mở trang Payoo
                      </a>
                    )}
                    <div className="mt-3 flex gap-2">
                      <button
                        onClick={() => setPnjQrData(null)}
                        className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-[11px] font-medium text-slate-400 hover:bg-slate-700 transition"
                      >
                        Ẩn QR
                      </button>
                      <button
                        onClick={() => {
                          if (wsRef.current?.readyState === WebSocket.OPEN) {
                            wsRef.current.send(JSON.stringify({ type: "resume", note: "Đã quét QR và chuyển khoản" }));
                          }
                          setPnjQrData(null);
                        }}
                        className="rounded-lg bg-emerald-600 px-3 py-1.5 text-[11px] font-bold text-white hover:bg-emerald-500 transition"
                      >
                        ✅ Đã chuyển khoản →
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Bảng logs hoạt động của Agent */}
            <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5 backdrop-blur-md flex flex-col h-64">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-emerald-400 shrink-0">
                Nhật ký hoạt động của Agent (Logs)
              </h2>

              <div className="flex-1 overflow-y-auto rounded-lg bg-slate-950 p-3.5 font-mono text-xs space-y-1.5 border border-slate-900">
                {logs.length === 0 ? (
                  <p className="text-slate-600 italic">Chưa có nhật ký hoạt động...</p>
                ) : (
                  logs.map((log, i) => {
                    const colorClass = {
                      info: "text-blue-400",
                      success: "text-emerald-400",
                      warning: "text-amber-400 font-medium",
                      error: "text-rose-400 font-bold"
                    }[log.status];

                    return (
                      <div key={i} className="flex items-start gap-2 leading-relaxed">
                        <span className="text-slate-600 shrink-0">[{log.time}]</span>
                        <span className={colorClass}>{log.message}</span>
                      </div>
                    );
                  })
                )}
                <div ref={logsEndRef} />
              </div>
            </div>

          </div>

        </div>
      </div>
    </div>
  );
}
