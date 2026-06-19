import { snapshotChain } from "./snapshot";
import type { ScrapedRow } from "./types";

/**
 * Cào AEON.
 * TODO(real): gọi API/website AEON (aeoneshop.com) theo sản phẩm,
 * map giá + còn/hết về ScrapedRow. Hiện dùng data thật từ real-snapshot.json.
 */
export async function scrapeAeon(): Promise<ScrapedRow[]> {
  return snapshotChain("aeon");
}
