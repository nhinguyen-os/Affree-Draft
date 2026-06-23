/**
 * Phiên bản app + lộ trình tính năng sắp tới (hiển thị ở nút "version" trên header).
 * Cập nhật ROADMAP khi có thêm hạng mục; APP_VERSION khi phát hành bản mới.
 */
export const APP_VERSION = "1.2";

export interface RoadmapSection {
  group: string;
  emoji: string;
  items: string[];
}

/**
 * Tính năng đã có trong bản hiện tại — CHỈ liệt kê TÍNH NĂNG cho người dùng.
 * KHÔNG liệt kê fix lỗi / tinh chỉnh giao diện (chúng không hiển thị ở mục phiên bản).
 */
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
      'Đổi tên mục "Lịch sử mua hàng"',
    ],
  },
];
