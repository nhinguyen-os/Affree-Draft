import type { Chain } from "@/lib/types";

/**
 * Một dòng data cào, khớp đúng CATALOG_HEADERS của Apps Script:
 * product_id, product_name, brand, category, unit, chain, store_id,
 * price, in_stock, product_url, last_checked
 */
export interface ScrapedRow {
  product_id: string;
  product_name: string;
  brand: string;
  category: string;
  unit: string;
  chain: Chain;
  store_id: string;
  price: number;
  in_stock: number; // 1 | 0
  product_url: string;
  last_checked: string; // ISO
}

/** Mỗi chuỗi cài 1 hàm cào trả về danh sách dòng để upsert vào sheet. */
export type ChainScraper = () => Promise<ScrapedRow[]>;
