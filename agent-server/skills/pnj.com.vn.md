# Skill Instruction: pnj.com.vn

## Đặc điểm trang PNJ
- PNJ là trang trang sức cao cấp, nhiều sản phẩm có nhiều variant (chất liệu, kích thước nhẫn)
- Trang thường có popup banner quảng cáo (.close-btn) và popup search-trend overlay
- PNJ cho phép mua online và giao hàng tận nơi với một số sản phẩm

## Popup phổ biến cần đóng
- **Banner quảng cáo**: `button.close-btn[type="button"]` — click để đóng
- **Search trend overlay**: `.ty-ajax-overlay.display-search-trend` — đây KHÔNG phải modal thật, chỉ cần nhấn Escape hoặc click vào body để ẩn
- **Popup vị trí**: nếu hỏi vị trí → từ chối / bỏ qua

## Lưu ý khi tìm kiếm
- Search box: `input#search_input[name="keyword"]` (trên navbar chính)
- Nếu popup search gợi ý xuất hiện sau khi gõ → nhấn Enter để tìm kiếm thay vì click vào gợi ý
- Kết quả tìm kiếm có thể hiện sản phẩm gần đúng, cần kiểm tra tên kỹ trước khi click

## Lưu ý khi click sản phẩm
- Tránh click vào icon Zalo/Facebook/chat nằm ở góc trang — đây là nút liên hệ, không phải nút mua
- Nếu bị redirect sang zalo.me hoặc trang ngoài → gọi navigate() để quay về pnj.com.vn ngay

## Luồng mua hàng
1. Đóng popup banner (nếu có)
2. Tìm kiếm sản phẩm qua search box
3. Click vào sản phẩm phù hợp trong kết quả
4. Trên trang sản phẩm: chọn variant (kích thước, chất liệu) → click "Thêm vào giỏ" hoặc "Mua ngay"
5. Tiến hành checkout → điền thông tin → pause_for_human(reason="review")

## Nếu không tìm thấy nút mua
- Một số sản phẩm PNJ chỉ xem tại cửa hàng, không mua online được
- Trong trường hợp này → pause_for_human(reason="other", message="Sản phẩm này không hỗ trợ mua online, cần đến cửa hàng hoặc liên hệ PNJ")
