# Skill Instruction: walmart.com

## Mục tiêu
- Walmart chạy bằng luồng agentic điều khiển trình duyệt thật, không gọi API nội bộ Walmart.
- Nhiệm vụ của agent: đăng nhập trước, xác nhận session ổn định, mở product URL, thêm đúng sản phẩm vào giỏ, đi tới checkout và dừng để người dùng tự thao tác phần còn lại.
- Không lưu email/mật khẩu/thẻ thật trong file này. Lấy credentials từ payload người dùng hoặc biến môi trường như `WALMART_EMAIL`, `WALMART_PASSWORD`.
- Nếu gặp OTP/CAPTCHA/thanh toán nhạy cảm, dừng bằng `pause_for_human(...)`.
- Runtime dùng Playwright page chung của agent-server như các store khác.

## Runtime Playwright
- Walmart chạy bằng Playwright context tạm giống các store khác, không dùng profile riêng.
- Không dùng CDP adapter riêng cho Walmart. CDP chỉ còn là cơ chế screencast của Playwright như flow hiện tại.
- Mỗi phiên đặt hàng bắt đầu sạch từ `/orders -> https://www.walmart.com/login`; nếu gặp CAPTCHA thì pause để user xử lý trên màn stream.
- Nếu gặp OTP/CAPTCHA/thao tác nhạy cảm, agent phải gọi `pause_for_human(...)` để người dùng xử lý trên màn stream.

## Input tối thiểu agent cần có
- `productUrl`: URL Walmart thật, ví dụ `https://www.walmart.com/ip/...`.
- `quantity`: số lượng cần mua.
- `account.email` và `account.password`: bắt buộc nếu phiên Walmart chưa đăng nhập.
- `customer`: tên, số điện thoại, email nếu checkout yêu cầu.
- `address`: metadata tham khảo nếu payload có sẵn. Không dựng form địa chỉ trong Affree; nếu Walmart cần địa chỉ thì stream form thật để người dùng nhập trực tiếp.

## Luật cứng: login trước
- Bước Walmart đầu tiên luôn là kiểm tra/đăng nhập tài khoản. Không được mở product URL, không add cart, không search sản phẩm, không checkout trước khi xác nhận đã login.
- Nếu chưa login và không có `account.email` hoặc không có `account.password`, phải gọi ngay:
  `pause_for_human(reason="credentials", message="Walmart cần email/password hoặc bạn đăng nhập thủ công trước khi agent tiếp tục.")`
- Sau khi user bấm tiếp tục, kiểm tra lại trạng thái trang hiện tại hoặc `/orders`. Nếu vẫn chưa login và vẫn không có credentials, pause tiếp. Tuyệt đối không chuyển sang guest checkout hoặc search.
- Không tìm kiếm bằng search box Walmart trong flow đặt hàng. Chỉ dùng `productUrl` từ payload/catalog sau khi login xong.
- Nếu Walmart đang ở homepage/popup/location/CAPTCHA, xử lý vừa đủ để quay lại mục tiêu login. Không đóng/mở nhiều popup vô ích; nếu popup cản login mà không rõ selector, pause cho user.

## Luồng agentic tổng quát
1. Qwen gọi `navigate("https://www.walmart.com/orders")` trước mọi thao tác khác, rồi nếu chưa đăng nhập thì gọi tiếp `navigate("https://www.walmart.com/login")`.
2. Gọi `get_dom()`.
3. Nếu thấy `Hi, ...`, `Sign Out`, `Manage Account`, hoặc trang Account/Orders của account đã login thì chuyển sang product URL.
4. Nếu thấy header/dropdown có `Sign In` hoặc bị redirect sang `/orders` nhưng vẫn chưa có dấu hiệu account, coi là chưa login.
5. Nếu chưa login và có credentials, chạy flow đăng nhập bằng password.
6. Nếu chưa login và thiếu credentials, pause ngay để user nhập/login thủ công.
7. Sau khi đăng nhập, mở `productUrl`, không tìm kiếm lại bằng search box.
8. Kiểm tra PDP đúng sản phẩm bằng `h1`, giá, và nút Add to cart chính.
9. Thêm đúng số lượng rồi xác minh chính sản phẩm này đã xuất hiện trong cart.
10. Sau khi xác minh đúng sản phẩm đã vào giỏ, mở checkout bằng `Buy now`, `View cart` hoặc `Checkout` rồi dừng bằng `pause_for_human(reason="review")`; người dùng tự nhập địa chỉ, chọn fulfillment, giờ giao và thanh toán trên Walmart.

## Đăng nhập bằng Tool-Use
1. Mở `https://www.walmart.com/orders`, chờ header/account xuất hiện.
2. Nếu chưa đăng nhập:
   - Điều hướng thẳng tới `https://www.walmart.com/login`.
   - Không mở sẵn `/blocked` hay URL Walmart Identity.
   - Chỉ tiếp tục ở host `identity.walmart.com` nếu Walmart tự điều hướng tới đó sau URL login.
