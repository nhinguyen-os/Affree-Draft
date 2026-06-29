import { randomUUID, createHmac } from "node:crypto";

import WebSocket from "ws";

import { getOrderSessionStore, type InMemoryOrderSessionStore } from "./session-store";
import type {
  OrderRequiredInput,
  OrderSessionEvent,
  OrderSessionPrivateState,
  OrderSessionUpdate,
} from "./types";

export interface OrderWorkerClient {
  startSession(sessionId: string): void;
  handleEvent(sessionId: string, event: OrderSessionEvent): void;
  cancelSession(sessionId: string): void;
}

type AgentServerInboundMessage =
  | { type: "ready" }
  | { type: "log"; message?: string; status?: string }
  | { type: "status"; phase?: string; orderUrl?: string; error?: string; reason?: string; requiredInput?: string }
  | { type: "screencast"; data?: string };

interface WorkerConnection {
  sessionId: string;
  socket: WebSocket;
  lastLogHint?: string;
  runOrderSent?: boolean;
  readyReceived?: boolean;
  fallbackRunOrderTimer?: ReturnType<typeof setTimeout>;
}

function sendJson(socket: WebSocket, payload: unknown, onError?: (message: string) => void) {
  try {
    socket.send(JSON.stringify(payload), (error) => {
      if (error && onError) onError(error.message);
    });
  } catch (error) {
    if (onError) onError(error instanceof Error ? error.message : String(error));
  }
}

const AGENT_SERVER_URL = process.env.NEXT_PUBLIC_ORDER_AGENT_SERVER_URL || process.env.ORDER_AGENT_SERVER_URL || "ws://127.0.0.1:8080";
const AGENT_SERVER_SECRET_TOKEN = process.env.NEXT_PUBLIC_ORDER_AGENT_SERVER_SECRET_TOKEN || process.env.ORDER_AGENT_SERVER_SECRET_TOKEN || "";
const ENABLE_REAL_AGENT_SERVER = process.env.ORDER_AGENT_SERVER_DISABLED !== "true";

function inferRequiredInput(text?: string): OrderRequiredInput | undefined {
  if (!text) return undefined;
  const normalized = text.toLowerCase();
  if (normalized.includes("otp")) return "otp";
  if (normalized.includes("captcha") || normalized.includes("robot")) return "captcha";
  if (normalized.includes("đăng nhập") || normalized.includes("login") || normalized.includes("mật khẩu") || normalized.includes("password")) {
    return "login";
  }
  if (normalized.includes("qr") || normalized.includes("chuyển khoản") || normalized.includes("thanh toán")) {
    return "qr_payment";
  }
  if (normalized.includes("xác nhận") || normalized.includes("confirm") || normalized.includes("kiểm tra đơn")) {
    return "final_confirmation";
  }
  return undefined;
}

function progressForRequiredInput(requiredInput?: OrderRequiredInput): number {
  switch (requiredInput) {
    case "otp":
      return 55;
    case "captcha":
      return 70;
    case "login":
      return 45;
    case "qr_payment":
      return 88;
    case "final_confirmation":
      return 90;
    default:
      return 60;
  }
}

function statusPatchFromRequiredInput(requiredInput?: OrderRequiredInput): OrderSessionUpdate {
  switch (requiredInput) {
    case "otp":
      return {
        status: "waiting_for_otp",
        step: "waiting_for_otp",
        progress: progressForRequiredInput(requiredInput),
        requiredInput,
        message: "Worker đang chờ OTP từ người dùng",
      };
    case "captcha":
      return {
        status: "waiting_for_captcha",
        step: "waiting_for_captcha",
        progress: progressForRequiredInput(requiredInput),
        requiredInput,
        message: "Worker đang chờ người dùng xác minh CAPTCHA",
      };
    case "login":
      return {
        status: "waiting_for_login",
        step: "waiting_for_login",
        progress: progressForRequiredInput(requiredInput),
        requiredInput,
        message: "Worker đang chờ người dùng tiếp tục bước đăng nhập",
      };
    case "qr_payment":
      return {
        status: "waiting_for_qr_payment",
        step: "waiting_for_qr_payment",
        progress: progressForRequiredInput(requiredInput),
        requiredInput,
        message: "Worker đang chờ người dùng thanh toán QR",
      };
    case "final_confirmation":
    default:
      return {
        status: "waiting_for_final_confirmation",
        step: "waiting_for_final_confirmation",
        progress: progressForRequiredInput(requiredInput),
        requiredInput: requiredInput ?? "final_confirmation",
        message: "Worker đã tới bước cần xác nhận cuối cùng",
      };
  }
}

