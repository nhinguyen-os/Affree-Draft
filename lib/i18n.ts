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
  "Mua sắm · nhà đất · dịch vụ": "Shopping · real estate · services",
  "Cuộn về trước": "Scroll back",
  "Cuộn tiếp": "Scroll forward",
  "Mở trang dịch vụ bên ngoài": "Opens an external service page",
  "Gợi ý:": "Suggested:",

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

  // Category / group tile labels
  "Đồ ăn": "Food",
  "Mỹ phẩm": "Cosmetics",
  "Nhà cửa": "Home",
  "Sữa": "Milk",
  "Đồ uống": "Drinks",
  "Trang sức": "Jewelry",
  "Mẹ & bé": "Mom & baby",
  "Khác": "Other",
  "Thực phẩm": "Groceries",
  "Chăm sóc cá nhân": "Personal care",
  "Nhà cửa & vệ sinh": "Home & cleaning",

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
