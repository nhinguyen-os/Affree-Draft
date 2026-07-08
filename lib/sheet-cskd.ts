import type { Store } from "./types";
import CSKD_SEED from "./cskd-seed.json";
import CSKD_TAXONOMY from "./cskd-taxonomy.json";

// Dữ liệu CSKD đã bake tĩnh từ map server (snapshot đầy đủ 13 chain từ sheet,
// 2026-07-02). KHÔNG fetch Google Sheet nữa — sheet chỉ là nguồn nhập liệu,
// muốn cập nhật thì regenerate cskd-seed.json / cskd-taxonomy.json.

export async function fetchCskdStores(): Promise<Store[]> {
  return CSKD_SEED as Store[];
}

export interface CskdCategory {
  category: string;
  subs: string[];
}

export async function fetchLoaiCskdTaxonomy(): Promise<CskdCategory[]> {
  return CSKD_TAXONOMY as CskdCategory[];
}
