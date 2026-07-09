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
export const APP_VERSION = "1.3.8";

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
      subVersion: "1.3.8",
      date: "03.07.2026",
      highlights: [
        "Sản phẩm nhiều loại (vd mùi hương, dung tích): chọn ngay trên thẻ — hiện tên nhóm phân loại rồi tới các lựa chọn. Bán ở 1 nơi thì chọn ngay tại thẻ; bán nhiều nơi thì vào 'So sánh' để chọn theo từng nơi. Lựa chọn không có hàng sẽ mờ đi, không bấm được",
        "Đăng nhập / tạo tài khoản bằng số điện thoại (xác thực qua mã OTP) để lưu thông tin đặt hàng",
        "Thanh toán chuyển khoản: sau khi bạn chuyển, trợ lý tự nhận biết đơn đã thành công hay chưa và cập nhật trạng thái — không cần bấm 'Tôi đã chuyển khoản'",
        "Đặt sản phẩm từ nhiều cửa hàng: bước thanh toán được xử lý cùng lúc giữa các cửa hàng; thẻ đã lưu hiện thông tin chi tiết khi nhập mã OTP",
        "Giỏ hàng: thêm nút xoá (🗑) để bỏ nhanh một món khỏi giỏ",
        "Đổi 'Điểm bán quanh bạn' → 'Điểm bán'; số liệu quanh bạn tính theo tỉnh/thành (hoặc quốc gia) bạn đang ở",
        "Bản đồ gọn hơn: chỉ hiển thị cửa hàng của các chuỗi; biểu tượng loại danh mục đồng bộ với pin trên bản đồ",
        "Sửa lỗi bấm vào một số cửa hàng trên bản đồ (vd Costco) không hiện sản phẩm",
        "Logo một số cửa hàng/nhãn hiển thị đúng, đầy đủ và phủ đều thẻ hơn (vd Costco, Long Monaco)",
        "Cửa hàng dùng ngoại tệ hiển thị đúng đơn giá (vd Costco hiện $209.99, không bị nhân nghìn)",
        "Sửa giá album nhạc hiển thị sai ở popup thông tin",
        "Bản đồ: bấm ✕ ở phần chú thích chỉ THU GỌN chú thích — các pin cửa hàng vẫn giữ nguyên trên bản đồ, bấm nút để mở lại",
        "Chú thích bản đồ có biểu tượng đúng MÀU pin của từng loại cửa hàng (vd Ăn uống màu cam) — nhìn chú thích biết ngay pin trên bản đồ thuộc loại nào",
        "Đặt nhiều cửa hàng một lượt: mã QR riêng của từng cửa hàng hiện sẵn cùng lúc để quét lần lượt, trợ lý dừng chờ bạn thanh toán ở từng nơi; chọn 'Thẻ' là nhập thông tin thẻ ngay tại form — nhập MỘT lần, các cửa hàng đang chờ thẻ tự chạy tiếp",
        "Thẻ đã lưu luôn che số (•••): bấm biểu tượng con mắt và nhập đúng mã OTP gửi tới số điện thoại mới xem được số thẻ đầy đủ",
        "Màn hình 'Đặt hàng thành công' được chỉnh lại gọn gàng, rõ ràng hơn",
      ],
    }, {
      subVersion: "1.3.7",
      date: "02.07.2026",
      highlights: [
        "Form 'Thông tin chung' (họ tên · SĐT/Zalo · địa chỉ) giờ là MỘT form thống nhất ở mọi nơi đặt hàng: giỏ hàng, Mua ngay, Mua cả túi và đặt nhạc — nhập ở đâu cũng được nhớ và tự điền lại ở các form còn lại",
        "Số điện thoại được kiểm tra định dạng ngay khi gõ ở mọi form (báo lỗi rõ ràng, đúng chuẩn số Việt Nam; cửa hàng nước ngoài kiểm theo chuẩn nước đó)",
        "Đặt cả túi: các món được gom theo NƠI BÁN THẬT của từng món (vd Bách Hóa Xanh, Tạp Hóa Xe Lam) — trợ lý đặt trực tiếp tại từng nơi bán, tiêu đề hiện đúng số nguồn của túi",
        "Form Mua cả túi đồng bộ hoàn toàn với giỏ hàng: từng nguồn có logo + tổng tiền riêng, chọn khung giờ giao (nguồn nào cần), ghi chú riêng từng nguồn, và chọn thanh toán QR / Thẻ / COD — thẻ đã lưu tự điền, QR hiện từng nguồn khi trợ lý đặt",
        "Túi gợi ý hiện đúng giá combo và giá từng món kèm nơi bán; mỗi túi chỉ xuất hiện MỘT lần và không còn gắn nhãn chuyên trang — thẻ túi gọn hơn",
      ],
    }, {
      subVersion: "1.3.6",
      date: "01.07.2026",
      highlights: [
        "Giỏ hàng trợ lý: thanh toán bằng QR (mỗi cửa hàng một mã riêng để quét chuyển khoản) hoặc nhập thẻ MỘT LẦN để trợ lý tự thanh toán cho tất cả nguồn trong giỏ",
        "Đơn có mức mua tối thiểu (vd Co.op 200.000đ): tự thêm số lượng cho đủ mức, hiển thị rõ số lượng đã thêm và mức mua tối thiểu",
        "Số liệu 'Mặt hàng trên kệ' tính theo lượng mặt hàng thực trên kệ ở các cửa hàng (sát thực tế điểm bán quanh bạn)",
        "Logo nhãn hiển thị đầy đủ, đúng nét hơn — Allo Clean giữ nguyên phần ruột logo, Beauty Republic hiện rõ chữ",
        "Khu nhạc bản quyền đổi tên từ 'Khúc Chạm Store' thành 'Khúc Chạm Plaza'",
      ],
    }, {
      subVersion: "1.3.5",
      date: "30.06.2026",
      highlights: [
        "Form 'Gửi lời yêu thương' ghi rõ: lời nhắn sẽ được kênh gắn lên bài hát — dịch vụ có tính phí, và bạn có cơ hội được miễn phí",
        "Nút 'Quay lại' khi đang xem danh mục/nhãn hàng giờ lùi từng cấp (vd từ ngành con về nhãn) thay vì nhảy thẳng về trang chủ; nút mũi tên ở đầu trang vẫn về trang chủ",
        "Khu 'Giá hời quanh đây': bỏ nút xem bản đồ trùng lặp, gọn hơn",
        "Bộ lọc bán kính ở 'Giá hời quanh đây' đồng bộ mức với bản đồ (50m → 1km)",
      ],
    }, {
      subVersion: "1.3.4",
      date: "29.06.2026",
      highlights: [
        "Album nhạc Khúc Chạm có đường dẫn riêng — bấm F5 hay chia sẻ link vẫn vào đúng trang album",
        "Album nhạc giờ mua trọn bộ; các bài bên trong để nghe thử (vẫn mua lẻ được ở thẻ bài hát riêng ngoài trang chủ)",
        "Gửi 'lời yêu thương' / 'đề nghị cấp phép nhạc' xong hiện lời cảm ơn ngay trên cửa sổ, kèm logo Khúc Chạm",
        "Sửa lỗi không gửi được 'lời yêu thương' khi để trống tên/SĐT",
        "Thêm dải 'Affree trong những con số' ở cuối trang: lượt truy cập, đơn đã tạo, lượt thêm giỏ — cùng số sản phẩm so giá / điểm bán quanh bạn / thương hiệu; số liệu thật, đếm tăng dần khi cuộn tới",
        "Khu vực nhạc Khúc Chạm dùng đúng logo chính thức của kênh",
        "Đưa khu vực 'Nhạc bản quyền' xuống dưới (sau khu vực món ăn) cho bố cục trang chủ tự nhiên hơn",
      ],
    }, {
      subVersion: "1.3.3",
      date: "26.06.2026",
      highlights: [
        "Thêm khu vực 'Nhạc bản quyền — Khúc Chạm': mua trọn album (999.999đ) hoặc mua từng bài, có 'Nghe thử' để nghe trước khi mua",
        "Trình phát nhạc Khúc Chạm nổi ở góc màn hình — thu gọn hoặc mở lại tuỳ ý; chọn bài là phát ngay",
        "Popup 'Mua ngay' và giỏ hàng ghi rõ tên nơi bán (vd 'Shopee'), không viết tắt",
        "Cửa hàng không nhận đặt online vẫn hiển thị thông tin liên hệ để bạn chủ động liên hệ",
        "Thẻ sản phẩm hiển thị thông tin đầy đủ hơn, có viền & đổ bóng đồng bộ",
        "Bộ lọc bán kính ở 'Giá hời quanh đây' đồng bộ giao diện với bộ lọc trên bản đồ",
        "Sửa lỗi một số popup bị mờ / khó đọc khi máy ở chế độ tối — nền luôn sáng, chữ luôn rõ",
        "Sau khi định vị, cửa hàng & sản phẩm tự bám theo tỉnh/thành bạn đang đứng (vd TP.HCM) để hiển thị sát nhu cầu & tải nhẹ hơn",
      ],
    }, {
      subVersion: "1.3.2",
      date: "25.06.2026",
      highlights: [
        "Bấm vào logo nhãn tài trợ → mở thẳng trang cửa hàng của chuỗi (vd Astra Bean) — không bị giới hạn quốc gia",
        "Tag 'TÀI TRỢ / PHỔ BIẾN' chuyển lên đỉnh thẻ logo, không còn che lên tên/biểu tượng",
        "Logo nhãn tự nhận màu nền theo bộ nhận diện brand, phủ đều cả thẻ (Mencode vàng, Vinamilk xanh, Beauty Republic gold…)",
        "Trang 'Phiên bản' chia 2 cấp cha–con: bản 1.3 chứa các bản con 1.3.1, 1.3.2…; mục đánh số dọc, dễ đọc trên máy tính",
        "Đổi vị trí trên thanh đầu: giỏ hàng & lịch sử lên trên, ô địa chỉ xuống dưới để bố cục cân đối hơn",
        "Bản đồ: bấm xem sản phẩm của cửa hàng → mở trang riêng có tên cửa hàng làm tiêu đề, danh mục cuộn ngang, sản phẩm xếp dọc như trang chủ",
        "Khu vực sự kiện (vd Worldcup) đẩy lên đầu để dễ thấy",
        "Hiển thị spinner 'đang tải dữ liệu' rõ ràng khi catalog chưa nạp xong",
        "Tệp 'Dịch vụ' giờ liệt kê đúng các dịch vụ OCS cung cấp (định giá, xây dựng, nhà đất, B2B, …)",
        "Icon lửa 🔥 trong 'Giá hời quanh đây' có hiệu ứng nhấp nháy sinh động",
        "Túi ghép / túi đôi / túi đa dạng: thêm nút ⓘ để xem chi tiết từng sản phẩm trong túi",
        "Cập nhật hiệu ứng kính (liquid glass) theo phong cách iOS / macOS 26-27 cho các popup",
        "Bản đồ chỉ hiển thị cửa hàng cùng quốc gia user đang đứng (vd ở Canada → không hiện cửa hàng VN)",
      ],
    }, {
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
      "Tên khu vực ở trang chủ to và nổi bật hơn, bỏ con số đếm cạnh tên để tiêu đề gọn — đỡ rối mắt",
    ],
  },
  {
    group: "Cá nhân hoá theo thời điểm & người dùng",
    emoji: "🌅",
    items: [
      "Tên khu vực tự đổi theo thời điểm trong ngày — sáng sớm gợi 'Đi chợ sớm', trưa 'Bữa trưa quanh đây', chiều 'Sửa soạn bữa tối', đêm 'Đặt sẵn cho mai'",
      "Mở app vào thời điểm nào → tự ưu tiên những khu vực phù hợp lên đầu (vd trưa: bữa trưa, đồ uống mát; tối: đồ tươi cho mai)",
      "Ghi nhớ thói quen mua sắm của bạn để gợi ý khu vực và sản phẩm sát sở thích hơn theo thời gian",
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

/** Gói dữ liệu Phiên bản dùng chung server/client. */
export interface VersionInfo {
  appVersion: string;
  history: VersionEntry[];
  roadmap: RoadmapSection[];
}

/** Fallback = đúng nội dung hardcode ở trên — dùng làm giá trị ban đầu ở client và khi sheet lỗi. */
export const VERSION_FALLBACK: VersionInfo = {
  appVersion: APP_VERSION,
  history: VERSION_HISTORY,
  roadmap: ROADMAP,
};