function buildAgentPayload(session: OrderSessionPrivateState) {
  return {
    sessionId: session.id,
    chain: session.provider,
    url: session.offer.productUrl,
    productName: session.offer.productName,
    qty: session.quantity,
    buyerName: session.customer.name,
    buyerPhone: session.customer.phone,
    buyerAddress: session.customer.address,
    buyerNote: session.customer.note,
    slot: session.delivery?.slot,
  };
}

export function createMockOrderWorkerClient(store: InMemoryOrderSessionStore = getOrderSessionStore()): OrderWorkerClient {
  const queueTransition = (sessionId: string, delayMs: number, action: () => void) => {
    setTimeout(() => {
      const session = store.get(sessionId);
      if (!session || ["completed", "failed", "cancelled", "expired"].includes(session.status)) return;
      action();
    }, delayMs);
  };

  return {
    startSession(sessionId) {
      queueTransition(sessionId, 100, () => {
        store.update(sessionId, {
          status: "running",
          step: "agent_server_unavailable",
          progress: 10,
          message: "Không nối được agent-server, đang dùng mock worker fallback",
        });
      });
      queueTransition(sessionId, 600, () => {
        store.update(sessionId, {
          status: "waiting_for_final_confirmation",
          step: "review_order",
          progress: 85,
          message: "Mock worker đã chuẩn bị xong. Cần bạn xác nhận trước khi hoàn tất thử nghiệm.",
          requiredInput: "final_confirmation",
        });
      });
    },
    handleEvent(sessionId, event) {
      const session = store.get(sessionId);
      if (!session) return;
      if (event.type === "cancel") {
        store.update(sessionId, {
          status: "cancelled",
          step: "cancelled",
          progress: session.progress,
          message: "Phiên đặt hàng đã được hủy",
          requiredInput: undefined,
        });
        return;
      }
      if (event.type === "choose_handoff") {
        store.update(sessionId, {
          status: "failed",
          step: "handoff",
          progress: session.progress,
          message: "Đã chuyển sang tiếp tục thủ công trên website",
          handoffUrl: session.offer.productUrl,
          requiredInput: undefined,
        });
        return;
      }
      if (event.type === "confirm_final_action" && session.status === "waiting_for_final_confirmation") {
        store.update(sessionId, {
          status: "completed",
          step: "completed",
          progress: 100,
          message: "Mock worker đã hoàn tất đơn thử nghiệm",
          requiredInput: undefined,
          orderCode: `#TXNN-${randomUUID().slice(0, 8).toUpperCase()}`,
        });
      }
    },
    cancelSession(sessionId) {
      const session = store.get(sessionId);
      if (!session) return;
      store.update(sessionId, {
        status: "cancelled",
        step: "cancelled",
        progress: session.progress,
        message: "Phiên đặt hàng đã được hủy",
        requiredInput: undefined,
      });
    },
  };
}

class AgentServerBridgeClient implements OrderWorkerClient {
  private readonly store: InMemoryOrderSessionStore;
  private readonly fallback: OrderWorkerClient;
  private readonly connections = new Map<string, WorkerConnection>();

  constructor(store: InMemoryOrderSessionStore) {
    this.store = store;
    this.fallback = createMockOrderWorkerClient(store);
  }

