import { createHash, randomBytes } from "node:crypto";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const COOP_ORIGIN = "https://cooponline.vn";
const IAM_API_URL = "https://identity.tekoapis.com/api";
const OAUTH_AUTHORIZE_URL = "https://oauth-saigoncoop.oauth.teko.vn/oauth/authorize";
const OAUTH_TOKEN_URL = "https://oauth-saigoncoop.oauth.teko.vn/oauth/token";
const CART_API_URL = "https://carts-consumer.tekoapis.com/api/v2/carts";
const CART_ITEMS_API_URL = "https://carts-consumer.tekoapis.com/api/v2/carts/items";
const CART_ORDERS_API_URL = "https://carts-consumer.tekoapis.com/api/v1/orders";
const USER_API_URL = "https://users.tekoapis.com";
const PAYMENT_BFF_API_URL = "https://payment-consumer-bff.tekoapis.com";
const COOP_LOG_PATH = path.join(process.cwd(), "logs", "coop-api.log");
const COOP_TOKEN_CACHE_PATH = path.join(process.cwd(), ".coop_token_cache.json");
const coopFetchTimeoutMs = Number(process.env.COOP_FETCH_TIMEOUT_MS || 15000);
const coopFetchRetries = Number(process.env.COOP_FETCH_RETRIES || 1);
const COOP_FETCH_TIMEOUT_MS =
  Number.isFinite(coopFetchTimeoutMs) && coopFetchTimeoutMs > 0 ? coopFetchTimeoutMs : 15000;
const COOP_FETCH_RETRIES =
  Number.isFinite(coopFetchRetries) && coopFetchRetries >= 0 ? Math.floor(coopFetchRetries) : 1;

// === TOKEN CACHE ===
// Bật bằng env: COOP_USE_TOKEN_CACHE=true
// Khi bật, access_token sẽ được đọc từ file cache trước, chỉ login lại khi hết hạn.
const USE_TOKEN_CACHE = process.env.COOP_USE_TOKEN_CACHE === "true";
const SKIP_LOGIN = ["1", "true", "yes"].includes(String(process.env.COOP_SKIP_LOGIN || "").toLowerCase());

type CoopTokenCache = {
  access_token: string;
  token_type: string;
  scope: string;
  iat: number; // Unix timestamp (seconds)
  exp: number; // Unix timestamp (seconds)
  sub: string;
  phone?: string; // SĐT gắn với token này
};

type CoopTokenCacheFile =
  | CoopTokenCache
  | {
      version?: number;
      tokens?: Record<string, CoopTokenCache>;
    };

function isTokenCacheEntry(value: unknown): value is CoopTokenCache {
  const entry = value as Partial<CoopTokenCache> | null;
  return Boolean(entry?.access_token && entry.exp);
}

async function readTokenCacheFile(): Promise<Record<string, CoopTokenCache>> {
  try {
    const raw = await readFile(COOP_TOKEN_CACHE_PATH, "utf-8");
    const parsed = JSON.parse(raw) as CoopTokenCacheFile;
    if ("tokens" in parsed && parsed.tokens && typeof parsed.tokens === "object") {
      return Object.fromEntries(
        Object.entries(parsed.tokens)
          .filter(([, entry]) => isTokenCacheEntry(entry))
          .map(([phone, entry]) => [normalizeCoopPhone(entry.phone || phone), { ...entry, phone: normalizeCoopPhone(entry.phone || phone) }]),
      );
    }
    if (isTokenCacheEntry(parsed)) {
      const phone = normalizeCoopPhone(parsed.phone || "");
      return phone ? { [phone]: { ...parsed, phone } } : {};
    }
  } catch {
    // Cache file is optional.
  }
  return {};
}

async function readTokenCache(phone: string): Promise<CoopTokenCache | null> {
  if (!USE_TOKEN_CACHE) return null;
  const normalizedPhone = normalizeCoopPhone(phone);
  const tokens = await readTokenCacheFile();
  const cache = tokens[normalizedPhone];
  if (!cache?.access_token || !cache.exp) return null;
  const nowSec = Math.floor(Date.now() / 1000);
  if (cache.exp - nowSec < 300) {
    console.log(`[token-cache] Token ${normalizedPhone} hết hạn (exp=${cache.exp}, now=${nowSec}), cần login lại`);
    return null;
  }
  console.log(`[token-cache] Dùng cached token cho ${normalizedPhone} (còn ${Math.round((cache.exp - nowSec) / 3600)}h)`);
  return cache;
}

export async function writeTokenCache(token: CoopTokenResponse, phone: string): Promise<void> {
  if (!USE_TOKEN_CACHE) return;
  try {
    const normalizedPhone = normalizeCoopPhone(phone);
    // Decode exp từ JWT payload
    const parts = token.access_token.split(".");
    let exp = Math.floor(Date.now() / 1000) + (token.expires_in ?? 3600);
    let iat = Math.floor(Date.now() / 1000);
    let sub = "";
    if (parts.length === 3) {
      try {
        const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf-8")) as {
          exp?: number; iat?: number; sub?: string;
        };
        if (payload.exp) exp = payload.exp;
        if (payload.iat) iat = payload.iat;
        if (payload.sub) sub = payload.sub;
      } catch { /* ignore */ }
    }
    const cache: CoopTokenCache = {
      access_token: token.access_token,
      token_type: token.token_type ?? "Bearer",
      scope: COOP_SCOPE,
      iat,
      exp,
      sub,
      phone: normalizedPhone,
    };
    const tokens = await readTokenCacheFile();
    tokens[normalizedPhone] = cache;
    await writeFile(
      COOP_TOKEN_CACHE_PATH,
      JSON.stringify({ version: 2, tokens }, null, 2),
      "utf-8",
    );
    console.log(`[token-cache] Đã lưu token cho ${normalizedPhone} (exp=${exp})`);
  } catch (err) {
    console.log(`[token-cache] Lỗi ghi cache: ${err}`);
  }
}

export function shouldSkipCoopLogin() {
  return SKIP_LOGIN;
}

export async function getCachedCoopToken(phone: string): Promise<CoopTokenResponse | null> {
  const cached = await readTokenCache(phone);
  if (!cached) return null;
  return { access_token: cached.access_token, token_type: cached.token_type } as CoopTokenResponse;
}

// Lấy token: đọc cache trước, nếu không có thì login
export async function getOrLoginCoopToken(input: {
  flow: CoopOauthFlow;
  phone: string;
  password: string;
}): Promise<CoopTokenResponse> {
  const cached = await getCachedCoopToken(input.phone);
  if (cached) return cached;
  if (SKIP_LOGIN) {
    throw new CoopOrderError("Đang bật skip login Co.op nhưng token cache không có hoặc đã hết hạn.", {
      status: 409,
      code: "COOP_TOKEN_CACHE_MISSING",
    });
  }
  const token = await loginAndToken(input);
  await writeTokenCache(token, input.phone);
  return token;
}
// === END TOKEN CACHE ===

export const COOP_CLIENT_ID = "a58f641112ee4d198dc6db4d90bc5cfa";
export const COOP_REDIRECT_URI = "https://cooponline.vn/kirin-brand.kirin";
export const COOP_SCOPE = "openid profile us om ppm loyalty-consumer-bff payment-consumer-bff staff-bff";
export const COOP_MIN_ORDER_TOTAL = 200000;
export const COOP_DEFAULT_TERMINAL = process.env.COOP_TERMINAL_CODE || "570_sgc";
const COOP_CHANNEL_INFO = {
  channelCode: "vnshop_online",
  channelType: "online",
  channelId: 6,
};
const COOP_PLATFORM_ID = 2295;

export type CoopOauthFlow = {
  loginChallenge: string;
  state: string;
  verifier: string;
};

export type CoopCartItem = {
  sku: string;
  sellerSku: string;
  quantity: number;
};

export type CoopDeliverySlot = {
  from: string;
  to: string;
  disabled?: boolean;
};

export type CoopDeliveryCheck = {
  serviceId?: number;
  serviceName?: string;
  requireDeliveryTimeSlot?: string;
  availableDates: string[];
  availableTimeSlots: CoopDeliverySlot[];
  availableSlotsByDate?: Record<string, CoopDeliverySlot[]>;
  fullAddress?: string;
  selectedDate?: string | null;
  selectedSlotFrom?: string | null;
  selectedSlotTo?: string | null;
  message: string;
};

