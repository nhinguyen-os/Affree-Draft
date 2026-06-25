/**
 * Slug helpers cho URL "đẹp": chuyển tên brand / ngành hàng / sản phẩm thành đoạn
 * URL không dấu, ngược lại tìm tên gốc từ catalog theo slug.
 */
import type { Catalog, Product } from "./types";

/** "Bông tai Vàng trắng 41,6%" → "bongtaivangtrang416". Trống → "". */
export function slugify(s: string): string {
  return (s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

/** Tìm sản phẩm bằng id chính xác trước, fallback theo slug(name). */
export function findProductBySlug(catalog: Catalog | null, slug: string): Product | null {
  if (!catalog || !slug) return null;
  const direct = catalog.products.find((p) => p.id === slug);
  if (direct) return direct;
  const s = slugify(slug);
  return catalog.products.find((p) => slugify(p.id) === s || slugify(p.name) === s) ?? null;
}

/** Tìm brand gốc (có dấu) từ slug. So với tất cả `product.brand` duy nhất. */
export function findBrandBySlug(catalog: Catalog | null, slug: string): string | null {
  if (!catalog || !slug) return null;
  const s = slugify(slug);
  for (const p of catalog.products) {
    if (p.brand && slugify(p.brand) === s) return p.brand;
  }
  return null;
}

/** Tìm category gốc (có dấu) từ slug. So với tất cả `product.category` duy nhất. */
export function findCategoryBySlug(catalog: Catalog | null, slug: string): string | null {
  if (!catalog || !slug) return null;
  const s = slugify(slug);
  for (const p of catalog.products) {
    if (p.category && slugify(p.category) === s) return p.category;
  }
  return null;
}

/** Tìm "tệp" (nhóm/group) gốc từ slug. So với cả `groups` (top tiles), `danhMucGroups`
 * (bottom sections), `product.group` (primary), và `product.groups[]` (multi-group override). */
export function findGroupBySlug(catalog: Catalog | null, slug: string): string | null {
  if (!catalog || !slug) return null;
  const s = slugify(slug);
  if (catalog.groups) {
    for (const g of catalog.groups) {
      if (slugify(g.label) === s) return g.label;
    }
  }
  if (catalog.danhMucGroups) {
    for (const g of catalog.danhMucGroups) {
      if (slugify(g.label) === s) return g.label;
    }
  }
  for (const p of catalog.products) {
    if (p.group && slugify(p.group) === s) return p.group;
    if (p.groups) {
      for (const g of p.groups) {
        if (slugify(g) === s) return g;
      }
    }
  }
  return null;
}