3. Màn `Sign in or create your account`:
   - Input email có label `Phone number or email (required)`.
   - Nếu `get_dom()` trả selector cho input này, dùng selector đó để `type`.
   - Click `Continue`.
4. Màn `Choose a sign in method`:
   - Ưu tiên tuyệt đối `Password`, `Use password`, `Use your password`, `Sign in with password`.
   - Nếu Email code/SMS/Text me đang được chọn mặc định, phải đổi sang Password trước rồi mới bấm Continue.
   - Chỉ coi là OTP khi DOM không còn bất kỳ lựa chọn Password nào.
   - Không click `Email me a code`, `Text me`, `Send code`, `Call me` nếu vẫn thấy Password.
5. Màn password:
   - Trường mật khẩu có label chính xác `Enter your password`.
   - Nếu DOM có nhiều input cùng tên `password`, đừng dùng selector quá rộng như `input[name="password"]` nếu nó trỏ nhầm radio. Ưu tiên selector từ `get_dom()` có label/password field rõ.
   - Click `Sign in`.
6. Nếu xuất hiện OTP hoặc code:
   - Gọi `pause_for_human(reason="otp", message="Walmart yêu cầu mã xác minh. Vui lòng nhập mã để tiếp tục.")`.
7. Nếu xuất hiện `Robot or human?` hoặc nút hold xác minh:
   - Gọi `pause_for_human(reason="captcha", message="Walmart yêu cầu xác minh người dùng. Vui lòng xử lý CAPTCHA rồi bấm tiếp tục.")`.
   - Không tự thử click/hold CAPTCHA nhiều lần.
8. Sau CAPTCHA/OTP hoặc sau khi user resume:
   - Kiểm tra trang hiện tại hoặc quay lại `https://www.walmart.com/orders`, sau đó vào `https://www.walmart.com/login` nếu vẫn chưa đăng nhập.
   - Chỉ khi có dấu hiệu đã login mới mở `productUrl`.
   - Nếu vẫn chưa login, tiếp tục flow login hoặc pause credentials; không search.

## Dấu hiệu đã đăng nhập
- URL `https://www.walmart.com/account` hiển thị `Manage Account - Home - Walmart.com`.
- Text có `Hi, <tên>` và `Sign Out`.
- Header cart có aria label dạng `Cart contains 0 items Total Amount $0.00`.
- Nếu đã đăng nhập nhưng vị trí không đúng, vẫn có thể tiếp tục product/cart; chỉ đổi location khi fulfillment yêu cầu.

## Product URL và anti-bot
- Mở product URL sau khi đã đăng nhập để giảm redirect/CAPTCHA.
- Nếu chưa có dấu hiệu đã login, không mở product URL.
- Product URL có thể tự đổi thành:
  - `https://www.walmart.com/ip/<slug>/<productId>`
  - `https://www.walmart.com/ip/seort/<productId>`
- Nếu mở product URL trước đăng nhập bị redirect về home, hãy đăng nhập xong rồi mở lại URL.
- Nếu product URL bị CAPTCHA, dừng cho người dùng.
- Nếu không có `productUrl`, pause để user/proxy cung cấp URL; không search bằng keyword.

## Selectors/DOM đã quan sát
- Menu header: `[data-testid="Menu"]`.
- Search input: input có aria label `Search`.
- Cart header: button có aria label bắt đầu `Cart contains`.
- Product variant chip: `[data-testid="variant-tile-chip"]`.
- Buy now wrapper: `[data-testid="buy-now-wrapper"]`.
- Nút Add to cart chính trên PDP:
  - Ưu tiên button có aria label bắt đầu `Add to cart -`.
  - Nếu `get_dom()` trả selector tự sinh cho nút này, dùng selector đó.
  - Không click các nút text `Add` ở recommendation list phía dưới.
- Đổi địa chỉ giao hàng:
  - Button aria label thường chứa `<city/zip>, Change shipping address`.

## Thêm giỏ
1. Trên PDP, đọc tên sản phẩm trong `h1` và giá hiện tại.
2. Kiểm tra variant bắt buộc trước khi Add to cart:
   - Nếu có lựa chọn Color/Size/Clothing Size và sản phẩm có nhiều option, KHÔNG tự chọn thay người dùng.
   - Gọi `pause_for_human(reason="variant", message="Sản phẩm có nhiều màu/size. Vui lòng chọn biến thể trên màn hình rồi tiếp tục.")`.
   - Sau khi resume, gọi `get_dom()` để xác nhận cả màu và size bắt buộc đã có giá trị được chọn.
   - Nếu sản phẩm không có variant, hoặc chỉ có đúng một option đã được chọn sẵn, bỏ qua bước pause này.
