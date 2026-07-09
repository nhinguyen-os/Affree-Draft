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
  /** Loại CSKD (cơ sở kinh doanh) — mảng các giá trị dạng "CATEGORY > Subcategory". */
  loaiCskd?: string[];
  /** Số điện thoại liên hệ của cửa hàng. */
  phone?: string;
}

export interface Product {
  id: string;
  name: string;
  brand: string;
  category: string;
  /** "Tệp" / nhóm danh mục hiển thị (cột danh_muc trong sheet). Trống → tự suy luận. */
  group?: string;
  /**
   * Danh sách các tệp mà sản phẩm thuộc về (vd ["Giỏ tạp hóa", "Worldcup"]).
   * Lấy từ TẤT CẢ dòng cùng product_id trong tab SanPham. Trống → fallback [group].
   * Cho phép 1 sản phẩm hiển thị ở nhiều section bottom (vd campaign tag).
   */
  groups?: string[];
  unit: string;
  image?: string;
  /** Thông tin mô tả sản phẩm (cột info/mo_ta trong sheet). Hiển thị qua nút ⓘ trên thẻ. */
  info?: string;
  /** Danh sách URL ảnh chứng nhận (cột chung_nhan/certifications trong sheet, phân tách bằng `;` hoặc `,`). */
  certifications?: string[];
  /** Giá niêm yết / MSRP (cột GIA_BAO_BI trong sheet). Hiển thị gạch ngang nếu > giá hiện tại. */
  listedPrice?: number;
  /** % khuyến mãi từ giá niêm yết (cột %_KHUYEN_MAI). Đơn vị: 0..1 (vd 0.22 = 22%). */
  discountPct?: number;
  /** Tên trục variant (từ cột variant_name1/2). Vd "Size", "Màu". Trống = SP không variant. */
  variantName1?: string;
  variantName2?: string;
}

