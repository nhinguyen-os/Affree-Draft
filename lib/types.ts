/**
 * Mã nguồn bán hàng. 4 chuỗi có cửa hàng vật lý trên bản đồ (bhx/concung/coop/aeon)
 * + các nguồn online khác lấy từ sheet (shopee/grab/pnj/lotte/…). Để string cho mở.
 */
export type Chain = string;

export interface Store {
  id: string;
  chain: Chain;
  name: string;
  address: string;
  /** Toạ độ cửa hàng vật lý. Nguồn online (online=true) không có toạ độ. */
  lat?: number;
  lng?: number;
  website: string;
  /** true = nguồn bán online, không có vị trí trên bản đồ. */
  online?: boolean;
  /** Mã tiền tệ của cửa hàng (vd "USD"). Trống → mặc định "VND". Giá sản phẩm hiển thị theo tiền tệ này. */
  currency?: string;
}

export interface Product {
  id: string;
  name: string;
  brand: string;
  category: string;
  /** "Tệp" / nhóm danh mục hiển thị (cột danh_muc trong sheet). Trống → tự suy luận. */
  group?: string;
  unit: string;
  image?: string;
}

/** Một "offer" = một sản phẩm được bán tại một cửa hàng với giá + tồn kho. */
export interface Offer {
  productId: string;
  storeId: string;
  price: number;
  inStock: boolean;
  productUrl: string;
  lastChecked: string; // ISO
}

/**
 * Một "tệp" (nhóm danh mục) khai báo trong tab "tệp" của Google Sheet.
 * - link rỗng → ô LỌC sản phẩm theo tệp này.
 * - link là URL (http…) → ô mở trang dịch vụ bên ngoài.
 * - link = "soon"/"sắp" → ô "sắp ra mắt".
 */
export interface ProductGroup {
  label: string;
  emoji?: string;
  link?: string;
  note?: string;
  /** Tên hồ sơ "ưu tiên hiển thị" áp cho tệp này (cột "ưu tiên" trong tab "tệp"). Trống → không ưu tiên. */
  priority?: string;
}

/**
 * Một hồ sơ "ưu tiên hiển thị" khai báo trong tab "ưu tiên hiển thị" của Google Sheet.
 * `chains` = danh sách mã nguồn (store_id, vd "THXL","TDAT") theo THỨ TỰ ưu tiên giảm dần.
 */
export interface PriorityProfile {
  name: string;
  chains: string[];
  note?: string;
}

export interface Catalog {
  products: Product[];
  offers: Offer[];
  /** Cấu hình tệp/ô dịch vụ từ tab "tệp" (nếu có). Trống → web tự dựng từ sản phẩm. */
  groups?: ProductGroup[];
  /** Hồ sơ ưu tiên hiển thị theo chuỗi (tab "ưu tiên hiển thị"). Trống → dùng mặc định trong code. */
  priorities?: PriorityProfile[];
}

export interface PurchaseRecord {
  id: string;
  productId: string;
  productName: string;
  storeId: string;
  storeName: string;
  chain: Chain;
  qty: number;
  unitPrice: number;
  total: number;
  boughtAt: string; // ISO
  buyerLat?: number; // vị trí người mua lúc ghi nhận (nếu đã định vị)
  buyerLng?: number;
  buyerAddr?: string; // địa chỉ reverse-geocode của người mua
  buyerName?: string; // họ tên người đặt mua (form "Vào mua")
  buyerPhone?: string; // SĐT/Zalo người đặt mua
  buyerNote?: string; // ghi chú đơn đặt mua
}

/** Đăng ký nhận báo khi sản phẩm giảm giá (thu lead: SĐT/Zalo + món quan tâm). */
export interface PriceAlert {
  id: string;
  phone: string; // SĐT hoặc Zalo người dùng để lại
  productId: string;
  productName: string;
  priceAtSignup: number; // giá rẻ nhất lúc đăng ký, để so sau này biết đã giảm chưa
  createdAt: string; // ISO
}

/** Offer đã được tính khoảng cách + gắn kèm thông tin store, dùng để hiển thị. */
export interface RankedOffer extends Offer {
  store: Store;
  product: Product;
  distanceKm: number | null;
}
