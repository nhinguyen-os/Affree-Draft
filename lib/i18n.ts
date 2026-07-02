// i18n cho Affree. NGUỒN (key) = chuỗi tiếng Việt gốc trong UI; bản dịch tiếng Anh
// nằm trong EN_DICT. Chiến lược "VI làm khoá": chỗ render bọc bằng tr(lang, "chuỗi VN"),
// thiếu bản dịch → tự rơi về tiếng Việt (an toàn, không bao giờ vỡ UI).
//
// Quy ước biến: dùng {name} trong chuỗi; truyền vars = { name: "..." }.
// Tự suy ngôn ngữ theo quốc gia của vị trí: VN (hoặc chưa biết) → vi, còn lại → en.

export type Lang = "vi" | "en";

/** VN hoặc chưa xác định → tiếng Việt; quốc gia khác (vd US) → tiếng Anh. */
export function langForCountry(cc?: string | null): Lang {
  if (!cc) return "vi";
  return cc.trim().toLowerCase() === "vn" ? "vi" : "en";
}

/** Đọc mã quốc gia vị trí đã lưu (localStorage "gqd_loc") để các trang khác suy ngôn ngữ. */
export function readSavedCountry(): string {
  if (typeof window === "undefined") return "";
  try {
    const raw = localStorage.getItem("gqd_loc");
    if (!raw) return "";
    const saved = JSON.parse(raw) as { country?: string };
    return (saved?.country ?? "").toString();
  } catch {
    return "";
  }
}