3. Chỉ click nút Add to cart chính sau khi variant bắt buộc đã hợp lệ.
   - Không được coi sản phẩm đã vào giỏ chỉ vì header đang báo có item; item đó có thể là sản phẩm cũ.
   - Sau khi click, gọi `get_dom()` để kiểm tra phản hồi. Nếu chưa đủ chắc chắn, mở cart và xác minh line item có đúng tên sản phẩm hiện tại.
   - Chỉ tiếp tục tới checkout sau khi thấy đúng sản phẩm trong cart hoặc xác nhận rõ ràng từ Walmart cho chính lần click này.
4. Nếu cần tăng số lượng:
   - Ưu tiên quantity control trong cart hoặc cart drawer sau khi thêm.
   - Nếu có stepper trên PDP thì dùng trước khi Add to cart.
5. Sau add-to-cart, nếu Walmart mở drawer/modal:
   - Click `View cart`, `Cart`, hoặc `Checkout` tùy trạng thái.
   - Nếu chỉ có mini-cart và header cart cập nhật số lượng, có thể click header cart.
6. Ngay sau khi xác nhận sản phẩm đã vào giỏ, click `Buy now`, `View cart` rồi `Checkout`, hoặc nút checkout tương ứng để đi tiếp.
   Không hỏi địa chỉ bằng form Affree, không tự điền địa chỉ, và không gọi `pause_for_human(reason="address")`.

## Checkout
1. Sau khi add cart thành công, tự click `Buy now` hoặc mở cart và click `Checkout`.
2. Nếu Walmart hiện form thêm/chọn địa chỉ trước khi URL checkout hoàn tất, gọi `pause_for_human(reason="review", message="Walmart đang yêu cầu địa chỉ. Vui lòng nhập trực tiếp trên màn hình Walmart.")` để stream form thật.
3. Ngay khi URL checkout xuất hiện, gọi `pause_for_human(reason="review", message="Walmart đã tới checkout. Vui lòng nhập địa chỉ và tự hoàn tất các lựa chọn còn lại.")`.
5. Không chọn fulfillment, delivery slot, payment method và không nhập dữ liệu thẻ.
6. Không tự bấm các nút cuối như `Place order`, `Place order now`, `Submit order` hoặc `Review order` nếu nút đó tạo đơn thật hay thanh toán thật.

## Tăng tốc agentic
- Đăng nhập trước, sau đó mới mở product URL. Đây là cách nhanh nhất để tránh redirect về home/CAPTCHA.
- Kiểm tra trạng thái login từ `/orders` và header account thay vì đoán từ homepage.
- Dùng product URL trực tiếp từ catalog, không search lại bằng keyword trong mọi trường hợp.
- Dùng selector ổn định từ `data-testid`, aria label, hoặc selector do `get_dom()` trả về; tránh click theo tọa độ trừ khi không còn cách khác.
- Chỉ gọi `screenshot()` khi DOM không đủ rõ hoặc gặp popup/CAPTCHA. Với các bước form bình thường, `get_dom()` là đủ.
- Sau mỗi click điều hướng, chờ ngắn bằng `wait(1000-1500)` rồi gọi `get_dom()`; không lặp screenshot sau mỗi bước.
- Không dùng `dismiss_popups()` với popup đăng nhập, địa chỉ, fulfillment, payment. Chỉ dùng với quảng cáo/cookie thật sự cản trở.
- Không mở sẵn trang CAPTCHA; chỉ pause CAPTCHA khi Walmart tự điều hướng hoặc hiển thị challenge trong flow thật.
- Nếu gặp CAPTCHA hơn 1 lần trong cùng phiên, dừng cho người dùng thay vì vòng lặp; vòng lặp làm chậm và dễ bị Walmart chặn mạnh hơn.
- Skill này là chỉ dẫn cho Qwen Tool-Use, không phải script chạy trước Qwen. Qwen phải tự gọi `navigate`, `get_dom`, `click` và `type` cho từng bước.

## Tối ưu ở tầng server
- Không chạy preflight deterministic trước Qwen cho Walmart.
- Server chỉ mở Chrome thật, cung cấp tool và stream; Qwen quyết định điều hướng/click/type.
- Helper DOM chỉ nhận biết lúc cần Affree form hoặc stream, không tự thao tác thay Qwen.
- Có thể chặn một số request analytics/media nặng để nhanh hơn, nhưng không chặn JS/CSS/core Walmart vì dễ làm hỏng checkout hoặc tăng anti-bot.

## Lưu ý đã quan sát 2026-07-01
- Account đã đăng nhập thành công bằng password flow.
- Product `2096471796` sau khi đăng nhập mở được PDP thật; trước khi đăng nhập có thể gặp `Robot or human?`.
- PDP quan sát được:
  - `9 Collection - 9 AM Dive by Afnan for Unisex - 5.07 oz EDP Spray`
  - `Now $27.48`
  - `Shipping Arrives Jul 6`
  - `Pickup Not available`
  - `Delivery Not available`
  - `Ships to Houston, 77072`
  - `Sold by ForeverLux`, `Fulfilled by Walmart`
- Walmart anti-bot nhạy; nếu gặp CAPTCHA, dừng cho người dùng xử lý.
