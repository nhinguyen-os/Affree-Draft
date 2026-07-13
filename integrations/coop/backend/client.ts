import type {
  CoopApiEnvelope,
  CoopLocationParams,
  CoopNormalizedProduct,
  CoopProductParams,
  CoopRawProduct,
  CoopSearchParams,
  CoopSearchResult,
  CoopTerminal,
} from "./types";
import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

const COOP_ORIGIN = "https://cooponline.vn";
const DISCOVERY_V1_URL = "https://discovery.tekoapis.com/api/v1";
const CONSUMER_BFF_URL = "https://consumer-bff.tekoapis.com";
const DEFAULT_TERMINAL_CODE = "570_sgc";
const COOP_PLATFORM_ID = "2295";
const DEFAULT_STORE_LIMIT = 50;
const COOP_LOG_PATH = path.join(process.cwd(), "logs", "coop-api.log");

function asInt(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function moneyToNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return 0;
  const n = Number(value.replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function firstText(values: Array<string | undefined>): string {
  return values.find((v) => v && v.trim())?.trim() ?? "";
}

function asNumber(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function buildProductUrl(info: CoopRawProduct["productInfo"]): string {
  const canonical = info?.canonical || (info?.slug && info?.sku ? `${info.slug}--s${info.sku}` : "");
  return canonical ? `${COOP_ORIGIN}/${canonical}` : COOP_ORIGIN;
}

function requestHeaders(): HeadersInit {
  return {
    accept: "application/json",
    "accept-language": "vi",
    origin: COOP_ORIGIN,
    referer: `${COOP_ORIGIN}/`,
    "user-agent": "Mozilla/5.0",
  };
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
  status: number;
  ok: boolean;
  code?: string | number;
  message?: string;
  body?: unknown;
}) {
  try {
    await mkdir(path.dirname(COOP_LOG_PATH), { recursive: true });
    await appendFile(
      COOP_LOG_PATH,
      `${JSON.stringify({
        ts: new Date().toISOString(),
        ...entry,
        body: redactCoopLog(entry.body),
      })}\n`,
      "utf8",
    );
  } catch {
    // Logging must never break Co.op API calls.
  }
}

export function normalizeCoopProduct(raw: CoopRawProduct): CoopNormalizedProduct | null {
  const info = raw.productInfo;
  const sku = firstText([info?.sku, info?.skuId]);
  if (!sku) return null;

  const priceInfo = raw.prices?.[0];
  const price = moneyToNumber(
    priceInfo?.latestPrice ?? priceInfo?.sellPrice ?? priceInfo?.terminalPrice ?? priceInfo?.supplierRetailPrice,
  );
  const category = info?.categories?.at(-1)?.name ?? info?.categories?.[0]?.name ?? "";
  const brand = info?.brand?.name ?? info?.brands?.at(-1)?.name ?? info?.brands?.[0]?.name ?? "";

  return {
    sku,
    name: info?.name ?? sku,
    brand,
    category,
    unit: info?.uomName ?? "",
    image: info?.imageUrl ?? "",
    price,
    inStock: raw.status?.sellable !== false && (raw.totalAvailable ?? 0) > 0,
    url: buildProductUrl(info),
    canonical: info?.canonical ?? "",
    sellerSku: info?.sellerSku,
    barcode: info?.barcode,
    totalAvailable: raw.totalAvailable,
    raw,
  };
}

async function parseCoopResponse<T>(res: Response): Promise<CoopApiEnvelope<T>> {
  const text = await res.text();
  let data: CoopApiEnvelope<T>;
  try {
    data = JSON.parse(text) as CoopApiEnvelope<T>;
  } catch {
      throw new Error(`Co.op API returned non-JSON HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  await logCoopResponse({
    url: res.url,
    status: res.status,
    ok: res.ok,
    code: data.code,
    message: data.message,
    body: data,
  });
  if (!res.ok || (data.code !== undefined && String(data.code) !== "0" && String(data.code) !== "200")) {
    throw new Error(`Co.op API error HTTP ${res.status}: ${data.message || JSON.stringify(data).slice(0, 200)}`);
  }
  return data;
}

function terminalCodeOf(terminal: CoopTerminal | undefined): string {
  const code = terminal?.code;
  return firstText([terminal?.terminalCode, typeof code === "string" ? code : undefined]);
}

function terminalNameOf(terminal: CoopTerminal | undefined): string {
  return firstText([terminal?.terminalName, terminal?.name, terminalCodeOf(terminal), "Co.op Online"]);
}

function terminalAddressOf(terminal: CoopTerminal | undefined): string {
  return firstText([terminal?.fullAddress, terminal?.address, terminalCodeOf(terminal), "Co.op Online"]);
}

function terminalLatLng(terminal: CoopTerminal | undefined): { lat?: number; lng?: number } {
  const lat = asNumber(terminal?.lat ?? terminal?.latitude);
  const lng = asNumber(terminal?.lng ?? terminal?.long ?? terminal?.longitude);
  return { lat, lng };
}

function terminalDistanceKm(terminal: CoopTerminal): number {
  const distance = asNumber(terminal.distanceKm ?? terminal.distance);
  return distance ?? Number.POSITIVE_INFINITY;
}

function terminalToStore(terminal: CoopTerminal | undefined, terminalCode: string) {
  const { lat, lng } = terminalLatLng(terminal);
  const distanceKm = terminal ? asNumber(terminal.distanceKm ?? terminal.distance) : undefined;
  return {
    id: `coop-${terminalCode}`,
    chain: "coop",
    name: terminalNameOf(terminal),
    address: terminalAddressOf(terminal),
    lat,
    lng,
    distanceKm,
    website: COOP_ORIGIN,
    online: lat == null || lng == null,
  };
}

export async function getCoopTerminalsByAddress(location: CoopLocationParams): Promise<CoopTerminal[]> {
  const url = new URL(`${CONSUMER_BFF_URL}/api/v1/terminals-by-address`);
  const hasLatLng = Number.isFinite(location.lat) && Number.isFinite(location.lng);
  url.searchParams.set("fullAddress", location.address?.trim() || (hasLatLng ? `${location.lat},${location.lng}` : ""));
  if (hasLatLng) {
    url.searchParams.set("lat", String(location.lat));
    url.searchParams.set("long", String(location.lng));
  }
  url.searchParams.set("platformId", COOP_PLATFORM_ID);

  const res = await fetch(url, {
    headers: requestHeaders(),
    cache: "no-store",
  });
  const raw = await parseCoopResponse<{ terminals?: CoopTerminal[] }>(res);
  return raw.result?.terminals ?? raw.data?.terminals ?? [];
}

export async function resolveCoopTerminal(params: Pick<CoopSearchParams, "terminalCode" | "location">) {
  if (params.terminalCode?.trim()) return { terminalCode: params.terminalCode.trim() };
  if (!params.location) return { terminalCode: DEFAULT_TERMINAL_CODE };

  const terminals = await getCoopTerminalsByAddress(params.location);
  const terminal = terminals
    .filter((item) => terminalCodeOf(item))
    .sort((a, b) => terminalDistanceKm(a) - terminalDistanceKm(b))[0];

  return {
    terminalCode: terminalCodeOf(terminal) || DEFAULT_TERMINAL_CODE,
    terminal,
    terminals,
  };
}

export async function searchCoopProducts(params: CoopSearchParams): Promise<CoopSearchResult> {
  const query = params.query.trim();
  const { terminalCode, terminal, terminals } = await resolveCoopTerminal(params);
  const page = asInt(params.page, 1);
  const pageSize = Math.min(asInt(params.pageSize, 20), 80);
  const storeLimit = Math.min(asInt(params.storeLimit, DEFAULT_STORE_LIMIT), 50);

  const payload = {
    terminalCode,
    query,
    pagination: { pageNumber: page, itemsPerPage: pageSize },
    filter: {},
    sorting: {},
    returnFilterable: [],
    block: {},
    slug: "",
    fieldMask: [],
  };

  const res = await fetch(`${DISCOVERY_V1_URL}/search`, {
    method: "POST",
    headers: { ...requestHeaders(), "content-type": "application/json" },
    body: JSON.stringify(payload),
    cache: "no-store",
  });
  const raw = await parseCoopResponse<{ products?: CoopRawProduct[]; total?: number }>(res);
  const rawProducts = raw.result?.products ?? [];
  const products = rawProducts.map(normalizeCoopProduct).filter((p): p is CoopNormalizedProduct => Boolean(p));
  const skus = products.map((p) => p.sku);
  const terminalEntries = (terminals?.length ? terminals : terminal ? [terminal] : []).slice(0, storeLimit);
  const terminalProducts = await Promise.all(
    terminalEntries
      .map((entry) => ({ terminal: entry, terminalCode: terminalCodeOf(entry) }))
      .filter((entry): entry is { terminal: CoopTerminal; terminalCode: string } => Boolean(entry.terminalCode))
      .map(async (entry) => ({
        terminalCode: entry.terminalCode,
        terminal: entry.terminal,
        products:
          entry.terminalCode === terminalCode
            ? products
            : await getCoopProductsBySkus({ skus, terminalCode: entry.terminalCode }),
      })),
  );

  return {
    source: "cooponline",
    endpoint: `${DISCOVERY_V1_URL}/search`,
    terminalCode,
    terminal,
    terminals,
    terminalProducts:
      terminalProducts.length > 0 ? terminalProducts : [{ terminalCode, terminal, products }],
    query,
    page,
    pageSize,
    total: Number(raw.result?.total ?? rawProducts.length),
    products,
    raw,
  };
}

export async function getCoopProductsBySkus(params: { skus: string[]; terminalCode: string }): Promise<CoopNormalizedProduct[]> {
  const skus = params.skus.map((sku) => sku.trim()).filter(Boolean);
  if (!skus.length) return [];
  const terminalCode = params.terminalCode.trim() || DEFAULT_TERMINAL_CODE;
  const url = new URL(`${DISCOVERY_V1_URL}/products`);
  url.searchParams.set("skus", skus.join(","));
  url.searchParams.set("terminalCode", terminalCode);

  const res = await fetch(url, {
    headers: requestHeaders(),
    cache: "no-store",
  });
  const raw = await parseCoopResponse<{ products?: CoopRawProduct[] }>(res);
  return (raw.result?.products ?? [])
    .map(normalizeCoopProduct)
    .filter((p): p is CoopNormalizedProduct => Boolean(p));
}

export async function getCoopProduct(params: CoopProductParams): Promise<CoopNormalizedProduct | null> {
  const sku = params.sku.trim();
  const terminalCode = params.terminalCode?.trim() || DEFAULT_TERMINAL_CODE;
  const url = new URL(`${DISCOVERY_V1_URL}/products`);
  url.searchParams.set("skus", sku);
  url.searchParams.set("terminalCode", terminalCode);

  const res = await fetch(url, {
    headers: requestHeaders(),
    cache: "no-store",
  });
  const raw = await parseCoopResponse<{ products?: CoopRawProduct[] }>(res);
  const product = raw.result?.products?.[0];
  return product ? normalizeCoopProduct(product) : null;
}

export function coopSearchToCatalog(result: CoopSearchResult) {
  const checkedAt = new Date().toISOString();
  const store = terminalToStore(result.terminal, result.terminalCode);
  const productSkus = new Set(result.products.map((p) => p.sku));
  const terminalProducts = result.terminalProducts?.length
    ? result.terminalProducts
    : [{ terminalCode: result.terminalCode, terminal: result.terminal, products: result.products }];
  const offers = terminalProducts.flatMap((entry) => {
    const entryStore = terminalToStore(entry.terminal, entry.terminalCode);
    return entry.products
      .filter((p) => productSkus.has(p.sku))
      .map((p) => ({
        productId: p.sku,
        storeId: entryStore.id,
        price: p.price,
        inStock: p.inStock,
        productUrl: p.url,
        lastChecked: checkedAt,
        store: entryStore,
      }));
  });

  return {
    source: result.source,
    terminalCode: result.terminalCode,
    terminal: result.terminal,
    terminals: result.terminals,
    store,
    query: result.query,
    products: result.products.map((p) => ({
      id: p.sku,
      name: p.name,
      brand: p.brand,
      category: p.category,
      unit: p.unit,
      image: p.image || undefined,
    })),
    offers,
  };
}
