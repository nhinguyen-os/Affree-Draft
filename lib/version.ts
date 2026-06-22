/**
 * Phiên bản app + lộ trình tính năng sắp tới (hiển thị ở nút "version" trên header).
 * Cập nhật ROADMAP khi có thêm hạng mục; APP_VERSION khi phát hành bản mới.
 */
export const APP_VERSION = "1.0";

export interface RoadmapSection {
  group: string;
  emoji: string;
  items: string[];
}

/** Tính năng đã có trong bản hiện tại — tóm gọn, mỗi dòng 1 ý ngắn. */
export const DONE: string[] = [
  "So sánh giá nhiều nơi bán quanh bạn",
  "Định vị / nhập địa chỉ → xem khoảng cách tới cửa hàng",
  "Bán chạy theo khu vực (phường)",
  "Hiển thị giá theo tiền tệ cửa hàng (₫ / $)",
  "Đặt hàng qua trợ lý ảo (mô phỏng)",
  "Lịch sử mua hàng & báo khi giảm giá",
  "Bản đồ cửa hàng + chỉ đường",
];

/** Tính năng/sửa lỗi dự kiến làm tiếp sau bản 1.0 (nguồn: backlog nội bộ). */
export const ROADMAP: RoadmapSection[] = [
  {
    group: "Tìm kiếm & địa chỉ",
    emoji: "🔎",
    items: [
      "Sửa tìm kiếm đa vùng (VN ↔ Canada) để ra đúng sản phẩm (vd: sữa tắm)",
      'Giữ khu "Dịch vụ quanh đây" không biến mất khi đang gõ tìm',
      '"Giá hời quanh đây" chỉ gợi ý sản phẩm liên quan (tham khảo Grab)',
      "Làm rõ nguồn tìm địa chỉ (OpenStreetMap / Google) & hỗ trợ Map Server về sau",
      "Xem lại cách lọc theo bán kính",
    ],
  },
  {
    group: "Cửa hàng & nơi bán",
    emoji: "🏪",
    items: [
      "Bổ sung nơi bán cho sản phẩm core: Day Sales / 7 chuyên trang",
      "Thêm cửa hàng Costco",
      "Quy tắc store_id khi một quận có nhiều cửa hàng",
      "Hiển thị cửa hàng online (vd ở Mỹ) hợp lý hơn",
      "Astra Bean: hiển thị đúng là 1 nơi bán",
    ],
  },
  {
    group: "Danh mục (tệp)",
    emoji: "🗂️",
    items: [
      "Thêm 3 tệp mới: B2B, Đàn ông đích thực, Thế giới phái đẹp",
      'Xóa tệp "Đi chợ"',
    ],
  },
  {
    group: "Địa điểm thân thiện",
    emoji: "📍",
    items: [
      "Bổ sung địa điểm: nhà hát, địa điểm nổi tiếng…",
      'Cho phép gợi ý tên nhóm khác (vd "Địa điểm nổi tiếng")',
    ],
  },
  {
    group: "Giao diện",
    emoji: "✨",
    items: [
      "Rút gọn dòng vị trí hiện tại trên điện thoại (tránh chiếm diện tích)",
      "Tinh chỉnh lại icon cho bớt thô",
      "Sửa ảnh sản phẩm ở thanh tìm kiếm hiển thị đầy đủ như bên ngoài",
      'Đổi tên mục "Lịch sử mua hàng"',
    ],
  },
];
