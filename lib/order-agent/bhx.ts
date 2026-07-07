import { type Dispatch, type SetStateAction } from "react";

export type BhxOrderRuntime = {
  setStepIndex: Dispatch<SetStateAction<number>>;
  setOtp: Dispatch<SetStateAction<string>>;
  setOtpError: Dispatch<SetStateAction<boolean>>;
  setSimOtp: Dispatch<SetStateAction<string>>;
  setPhase: Dispatch<SetStateAction<"form" | "running" | "done">>;
  setBhxBusy: Dispatch<SetStateAction<boolean>>;
  setOrderCode: Dispatch<SetStateAction<string>>;
  setBhxQR: Dispatch<SetStateAction<string | null>>;
  getSlotKey: () => string | null;
  getAgentWsUrl: (sessionId: string, chain?: string) => Promise<string>;
  otp: string;
  activeOffer: { productUrl: string; product: { name: string }; store: { chain: string } };
  qty: number;
  name: string;
  phone: string;
  address: string;
  demoPayMethod?: string | null;
  t: (vi: string, vars?: Record<string, string | number>) => string;
};

const bhxBrowserWsRef = { current: null as WebSocket | null };

export async function startBHXOrder(ctx: BhxOrderRuntime): Promise<void> {
  if (bhxBrowserWsRef.current) {
    bhxBrowserWsRef.current.close();
  }

  ctx.setStepIndex(0);
  ctx.setOtp("");
  ctx.setOtpError(false);
  ctx.setSimOtp("");
  ctx.setPhase("running");
  ctx.setBhxBusy(true);
  ctx.setBhxQR(null);

  const wsSessionId = `bhx-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
  const wsUrl = await ctx.getAgentWsUrl(wsSessionId, ctx.activeOffer.store.chain);
  const ws = new WebSocket(wsUrl);
  bhxBrowserWsRef.current = ws;

  const sendBHXOrderRequest = () => {
    try {
      ws.send(
        JSON.stringify({
          type: "run_order",
          payload: {
            url: ctx.activeOffer.productUrl,
            productName: ctx.activeOffer.product.name,
            qty: ctx.qty,
            buyerName: ctx.name,
            buyerPhone: ctx.phone,
            buyerAddress: ctx.address,
            chain: ctx.activeOffer.store.chain,
            paymentMethod: ctx.demoPayMethod ?? "cod",
            slot: ctx.getSlotKey(),
          },
        }),
      );
    } catch (err) {
      ctx.setBhxBusy(false);
    }
  };

  ws.onmessage = (event) => {
    try {
      const message = JSON.parse(String(event.data)) as {
        type?: string;
        message?: string;
        status?: string;
        phase?: string;
        content?: string;
        data?: string;
        width?: number;
        height?: number;
      };
      if (message.type === "status") {
        if (message.phase === "ready") {
          sendBHXOrderRequest();
        } else if (message.phase === "failed" || message.phase === "done" || message.phase === "success") {
          ctx.setBhxBusy(false);
        }
      } else if (message.type === "input_otp") {
        ctx.setStepIndex(1);
      } else if (message.type === "login_success") {
        ctx.setStepIndex(2);
      } else if (message.type === "address_complete") {
        ctx.setStepIndex(3);
      } else if (message.type === "add_to_cart_success") {
        ctx.setStepIndex(4);
      } else if (message.type === "select_slot_complete") {
        ctx.setStepIndex(5);
      } else if (message.type === "order_code" && message.content) {
        ctx.setOrderCode(message.content);
      } else if (message.type === "order_success" && message.content) {
        ctx.setBhxBusy(false);
        ctx.setBhxQR(message.content);
        ctx.setStepIndex(7);
      }
    } catch (err) {
      console.error("Error handling BHX agent message:", err);
    }
  };
  ws.onerror = () => {
    ctx.setBhxBusy(false);
  };
  ws.onclose = () => {
    ctx.setBhxBusy(false);
  };
}

export async function submitBHXOtp(ctx: BhxOrderRuntime) {
  const code = ctx.otp.trim();
  if (!code) return;

  const ws = bhxBrowserWsRef.current;
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    return;
  }

  ws.send(JSON.stringify({ type: "submit_otp", otp: code }));
}

export async function submitBHXFinalConfirm(ctx: BhxOrderRuntime) {
  const ws = bhxBrowserWsRef.current;
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    return;
  }

  ws.send(JSON.stringify({ type: "confirm_final_action" }));
}
