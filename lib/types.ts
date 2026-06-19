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
}

export interface Product {
  id: string;
  name: string;
  brand: string;
  category: string;
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

export interface Catalog {
  products: Product[];
  offers: Offer[];
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