  startSession(sessionId: string) {
    const session = this.store.get(sessionId);
    if (!session) return;
    if (!ENABLE_REAL_AGENT_SERVER) {
      this.fallback.startSession(sessionId);
      return;
    }

    try {
      const timestamp = Date.now().toString();
      const separator = AGENT_SERVER_URL.includes("?") ? "&" : "?";
      let urlWithSession = `${AGENT_SERVER_URL}${separator}sessionId=${sessionId}`;
      if (AGENT_SERVER_SECRET_TOKEN) {
        const hmac = createHmac("sha256", AGENT_SERVER_SECRET_TOKEN);
        hmac.update(`${sessionId}:${timestamp}`);
        const token = hmac.digest("hex");
        urlWithSession += `&timestamp=${timestamp}&token=${token}`;
      }
      const socket = new WebSocket(urlWithSession);
      const connection: WorkerConnection = { sessionId, socket };
      this.connections.set(sessionId, connection);

      this.store.update(sessionId, {
        status: "running",
        step: "connect_agent_server",
        progress: 5,
        message: `Đang kết nối agent-server tại ${urlWithSession.replace(/token=[^&]+/, "token=***")}`,
      });

      socket.on("open", () => {
        this.store.update(sessionId, {
          status: "running",
          step: "start_remote_worker",
          progress: 10,
          message: "Đã kết nối agent-server, đang chờ worker browser sẵn sàng",
        });
      });

      socket.on("message", (raw) => {
        this.handleInboundMessage(connection, raw.toString());
      });

      socket.on("close", () => {
        if (connection.fallbackRunOrderTimer) clearTimeout(connection.fallbackRunOrderTimer);
        this.connections.delete(sessionId);
        const current = this.store.get(sessionId);
        if (!current || ["completed", "failed", "cancelled", "expired"].includes(current.status)) return;
        this.store.update(sessionId, {
          status: "failed",
          step: "agent_server_disconnected",
          progress: current.progress,
          message: "Kết nối agent-server đã bị đóng trước khi hoàn tất đơn hàng",
          error: "agent-server connection closed",
        });
      });

      socket.on("error", (error) => {
        this.connections.delete(sessionId);
        const current = this.store.get(sessionId);
        if (current && !["completed", "failed", "cancelled", "expired"].includes(current.status)) {
          this.store.update(sessionId, {
            status: "failed",
            step: "agent_server_error",
            progress: current.progress,
            message: "Không kết nối được agent-server, chuyển sang fallback mock worker",
            error: error.message,
          });
        }
        this.fallback.startSession(sessionId);
      });
    } catch {
      this.fallback.startSession(sessionId);
    }
  }

  handleEvent(sessionId: string, event: OrderSessionEvent) {
    const session = this.store.get(sessionId);
    if (!session) return;

    const connection = this.connections.get(sessionId);
    if (!connection || connection.socket.readyState !== WebSocket.OPEN) {
      this.fallback.handleEvent(sessionId, event);
      return;
    }

    switch (event.type) {
      case "otp_submitted":
        this.store.update(sessionId, {
          status: "running",
          step: "resume_after_otp",
          progress: Math.max(session.progress, 60),
          message: "Đã gửi OTP cho agent-server, đang tiếp tục xử lý",
          requiredInput: undefined,
        });
        connection.socket.send(JSON.stringify({ type: "submit_otp", otp: event.otp }));
        break;
      case "captcha_completed":
        this.store.update(sessionId, {
          status: "running",
          step: "resume_after_captcha",
          progress: Math.max(session.progress, 75),
          message: "Đã báo hoàn tất CAPTCHA cho agent-server",
          requiredInput: undefined,
        });
        connection.socket.send(JSON.stringify({ type: "captcha_completed" }));
        break;
      case "confirm_final_action":
        this.store.update(sessionId, {
          status: "running",
          step: "submit_order",
          progress: Math.max(session.progress, 92),
          message: "Đã xác nhận bước cuối, agent-server đang gửi đơn",
          requiredInput: undefined,
        });
        connection.socket.send(JSON.stringify({ type: "confirm_final_action" }));
        break;
      case "payment_submitted":
        this.store.update(sessionId, {
          status: "verifying_payment",
          step: "verify_payment",
          progress: Math.max(session.progress, 93),
          message: "Đã báo thanh toán xong, agent-server đang xác minh",
          requiredInput: undefined,
        });
        connection.socket.send(JSON.stringify({ type: "payment_submitted" }));
        break;
      case "choose_handoff":
        this.store.update(sessionId, {
          status: "failed",
          step: "handoff",
          progress: session.progress,
          message: "Đã chuyển sang tiếp tục thủ công trên website",
          requiredInput: undefined,
          handoffUrl: session.offer.productUrl,
        });
        connection.socket.send(JSON.stringify({ type: "choose_handoff" }));
        this.safeClose(sessionId);
        break;
      case "cancel":
        this.store.update(sessionId, {
          status: "cancelled",
          step: "cancelled",
          progress: session.progress,
          message: "Phiên đặt hàng đã được hủy",
          requiredInput: undefined,
        });
        connection.socket.send(JSON.stringify({ type: "cancel_order" }));
        this.safeClose(sessionId);
        break;
    }
  }

