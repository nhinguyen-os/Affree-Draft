import type { CartItem, RankedOffer } from "@/lib/types";
import type { CobrowseStore, CobrowseField, CobrowseSuggestion } from "@/components/CobrowseSession";
import { SOURCE_META, chainLabel, sourceLabelFromStoreId } from "@/lib/stores";

/**
 * Chuyển offer/giỏ hàng của app → dữ liệu cho màn đặt đơn co-browse (CobrowseSession).
 * Dùng chung cho "Mua ngay" (một offer) và "Giỏ hàng" (nhiều cửa hàng).
 */

/** Khoá chuỗi thân thiện: bỏ đuôi "_00019", lowercase (vd "COOP_00019" → "coop"). */
function chainKey(raw: string): string {
  const lc = String(raw || "").toLowerCase();
  if (SOURCE_META[lc]) return lc;
  const alpha = lc.match(/^[a-z]+/)?.[0];
  return alpha && SOURCE_META[alpha] ? alpha : lc;
}

/** Dò SOURCE_META qua chain → id → name (nhiều offer có chain rỗng, id kiểu "COOP_00019"). */
function resolveMeta(offer: RankedOffer): (typeof SOURCE_META)[string] | null {
  for (const cand of [offer.store.chain, offer.store.id, offer.store.name]) {
    const k = chainKey(cand);
    if (SOURCE_META[k]) return SOURCE_META[k];
  }
  return null;
}

const CODE_NAME = /^[A-Z]+[_-]?\d+$/; // "COOP_00019", "BHX-123"…

/** Skin nhận diện thật của chuỗi cho trang mô phỏng (bhx/coop có mock riêng). */
function storeSkin(offer: RankedOffer): "bhx" | "coop" | undefined {
  for (const cand of [offer.store.chain, offer.store.id, offer.store.name]) {
    const k = chainKey(cand);
    if (k === "bhx") return "bhx";
    if (k === "coop" || k === "cop") return "coop";
  }
  return undefined;
}

function storeColor(offer: RankedOffer): string {
  return resolveMeta(offer)?.color || "#0E7C6B";
}

/** Tên nguồn/chuỗi thân thiện cho tiêu đề cửa hàng. */
function sourceName(offer: RankedOffer): string {
  // Cách app đặt tên nguồn từ store.id (chainBaseKey → chainLabel) — chuẩn & nhất quán nhất.
  const byId = sourceLabelFromStoreId(offer.store.id);
  if (byId) return byId;
  const meta = resolveMeta(offer);
  if (meta) return meta.label;
  const byLabel = chainLabel(offer.store.chain);
  if (byLabel && byLabel !== offer.store.chain) return byLabel;
  const n = offer.store.name;
  return n && !CODE_NAME.test(n) ? n : String(offer.store.chain || "Cửa hàng");
}

/** Chi nhánh (dòng phụ): tên cửa hàng nếu thân thiện, không thì địa chỉ ngắn. */
function branchName(offer: RankedOffer, name: string): string | undefined {
  const n = offer.store.name;
  if (n && n !== name && !CODE_NAME.test(n)) return n;
  const addr = offer.store.address?.trim();
  if (addr) return addr.length > 48 ? addr.slice(0, 46) + "…" : addr;
  return undefined;
}

function storeDomain(offer: RankedOffer): string {
  const home = SOURCE_META[offer.store.chain]?.home || offer.store.website || "";
  try {
    return `${new URL(home).host}/checkout`;
  } catch {
    return "cua-hang.vn/checkout";
  }
}

/** Trường form giao hàng chung; nguồn online bỏ địa chỉ vẫn ok (giữ để nhất quán). */
function deliveryFields(slot?: string): CobrowseField[] {
  return [
    { label: "Tên người nhận", src: "name" },
    { label: "Số điện thoại", src: "phone", sensitive: true },
    { label: "Địa chỉ giao hàng", src: "address", sensitive: true },
    { label: "Khung giờ giao", fixed: slot || "Trong hôm nay (2–4 giờ)" },
  ];
}

/** Một offer (Mua ngay) → một CobrowseStore. */
export function storeOrderFromOffer(offer: RankedOffer, qty: number, slot?: string, suggestions?: CobrowseSuggestion[]): CobrowseStore {
  const q = Math.max(1, qty);
  const line = offer.price * q;
  const name = sourceName(offer);
  return {
    key: offer.store.id,
    name,
    branch: branchName(offer, name),
    color: storeColor(offer),
    skin: storeSkin(offer),
    domain: storeDomain(offer),
    currency: offer.store.currency,
    suggestions,
    products: [{ image: offer.product.image, name: offer.product.name, qty: q, unitPrice: offer.price, lineTotal: line }],
    total: line,
    fields: deliveryFields(slot),
  };
}

/** Giỏ hàng → CobrowseStore[] (gộp theo cửa hàng). */
export function storeOrdersFromCart(
  items: CartItem[],
  slotsByStoreId?: Record<string, string>,
  suggestionsByStoreId?: Record<string, CobrowseSuggestion[]>,
): CobrowseStore[] {
  const byStore = new Map<string, CartItem[]>();
  for (const it of items) {
    const id = it.offer.store.id;
    if (!byStore.has(id)) byStore.set(id, []);
    byStore.get(id)!.push(it);
  }
  return Array.from(byStore.entries()).map(([storeId, group]) => {
    const first = group[0].offer;
    const total = group.reduce((s, it) => s + it.offer.price * it.qty, 0);
    const name = sourceName(first);
    return {
      key: storeId,
      name,
      branch: branchName(first, name),
      color: storeColor(first),
      skin: storeSkin(first),
      domain: storeDomain(first),
      currency: first.store.currency,
      suggestions: suggestionsByStoreId?.[storeId],
      products: group.map((it) => ({
        image: it.product.image,
        name: it.product.name,
        qty: it.qty,
        unitPrice: it.offer.price,
        lineTotal: it.offer.price * it.qty,
      })),
      total,
      fields: deliveryFields(slotsByStoreId?.[storeId]),
    };
  });
}
