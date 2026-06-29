# Skill Instruction: cooponline.vn

## Đặc điểm trang Co.opmart Online
- Trang TMĐT của hệ thống siêu thị Co.opmart / Co.op Food tại Việt Nam
- Yêu cầu chọn địa điểm mua sắm (siêu thị/cửa hàng) trước khi mua hàng
- Hỗ trợ giao hàng tận nơi (COD) và thanh toán online

## Popup phổ biến cần xử lý
- **Popup chọn địa điểm**: xuất hiện khi vào trang lần đầu, hỏi bạn muốn mua ở siêu thị nào
  → Chọn địa điểm gần nhất hoặc đóng nếu có nút "Bỏ qua"
- **Popup cookie/GDPR**: click "Chấp nhận" hoặc "Đồng ý"
- **Popup khuyến mãi**: click X để đóng

## Luồng mua hàng
1. Đóng popup chọn địa điểm (hoặc chọn 1 địa điểm phù hợp)
2. Tìm kiếm sản phẩm: search box thường ở header
3. Trong kết quả tìm kiếm: click "Thêm vào giỏ" ngay trên card sản phẩm nếu có
4. Nếu cần vào trang sản phẩm: chọn số lượng → "Thêm vào giỏ hàng"
5. Giỏ hàng → "Tiến hành thanh toán"
6. Điền thông tin giao hàng → chọn COD → pause_for_human(reason="review")

## Lưu ý checkout
- Form địa chỉ thường có dropdown Tỉnh/Quận/Phường
- Nếu form địa chỉ dạng text input → có thể tự điền
- Mỗi form của các trường có thể nhập text để filter, trước khi chọn thì nhập Tỉnh/Quận/Phường trước để filter chỉnh xác hoặc gần đúng kết quả
- Khi tới bước thanh toán thì dừng lại yêu cầu người dùng chọn hình thước thanh toán. Sau khi người dùng chọn thì tiếp tục quá trình thanh toán.
