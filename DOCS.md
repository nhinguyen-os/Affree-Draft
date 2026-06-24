# Tài liệu dự án Affree

> Tài liệu mô tả tổng thể dự án **Affree** dành cho Business Analyst (BA), người quản lý sản phẩm và đội vận hành. Mục tiêu: hiểu rõ **hệ thống hoạt động ra sao** và **cách vận hành về mặt thương mại / ứng dụng / áp dụng thực tế**.

- **Tên sản phẩm:** Affree
- **Khẩu hiệu:** *"Kết nối mua bán, không thu phí · Tìm gì cũng có, giá hời quanh đây"*
- **Phiên bản hiện tại:** v1.2 (xem `lib/version.ts`)
- **Công nghệ lõi:** Next.js 16, React 19, TailwindCSS 4, TypeScript; dữ liệu quản lý qua **Google Sheets**; bản đồ MapLibre.

---

## Mục lục

1. [Giới thiệu & Tầm nhìn sản phẩm](#1-giới-thiệu--tầm-nhìn-sản-phẩm)
2. [Mô hình thương mại & giá trị nghiệp vụ](#2-mô-hình-thương-mại--giá-trị-nghiệp-vụ)
3. [Tính năng chính (góc nhìn người dùng)](#3-tính-năng-chính-góc-nhìn-người-dùng)
4. [Hành trình người dùng (User Journeys)](#4-hành-trình-người-dùng-user-journeys)
5. [Kiến trúc tổng thể](#5-kiến-trúc-tổng-thể)
6. [Mô hình dữ liệu](#6-mô-hình-dữ-liệu)
7. [Vận hành dữ liệu qua Google Sheets](#7-vận-hành-dữ-liệu-qua-google-sheets)
8. [Hệ thống cào giá (price scraping)](#8-hệ-thống-cào-giá-price-scraping)
9. [Tích hợp dịch vụ ngoài & bản đồ](#9-tích-hợp-dịch-vụ-ngoài--bản-đồ)
10. [Tổng hợp API nội bộ](#10-tổng-hợp-api-nội-bộ)
11. [Quốc tế hoá & lưu trữ phía trình duyệt](#11-quốc-tế-hoá--lưu-trữ-phía-trình-duyệt)
12. [Cài đặt, chạy & triển khai](#12-cài-đặt-chạy--triển-khai)
13. [Lộ trình phát triển (Roadmap)](#13-lộ-trình-phát-triển-roadmap)
14. [Phụ lục](#14-phụ-lục)

---

## 1. Giới thiệu & Tầm nhìn sản phẩm

> **Quy ước đọc tài liệu:** các mục được gắn nhãn **[Hiện tại]** là những gì đã có trong mã nguồn của bản v1.2; nhãn **[Tầm nhìn]** là định hướng sản phẩm/chiến lược chưa hoàn thiện trong code nhưng đã được thiết kế để hướng tới. BA cần phân biệt rõ hai nhóm này khi lập kế hoạch.

### 1.1 Affree là gì?
Affree là nền tảng **so sánh giá và kết nối mua bán "không thu phí"**. Ở dạng đơn giản nhất, người dùng cho biết **mình đang ở đâu**, **muốn mua gì**, và Affree trả lời ba câu hỏi mà người mua luôn quan tâm:

1. **Ai đang bán món này quanh tôi?** (nguồn bán: chuỗi siêu thị, cửa hàng, sàn online)
2. **Ở đâu rẻ nhất / gần nhất / còn hàng?** (giá, khoảng cách, tồn kho)
3. **Làm sao mua nhanh nhất?** (chỉ đường tới cửa hàng, mở web nguồn bán, hoặc **để AI đặt hộ**)

Tên gọi **Affree** mang thông điệp cốt lõi: *"All + Free"* — **tìm gì cũng có** (mọi nhu cầu) và **miễn phí cho người mua**. Khẩu hiệu sản phẩm: *"Kết nối mua bán, không thu phí · Tìm gì cũng có, giá hời quanh đây."*

### 1.2 Bài toán & cơ hội
Người tiêu dùng hôm nay đối mặt với một thị trường **phân mảnh**:

- Cùng một sản phẩm có giá khác nhau giữa các chuỗi (BHX, Co.opmart, Con Cưng, AEON…), lại thay đổi liên tục theo khuyến mãi.
- Thông tin **còn hàng / hết hàng** và **khoảng cách** nằm rải rác ở từng app/website riêng — người mua phải mở nhiều ứng dụng để so sánh.
- Mỗi nguồn bán có **quy trình đặt hàng riêng** (đăng nhập, OTP, chọn siêu thị, khung giờ giao, CAPTCHA…), gây mệt mỏi và bỏ giỏ giữa chừng.
- Với **người Việt ở nước ngoài** (Mỹ, Canada) hoặc người muốn **mua hộ/gửi quà về cho gia đình**, việc đặt hàng xuyên biên giới còn phức tạp hơn nhiều: khác ngôn ngữ, khác tiền tệ, khác cổng thanh toán.

Affree gom toàn bộ sự phân mảnh đó về **một giao diện duy nhất**: so sánh tập trung, xếp hạng theo "rẻ + gần + còn hàng", và — quan trọng nhất ở tầm nhìn dài hạn — **một lớp AI đặt hàng** lo phần quy trình rắc rối của từng nguồn.

### 1.3 Tầm nhìn sản phẩm (North Star)

> **Tầm nhìn:** *"Bất kỳ ai, ở bất kỳ đâu, muốn mua bất kỳ thứ gì — chỉ cần nói ra, Affree tìm nơi tốt nhất và mua hộ."*

Affree không định vị mình là một sàn TMĐT thứ N (không ôm kho, không xử lý thanh toán của nguồn bán). Affree là **lớp kết nối + trí tuệ mua sắm** nằm **phía trên** tất cả các nguồn bán hiện có. Ba trụ cột của tầm nhìn:

| Trụ cột | Nội dung | Trạng thái |
|---|---|---|
| **Universal catalog** — gom mọi cửa hàng | Kết nối tới **tất cả cửa hàng** (vật lý + online) ở Việt Nam, rồi mở rộng sang **Mỹ và Canada** trong tương lai gần. Mỗi nguồn bán chỉ cần một cấu hình là vào hệ thống. | [Tầm nhìn] — kiến trúc đã sẵn sàng (xem 1.4, 2.4) |
| **Agentic AI ordering** — AI mua hộ | AI đại diện người mua **thực hiện trọn quy trình đặt hàng** trên nhiều nguồn khác nhau, trong nước lẫn quốc tế, vượt qua các bước đăng nhập/OTP/khung giờ thay cho người dùng. | [Tầm nhìn] — đã có bản **mô phỏng** (`OrderAgentModal`) làm nền (xem 3.4) |
| **Cross-border commerce** — mua bán xuyên biên giới | Một người ở Mỹ/Canada có thể đặt hàng từ cửa hàng Việt Nam (hoặc ngược lại); đa ngôn ngữ, đa tiền tệ, đa địa chỉ giao. | [Tầm nhìn] — đã có nền đa tiền tệ + địa chỉ nước ngoài (xem 3.6) |

### 1.4 Lộ trình hiện thực hoá tầm nhìn (theo giai đoạn)

| Giai đoạn | Phạm vi | Mô tả |
|---|---|---|
| **Now — [Hiện tại]** | TP.HCM, vài chuỗi tiêu biểu | So sánh giá thật quanh khu vực; bản đồ + chỉ đường; trợ lý đặt hàng mô phỏng; đa tiền tệ & địa chỉ nước ngoài đã chạy. |
| **Near-term — [Tầm nhìn gần]** | **Toàn bộ cửa hàng tại Việt Nam** | Mở rộng độ phủ nguồn bán nhờ mô hình "thêm nguồn bằng cấu hình Sheet"; chuẩn hoá tab `stores`; bổ sung nguồn online & cửa hàng theo từng thành phố. |
| **Expansion — [Tầm nhìn]** | **Mỹ & Canada** | Kết nối cửa hàng tại Mỹ/Canada (đã có ví dụ `astrabean` ở San Jose, USD); kích hoạt mua xuyên biên giới cho cộng đồng người Việt và người tiêu dùng bản địa. |
| **Agentic — [Tầm nhìn]** | Mọi nguồn, mọi nơi | AI đặt hàng tự động end-to-end trên nhiều nguồn cùng lúc, trong & ngoài nước. |

### 1.5 Định vị "không thu phí"
Affree **không thu phí của người mua**. Đây là cam kết định vị, không phải khuyến mãi tạm thời:

- Người mua dùng **miễn phí** toàn bộ tính năng so sánh, bản đồ, đặt hàng.
- Affree **không thay thế** nguồn bán: thanh toán, giao hàng, bảo hành vẫn do nguồn bán thực hiện. Affree là **người môi giới thông minh + trợ lý mua sắm**.
- Doanh thu đến từ **phía cung** (nguồn bán, thương hiệu, đối tác) và **lớp giá trị gia tăng** (xem Phần 2), không lấy từ túi người mua.

### 1.6 Đối tượng người dùng

| Phân khúc | Mô tả | Giá trị cốt lõi Affree mang lại |
|---|---|---|
| **Người nội trợ / mua hàng ngày tại VN** | Mua nhu yếu phẩm, thực phẩm, đồ gia dụng quanh nhà. | Tiết kiệm tiền + thời gian, mua nhanh. |
| **Người bận rộn / ngại quy trình** | Ngại đăng nhập/OTP/đặt hàng thủ công ở nhiều app. | **AI đặt hộ** trên nhiều nguồn. |
| **Người Việt ở nước ngoài (Mỹ, Canada)** | Muốn mua hàng Việt, hoặc **mua hộ/gửi về** cho gia đình ở VN. | Mua xuyên biên giới, đa tiền tệ, đa ngôn ngữ. |
| **Người tiêu dùng bản địa Mỹ/Canada** | [Tầm nhìn] dùng Affree như công cụ so sánh + đặt hộ tại thị trường của họ. | So sánh + agentic ordering nội địa. |
| **Nguồn bán & thương hiệu** | Chuỗi siêu thị, cửa hàng, sàn, nhà tài trợ. | Thêm khách, ưu tiên hiển thị, kênh bán mới. |

---

## 2. Mô hình thương mại & giá trị nghiệp vụ

### 2.1 Vị trí của Affree trong chuỗi giá trị
Affree đứng **giữa người mua và nhiều nguồn bán**, đóng vai trò **lớp tổng hợp + định tuyến + trợ lý mua**. Affree **không** ôm tồn kho, **không** xử lý dòng tiền của nguồn bán, **không** chịu trách nhiệm giao hàng — đây là điểm khiến mô hình **nhẹ vốn, dễ mở rộng** (asset-light):

```
        Người mua  ──hỏi "mua X quanh đây"──►  AFFREE  ──định tuyến──►  Nguồn bán
        (miễn phí)                            (lớp kết nối + AI)        (siêu thị / cửa hàng / sàn,
                                                                         trong nước & quốc tế)
              ▲                                    │
              └────────── giá / vị trí / đặt hộ ───┘
```

Vì không gánh kho và thanh toán của nguồn bán, **chi phí thêm một nguồn bán mới gần như bằng 0** (chỉ là cấu hình dữ liệu — xem 2.4). Đây là nền tảng để hiện thực hoá tầm nhìn "gom mọi cửa hàng VN → US → Canada".

### 2.2 Ba dòng giá trị → ba hướng doanh thu

Affree miễn phí với người mua, nên doanh thu đến từ **phía cung và lớp giá trị gia tăng**. Có thể chia thành 3 tầng theo mức độ trưởng thành:

| Tầng | Hướng doanh thu | Trạng thái | Cơ chế trong sản phẩm |
|---|---|---|---|
| **Tầng 1 — Hiển thị** | **Ưu tiên hiển thị** (nguồn bán/đối tác trả phí để được xếp lên trước) + **Nhãn tài trợ** (thương hiệu trả phí hiện logo/branding). | **[Hiện tại]** — đã có cơ chế | Tab `ưu tiên hiển thị` & tab `Nhãn tài trợ` (xem 2.3) |
| **Tầng 2 — Lead & dữ liệu** | **Thu lead** (SĐT/Zalo người quan tâm qua "báo giảm giá"); **dữ liệu hành vi** (lượt xem, lượt mua, sản phẩm bán chạy theo khu vực) bán dưới dạng insight cho nguồn bán/thương hiệu. | **[Hiện tại]** — đã thu `alerts`, `purchases`, view counts | Tab `alerts`, `purchases`; `lib/recent.ts` |
| **Tầng 3 — Giao dịch (Agentic)** | **Hoa hồng giới thiệu / phí dịch vụ đặt hộ** trên mỗi đơn AI hoàn tất; phí mua xuyên biên giới. Đây là động cơ doanh thu lớn nhất ở tầm nhìn dài hạn. | **[Tầm nhìn]** — đang ở dạng mô phỏng | `OrderAgentModal`, `lib/orderConfig.ts` (xem 3.4) |

> **Điểm mấu chốt cho BA:** doanh thu hiện tại nằm ở Tầng 1–2 (hiển thị + lead/dữ liệu); **giá trị doanh nghiệp dài hạn nằm ở Tầng 3** — khi AI đặt hộ trở thành kênh giao dịch thực, mỗi đơn hàng hoàn tất là một điểm doanh thu (hoa hồng/phí dịch vụ), và mô hình chuyển từ "công cụ so sánh" sang "kênh thương mại".

### 2.3 Cơ chế thương mại hoá đã có trong sản phẩm

| Cơ chế | Mô tả nghiệp vụ | Khai báo ở đâu |
|---|---|---|
| **Ưu tiên hiển thị** (Priority) | Sắp thứ tự nguồn bán khi hiển thị giá theo một danh sách chuỗi ưu tiên (ví dụ ưu tiên cửa hàng đối tác lên trước). Áp dụng theo từng nhóm ngành hàng ("tệp") hoặc mặc định toàn trang. | Tab **"ưu tiên hiển thị"** trong Google Sheet |
| **Nhãn tài trợ** (Sponsor) | Dải logo nhà tài trợ/đối tác hiển thị dưới mục "Dịch vụ quanh đây", bấm vào mở link đối tác. | Tab **"Nhãn tài trợ"** trong Google Sheet |
| **Ô dịch vụ / tệp có link** | Một "tệp" có thể trỏ tới **trang dịch vụ ngoài** của đối tác (real estate, xây dựng…) — vị trí quảng bá đối tác. | Tab **"tệp"** (cột `link`) |

→ Cả ba đều **cấu hình hoàn toàn qua Google Sheet**, đội kinh doanh có thể bán & kích hoạt vị trí quảng bá **không cần lập trình viên**.

### 2.4 Mô hình mở rộng nguồn bán — "thêm cửa hàng bằng cấu hình"
Khả năng kết nối tới **tất cả store ở VN, US, Canada** trong tương lai gần đến từ thiết kế dữ liệu:

- Mỗi **nguồn bán** chỉ cần một dòng metadata (`lib/stores.ts → SOURCE_META`: tên, màu, trang chủ, online?, **tiền tệ**).
- Mỗi **cửa hàng vật lý** chỉ cần một dòng trong tab `stores` (toạ độ, địa chỉ, tiền tệ) — **không sửa code**.
- **Giá/tồn kho** được nạp từ bảng sản phẩm và cập nhật tự động bởi hệ thống cào (Phần 8).
- **Quy trình đặt hàng** của một nguồn mới khai báo trong `lib/orderConfig.ts` (cần OTP? email? khung giờ? CAPTCHA?).

→ Hệ quả thương mại: **chi phí biên để phủ thêm một thành phố, một chuỗi, hay một quốc gia là rất thấp** — phù hợp với chiến lược bành trướng độ phủ nhanh (VN toàn quốc → Mỹ → Canada).

### 2.5 Cơ hội mua bán xuyên biên giới (cross-border)
Khi mở rộng sang Mỹ/Canada, Affree mở ra các kịch bản thương mại mà sàn nội địa khó làm:

- **Người Việt ở Mỹ/Canada mua hàng Việt** (đặc sản, quà, sản phẩm thương hiệu Việt) hoặc **mua hộ/gửi về** cho gia đình ở VN.
- **Đặt hàng nội địa nước sở tại** (mua quanh chỗ ở tại San Jose, Toronto…) với cùng trải nghiệm so sánh + AI đặt hộ.
- Nền tảng kỹ thuật đã sẵn: **đa tiền tệ** (₫/$/khác — `storeCurrency`), **đa ngôn ngữ** (VI/EN tự chuyển theo quốc gia), **địa chỉ & bản đồ toàn cầu** (Nominatim/MapLibre), và ví dụ thực tế `astrabean` (cửa hàng PHIN LAB tại San Jose, CA, định giá USD).

→ Đây là khác biệt cạnh tranh: Affree nhắm tới **một lớp mua sắm thông minh không biên giới**, lấy cộng đồng người Việt toàn cầu làm bàn đạp ban đầu.

### 2.6 Các nguồn bán / đối tác đang tích hợp
Khai báo trong `lib/stores.ts` (`SOURCE_META`):

| Mã nguồn | Tên hiển thị | Loại | Tiền tệ |
|---|---|---|---|
| `bhx` | Bách Hóa Xanh | Cửa hàng vật lý + web | VND |
| `concung` | Con Cưng | Cửa hàng vật lý + web | VND |
| `coop` | Co.opmart | Cửa hàng vật lý + web | VND |
| `aeon` | AEON | Cửa hàng vật lý + web | VND |
| `shopee` | Shopee | Online | VND |
| `grab` | GrabMart | Online | VND |
| `pnj` | PNJ | Online | VND |
| `dalathasfarm` | Dalat Hasfarm | Online | VND |
| `ichiban` | Ichiban Market | Online | VND |
| `lotte` | LOTTE Mart | Online | VND |
| `krmart` | Korea Mart | Online | VND |
| `astrabean` | Astrabean (PHIN LAB, San Jose – Mỹ) | Cửa hàng vật lý (US) | **USD** |

> 4 nguồn đầu (BHX, Con Cưng, Co.opmart, AEON) có **cửa hàng vật lý** hiển thị trên bản đồ; các nguồn còn lại là **bán online** (mua qua web/app, không có vị trí bản đồ). `astrabean` là cửa hàng vật lý tại Mỹ, dùng để minh hoạ kịch bản đa quốc gia / đa tiền tệ.

### 2.7 Giá trị cho từng bên

| Bên | Giá trị nhận được |
|---|---|
| **Người mua** | Miễn phí; thấy ngay nơi rẻ nhất/gần nhất/còn hàng; chỉ đường & **để AI đặt hộ** không phải tự xoay xở quy trình; mua được cả hàng trong nước lẫn quốc tế ở một chỗ. |
| **Cửa hàng / chuỗi** | Thêm kênh tiếp cận khách quanh khu vực mà không tốn chi phí tích hợp lớn; tăng lượt ghé/đặt; trả phí để được **ưu tiên hiển thị**; nhận đơn từ AI đặt hộ. |
| **Thương hiệu / nhà tài trợ** | Vị trí **Nhãn tài trợ** & ô dịch vụ; tiếp cận đúng người mua theo ngành hàng/khu vực. |
| **Cộng đồng người Việt ở nước ngoài** | Mua hàng Việt & mua hộ gửi về dễ dàng; trải nghiệm đa ngôn ngữ/đa tiền tệ. |
| **Nền tảng Affree** | Tầng 1–2: doanh thu hiển thị + lead/dữ liệu (đã có). Tầng 3: **hoa hồng/phí trên mỗi đơn AI đặt hộ** (tầm nhìn) — động cơ tăng trưởng chính. |

### 2.8 Hiệu ứng mạng (vì sao càng lớn càng mạnh)
- **Nhiều nguồn bán hơn → so sánh giá trị hơn → nhiều người mua hơn → nguồn bán muốn vào hơn.** Vòng xoáy tăng trưởng kinh điển của nền tảng hai phía.
- **AI đặt hộ học từ mỗi giao dịch:** càng nhiều quy trình đặt hàng được chạy, AI càng thuần thục với từng nguồn → tỷ lệ đặt thành công tăng → rào cản sao chép tăng.
- **Dữ liệu giá & hành vi theo thời gian** trở thành tài sản: bản đồ giá theo khu vực, xu hướng "bán chạy theo phường", độ co giãn giá — phục vụ cả người mua lẫn đối tác.

---

## 3. Tính năng chính (góc nhìn người dùng)

Các tính năng được nhóm thành **6 trụ cột**. Mỗi tính năng gắn nhãn **[Hiện tại]** (đã có trong v1.2 — nguồn `DONE` trong `lib/version.ts`) hoặc **[Tầm nhìn]**.

### 3.1 Trụ cột A — Khám phá & so sánh giá
- **[Hiện tại] So sánh giá nhiều nơi bán quanh bạn** — với mỗi sản phẩm, Affree gom toàn bộ nơi bán và hiển thị **khoảng giá (rẻ nhất → đắt nhất)**, số nơi bán, và đánh dấu **"Rẻ nhất"**.
- **[Hiện tại] Tìm kiếm tức thì** — gõ là ra kết quả (dùng deferred value để không giật), kèm xếp hạng theo độ liên quan.
- **[Hiện tại] Lọc 2 cấp** — theo **Tệp** (nhóm danh mục, ví dụ "Mẹ & bé", "Trang sức") và **Ngành hàng** (category).
- **[Hiện tại] Bộ lọc nhanh** — **"Deal hời"** (chênh lệch giá lớn giữa các nơi bán), **"Giá hời"** (rẻ hơn trung bình nhóm), **"Bán chạy khu vực"**.
- **[Hiện tại] Sản phẩm tương tự** trong màn chi tiết — gợi ý thay thế (cấu hình qua Sheet hoặc tự suy theo ngành hàng).
- **[Hiện tại] Ô dịch vụ ("Dịch vụ quanh đây")** — các tile động cấu hình từ Sheet: ô lọc sản phẩm, link dịch vụ đối tác, hoặc "sắp ra mắt".

### 3.2 Trụ cột B — Vị trí, bản đồ & khoảng cách
- **[Hiện tại] Định vị GPS hoặc nhập địa chỉ** — xác định nơi người dùng đang ở; lưu lại để lần sau không phải nhập lại.
- **[Hiện tại] Khoảng cách tới từng cửa hàng** — mỗi nơi bán hiển thị "cách bạn ~X km".
- **[Hiện tại] Bản đồ tương tác** (MapLibre) — marker theo màu chuỗi, badge "RẺ NHẤT", **vòng bán kính lọc**, popup giá + **chỉ đường** (Google Maps) + **"Vào mua"**, nút recenter.
- **[Hiện tại] Tìm địa chỉ toàn cầu (kể cả nước ngoài)** — bản đồ hiển thị đúng vị trí ở bất kỳ quốc gia nào → nền tảng cho mở rộng US/Canada.

### 3.3 Trụ cột C — Trí tuệ gợi ý & xếp hạng
- **[Hiện tại] Xếp hạng "rẻ + gần + còn hàng"** — tổng hợp giá nhỏ nhất, khoảng cách và tồn kho để đẩy lựa chọn tốt lên đầu.
- **[Hiện tại] "Bán chạy theo khu vực (phường)"** — gợi ý sản phẩm phổ biến theo khu vực người dùng (kết hợp lượt mua/lượt xem + yếu tố theo vùng).
- **[Hiện tại] Tag gợi ý trên thẻ sản phẩm** — "Deal -X%", "Giá hời", "Bán chạy".
- **[Hiện tại] Ưu tiên hiển thị theo chuỗi** — sắp nguồn bán theo hồ sơ ưu tiên (cũng là cơ chế thương mại — Phần 2).

### 3.4 Trụ cột D — ⭐ Hệ thống đặt hàng bằng Agentic AI (tính năng nổi bật nhất)

Đây là tính năng **khác biệt cốt lõi** của Affree và là động cơ doanh thu dài hạn.

**Vấn đề:** mỗi nguồn bán có một quy trình đặt hàng riêng và rắc rối — đăng nhập, xác minh OTP, chọn siêu thị/khu vực giao, chọn khung giờ, giải CAPTCHA, nhập địa chỉ… Người mua thường bỏ cuộc giữa chừng. Với hàng quốc tế, rào cản còn lớn hơn (ngôn ngữ, tiền tệ, cổng thanh toán).

**Giải pháp Affree:** một **AI tác tử (Agentic AI)** đại diện người mua **thực hiện trọn quy trình đặt hàng** — người dùng chỉ cần nói "mua giúp tôi", phần còn lại AI lo.

**[Hiện tại] Đã có trong sản phẩm (bản mô phỏng):**
- Component **`OrderAgentModal`** mô phỏng đầy đủ luồng đặt hàng tự động với cơ chế **pause/resume** (tạm dừng đúng chỗ cần con người, rồi chạy tiếp).
- **`lib/orderConfig.ts`** mã hoá **quy trình thật của từng nguồn** thành cấu hình, nên AI biết mỗi nguồn cần bước gì:

  | Nguồn | Cách xác thực | Cần thêm | Ghi chú |
  |---|---|---|---|
  | **Con Cưng** | Mua nhanh chỉ cần SĐT (guest) | — | Không cần đăng nhập |
  | **Bách Hóa Xanh** | SĐT + OTP | Khung giờ giao | — |
  | **Co.opmart** | SĐT + OTP | Chọn siêu thị + khung giờ | Freeship đơn ≥ 200.000đ trong 6km |
  | **AEON** | Đăng nhập tài khoản (email) | Chọn cửa hàng + khung giờ + CAPTCHA | AEON eShop bắt buộc tài khoản |
  | **Nguồn online khác** | Mặc định đăng nhập tài khoản | CAPTCHA | COD/Thẻ/Ví |

- Các bước cần người dùng (nhập OTP, xác nhận đã đăng nhập, xác nhận đơn) sẽ **tạm dừng** chờ thao tác, rồi AI tiếp tục → trải nghiệm "AI làm hộ, người chỉ chốt".
- Kết thúc sinh **mã đơn** và ghi vào lịch sử mua.

**[Tầm nhìn] Hướng phát triển:**
- Chuyển từ **mô phỏng** sang **thực thi thật** (tự động hoá trình duyệt / tích hợp API nguồn bán) để đặt hàng end-to-end.
- **Mua từ nhiều nguồn cùng lúc**: một yêu cầu của người dùng có thể được AI tách thành nhiều đơn ở nhiều nguồn tối ưu (rẻ nhất cho từng món) và đặt song song.
- **Đặt hàng xuyên biên giới**: AI xử lý khác biệt ngôn ngữ/tiền tệ/cổng thanh toán giữa VN ↔ US ↔ Canada thay cho người dùng.
- **Mỗi đơn AI hoàn tất = một điểm doanh thu** (hoa hồng/phí dịch vụ — Tầng 3, Phần 2).

### 3.5 Trụ cột E — Giỏ hàng đa nguồn & thao tác mua
- **[Hiện tại] Giỏ hàng đa cửa hàng** (`CartModal`) — thêm sản phẩm từ **nhiều nguồn**, hệ thống **gộp theo cửa hàng**, mỗi cửa hàng áp đúng yêu cầu riêng (email/chọn siêu thị/khung giờ), rồi **đặt tất cả một lần**.
- **[Hiện tại] Bộ chọn số lượng** (`QtyInput`) và nút thêm nhanh trên thẻ sản phẩm.
- **[Hiện tại] Hồ sơ người mua tự điền** — tên/SĐT/địa chỉ lưu sẵn, không phải nhập lại mỗi lần.

### 3.6 Trụ cột F — Đa quốc gia, đa tiền tệ, đa ngôn ngữ
- **[Hiện tại] Đa tiền tệ** — giá hiển thị theo **tiền tệ của cửa hàng** (₫ cho VN, $ cho cửa hàng Mỹ); ưu tiên cột `currency` trong tab `stores`, fallback theo nguồn (`storeCurrency` trong `lib/stores.ts`).
- **[Hiện tại] Đa ngôn ngữ VI/EN** — tự chuyển theo quốc gia phát hiện từ địa chỉ (`langForCountry`): VN → tiếng Việt, còn lại → tiếng Anh.
- **[Hiện tại] Địa chỉ & bản đồ toàn cầu** — geocode + bản đồ chạy cho mọi quốc gia; ví dụ cửa hàng `astrabean` tại San Jose (USD).
- **[Tầm nhìn]** — bổ sung thêm ngôn ngữ/tiền tệ, cổng thanh toán địa phương, và độ phủ cửa hàng tại Mỹ/Canada.

### 3.7 Trụ cột G — Gắn kết & quay lại
- **[Hiện tại] Lịch sử mua hàng** (`/history`) — danh sách đơn + tổng chi tiêu.
- **[Hiện tại] Báo khi giảm giá** (price alert) — để lại SĐT/Zalo để nhận thông báo khi sản phẩm giảm; đồng thời là **kênh thu lead** cho nền tảng.
- **[Hiện tại] Sản phẩm đã xem gần đây / lượt xem** — phục vụ gợi ý cá nhân hoá cục bộ.

---

## 4. Hành trình người dùng (User Journeys)

Phần này mô tả các kịch bản sử dụng tiêu biểu. **J1–J4 là [Hiện tại]** (đã chạy trong v1.2). **J5–J6 là [Tầm nhìn]** — minh hoạ trải nghiệm mục tiêu khi agentic AI và cross-border được hoàn thiện.

### J1 — Tìm & so sánh giá rồi tới cửa hàng *(persona: người nội trợ tại TP.HCM)*
1. Mở app → cho phép định vị **hoặc** nhập địa chỉ (popover vị trí).
2. Gõ tên sản phẩm vào ô tìm kiếm (hoặc bấm một Tệp/ngành hàng).
3. Affree hiển thị danh sách sản phẩm, mỗi sản phẩm kèm **khoảng giá (min–max)** và số nơi bán.
4. Bấm vào sản phẩm → màn chi tiết liệt kê **tất cả nơi bán**, sắp theo giá (mặc định) hoặc khoảng cách; gắn tag "Rẻ nhất".
5. Mở **bản đồ** → thấy các cửa hàng, vòng bán kính, cửa hàng rẻ nhất; bấm **"Chỉ đường"** (Google Maps) để ra cửa hàng mua trực tiếp.

### J2 — Để AI đặt hộ một sản phẩm *(persona: người bận rộn, ngại quy trình)*
1. Tại một nơi bán, người dùng bấm **"Để trợ lý đặt giúp"** → mở `OrderAgentModal`.
2. Điền họ tên, SĐT, địa chỉ (tự điền từ hồ sơ đã lưu), số lượng, khung giờ (tuỳ nguồn).
3. **AI chạy quy trình theo đúng cấu hình của nguồn** (`lib/orderConfig.ts`): mở web → đăng nhập/OTP/CAPTCHA (nếu cần) → thêm vào giỏ → xác nhận → "gửi đơn".
4. Ở các bước cần con người (nhập OTP, xác nhận đã đăng nhập, chốt đơn), AI **tạm dừng** chờ người dùng thao tác rồi **tự động chạy tiếp**.
5. Kết thúc: hiển thị **mã đơn** và ghi vào lịch sử.

> Khác biệt giữa các nguồn (xem bảng ở mục 3.4): Con Cưng chỉ cần SĐT; BHX/Co.opmart cần OTP + khung giờ; AEON cần đăng nhập email + CAPTCHA.

### J3 — Đặt hàng qua giỏ hàng đa nguồn *(persona: mua một lượt nhiều món)*
1. Người dùng thêm nhiều sản phẩm (từ **nhiều cửa hàng**) vào giỏ.
2. Mở `CartModal` → các món **gộp theo cửa hàng**; mỗi cửa hàng áp đúng yêu cầu riêng (email, chọn siêu thị, khung giờ).
3. Điền thông tin người nhận → **"Đặt hàng tất cả"** → mỗi nhóm cửa hàng tạo một đơn (`POST /api/purchases`), kết quả từng cửa hàng hiển thị riêng.

### J4 — Đăng ký báo giảm giá *(persona: chờ giá tốt — đồng thời là lead)*
1. Ở màn chi tiết sản phẩm, người dùng để lại **SĐT/Zalo** để "báo khi giảm giá".
2. Hệ thống lưu `PriceAlert` (kèm **giá rẻ nhất tại thời điểm đăng ký** để sau này so sánh) → ghi vào Sheet (tab `alerts`) làm **lead** cho nền tảng.

### J5 — [Tầm nhìn] AI mua hộ từ nhiều nguồn trong một yêu cầu *(persona: "đi chợ" cả tuần)*
1. Người dùng bỏ vào giỏ một danh sách dài (sữa, dầu ăn, tã, gạo…).
2. AI **tự chia đơn theo nguồn tối ưu**: món A rẻ nhất ở Co.opmart, món B ở BHX, món C ở Con Cưng…
3. AI **đặt song song** ở các nguồn, tự vượt OTP/đăng nhập/khung giờ cho từng nơi, gom kết quả về một màn duy nhất.
4. Người dùng chỉ **chốt một lần**; nhận nhiều đơn từ nhiều nguồn. Mỗi đơn hoàn tất phát sinh **hoa hồng/phí dịch vụ** cho Affree.

### J6 — [Tầm nhìn] Mua bán xuyên biên giới *(persona: người Việt ở Mỹ/Canada mua hộ về nhà)*
1. Người dùng ở San Jose mở Affree → giao diện tự sang **tiếng Anh**, giá theo **USD**.
2. Tìm sản phẩm; có thể chọn **giao tại địa chỉ ở Việt Nam** (mua hộ/gửi về cho gia đình) hoặc mua quanh chỗ ở tại Mỹ.
3. AI xử lý khác biệt **ngôn ngữ/tiền tệ/cổng thanh toán** giữa hai thị trường thay cho người dùng và đặt đơn.
4. Người mua theo dõi đơn trong lịch sử; người nhận ở VN nhận hàng. → Affree trở thành **cầu nối thương mại không biên giới** cho cộng đồng người Việt toàn cầu.

---

## 5. Kiến trúc tổng thể

Affree gồm 3 lớp + các dịch vụ ngoài:

```
┌──────────────────────────────────────────────────────────────┐
│  NGƯỜI DÙNG (trình duyệt)                                       │
│  Next.js App (React 19) — app/page.tsx, /admin, /history       │
│  • Tìm kiếm, lọc, xếp hạng, bản đồ, giỏ hàng, trợ lý đặt hàng   │
│  • localStorage: vị trí, hồ sơ, lịch sử, đã xem, báo giá        │
└───────────────┬───────────────────────────────┬───────────────┘
                │ (gọi nội bộ)                   │ (gọi trực tiếp)
                ▼                                 ▼
┌───────────────────────────────┐   ┌────────────────────────────┐
│  API ROUTES (Next.js server)   │   │  DỊCH VỤ NGOÀI               │
│  /api/catalog  /api/stores     │   │  • Nominatim (geocode)       │
│  /api/geocode  /api/poi        │   │  • Overpass (POI)            │
│  /api/purchases /api/buyer     │   │  • OpenFreeMap (tiles bản đồ)│
│  /api/alerts                   │   │  • Google Maps (chỉ đường)   │
│  /api/scrape  /api/scrape-live │   └────────────────────────────┘
└───────────────┬───────────────┘
                │ (đọc CSV / gọi Apps Script)
                ▼
┌──────────────────────────────────────────────────────────────┐
│  GOOGLE SHEETS (backend "không code") + Apps Script (Code.gs)  │
│  • Bảng sản phẩm/giá (master ~1645 SP), tab catalog            │
│  • Tab cấu hình: tệp, ưu tiên hiển thị, Nhãn tài trợ, tương tự │
│  • Tab dữ liệu thu về: stores, purchases, alerts, buyers       │
└──────────────────────────────────────────────────────────────┘
```

### Vì sao chọn Google Sheets làm "backend"?
- Đội vận hành (không phải lập trình viên) có thể **thêm/sửa sản phẩm, giá, nhóm, ưu tiên, tài trợ** trực tiếp trên bảng tính quen thuộc — **không cần đụng code, không cần deploy lại**.
- App đọc dữ liệu từ Sheet (qua link CSV công khai hoặc qua Apps Script), có cache (revalidate) để nhanh.
- Hệ thống cào giá ghi ngược giá/tồn kho thực tế vào Sheet.

### Các trang (route) của app

| Đường dẫn | Trang | Mục đích |
|---|---|---|
| `/` | Trang chính (`app/page.tsx`) | Tìm kiếm, so sánh giá, bản đồ, giỏ hàng, đặt hàng. |
| `/admin` | Trang quản trị (`app/admin/page.tsx`) | Bấm **cào giá thủ công**; xem kết quả (số SP cào, giá tìm thấy, SP bị gỡ…). |
| `/history` | Lịch sử mua hàng (`app/history/page.tsx`) | Xem các đơn đã đặt + tổng chi tiêu; xoá lịch sử. |

---

## 6. Mô hình dữ liệu

Các thực thể chính (định nghĩa trong `lib/types.ts`):

| Thực thể | Ý nghĩa nghiệp vụ | Trường tiêu biểu |
|---|---|---|
| **Store** | Một điểm bán (cửa hàng vật lý hoặc nguồn online). | `id`, `chain`, `name`, `address`, `lat/lng`, `website`, `online`, `currency` |
| **Product** | Một sản phẩm trong danh mục. | `id`, `name`, `brand`, `category`, `group` (tệp), `unit`, `image`, `info` |
| **Offer** | Một sản phẩm **được bán tại một cửa hàng** với giá + tồn kho cụ thể. | `productId`, `storeId`, `price`, `inStock`, `productUrl`, `lastChecked` |
| **RankedOffer** | Offer đã tính khoảng cách + gắn thông tin Store/Product để hiển thị. | mở rộng `Offer` + `store`, `product`, `distanceKm` |
| **Catalog** | Toàn bộ dữ liệu: sản phẩm + offer + các cấu hình. | `products`, `offers`, `groups`, `priorities`, `sponsors`, `similarGroups` |
| **ProductGroup** ("tệp") | Nhóm danh mục/ô dịch vụ hiển thị. `link` rỗng = ô lọc; URL = mở dịch vụ ngoài; `"soon"` = sắp ra mắt. | `label`, `emoji`, `link`, `note`, `priority` |
| **PriorityProfile** | Hồ sơ ưu tiên hiển thị: thứ tự chuỗi giảm dần. | `name`, `chains[]`, `note` |
| **Sponsor** | Nhãn tài trợ (logo + link). | `name`, `link`, `logo` |
| **SimilarGroup** | Nhóm "sản phẩm tương tự". | `name`, `products[]` |
| **PurchaseRecord** | Một đơn mua đã ghi nhận. | `productId`, `storeId`, `chain`, `qty`, `unitPrice`, `total`, `boughtAt`, thông tin người mua |
| **PriceAlert** | Đăng ký báo giảm giá (lead). | `phone`, `productId`, `priceAtSignup`, `createdAt` |
| **CartItem** | Một dòng trong giỏ hàng. | `product`, `offer`, `qty` |

> **Quan hệ cốt lõi:** một **Product** có nhiều **Offer** (mỗi Offer ứng với một **Store**). Khi hiển thị, giá của một chuỗi (ví dụ BHX) được **fan-out** ra tất cả cửa hàng vật lý của chuỗi đó để tính khoảng cách tới từng điểm.

---

## 7. Vận hành dữ liệu qua Google Sheets

Đây là phần quan trọng nhất với đội vận hành: **toàn bộ nội dung hiển thị được điều khiển từ Google Sheets**.

### 7.1 Các bảng/tab và vai trò

| Tab / Bảng | Vai trò nghiệp vụ | Đọc bởi |
|---|---|---|
| **Bảng sản phẩm chính (master, ~1645 SP)** | Danh mục sản phẩm gốc + giá niêm yết/khuyến mãi + URL sản phẩm; nơi hệ thống cào ghi **giá/tồn kho thực tế** vào các cột live. | `lib/sheet-catalog.ts` |
| **Tab `catalog`** | Định dạng catalog chuẩn (product + offer theo từng store). Dùng khi cấu hình `CATALOG_SOURCE=catalog-tab`. | `lib/sheet-catalog.ts`, Apps Script |
| **Tab `tệp`** | Khai báo **nhóm danh mục / ô dịch vụ**: nhãn, emoji, link, ghi chú, ưu tiên. | `lib/sheet-groups.ts` |
| **Tab `ưu tiên hiển thị`** | Khai báo **thứ tự chuỗi ưu tiên** (mỗi hồ sơ là một danh sách chuỗi). | `lib/sheet-groups.ts` |
| **Tab `Nhãn tài trợ`** | Khai báo **dải logo tài trợ** (tên · link · logo). | `lib/sheet-groups.ts` |
| **Tab `tương tự`** | Khai báo **nhóm sản phẩm tương tự** cho màn chi tiết. | `lib/sheet-similar.ts` |
| **Tab `stores`** | Danh sách **cửa hàng vật lý** + toạ độ + tiền tệ (override seed tĩnh trong code). | `lib/sheet-stores.ts` |
| **Tab `purchases`** | Lưu **đơn mua** thu về từ app. | Apps Script (ghi) |
| **Tab `alerts`** | Lưu **lead báo giảm giá** (SĐT + sản phẩm). | Apps Script (ghi) |
| **Tab `buyers`** | Hồ sơ người mua (upsert theo SĐT). | Apps Script (ghi) |

### 7.2 Đội vận hành làm được gì mà không cần lập trình?
- **Thêm/sửa sản phẩm & giá:** sửa trên bảng master/catalog → app cập nhật sau khi cache hết hạn.
- **Tạo nhóm danh mục / ô dịch vụ mới:** thêm dòng vào tab `tệp` (đặt emoji, link).
- **Đẩy đối tác lên đầu:** cấu hình tab `ưu tiên hiển thị` và gán cho tệp tương ứng.
- **Thêm nhà tài trợ:** thêm dòng vào tab `Nhãn tài trợ`.
- **Quản lý cửa hàng & toạ độ:** sửa tab `stores` (không cần sửa code).
- **Ẩn sản phẩm:** dùng cột "hiển thị"; sản phẩm hết hàng / URL 404 sẽ tự ẩn.

### 7.3 Apps Script (`apps-script/Code.gs`) — "bộ não" phía Sheet
Triển khai dưới dạng **Web App** (truy cập công khai qua URL `/exec`). Vai trò:
- **`doGet(?type=catalog)`** — trả về catalog (products, offers, groups, priorities) cho app.
- **`doPost`** — nhận lệnh ghi theo `action`:

| Action | Tác dụng |
|---|---|
| `add_purchase` | Ghi đơn mua vào tab `purchases`. |
| `add_alert` | Ghi lead báo giá vào tab `alerts`. |
| `save_buyer` | Upsert hồ sơ người mua (theo SĐT) vào tab `buyers`. |
| `set_catalog` | Ghi đè toàn bộ tab `catalog`. |
| `upsert_catalog` | Cập nhật/chèn theo khoá `product_id\|store_id`. |
| `live_upsert` | Ghi **giá/tồn kho thực tế** vào bảng master (khớp theo URL). |

- **Menu tiện ích trong Sheet** (`onOpen`): "Cào lại ngay", "Tạo tab Tệp + cột tệp", "Tự gán tệp cho sản phẩm" (suy luận danh mục theo từ khoá tiếng Việt), "Tạo tab Ưu tiên hiển thị".

---

## 8. Hệ thống cào giá (price scraping)

### Mục tiêu
Giữ **giá và tình trạng còn hàng luôn cập nhật** mà không cần đội ngũ nhập tay hằng ngày.

### 3 lớp dữ liệu giá (dự phòng lẫn nhau)

| Lớp | Cách hoạt động | Áp dụng cho | File |
|---|---|---|---|
| **Live fetch** | Tải trang sản phẩm bằng HTTP, đọc giá từ dữ liệu có cấu trúc (JSON-LD `schema.org`) hoặc regex dự phòng. | Con Cưng, Co.opmart (chuỗi cho phép) | `lib/scrape/live.ts` |
| **Snapshot thủ công** | Dữ liệu giá chụp tay từ trình duyệt, lưu trong file JSON; fan-out ra các cửa hàng của chuỗi. | Mọi chuỗi (baseline) | `lib/scrape/snapshot.ts`, `lib/scrape/real-snapshot.json` |
| **Playwright (trình duyệt thật)** | Mở trình duyệt thật, tìm kiếm theo từ khoá, đọc giá từ DOM; vượt một số chặn bot. | AEON, BHX (chặn fetch) | `scripts/scrape-live.ts` |

> Hiện các scraper theo chuỗi (`aeon.ts`, `bhx.ts`, `concung.ts`, `coop.ts`) đều **uỷ quyền về snapshot** làm dữ liệu nền; live fetch dùng để cập nhật giá thực tế cho Con Cưng/Co.opmart. BHX/AEON chặn bot nên cần Playwright chạy bằng script ngoài.

### 2 endpoint cào giá

| Endpoint | Mục đích | Cách dùng |
|---|---|---|
| **`/api/scrape`** | Cào & **upsert toàn bộ catalog** vào Sheet. | Cron hoặc bấm menu "Cào lại ngay" trong Sheet. Có thể lọc `?chains=bhx,coop`. |
| **`/api/scrape-live`** | **Cào giá live theo lô**, tự nối lô (chaining) để không vượt timeout. | Cron hằng ngày + nút cào tay ở `/admin`. Tham số: `all=1` (quét tất cả), `write=1` (ghi Sheet), `offset`, `limit`, `source`. |

### Tự động hoá hằng ngày (Cron Vercel)
`vercel.json` cấu hình một cron chạy **00:00 UTC mỗi ngày**:
```json
{ "crons": [ { "path": "/api/scrape-live?write=1&all=1", "schedule": "0 0 * * *" } ] }
```
- Quét toàn bộ sản phẩm có URL, cào giá live, ghi vào Sheet.
- Vì giới hạn thời gian hàm (60s), endpoint **chia lô** (mỗi lô ~30 SP, 6 luồng song song) và **tự gọi tiếp lô sau** bằng cơ chế `after()`.
- **Sản phẩm 404/410** (đã bị gỡ khỏi web nguồn) → đánh dấu hết tồn tại → web **tự ẩn**.

### Trang `/admin` (cào thủ công)
- Nút "Cào ngay" gọi `POST /api/scrape-live?write=1&all=1`.
- Hiển thị: tổng SP cào được, số đã thử, số giá tìm thấy, số SP bị gỡ, trạng thái lô đang chạy nền, thống kê ghi Sheet.

### Công cụ phụ trợ (scripts)
- `scripts/build_catalog.py` — sinh `catalog.csv` từ dữ liệu mẫu.
- `scripts/push-catalog-csv.mjs` — đẩy `catalog.csv` lên Sheet.
- `scripts/push-real.ts` — đẩy dữ liệu snapshot thật lên Sheet.
- `scripts/push-seed.ts` — đẩy dữ liệu seed/demo lên Sheet.
- `scripts/scrape-live.ts` — cào bằng Playwright (chạy cục bộ).
- `grab-astrabean.mjs` / `push-astrabean.mjs` — lấy & đẩy catalog cửa hàng Astrabean (day-sales.com).

---

## 9. Tích hợp dịch vụ ngoài & bản đồ

| Dịch vụ | Vai trò | Endpoint nội bộ |
|---|---|---|
| **Nominatim (OpenStreetMap)** | Geocode 2 chiều: địa chỉ ↔ toạ độ (tìm địa chỉ, đảo ngược toạ độ thành địa chỉ). | `/api/geocode?q=...` |
| **Overpass (OpenStreetMap)** | Lấy điểm quan tâm (POI) quanh vị trí để hiển thị bản đồ. | `/api/poi?lat=&lng=&r=` |
| **OpenFreeMap + MapLibre GL** | Hiển thị bản đồ tương tác (tiles + render). | (client, `components/MapView.tsx`) |
| **Google Maps** | Mở chỉ đường tới cửa hàng. | (link ngoài) |

Bản đồ (`MapView`) hỗ trợ: marker cửa hàng theo màu chuỗi, badge "RẺ NHẤT", vòng bán kính lọc, popup giá + chỉ đường + "Vào mua", nút recenter về vị trí người dùng, ẩn bớt nhãn POI cho gọn.

---

## 10. Tổng hợp API nội bộ

| Route | Phương thức | Mục đích | Nguồn dữ liệu |
|---|---|---|---|
| `/api/catalog` | GET | Trả toàn bộ catalog (sản phẩm, offer, nhóm, ưu tiên, tài trợ). Cache 60s. | Google Sheet (master/catalog) + tab cấu hình |
| `/api/stores` | GET | Danh sách cửa hàng vật lý cho marker bản đồ. Cache 300s. | Tab `stores` (fallback seed code) |
| `/api/geocode` | GET | Đổi địa chỉ → toạ độ. Cache 1 ngày. | Nominatim |
| `/api/poi` | GET | POI quanh một toạ độ. | Overpass |
| `/api/purchases` | POST | Ghi đơn mua. | → Apps Script (`add_purchase`) |
| `/api/buyer` | POST | Lưu hồ sơ người mua (upsert theo SĐT). | → Apps Script (`save_buyer`) |
| `/api/alerts` | POST | Ghi đăng ký báo giảm giá (lead). | → Apps Script (`add_alert`) |
| `/api/scrape` | GET/POST | Cào & upsert toàn catalog. Bảo vệ bằng `CRON_SECRET`. | scraper → Apps Script |
| `/api/scrape-live` | GET/POST | Cào giá live theo lô, tự nối lô. Bảo vệ bằng `CRON_SECRET`. | live fetch → Apps Script |

> Các endpoint ghi dữ liệu (`purchases`, `buyer`, `alerts`) **luôn trả `ok=true`** để app vẫn hoạt động kể cả khi mạng/Sheet lỗi — dữ liệu được lưu tạm ở localStorage làm dự phòng.

---

## 11. Quốc tế hoá & lưu trữ phía trình duyệt

### Đa ngôn ngữ (i18n — `lib/i18n.ts`)
- Hai ngôn ngữ: **`vi`** (mặc định) và **`en`**.
- Tự chọn theo quốc gia phát hiện từ địa chỉ: quốc gia là Việt Nam → tiếng Việt; còn lại → tiếng Anh (`langForCountry`).
- Tiếng Việt là "khoá gốc", tiếng Anh tra trong từ điển `EN_DICT`; nếu thiếu bản dịch thì fallback về tiếng Việt (an toàn).

### Lưu trữ phía trình duyệt (localStorage)
| Khoá | Nội dung | File |
|---|---|---|
| `gqd_loc` | Vị trí + địa chỉ + mã quốc gia của người dùng. | `app/page.tsx`, `lib/i18n.ts` |
| `gqd_buyer` | Hồ sơ người mua (tên/SĐT/địa chỉ) để tự điền form. | `lib/profile.ts` |
| `gqd_recent` | Danh sách sản phẩm đã xem gần đây. | `lib/recent.ts` |
| `gqd_views` | Số lượt xem theo sản phẩm (phục vụ xếp hạng "phổ biến" cục bộ). | `lib/recent.ts` |
| `gqd_purchases` | Lịch sử mua hàng (hiển thị ở `/history`). | `lib/purchases.ts` |
| `gqd_alerts` | Đăng ký báo giảm giá đã tạo. | `lib/alerts.ts` |

> Hồ sơ người mua được **lưu ngay vào localStorage** và **đẩy lên Sheet có debounce** (giảm tải mạng); khi đặt hàng sẽ flush ngay để dữ liệu kịp lưu.

---

## 12. Cài đặt, chạy & triển khai

### Lệnh npm (`package.json`)
| Lệnh | Tác dụng |
|---|---|
| `npm run dev` | Chạy môi trường phát triển (http://localhost:3000). |
| `npm run build` | Build production. |
| `npm run start` | Chạy bản production. |
| `npm run scrape` | Cào giá bằng Playwright (`scripts/scrape-live.ts`). |
| `npm run push-real` | Đẩy snapshot thật lên Sheet (`scripts/push-real.ts`). |
| `npm run deploy` | Deploy Vercel + cập nhật alias (`scripts/deploy.sh`). |

### Biến môi trường quan trọng
| Biến | Vai trò |
|---|---|
| `PURCHASE_WEBHOOK_URL` | URL Apps Script `/exec` để ghi đơn/lead/người mua. (Có default trong `lib/config.ts`.) |
| `CATALOG_API_URL` | Endpoint Apps Script để cào ghi ngược catalog / live. |
| `CRON_SECRET` | Bảo vệ các endpoint cào (`/api/scrape`, `/api/scrape-live`). |
| `CATALOG_SOURCE` | Chọn nguồn catalog (`catalog-tab` để dùng tab catalog thay master). |
| `*_CSV_URL` | Override link CSV cho từng tab (catalog, stores, tệp, ưu tiên, tài trợ, tương tự). |

### Triển khai (Vercel)
- Deploy lên Vercel; `scripts/deploy.sh` chạy `vercel --prod` rồi gán **alias `affree.vercel.app`** về bản mới nhất.
- Cron của Vercel tự gọi `/api/scrape-live` mỗi ngày (kèm header `Authorization: Bearer <CRON_SECRET>`).

---

## 13. Lộ trình phát triển (Roadmap)

Tóm tắt theo nhóm (nguồn `ROADMAP` trong `lib/version.ts`) — backlog các hạng mục dự kiến làm tiếp:

- **🗺️ Bản đồ & vị trí:** sửa hiển thị dòng vị trí; hiện thêm cửa hàng gần nhất; tinh chỉnh tag/nút chỉ đường; gọn vòng bán kính; nút đóng bản đồ; làm rõ nguồn tìm địa chỉ.
- **🏪 So sánh giá & cửa hàng:** gộp chi nhánh cùng chuỗi (rẻ nhất + xem tất cả); tính phí ship khi so sánh; chuẩn hoá tab `stores`; ghi rõ thời điểm kiểm tra "còn hàng"; xem lại cách tính "bán chạy"; bổ sung nguồn bán & cửa hàng online quốc tế.
- **🛒 Giỏ hàng & thanh toán:** nút "Bỏ vào giỏ" ở khu so sánh; thêm nhanh bằng "+"; bộ chọn số lượng; giỏ nhiều nguồn; bỏ bước OTP; khung giờ giao trong ngày.
- **✨ Giao diện:** làm đẹp nhãn tài trợ; trang "xem tất cả sản phẩm" dạng dọc; hiệu ứng; chỉnh tagline "Kết nối mua bán – Không thu phí".
- **🗂️ Danh mục & gợi ý:** cấu hình thành phần danh mục & "sản phẩm tương tự" qua Sheet; thêm tệp mới (B2B, Đàn ông đích thực, Thế giới phái đẹp); bổ sung địa điểm nổi tiếng.

---

## 14. Phụ lục

### 14.1 Cấu trúc thư mục (rút gọn)

```
affree/
├── app/                      # Next.js App Router
│   ├── page.tsx              # Trang chính: tìm kiếm, so sánh, bản đồ, giỏ hàng
│   ├── layout.tsx            # Layout gốc + metadata + font
│   ├── globals.css           # CSS toàn cục (Tailwind + animation)
│   ├── admin/page.tsx        # Trang cào giá thủ công
│   ├── history/page.tsx      # Lịch sử mua hàng
│   └── api/                  # API routes (catalog, stores, geocode, poi,
│                             #   purchases, buyer, alerts, scrape, scrape-live)
├── components/               # Component UI
│   ├── MapView.tsx           # Bản đồ MapLibre
│   ├── CartModal.tsx         # Giỏ hàng đa cửa hàng
│   ├── OrderAgentModal.tsx   # Trợ lý đặt hàng (mô phỏng)
│   ├── ChainBadge.tsx        # Badge/logo nguồn bán
│   ├── QtyInput.tsx          # Bộ chọn số lượng
│   └── Logo.tsx              # Logo app
├── lib/                      # Logic & dữ liệu
│   ├── types.ts              # Mô hình dữ liệu
│   ├── config.ts             # Cấu hình webhook
│   ├── stores.ts             # Nguồn bán + cửa hàng (seed + động)
│   ├── orderConfig.ts        # Quy trình đặt hàng theo từng nguồn
│   ├── i18n.ts               # Đa ngôn ngữ VI/EN
│   ├── version.ts            # Phiên bản + roadmap
│   ├── profile/recent/purchases/alerts.ts  # Lưu trữ phía client
│   ├── seed-catalog.ts       # Catalog mẫu
│   ├── sheet-*.ts            # Đọc dữ liệu từ Google Sheets
│   └── scrape/               # Hệ thống cào giá (live, snapshot, theo chuỗi)
├── apps-script/Code.gs       # Backend Google Apps Script (Web App)
├── scripts/                  # Công cụ cào & đẩy dữ liệu, deploy
├── public/logos/             # Logo các chuỗi
├── catalog.csv               # Catalog mẫu (sinh từ build_catalog.py)
├── danh-muc-san-pham.csv     # Phân loại sản phẩm theo danh mục
└── vercel.json               # Cấu hình cron
```

### 14.2 Bảng thuật ngữ

| Thuật ngữ | Giải thích |
|---|---|
| **Tệp** | Nhóm danh mục hiển thị / ô dịch vụ trên trang chính (cấu hình ở tab `tệp`). |
| **Ngành hàng** (category) | Phân loại sản phẩm cấp gốc (ví dụ Sữa, Thực phẩm, Trang sức). |
| **Nguồn / Chuỗi** (chain/source) | Nơi bán: chuỗi siêu thị, cửa hàng hoặc sàn online. |
| **Offer** | Một sản phẩm được bán tại một cửa hàng, kèm giá + tồn kho. |
| **Fan-out** | Nhân giá của một chuỗi ra tất cả cửa hàng vật lý của chuỗi đó để tính khoảng cách tới từng điểm. |
| **Ưu tiên hiển thị** (Priority) | Cấu hình thứ tự chuỗi được ưu tiên khi hiển thị. |
| **Nhãn tài trợ** (Sponsor) | Dải logo đối tác/tài trợ. |
| **Snapshot** | Dữ liệu giá chụp tay làm nền, dự phòng khi cào live thất bại. |
| **THXL / TDAT / PNJ…** | Các mã store/chuỗi cụ thể dùng trong dữ liệu Sheet (ví dụ trong hồ sơ ưu tiên). |
| **Lead** | Thông tin liên hệ thu được (ví dụ SĐT để lại khi đăng ký báo giảm giá). |

---

*Tài liệu này được sinh từ việc đọc toàn bộ mã nguồn dự án (nhánh `claude/exciting-ramanujan-i0obv5`). Khi mã nguồn thay đổi, hãy cập nhật lại các mục tương ứng.*
