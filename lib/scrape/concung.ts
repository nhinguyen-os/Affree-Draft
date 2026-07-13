import { snapshotChain } from "./snapshot";
import type { ScrapedRow } from "./types";

/**
 * Cào Con Cưng.
 * TODO(real): gọi API/website Con Cưng (concung.com) theo sản phẩm,
 * map giá + còn/hết về ScrapedRow. Hiện dùng data thật từ real-snapshot.json.
 */
export async function scrapeConcung(): Promise<ScrapedRow[]> {
  return snapshotChain("concung");
}