  cancelSession(sessionId: string) {
    this.handleEvent(sessionId, { type: "cancel" });
  }

  private handleInboundMessage(connection: WorkerConnection, raw: string) {
    let message: AgentServerInboundMessage;
    try {
      message = JSON.parse(raw) as AgentServerInboundMessage;
    } catch {
      return;
    }

    const session = this.store.get(connection.sessionId);
    if (!session) return;

    if (message.type === "ready") {
      connection.readyReceived = true;
      if (connection.fallbackRunOrderTimer) {
        clearTimeout(connection.fallbackRunOrderTimer);
        connection.fallbackRunOrderTimer = undefined;
      }
      if (!connection.runOrderSent) {
        connection.runOrderSent = true;
        const latest = this.store.get(connection.sessionId);
        if (latest) {
          this.store.update(connection.sessionId, {
            status: "running",
            step: "remote_ready",
            progress: Math.max(session.progress, 12),
            message: "Worker browser đã sẵn sàng, đang gửi lệnh đặt hàng",
          });
          setTimeout(() => {
            this.store.update(connection.sessionId, {
              status: "running",
              step: "remote_ready",
              progress: Math.max(session.progress, 12),
              message: "Bridge chuẩn bị gửi run_order sang agent-server",
            });
            sendJson(connection.socket, { type: "run_order", payload: buildAgentPayload(latest) }, (errorMessage) => {
              this.store.update(connection.sessionId, {
                status: "failed",
                step: "agent_server_send_failed",
                progress: Math.max(session.progress, 12),
                message: `Gửi run_order thất bại: ${errorMessage}`,
                error: errorMessage,
              });
            });
          }, 0);
        }
      }
      return;
    }

    if (message.type === "log") {
      if (!message.message) return;
      connection.lastLogHint = message.message;
      if (!connection.runOrderSent && !connection.readyReceived && /khởi tạo trình duyệt thành công/i.test(message.message)) {
        this.store.update(connection.sessionId, {
          status: "running",
          step: "remote_ready",
          progress: Math.max(session.progress, 12),
          message: "Worker browser đã sẵn sàng, đang chờ tín hiệu ready từ agent-server",
        });
        if (!connection.fallbackRunOrderTimer) {
          connection.fallbackRunOrderTimer = setTimeout(() => {
            connection.fallbackRunOrderTimer = undefined;
            if (connection.runOrderSent || connection.readyReceived) return;
            connection.runOrderSent = true;
            const latest = this.store.get(connection.sessionId);
            if (!latest) return;
            this.store.update(connection.sessionId, {
              status: "running",
              step: "remote_ready",
              progress: Math.max(session.progress, 12),
              message: "Không thấy ready, bridge fallback gửi run_order sang agent-server",
            });
            sendJson(connection.socket, { type: "run_order", payload: buildAgentPayload(latest) }, (errorMessage) => {
              this.store.update(connection.sessionId, {
                status: "failed",
                step: "agent_server_send_failed",
                progress: Math.max(session.progress, 12),
                message: `Gửi run_order thất bại: ${errorMessage}`,
                error: errorMessage,
              });
            });
          }, 750);
        }
        return;
      }
      if (/AI loop không xử lý được tiếp; giữ nguyên màn hình để user tự thao tác\./i.test(message.message)) {
        this.store.update(connection.sessionId, {
          ...statusPatchFromRequiredInput("final_confirmation"),
          handoffUrl: session.offer.productUrl,
          message: message.message,
        });
        return;
      }
      this.store.update(connection.sessionId, {
        status: session.status === "created" ? "running" : session.status,
        step: session.step,
        progress: Math.max(session.progress, 12),
        message: message.message,
      });
      return;
    }

    if (message.type === "status") {
      const phase = message.phase;
      if (phase === "running") {
        const reason = message.reason?.startsWith("resume:")
          ? "Agent-server đang tiếp tục xử lý sau thao tác người dùng"
          : message.reason;
        this.store.update(connection.sessionId, {
          status: "running",
          step: session.step === "created" ? "remote_running" : session.step,
          progress: Math.max(session.progress, 20),
          message: reason || session.message || "Agent-server đang xử lý đơn hàng",
          requiredInput: undefined,
        });
        return;
      }

      if (phase === "waiting_user_input") {
        const requiredInput = inferRequiredInput(message.reason || connection.lastLogHint || session.message);
        this.store.update(connection.sessionId, {
          ...statusPatchFromRequiredInput(requiredInput),
          handoffUrl: session.offer.productUrl,
          message: message.reason || connection.lastLogHint || statusPatchFromRequiredInput(requiredInput).message,
        });
        return;
      }

      if (phase === "completed") {
        this.store.update(connection.sessionId, {
          status: "completed",
          step: "completed",
          progress: 100,
          message: "Agent-server báo đặt hàng thành công",
          requiredInput: undefined,
          handoffUrl: message.orderUrl || session.offer.productUrl,
          orderCode: session.orderCode || `#TXNN-${randomUUID().slice(0, 8).toUpperCase()}`,
        });
        this.safeClose(connection.sessionId);
        return;
      }

      if (phase === "cancelled") {
        this.store.update(connection.sessionId, {
          status: "cancelled",
          step: "cancelled",
          progress: session.progress,
          message: message.error || "Phiên đặt hàng đã bị hủy từ orchestrator.",
          error: undefined,
          handoffUrl: message.orderUrl || session.offer.productUrl,
          requiredInput: undefined,
        });
        this.safeClose(connection.sessionId);
        return;
      }

      if (phase === "failed") {
        this.store.update(connection.sessionId, {
          status: "failed",
          step: "failed",
          progress: session.progress,
          message: message.error || "Agent-server báo thất bại",
          error: message.error || "agent-server failed",
          handoffUrl: session.offer.productUrl,
          requiredInput: undefined,
        });
        this.safeClose(connection.sessionId);
      }
    }
  }

  private safeClose(sessionId: string) {
    const connection = this.connections.get(sessionId);
    if (!connection) return;
    this.connections.delete(sessionId);
    try {
      if (connection.socket.readyState === WebSocket.OPEN || connection.socket.readyState === WebSocket.CONNECTING) {
        connection.socket.close();
      }
    } catch {
      // ignore
    }
  }
}

const globalWorker = globalThis as typeof globalThis & {
  __oneAffreeOrderWorkerClient?: OrderWorkerClient;
};

export function getOrderWorkerClient(): OrderWorkerClient {
  if (!globalWorker.__oneAffreeOrderWorkerClient) {
    globalWorker.__oneAffreeOrderWorkerClient = new AgentServerBridgeClient(getOrderSessionStore());
  }
  return globalWorker.__oneAffreeOrderWorkerClient;
}
