import type { CskdCategory } from "./sheet-cskd";

// Fallback taxonomy — đồng bộ với sheet-cskd.ts
const FALLBACK_TAXONOMY: CskdCategory[] = [
  { category: "ĂN UỐNG", subs: ["Ăn vặt", "Beer Club", "Buffet", "Fast Food", "Giải khát", "Kem", "Khác", "Lẩu", "Món ăn gia đình", "Món chay", "Món Hàn", "Món Hoa", "Món Nhật", "Món Tây", "Món Thái", "Món Việt", "Nhạc sống / Live music", "Nhà hàng", "Nướng", "Phòng trà", "Pub", "Quán ăn bình dân", "Quán nhậu", "Tiệm bánh", "Trà Sữa"] },
  { category: "THỜI TRANG", subs: ["Áo cưới - Studio", "Áo dài", "Cho thuê trang phục", "Cosplay", "Đồ bơi", "Đồ cũ", "Đồng hồ", "Giầy dép", "Mẹ và bé", "Mỹ phẩm", "Nam", "Nón, Mũ bảo hiểm", "Nội Y", "Nữ", "Nước hoa", "Phụ kiện", "Quần áo", "Thể thao", "Thêu tay", "Trang sức", "Trẻ em", "Túi xách"] },
  { category: "LÀM ĐẸP - THƯ GIÃN", subs: ["Cắt Tóc", "Dụng cụ làm đẹp", "Massage - Đấm bóp", "Nam", "Nữ", "Phun xăm thẩm mỹ mày, môi, mí", "Salon tóc, gội đầu", "Spa", "Tắm hơi Hàn Quốc", "Tiệm Nails", "Tiệm nối mi", "Tiệm Xăm", "Trang điểm"] },
  { category: "CỬA HÀNG - SIÊU THỊ", subs: ["Bán nguyên vật liệu - dụng cụ làm bánh", "Chợ", "Cửa hàng bia - nước giải khát", "Cửa hàng đồ gia dụng", "Cửa hàng hoa quả - rau củ", "Cửa hàng lương thực", "Cửa hàng nhạc cụ", "Cửa hàng thực phẩm", "Cửa hàng tiện lợi 24h", "Đại lí gas", "Đại lý bia", "Đại lý gạo", "Đại lý gas", "Đại lý nước", "Đại lý nước đá", "Đại lý sim", "Đồ chơi trẻ em", "Đồ điện tử cũ", "Hàng Xuất Khẩu", "Khác", "Nhà may", "Nhập khẩu", "Phụ kiện may", "Quà lưu niệm", "Shop dụng cụ tình yêu", "Shop hoa", "Shop Rượu", "Shop thú cưng", "Siêu thị", "Siêu thị điện máy", "Tạp hóa", "Tẩu điện tử - Tinh dầu", "Thủy hải sản - thịt tươi sống", "Tiệm vải", "Trung tâm thương mại", "VinMart"] },
  { category: "VĂN HÓA - GIẢI TRÍ", subs: ["Bảo tàng", "Bar", "Công viên", "Di tích lịch sử", "Game", "Karaoke", "Khác", "Nhà hát", "Nhà triễn lãm", "Nhà văn hóa", "Phim trường", "Phòng thu âm", "Rạp chiếu phim", "Sạp báo", "Sân khấu kịch", "Sân vận động", "Tiệm Đồ cổ", "Trung tâm hội nghị - Tiệc cưới", "Vui chơi Giải trí"] },
  { category: "THỂ DỤC THỂ THAO", subs: ["Dụng cụ thể thao", "Khác", "Nhà thi đấu", "Phòng tập", "Sân vận động", "Trung tâm Thể dục Thể Thao"] },
];

/** Chuẩn hóa chuỗi để so sánh không phân biệt hoa/thường và khoảng trắng dư. */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // bỏ dấu
    .replace(/\s+/g, " ")
    .trim();
}

export interface BusinessTypeEntry {
  /** ID số nguyên của sub-type. */
  id: number;
  name: string;
  /** ID của category cha (null = là danh mục gốc). */
  parent_id: number | null;
}

export interface BusinessTypeTaxonomy {
  /** Danh mục + sub — đã filter theo FALLBACK_TAXONOMY. */
  taxonomy: CskdCategory[];
  /**
   * Map từ sub-type ID → label chuẩn "CATEGORY > Sub" để điền vào store.loaiCskd.
   * Key = number (type_id); Value = chuỗi kiểu "ĂN UỐNG > Ăn vặt".
   */
  typeIdToLabel: Map<number, string>;
  /** Tất cả sub-type IDs của các category đã lọc (để truyền làm businesstypeid). */
  allSubTypeIds: number[];
}

// Module-level cache — tái sử dụng giữa các request trong cùng cold-start (Next.js ISR/Edge).
let _cache: BusinessTypeTaxonomy | null = null;
let _cacheAt = 0;
const CACHE_TTL_MS = 3600 * 1000; // 1 giờ

/**
 * Lấy taxonomy Loại CSKD từ API `/business/store/gettypes`.
 * - Chỉ giữ các danh mục con có parent khớp với FALLBACK_TAXONOMY (normalize không phân biệt hoa/thường).
 * - Cache trong module 1 giờ; fallback về FALLBACK_TAXONOMY nếu API lỗi.
 */
