# Skill Instruction: concung.com

## Đặc điểm trang Con Cưng (concung.com)
- Hệ thống siêu thị mẹ và bé lớn tại Việt Nam.
- **Yêu cầu bắt buộc**: Khi mới vào trang lần đầu, website hiển thị popup yêu cầu chọn khu vực/vùng miền ("Ba mẹ vui lòng chọn khu vực để trải nghiệm mua hàng tốt nhất") để kiểm tra tồn kho chính xác tại khu vực đó.

---

## Popup chọn vùng miền (Bắt buộc xử lý đầu tiên)
Không được bỏ qua, tắt hay đóng popup này. Hãy phân tích địa chỉ người nhận (`buyerAddress` hoặc địa chỉ giao hàng) để click vào tuỳ chọn tương ứng:

1. **Miền Bắc**: Click nếu địa chỉ nhận hàng thuộc các tỉnh/thành phía Bắc:
   * *Selector*: `span.uitem-province[data-item="24"]`
   * *Từ khóa nhận diện*: `Hà Nội` (HN), `Hải Phòng` (HP), `Bắc Ninh`, `Quảng Ninh`, `Hải Dương`, `Bắc Giang`, `Hà Nam`, `Nam Định`, `Ninh Bình`, `Thái Bình`, `Vĩnh Phúc`, `Phú Thọ`, `Lạng Sơn`, `Thái Nguyên`, `Sơn La`, `Hòa Bình`, `Điện Biên`, `Lai Châu`, `Lào Cai`, `Yên Bái`, `Tuyên Quang`, `Cao Bằng`, `Bắc Kạn`, `Hà Giang`.
2. **Miền Trung**: Click nếu địa chỉ nhận hàng thuộc các tỉnh miền Trung hoặc Tây Nguyên:
   * *Selector*: `span.uitem-province[data-item="47"]`
   * *Từ khóa nhận diện*: `Đà Nẵng`, `Huế` (`Thừa Thiên Huế`), `Quảng Nam`, `Quảng Ngãi`, `Bình Định`, `Phú Yên`, `Khánh Hòa` (`Nha Trang`), `Ninh Thuận`, `Bình Thuận`, `Thanh Hóa`, `Nghệ An`, `Hà Tĩnh`, `Quảng Bình`, `Quảng Trị`, `Kon Tum`, `Gia Lai`, `Đắk Lắk`, `Đắk Nông`, `Lâm Đồng` (`Đà Lạt`).
3. **Miền Nam**: Click nếu địa chỉ nhận hàng thuộc các tỉnh phía Nam hoặc miền Tây:
   * *Selector*: `span.uitem-province[data-item="29"]`
   * *Từ khóa nhận diện*: `Hồ Chí Minh` (`TPHCM`, `TP.HCM`, `Sài Gòn`), `Bình Dương`, `Đồng Nai`, `Bà Rịa` (`Vũng Tàu`), `Long An`, `Tiền Giang`, `Bến Tre`, `Trà Vinh`, `Vĩnh Long`, `Đồng Tháp`, `An Giang`, `Kiên Giang`, `Cần Thơ`, `Hậu Giang`, `Sóc Trăng`, `Bạc Liêu`, `Cà Mau`, `Tây Ninh`, `Bình Phước`.
4. **Trường hợp không phân biệt rõ ràng**: Chọn **Miền Nam** làm mặc định (selector: `span.uitem-province[data-item="29"]`), hoặc click **"Tham khảo khu vực tỉnh thành"** (selector: `span.uitem-province[data-item="0"]`).

---

## Luồng mua hàng chính
1. Đọc và phân tích địa chỉ của khách hàng từ thông tin đơn hàng.
2. Click chọn vùng miền phù hợp trên popup để đóng popup và thiết lập kho hàng.
3. Nhập tên sản phẩm (`productName`) vào ô tìm kiếm ở thanh header đầu trang.
4. Nhấn Enter hoặc click nút Tìm kiếm.
5. Từ kết quả tìm kiếm, click chọn đúng sản phẩm (kiểm tra tên sản phẩm, quy cách đóng gói trùng khớp).
6. Tăng số lượng (`qty`) nếu cần và click **"Mua ngay"** hoặc **"Thêm vào giỏ"**.
7. Đi tới trang Giỏ hàng và tiến hành **Thanh toán**.
8. Điền thông tin giao hàng (`buyerName`, `buyerPhone`, `buyerAddress`).
9. Gọi `pause_for_human(reason="review")` khi đến màn hình kiểm tra đơn hàng/thanh toán cuối cùng để người dùng hoàn tất đặt hàng.
