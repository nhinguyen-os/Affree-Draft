import type { Store } from "./types";
import { fetchBusinessTypeTaxonomy } from "./api-business-types";
import { fetchNearbyStores } from "./api-stores";

// Location mặc định HCM — dùng khi không có user location.
const DEFAULT_LAT = "10.798005808";
const DEFAULT_LNG = "106.673447868";

/**
 * Lấy danh sách CSKD stores từ API `/place/aroundsearch/json` với tất cả
 * businesstypeid thuộc các danh mục CSKD đã cấu hình (ĂN UỐNG, THỜI TRANG, ...).
 *
 * Thay thế `fetchCskdStores()` từ Google Sheets — stores trả về có `loaiCskd`
 * được điền từ `type_id` của API.
 */
export async function fetchCskdStoresFromApi(options?: {
  lat?: string;
  lng?: string;
  radius?: string;
  limit?: string;
}): Promise<Store[]> {
  const { lat = DEFAULT_LAT, lng = DEFAULT_LNG, radius = "1000", limit = "5000" } = options ?? {};

  // Lấy taxonomy (đã cache trong module) — bao gồm allSubTypeIds và typeIdToLabel
  const { allSubTypeIds, typeIdToLabel } = await fetchBusinessTypeTaxonomy();

  // Nếu không có sub-type IDs từ API (fallback mode), trả về mảng rỗng —
  // caller (route /api/cskd-stores) sẽ giữ nguyên behavior cũ hoặc trả {} stores rỗng.
  if (allSubTypeIds.length === 0) return [];

  const businesstypeid = allSubTypeIds.join(",");

  const result = await fetchNearbyStores({
    lat,
    lng,
    radius,
    limit,
    businesstypeid,
    typeIdToLabel,
  });

  return result.stores;
}
