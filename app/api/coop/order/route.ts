import { NextRequest, NextResponse } from "next/server";
import { getCoopAccount } from "../../../../agent-server/account-sheet";
import { getCoopProduct } from "@/integrations/coop/backend/client";
import {
  COOP_MIN_ORDER_TOTAL,
  CoopOrderError,
  addItemToCoopAccountCart,
  beginCoopOauth,
  cancelCoopPendingOrder,
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
  items: CoopCartItem[];
  deliveryInfo: CoopDeliveryInfo;
  productName: string;
  lineTotal: number;
  prepared?: boolean;
  deliveryDate?: string;
  slotFrom?: string;
  slotTo?: string;
  selectedPaymentMethodCode?: string;
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
  items: CoopCartItem[];
  lineTotal: number;
  browserSession?: CoopBrowserSession;
  prepared?: boolean;
  deliveryDate?: string;
  slotFrom?: string;
  slotTo?: string;
  selectedPaymentMethodCode?: string;
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
  items: CoopCartItem[];
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
    items: input.items,
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

// Toạ độ hợp lệ: số hữu hạn và KHÁC 0 (0/rỗng/thiếu → undefined, tránh gửi "0" vô nghĩa
// khiến Co.op không tính được khung giờ giao).
function readCoord(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n === 0) return undefined;
  return String(n);
}

function allowPasswordLogin(body: Record<string, unknown>) {
  return body.allowPasswordLogin === true || readString(body.allowPasswordLogin) === "true";
}

// Tài khoản Co.op CỦA AFFREE được quản lý trong Google Sheet. Env chỉ chứa URL
// ACCOUNT_ORDER_COOP_URL; SĐT khách chỉ là thông tin người nhận hàng.
async function affreeCoopAccount(): Promise<{ phone: string; password: string }> {
  try {
    const account = await getCoopAccount();
    const phone = normalizeCoopPhone(account.phone);
    const password = String(account.password || "").trim();
    if (!isValidCoopPhone(phone) || password.length < 6) {
      throw new Error("Tài khoản đang active trong sheet không hợp lệ.");
    }
    return { phone, password };
  } catch (error) {
    throw new CoopOrderError(
      error instanceof Error ? error.message : "Không đọc được tài khoản Co.op từ sheet.",
      { status: 503, code: "COOP_AFFREE_ACCOUNT_SHEET_ERROR" },
    );
  }
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
    latitude: readCoord(body.lat),
    longitude: readCoord(body.lng),
  };
}

