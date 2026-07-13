"use client";

import type { StoreOrderContext, StoreOrderExecutor, StoreOrderGroup, StoreOrderProgress } from "./types";

type CoopResponse = {
  checkoutFlowId?: string;
  terminalCode?: string;
  deliveryCheck?: {
    availableDates?: string[];
    availableTimeSlots?: Array<{ from: string; to: string; disabled?: boolean }>;
    availableSlotsByDate?: Record<string, Array<{ from: string; to: string; disabled?: boolean }>>;
  };
  paymentCheck?: {
    selectedMethodCode?: string;
    methods?: Array<{
      methodCode?: string;
      methodGroupCode?: string;
      name?: string;
      isDisabled?: boolean;
      paymentMethodType?: string;
    }>;
  };
  order?: { code?: string; orderId?: string; paymentUrl?: string };
  paymentUrl?: string;
  error?: string;
};

async function post(body: Record<string, unknown>) {
  const res = await fetch("/api/coop/order", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({})) as CoopResponse;
  if (!res.ok || data.error) throw new Error(data.error || "Co.op không thể xử lý đơn hàng.");
  return data;
}

const COOP_DELIVERY_LEAD_MINUTES = 180;

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "d")
    .toLowerCase();
}

function dateInput(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function prototypeSlotDate(label = "") {
  const date = new Date();
  const normalized = normalizeText(label);
  if (normalized.includes("ngay mai") || /\bmai\b/.test(normalized)) date.setDate(date.getDate() + 1);
  return dateInput(date);
}

function prototypeSlotRange(label = "") {
  const normalized = normalizeText(label);
  if (normalized.includes("trong hom nay")) return { from: 10 * 60, to: 18 * 60 };
  if (normalized.includes("toi")) return { from: 18 * 60, to: 21 * 60 };
  if (normalized.includes("sang")) return { from: 8 * 60, to: 11 * 60 };
  if (normalized.includes("chieu")) return { from: 14 * 60, to: 17 * 60 };
  return { from: 0, to: 24 * 60 };
}

function slotMinute(value: string) {
  const [hour, minute] = value.split(":").map(Number);
  return Number.isFinite(hour) && Number.isFinite(minute) ? hour * 60 + minute : 0;
}

function effectiveSlots(slots: Array<{ from: string; to: string; disabled?: boolean }>, selectedDate: string) {
  if (selectedDate !== dateInput(new Date())) return slots;
  const now = new Date();
  const earliest = now.getHours() * 60 + now.getMinutes() + COOP_DELIVERY_LEAD_MINUTES;
  return slots.map((slot) => ({ ...slot, disabled: slot.disabled || slotMinute(slot.from) <= earliest }));
}

function closestSlot(slots: Array<{ from: string; to: string; disabled?: boolean }>, prototypeSlot = "") {
  const target = prototypeSlotRange(prototypeSlot);
  const targetMidpoint = (target.from + target.to) / 2;
  return slots
    .filter((item) => !item.disabled)
    .map((item) => {
      const from = slotMinute(item.from);
      const to = slotMinute(item.to);
      const overlap = Math.max(0, Math.min(to, target.to) - Math.max(from, target.from));
      const midpointDistance = Math.abs((from + to) / 2 - targetMidpoint);
      return { item, overlap, midpointDistance };
    })
    .filter((entry) => entry.overlap > 0)
    .sort((a, b) => b.overlap - a.overlap || a.midpointDistance - b.midpointDistance)[0]?.item;
}

function selectDeliverySlot(result: CoopResponse, prototypeSlot = "") {
  const today = dateInput(new Date());
  const dates = (result.deliveryCheck?.availableDates ?? []).filter((date) => date >= today);
  const preferredDate = prototypeSlotDate(prototypeSlot);
  const date = dates.includes(preferredDate) ? preferredDate : dates[0] || preferredDate;
  const rawSlots =
    result.deliveryCheck?.availableSlotsByDate?.[date]?.length
      ? result.deliveryCheck.availableSlotsByDate[date]
      : !dates.length && result.deliveryCheck?.availableTimeSlots?.length
        ? result.deliveryCheck.availableTimeSlots
        : [];
  const slots = effectiveSlots(rawSlots, date);
  const slot = closestSlot(slots, prototypeSlot) ?? slots.find((item) => !item.disabled);
  return date && slot ? { date, slot } : null;
}

function selectPaymentMethod(result: CoopResponse, payMethod: StoreOrderContext["payMethod"]) {
  const methods = result.paymentCheck?.methods ?? [];
  const available = methods.filter((method) => method.methodCode && !method.isDisabled);
  const find = (patterns: RegExp[]) =>
    available.find((method) => {
      const haystack = `${method.methodCode || ""} ${method.methodGroupCode || ""} ${method.name || ""}`;
      return patterns.some((pattern) => pattern.test(haystack));
    });
  const method =
    payMethod === "qr"
      ? find([/VNPAY_GATEWAY_QR/i, /MOMO_GATEWAY/i, /\bQR\b/i])
      : payMethod === "card"
        ? find([/INTERNATIONAL_CARD/i, /quốc tế/i, /VISA/i, /MASTERCARD/i])
        : find([/^COD\b/i, /thanh toán khi nhận/i, /tiền mặt/i]);
  if (method) return { code: method.methodCode!, name: method.name };
  return payMethod === "cod" || !payMethod ? { code: "COD", name: "COD" } : null;
}

/** Executor thật cho Co.op. Mỗi instance chỉ chạy MỘT terminal; coordinator chạy lần lượt. */
export const coopOrderExecutor: StoreOrderExecutor = {
  supports: (group) => group.chain === "coop" && Boolean(group.terminalCode),
  async execute(group: StoreOrderGroup, context: StoreOrderContext, onProgress): Promise<StoreOrderProgress> {
    const terminalCode = group.terminalCode!;
    onProgress({ groupKey: group.key, phase: "creating_cart" });
    const cart = await post({
      action: "createCart",
      terminalCode,
      name: context.name,
      phone: context.phone,
      email: context.email,
      address: context.address,
      addressLine: context.addressLine,
      provinceId: context.provinceId,
      provinceName: context.provinceName,
      districtId: context.districtId,
      districtName: context.districtName,
      wardId: context.wardId,
      wardName: context.wardName,
      accountSlot: context.accountSlot,
      items: group.items.map((item) => ({ quantity: item.qty, price: item.offer.price, sku: item.offer.productId, productId: item.product.id, productName: item.product.name, productUrl: item.offer.productUrl, terminalCode })),
    });
    if (!cart.checkoutFlowId) throw new Error("Co.op chưa trả phiên checkout.");
    const selectedDelivery = selectDeliverySlot(cart, context.slot);
    if (!selectedDelivery) throw new Error("Co.op chưa có ngày hoặc khung giờ giao hợp lệ cho cửa hàng này.");
    const paymentMethod = selectPaymentMethod(cart, context.payMethod);
    if (!paymentMethod) throw new Error("Co.op chưa trả phương thức thanh toán phù hợp.");
    onProgress({ groupKey: group.key, phase: "preparing" });
    await post({
      action: "prepareCheckout",
      checkoutFlowId: cart.checkoutFlowId,
      deliveryDate: selectedDelivery.date,
      slotFrom: selectedDelivery.slot.from,
      slotTo: selectedDelivery.slot.to,
      paymentMethodCode: paymentMethod.code,
    });
    return {
      groupKey: group.key,
      phase: "ready_to_confirm",
      checkoutFlowId: cart.checkoutFlowId,
      paymentMethodCode: paymentMethod.code,
      paymentMethodName: paymentMethod.name,
    };
  },
  async confirm(group: StoreOrderGroup, prepared: StoreOrderProgress, _context: StoreOrderContext, onProgress): Promise<StoreOrderProgress> {
    if (!prepared.checkoutFlowId) throw new Error("Co.op chưa có phiên checkout để xác nhận.");
    onProgress({ ...prepared, phase: "placing_order" });
    const placed = await post({ action: "placeOrder", checkoutFlowId: prepared.checkoutFlowId, confirmFinal: true });
    const orderCode = placed.order?.code || placed.order?.orderId;
    const paymentUrl = placed.paymentUrl || placed.order?.paymentUrl;
    if (paymentUrl || prepared.paymentMethodCode !== "COD") {
      return { ...prepared, groupKey: group.key, phase: "awaiting_payment", orderCode, paymentUrl };
    }
    return { ...prepared, groupKey: group.key, phase: "completed", orderCode };
  },
};
