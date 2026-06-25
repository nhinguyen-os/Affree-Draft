/**
 * Phiên bản app + lịch sử + lộ trình.
 *
 * NGUYÊN TẮC GHI:
 *  - HAI CẤP: phiên bản CHA = MAJOR.MINOR (vd 1.3); phiên bản CON = PATCH bên trong cha (vd 1.3.1).
 *    Mỗi `VersionEntry` là 1 bản CHA chứa nhiều `children` (sub-version).
 *    `date` mỗi sub-version ở dạng "DD.MM.YYYY". Mỗi NGÀY phát hành = 1 sub-version.
 *    Sang ngày mới CÙNG MAJOR.MINOR → thêm sub-version 1.3.2, 1.3.3, …
 *    Đổi cấp lớn (đợt nâng cấp lớn) → tạo CHA mới 1.4 với sub-version 1.4.1.
 *  - Chỉ viết những gì NGƯỜI DÙNG CUỐI nhìn thấy/cảm nhận được.
 *  - Không lộ thông tin nội bộ (tên nhân sự, tên sheet/kho dữ liệu, tên đối tác,
 *    công thức tính, quy tắc xếp hạng, mã nguồn/khoá cấu hình, kế hoạch kỹ thuật…).
 *  - Diễn đạt mọi nội dung sao cho người ngoài đọc cũng hiểu (không "biệt ngữ").
 *  - Mỗi lần phát hành: thêm sub-version mới lên ĐẦU `children` của bản cha tương ứng;
 *    bump APP_VERSION sang sub-version mới nhất.
 *  - Khi 1 mục "Sắp ra mắt" đã làm xong → CHUYỂN sang sub-version tương ứng,
 *    đồng thời xoá khỏi ROADMAP để giữ trang Phiên bản luôn đúng thực tế.
 */
export const APP_VERSION = "1.3.1";

export interface SubReleaseEntry {
  /** Sub-version (PATCH), vd "1.3.1". */
  subVersion: string;
  date?: string;
  highlights: string[];
}

export interface VersionEntry {
  /** Bản CHA (MAJOR.MINOR), vd "1.3". */
  version: string;
  /** Ngày bản cha bắt đầu (ngày của sub-version đầu tiên). */
  date?: string;
  /** Sub-version, MỚI NHẤT ở đầu mảng. */
  children: SubReleaseEntry[];
}

/** Lịch sử các bản, MỚI NHẤT ở đầu mảng. */
export const VERSION_HISTORY: VersionEntry[] = [
  {
    version: "1.3",
    date: "24.06.2026",
    children: [{
      subVersion: "1.3.1",
      date: "24.06.2026",
      highlights: [
      // Bản đồ & vị trí
      "Bản đồ: chú thích hiện loại cửa hàng kèm số lượng quanh bạn",
      "Bản đồ: chạm vào pin cửa hàng → mở nhanh trang sản phẩm của cửa hàng đó",
      "Bản đồ: tắt danh sách cửa hàng thì các pin trên bản đồ cũng ẩn theo",
      "Lọc theo bán kính: bản đồ tự phóng to/thu nhỏ cho khớp vùng đã chọn",
      "Tìm địa chỉ ngoài Việt Nam: bản đồ tự bay tới đúng vị trí",

      // Nhãn tài trợ - Nhãn phổ biến
      "Khu vực 'Nhãn tài trợ - Nhãn phổ biến' đổi tên rõ ràng, phân biệt 2 nhóm",
      "Mỗi logo có tag 'TÀI TRỢ' hoặc 'PHỔ BIẾN' để dễ nhận biết",
      "Logo nhãn tài trợ được bo tròn cho thẩm mỹ",
      "Tên khu vực canh trái, đồng nhất phong cách với 'Dịch vụ quanh đây'",

      // Khu vực sản phẩm bổ sung
      "Thêm khu vực 'Worldcup' (sản phẩm theo mùa giải)",
      "Thêm khu vực 'Túi ghép - đôi - đa dạng' (gợi ý mua theo combo)",
      "Thêm khu vực 'Hàng thiết yếu' (đường, muối, tiêu, bột ngọt…)",
      "Thêm khu vực 'Hè - Đẹp - Khoẻ' (hoá mỹ phẩm cho nam, nữ, túi)",

      // So sánh giá & cửa hàng
      "Nút 'Chỉ đường' chuyển màu xanh dương để nhận biết là liên kết",
      "Dưới giá hiển thị thời điểm cập nhật và tình trạng còn/hết hàng",

      // Trang sản phẩm & danh mục
      "Popup 'Thông tin sản phẩm' hiện giữa màn hình (cả điện thoại & máy tính), có hiệu ứng kính mờ",
      "Popup thông tin có hình chứng nhận sản phẩm kèm theo",
      "Form thông tin có tiêu đề rõ và bố cục dễ đọc",
      "Mỗi danh mục và mỗi nhãn hàng có trang riêng, đường dẫn gọn dễ chia sẻ",

      // Quốc gia / khu vực
      "Hiển thị sản phẩm theo quốc gia bạn đang đứng; nguồn bán online vẫn hiện ở mọi nơi",
      "Mở 'trang cửa hàng' của một chuỗi qua đường dẫn ngắn (vd /astrabean): xem toàn bộ sản phẩm của chuỗi đó, không bị giới hạn quốc gia",
      "Nhãn 'Cửa hàng' ở tiêu đề lấy đúng màu nhận diện của chuỗi",

      // Giỏ hàng & đặt hàng
      "Giỏ hàng: hiệu ứng nổi bật khi thêm sản phẩm (rung nhẹ + dấu +1)",
      "Bộ chọn số lượng (− số +) trong giỏ hàng",

      // Phiên bản
      "Trang 'Phiên bản' gọn lại: bản cũ ẩn chi tiết, bấm 'Xem chi tiết' mới mở ra",
      "Chip phiên bản 'v…' (kèm biểu tượng 'i') hiện trên cả điện thoại",
      "Đã ẩn các quy tắc nội bộ khỏi trang Phiên bản — mọi người đều có thể đọc",

      // Khác
      "Có form 'Liên hệ dịch vụ', kèm đường dẫn sang dịch vụ làm hồ sơ hộ",
      "Cảm giác 'kính mờ' (liquid glass) đồng bộ trên popup và nền, mọi thiết bị",
      "Có thể chọn bán kính cho mục 'Giá hời quanh đây' (500m / 1km / 2km / 3km / 5km)",
      ],
    }],
  },
  {
    version: "1.2",
    date: "06.2026",
    children: [{
      subVersion: "1.2.1",
      date: "06.2026",
      highlights: [
        "Bản đồ mới (vector tile, OpenStreetMap), mượt hơn và xoay/zoom tốt hơn",
        "Tìm địa chỉ kể cả ngoài Việt Nam → bản đồ tự bay tới đúng vị trí",
        "Lọc cửa hàng theo bán kính (50m – 1km) quanh bạn",
        "Tìm kiếm sản phẩm nhanh và gợi ý tốt hơn",
        "Giỏ hàng & lịch sử mua, báo khi sản phẩm bạn quan tâm giảm giá",
        "Đặt hàng nhanh qua trợ lý ảo (mô phỏng)",
      ],
    }],
  },
  {
    version: "1.0",
    date: "05.2026",
    children: [{
      subVersion: "1.0.1",
      date: "05.2026",
      highlights: [
        "So sánh giá nhiều nơi bán quanh bạn",
        "Định vị / nhập địa chỉ → xem khoảng cách tới cửa hàng",
        "Hiển thị giá theo tiền tệ cửa hàng (₫ / $)",
        "Gợi ý sản phẩm bán chạy quanh bạn",
        "Bản đồ cửa hàng + chỉ đường",
      ],
    }],
  },
];

