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

### Affree là gì?
Affree là ứng dụng web **so sánh giá và kết nối mua bán** cho thị trường Việt Nam. Người dùng nhập (hoặc định vị) nơi mình đang ở, tìm một sản phẩm, và Affree hiển thị **các nơi đang bán sản phẩm đó quanh khu vực** kèm **giá**, **tình trạng còn hàng** và **khoảng cách** tới từng cửa hàng — kèm bản đồ và nút chỉ đường / vào mua.

### Vấn đề giải quyết
Người mua hàng ngày thường không biết món mình cần đang được bán ở đâu **rẻ nhất** và **gần nhất**. Giá giữa các chuỗi (Bách Hóa Xanh, Co.opmart, Con Cưng, AEON…) chênh nhau, lại thay đổi theo khuyến mãi. Affree gom giá về một chỗ, sắp xếp theo "rẻ + gần", giúp người mua quyết định nhanh.

### Định vị "không thu phí"
Affree không thu phí của người mua. Vai trò của nền tảng là **kết nối**: tổng hợp thông tin giá và điều hướng người mua tới đúng nơi bán (cửa hàng vật lý hoặc website/app của chuỗi).

### Đối tượng người dùng
- **Chính:** người tiêu dùng tại Việt Nam (mặc định giao diện tiếng Việt, tiền tệ ₫).
- **Mở rộng:** người dùng ở nước ngoài — app hỗ trợ nhập **địa chỉ nước ngoài**, tự chuyển giao diện sang **tiếng Anh** và hiển thị giá theo **tiền tệ cửa hàng** (ví dụ $ cho cửa hàng tại Mỹ).

---

## 2. Mô hình thương mại & giá trị nghiệp vụ

### Mô hình "kết nối mua bán không thu phí"
Affree đứng giữa **người mua** và **nhiều nguồn bán** (chuỗi siêu thị, cửa hàng, sàn online). Nền tảng:
1. Tổng hợp danh mục sản phẩm + giá từ nhiều nguồn.
2. Xếp hạng và gợi ý nơi mua tối ưu (rẻ/gần/còn hàng).
3. Điều hướng người mua: chỉ đường tới cửa hàng vật lý, hoặc mở website/app nguồn bán, hoặc đặt hàng qua **trợ lý ảo** (mô phỏng).

### Hướng doanh thu tiềm năng (đã có "hạt giống" trong sản phẩm)
Mặc dù không thu phí người mua, hệ thống đã có sẵn 2 cơ chế phục vụ thương mại hoá:

| Cơ chế | Mô tả nghiệp vụ | Khai báo ở đâu |
|---|---|---|
| **Ưu tiên hiển thị** (Priority) | Sắp thứ tự nguồn bán khi hiển thị giá theo một danh sách chuỗi ưu tiên (ví dụ ưu tiên cửa hàng đối tác lên trước). Áp dụng theo từng nhóm ngành hàng ("tệp") hoặc mặc định toàn trang. | Tab **"ưu tiên hiển thị"** trong Google Sheet |
| **Nhãn tài trợ** (Sponsor) | Dải logo nhà tài trợ/đối tác hiển thị dưới mục "Dịch vụ quanh đây", bấm vào mở link đối tác. | Tab **"Nhãn tài trợ"** trong Google Sheet |

→ Đây là điểm BA cần lưu ý: **mô hình kiếm tiền có thể đến từ phí ưu tiên hiển thị và tài trợ thương hiệu**, không phải từ người mua.

### Các nguồn bán / đối tác đang tích hợp
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

### Giá trị cho từng bên

| Bên | Giá trị nhận được |
|---|---|
| **Người mua** | Tiết kiệm tiền & thời gian; thấy ngay nơi rẻ nhất/gần nhất; biết còn hàng hay không; chỉ đường & đặt hàng nhanh. |
| **Cửa hàng / chuỗi** | Thêm kênh tiếp cận khách quanh khu vực; tăng lượt ghé/đặt; có thể trả phí để được **ưu tiên hiển thị**. |
| **Nền tảng Affree** | Doanh thu tiềm năng từ tài trợ thương hiệu + ưu tiên hiển thị; dữ liệu hành vi (lượt xem, lượt mua, lead báo giá). |

---

## 3. Tính năng chính (góc nhìn người dùng)

Danh sách tính năng đã phát hành (nguồn `DONE` trong `lib/version.ts`, hiển thị khi người dùng bấm nút phiên bản trên header):