export type CoopPaymentCheck = {
  selectedMethodCode?: string;
  selectedMethodName?: string;
  codAvailable: boolean;
  codSelected: boolean;
  methods: Array<{
    icon?: string;
    methodCode?: string;
    methodGroupCode?: string;
    merchantCode?: string;
    merchantMethodCode?: string;
    paymentTerminalCode?: string;
    name?: string;
    description?: string;
    isSelected?: boolean;
    isDisabled?: boolean;
    warning?: unknown;
    amount?: number | null;
    maxTransactionAmount?: number;
    paymentMethodType?: string;
  }>;
  message: string;
};

export type CoopDeliveryInfo = {
  deliveryType?: string;
  name?: string;
  phone?: string;
  email?: string;
  addressId?: string;
  addressLine?: string;
  wardId?: string;
  wardName?: string;
  districtId?: string;
  districtName?: string;
  provinceId?: string;
  provinceName?: string;
  fullAddress?: string;
  siteId?: number;
  latitude?: string;
  longitude?: string;
  scheduledDeliveryDate?: string;
  scheduledDeliveryTimeSlotFrom?: string;
  scheduledDeliveryTimeSlotTo?: string;
};

type CoopScheduleSelection = {
  scheduledDeliveryDate: string;
  scheduledDeliveryTimeSlotFrom: string;
  scheduledDeliveryTimeSlotTo: string;
};

export type CoopAddressSyncInfo = {
  action: "created" | "updated" | "existing" | "missing";
  addressId?: string;
  isDefault?: boolean;
};

type CoopCustomerInfo = {
  id?: string;
  profileId?: string;
  name?: string;
  email?: string;
  phone?: string;
};

type CoopProfileAddress = {
  id?: string;
  name?: string;
  telephone?: string;
  email?: string;
  address?: string;
  fullAddress?: string;
  addressNote?: string | null;
  provinceCode?: string;
  provinceName?: string;
  districtCode?: string;
  districtName?: string;
  wardCode?: string;
  wardName?: string;
  isDefault?: boolean;
  longitude?: string;
  latitude?: string;
};

type CoopProfile = {
  id?: string;
  userId?: string;
  name?: string;
  email?: string;
  telephone?: string;
  address?: CoopProfileAddress | null;
};

export type CoopCheckoutOrderResult = {
  code?: string;
  orderId?: string;
  createdAt?: string;
  grandTotal?: number;
  totalPaid?: number;
  paymentMethodCode?: string;
  paymentUrl?: string;
  paymentRaw?: unknown;
  raw: unknown;
};

export type CoopTokenResponse = {
  access_token: string;
  refresh_token?: string;
  id_token?: string;
  expires_in?: number;
  token_type?: string;
};

export class CoopOrderError extends Error {
  status: number;
  code?: string;
  detail?: unknown;

  constructor(message: string, options: { status?: number; code?: string; detail?: unknown } = {}) {
    super(message);
    this.name = "CoopOrderError";
    this.status = options.status ?? 400;
    this.code = options.code;
    this.detail = options.detail;
  }
}

function redactCoopLog(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactCoopLog);
  if (!value || typeof value !== "object") return value;
  const redacted: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value)) {
    if (/password|access_token|refresh_token|id_token|authorization|code_verifier/i.test(key)) {
      redacted[key] = "[REDACTED]";
    } else {
      redacted[key] = redactCoopLog(val);
    }
  }
  return redacted;
}

async function logCoopResponse(entry: {
  url: string;
  method?: string;
  status: number;
  ok: boolean;
  code?: string | number;
  message?: string;
  request?: unknown;
  body?: unknown;
}) {
  try {
    await mkdir(path.dirname(COOP_LOG_PATH), { recursive: true });
    await appendFile(
      COOP_LOG_PATH,
      `${JSON.stringify({
        ts: new Date().toISOString(),
        ...entry,
        request: redactCoopLog(entry.request),
        body: redactCoopLog(entry.body),
      })}\n`,
      "utf8",
    );
  } catch {
    // Logging must never break checkout flow.
  }
}

type CoopFetchInput = Parameters<typeof fetch>[0];
type CoopFetchInit = Parameters<typeof fetch>[1];

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function coopFetchUrl(input: CoopFetchInput) {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  if (input instanceof Request) return input.url;
  return String(input);
}

function redactCoopUrl(value: string) {
  try {
    const url = new URL(value);
    for (const key of url.searchParams.keys()) {
      if (/token|code|challenge|state|nonce|verifier|password/i.test(key)) {
        url.searchParams.set(key, "[REDACTED]");
      }
    }
    return url.toString();
  } catch {
    return value;
  }
}

function coopServiceName(value: string) {
  try {
    const host = new URL(value).hostname;
    if (host.includes("identity.tekoapis.com")) return "Co.op IAM";
    if (host.includes("oauth-saigoncoop.oauth.teko.vn")) return "Co.op OAuth";
    if (host.includes("carts-consumer.tekoapis.com")) return "Co.op Cart";
    if (host.includes("payment-consumer-bff.tekoapis.com")) return "Co.op Payment";
    if (host.includes("users.tekoapis.com")) return "Co.op User";
    if (host.includes("cooponline.vn")) return "Co.op Online";
    return host;
  } catch {
    return "Co.op";
  }
}

function coopFetchErrorInfo(err: unknown) {
  const anyErr = err as {
    name?: string;
    message?: string;
    cause?: { code?: string; message?: string };
  };
  return {
    name: anyErr.name || "Error",
    message: anyErr.message || String(err),
    causeCode: anyErr.cause?.code,
    causeMessage: anyErr.cause?.message,
  };
}

function isRetryableCoopNetworkError(err: unknown) {
  const { name, message, causeCode, causeMessage } = coopFetchErrorInfo(err);
  const haystack = `${name} ${message} ${causeCode ?? ""} ${causeMessage ?? ""}`.toLowerCase();
  return (
    haystack.includes("und_err_connect_timeout") ||
    haystack.includes("und_err_headers_timeout") ||
    haystack.includes("connect timeout") ||
    haystack.includes("econnreset") ||
    haystack.includes("etimedout")
  );
}

async function coopFetch(input: CoopFetchInput, init?: CoopFetchInit) {
  const url = coopFetchUrl(input);
  const method = init?.method || "GET";
  const attempts = Math.max(1, COOP_FETCH_RETRIES + 1);
  let lastErr: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fetch(input, {
        ...init,
        signal: init?.signal ?? AbortSignal.timeout(COOP_FETCH_TIMEOUT_MS),
      });
    } catch (err) {
      lastErr = err;
      if (attempt < attempts && isRetryableCoopNetworkError(err)) {
        await sleep(300 * attempt);
        continue;
      }
      break;
    }
  }

  const info = coopFetchErrorInfo(lastErr);
  const service = coopServiceName(url);
  const redactedUrl = redactCoopUrl(url);
  await logCoopResponse({
    url: redactedUrl,
    method,
    status: 0,
    ok: false,
    code: info.causeCode || info.name || "FETCH_FAILED",
    message: info.causeMessage || info.message,
    body: { attempts, timeoutMs: COOP_FETCH_TIMEOUT_MS },
  });
  throw new CoopOrderError(`${service} chưa phản hồi, vui lòng thử lại.`, {
    status: 502,
    code: "COOP_FETCH_FAILED",
    detail: {
      service,
      url: redactedUrl,
      method,
      attempts,
      reason: info.causeCode || info.name,
      message: info.causeMessage || info.message,
    },
  });
}

export function normalizeCoopPhone(phone: string) {
  return phone.replace(/[\s.\-()]/g, "").replace(/^(\+?84)/, "0");
}

export function isValidCoopPhone(phone: string) {
  return /^0[35789]\d{8}$/.test(normalizeCoopPhone(phone));
}

export function normalizeQuantity(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 99) : 1;
}

export function normalizeTerminalCode(value: unknown) {
  const code = typeof value === "string" ? value.trim() : "";
  return /^\d+_sgc$/i.test(code) ? code : COOP_DEFAULT_TERMINAL;
}

export function extractCoopSku(...values: Array<unknown>) {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const text = value.trim();
    if (!text) continue;
    const slugMatch = text.match(/--s([A-Za-z0-9._-]+)/);
    if (slugMatch?.[1]) return slugMatch[1];
    const paramMatch = text.match(/[?&](?:sku|skuId)=([A-Za-z0-9._-]+)/i);
    if (paramMatch?.[1]) return paramMatch[1];
  }
  for (const value of values) {
    if (typeof value !== "string") continue;
    const text = value.trim();
    if (!text) continue;
    if (/^[A-Za-z0-9._-]{5,}$/.test(text)) return text;
  }
  return "";
}