/** Một "offer" = một sản phẩm được bán tại một cửa hàng với giá + tồn kho. */
export interface Offer {
  productId: string;
  storeId: string;
  price: number;
  inStock: boolean;
  productUrl: string;
  lastChecked: string; // ISO
  /** Giá trị variant của offer (cột variant_value1/2). Vd "M", "Đỏ". Trống = không variant. */
  variant1?: string;
  variant2?: string;
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
  /** Thứ tự hiển thị trên homepage (cột C tab DanhMuc): số nhỏ hiện trước. Trống → đứng cuối, giữ thứ tự nhập. */
  order?: number;
  /** Cờ Ẩn/Hiện (cột D tab DanhMuc): "Ẩn"/false → ẩn khỏi homepage; mặc định = hiện. */
  hidden?: boolean;
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

/**
 * Một "nhãn tài trợ" khai báo trong tab "Nhãn tài trợ" của Google Sheet (tên · link · logo).
 * Hiển thị thành 1 dải logo dưới mục "Dịch vụ quanh đây"; bấm vào mở link.
 */
export interface Sponsor {
  name: string;
  link?: string;
  logo?: string;
  /**
   * "sponsor" = nhãn tài trợ (nhãn của nhà mình); "popular" = nhãn phổ biến (nhãn ngoài).
   * Đọc từ cột "loại" trong tab "Nhãn tài trợ". Trống → mặc định hiển thị "Phổ biến".
   */
  kind?: "sponsor" | "popular";
}

/**
 * Nhóm "sản phẩm tương tự" khai báo trong tab "tương tự" của Google Sheet.
 * `products` = danh sách product_id hoặc tên (khớp một phần, không phân biệt hoa thường).
 */
export interface SimilarGroup {
  name: string;
  products: string[];
}

/** 1 sản phẩm thành viên trong túi ghép. */
export interface TuiItem {
  productId: string;
  name: string;
  gia: number;
  /** NGUỒN ĐÍCH mua SP (cột nguon_mua): THXL · bhx · coop · spe… — nơi trợ lý đặt món này. */
  chain: string;
}

/** Túi ghép (combo): nhiều SP đơn gộp lại, có giá combo. loai: TĐG=đơn ghép · T2=đôi · TĐD=đa dạng.
 *  Món trong túi lấy từ nhiều NGUỒN ĐÍCH trên Affree (item.chain) — trợ lý đặt tại từng nguồn. */
export interface Tui {
  maTui: string;
  tenTui: string;
  /** LEGACY — tab Tui mới không còn cột chuyên trang; giữ field cho seed/nguồn cũ, app KHÔNG hiển thị. */
  chuyenTrang: string;
  loai: string;
  giaCombo: number;
  daChain: boolean;
  items: TuiItem[];
}

export interface Catalog {
  products: Product[];
  offers: Offer[];
  /** Cấu hình TOP TILES "Dịch vụ quanh đây" (sheet 1AJ2/tệp). Trống → web tự dựng. */
  groups?: ProductGroup[];
  /** Cấu hình BOTTOM SECTIONS (sheet 1sZTv/DanhMuc) — chỉ ten + emoji. Khác `groups`. */
  danhMucGroups?: ProductGroup[];
  /** Hồ sơ ưu tiên hiển thị theo chuỗi (tab "ưu tiên hiển thị"). Trống → dùng mặc định trong code. */
  priorities?: PriorityProfile[];
  /** Nhãn tài trợ (tab "Nhãn tài trợ"). Trống → không hiện dải nhãn tài trợ. */
  sponsors?: Sponsor[];
  /** Nhóm sản phẩm tương tự (tab "tương tự"). Trống → tự suy theo ngành hàng. */
  similarGroups?: SimilarGroup[];
  /** Túi ghép/đôi/đa dạng (tab "Tui" 1sZTv hoặc seed). Trống → không hiện mục Túi. */
  tui?: Tui[];
  /** Tên section "Đồ ăn" theo buổi ăn (tab 1sZTv gid=743152394). Trống → dùng tên base trong code. */
  mealTitles?: MealTitle[];
  /** Giá mua tối thiểu theo chain (tab "Giá tối thiểu"). key thường-hoá → VND. */
  minOrders?: Record<string, number>;
  /** Logo theo chain (tab "Logo nguồn" gid=1744262265). key thường-hoá → URL/data URI. */
  sourceLogos?: Record<string, string>;
  /** Tên hiển thị theo chain (tab "Logo nguồn" cột ten_nguon). key thường-hoá → tên. */
  sourceNames?: Record<string, string>;
  /** Tiền tệ theo store_id (tab "Cửa hàng" cột Currency). key = store_id → mã tiền (USD…). */
  storeCurrencies?: Record<string, string>;
  /** Tiền tệ theo chain (suy từ tab "Cửa hàng"). key = chain → mã tiền. Fallback khi offer là nguồn online. */
  chainCurrencies?: Record<string, string>;
}

/**
 * Một mốc tên buổi ăn cho section "Đồ ăn" (tab "Tên Đồ ăn theo giờ").
 * `fromHour` = giờ bắt đầu áp tên này; áp tới trước fromHour kế tiếp (giờ trước mốc đầu → bao vòng về mốc cuối).
 */
export interface MealTitle {
  fromHour: number;
  vi: string;
  en: string;
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
  orderCode?: string; // mã đơn chung cho các món đặt cùng 1 lần (vd "AFF-117468-128") — để gom lịch sử theo đơn
  buyerLat?: number; // vị trí người mua lúc ghi nhận (nếu đã định vị)
  buyerLng?: number;
  buyerAddr?: string; // địa chỉ reverse-geocode của người mua
  buyerName?: string; // họ tên người đặt mua (form "Vào mua")
  buyerPhone?: string; // SĐT/Zalo người đặt mua (khoá dự phòng liên kết tài khoản)
  buyerUserId?: string; // user_id tài khoản (khoá chính) — server gắn từ phiên nếu đã đăng nhập
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

export interface CartItem {
  product: Product;
  offer: RankedOffer;
  qty: number;
  /**
   * Phần số lượng được TỰ ĐỘNG bơm thêm (nằm trong `qty`) để đạt mức mua tối thiểu của
   * chuỗi (vd Co.op 200k). userQty thực = qty - autoQty. Khi thêm món khác đủ ngưỡng thì
   * phần này tự hạ về 0. 0/undefined = không có bơm tự động.
   */
  autoQty?: number;
}
