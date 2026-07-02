/**
 * Mỗi nguồn bán yêu cầu thông tin/đăng nhập khác nhau khi đặt hàng.
 * Config này quyết định FORM hiển thị field gì + trợ lý chạy các bước nào.
 * (Dựa trên quy trình thực tế của từng web đã khảo sát.)
 */

export type OrderAuth =
  | "guest-phone" // mua nhanh chỉ cần SĐT, không đăng nhập
  | "phone-otp" // nhập SĐT → xác minh OTP
  | "account-login"; // đăng nhập tài khoản (email/mật khẩu) — user tự làm

export interface OrderSourceConfig {
  auth: OrderAuth;
  needEmail: boolean; // có cần email (tài khoản / hoá đơn)
  needStorePick: boolean; // có bước chọn siêu thị/khu vực giao
  needSlot: boolean; // có chọn khung giờ giao
  captcha: boolean; // có bước xác minh CAPTCHA
  payments: string[]; // các hình thức nguồn hỗ trợ (hiển thị tham khảo)
  note?: string; // ghi chú riêng của nguồn
  requirements: string[]; // tóm tắt "cần gì" hiển thị đầu form
  minQty?: number; // số lượng tối thiểu mỗi đơn (mặc định 1)
  minOrder?: number; // số tiền mua tối thiểu (VND) — không khai báo = không ràng buộc
}

const DEFAULT_ONLINE: OrderSourceConfig = {
  auth: "account-login",
  needEmail: false,
  needStorePick: false,
  needSlot: false,
  captcha: true,
  payments: ["COD", "Thẻ", "Ví điện tử"],
  note: "Đặt qua tài khoản trên website/app của nguồn này.",
  requirements: ["Đăng nhập tài khoản", "Địa chỉ giao"],
};

const CONFIG: Record<string, OrderSourceConfig> = {
  bhx: {
    auth: "phone-otp",
    needEmail: false,
    needStorePick: false,
    needSlot: true,
    captcha: false,
    payments: ["COD", "MoMo/ZaloPay", "Thẻ ATM/Visa/Master/JCB"],
    requirements: ["Số điện thoại (xác minh OTP)", "Địa chỉ giao", "Khung giờ giao"],
  },
  concung: {
    auth: "account-login",
    needEmail: false,
    needStorePick: false,
    needSlot: false,
    captcha: false,
    payments: ["COD", "Chuyển khoản", "Thẻ"],
    requirements: ["Đăng nhập tài khoản Con Cưng (SĐT + mật khẩu)", "Địa chỉ giao"],
  },
  coop: {
    auth: "account-login",
    needEmail: false,
    needStorePick: true,
    needSlot: true,
    captcha: false,
    payments: ["COD", "VNPAY", "MoMo"],
    note: "Freeship đơn từ 200.000đ trong bán kính 6km.",
    minOrder: 200000,
    requirements: [
      "Đăng nhập tài khoản Co.opmart",
      "Địa chỉ giao",
      "Khung giờ giao",
    ],
  },
  aeon: {
    auth: "account-login",
    needEmail: true,
    needStorePick: true,
    needSlot: true,
    captcha: true,
    payments: ["COD/POD", "Thẻ Visa/Master/JCB", "QR/Ví"],
    note: "AEON eShop yêu cầu đăng nhập tài khoản (email).",
    requirements: [
      "Đăng nhập tài khoản (email)",
      "Địa chỉ giao",
      "Khung giờ giao",
    ],
  },
  pnj: {
    auth: "account-login",
    needEmail: true,
    needStorePick: false,
    needSlot: false,
    captcha: false,
    payments: ["COD", "VNPAY", "Thẻ nội địa/Quốc tế"],
    note: "PNJ hỗ trợ giao hàng nhanh trong 3 giờ tại nhiều khu vực.",
    requirements: ["Đăng nhập tài khoản MyPNJ", "Họ tên & Địa chỉ giao hàng", "Email nhận hóa đơn"],
  },
};

export function getOrderConfig(chain: string): OrderSourceConfig {
  return CONFIG[chain] ?? DEFAULT_ONLINE;
}
