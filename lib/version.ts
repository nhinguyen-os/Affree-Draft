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
  "Tìm địa chỉ (kể cả nước ngoài) → bản đồ hiển thị đúng vị trí đó",
];

/** Tính năng/sửa lỗi dự kiến làm tiếp sau bản 1.0 (nguồn: backlog nội bộ). */
export const ROADMAP: RoadmapSection[] = [
  {
    group: "Bản đồ & vị trí",
    emoji: "🗺️",
    items: [
      "Dòng vị trí hiện tại chạy từ phải qua trái (đang lộn xộn)",
      "Vị trí trên điện thoại: chạy & hiển thị đúng trên bản đồ",
      "Bản đồ hiện thêm cửa hàng gần nhất (hiện mới chỉ có rẻ nhất)",
      'Tag "gần nhất / rẻ nhất" chuyển vào trong, không đè tên cửa hàng',
      'Nút chỉ đường: nhỏ lại, đặt gần dòng "cách bạn 2km"',
      "Bán kính & bản đồ đang tách rời → đổi vị trí map lên/xuống cho hợp lý",
      "Bán kính trên map: khoanh vùng gọn lại",
      "Thêm nút × để đóng bản đồ",
      "Làm rõ nguồn tìm địa chỉ (OpenStreetMap / Google) & hỗ trợ Map Server về sau",
      "Xem lại cách lọc theo bán kính",
    ],
  },
  {
    group: "So sánh giá & cửa hàng",
    emoji: "🏪",
    items: [
      "Cùng 1 nhóm (vd BHX): hiện nơi rẻ nhất, bấm mũi tên xem tất cả chi nhánh",
      "Xử lý trường hợp nơi rẻ nhất ở xa (vd Hà Nội)",
      'Concern "đắt hơn": tính cả phí ship để so sánh cho đúng',
      'Sheet "stores": bổ sung store_id, chuẩn hoá cấu trúc',
      '"Còn hàng": ghi rõ thời điểm kiểm tra (vd 8h ngày 23/6)',
      'Xem lại cách tính "Bán chạy"',
      "Logo nguồn bán: hiển thị/phủ hợp lý",
      "Astra Bean: 2 dòng đang lệch nhau",
      "Food paradise: bổ sung nơi bán",
      "Bổ sung nơi bán sản phẩm core: Day Sales / 7 chuyên trang",
      "Costco: mỗi quốc gia 1-2 cái + viết hoa đúng",
      "Hiển thị cửa hàng online (vd ở Mỹ) hợp lý hơn",
    ],
  },
  {
    group: "Giỏ hàng & thanh toán",
    emoji: "🛒",
    items: [
      'Thêm nút "Bỏ vào giỏ hàng" ở phần so sánh giá',
      'Bấm "+" → thêm thẳng vào giỏ hàng',
      "Bộ chọn số lượng (− số +)",
      "Giỏ hàng nhiều nguồn (gộp bản 1 nguồn qua)",
      "Bỏ bước xác minh OTP",
      "Checkout: khung giờ giao trong hôm nay (2-4h)",
      "Mua 1 sản phẩm → checkout: bổ sung chỗ hiện sản phẩm",
    ],
  },
  {
    group: "Giao diện",
    emoji: "✨",
    items: [
      "Nhãn tài trợ: chỉnh lại cho đẹp (đang thô) + bổ sung thêm nhãn",
      'Bỏ viền ngoài ở "Dịch vụ quanh đây" & "Nhãn tài trợ"',
      '"Xem tất cả sản phẩm" → trang dọc riêng (tham khảo Netflix)',
      "Tag sản phẩm: thêm shadow",
      'Chỗ "3 chấm" cho chạy (xem có đẹp không)',
      "Hiệu ứng Liquid glass",
      "Logo Xmen",
      'Tagline: để "Kết nối mua bán - Không thu phí"',
      'Đổi tên mục "Lịch sử mua hàng"',
    ],
  },
  {
    group: "Danh mục & gợi ý",
    emoji: "🗂️",
    items: [
      "Mỗi danh mục sản phẩm gồm những gì → cấu hình qua Sheet",
      '"Sản phẩm tương tự" → cấu hình qua Sheet (theo tiêu chí gì?) + khu quảng cáo',
      "Thêm 3 tệp mới: B2B, Đàn ông đích thực, Thế giới phái đẹp",
      "Bổ sung địa điểm nổi tiếng (nhà hát…) & nhóm gợi ý khác",
    ],
  },
];
