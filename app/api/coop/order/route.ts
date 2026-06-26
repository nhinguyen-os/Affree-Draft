import { NextRequest, NextResponse } from "next/server";
import { getCoopProduct } from "@/integrations/coop/backend/client";
import {
  COOP_MIN_ORDER_TOTAL,
  CoopOrderError,
  addItemToCoopAccountCart,
  beginCoopOauth,
  confirmCoopUser,
  exchangeCoopToken,
  getCachedCoopToken,
  getOrLoginCoopToken,
  writeTokenCache,
  extractCoopSku,
  isValidCoopPhone,
  loginAndToken,
  normalizeCoopPhone,
  normalizeQuantity,
  normalizeTerminalCode,
  prepareCoopCheckout,
  registerCoopUser,
  resendCoopActivation,
  shouldSkipCoopLogin,
  submitCoopCheckout,
  type CoopCartItem,
  type CoopDeliveryInfo,
  type CoopTokenResponse,
  type CoopOauthFlow,
} from "@/integrations/coop/backend/order";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PendingFlow = {
  id: string;
  createdAt: number;
  flow: CoopOauthFlow;
  phone: string;
  password: string;
  terminalCode: string;
  item: CoopCartItem;
  deliveryInfo: CoopDeliveryInfo;
  productName: string;
  lineTotal: number;
  prepared?: boolean;
  deliveryDate?: string;
  slotFrom?: string;
  slotTo?: string;
  orderCode?: string;
};

type CartSession = {
  id: string;
  createdAt: number;
  accessToken: string;
  terminalCode: string;
  cartToken: string;
  deliveryInfo: CoopDeliveryInfo;
  productName: string;
  lineTotal: number;
  browserSession?: CoopBrowserSession;
  prepared?: boolean;
  deliveryDate?: string;
  slotFrom?: string;
  slotTo?: string;
  orderCode?: string;
};

type CoopBrowserSession = {
  accessToken: string;
  tokenType: string;
  refreshToken?: string;
  userId?: string;
  phone?: string;
  name?: string;
  email?: string;
  address?: string;
  terminalCode: string;
  terminalId?: string;
  terminalName?: string;
  terminalAddress?: string;
  siteId?: number;
};

const FLOW_TTL_MS = 15 * 60 * 1000;
const flows = new Map<string, PendingFlow>();
const cartSessions = new Map<string, CartSession>();

function cleanFlows() {
  const now = Date.now();
  for (const [id, flow] of flows.entries()) {
    if (now - flow.createdAt > FLOW_TTL_MS) flows.delete(id);
  }
  for (const [id, session] of cartSessions.entries()) {
    if (now - session.createdAt > FLOW_TTL_MS) cartSessions.delete(id);
  }
}

function randomId() {
  return crypto.randomUUID();
}

function saveCartSession(input: {
  token: CoopTokenResponse;
  terminalCode: string;
  cartToken: string;
  deliveryInfo: CoopDeliveryInfo;
  productName: string;
  lineTotal: number;
  browserSession?: CoopBrowserSession;
}) {
  const id = randomId();
  cartSessions.set(id, {
    id,
    createdAt: Date.now(),
    accessToken: input.token.access_token,
    terminalCode: input.terminalCode,
    cartToken: input.cartToken,
    deliveryInfo: input.deliveryInfo,
    productName: input.productName,
    lineTotal: input.lineTotal,
    browserSession: input.browserSession,
  });
  return id;
}

function errorJson(err: unknown, fallbackStatus = 400) {
  if (err instanceof CoopOrderError) {
    return NextResponse.json(
      { ok: false, error: err.message, code: err.code, detail: err.detail },
      { status: err.status },
    );
  }
  if (err instanceof Error) {
    return NextResponse.json({ ok: false, error: err.message }, { status: fallbackStatus });
  }
  return NextResponse.json({ ok: false, error: String(err) }, { status: fallbackStatus });
}

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function isAccountExistsError(err: unknown) {
  if (!(err instanceof CoopOrderError)) return false;
  const haystack = `${err.code ?? ""} ${err.message ?? ""} ${JSON.stringify(err.detail ?? {})}`.toLowerCase();
  return (
    haystack.includes("1018") ||
    haystack.includes("already") ||
    haystack.includes("exist") ||
    haystack.includes("tồn tại") ||
    haystack.includes("da ton tai") ||
    haystack.includes("đã đăng ký")
  );
}

