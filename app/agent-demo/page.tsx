"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { PRODUCTS, SEED_CATALOG } from "@/lib/seed-catalog";
import { chainLabel, STORES } from "@/lib/stores";
import { formatMoney } from "@/lib/util";
import { getProfile } from "@/lib/profile";

type LogEntry = {
  time: string;
  message: string;
  status: "info" | "success" | "warning" | "error";
};

export default function AgentDemoPage() {
  // Trạng thái kết nối
  const [wsUrl, setWsUrl] = useState(process.env.NEXT_PUBLIC_ORDER_AGENT_SERVER_URL || "ws://localhost:8080");
  const [connStatus, setConnStatus] = useState<"disconnected" | "connecting" | "connected" | "error">("disconnected");

  // Trạng thái đơn hàng
  const savedProfile = useMemo(() => getProfile(), []);
  const [buyerName, setBuyerName] = useState(savedProfile.name || "Nguyễn Văn A");
  const [buyerPhone, setBuyerPhone] = useState(savedProfile.phone || "0912345678");
  const [buyerAddress, setBuyerAddress] = useState(savedProfile.address || "5 Đống Đa, Phường 2, Quận Tân Bình, Thành phố Hồ Chí Minh");

  // Chọn sản phẩm test
  const [selectedProductId, setSelectedProductId] = useState(PRODUCTS[0].id);
  const [selectedChain, setSelectedChain] = useState("concung");
  const [qty, setQty] = useState(1);
  const [customUrl, setCustomUrl] = useState("");

  const activeProduct = useMemo(() => PRODUCTS.find((p) => p.id === selectedProductId)!, [selectedProductId]);

  // Tìm URL sản phẩm trong seed catalog tương ứng chuỗi
  const activeOffer = useMemo(() => {
    return SEED_CATALOG.offers.find(
      (o) => o.productId === selectedProductId && o.storeId.startsWith(selectedChain)
    );
  }, [selectedProductId, selectedChain]);

  // Lấy URL thực tế hoặc URL mặc định của chuỗi để điều hướng
  const targetUrl = useMemo(() => {
    if (customUrl) return customUrl;
    if (activeOffer) return activeOffer.productUrl;
    // Fallback URL mặc định
    const store = STORES.find((s) => s.chain === selectedChain);
    return store ? store.website : "https://concung.com";
  }, [customUrl, activeOffer, selectedChain]);

  // Log và Canvas Refs
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [agentPhase, setAgentPhase] = useState<string>("Nhập thông tin và kết nối Agent");
  const [inputText, setInputText] = useState(""); // Hỗ trợ gửi chuỗi text trực tiếp

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const logsEndRef = useRef<HTMLDivElement | null>(null);
  const isMouseDownRef = useRef(false);

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
        let finalUrl = `${wsUrl}${separator}sessionId=${wsSessionId}`;
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
              } else if (msg.phase === "failed") {
                addLog(`ĐẶT HÀNG THẤT BẠI: ${msg.error || ""}`, "error");
              } else if (msg.phase === "waiting_user_input") {
                addLog("Trình duyệt đang chờ bạn tương tác nhập OTP hoặc thanh toán trực tiếp trên màn hình.", "warning");
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
          productName: activeProduct.name,
          qty,
          buyerName,
          buyerPhone,
          buyerAddress,
          chain: selectedChain
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

  // Gửi một chuỗi văn bản hoàn chỉnh
  const sendText = () => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN || !inputText) return;

    wsRef.current.send(
      JSON.stringify({
        type: "type",
        text: inputText
      })
    );
    addLog(`Đã gửi chuỗi văn bản: "${inputText}"`, "info");
    setInputText("");
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
                      {PRODUCTS.map((p) => (
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
              </div>
            </div>

            {/* 3. Thông tin người đặt mua */}
            <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5 backdrop-blur-md">
              <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-emerald-400">
                3. Thông tin người mua hàng
              </h2>
              <div className="space-y-3.5">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-400">Họ và tên</label>
                    <input
                      type="text"
                      value={buyerName}
                      onChange={(e) => setBuyerName(e.target.value)}
                      className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-300 outline-none focus:border-emerald-500"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-400">Số điện thoại</label>
                    <input
                      type="text"
                      value={buyerPhone}
                      onChange={(e) => setBuyerPhone(e.target.value)}
                      className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-300 outline-none focus:border-emerald-500"
                    />
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-400">Địa chỉ nhận hàng</label>
                  <textarea
                    value={buyerAddress}
                    onChange={(e) => setBuyerAddress(e.target.value)}
                    rows={2}
                    className="w-full resize-none rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-300 outline-none focus:border-emerald-500"
                  />
                </div>

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

                {agentPhase === "waiting_user_input" && (
                  <div className="absolute bottom-4 left-4 right-4 rounded-xl bg-amber-500/90 p-3 text-slate-950 text-xs font-medium backdrop-blur shadow-lg flex items-center gap-3 animate-bounce">
                    <span className="text-lg">⚠️</span>
                    <div className="flex-1">
                      <p className="font-bold">ĐANG CHỜ TƯƠNG TÁC CON NGƯỜI</p>
                      <p className="text-[11px] opacity-80">Vui lòng nhấp chuột và gõ phím trực tiếp trên khung màn hình ở trên để nhập OTP/thanh toán.</p>
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