export interface RoadmapSection {
  group: string;
  emoji: string;
  items: string[];
}

/** Tính năng đang phát triển — mô tả hướng người dùng, không lộ chi tiết kỹ thuật. */
export const ROADMAP: RoadmapSection[] = [
  {
    group: "Bản đồ & vị trí",
    emoji: "🗺️",
    items: [
      "Bấm 'Mua hàng' trên pin cửa hàng → mở thẳng trợ lý đặt hàng (đang còn cần polish)",
      "Đổi 'Sửa vị trí' sang dạng popup giữa màn hình cho dễ thao tác",
      "Tinh chỉnh nhãn 'gần nhất / rẻ nhất' để không che tên cửa hàng",
    ],
  },
  {
    group: "So sánh giá & cửa hàng",
    emoji: "🏪",
    items: [
      "Khi xem chi nhánh khác, hiển thị thẻ thông tin phân biệt rõ với chi nhánh mặc định",
      "Đổi chữ 'Chênh' sang cách diễn đạt thân thiện hơn",
      "Cùng chuỗi: gộp lại, mở ra xem nhiều chi nhánh",
      "Tính cả phí ship vào so sánh giá",
      "Mở rộng nơi bán cho nhiều dòng sản phẩm",
    ],
  },
  {
    group: "Giỏ hàng & đặt hàng",
    emoji: "🛒",
    items: [
      "Nút 'Bỏ vào giỏ' xuất hiện ngay tại danh sách so sánh giá",
      "Giỏ hàng gộp nhiều nguồn (thanh toán 1 lần)",
      "Chọn khung giờ giao hàng trong ngày",
    ],
  },
  {
    group: "Trang sản phẩm & danh mục",
    emoji: "📦",
    items: [
      "Vào 'Xem tất cả' của một danh mục: bỏ thanh tìm kiếm & bản đồ, dùng tên danh mục làm tiêu đề, có nút quay lại trang chính",
      "Đổi tên nhóm 'Khác' sang tên cụ thể hơn cho dễ hiểu",
    ],
  },
  {
    group: "Khu vực 'Dịch vụ quanh đây' & 'Nhãn tài trợ'",
    emoji: "✨",
    items: [
      "Tinh chỉnh viền các thẻ nhãn cho sát nhau hơn, đồng nhất với 'Dịch vụ quanh đây'",
      "Khi có sự kiện lớn (vd. giải bóng đá), hiện biểu tượng ngôi sao nổi bật, vào nhanh nhóm sản phẩm liên quan; bật/tắt được theo thời điểm",
    ],
  },
  {
    group: "Trải nghiệm trên điện thoại",
    emoji: "📱",
    items: [
      "Tối ưu thân thiện hơn cho màn hình nhỏ",
      "Dòng địa chỉ dài tự xuống dòng để thấy đủ nội dung khác trên thẻ",
      "Đồng bộ hiệu ứng chạy của dòng địa chỉ trong các thẻ (chỗ chạy, chỗ không)",
      "Sửa hiệu ứng khi rê chuột vào thẻ sản phẩm (đang bị lệch ở một số máy)",
    ],
  },
  {
    group: "Khám phá theo khu vực",
    emoji: "🌐",
    items: [
      "Khi đang ở Việt Nam, thêm mục 'Hàng nước ngoài' bên cạnh hàng trong nước",
      "Ưu tiên hiển thị cửa hàng ở khu vực gần bạn nhất trước",
    ],
  },
];
