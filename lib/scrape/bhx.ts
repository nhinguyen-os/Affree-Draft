import { snapshotChain } from "./snapshot";
import type { ScrapedRow } from "./types";

/**
 * Cào Bách Hóa Xanh.
 * TODO(real): gọi API nội bộ BHX (apibhx.tgdd.vn) theo tên/SKU sản phẩm,
 * map giá + còn/hết về ScrapedRow. Hiện dùng data thật từ real-snapshot.json.
 */
export async function scrapeBhx(): Promise<ScrapedRow[]> {
  return snapshotChain("bhx");
}
