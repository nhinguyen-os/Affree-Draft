import { snapshotChain } from "./snapshot";
import type { ScrapedRow } from "./types";

/**
 * Cào Co.opmart.
 * TODO(real): gọi API/website Co.op (cooponline.vn) theo sản phẩm,
 * map giá + còn/hết về ScrapedRow. Hiện dùng data thật từ real-snapshot.json.
 */
export async function scrapeCoop(): Promise<ScrapedRow[]> {
  return snapshotChain("coop");
}