export async function fetchBusinessTypeTaxonomy(): Promise<BusinessTypeTaxonomy> {
  const now = Date.now();
  if (_cache && now - _cacheAt < CACHE_TTL_MS) return _cache;

  const baseUrl = (
    process.env.NEXT_GEO_API_BASE_URL || "https://api-staging.timdaythay.com/api/full"
  ).replace(/\/$/, "");
  const apiKey = process.env.NEXT_GEO_API_KEY || "";

  const headers: Record<string, string> = { "Accept-Language": "vi" };
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

  let entries: BusinessTypeEntry[] = [];
  try {
    const res = await fetch(`${baseUrl}/business/store/gettypes`, {
      headers,
      next: { revalidate: 3600 },
    });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data?.result)) {
        entries = data.result as BusinessTypeEntry[];
      }
    }
  } catch {
    // Fallback bên dưới
  }

  if (entries.length === 0) {
    // Trả về FALLBACK_TAXONOMY với typeIdToLabel rỗng (không có ID thực)
    return buildFallback();
  }

  // Tách danh mục gốc (parent_id === null) và danh mục con
  const parents = entries.filter((e) => e.parent_id === null);
  const children = entries.filter((e) => e.parent_id !== null);

  // Map normalize(tên API) → danh mục trong FALLBACK_TAXONOMY
  // Ví dụ "ăn uống" → "ĂN UỐNG"
  const normalizedFallbackCatMap = new Map<string, string>();
  for (const fc of FALLBACK_TAXONOMY) {
    normalizedFallbackCatMap.set(normalize(fc.category), fc.category);
  }

  // Tìm parent IDs khớp với FALLBACK_TAXONOMY
  const matchedParents = new Map<number, string>(); // parent_id → canonical category name
  for (const p of parents) {
    const normName = normalize(p.name);
    const canonCat = normalizedFallbackCatMap.get(normName);
    if (canonCat) {
      matchedParents.set(p.id, canonCat);
    }
  }

  // Xây dựng taxonomy từ children của matched parents
  // Chỉ giữ sub-types có tên khớp với sub trong FALLBACK_TAXONOMY (normalize)
  const taxonomyMap = new Map<string, { subs: string[]; subIds: Map<string, number> }>();
  const typeIdToLabel = new Map<number, string>();
  const allSubTypeIds: number[] = [];

  for (const [canonCat, fc] of FALLBACK_TAXONOMY.map((f) => [f.category, f] as [string, CskdCategory])) {
    if (!taxonomyMap.has(canonCat)) {
      taxonomyMap.set(canonCat, { subs: [], subIds: new Map() });
    }
  }

  // Map normalize(sub name trong fallback) → canonical sub name, theo từng category
  const fallbackSubsByCategory = new Map<string, Map<string, string>>();
  for (const fc of FALLBACK_TAXONOMY) {
    const normSubMap = new Map<string, string>();
    for (const sub of fc.subs) {
      normSubMap.set(normalize(sub), sub);
    }
    fallbackSubsByCategory.set(fc.category, normSubMap);
  }

  for (const child of children) {
    const canonCat = matchedParents.get(child.parent_id!);
    if (!canonCat) continue;

    const normSubMap = fallbackSubsByCategory.get(canonCat);
    if (!normSubMap) continue;

    const normChildName = normalize(child.name);
    const canonSub = normSubMap.get(normChildName);
    if (!canonSub) continue; // sub không có trong FALLBACK → bỏ qua

    const label = `${canonCat} > ${canonSub}`;
    typeIdToLabel.set(child.id, label);
    allSubTypeIds.push(child.id);

    const entry = taxonomyMap.get(canonCat)!;
    if (!entry.subs.includes(canonSub)) {
      entry.subs.push(canonSub);
    }
  }

  // Xây dựng taxonomy cuối — chỉ giữ category có ít nhất 1 sub
  const taxonomy: CskdCategory[] = [];
  for (const fc of FALLBACK_TAXONOMY) {
    const entry = taxonomyMap.get(fc.category);
    if (!entry || entry.subs.length === 0) continue;
    taxonomy.push({ category: fc.category, subs: entry.subs });
  }

  // Nếu taxonomy rỗng (API không trả về kết quả hợp lệ) → dùng fallback
  if (taxonomy.length === 0) return buildFallback();

  const result: BusinessTypeTaxonomy = { taxonomy, typeIdToLabel, allSubTypeIds };
  _cache = result;
  _cacheAt = now;
  return result;
}

function buildFallback(): BusinessTypeTaxonomy {
  return {
    taxonomy: FALLBACK_TAXONOMY,
    typeIdToLabel: new Map(),
    allSubTypeIds: [],
  };
}

/**
 * Chỉ lấy taxonomy (CskdCategory[]) — shortcut cho route /api/loai-cskd.
 */
export async function fetchLoaiCskdFromApi(): Promise<CskdCategory[]> {
  const { taxonomy } = await fetchBusinessTypeTaxonomy();
  return taxonomy;
}
