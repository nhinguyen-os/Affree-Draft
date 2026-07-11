import { getOrderProviderDefinition } from "./provider-registry";
import type { CreateOrderSessionRequest, OrderSessionEvent } from "./types";
import { formatUsAddress, normalizeUsState, parseUsAddress } from "./address";

const VN_PHONE_RE = /^0[35789]\d{8}$/;
const GENERIC_INTL_PHONE_RE = /^\d{7,15}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function fail(message: string): never {
  throw new Error(message);
}

function normalizePhone(phone: string): string {
  return phone.replace(/[\s.\-()]/g, "").replace(/^(\+?84)/, "0");
}

function normalizePhoneForProvider(provider: CreateOrderSessionRequest["provider"], phone: string): string {
  if (provider === "premiumoutlets") {
    return phone.replace(/[^\d]/g, "");
  }
  return normalizePhone(phone);
}

function validatePhoneForProvider(provider: CreateOrderSessionRequest["provider"], phone: string) {
  if (provider === "premiumoutlets") {
    if (!GENERIC_INTL_PHONE_RE.test(phone)) fail("customer.phone is invalid");
    return;
  }
  if (!VN_PHONE_RE.test(phone)) fail("customer.phone is invalid");
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function parseRatio(value: unknown, field: "xRatio" | "yRatio") {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) fail(`${field} must be between 0 and 1`);
  return parsed;
}

function validatePaymentForProvider(provider: CreateOrderSessionRequest["provider"], payment: CreateOrderSessionRequest["payment"] | undefined) {
  if (provider !== "premiumoutlets") return undefined;
  if (!payment || payment.method !== "card" || !payment.card) fail("payment.card is required for premiumoutlets");

  const number = String(payment.card.number || "").replace(/\D/g, "");
  const expMonth = String(payment.card.expMonth || "").replace(/\D/g, "").slice(0, 2);
  const expYear = String(payment.card.expYear || "").replace(/\D/g, "").slice(-2);
  const cvv = String(payment.card.cvv || "").replace(/\D/g, "").slice(0, 4);
  const name = payment.card.name?.trim() || undefined;

  if (number.length < 12 || number.length > 19) fail("payment.card.number is invalid");
  if (!expMonth || Number(expMonth) < 1 || Number(expMonth) > 12) fail("payment.card.expMonth is invalid");
  if (expYear.length !== 2) fail("payment.card.expYear is invalid");
  if (cvv.length < 3 || cvv.length > 4) fail("payment.card.cvv is invalid");

  return {
    method: "card" as const,
    card: {
      number,
      expMonth,
      expYear,
      cvv,
      name,
    },
  };
}

function validateUsAddressForProvider(
  provider: CreateOrderSessionRequest["provider"],
  customer: CreateOrderSessionRequest["customer"]
) {
  if (provider !== "premiumoutlets") {
    return {
      address: customer.address.trim(),
      usAddress: customer.usAddress,
    };
  }

  const parsedAddress = customer.usAddress
    ? {
        street: String(customer.usAddress.street || "").trim(),
        city: String(customer.usAddress.city || "").trim(),
        state: normalizeUsState(customer.usAddress.state || ""),
        zipCode: String(customer.usAddress.zipCode || "").trim(),
      }
    : parseUsAddress(customer.address || "");

  if (!parsedAddress.street || !parsedAddress.city || !parsedAddress.state || !parsedAddress.zipCode) {
    fail("customer.address must include street, city, state, and ZIP for premiumoutlets");
  }

  return {
    address: formatUsAddress(parsedAddress),
    usAddress: {
      street: parsedAddress.street,
      city: parsedAddress.city,
      state: parsedAddress.state,
      zipCode: parsedAddress.zipCode,
    },
  };
}

export function validateCreateOrderSessionRequest(input: unknown): CreateOrderSessionRequest {
  if (!input || typeof input !== "object") fail("invalid request body");

  const value = input as Partial<CreateOrderSessionRequest>;
  if (!value.provider || typeof value.provider !== "string") fail("provider is required");
  const provider = getOrderProviderDefinition(value.provider as CreateOrderSessionRequest["provider"]);
  if (!provider) fail("unsupported provider");

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
  const email = value.customer.email ? normalizeEmail(value.customer.email) : undefined;
  if (provider.key === "premiumoutlets") {
    if (!email) fail("customer.email is required");
    if (!EMAIL_RE.test(email)) fail("customer.email is invalid");
  } else if (email && !EMAIL_RE.test(email)) {
    fail("customer.email is invalid");
  }
  const phone = normalizePhoneForProvider(provider.key, value.customer.phone ?? "");
  validatePhoneForProvider(provider.key, phone);
  const payment = validatePaymentForProvider(provider.key, value.payment);
  const customerAddress = validateUsAddressForProvider(provider.key, value.customer);
  if (!value.idempotencyKey?.trim()) fail("idempotencyKey is required");

  return {
    provider: provider.key,
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
      email,
      phone,
      address: customerAddress.address,
      usAddress: customerAddress.usAddress,
      note: value.customer.note?.trim() || undefined,
    },
    delivery: value.delivery?.slot ? { slot: value.delivery.slot.trim() } : undefined,
    payment,
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
      const xRatio = parseRatio((value as { xRatio?: number }).xRatio, "xRatio");
      const yRatio = parseRatio((value as { yRatio?: number }).yRatio, "yRatio");
      return { type: "popup_click", xRatio, yRatio };
    }
    case "popup_hold": {
      const xRatio = parseRatio((value as { xRatio?: number }).xRatio, "xRatio");
      const yRatio = parseRatio((value as { yRatio?: number }).yRatio, "yRatio");
      const durationMsRaw = (value as { durationMs?: number }).durationMs;
      const durationMs = durationMsRaw == null ? undefined : Math.max(250, Math.min(10000, Math.round(Number(durationMsRaw))));
      return { type: "popup_hold", xRatio, yRatio, durationMs };
    }
    case "frame_click":
    case "frame_mousedown":
    case "frame_mouseup":
    case "frame_mousemove": {
      const xRatio = parseRatio((value as { xRatio?: number }).xRatio, "xRatio");
      const yRatio = parseRatio((value as { yRatio?: number }).yRatio, "yRatio");
      return { type: value.type, xRatio, yRatio } as OrderSessionEvent;
    }
    case "frame_wheel": {
      const xRatio = parseRatio((value as { xRatio?: number }).xRatio, "xRatio");
      const yRatio = parseRatio((value as { yRatio?: number }).yRatio, "yRatio");
      const deltaX = Number((value as { deltaX?: number }).deltaX);
      const deltaY = Number((value as { deltaY?: number }).deltaY);
      return {
        type: "frame_wheel",
        xRatio,
        yRatio,
        deltaX: Number.isFinite(deltaX) ? deltaX : 0,
        deltaY: Number.isFinite(deltaY) ? deltaY : 0,
      };
    }
    case "frame_keypress": {
      const key = String((value as { key?: string }).key ?? "").trim();
      if (!key) fail("key is required");
      return { type: "frame_keypress", key };
    }
    default:
      fail("unsupported event type");
  }
}