function browserHeaders(): HeadersInit {
  return {
    accept: "*/*",
    "accept-language": "vi-VN,vi;q=0.9,en-US;q=0.6,en;q=0.5",
    origin: COOP_ORIGIN,
    referer: `${COOP_ORIGIN}/`,
    "user-agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36",
  };
}

function base64Url(input: Buffer) {
  return input.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function randomString(bytes = 32) {
  return base64Url(randomBytes(bytes));
}

function pkceChallenge(verifier: string) {
  return base64Url(createHash("sha256").update(verifier).digest());
}

async function parseJsonResponse<T>(
  res: Response,
  context: { method?: string; request?: unknown } = {},
): Promise<T> {
  const text = await res.text();
  let data: unknown = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      throw new CoopOrderError(`Co.op returned non-JSON HTTP ${res.status}`, {
        status: res.ok ? 502 : res.status,
        detail: text.slice(0, 400),
      });
    }
  }

  const logBody = data as { error?: { code?: string | number; message?: string }; code?: string | number; message?: string };
  await logCoopResponse({
    url: res.url,
    method: context.method,
    status: res.status,
    ok: res.ok,
    code: logBody.error?.code ?? logBody.code,
    message: logBody.error?.message ?? logBody.message,
    request: context.request,
    body: data,
  });

  if (!res.ok) {
    const body = data as { error?: { code?: string | number; message?: string }; code?: string | number; message?: string };
    const code = String(body.error?.code ?? body.code ?? res.status);
    const message = body.error?.message ?? body.message ?? `Co.op HTTP ${res.status}`;
    throw new CoopOrderError(message, { status: res.status, code, detail: data });
  }

  const body = data as { error?: { code?: string | number; message?: string }; code?: string | number; message?: string };
  const apiCode = body.error?.code ?? body.code;
  if (apiCode !== undefined && !["0", "00", "200", "USI000S"].includes(String(apiCode))) {
    const code = String(apiCode);
    const message = body.error?.message ?? body.message ?? `Co.op API error ${code}`;
    throw new CoopOrderError(message, { status: 502, code, detail: data });
  }

  return data as T;
}

function isCompleteCoopDeliveryInfo(value: CoopDeliveryInfo | undefined): value is CoopDeliveryInfo {
  return Boolean(
    value?.deliveryType &&
      value.name &&
      value.phone &&
      value.addressId &&
      value.wardId &&
      value.districtId &&
      value.provinceId &&
      value.fullAddress,
  );
}

function buildProfileFullAddress(address: CoopProfileAddress) {
  return (
    address.fullAddress ||
    [address.address, address.wardName, address.districtName, address.provinceName].filter(Boolean).join(", ")
  );
}

function splitCoopFullAddress(value?: string) {
  const parts = String(value || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  return {
    address: parts.length > 3 ? parts.slice(0, -3).join(", ") : parts[0],
    wardName: parts.length > 3 ? parts[parts.length - 3] : undefined,
    districtName: parts.length > 2 ? parts[parts.length - 2] : undefined,
    provinceName: parts.length > 1 ? parts[parts.length - 1] : undefined,
  };
}

function normalizeCoopLocationName(value?: string) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "d")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function inferCoopLocationCodes(input: {
  provinceName?: string;
  districtName?: string;
  wardName?: string;
}) {
  const province = normalizeCoopLocationName(input.provinceName);
  const district = normalizeCoopLocationName(input.districtName);
  const ward = normalizeCoopLocationName(input.wardName);
  if (
    (province.includes("ho chi minh") || province.includes("hcm") || province.includes("tp.hcm")) &&
    district.includes("tan phu") &&
    ward.includes("tan son nhi")
  ) {
    return {
      provinceCode: "79",
      districtCode: "7908",
      wardCode: "790801",
      provinceName: input.provinceName || "Thành phố Hồ Chí Minh",
      districtName: input.districtName || "Quận Tân Phú",
      wardName: input.wardName || "Phường Tân Sơn Nhì",
    };
  }
  return null;
}

function profileAddressToDeliveryInfo(profile: CoopProfile, fallback?: CoopDeliveryInfo): CoopDeliveryInfo | null {
  const address = profile.address;
  if (!address?.id || !address.wardCode || !address.districtCode || !address.provinceCode) return null;
  const fullAddress = buildProfileFullAddress(address);
  if (!fullAddress) return null;

  return {
    deliveryType: "DELIVERY_TYPE_AT_HOME",
    name: fallback?.name || address.name || profile.name || fallback?.phone,
    phone: fallback?.phone || address.telephone || profile.telephone,
    email: fallback?.email || address.email || profile.email,
    addressId: address.id,
    addressLine: address.address,
    wardId: address.wardCode,
    wardName: address.wardName,
    districtId: address.districtCode,
    districtName: address.districtName,
    provinceId: address.provinceCode,
    provinceName: address.provinceName,
    fullAddress,
    siteId: fallback?.siteId,
  };
}

function userHeaders(accessToken: string): HeadersInit {
  return {
    ...browserHeaders(),
    authorization: `Bearer ${accessToken}`,
  };
}

async function getCoopProfile(input: { accessToken: string }) {
  const url = new URL(`${USER_API_URL}/profiles`);
  url.searchParams.set("platformId", String(COOP_PLATFORM_ID));
  const res = await coopFetch(url, {
    headers: userHeaders(input.accessToken),
    cache: "no-store",
  });
  const data = await parseJsonResponse<{ result?: { profile?: CoopProfile } }>(res, { method: "GET" });
  const profile = data.result?.profile;
  if (!profile) {
    throw new CoopOrderError("Co.op chưa trả profile người dùng.", {
      status: 502,
      code: "COOP_PROFILE_MISSING",
      detail: data,
    });
  }
  return profile;
}

async function setCoopDefaultAddress(input: { accessToken: string; address: CoopProfileAddress }) {
  if (!input.address.id) return null;
  const payload = {
    name: input.address.name,
    telephone: input.address.telephone,
    email: input.address.email,
    provinceCode: input.address.provinceCode,
    districtCode: input.address.districtCode,
    wardCode: input.address.wardCode,
    address: input.address.address,
    platformId: COOP_PLATFORM_ID,
    provinceName: input.address.provinceName,
    districtName: input.address.districtName,
    wardName: input.address.wardName,
    isDefault: true,
    longitude: input.address.longitude ?? "",
    latitude: input.address.latitude ?? "",
  };
  const res = await coopFetch(`${USER_API_URL}/addresses/${input.address.id}`, {
    method: "PATCH",
    headers: { ...userHeaders(input.accessToken), "content-type": "application/json" },
    body: JSON.stringify(payload),
    cache: "no-store",
  });
  return parseJsonResponse(res, { method: "PATCH", request: payload });
}

// Toạ độ Co.op hợp lệ: chuỗi số hữu hạn và KHÁC 0 ("0"/""/undefined → "" để bỏ qua,
// tránh giữ lại toạ độ rác đã lưu trong tài khoản).
function validCoopCoord(value?: string): string {
  if (!value) return "";
  const n = Number(value);
  return Number.isFinite(n) && n !== 0 ? String(n) : "";
}

function buildCoopAddressPayload(input: {
  profile: CoopProfile;
  fallback?: CoopDeliveryInfo;
  current?: CoopProfileAddress | null;
}) {
  const parsed = splitCoopFullAddress(input.fallback?.fullAddress);
  const current = input.current;
  const provinceName = input.fallback?.provinceName || parsed.provinceName || current?.provinceName;
  const districtName = input.fallback?.districtName || parsed.districtName || current?.districtName;
  const wardName = input.fallback?.wardName || parsed.wardName || current?.wardName;
  const inferredCodes = inferCoopLocationCodes({ provinceName, districtName, wardName });
  return {
    name: input.fallback?.name || current?.name || input.profile.name || input.fallback?.phone,
    telephone: input.fallback?.phone || current?.telephone || input.profile.telephone,
    email: input.fallback?.email || current?.email || input.profile.email,
    provinceCode: input.fallback?.provinceId || current?.provinceCode || inferredCodes?.provinceCode,
    districtCode: input.fallback?.districtId || current?.districtCode || inferredCodes?.districtCode,
    wardCode: input.fallback?.wardId || current?.wardCode || inferredCodes?.wardCode,
    address: input.fallback?.addressLine || parsed.address || current?.address,
    platformId: COOP_PLATFORM_ID,
    provinceName: provinceName || inferredCodes?.provinceName,
    districtName: districtName || inferredCodes?.districtName,
    wardName: wardName || inferredCodes?.wardName,
    isDefault: true,
    longitude: validCoopCoord(input.fallback?.longitude) || validCoopCoord(current?.longitude) || "",
    latitude: validCoopCoord(input.fallback?.latitude) || validCoopCoord(current?.latitude) || "",
  };
}

