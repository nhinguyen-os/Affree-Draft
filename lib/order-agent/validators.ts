import { getOrderProviderDefinition } from "./provider-registry";
import type { CreateOrderSessionRequest, OrderSessionEvent } from "./types";

const VN_PHONE_RE = /^0[35789]\d{8}$/;

function fail(message: string): never {
  throw new Error(message);
}

function normalizePhone(phone: string): string {
  return phone.replace(/[\s.\-()]/g, "").replace(/^(\+?84)/, "0");
}

export function validateCreateOrderSessionRequest(input: unknown): CreateOrderSessionRequest {
  if (!input || typeof input !== "object") fail("invalid request body");

  const value = input as Partial<CreateOrderSessionRequest>;
  if (value.provider !== "tuoixanhnhanhngon") fail("provider must equal tuoixanhnhanhngon");

  if (!value.offer || typeof value.offer !== "object") fail("offer is required");
  if (!value.offer.productName?.trim()) fail("offer.productName is required");
  if (!value.offer.productUrl?.trim()) fail("offer.productUrl is required");

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(value.offer.productUrl);
  } catch {
    fail("offer.productUrl must be a valid URL");
  }

  if (parsedUrl.protocol !== "https:") fail("offer.productUrl must use https");
  const provider = getOrderProviderDefinition(value.provider);
  if (!provider.allowedHosts.includes(parsedUrl.hostname)) {
    fail(`offer.productUrl host is not allowed for provider ${value.provider}`);
  }

  const quantityValue = value.quantity;
  if (!Number.isInteger(quantityValue) || (quantityValue ?? 0) < 1 || (quantityValue ?? 0) > 20) {
    fail("quantity must be an integer between 1 and 20");
  }
  const quantity = Number(quantityValue);

  if (!value.customer || typeof value.customer !== "object") fail("customer is required");
  if (!value.customer.name?.trim()) fail("customer.name is required");
  if (!value.customer.address?.trim()) fail("customer.address is required");
  const phone = normalizePhone(value.customer.phone ?? "");
  if (!VN_PHONE_RE.test(phone)) fail("customer.phone is invalid");
  if (!value.idempotencyKey?.trim()) fail("idempotencyKey is required");

  return {
    provider: value.provider,
    offer: {
      productId: value.offer.productId?.trim() || undefined,
      productName: value.offer.productName.trim(),
      productUrl: parsedUrl.toString(),
      storeId: value.offer.storeId?.trim() || undefined,
      price: typeof value.offer.price === "number" ? value.offer.price : undefined,
    },
    quantity,
    customer: {
      name: value.customer.name.trim(),
      phone,
      address: value.customer.address.trim(),
      note: value.customer.note?.trim() || undefined,
    },
    delivery: value.delivery?.slot ? { slot: value.delivery.slot.trim() } : undefined,
    idempotencyKey: value.idempotencyKey.trim(),
  };
}

export function validateOrderSessionEvent(input: unknown): OrderSessionEvent {
  if (!input || typeof input !== "object") fail("invalid event body");
  const value = input as Partial<OrderSessionEvent> & { type?: string };

  switch (value.type) {
    case "otp_submitted": {
      const otp = String((value as { otp?: string }).otp ?? "").replace(/\D/g, "").slice(0, 8);
      if (otp.length < 4) fail("otp is required");
      return { type: "otp_submitted", otp };
    }
    case "login_completed":
    case "captcha_completed":
    case "confirm_final_action":
    case "payment_submitted":
    case "choose_handoff":
    case "cancel":
      return { type: value.type } as OrderSessionEvent;
    case "popup_switch_view": {
      const view = (value as { view?: string }).view;
      if (view !== "qr" && view !== "confirm" && view !== "full") fail("popup view must be qr, confirm, or full");
      return { type: "popup_switch_view", view };
    }
    case "popup_click": {
      const xRatio = Number((value as { xRatio?: number }).xRatio);
      const yRatio = Number((value as { yRatio?: number }).yRatio);
      if (!Number.isFinite(xRatio) || xRatio < 0 || xRatio > 1) fail("xRatio must be between 0 and 1");
      if (!Number.isFinite(yRatio) || yRatio < 0 || yRatio > 1) fail("yRatio must be between 0 and 1");
      return { type: "popup_click", xRatio, yRatio };
    }
    default:
      fail("unsupported event type");
  }
}