function readNumber(value: unknown) {
  const n = typeof value === "number" ? value : Number(readString(value));
  return Number.isFinite(n) ? n : undefined;
}

function allowPasswordLogin(body: Record<string, unknown>) {
  return body.allowPasswordLogin === true || readString(body.allowPasswordLogin) === "true";
}

function decodeCoopJwtPayload(token: string): Record<string, unknown> {
  try {
    const payload = token.split(".")[1];
    if (!payload) return {};
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf-8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function buildBrowserSession(input: {
  token: CoopTokenResponse;
  terminalCode: string;
  deliveryInfo: CoopDeliveryInfo;
  terminalId?: string;
  terminalName?: string;
  terminalAddress?: string;
  siteId?: number;
}): CoopBrowserSession {
  const payload = decodeCoopJwtPayload(input.token.access_token);
  const userId = typeof payload.sub === "string" ? payload.sub : undefined;
  return {
    accessToken: input.token.access_token,
    tokenType: input.token.token_type ?? "Bearer",
    refreshToken: input.token.refresh_token,
    userId,
    phone: input.deliveryInfo.phone,
    name: input.deliveryInfo.name,
    email: input.deliveryInfo.email,
    address: input.deliveryInfo.fullAddress,
    terminalCode: input.terminalCode,
    terminalId: input.terminalId,
    terminalName: input.terminalName,
    terminalAddress: input.terminalAddress,
    siteId: input.siteId ?? input.deliveryInfo.siteId,
  };
}

function readBrowserSessionMeta(body: Record<string, unknown>, deliveryInfo: CoopDeliveryInfo) {
  return {
    terminalId: readString(body.terminalId),
    terminalName: readString(body.terminalName),
    terminalAddress: readString(body.terminalAddress),
    siteId: readNumber(body.siteId) ?? deliveryInfo.siteId,
  };
}

function buildDeliveryInfo(body: Record<string, unknown>, phone: string): CoopDeliveryInfo {
  const fullAddress = readString(body.fullAddress) || readString(body.address);
  const name = readString(body.name) || phone;
  if (!fullAddress) {
    throw new CoopOrderError("Vui lòng chọn địa chỉ giao Co.op trước khi tạo giỏ.", {
      status: 400,
      code: "COOP_ADDRESS_REQUIRED",
    });
  }
  return {
    deliveryType: "DELIVERY_TYPE_AT_HOME",
    name,
    phone,
    email: readString(body.email) || undefined,
    addressId: readString(body.addressId) || undefined,
    addressLine: readString(body.addressLine) || readString(body.streetAddress) || undefined,
    wardId: readString(body.wardId) || undefined,
    wardName: readString(body.wardName) || undefined,
    districtId: readString(body.districtId) || undefined,
    districtName: readString(body.districtName) || undefined,
    provinceId: readString(body.provinceId) || undefined,
    provinceName: readString(body.provinceName) || undefined,
    fullAddress,
    siteId: readNumber(body.siteId),
  };
}

async function resolveCartItem(body: Record<string, unknown>) {
  const terminalCode = normalizeTerminalCode(body.terminalCode);
  const sku = extractCoopSku(body.sku, body.productUrl, body.sellerSku);
  if (!sku) {
    throw new CoopOrderError("Không tìm được SKU Co.op từ sản phẩm/link hiện tại.", {
      status: 400,
      code: "COOP_SKU_MISSING",
      detail: { sku: body.sku, productUrl: body.productUrl, sellerSku: body.sellerSku, productId: body.productId },
    });
  }

  const quantity = normalizeQuantity(body.quantity);
  const clientPrice = Number(body.price);
  const product = await getCoopProduct({ sku, terminalCode }).catch(() => null);
  if (!product) {
    throw new CoopOrderError("Không tìm thấy sản phẩm này trên Co.op theo SKU hiện tại.", {
      status: 404,
      code: "COOP_PRODUCT_NOT_FOUND",
      detail: { sku, terminalCode },
    });
  }
  if (!product.inStock) {
    throw new CoopOrderError("Sản phẩm này hiện không bán hoặc hết hàng trên Co.op.", {
      status: 400,
      code: "COOP_PRODUCT_UNAVAILABLE",
      detail: { sku, terminalCode, totalAvailable: product.totalAvailable, status: product.raw.status },
    });
  }
  if (product.totalAvailable != null && product.totalAvailable < quantity) {
    throw new CoopOrderError(`Co.op chỉ còn ${product.totalAvailable} sản phẩm, không đủ số lượng ${quantity}.`, {
      status: 400,
      code: "COOP_STOCK_NOT_ENOUGH",
      detail: { sku, terminalCode, totalAvailable: product.totalAvailable, quantity },
    });
  }
  const price = product?.price && product.price > 0 ? product.price : clientPrice;
  const lineTotal = Number.isFinite(price) ? price * quantity : 0;
  if (lineTotal < COOP_MIN_ORDER_TOTAL) {
    throw new CoopOrderError("Co.op yêu cầu đơn tối thiểu 200.000đ để thanh toán.", {
      status: 400,
      code: "COOP_MIN_ORDER",
      detail: { minOrderTotal: COOP_MIN_ORDER_TOTAL, currentTotal: lineTotal, quantity, price },
    });
  }

  return {
    terminalCode,
    item: {
      sku,
      sellerSku: readString(body.sellerSku) || product.sellerSku || sku,
      quantity,
    },
    productName: product.name || readString(body.productName) || sku,
    lineTotal,
    product,
  };
}

async function addCartForPasswordLogin(input: {
  phone: string;
  password: string;
  terminalCode: string;
  item: CoopCartItem;
  deliveryInfo: CoopDeliveryInfo;
  productName: string;
  lineTotal: number;
  browserSessionMeta?: ReturnType<typeof readBrowserSessionMeta>;
}) {
  const flow = await beginCoopOauth();
  const token = await getOrLoginCoopToken({ flow, phone: input.phone, password: input.password });
  return addCartWithCoopToken({
    token,
    terminalCode: input.terminalCode,
    item: input.item,
    deliveryInfo: input.deliveryInfo,
    productName: input.productName,
    lineTotal: input.lineTotal,
    alreadyRegistered: true,
    browserSessionMeta: input.browserSessionMeta,
  });
}

async function addCartWithCoopToken(input: {
  token: CoopTokenResponse;
  terminalCode: string;
  item: CoopCartItem;
  deliveryInfo: CoopDeliveryInfo;
  productName: string;
  lineTotal: number;
  alreadyRegistered?: boolean;
  usedTokenCache?: boolean;
  browserSessionMeta?: ReturnType<typeof readBrowserSessionMeta>;
}) {
  const cartResult = await addItemToCoopAccountCart({
    accessToken: input.token.access_token,
    terminalCode: input.terminalCode,
    item: input.item,
    deliveryInfo: input.deliveryInfo,
  });
  const browserSession = buildBrowserSession({
    token: input.token,
    terminalCode: input.terminalCode,
    deliveryInfo: cartResult.deliveryInfo ?? input.deliveryInfo,
    ...input.browserSessionMeta,
  });
  const checkoutFlowId = saveCartSession({
    token: input.token,
    terminalCode: input.terminalCode,
    cartToken: cartResult.cartToken,
    deliveryInfo: cartResult.deliveryInfo ?? input.deliveryInfo,
    productName: input.productName,
    lineTotal: input.lineTotal,
    browserSession,
  });
  return {
    ok: true,
    phase: "cart",
    checkoutFlowId,
    alreadyRegistered: input.alreadyRegistered ?? true,
    usedTokenCache: input.usedTokenCache,
    productName: input.productName,
    lineTotal: input.lineTotal,
    minOrderTotal: COOP_MIN_ORDER_TOTAL,
    terminalCode: input.terminalCode,
    cartToken: cartResult.cartToken,
    cart: cartResult.cart,
    deliveryInfo: cartResult.deliveryInfo,
    addressSync: cartResult.addressSync,
    cartCleared: cartResult.cartCleared,
    deliveryCheck: cartResult.deliveryCheck,
    paymentCheck: cartResult.paymentCheck,
    browserSession,
    cartUrl: "https://cooponline.vn/cart",
    checkoutUrl: "https://cooponline.vn/checkout",
  };
}

export async function POST(req: NextRequest) {
  cleanFlows();
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const action = readString(body.action);

  try {
    if (action === "register") {
      const phone = normalizeCoopPhone(readString(body.phone));
      const password = readString(body.password);
      if (!isValidCoopPhone(phone)) {
        throw new CoopOrderError("Số điện thoại Co.op không hợp lệ.", { status: 400, code: "COOP_PHONE_INVALID" });
      }

      const deliveryInfo = buildDeliveryInfo(body, phone);
      const browserSessionMeta = readBrowserSessionMeta(body, deliveryInfo);
      const resolved = await resolveCartItem(body);
      const cachedToken = await getCachedCoopToken(phone);
      if (cachedToken) {
        return NextResponse.json(
          await addCartWithCoopToken({
            token: cachedToken,
            terminalCode: resolved.terminalCode,
            item: resolved.item,
            deliveryInfo,
            productName: resolved.productName,
            lineTotal: resolved.lineTotal,
            alreadyRegistered: true,
            usedTokenCache: true,
            browserSessionMeta,
          }),
        );
      }
      if (shouldSkipCoopLogin() && !allowPasswordLogin(body)) {
        throw new CoopOrderError("Đang bật skip login Co.op nhưng token cache không có hoặc đã hết hạn.", {
          status: 409,
          code: "COOP_TOKEN_CACHE_MISSING",
        });
      }
      if (password.length < 6) {
        throw new CoopOrderError("Mật khẩu Co.op cần tối thiểu 6 ký tự.", {
          status: 400,
          code: "COOP_PASSWORD_SHORT",
        });
      }
      const flow = await beginCoopOauth();
      try {
        await registerCoopUser({
          challenge: flow.loginChallenge,
          phone,
          password,
          name: readString(body.name) || phone,
        });
      } catch (err) {
        if (isAccountExistsError(err)) {
          const loginResult = await addCartForPasswordLogin({
            phone,
            password,
            terminalCode: resolved.terminalCode,
            item: resolved.item,
            deliveryInfo,
            productName: resolved.productName,
            lineTotal: resolved.lineTotal,
            browserSessionMeta,
          });
          return NextResponse.json(loginResult);
        }
        if (err instanceof CoopOrderError && err.code === "1011") {
          await resendCoopActivation(phone).catch(() => null);
        } else {
          throw err;
        }
      }

      const id = randomId();
      flows.set(id, {
        id,
        createdAt: Date.now(),
        flow,
        phone,
        password,
        terminalCode: resolved.terminalCode,
        item: resolved.item,
        deliveryInfo,
        productName: resolved.productName,
        lineTotal: resolved.lineTotal,
      });

      return NextResponse.json({
        ok: true,
        phase: "otp",
        flowId: id,
        phone,
        productName: resolved.productName,
        lineTotal: resolved.lineTotal,
        minOrderTotal: COOP_MIN_ORDER_TOTAL,
        terminalCode: resolved.terminalCode,
        product: resolved.product,
      });
    }

    if (action === "confirm") {
      const flowId = readString(body.flowId);
      const code = readString(body.code).replace(/\D/g, "");
      const pending = flows.get(flowId);
      if (!pending) {
        throw new CoopOrderError("Phiên OTP đã hết hạn, vui lòng bắt đầu lại.", {
          status: 410,
          code: "COOP_FLOW_EXPIRED",
        });
      }
      if (code.length !== 6) {
        throw new CoopOrderError("Mã OTP Co.op cần đủ 6 số.", { status: 400, code: "COOP_OTP_INVALID" });
      }

      const confirmed = await confirmCoopUser({
        challenge: pending.flow.loginChallenge,
        phone: pending.phone,
        code,
      });
      const token = confirmed.redirect_to
        ? await exchangeCoopToken({
            redirectTo: confirmed.redirect_to,
            state: pending.flow.state,
            verifier: pending.flow.verifier,
          })
        : await getOrLoginCoopToken({
            flow: pending.flow,
            phone: pending.phone,
            password: pending.password,
          });
      // Lưu token vào cache sau khi xác nhận OTP thành công
      await writeTokenCache(token, pending.phone);
      const cartResult = await addItemToCoopAccountCart({
        accessToken: token.access_token,
        terminalCode: pending.terminalCode,
        item: pending.item,
        deliveryInfo: pending.deliveryInfo,
      });
      const browserSession = buildBrowserSession({
        token,
        terminalCode: pending.terminalCode,
        deliveryInfo: cartResult.deliveryInfo ?? pending.deliveryInfo,
      });
      const checkoutFlowId = saveCartSession({
        token,
        terminalCode: pending.terminalCode,
        cartToken: cartResult.cartToken,
        deliveryInfo: cartResult.deliveryInfo ?? pending.deliveryInfo,
        productName: pending.productName,
        lineTotal: pending.lineTotal,
        browserSession,
      });
      flows.delete(flowId);

      return NextResponse.json({
        ok: true,
        phase: "cart",
        checkoutFlowId,
        productName: pending.productName,
        lineTotal: pending.lineTotal,
        minOrderTotal: COOP_MIN_ORDER_TOTAL,
        terminalCode: pending.terminalCode,
        cartToken: cartResult.cartToken,
        cart: cartResult.cart,
        deliveryInfo: cartResult.deliveryInfo,
        addressSync: cartResult.addressSync,
        cartCleared: cartResult.cartCleared,
        deliveryCheck: cartResult.deliveryCheck,
        paymentCheck: cartResult.paymentCheck,
        browserSession,
        cartUrl: "https://cooponline.vn/cart",
        checkoutUrl: "https://cooponline.vn/checkout",
      });
    }

    if (action === "prepareCheckout") {
      const checkoutFlowId = readString(body.checkoutFlowId);
      const deliveryDate = readString(body.deliveryDate);
      const slotFrom = readString(body.slotFrom);
      const slotTo = readString(body.slotTo);
      const session = cartSessions.get(checkoutFlowId);
      if (!session) {
        throw new CoopOrderError("Phiên checkout Co.op đã hết hạn, vui lòng thêm lại giỏ.", {
          status: 410,
          code: "COOP_CHECKOUT_FLOW_EXPIRED",
        });
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(deliveryDate) || !slotFrom || !slotTo) {
        throw new CoopOrderError("Vui lòng chọn ngày nhận hàng và khung giờ hợp lệ.", {
          status: 400,
          code: "COOP_DELIVERY_TIME_INVALID",
        });
      }
      const prepared = await prepareCoopCheckout({
        accessToken: session.accessToken,
        terminalCode: session.terminalCode,
        cartToken: session.cartToken,
        deliveryDate,
        slotFrom,
        slotTo,
      });
      session.cartToken = prepared.cartToken;
      session.createdAt = Date.now();
      session.prepared = true;
      session.deliveryDate = prepared.deliveryCheck.selectedDate ?? deliveryDate;
      session.slotFrom = prepared.deliveryCheck.selectedSlotFrom ?? slotFrom;
      session.slotTo = prepared.deliveryCheck.selectedSlotTo ?? slotTo;
      return NextResponse.json({
        ok: true,
        phase: "cart",
        prepared: true,
        checkoutFlowId,
        productName: session.productName,
        lineTotal: session.lineTotal,
        minOrderTotal: COOP_MIN_ORDER_TOTAL,
        terminalCode: session.terminalCode,
        cartToken: prepared.cartToken,
        confirmationCart: prepared.confirmationCart,
        deliveryCheck: prepared.deliveryCheck,
        paymentCheck: prepared.paymentCheck,
        browserSession: session.browserSession
          ? { ...session.browserSession, cartToken: prepared.cartToken }
          : undefined,
        cartUrl: "https://cooponline.vn/cart",
        checkoutUrl: "https://cooponline.vn/checkout",
      });
    }

    if (action === "placeOrder") {
      const checkoutFlowId = readString(body.checkoutFlowId);
      const confirmFinal = Boolean(body.confirmFinal);
      const session = cartSessions.get(checkoutFlowId);
      if (!session) {
        throw new CoopOrderError("Phiên checkout Co.op đã hết hạn, vui lòng thêm lại giỏ.", {
          status: 410,
          code: "COOP_CHECKOUT_FLOW_EXPIRED",
        });
      }
      if (!confirmFinal) {
        throw new CoopOrderError("Thiếu xác nhận đặt hàng Co.op.", {
          status: 400,
          code: "COOP_FINAL_CONFIRM_REQUIRED",
        });
      }
      if (!session.prepared) {
        throw new CoopOrderError("Vui lòng chọn lịch giao và COD trước khi đặt hàng.", {
          status: 400,
          code: "COOP_CHECKOUT_NOT_PREPARED",
        });
      }
      const placed = await submitCoopCheckout({
        accessToken: session.accessToken,
        terminalCode: session.terminalCode,
        cartToken: session.cartToken,
      });
      session.cartToken = placed.cartToken;
      session.createdAt = Date.now();
      session.orderCode = placed.checkoutResult.code;
      return NextResponse.json({
        ok: true,
        phase: "ordered",
        checkoutFlowId,
        productName: session.productName,
        lineTotal: session.lineTotal,
        minOrderTotal: COOP_MIN_ORDER_TOTAL,
        terminalCode: session.terminalCode,
        cartToken: placed.cartToken,
        order: placed.checkoutResult,
        cartUrl: "https://cooponline.vn/cart",
        checkoutUrl: "https://cooponline.vn/checkout",
      });
    }

    if (action === "login") {
      const phone = normalizeCoopPhone(readString(body.phone));
      const password = readString(body.password);
      if (!isValidCoopPhone(phone)) {
        throw new CoopOrderError("Số điện thoại Co.op không hợp lệ.", { status: 400, code: "COOP_PHONE_INVALID" });
      }
      const deliveryInfo = buildDeliveryInfo(body, phone);
      const browserSessionMeta = readBrowserSessionMeta(body, deliveryInfo);
      const resolved = await resolveCartItem(body);
      const cachedToken = await getCachedCoopToken(phone);
      if (cachedToken) {
        return NextResponse.json(
          await addCartWithCoopToken({
            token: cachedToken,
            terminalCode: resolved.terminalCode,
            item: resolved.item,
            deliveryInfo,
            productName: resolved.productName,
            lineTotal: resolved.lineTotal,
            alreadyRegistered: true,
            usedTokenCache: true,
            browserSessionMeta,
          }),
        );
      }
      if (shouldSkipCoopLogin() && !allowPasswordLogin(body)) {
        throw new CoopOrderError("Đang bật skip login Co.op nhưng token cache không có hoặc đã hết hạn.", {
          status: 409,
          code: "COOP_TOKEN_CACHE_MISSING",
        });
      }
      if (password.length < 6) {
        throw new CoopOrderError("Mật khẩu Co.op cần tối thiểu 6 ký tự.", {
          status: 400,
          code: "COOP_PASSWORD_SHORT",
        });
      }
      return NextResponse.json(
        await addCartForPasswordLogin({
          phone,
          password,
          terminalCode: resolved.terminalCode,
          item: resolved.item,
          deliveryInfo,
          productName: resolved.productName,
          lineTotal: resolved.lineTotal,
          browserSessionMeta,
        }),
      );
    }

    if (action === "resend") {
      const flowId = readString(body.flowId);
      const pending = flows.get(flowId);
      if (!pending) {
        throw new CoopOrderError("Phiên OTP đã hết hạn, vui lòng bắt đầu lại.", {
          status: 410,
          code: "COOP_FLOW_EXPIRED",
        });
      }
      await resendCoopActivation(pending.phone);
      return NextResponse.json({ ok: true, phase: "otp", flowId });
    }

    return NextResponse.json({ ok: false, error: "Unknown action" }, { status: 400 });
  } catch (err) {
    return errorJson(err, 502);
  }
}