function completeCoopAddressPayload(payload: ReturnType<typeof buildCoopAddressPayload>) {
  return Boolean(
    payload.name &&
      payload.telephone &&
      payload.provinceCode &&
      payload.districtCode &&
      payload.wardCode &&
      payload.address,
  );
}

async function upsertCoopDeliveryAddress(input: {
  accessToken: string;
  profile: CoopProfile;
  fallback?: CoopDeliveryInfo;
}): Promise<{ address: CoopProfileAddress | null; sync: CoopAddressSyncInfo }> {
  const current = input.profile.address;
  const payload = buildCoopAddressPayload({
    profile: input.profile,
    fallback: input.fallback,
    current,
  });
  if (!completeCoopAddressPayload(payload)) {
    return {
      address: current ?? null,
      sync: current?.id
        ? { action: "existing", addressId: current.id, isDefault: current.isDefault }
        : { action: "missing" },
    };
  }

  if (current?.id) {
    const res = await coopFetch(`${USER_API_URL}/addresses/${current.id}`, {
      method: "PATCH",
      headers: { ...userHeaders(input.accessToken), "content-type": "application/json" },
      body: JSON.stringify(payload),
      cache: "no-store",
    });
    await parseJsonResponse(res, { method: "PATCH", request: payload });
    const address = { ...current, ...payload, id: current.id };
    return { address, sync: { action: "updated", addressId: current.id, isDefault: payload.isDefault } };
  }

  const res = await coopFetch(`${USER_API_URL}/addresses`, {
    method: "POST",
    headers: { ...userHeaders(input.accessToken), "content-type": "application/json" },
    body: JSON.stringify(payload),
    cache: "no-store",
  });
  const data = await parseJsonResponse<{ result?: { address?: CoopProfileAddress }; data?: CoopProfileAddress }>(res, {
    method: "POST",
    request: payload,
  });
  const address = data.result?.address ?? data.data ?? null;
  return { address, sync: { action: "created", addressId: address?.id, isDefault: payload.isDefault } };
}

async function resolveCoopDeliveryInfo(input: {
  accessToken: string;
  fallback?: CoopDeliveryInfo;
}): Promise<{ deliveryInfo: CoopDeliveryInfo; addressSync: CoopAddressSyncInfo }> {
  const profile = await getCoopProfile({ accessToken: input.accessToken });
  const synced = await upsertCoopDeliveryAddress({
    accessToken: input.accessToken,
    profile,
    fallback: input.fallback,
  });
  const syncedAddress = synced.address;
  const syncedProfile: CoopProfile = syncedAddress ? { ...profile, address: syncedAddress } : profile;

  if (syncedProfile.address?.id) {
    await setCoopDefaultAddress({ accessToken: input.accessToken, address: syncedProfile.address }).catch(() => null);
  }
  const deliveryInfo = profileAddressToDeliveryInfo(syncedProfile, input.fallback);
  const addressSync = syncedProfile.address?.id
    ? { ...synced.sync, addressId: syncedProfile.address.id, isDefault: true }
    : synced.sync;
  if (deliveryInfo && isCompleteCoopDeliveryInfo(deliveryInfo)) return { deliveryInfo, addressSync };
  if (isCompleteCoopDeliveryInfo(input.fallback)) return { deliveryInfo: input.fallback, addressSync };

  throw new CoopOrderError("Co.op chưa có địa chỉ mặc định hợp lệ trong tài khoản.", {
    status: 400,
    code: "COOP_DEFAULT_ADDRESS_MISSING",
    detail: {
      profileId: profile.id,
      hasAddress: Boolean(syncedProfile.address),
      fallback: input.fallback,
    },
  });
}

async function postJson<T>(url: string, payload: unknown): Promise<T> {
  const res = await coopFetch(url, {
    method: "POST",
    headers: { ...browserHeaders(), "content-type": "application/json" },
    body: JSON.stringify(payload),
    cache: "no-store",
  });
  return parseJsonResponse<T>(res, { method: "POST", request: payload });
}

export async function beginCoopOauth(): Promise<CoopOauthFlow> {
  const state = randomString(24);
  const nonce = randomString(24);
  const verifier = randomString(48);
  const url = new URL(OAUTH_AUTHORIZE_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", COOP_CLIENT_ID);
  url.searchParams.set("redirect_uri", COOP_REDIRECT_URI);
  url.searchParams.set("scope", COOP_SCOPE);
  url.searchParams.set("state", state);
  url.searchParams.set("nonce", nonce);
  url.searchParams.set("code_challenge", pkceChallenge(verifier));
  url.searchParams.set("code_challenge_method", "S256");

  const res = await coopFetch(url, {
    headers: browserHeaders(),
    redirect: "follow",
    cache: "no-store",
  });
  const finalUrl = new URL(res.url);
  const loginChallenge = finalUrl.searchParams.get("challenge") || finalUrl.searchParams.get("login_challenge");
  if (!loginChallenge) {
    throw new CoopOrderError("Không lấy được login challenge từ Co.op OAuth.", {
      status: 502,
      code: "COOP_CHALLENGE_MISSING",
      detail: { finalUrl: res.url },
    });
  }
  return { loginChallenge, state, verifier };
}

export async function registerCoopUser(input: { challenge: string; phone: string; password: string; name?: string }) {
  return postJson<{ id?: string; phone_number?: string; confirmed?: boolean }>(`${IAM_API_URL}/v1/users/register`, {
    username: normalizeCoopPhone(input.phone),
    password: input.password,
    name: input.name?.trim() || undefined,
    client_id: COOP_CLIENT_ID,
  });
}

export async function resendCoopActivation(phone: string) {
  return postJson(`${IAM_API_URL}/v1/users/activation/resend`, {
    username: normalizeCoopPhone(phone),
    client_id: COOP_CLIENT_ID,
  });
}

export async function confirmCoopUser(input: { challenge: string; phone: string; code: string }) {
  return postJson<{ redirect_to?: string }>(`${IAM_API_URL}/v1/users/confirm`, {
    challenge: input.challenge,
    username: normalizeCoopPhone(input.phone),
    code: input.code,
    client_id: COOP_CLIENT_ID,
  });
}

export async function loginCoopPassword(input: { challenge: string; phone: string; password: string }) {
  return postJson<{ redirect_to?: string }>(`${IAM_API_URL}/v1/users/login`, {
    challenge: input.challenge,
    username: normalizeCoopPhone(input.phone),
    password: input.password,
    client_id: COOP_CLIENT_ID,
  });
}

export async function exchangeCoopToken(input: { redirectTo: string; state: string; verifier: string }) {
  const redirected = await coopFetch(input.redirectTo, {
    headers: browserHeaders(),
    redirect: "follow",
    cache: "no-store",
  });
  const finalUrl = new URL(redirected.url);
  const code = finalUrl.searchParams.get("code");
  const returnedState = finalUrl.searchParams.get("state");
  if (!code) {
    throw new CoopOrderError("Co.op login không trả OAuth code.", {
      status: 502,
      code: "COOP_CODE_MISSING",
      detail: { finalUrl: redirected.url },
    });
  }
  if (returnedState && returnedState !== input.state) {
    throw new CoopOrderError("OAuth state của Co.op không khớp.", {
      status: 502,
      code: "COOP_STATE_MISMATCH",
    });
  }

  const form = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: COOP_REDIRECT_URI,
    client_id: COOP_CLIENT_ID,
    code_verifier: input.verifier,
  });
  const res = await coopFetch(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { ...browserHeaders(), "content-type": "application/x-www-form-urlencoded" },
    body: form,
    cache: "no-store",
  });
  const token = await parseJsonResponse<CoopTokenResponse>(res);
  if (!token.access_token) {
    throw new CoopOrderError("Co.op token response thiếu access_token.", {
      status: 502,
      code: "COOP_ACCESS_TOKEN_MISSING",
    });
  }
  return token;
}