1. **So sánh giá nhiều nơi bán quanh bạn** — gom giá từ nhiều chuỗi cho cùng một sản phẩm.
2. **Định vị / nhập địa chỉ → xem khoảng cách tới cửa hàng** — GPS hoặc nhập tay địa chỉ.
3. **Bán chạy theo khu vực (phường)** — gợi ý sản phẩm "hot" theo khu vực người dùng.
4. **Hiển thị giá theo tiền tệ cửa hàng (₫ / $)** — đa tiền tệ.
5. **Đặt hàng qua trợ lý ảo (mô phỏng)** — trợ lý tự động "đặt giúp" với các bước OTP/đăng nhập/CAPTCHA mô phỏng.
6. **Lịch sử mua hàng & báo khi giảm giá** — lưu lịch sử + đăng ký nhận báo giảm giá (price alert).
7. **Bản đồ cửa hàng + chỉ đường** — bản đồ tương tác, chỉ đường qua Google Maps.
8. **Tìm địa chỉ (kể cả nước ngoài) → bản đồ hiển thị đúng vị trí đó.**

### Tính năng bổ trợ (từ `app/page.tsx` và các component)
- **Bộ lọc nhanh:** "Deal hời" (chênh giá lớn), "Giá hời" (rẻ hơn trung bình nhóm), "Bán chạy khu vực".
- **Lọc 2 cấp:** theo **Tệp** (nhóm danh mục) và theo **Ngành hàng** (category).
- **Ô dịch vụ ("Dịch vụ quanh đây"):** tile động cấu hình từ Sheet — có thể là ô lọc sản phẩm, link dịch vụ ngoài, hoặc "sắp ra mắt".
- **Giỏ hàng đa cửa hàng:** thêm sản phẩm từ nhiều nguồn rồi đặt tất cả một lần (`CartModal`).
- **Bộ chọn số lượng** (`QtyInput`), **thẻ sản phẩm** kèm tag gợi ý ("Deal -X%", "Giá hời", "Bán chạy").
- **Sản phẩm tương tự** trong màn chi tiết — cấu hình qua Sheet hoặc tự suy theo ngành hàng.
- **Đa ngôn ngữ VI/EN** tự chuyển theo quốc gia phát hiện từ địa chỉ.

---

## 4. Hành trình người dùng (User Journeys)

### J1 — Tìm & so sánh giá rồi tới cửa hàng
1. Người dùng mở app → cho phép định vị **hoặc** nhập địa chỉ (popover vị trí).
2. Gõ tên sản phẩm vào ô tìm kiếm (hoặc bấm một Tệp/ngành hàng).
3. Affree hiển thị danh sách sản phẩm, mỗi sản phẩm kèm khoảng giá (min–max), số nơi bán.
4. Bấm vào sản phẩm → màn chi tiết liệt kê **tất cả nơi bán**, sắp theo giá (mặc định) hoặc khoảng cách; gắn tag "Rẻ nhất".
5. Mở **bản đồ** → thấy các cửa hàng, vòng bán kính, cửa hàng rẻ nhất; bấm **"Chỉ đường"** (Google Maps) hoặc **"Vào mua"**.

### J2 — Đặt hàng qua trợ lý ảo (mô phỏng)
1. Tại một offer, người dùng bấm "Để trợ lý đặt giúp" → mở `OrderAgentModal`.
2. Điền họ tên, SĐT, địa chỉ (tự điền từ hồ sơ đã lưu), số lượng, khung giờ (tuỳ nguồn).
3. Trợ lý chạy các **bước mô phỏng** theo cấu hình của từng nguồn (`lib/orderConfig.ts`): mở web → đăng nhập/OTP/CAPTCHA (nếu cần) → thêm vào giỏ → xác nhận → "gửi đơn".
4. Các bước cần người dùng tương tác sẽ **tạm dừng** (nhập OTP mô phỏng, xác nhận đã đăng nhập…), sau đó tiếp tục.
5. Kết thúc: hiển thị mã đơn mô phỏng; đơn được ghi vào lịch sử.

> Ví dụ khác biệt giữa các nguồn (`lib/orderConfig.ts`): **Con Cưng** mua nhanh chỉ cần SĐT; **BHX/Co.opmart** cần OTP + khung giờ; **AEON** cần đăng nhập tài khoản (email) + CAPTCHA; Co.opmart freeship đơn ≥ 200.000đ trong bán kính 6km.

### J3 — Đặt hàng qua giỏ hàng đa cửa hàng
1. Người dùng thêm nhiều sản phẩm (từ nhiều cửa hàng) vào giỏ.
2. Mở `CartModal` → các món **gộp theo cửa hàng**; mỗi cửa hàng có yêu cầu riêng (email, chọn siêu thị, khung giờ).
3. Điền thông tin người nhận → "Đặt hàng tất cả" → mỗi nhóm cửa hàng tạo một đơn (`POST /api/purchases`).

### J4 — Đăng ký báo giảm giá (thu lead)
1. Ở màn chi tiết sản phẩm, người dùng để lại **SĐT/Zalo** để "báo khi giảm giá".
2. Hệ thống lưu `PriceAlert` (kèm giá rẻ nhất tại thời điểm đăng ký) → ghi vào Sheet (tab `alerts`) làm **lead**.

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