// Bản dịch EN, khoá = chuỗi VN gốc. Chỉ cần khai báo những chuỗi cần dịch;
// chuỗi không có ở đây sẽ giữ nguyên tiếng Việt.
const EN_DICT: Record<string, string> = {
  // Header
  "Giá hời quanh đây - Mua gì cũng có": "Great deals nearby — anything you need",
  "Giá hời quanh đây - Mua gì cũng có.": "Great deals nearby — anything you need.",
  "Kết nối mua bán - Không thu phí": "Connecting buyers & sellers — no fees",
  "Tìm gì cũng có - Giá hời quanh đây": "Find anything — great deals nearby",
  "Vị trí của bạn": "Your location",
  "Đã có vị trí": "Location set",
  "Chọn vị trí": "Choose location",
  "Lịch sử mua": "Purchase history",
  "Đang định vị…": "Locating…",

  // Geo banner
  "Trình duyệt đang chặn quyền vị trí — mở cài đặt site rồi thử lại.":
    "Your browser is blocking location access — open site settings and try again.",
  "Bật định vị để xem cửa hàng gần bạn nhất.": "Turn on location to see stores nearest you.",
  "Bật định vị": "Turn on location",
  "Nhập địa chỉ": "Enter an address",
  "Bỏ qua": "Dismiss",

  // LocationPanel
  "Đóng": "Close",
  "Dùng vị trí hiện tại": "Use current location",
  "Định vị GPS trên thiết bị của bạn": "GPS positioning on your device",
  "Trình duyệt đang chặn quyền vị trí. Cho phép vị trí rồi thử lại, hoặc nhập địa chỉ bên dưới.":
    "Your browser is blocking location access. Allow location and try again, or enter an address below.",
  "hoặc nhập địa chỉ": "or enter an address",
  "VD: 123 Lê Lợi, Quận 1, TP.HCM": "e.g. 123 Main St, San Jose, CA",
  "Đang tìm…": "Searching…",
  "Bấm để chọn địa chỉ": "Tap to select an address",
  "Không tìm thấy địa chỉ. Thử nhập rõ hơn (đường, quận, thành phố).":
    "No address found. Try being more specific (street, district, city).",

  // Search
  "Tìm sản phẩm (vd: sữa, tã, dầu ăn, gạo…)": "Search products (e.g. milk, diapers, oil, rice…)",

  // Services
  "Dịch vụ quanh đây": "Services nearby",
  "Nhãn tài trợ": "Sponsored brands",
  "Nhãn tài trợ - Nhãn phổ biến": "Sponsored & popular brands",
  "Nhãn của nhà mình & nhãn phổ biến": "Our brands & popular brands",
  "Tài trợ": "Sponsored",
  "Phổ biến": "Popular",
  "Mua sắm · nhà đất · dịch vụ": "Shopping · real estate · services",
  "Cuộn về trước": "Scroll back",
  "Cuộn tiếp": "Scroll forward",
  "Mở trang dịch vụ bên ngoài": "Opens an external service page",
  "Gợi ý:": "Suggested:",

  // (Tên section lấy từ Google Sheet; section "Đồ ăn" đổi theo buổi ăn cũng lấy từ sheet — đã có sẵn cột EN.)

  // Bottom sections (Worldcup, túi ghép, hè đẹp khoẻ, hàng thiết yếu…)
  "Mùa Worldcup": "Worldcup Season",
  "Túi ghép - đôi - đa dạng": "Bundle bags · pairs · variety",
  "Hàng thiết yếu": "Essentials",
  "Hè - Đẹp - Khoẻ (Hóa mỹ phẩm nam, nữ, túi)": "Summer · Beauty · Health (cosmetics for men, women, bags)",
  "Hè-Đẹp-Khỏe (Hóa mỹ phẩm nam, nữ, túi)": "Summer · Beauty · Health (cosmetics for men, women, bags)",

  // Jewelry categories (PNJ & similar stores)
  "Bông tai": "Earrings",
  "Charm": "Charm",
  "Dây chuyền": "Necklace",
  "Lắc tay": "Bracelet",
  "Nhẫn": "Ring",
  "Mặt dây": "Pendant",
  "Vòng tay": "Bangle",
  "Dây cổ": "Chain necklace",
  "Trang sức nam": "Men's jewelry",
  "Trang sức nữ": "Women's jewelry",
  "Bộ trang sức": "Jewelry set",
  "Phụ kiện": "Accessories",
  "Đồng hồ": "Watch",
  "Hoa tai": "Earrings",

  // Category names (from catalog data — translate the most common ones)
  "Đồ ăn": "Food",
  "Đồ uống": "Drinks",
  "Chăm sóc cá nhân": "Personal care",
  "Nhà cửa & vệ sinh": "Home & cleaning",
  "Trang sức": "Jewelry",
  "Giỏ tạp hóa": "Grocery basket",
  "Sữa": "Milk",
  "Gia vị - Dầu ăn": "Spices & cooking oil",
  "Mẹ & Bé": "Mom & Baby",
  "Hóa phẩm": "Household chemicals",
  "Gạo - Mì": "Rice & Noodles",
  "Trứng - Thịt": "Eggs & Meat",
  "Bánh kẹo": "Snacks & Candy",
  "Khác": "Other",
  "Bán tại": "Sold at",
  "Cửa hàng": "Store",
  "Nhãn hàng": "Brand",
  "Xem tất cả →": "See all →",
  "Quay lại trang chủ": "Back to home",
  "Quay lại trang chính": "Back to main page",
  "Quay lại": "Back",

  // Quick filters
  "Deal hời": "Best deals",
  "Giá hời": "Great price",
  "Bán chạy khu vực": "Popular nearby",
  "Bán chạy": "Best seller",

  // Radius
  "Bán kính": "Radius",
  "Tất cả": "All",
  "Hiện tất cả cửa hàng, không giới hạn bán kính": "Show all stores, no radius limit",
  "Bỏ giới hạn": "Clear limit",
  "Bỏ giới hạn bán kính": "Clear radius limit",

  // Data source notice
  "Nguồn dữ liệu:": "Data source:",
  "data mẫu": "sample data",
  "· không đọc được sheet, đang dùng tạm dữ liệu mẫu.":
    "· couldn't read the sheet, using sample data for now.",

  // Product list
  "Kết quả": "Results",
  "Sản phẩm phổ biến": "Popular products",
  "{n} sản phẩm": "{n} products",
  "Có {n} nơi bán": "{n} stores selling",
  "{n} chi nhánh khác": "{n} more branches",
  "Ẩn bớt": "Show less",
  "Hết hàng": "Out of stock",
  "Chưa có giá": "No price yet",
  "So sánh giá": "Compare prices",
  "Vào mua": "Buy now",
  "Ảnh: {src}": "Photo: {src}",
  "Cần vị trí để xem sản phẩm bán chạy quanh bạn.":
    "Location needed to see best sellers around you.",
  "Bật vị trí": "Turn on location",
  "Chưa có sản phẩm bán chạy trong khu vực {r} km quanh bạn.":
    "No best sellers within {r} km around you yet.",
  "Không tìm thấy sản phẩm phù hợp.": "No matching products found.",
  "← Trước": "← Prev",
  "Sau →": "Next →",
  "Trang {page}/{total}": "Page {page}/{total}",

  // Reco tags
  "Deal -{x}%": "Deal -{x}%",

  // Detail view
  "← Tất cả kết quả": "← All results",
  "{n} cửa hàng": "{n} stores",
  "Ảnh minh hoạ": "Illustrative photo",
  "thuộc về chủ sở hữu.": "belongs to its owner.",
  "nguồn: {src}": "source: {src}",
  "Đã đăng ký": "Subscribed",
  "Sửa số điện thoại": "Edit phone number",
  "Huỷ đăng ký": "Unsubscribe",
  "Báo khi giảm giá": "Notify on price drop",
  "Báo giá giảm": "Price-drop alert",
  "Chọn vị trí (định vị hoặc nhập địa chỉ) để xem khoảng cách tới từng cửa hàng và lọc theo bán kính.":
    "Choose a location (GPS or address) to see the distance to each store and filter by radius.",
  "Rẻ hơn {amount} nếu mua ở {store}": "Save {amount} if you buy at {store}",
  "Sửa số nhận báo giá cho {name}": "Edit alert number for {name}",
  "Để lại SĐT/Zalo, {name} giảm giá là mình báo ngay":
    "Leave your phone/Zalo and we'll alert you when {name} drops in price",
  "Số điện thoại / Zalo": "Phone / Zalo",
  "Lưu thay đổi": "Save changes",
  "Đăng ký": "Subscribe",
  "Sản phẩm này chưa có nhiều nơi bán để so sánh giá.":
    "This product isn't sold at enough stores to compare prices.",
  "Không có cửa hàng nào trong bán kính {r} km.": "No stores within {r} km.",
  "Sắp xếp theo": "Sort by",
  "Giá rẻ": "Lowest price",
  "Bật vị trí để sắp theo khoảng cách": "Turn on location to sort by distance",
  "Gần nhất": "Nearest",
  "Rẻ nhất": "Cheapest",
  "Còn hàng": "In stock",
  "cách bạn {km} km": "{km} km away",
  "Mua tối thiểu {x}": "Min order {x}",
  "Đắt hơn {amount}": "{amount} more",
  "Mua": "Buy",
  "Chỉ đường": "Directions",
  "Sản phẩm tương tự": "Similar products",

  // Map
  "Đang lấy địa chỉ…": "Getting address…",
  "RẺ NHẤT": "CHEAPEST",
  "Cửa hàng (theo màu):": "Stores (by color):",
  "Nơi bán giá thấp nhất": "Lowest-price store",

  // Map toggle / footer
  "Bản đồ": "Map",
  "Thu gọn": "Collapse",
  "Xem bản đồ quanh đây": "View map nearby",
  "Danh sách": "List",
  "Lên đầu trang": "Back to top",
  "sản phẩm của": "a product of",
  "Giá & thông tin được tổng hợp từ nguồn công khai, có thể thay đổi theo thời gian. Hình ảnh, logo và thương hiệu thuộc về chủ sở hữu tương ứng; Affree là dịch vụ so sánh giá & điều hướng mua hàng. Yêu cầu gỡ nội dung: liên hệ One Solution.":
    "Prices & info are aggregated from public sources and may change over time. Images, logos and brands belong to their respective owners; Affree is a price-comparison and shopping-navigation service. Content takedown requests: contact One Solution.",

  // Buy form
  "Sản phẩm chưa có nhiều nơi bán để so sánh. Điền thông tin, shop sẽ liên hệ và giao tận nơi.":
    "This product isn't widely sold yet for comparison. Fill in your details and the shop will contact you and deliver.",
  "Họ tên người nhận *": "Recipient name *",
  "Số điện thoại / Zalo *": "Phone / Zalo *",
  "Địa chỉ giao hàng": "Delivery address",
  "Số lượng": "Quantity",
  "Ghi chú (tuỳ chọn): màu sắc, kích cỡ, thời gian nhận…":
    "Note (optional): color, size, preferred time…",
  "Đang gửi…": "Sending…",
  "Gửi yêu cầu mua": "Send order request",

  // Toasts
  "Trình duyệt không hỗ trợ định vị. Hãy nhập địa chỉ.":
    "Your browser doesn't support geolocation. Please enter an address.",
  "Đã cập nhật vị trí hiện tại": "Current location updated",
  "Trình duyệt đang chặn quyền vị trí. Mở khoá định vị cho trang hoặc nhập địa chỉ bên dưới.":
    "Your browser is blocking location. Unblock location for this site or enter an address below.",
  "Không lấy được vị trí GPS. Hãy thử lại hoặc nhập địa chỉ.":
    "Couldn't get GPS location. Try again or enter an address.",
  "Đang xem giá quanh: {area}": "Viewing prices around: {area}",
  "Vị trí hiện tại": "Current location",
  "Vị trí đã lưu": "Saved location",
  "Đã ghi nhận mua {product} tại {store}": "Recorded purchase of {product} at {store}",
  "Vui lòng nhập họ tên người nhận": "Please enter the recipient's name",
  "Vui lòng nhập số điện thoại / Zalo hợp lệ": "Please enter a valid phone / Zalo number",
  "Đã gửi yêu cầu mua {product} — shop sẽ liên hệ bạn sớm.":
    "Order request for {product} sent — the shop will contact you soon.",
  "Vui lòng nhập số điện thoại/Zalo hợp lệ": "Please enter a valid phone/Zalo number",
  "Đã đăng ký báo giá cho {product}": "Price alert set for {product}",
  "Đã huỷ đăng ký báo giá": "Price alert canceled",
  "Đang xem: {label}": "Viewing: {label}",
  "Mở {label} (trang dịch vụ bên ngoài)": "Opening {label} (external service page)",
  "{label} — sắp ra mắt": "{label} — coming soon",
  "Đã đặt {product} tại {store} · {code}": "Ordered {product} at {store} · {code}",

  // Category / group tile labels (non-duplicate entries — main set is at "Category names" above)
  "Mỹ phẩm": "Cosmetics",
  "Nhà cửa": "Home",
  "Mẹ & bé": "Mom & baby",
  "Thực phẩm": "Groceries",

  // History page
  "← Trang chính": "← Home",
  "Lịch sử mua hàng": "Purchase history",
  "Xóa hết": "Clear all",
  "Chưa có lượt mua nào. Tìm sản phẩm ở trang chính rồi bấm “Đã mua ở đây”.":
    "No purchases yet. Find a product on the home page and tap “Bought here”.",
  "Tổng chi đã ghi nhận": "Total recorded spending",
  "{n} lượt mua": "{n} purchases",

  // Service link tiles
  "Đi chợ": "Groceries",
  "Cầm đồ": "Pawn",
  "Định giá": "Appraisal",
  "Xây dựng": "Construction",
  "Nhà đất": "Real estate",

  // Order agent modal — header & banner
  "Đã đặt hàng": "Order placed",
  "Phục vụ bởi Agentic AI": "Powered by Agentic AI",
  "Bản mô phỏng — chưa kết nối web thật. Dùng để xem cơ chế trợ lý tự thao tác và dừng lại khi cần bạn.":
    "Simulation — not connected to a real site. It shows how the assistant works on its own and pauses when it needs you.",

  // Order agent modal — form
  "{chain} yêu cầu để đặt món này:": "{chain} requires the following to order this item:",
  "Người nhận": "Recipient",
  "Họ và tên": "Full name",
  "Số điện thoại": "Phone number",
  "VD: 0901234567": "e.g. 0901234567",
  "Số điện thoại không hợp lệ — cần 10 số, bắt đầu bằng 03/05/07/08/09.":
    "Invalid phone number — must be 10 digits starting with 03/05/07/08/09.",
  "VD: (408) 555-0123": "e.g. (408) 555-0123",
  "Số điện thoại không hợp lệ — cần 10 số (Hoa Kỳ).":
    "Invalid phone number — must be a 10-digit US number.",
  "VD: +1 408 555 0123": "e.g. +1 408 555 0123",
  "Số điện thoại không hợp lệ — nhập theo định dạng quốc tế (vd +84…).":
    "Invalid phone number — use international format (e.g. +84…).",
  "Email (đăng nhập tài khoản)": "Email (account login)",
  "Email không hợp lệ.": "Invalid email.",
  "Địa chỉ giao": "Delivery address",
  "Số nhà, đường, phường, quận…": "Street number, street, ward, district…",
  "Địa chỉ giao khác với vị trí định vị của bạn — ":
    "Delivery address differs from your detected location — ",
  "Định vị theo địa chỉ giao — ": "Locating by delivery address — ",
  "đang định vị & tính khoảng cách theo địa chỉ giao…":
    "locating & computing distance by delivery address…",
  "khoảng cách dưới đây tính từ địa chỉ giao, gần nhất xếp trên. Chọn lại nơi mua:":
    "distances below are from the delivery address, nearest first. Pick a store again:",
  "chưa xác định được toạ độ địa chỉ giao (khoảng cách tạm tính từ vị trí cũ). Chọn lại nơi mua:":
    "couldn't resolve the delivery address coordinates (distance estimated from old location). Pick a store again:",
  "Online": "Online",
  "Đang chọn": "Selected",
  "Khung giờ giao": "Delivery time slot",
  "Thanh toán": "Payment",
  "COD (tiền mặt khi nhận)": "COD (cash on delivery)",
  "{chain} hỗ trợ: {payments}. Affree chỉ đặt COD — không thu thập thông tin thẻ.":
    "{chain} supports: {payments}. Affree only places COD orders — no card info collected.",
  "Tạm tính": "Subtotal",
  "Để trợ lý đặt giúp →": "Let the assistant order →",
  "Nhập đủ tên, số điện thoại và địa chỉ để bắt đầu.":
    "Enter your name, phone number and address to start.",

  // Order agent modal — running steps
  "🔐 Trợ lý KHÔNG nhập mật khẩu giúp bạn. Bạn tự đăng nhập rồi bấm tiếp.":
    "🔐 The assistant does NOT enter your password. Log in yourself, then continue.",
  "Tôi đã đăng nhập xong →": "I've logged in →",
  "🔐 Trợ lý không tự đọc được OTP — bạn nhập mã giúp.":
    "🔐 The assistant can't read the OTP — please enter the code.",
  "Đang chờ {chain} gửi mã…": "Waiting for {chain} to send a code…",
  "Tin nhắn mô phỏng từ {chain}": "Simulated message from {chain}",
  "Điền giúp": "Fill in",
  "Nhập mã OTP": "Enter OTP code",
  "Gửi": "Submit",
  "Mã chưa đúng — nhập đúng {otp} (hoặc bấm “Điền giúp”).":
    "Wrong code — enter {otp} (or tap “Fill in”).",
  "🤖 Trợ lý không vượt CAPTCHA. Bạn xác minh giúp (mô phỏng).":
    "🤖 The assistant can't pass CAPTCHA. Please verify (simulated).",
  "Tôi không phải là người máy": "I'm not a robot",
  "✋ Bước cuối không thể hoàn tác — bạn duyệt rồi trợ lý mới đặt.":
    "✋ This final step can't be undone — you approve, then the assistant orders.",
  "Món": "Item",
  "Nơi bán": "Store",
  "Giao tới": "Deliver to",
  "Khung giờ": "Time slot",
  "Tổng": "Total",
  "Xác nhận đặt hàng": "Confirm order",
  "Đặt hàng thành công!": "Order placed!",
  "Trợ lý đã đặt đơn trên {chain}. Mã đơn:": "The assistant placed your order on {chain}. Order code:",
  "Xong": "Done",

  // Order agent modal — delivery slots
  "Trong hôm nay (2–4 giờ)": "Today (2–4 hours)",
  "Tối nay (18:00–21:00)": "Tonight (6:00–9:00 PM)",
  "Sáng mai (8:00–11:00)": "Tomorrow morning (8:00–11:00 AM)",
  "Chiều mai (14:00–17:00)": "Tomorrow afternoon (2:00–5:00 PM)",

  // Order agent modal — step labels
  "Mở website {chain}…": "Opening {chain} website…",
  "Điền số điện thoại {phone} (mua nhanh, không cần đăng nhập)…":
    "Entering phone number {phone} (quick checkout, no login)…",
  "(của bạn)": "(yours)",
  "Nhập số điện thoại {phone}…": "Entering phone number {phone}…",
  "{chain} gửi mã OTP về {phone}": "{chain} sends an OTP code to {phone}",
  "điện thoại của bạn": "your phone",
  "Đăng nhập tài khoản {chain}{email}": "Logging into {chain} account{email}",
  "email của bạn": "your email",
  'Thêm "{name}" vào giỏ (SL {qty})…': 'Adding "{name}" to cart (qty {qty})…',
  "Chọn điểm giao: {store}…": "Selecting pickup point: {store}…",
  "Điền địa chỉ giao: {address}…": "Entering delivery address: {address}…",
  "(địa chỉ của bạn)": "(your address)",
  "Điền email nhận hoá đơn: {email}…": "Entering invoice email: {email}…",
  "(email của bạn)": "(your email)",
  'Chọn khung giờ "{slot}"…': 'Selecting time slot "{slot}"…',
  "Chọn thanh toán COD…": "Selecting COD payment…",
  '{chain} yêu cầu xác minh "Tôi không phải robot"':
    '{chain} requires "I\'m not a robot" verification',
  "Kiểm tra & xác nhận đơn hàng": "Review & confirm order",
  "Đang gửi đơn tới {chain}…": "Submitting order to {chain}…",
  "Đặt hàng thành công": "Order placed successfully",

  // Order config — requirements & notes
  "Đăng nhập tài khoản": "Account login",
  "Đặt qua tài khoản trên website/app của nguồn này.":
    "Order via your account on this store's website/app.",
  "Số điện thoại (xác minh OTP)": "Phone number (OTP verification)",
  "Số điện thoại (mua nhanh, không cần đăng nhập)": "Phone number (quick checkout, no login)",
  "Số điện thoại (đăng nhập OTP)": "Phone number (OTP login)",
  "Freeship đơn từ 200.000đ trong bán kính 6km.":
    "Free shipping on orders from 200,000₫ within 6 km.",
  "Đăng nhập tài khoản (email)": "Account login (email)",
  "AEON eShop yêu cầu đăng nhập tài khoản (email).":
    "AEON eShop requires account login (email).",

  // SiteStats section
  "Affree trong những con số": "Affree by the numbers",
  "Thống kê Affree": "Affree stats",
  "Số liệu Affree": "Affree stats",
  "Lượt truy cập": "Visits",
  "Đơn đã tạo": "Orders placed",
  "Lượt thêm giỏ": "Cart adds",
  "Sản phẩm so giá": "Products compared",
  "Điểm bán quanh bạn": "Nearby stores",
  "Nhãn hiệu": "Brands",
  "Số liệu cập nhật liên tục": "Live data",

  // Bulk additions — chrome strings còn thiếu (mua/giỏ/phiên bản/liên hệ/túi…)
  "Mua ngay": "Buy now",
  "Mua cả túi": "Buy the bundle",
  "Thêm cả túi vào giỏ": "Add bundle to cart",
  // Màn agentic đặt cả túi (TuiAgentModal)
  "món": "items",
  "chuyên trang": "storefronts",
  "Đã đặt cả túi": "Bundle ordered",
  "Bản mô phỏng — chưa kết nối web thật. Trợ lý đặt cả túi trên nhiều chuyên trang.": "Simulation — not connected to real sites. The assistant orders the whole bundle across multiple storefronts.",
  "Đặt {n} món trên {source}…": "Ordering {n} item(s) on {source}…",
  "Điền thông tin giao hàng…": "Filling in delivery details…",
  "Xác nhận & gửi đơn (COD)…": "Confirm & place order (COD)…",
  "Túi mua trên {n} chuyên trang → trợ lý đặt lần lượt từng nơi, giao theo từng nguồn.": "This bundle spans {n} storefronts → the assistant orders from each, delivered per source.",
  "Đã đặt cả túi thành công!": "Bundle ordered successfully!",
  "Trợ lý đã đặt {n} món trên {m} chuyên trang. Mã đơn:": "The assistant ordered {n} items across {m} storefronts. Order code:",
  "Tạm tính cả túi": "Bundle subtotal",
  "Để trợ lý đặt cả túi →": "Let the assistant order the bundle →",
  "Đã đặt cả túi {tui}": "Ordered bundle {tui}",
  // Khúc Chạm Plaza — trang chi tiết album + card bài hát
  "Bài hát": "Song",
  "Bài hát trong album": "Songs in album",
  "Danh sách bài hát": "Track list",
  // Form đặt mua nhạc (MusicOrderModal)
  "Đặt mua nhạc · Khúc Chạm Plaza": "Order music · Khúc Chạm Plaza",
  "Đã đặt mua": "Order placed",
  "Nhạc bản quyền — sản phẩm số": "Licensed music — digital product",
  "Email (nhận link nhạc)": "Email (to receive the music link)",
  "Ghi chú (tuỳ chọn)": "Note (optional)",
  "Lời nhắn cho Khúc Chạm Plaza…": "Message for Khúc Chạm Plaza…",
  "Sản phẩm số: Khúc Chạm Plaza liên hệ qua SĐT/Zalo hoặc email để gửi link nhạc bản quyền sau khi đặt.": "Digital product: Khúc Chạm Plaza will contact you via phone/Zalo or email to send the licensed music link after you order.",
  "Đã đặt mua nhạc!": "Music ordered!",
  "Mã đơn:": "Order code:",
  "Đặt mua": "Place order",
  "Nhập tên và SĐT/Zalo hoặc email để đặt.": "Enter your name and phone/Zalo or email to order.",
  "Đã đặt mua nhạc · {n} mục": "Ordered music · {n} item(s)",
  "Mua cả album": "Buy album",
  "Mua theo bài": "Buy by song",
  "Thêm album vào giỏ": "Add album to cart",
  "Thêm bài vào giỏ": "Add song to cart",
  "Thêm vào giỏ": "Add to cart",
  "Giỏ hàng": "Cart",
  "Đặt hàng tất cả": "Order all",
  "Tổng cộng": "Total",
  "{n} món": "{n} items",
  "{n} túi": "{n} bundles",
  "Sản phẩm": "Product",
  "sản phẩm": "products",
  "cửa hàng": "stores",
  "So sánh": "Compare",
  "Tiết kiệm {x}": "Save {x}",
  "-{x}%": "-{x}%",
  "Chênh {amount}": "Difference {amount}",
  "Giá hời quanh đây": "Great deals nearby",
  "Giá hời liên quan": "Related great deals",
  "Tìm kiếm": "Search",
  "so giá nhiều nơi · bật vị trí để ưu tiên gần bạn":
    "compare prices across stores · turn on location to prioritise nearby",
  "Khu vực": "Area",
  "Không có sản phẩm.": "No products.",
  "Cửa hàng gần bạn nhất": "Stores nearest to you",
  "Cửa hàng (bấm để bật/tắt):": "Stores (tap to toggle):",
  "Thu gọn bản đồ": "Collapse map",
  "Về vị trí của tôi": "Back to my location",
  "Chú thích": "Legend",
  "Hiện chú thích": "Show legend",
  "Ẩn chú thích": "Hide legend",
  "Bật hiển thị {label}": "Show {label}",
  "Ẩn {label}": "Hide {label}",
  "GẦN NHẤT": "NEAREST",
  "Chưa có giá hời nào trong {r}": "No great deals within {r}",

  // Túi
  "Túi ghép": "Bundle bag",
  "Túi đôi": "Pair bag",
  "Túi đa dạng": "Variety bag",
  "Xem chi tiết sản phẩm trong túi": "View bundle contents",
  "Đã thêm {n}/{m} món của túi (vài món chưa có trong kho)":
    "Added {n}/{m} items from bundle (some not in stock)",

  // Product info / mô tả
  "Thông tin sản phẩm": "Product information",
  "Thông tin chung": "General info",
  "Mô tả": "Description",
  "Chưa có mô tả cho sản phẩm này.": "No description for this product yet.",
  "Chứng nhận": "Certifications",
  "Chứng nhận {n}": "{n} certifications",
  "Xem thông tin & chứng nhận": "View info & certifications",
  "Xem ảnh lớn": "View larger image",

  // Phiên bản modal
  "Phiên bản": "Version",
  "Phiên bản & tính năng sắp tới": "Version & upcoming features",
  "Phiên bản trước": "Previous versions",
  "Có gì trong bản {v}": "What's in version {v}",
  "Mới": "New",
  "Cũ": "Old",
  "Sắp ra mắt": "Coming soon",
  "Các tính năng đang được phát triển": "Features in development",
  "Xem chi tiết": "View details",

  // Order agent / form mua hàng
  "Phục vụ bởi Affree Agentic AI - AAAI": "Powered by Affree Agentic AI - AAAI",
  "Điền thông tin nhận hàng, shop sẽ liên hệ xác nhận và giao tận nơi.":
    "Fill in delivery info — the shop will confirm and deliver.",
  "Bạn sẽ chọn siêu thị giao hàng khi thanh toán trên web cửa hàng":
    "You'll choose the delivery supermarket when paying on the store website",
  "Cần xác minh OTP qua SĐT khi thanh toán": "OTP verification by phone required at checkout",
  "Cần đăng nhập tài khoản khi thanh toán": "Account login required at checkout",
  "Đã ghi nhận đơn hàng!": "Order received!",
  "Họ tên": "Full name",
  "Nguyễn Văn A": "John Doe",
  "Email": "Email",
  "Email tài khoản": "Account email",
  "Email không hợp lệ": "Invalid email",
  "SĐT / Zalo": "Phone / Zalo",
  "Zalo": "Zalo",
  "Gọi": "Call",
  "Nhắn Zalo": "Message on Zalo",
  "Vd: 09xxxxxxxx": "e.g. 09xxxxxxxx",
  "Vd: Nguyễn Văn A": "e.g. John Doe",
  "Vd: TP HCM, Q1 (tự điền từ định vị)": "e.g. San Jose, CA (auto-filled from location)",
  "Vd: ten@congty.com": "e.g. you@company.com",
  "Vd: báo lỗi giá, hợp tác sự kiện, đề xuất tính năng…":
    "e.g. price error, event partnership, feature suggestion…",
  "Vd: lấy sỉ 500kg gạo/tháng, cần báo giá kho bãi…":
    "e.g. bulk 500kg rice/month, need warehouse quote…",
  "Vd: muốn đăng sản phẩm mới lên Affree, làm nhãn tài trợ…":
    "e.g. want to list a new product on Affree, become a sponsor…",
  "Vd: tư vấn so giá sữa cho quán cà phê, ngân sách 3tr/tháng…":
    "e.g. milk price advisory for a café, budget 3M/month…",
  "Tôi đồng ý Affree liên hệ lại qua SĐT/Zalo đã cung cấp.":
    "I agree Affree may contact me via the phone/Zalo I provided.",
  "Vui lòng nhập họ tên (≥ 2 ký tự)": "Please enter your full name (≥ 2 chars)",
  "Vui lòng tick đồng ý liên hệ qua SĐT": "Please tick the consent to be contacted by phone",
  "Vui lòng điền SĐT và địa chỉ giao hàng": "Please fill in phone and delivery address",
  "Số chưa đúng định dạng — bắt đầu bằng 03/05/07/08/09, đủ 10 số":
    "Invalid number — must start with 03/05/07/08/09 and have 10 digits",
  "Số điện thoại không hợp lệ — dùng định dạng 09/03/05/07/08":
    "Invalid phone — use format 09/03/05/07/08",

  // Liên hệ
  "Liên hệ Affree": "Contact Affree",
  "Bạn cần Affree hỗ trợ gì?": "How can Affree help?",
  "Tư vấn mua sắm": "Shopping advice",
  "Hợp tác bán hàng": "Sales partnership",
  "Phân phối / B2B": "Distribution / B2B",
  "Nội dung cụ thể": "Specific content",
  "Gửi liên hệ": "Send",
  "Để lại liên hệ — phản hồi trong 24h": "Leave contact — reply within 24h",
  "Đã ghi nhận — đội Affree sẽ liên hệ sớm. Cảm ơn bạn!":
    "Received — the Affree team will reach out soon. Thank you!",
  "Cảm ơn bạn đã dùng Affree 💚": "Thank you for using Affree 💚",
  "Thành công": "Success",
  "Lỗi, thử lại sau": "Error, try again later",
  "Khu vực mới — chưa có sản phẩm. Thêm sản phẩm vào danh mục này từ sheet là sẽ tự xuất hiện.":
    "New area — no products yet. Add products to this category from the sheet and they'll appear here.",

  // Units (đơn vị tính của product.unit — từ catalog)
  "Cặp": "Pair",
  "Đôi": "Pair",
  "Chiếc": "Piece",
  "Cái": "Piece",
  "Cây": "Stick",
  "Chai": "Bottle",
  "Lon": "Can",
  "Hộp": "Box",
  "Gói": "Pack",
  "Bịch": "Bag",
  "Túi": "Bag",
  "Bộ": "Set",
  "Lốc": "Multipack",
  "Vỉ": "Blister pack",
  "Tuýp": "Tube",
  "Thùng": "Carton",
  "Can": "Jug",
  "Ly": "Cup",
  "Phần": "Serving",
  "Trái": "Piece",
  "Cam": "Orange",
  "Kg": "kg",
  "Trắng": "White",
  "Đen": "Black",
  "Chai 1.5L": "1.5L bottle",
  "Chai 1L": "1L bottle",
  "Chai 455ml": "455ml bottle",
  "Chai 725-750g": "725-750g bottle",
  "Chai 900ml": "900ml bottle",
  "Gói 454g": "454g pack",
  "Gói 75g": "75g pack",
  "Gói 80g": "80g pack",
  "Gói 900g": "900g pack",
  "Hộp 1L": "1L box",
  "Hộp 21 gói": "21-pack box",
  "Lon 380g": "380g can",
  "Lốc 5 x 65ml": "Multipack 5 x 65ml",
  "Túi 1kg": "1kg bag",
  "Túi 2.8kg": "2.8kg bag",
};

function interpolate(s: string, vars?: Record<string, string | number>): string {
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

/** Dịch 1 chuỗi VN sang `lang`. lang=vi → giữ nguyên; en → tra EN_DICT, thiếu thì giữ VN. */
export function tr(lang: Lang, vi: string, vars?: Record<string, string | number>): string {
  const base = lang === "en" ? EN_DICT[vi] ?? vi : vi;
  return interpolate(base, vars);
}