function cartHeaders(accessToken: string, cartToken?: string): HeadersInit {
  return {
    ...browserHeaders(),
    authorization: `Bearer ${accessToken}`,
    "content-type": "application/json",
    "use-combo-v2": "true",
    "use-exclusion-v2": "false",
    ...(cartToken ? { "x-cart-token": cartToken } : {}),
  };
}

function paymentHeaders(accessToken: string): HeadersInit {
  return {
    ...browserHeaders(),
    authorization: `Bearer ${accessToken}`,
    "accept-language": "vi",
    "content-type": "application/json",
  };
}

function readCartToken(res: Response, fallback?: string) {
  return res.headers.get("x-cart-token") || res.headers.get("X-Cart-Token") || fallback || "";
}

export async function createCoopCart(input: { accessToken: string; terminalCode: string }) {
  const url = new URL(CART_API_URL);
  url.searchParams.set("terminal", input.terminalCode);
  const payload = {};
  const res = await coopFetch(url, {
    method: "POST",
    headers: cartHeaders(input.accessToken),
    body: JSON.stringify(payload),
    cache: "no-store",
  });
  const data = await parseJsonResponse<{ data?: { cartToken?: string }; result?: { cartToken?: string } }>(res, {
    method: "POST",
    request: payload,
  });
  const cartToken = readCartToken(res, data.data?.cartToken ?? data.result?.cartToken);
  if (!cartToken) {
    throw new CoopOrderError("Co.op không trả cart token.", { status: 502, code: "COOP_CART_TOKEN_MISSING", detail: data });
  }
  return { cartToken, data };
}

export async function clearCoopCart(input: { accessToken: string; terminalCode: string; cartToken: string }) {
  const url = new URL(CART_API_URL);
  url.searchParams.set("terminal", input.terminalCode);
  const res = await coopFetch(url, {
    method: "DELETE",
    headers: cartHeaders(input.accessToken, input.cartToken),
    cache: "no-store",
  });
  const data = await parseJsonResponse(res, { method: "DELETE", request: { terminal: input.terminalCode } });
  return { cartToken: readCartToken(res, input.cartToken), data };
}

export async function cancelCoopPendingOrder(input: {
  accessToken: string;
  terminalCode: string;
  cartToken: string;
  orderId: string;
}) {
  const url = new URL(CART_ORDERS_API_URL);
  url.searchParams.set("terminal", input.terminalCode);
  const payload = { orderId: input.orderId, cancelOrder: true };
  const res = await coopFetch(url, {
    method: "POST",
    headers: cartHeaders(input.accessToken, input.cartToken),
    body: JSON.stringify(payload),
    cache: "no-store",
  });
  const data = await parseJsonResponse<{ result?: { cartToken?: string } }>(res, {
    method: "POST",
    request: payload,
  });
  const cartToken = readCartToken(res, data.result?.cartToken ?? input.cartToken);
  if (!cartToken) {
    throw new CoopOrderError("Co.op đã hủy đơn nhưng không trả cart token mới.", {
      status: 502,
      code: "COOP_CANCEL_CART_TOKEN_MISSING",
      detail: data,
    });
  }
  return { cartToken, data };
}

export async function addCoopCartItem(input: {
  accessToken: string;
  terminalCode: string;
  cartToken: string;
  item: CoopCartItem;
  clearExisting?: boolean;
}) {
  return addCoopCartItems({
    accessToken: input.accessToken,
    terminalCode: input.terminalCode,
    cartToken: input.cartToken,
    items: [input.item],
    clearExisting: input.clearExisting,
  });
}

export async function addCoopCartItems(input: {
  accessToken: string;
  terminalCode: string;
  cartToken: string;
  items: CoopCartItem[];
  clearExisting?: boolean;
}) {
  if (!input.items.length) {
    throw new CoopOrderError("Co.op cần ít nhất 1 sản phẩm để tạo giỏ.", {
      status: 400,
      code: "COOP_CART_ITEMS_EMPTY",
    });
  }
  const url = new URL(CART_ITEMS_API_URL);
  url.searchParams.set("terminal", input.terminalCode);
  const payload = {
    groups: [
      {
        products: input.items.map((item) => ({
          sku: item.sku,
          sellerSku: item.sellerSku,
          quantity: item.quantity,
        })),
      },
    ],
    override: input.clearExisting === true,
  };
  const res = await coopFetch(url, {
    method: "POST",
    headers: cartHeaders(input.accessToken, input.cartToken),
    body: JSON.stringify(payload),
    cache: "no-store",
  });
  const data = await parseJsonResponse(res, { method: "POST", request: payload });
  return { cartToken: readCartToken(res, input.cartToken), data };
}

export async function getCoopCart(input: { accessToken: string; terminalCode: string; cartToken: string }) {
  const url = new URL(CART_API_URL);
  url.searchParams.set("terminal", input.terminalCode);
  const res = await coopFetch(url, {
    headers: cartHeaders(input.accessToken, input.cartToken),
    cache: "no-store",
  });
  const data = await parseJsonResponse(res);
  return { cartToken: readCartToken(res, input.cartToken), data };
}

