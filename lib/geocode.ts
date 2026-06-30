/**
 * Rút "khu vực" = phường/xã + quận/huyện từ address Nominatim. Dùng làm KHOÁ cho
 * "bán chạy khu vực" (mỗi phường có gu mua khác nhau). Trống nếu không xác định được.
 */
export function areaFromAddress(a: Record<string, string> | undefined): string {
  if (!a) return "";
  const ward = a.suburb || a.quarter || a.neighbourhood || a.village || a.hamlet || "";
  const district = a.city_district || a.district || a.county || "";
  return [ward, district].filter(Boolean).join(" · ");
}

// Phân định vùng cho Affree: cc=vn → suy ra tỉnh/thành (áp dụng MỌI vùng, không riêng HCM).
// HCM trả "TPHCM" (gọn, ổn định sau sáp nhập); tỉnh/thành khác lấy từ `state`, bỏ tiền tố
// "Thành phố"/"Tỉnh" (vd "Thành phố Hà Nội" → "Hà Nội", "Tỉnh Đồng Nai" → "Đồng Nai"). Ngoài VN → rỗng.
export function regionForAddress(a: Record<string, string> | undefined): string {
  if (!a) return "";
  const cc = (a.country_code ?? "").toLowerCase();
  if (cc !== "vn") return "";
  if (isHCMC(a)) return "TPHCM";
  const state = (a.state || a.region || a.city || "").trim();
  return state.replace(/^(thành phố|tỉnh)\s+/i, "").trim();
}

// Sau sáp nhập đơn vị hành chính TP.HCM (2025), dữ liệu OSM hay gán SAI cấp "city"
// cho phường (vd đường Phan Đình Phùng ở Phú Nhuận bị ghi city="Thủ Đức"). Toạ độ
// thì đúng — chỉ nhãn quận/thành phố con là sai. Với địa chỉ TP.HCM ta bỏ cấp "city"
// không tin cậy này, chỉ giữ phường (đã đủ định danh) + "TP.HCM".
export function isHCMC(a: Record<string, string> | undefined): boolean {
  if (!a) return false;
  const blob = `${a.state ?? ""} ${a.city ?? ""} ${a.region ?? ""} ${a["ISO3166-2-lvl4"] ?? ""}`
    .toLowerCase();
  return (
    blob.includes("hồ chí minh") ||
    blob.includes("ho chi minh") ||
    blob.includes("vn-sg")
  );
}

/** Nhãn địa chỉ gọn, đáng tin. VN/TP.HCM: số nhà·đường, phường, TP.HCM (bỏ cấp city sai). */
export function cleanLabel(a: Record<string, string> | undefined, fallback: string): string {
  if (!a) return fallback;
  const road = [a.house_number, a.road].filter(Boolean).join(" ");
  const ward = a.suburb || a.quarter || a.neighbourhood || a.village || a.hamlet || "";
  if ((a.country_code ?? "").toLowerCase() === "vn" && isHCMC(a)) {
    const parts = [road, ward, "TP.HCM"].filter(Boolean);
    return parts.length ? parts.join(", ") : fallback;
  }
  const parts = [
    road,
    ward,
    a.city_district || a.district || a.county,
    a.city || a.town,
  ].filter(Boolean);
  return parts.length ? parts.join(", ") : fallback;
}

export type GeoResult = { label: string; lat: number; lng: number; area?: string; cc?: string; region?: string; };

/** Geocode địa chỉ → toạ độ qua /api/geocode (Nominatim/OSM). Lỗi → null. */
export async function geocode(
  q: string
): Promise<{ lat: number; lng: number; label?: string } | null> {
  const query = q.trim();
  if (query.length < 4) return null;
  try {
    const res = await fetch(`/api/geocode?q=${encodeURIComponent(query)}`);
    const d = await res.json();

    // Nếu API trả về mảng kết quả (dùng cho forward geocode autocomplete), 
    // ta lấy phần tử đầu tiên khớp với chữ geocode
    if (Array.isArray(d)) {
      if (d.length === 0) return null;
      return { lat: d[0].lat, lng: d[0].lng, label: d[0].label };
    }

    if (d?.found) return { lat: d.lat, lng: d.lng, label: d.label };
    return null;
  } catch {
    return null;
  }
}