async function resolveCartItem(body: Record<string, unknown>, options?: { skipMinOrderCheck?: boolean }) {
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
  if (!options?.skipMinOrderCheck && lineTotal < COOP_MIN_ORDER_TOTAL) {
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

async function resolveCartItems(body: Record<string, unknown>) {
  const rawItems = Array.isArray(body.items) ? body.items : [];
  if (!rawItems.length) {
    const resolved = await resolveCartItem(body);
    return {
      ...resolved,
      items: [resolved.item],
      productName: resolved.productName,
    };
  }

  const resolvedItems = await Promise.all(
    rawItems.map(async (raw, index) => {
      if (!raw || typeof raw !== "object") {
        throw new CoopOrderError(`Sản phẩm Co.op thứ ${index + 1} không hợp lệ.`, {
          status: 400,
          code: "COOP_ITEM_INVALID",
          detail: raw,
        });
      }
      const itemBody = {
        ...body,
        ...(raw as Record<string, unknown>),
        terminalCode: readString((raw as Record<string, unknown>).terminalCode) || readString(body.terminalCode),
      };
      return resolveCartItem(itemBody, { skipMinOrderCheck: true });
    }),
  );

  const terminalCode = resolvedItems[0]?.terminalCode;
  const mismatched = resolvedItems.find((item) => item.terminalCode !== terminalCode);
  if (!terminalCode || mismatched) {
    throw new CoopOrderError("Một đơn Co.op chỉ hỗ trợ các sản phẩm cùng một cửa hàng/terminal.", {
      status: 400,
      code: "COOP_MULTI_TERMINAL_NOT_SUPPORTED",
      detail: { terminalCodes: resolvedItems.map((item) => item.terminalCode) },
    });
  }

  const items = resolvedItems.map((item) => item.item);
  const lineTotal = resolvedItems.reduce((sum, item) => sum + item.lineTotal, 0);
  if (lineTotal < COOP_MIN_ORDER_TOTAL) {
    throw new CoopOrderError("Co.op yêu cầu đơn tối thiểu 200.000đ để thanh toán.", {
      status: 400,
      code: "COOP_MIN_ORDER",
      detail: { minOrderTotal: COOP_MIN_ORDER_TOTAL, currentTotal: lineTotal, items },
    });
  }

  const productName =
    resolvedItems.length === 1
      ? resolvedItems[0].productName
      : `${resolvedItems[0].productName} + ${resolvedItems.length - 1} sản phẩm`;

  return {
    terminalCode,
    item: items[0],
    items,
    productName,
    lineTotal,
    product: resolvedItems[0].product,
    products: resolvedItems.map((item) => item.product),
  };
}

function logCoopOrderItems(action: string, resolved: Awaited<ReturnType<typeof resolveCartItems>>) {
  console.info("[coop/order]", action, {
    itemCount: resolved.items.length,
    skus: resolved.items.map((item) => item.sku),
    terminalCode: resolved.terminalCode,
    lineTotal: resolved.lineTotal,
  });
}

async function addCartForPasswordLogin(input: {
  phone: string;
  password: string;
  terminalCode: string;
  items: CoopCartItem[];
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
    items: input.items,
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
  items: CoopCartItem[];
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
    items: input.items,
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
    items: input.items,
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
    if (action === "register" || action === "createCart") {
      const phone = normalizeCoopPhone(readString(body.phone));
      const password = readString(body.password);
      if (!isValidCoopPhone(phone)) {
        throw new CoopOrderError("Số điện thoại nhận hàng không hợp lệ.", { status: 400, code: "COOP_PHONE_INVALID" });
      }

      const deliveryInfo = buildDeliveryInfo(body, phone);
      const browserSessionMeta = readBrowserSessionMeta(body, deliveryInfo);
      const resolved = await resolveCartItems(body);
      logCoopOrderItems(action === "createCart" ? "createCart" : "register", resolved);

      // Affree đặt hộ bằng tài khoản Affree — không đăng ký/OTP với SĐT khách.
      const affree = await affreeCoopAccount();
      if (affree) {
        const cachedAffree = await getCachedCoopToken(affree.phone);
        if (cachedAffree) {
          return NextResponse.json(
            await addCartWithCoopToken({
              token: cachedAffree,
              terminalCode: resolved.terminalCode,
              items: resolved.items,
              deliveryInfo,
              productName: resolved.productName,
              lineTotal: resolved.lineTotal,
              alreadyRegistered: true,
              usedTokenCache: true,
              browserSessionMeta,
            }),
          );
        }
        return NextResponse.json(
          await addCartForPasswordLogin({
            phone: affree.phone,
            password: affree.password,
            terminalCode: resolved.terminalCode,
            items: resolved.items,
            deliveryInfo,
            productName: resolved.productName,
            lineTotal: resolved.lineTotal,
            browserSessionMeta,
          }),
        );
      }
      if (!password) {
        throw new CoopOrderError(
          "Affree chưa cấu hình tài khoản Co.op đặt hộ (COOP_ACCOUNT_PHONE / COOP_ACCOUNT_PASSWORD).",
          { status: 503, code: "COOP_AFFREE_ACCOUNT_MISSING" },
        );
      }
      const cachedToken = await getCachedCoopToken(phone);
      if (cachedToken) {
        return NextResponse.json(
          await addCartWithCoopToken({
            token: cachedToken,
            terminalCode: resolved.terminalCode,
            items: resolved.items,
            deliveryInfo,
            productName: resolved.productName,
            lineTotal: resolved.lineTotal,
            alreadyRegistered: true,
            usedTokenCache: true,
            browserSessionMeta,
          }),
        );
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
            items: resolved.items,
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
        items: resolved.items,
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
        product: resolved.products?.[0] ?? resolved.product,
        products: resolved.products ?? [resolved.product],
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
        items: pending.items,
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
        items: pending.items,
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
      const paymentMethodCode = readString(body.paymentMethodCode) || "COD";
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
        paymentMethodCode,
        deliveryInfo: session.deliveryInfo,
      });
      session.cartToken = prepared.cartToken;
      session.createdAt = Date.now();
      session.prepared = true;
      session.deliveryDate = prepared.deliveryCheck.selectedDate ?? deliveryDate;
      session.slotFrom = prepared.deliveryCheck.selectedSlotFrom ?? slotFrom;
      session.slotTo = prepared.deliveryCheck.selectedSlotTo ?? slotTo;
      session.selectedPaymentMethodCode = prepared.paymentCheck.selectedMethodCode ?? paymentMethodCode;
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
        throw new CoopOrderError("Vui lòng chọn lịch giao và phương thức thanh toán trước khi đặt hàng.", {
          status: 400,
          code: "COOP_CHECKOUT_NOT_PREPARED",
        });
      }
      const placed = await submitCoopCheckout({
        accessToken: session.accessToken,
        terminalCode: session.terminalCode,
        cartToken: session.cartToken,
        deliveryDate: session.deliveryDate,
        slotFrom: session.slotFrom,
        slotTo: session.slotTo,
      });
      session.cartToken = placed.cartToken;
      session.createdAt = Date.now();
      session.orderCode = placed.checkoutResult.orderId ?? placed.checkoutResult.code;
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
        paymentUrl: placed.checkoutResult.paymentUrl,
        cartUrl: "https://cooponline.vn/cart",
        checkoutUrl: "https://cooponline.vn/checkout",
      });
    }

    if (action === "cancelOrder") {
      const checkoutFlowId = readString(body.checkoutFlowId);
      const session = cartSessions.get(checkoutFlowId);
      if (!session) {
        throw new CoopOrderError("Phiên checkout Co.op đã hết hạn, không thể đổi phương thức thanh toán.", {
          status: 410,
          code: "COOP_CHECKOUT_FLOW_EXPIRED",
        });
      }
      if (!session.orderCode) {
        throw new CoopOrderError("Chưa có đơn Co.op nào cần hủy.", {
          status: 400,
          code: "COOP_ORDER_NOT_PLACED",
        });
      }
      if (session.selectedPaymentMethodCode === "COD") {
        throw new CoopOrderError("Đơn thanh toán khi nhận hàng đã được đặt và không thể đổi phương thức thanh toán.", {
          status: 409,
          code: "COOP_COD_ORDER_CANNOT_CANCEL",
        });
      }
      const cancelledOrderCode = session.orderCode;
      const cancelled = await cancelCoopPendingOrder({
        accessToken: session.accessToken,
        terminalCode: session.terminalCode,
        cartToken: session.cartToken,
        orderId: cancelledOrderCode,
      });
      session.cartToken = cancelled.cartToken;
      session.createdAt = Date.now();
      session.prepared = false;
      session.orderCode = undefined;
      session.selectedPaymentMethodCode = undefined;
      return NextResponse.json({
        ok: true,
        phase: "cart",
        checkoutFlowId,
        cancelledOrderCode,
        cartToken: cancelled.cartToken,
        terminalCode: session.terminalCode,
      });
    }

    if (action === "login") {
      const phone = normalizeCoopPhone(readString(body.phone));
      const password = readString(body.password);
      if (!isValidCoopPhone(phone)) {
        throw new CoopOrderError("Số điện thoại nhận hàng không hợp lệ.", { status: 400, code: "COOP_PHONE_INVALID" });
      }
      const deliveryInfo = buildDeliveryInfo(body, phone);
      const browserSessionMeta = readBrowserSessionMeta(body, deliveryInfo);
      const resolved = await resolveCartItems(body);
      logCoopOrderItems("login", resolved);

      // Affree đặt hộ bằng tài khoản Affree — bỏ qua mật khẩu/token của khách.
      const affree = await affreeCoopAccount();
      if (affree) {
        const cachedAffree = await getCachedCoopToken(affree.phone);
        if (cachedAffree) {
          return NextResponse.json(
            await addCartWithCoopToken({
              token: cachedAffree,
              terminalCode: resolved.terminalCode,
              items: resolved.items,
              deliveryInfo,
              productName: resolved.productName,
              lineTotal: resolved.lineTotal,
              alreadyRegistered: true,
              usedTokenCache: true,
              browserSessionMeta,
            }),
          );
        }
        return NextResponse.json(
          await addCartForPasswordLogin({
            phone: affree.phone,
            password: affree.password,
            terminalCode: resolved.terminalCode,
            items: resolved.items,
            deliveryInfo,
            productName: resolved.productName,
            lineTotal: resolved.lineTotal,
            browserSessionMeta,
          }),
        );
      }
      if (!password) {
        throw new CoopOrderError(
          "Affree chưa cấu hình tài khoản Co.op đặt hộ (COOP_ACCOUNT_PHONE / COOP_ACCOUNT_PASSWORD).",
          { status: 503, code: "COOP_AFFREE_ACCOUNT_MISSING" },
        );
      }
      const cachedToken = await getCachedCoopToken(phone);
      if (cachedToken) {
        return NextResponse.json(
          await addCartWithCoopToken({
            token: cachedToken,
            terminalCode: resolved.terminalCode,
            items: resolved.items,
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
          items: resolved.items,
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