function toCoopIsoDate(value: unknown) {
  if (typeof value !== "string" || !value) return null;
  const isoDateMatch = value.match(/^(\d{4}-\d{2}-\d{2})/);
  if (isoDateMatch?.[1]) return isoDateMatch[1];
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const day = String(parsed.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function todayLocalIsoDate() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function normalizeCoopDeliverySlots(slots: unknown): CoopDeliverySlot[] {
  if (!Array.isArray(slots)) return [];
  return slots
    .flatMap((slot) => {
      const item = slot as {
        from?: unknown;
        to?: unknown;
        disabled?: unknown;
        isDisabled?: unknown;
        enabled?: unknown;
      };
      const from = typeof item.from === "string" ? item.from : "";
      const to = typeof item.to === "string" ? item.to : "";
      if (!from || !to) return [];
      return [{
        from,
        to,
        disabled: Boolean(item.disabled ?? item.isDisabled ?? item.enabled === false),
      }];
    });
}

function parseDeliveryCheck(cart: unknown): CoopDeliveryCheck {
  const root = cart as { data?: Record<string, unknown> };
  const data = (root?.data ?? root) as {
    deliveryInfo?: {
      scheduledDeliveryDate?: string | null;
      scheduledDeliveryTimeSlotFrom?: string | null;
      scheduledDeliveryTimeSlotTo?: string | null;
      fullAddress?: string | null;
    };
    deliveryServices?: Array<{
      id?: number;
      name?: string;
      isSelected?: boolean;
      requireDeliveryTimeSlot?: string;
      availableDeliveryDateTime?: Array<{ date?: string; timeSlots?: unknown }>;
      availableTimeSlots?: unknown;
    }>;
  };
  const service = data.deliveryServices?.find((item) => item.isSelected) ?? data.deliveryServices?.[0];
  const today = todayLocalIsoDate();
  const selectedDate = toCoopIsoDate(data.deliveryInfo?.scheduledDeliveryDate ?? null);
  const fallbackTimeSlots = normalizeCoopDeliverySlots(service?.availableTimeSlots);
  const availableSlotsByDate: Record<string, CoopDeliverySlot[]> = {};
  for (const item of service?.availableDeliveryDateTime ?? []) {
    const date = toCoopIsoDate(item.date);
    if (!date || date < today) continue;
    const datedSlots = normalizeCoopDeliverySlots(item.timeSlots);
    // Co.op đôi khi chỉ trả danh sách slot chung và để timeSlots theo ngày rỗng.
    // Slot chung không an toàn cho hôm nay (có thể đã quá hạn), nhưng có thể map
    // sang ngày tương lai và vẫn được checkout xác nhận lại phía server.
    availableSlotsByDate[date] = datedSlots.length
      ? datedSlots
      : date > today
        ? fallbackTimeSlots
        : [];
  }
  const availableDates = Object.keys(availableSlotsByDate).filter((date) => availableSlotsByDate[date].length > 0);
  const slotDate = selectedDate && availableSlotsByDate[selectedDate] ? selectedDate : availableDates[0];
  const slotsForDate = slotDate ? availableSlotsByDate[slotDate] ?? [] : [];
  // Nếu có lịch theo ngày thì luôn dùng slot đã gắn với ngày ở trên.
  const hasDateSpecificSchedule = (service?.availableDeliveryDateTime?.length ?? 0) > 0;
  const availableTimeSlots = hasDateSpecificSchedule ? slotsForDate : fallbackTimeSlots;
  const selectedSlotFrom = data.deliveryInfo?.scheduledDeliveryTimeSlotFrom ?? null;
  const selectedSlotTo = data.deliveryInfo?.scheduledDeliveryTimeSlotTo ?? null;

  return {
    serviceId: service?.id,
    serviceName: service?.name,
    requireDeliveryTimeSlot: service?.requireDeliveryTimeSlot,
    availableDates,
    availableTimeSlots,
    availableSlotsByDate,
    fullAddress: data.deliveryInfo?.fullAddress ?? undefined,
    selectedDate,
    selectedSlotFrom,
    selectedSlotTo,
    message:
      availableDates.length && availableTimeSlots.length
        ? `Co.op đang cho nhận hàng ${availableDates.join(", ")} với ${availableTimeSlots.length} khung giờ.`
        : "Co.op chưa trả ngày/khung giờ giao hợp lệ cho giỏ này.",
  };
}

function parsePaymentCheck(cart: unknown): CoopPaymentCheck {
  const root = cart as { data?: Record<string, unknown> };
  const data = (root?.data ?? root) as {
    paymentMethods?: Array<{
      icon?: string;
      methodCode?: string;
      methodGroupCode?: string;
      merchantCode?: string;
      merchantMethodCode?: string;
      paymentTerminalCode?: string;
      name?: string;
      description?: string;
      isSelected?: boolean;
      isDisabled?: boolean;
      warning?: unknown;
      amount?: number | null;
      maxTransactionAmount?: number;
      paymentMethodType?: string;
    }>;
  };
  const methods = data.paymentMethods ?? [];
  const selected = methods.find((item) => item.isSelected);
  const cod = methods.find((item) => item.methodCode === "COD");
  return {
    selectedMethodCode: selected?.methodCode,
    selectedMethodName: selected?.name,
    codAvailable: Boolean(cod && !cod.isDisabled),
    codSelected: Boolean(cod?.isSelected),
    methods: methods.map((item) => ({
      icon: item.icon,
      methodCode: item.methodCode,
      methodGroupCode: item.methodGroupCode,
      merchantCode: item.merchantCode,
      merchantMethodCode: item.merchantMethodCode,
      paymentTerminalCode: item.paymentTerminalCode,
      name: item.name,
      description: item.description,
      isSelected: item.isSelected,
      isDisabled: item.isDisabled,
      warning: item.warning,
      amount: item.amount,
      maxTransactionAmount: item.maxTransactionAmount,
      paymentMethodType: item.paymentMethodType,
    })),
    message: selected
      ? `Co.op đang chọn phương thức thanh toán: ${selected.name ?? selected.methodCode}.`
      : "Co.op chưa trả phương thức thanh toán đang chọn.",
  };
}

export async function getCoopConfirmationCart(input: {
  accessToken: string;
  terminalCode: string;
  cartToken: string;
  locationCode?: string;
}) {
  const url = new URL(`${CART_API_URL}/confirmation`);
  url.searchParams.set("terminal", input.terminalCode);
  url.searchParams.set("getFullCart", "true");
  url.searchParams.set("hasAllApplicableOrderPromotions", "true");
  if (input.locationCode) url.searchParams.set("location", input.locationCode);
  const res = await coopFetch(url, {
    headers: cartHeaders(input.accessToken, input.cartToken),
    cache: "no-store",
  });
  const data = await parseJsonResponse(res);
  return {
    cartToken: readCartToken(res, input.cartToken),
    data,
    deliveryCheck: parseDeliveryCheck(data),
    paymentCheck: parsePaymentCheck(data),
  };
}

function readConfirmationData(cart: unknown) {
  const root = cart as { data?: Record<string, unknown> };
  return (root?.data ?? root) as {
    deliveryInfo?: CoopDeliveryInfo;
    customerInfo?: CoopCustomerInfo;
    paymentMethods?: CoopPaymentCheck["methods"];
    paymentMerchantCode?: string;
    paymentTerminalCode?: string;
    grandTotalAmount?: number;
    remainingAmount?: number;
    note?: string;
  };
}

function withScheduleSelection(cart: unknown, schedule: CoopScheduleSelection): unknown {
  if (!cart || typeof cart !== "object") return cart;
  const root = cart as Record<string, unknown>;
  const hasData = root.data && typeof root.data === "object" && !Array.isArray(root.data);
  const data = (hasData ? root.data : root) as Record<string, unknown>;
  const deliveryInfo =
    data.deliveryInfo && typeof data.deliveryInfo === "object" && !Array.isArray(data.deliveryInfo)
      ? (data.deliveryInfo as Record<string, unknown>)
      : {};
  const nextData = {
    ...data,
    deliveryInfo: {
      ...deliveryInfo,
      ...schedule,
    },
  };
  return hasData ? { ...root, data: nextData } : nextData;
}

function withDeliveryCheckSelection(check: CoopDeliveryCheck, schedule: CoopScheduleSelection): CoopDeliveryCheck {
  return {
    ...check,
    selectedDate: toCoopIsoDate(schedule.scheduledDeliveryDate),
    selectedSlotFrom: schedule.scheduledDeliveryTimeSlotFrom,
    selectedSlotTo: schedule.scheduledDeliveryTimeSlotTo,
  };
}

export async function updateCoopDeliveryInfo(input: {
  accessToken: string;
  terminalCode: string;
  cartToken: string;
  deliveryInfo: CoopDeliveryInfo;
}) {
  const url = new URL(`${CART_API_URL}/delivery-info`);
  url.searchParams.set("terminal", input.terminalCode);
  url.searchParams.set("getAllApplicablePromotions", "true");
  const res = await coopFetch(url, {
    method: "PUT",
    headers: cartHeaders(input.accessToken, input.cartToken),
    body: JSON.stringify(input.deliveryInfo),
    cache: "no-store",
  });
  const data = await parseJsonResponse(res, { method: "PUT", request: input.deliveryInfo });
  return {
    cartToken: readCartToken(res, input.cartToken),
    data,
    deliveryCheck: parseDeliveryCheck(data),
    paymentCheck: parsePaymentCheck(data),
  };
}

export async function applyCoopPaymentMethod(input: {
  accessToken: string;
  terminalCode: string;
  cartToken: string;
  paymentMethodCode: string;
}) {
  const url = new URL(`${CART_API_URL}/payment-methods`);
  url.searchParams.set("terminal", input.terminalCode);
  const res = await coopFetch(url, {
    method: "PUT",
    headers: cartHeaders(input.accessToken, input.cartToken),
    body: JSON.stringify({ paymentMethodCode: input.paymentMethodCode }),
    cache: "no-store",
  });
  const data = await parseJsonResponse(res, {
    method: "PUT",
    request: { paymentMethodCode: input.paymentMethodCode },
  });
  return {
    cartToken: readCartToken(res, input.cartToken),
    data,
    deliveryCheck: parseDeliveryCheck(data),
    paymentCheck: parsePaymentCheck(data),
  };
}

export async function prepareCoopCheckout(input: {
  accessToken: string;
  terminalCode: string;
  cartToken: string;
  deliveryDate: string;
  slotFrom: string;
  slotTo: string;
  paymentMethodCode?: string;
}) {
  const confirmation = await getCoopConfirmationCart({
    accessToken: input.accessToken,
    terminalCode: input.terminalCode,
    cartToken: input.cartToken,
  });
  const existingDelivery = readConfirmationData(confirmation.data).deliveryInfo;
  if (!existingDelivery?.fullAddress || !existingDelivery.name || !existingDelivery.phone) {
    throw new CoopOrderError("Co.op chưa có địa chỉ/người nhận trong giỏ. Vui lòng thêm địa chỉ trên Co.op trước.", {
      status: 400,
      code: "COOP_DELIVERY_INFO_MISSING",
      detail: confirmation.deliveryCheck,
    });
  }

  const locationCode = existingDelivery.wardId || undefined;
  const scheduledDeliveryDate = `${input.deliveryDate}T00:00:00+07:00`;
  const selectedSchedule: CoopScheduleSelection = {
    scheduledDeliveryDate,
    scheduledDeliveryTimeSlotFrom: input.slotFrom,
    scheduledDeliveryTimeSlotTo: input.slotTo,
  };

  // Co.op tính khung giờ theo địa bàn → đọc confirmation kèm location (wardCode) để lấy
  // slot THẬT cho khu vực này (per-date timeSlots trong confirmation thường rỗng nếu thiếu location).
  const located = await getCoopConfirmationCart({
    accessToken: input.accessToken,
    terminalCode: input.terminalCode,
    cartToken: confirmation.cartToken,
    locationCode,
  });
  const realSlots = located.deliveryCheck.availableSlotsByDate?.[input.deliveryDate] ?? [];
  const matchedReal = realSlots.find((s) => s.from === input.slotFrom && s.to === input.slotTo && !s.disabled);
  if (!realSlots.length) {
    throw new CoopOrderError(
      "Co.op chưa mở khung giờ giao cho địa chỉ/kho này nên không đặt được lịch. Vui lòng kiểm tra lại địa chỉ (cần định vị đúng), đổi kho Co.op gần hơn, hoặc thử lại sau.",
      {
        status: 409,
        code: "COOP_DELIVERY_SLOT_REJECTED",
        detail: {
          requestedDate: input.deliveryDate,
          requestedSlot: { from: input.slotFrom, to: input.slotTo },
          deliveryCheck: located.deliveryCheck,
        },
      },
    );
  }
  if (!matchedReal) {
    throw new CoopOrderError("Khung giờ này hiện không khả dụng cho địa chỉ/kho Co.op đang chọn. Vui lòng chọn khung giờ khác.", {
      status: 409,
      code: "COOP_DELIVERY_SLOT_UNAVAILABLE",
      detail: {
        requestedDate: input.deliveryDate,
        requestedSlot: { from: input.slotFrom, to: input.slotTo },
        deliveryCheck: located.deliveryCheck,
      },
    });
  }

  const delivery = await updateCoopDeliveryInfo({
    accessToken: input.accessToken,
    terminalCode: input.terminalCode,
    cartToken: located.cartToken,
    deliveryInfo: {
      ...existingDelivery,
      ...selectedSchedule,
    },
  });

  const payment = await applyCoopPaymentMethod({
    accessToken: input.accessToken,
    terminalCode: input.terminalCode,
    cartToken: delivery.cartToken,
    paymentMethodCode: input.paymentMethodCode || "COD",
  });
  const refreshed = await getCoopConfirmationCart({
    accessToken: input.accessToken,
    terminalCode: input.terminalCode,
    cartToken: payment.cartToken,
    locationCode,
  });
  const confirmationCart = withScheduleSelection(refreshed.data, selectedSchedule);
  return {
    cartToken: refreshed.cartToken,
    confirmationCart,
    deliveryCheck: withDeliveryCheckSelection(parseDeliveryCheck(confirmationCart), selectedSchedule),
    paymentCheck: refreshed.paymentCheck,
  };
}

function ensurePreparedCoopOrder(
  cart: unknown,
  terminalCode: string,
  schedule?: CoopScheduleSelection,
  profile?: CoopProfile,
) {
  const data = readConfirmationData(cart);
  const deliveryInfo = schedule && data.deliveryInfo ? { ...data.deliveryInfo, ...schedule } : data.deliveryInfo;
  if (!deliveryInfo?.name || !deliveryInfo.phone || !deliveryInfo.scheduledDeliveryDate) {
    throw new CoopOrderError("Co.op chưa có đủ thông tin nhận hàng để đặt đơn.", {
      status: 400,
      code: "COOP_DELIVERY_INFO_NOT_READY",
      detail: { deliveryInfo },
    });
  }
  if (!deliveryInfo.scheduledDeliveryTimeSlotFrom || !deliveryInfo.scheduledDeliveryTimeSlotTo) {
    throw new CoopOrderError("Co.op chưa có ngày/khung giờ giao hợp lệ.", {
      status: 400,
      code: "COOP_DELIVERY_SLOT_NOT_READY",
      detail: { deliveryInfo },
    });
  }
  const selectedPayment = data.paymentMethods?.find((item) => item.isSelected);
  if (!selectedPayment?.methodCode) {
    throw new CoopOrderError("Vui lòng chọn phương thức thanh toán trước khi đặt hàng Co.op.", {
      status: 400,
      code: "COOP_PAYMENT_NOT_SELECTED",
      detail: { selectedPayment },
    });
  }
  if (selectedPayment.isDisabled) {
    throw new CoopOrderError("Phương thức thanh toán đang chọn chưa khả dụng cho giỏ Co.op này.", {
      status: 400,
      code: "COOP_PAYMENT_DISABLED",
      detail: { selectedPayment },
    });
  }
  const customerInfo = data.customerInfo ?? {};
  const customerId = customerInfo.id || profile?.userId || profile?.id || "";
  const profileId = customerInfo.profileId || profile?.id || customerId || undefined;
  return {
    forceCheckoutRemoveInvalidPromotions: false,
    deliveryInfo: {
      name: deliveryInfo.name,
      phone: deliveryInfo.phone,
      scheduledDeliveryDate: deliveryInfo.scheduledDeliveryDate,
      scheduledDeliveryTimeSlotFrom: deliveryInfo.scheduledDeliveryTimeSlotFrom,
      scheduledDeliveryTimeSlotTo: deliveryInfo.scheduledDeliveryTimeSlotTo,
    },
    customerInfo: {
      id: customerId,
      profileId,
      name: customerInfo.name ?? profile?.name ?? deliveryInfo.name ?? "",
      email: customerInfo.email ?? profile?.email ?? deliveryInfo.email,
      phone: customerInfo.phone ?? profile?.telephone ?? deliveryInfo.phone,
    },
    note: data.note || undefined,
    channelInfo: {
      terminalCode,
      ...COOP_CHANNEL_INFO,
    },
  };
}

function toNumber(value: unknown, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function genPaymentClientTransactionCode(orderCode: string | undefined, methodGroupCode: string | undefined) {
  const now = new Date();
  const input = [
    orderCode || "COOP",
    methodGroupCode || "CARD",
    now.getDate(),
    now.getHours(),
    now.getMinutes(),
    Math.floor(now.getSeconds() / 2),
    randomBytes(4).toString("hex"),
  ].join("|");
  return createHash("sha256").update(input).digest("hex").slice(0, 18);
}

function buildCoopPaymentPayload(input: {
  confirmationCart: unknown;
  checkoutResult: {
    code?: string;
    orderId?: string;
    id?: string;
    grandTotal?: unknown;
    totalPaid?: unknown;
    payments?: Array<{ amount?: unknown }>;
  };
  terminalCode: string;
}) {
  const data = readConfirmationData(input.confirmationCart);
  const selectedPayment = data.paymentMethods?.find((item) => item.isSelected);
  if (!selectedPayment?.methodCode || selectedPayment.methodCode === "COD") return null;
  if (selectedPayment.isDisabled) return null;

  const methodGroupCode = selectedPayment.methodGroupCode || "CARD";
  const groupKey = methodGroupCode.toLowerCase();
  const orderCode = input.checkoutResult.code || input.checkoutResult.orderId || input.checkoutResult.id;
  const orderId = input.checkoutResult.orderId || input.checkoutResult.id || input.checkoutResult.code;
  const grandTotal = toNumber(input.checkoutResult.grandTotal);
  const totalPaid = toNumber(input.checkoutResult.totalPaid);
  const previousPayments = (input.checkoutResult.payments ?? []).reduce((sum, item) => sum + toNumber(item.amount), 0);
  const amount = Math.max(0, grandTotal - totalPaid - previousPayments);
  if (!orderId || amount <= 0) return null;

  const methodPayment = {
    ...selectedPayment,
    amount,
    type: "URL_REDIRECT",
    clientTransactionCode: genPaymentClientTransactionCode(orderCode, methodGroupCode),
    bankCode: selectedPayment.methodCode === "VNPAY_GATEWAY_QR" ? "VNPAYQR" : undefined,
  };
  if (!methodPayment.bankCode) delete methodPayment.bankCode;

  return {
    terminalCode: selectedPayment.paymentTerminalCode || data.paymentTerminalCode || input.terminalCode,
    successUrl: `${COOP_ORIGIN}/order-result?code=${encodeURIComponent(orderCode || String(orderId))}`,
    cancelUrl: `${COOP_ORIGIN}/checkout`,
    isMobile: false,
    merchantCode: selectedPayment.merchantCode || data.paymentMerchantCode || "",
    orderId,
    payments: {
      [groupKey]: methodPayment,
    },
    orderAmount: amount,
  };
}

async function createCoopPaymentUrl(input: {
  accessToken: string;
  confirmationCart: unknown;
  checkoutResult: {
    code?: string;
    orderId?: string;
    id?: string;
    grandTotal?: unknown;
    totalPaid?: unknown;
    payments?: Array<{ amount?: unknown }>;
  };
  terminalCode: string;
}) {
  const payload = buildCoopPaymentPayload({
    confirmationCart: input.confirmationCart,
    checkoutResult: input.checkoutResult,
    terminalCode: input.terminalCode,
  });
  if (!payload) return { paymentUrl: undefined, raw: undefined };

  const res = await coopFetch(`${PAYMENT_BFF_API_URL}/api/v1/create-payment`, {
    method: "POST",
    headers: paymentHeaders(input.accessToken),
    body: JSON.stringify(payload),
    cache: "no-store",
  });
  const data = await parseJsonResponse<{ data?: unknown } | unknown>(res, {
    method: "POST",
    request: payload,
  });
  const raw = (data as { data?: unknown }).data ?? data;
  return {
    paymentUrl: findPaymentUrl(raw),
    raw,
  };
}

function findPaymentUrl(value: unknown): string | undefined {
  const seen = new Set<unknown>();
  const visit = (node: unknown): string | undefined => {
    if (!node || typeof node !== "object") {
      if (typeof node === "string" && /^https?:\/\/[^"\s]+/i.test(node)) {
        return /pay\.vnpay\.vn|momo|payment|checkout|transaction/i.test(node) ? node : undefined;
      }
      return undefined;
    }
    if (seen.has(node)) return undefined;
    seen.add(node);
    if (Array.isArray(node)) {
      for (const item of node) {
        const found = visit(item);
        if (found) return found;
      }
      return undefined;
    }
    const record = node as Record<string, unknown>;
    const preferredKeys = [
      "paymentUrl",
      "payment_url",
      "redirectUrl",
      "redirect_url",
      "checkoutUrl",
      "checkout_url",
      "url",
      "link",
    ];
    for (const key of preferredKeys) {
      const found = visit(record[key]);
      if (found) return found;
    }
    for (const item of Object.values(record)) {
      const found = visit(item);
      if (found) return found;
    }
    return undefined;
  };
  return visit(value);
}

export async function submitCoopCheckout(input: {
  accessToken: string;
  terminalCode: string;
  cartToken: string;
  deliveryDate?: string;
  slotFrom?: string;
  slotTo?: string;
}) {
  const profile = await getCoopProfile({ accessToken: input.accessToken }).catch(() => undefined);
  const confirmation = await getCoopConfirmationCart({
    accessToken: input.accessToken,
    terminalCode: input.terminalCode,
    cartToken: input.cartToken,
  });
  const schedule =
    input.deliveryDate && input.slotFrom && input.slotTo
      ? {
          scheduledDeliveryDate: `${input.deliveryDate}T00:00:00+07:00`,
          scheduledDeliveryTimeSlotFrom: input.slotFrom,
          scheduledDeliveryTimeSlotTo: input.slotTo,
        }
      : undefined;
  const order = ensurePreparedCoopOrder(confirmation.data, input.terminalCode, schedule, profile);
  const url = new URL(`${CART_API_URL}/checkout`);
  url.searchParams.set("terminal", input.terminalCode);
  const res = await coopFetch(url, {
    method: "POST",
    headers: cartHeaders(input.accessToken, confirmation.cartToken),
    body: JSON.stringify({ order }),
    cache: "no-store",
  });
  const data = await parseJsonResponse<{ data?: CoopCheckoutOrderResult } | CoopCheckoutOrderResult>(res, {
    method: "POST",
    request: { order },
  });
  const raw = (data as { data?: unknown }).data ?? data;
  const result = raw as {
    code?: string;
    orderId?: string;
    id?: string;
    createdAt?: string;
    grandTotal?: number | string;
    totalPaid?: number | string;
    payments?: Array<{ amount?: number | string }>;
    paymentMethodCode?: string;
  };
  const paymentCheck = parsePaymentCheck(confirmation.data);
  const selectedPaymentCode = paymentCheck.selectedMethodCode || result.paymentMethodCode;
  const checkoutPaymentUrl = findPaymentUrl(raw);
  const payment =
    checkoutPaymentUrl || selectedPaymentCode === "COD"
      ? { paymentUrl: checkoutPaymentUrl, payments: undefined, raw: undefined }
      : await createCoopPaymentUrl({
          accessToken: input.accessToken,
          confirmationCart: confirmation.data,
          checkoutResult: result,
          terminalCode: input.terminalCode,
        });
  return {
    cartToken: readCartToken(res, confirmation.cartToken),
    orderPayload: order,
    checkoutResult: {
      code: result.code,
      orderId: result.orderId ?? result.id,
      createdAt: result.createdAt,
      grandTotal: toNumber(result.grandTotal),
      totalPaid: toNumber(result.totalPaid),
      paymentMethodCode: selectedPaymentCode,
      paymentUrl: payment.paymentUrl,
      paymentRaw: payment.raw,
      raw,
    } satisfies CoopCheckoutOrderResult,
  };
}

export async function loginAndToken(input: { flow: CoopOauthFlow; phone: string; password: string }) {
  const login = await loginCoopPassword({
    challenge: input.flow.loginChallenge,
    phone: input.phone,
    password: input.password,
  });
  if (!login.redirect_to) {
    throw new CoopOrderError("Co.op login chưa trả redirect_to.", {
      status: 502,
      code: "COOP_REDIRECT_MISSING",
      detail: login,
    });
  }
  return exchangeCoopToken({
    redirectTo: login.redirect_to,
    state: input.flow.state,
    verifier: input.flow.verifier,
  });
}

export async function addItemToCoopAccountCart(input: {
  accessToken: string;
  terminalCode: string;
  item?: CoopCartItem;
  items?: CoopCartItem[];
  deliveryInfo?: CoopDeliveryInfo;
}) {
  const items = input.items?.length ? input.items : input.item ? [input.item] : [];
  if (!items.length) {
    throw new CoopOrderError("Co.op cần ít nhất 1 sản phẩm để tạo giỏ.", {
      status: 400,
      code: "COOP_CART_ITEMS_EMPTY",
    });
  }
  const created = await createCoopCart({
    accessToken: input.accessToken,
    terminalCode: input.terminalCode,
  });
  const cleared = await clearCoopCart({
    accessToken: input.accessToken,
    terminalCode: input.terminalCode,
    cartToken: created.cartToken,
  });
  const added = await addCoopCartItems({
    accessToken: input.accessToken,
    terminalCode: input.terminalCode,
    cartToken: cleared.cartToken || created.cartToken,
    items,
    clearExisting: true,
  });
  const cart = await getCoopCart({
    accessToken: input.accessToken,
    terminalCode: input.terminalCode,
    cartToken: added.cartToken,
  });
  let cartToken = cart.cartToken;
  const cartCleared = Boolean(cleared.cartToken || cleared.data);
  let delivery:
    | Awaited<ReturnType<typeof updateCoopDeliveryInfo>>
    | null = null;
  let deliveryInfo = input.deliveryInfo;
  let addressSync: CoopAddressSyncInfo | undefined;
  if (input.deliveryInfo?.fullAddress && input.deliveryInfo.name && input.deliveryInfo.phone) {
    const resolved = await resolveCoopDeliveryInfo({
      accessToken: input.accessToken,
      fallback: input.deliveryInfo,
    });
    deliveryInfo = resolved.deliveryInfo;
    addressSync = resolved.addressSync;
    delivery = await updateCoopDeliveryInfo({
      accessToken: input.accessToken,
      terminalCode: input.terminalCode,
      cartToken,
      deliveryInfo,
    });
    cartToken = delivery.cartToken;
  }
  const confirmation = await getCoopConfirmationCart({
    accessToken: input.accessToken,
    terminalCode: input.terminalCode,
    cartToken,
  }).catch(() => null);
  return {
    cartToken: confirmation?.cartToken ?? delivery?.cartToken ?? cart.cartToken,
    cart: cart.data,
    confirmationCart: confirmation?.data,
    deliveryCheck: confirmation?.deliveryCheck,
    paymentCheck: confirmation?.paymentCheck,
    deliveryInfo,
    addressSync,
    cartCleared,
  };
}
