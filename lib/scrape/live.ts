/**
 * Cào THẬT giá + tồn kho từ trang sản phẩm.
 * Cách lấy: đọc khối JSON-LD (schema.org/Product → offers.price + availability),
 * có fallback regex. Hoạt động cho các web render giá vào HTML/JSON-LD
 * (đã verify: BHX, ConCung, Coop). Web chặn bot (Aeon 403) hoặc chỉ render bằng
 * JS phía client sẽ trả về null → giữ nguyên giá cũ từ sheet.
 */

export interface LiveResult {
  ok: boolean;
  price: number | null;
  inStock: boolean | null;
  /** Sản phẩm còn tồn tại trên web nguồn không. false khi 404/410 hoặc trang báo gỡ. */
  exists: boolean;
  status: number;
  note?: string;
}

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

/** "47.700₫" / "675000" / "1.234.000 đ" → số VND. Dấu chấm = ngăn nghìn. */
export function parseVnd(raw: string | number | null | undefined): number | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  // bỏ ₫/đ/khoảng trắng, bỏ dấu chấm ngăn nghìn, phẩy → thập phân
  const cleaned = s
    .replace(/[₫đ\s]/gi, "")
    .replace(/\.(?=\d{3}\b)/g, "") // chấm trước đúng 3 số = ngăn nghìn
    .replace(",", ".")
    .replace(/[^\d.]/g, "");
  if (!cleaned) return null;
  const n = parseFloat(cleaned);
  if (!isFinite(n) || n <= 0) return null;
  return Math.round(n);
}

function availabilityToStock(v: unknown): boolean | null {
  if (typeof v !== "string") return null;
  const s = v.toLowerCase();
  if (s.includes("outofstock") || s.includes("soldout") || s.includes("discontinued")) return false;
  if (s.includes("instock") || s.includes("limited") || s.includes("preorder")) return true;
  return null;
}

/** Duyệt đệ quy mọi object JSON-LD để tìm giá + tồn kho đầu tiên. */
function walkLd(node: unknown, found: { price?: number; stock?: boolean | null }) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const it of node) walkLd(it, found);
    return;
  }
  const obj = node as Record<string, unknown>;
  if (found.price == null && obj.price != null) {
    const p = parseVnd(obj.price as string | number);
    if (p != null) found.price = p;
  }
  if (found.price == null && obj.lowPrice != null) {
    const p = parseVnd(obj.lowPrice as string | number);
    if (p != null) found.price = p;
  }
  if (found.stock == null && obj.availability != null) {
    found.stock = availabilityToStock(obj.availability);
  }
  for (const k of Object.keys(obj)) walkLd(obj[k], found);
}

function fromJsonLd(html: string): { price: number | null; stock: boolean | null } {
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  const found: { price?: number; stock?: boolean | null } = {};
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    try {
      walkLd(JSON.parse(m[1].trim()), found);
    } catch {
      /* khối ld+json hỏng → bỏ qua */
    }
    if (found.price != null) break;
  }
  return { price: found.price ?? null, stock: found.stock ?? null };
}

/** Fallback: bắt "price":"..." hoặc latestPrice trong HTML/JSON nhúng. */
function fromRegex(html: string): { price: number | null; stock: boolean | null } {
  const m =
    html.match(/"latestPrice"\s*:\s*"?([\d.,]+)"?/i) ||
    html.match(/"price"\s*:\s*"?([\d.,]+\s*[₫đ]?)"?/i);
  const price = m ? parseVnd(m[1]) : null;
  let stock: boolean | null = null;
  if (/outofstock|hết hàng|sold ?out/i.test(html)) stock = false;
  else if (/instock|còn hàng/i.test(html)) stock = true;
  return { price, stock };
}

/** Tải 1 trang sản phẩm và trích giá + tồn. */
export async function fetchLive(url: string, timeoutMs = 12000): Promise<LiveResult> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml" },
      cache: "no-store",
    });
    if (!res.ok) {
      // 404/410 = sản phẩm đã bị gỡ khỏi web nguồn → không còn tồn tại.
      const gone = res.status === 404 || res.status === 410;
      return {
        ok: false,
        price: null,
        inStock: gone ? false : null,
        exists: !gone,
        status: res.status,
        note: `HTTP ${res.status}`,
      };
    }
    const html = await res.text();
    let r = fromJsonLd(html);
    if (r.price == null) {
      const fb = fromRegex(html);
      r = { price: r.price ?? fb.price, stock: r.stock ?? fb.stock };
    }
    return {
      ok: r.price != null,
      price: r.price,
      inStock: r.stock,
      exists: true,
      status: res.status,
      note: r.price == null ? "không tìm thấy giá trong HTML (có thể render bằng JS)" : undefined,
    };
  } catch (err) {
    // Lỗi mạng/timeout → KHÔNG kết luận sản phẩm mất; giữ exists=true.
    return { ok: false, price: null, inStock: null, exists: true, status: 0, note: String(err) };
  } finally {
    clearTimeout(t);
  }
}
