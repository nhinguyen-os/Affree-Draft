/**
 * Mỗi nguồn bán yêu cầu thông tin/đăng nhập khác nhau khi đặt hàng.
 * Config này quyết định FORM hiển thị field gì + trợ lý chạy các bước nào.
 * (Dựa trên quy trình thực tế của từng web đã khảo sát.)
 */

export type OrderAuth =
  | "guest-phone" // nguồn cho mua nhanh chỉ cần SĐT
  | "phone-otp" // nguồn xác minh bằng SĐT + OTP
  | "account-login"; // nguồn cần tài khoản (email/mật khẩu)
// LƯU Ý: Affree đặt hộ bằng TÀI KHOẢN AFFREE trên nguồn — khách không đăng nhập/OTP.
// `auth` chỉ mô tả cơ chế của nguồn (Affree tự xử lý), không sinh bước chờ khách.

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
  needShipping?: boolean; // có bước chọn đơn vị vận chuyển (vd Shopee) — hiện selector "Vận chuyển"
  shippingOptions?: ShippingOption[]; // các gói vận chuyển demo (chỉ dùng khi needShipping)
}

/** 1 gói vận chuyển (demo) — phí & thời gian minh hoạ trên prototype, không phải cước thật. */
export interface ShippingOption {
  id: string;
  label: string;
  fee: number; // VND (demo)
  eta: string; // thời gian giao dự kiến
}

const DEFAULT_ONLINE: OrderSourceConfig = {
  auth: "account-login",
  needEmail: false,
  needStorePick: false,
  needSlot: false,
  captcha: true,
  payments: ["COD", "Thẻ", "Ví điện tử"],
  note: "Affree đặt hộ bằng tài khoản Affree trên nguồn này — bạn không cần đăng nhập.",
  requirements: ["SĐT nhận hàng", "Địa chỉ giao"],
};

const CONFIG: Record<string, OrderSourceConfig> = {
  bhx: {
    auth: "phone-otp",
    needEmail: false,
    needStorePick: false,
    needSlot: true,
    captcha: false,
    payments: ["COD", "MoMo/ZaloPay", "Thẻ ATM/Visa/Master/JCB"],
    requirements: ["SĐT nhận hàng", "Địa chỉ giao", "Khung giờ giao"],
    needShipping: true,
    shippingOptions: [
      { id: "fast", label: "Nhanh", fee: 16500, eta: "2–4 ngày" },
      { id: "express", label: "Hoả tốc", fee: 40000, eta: "Trong ngày" },
      { id: "saving", label: "Tiết kiệm", fee: 0, eta: "3–5 ngày" },
    ],
  },
  concung: {
    auth: "account-login",
    needEmail: false,
    needStorePick: false,
    needSlot: false,
    captcha: false,
    payments: ["COD", "Chuyển khoản", "Thẻ"],
    requirements: ["SĐT nhận hàng", "Địa chỉ giao"],
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
      "SĐT nhận hàng",
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
    requirements: [
      "Email nhận hoá đơn",
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
    requirements: ["Họ tên & Địa chỉ giao hàng", "Email nhận hóa đơn"],
  },
  // Shopee: đặt hộ qua tài khoản Affree; quy trình checkout cần chọn ĐƠN VỊ VẬN CHUYỂN
  // (needShipping) ngoài Người nhận + Thanh toán. Phí/thời gian dưới đây là DEMO.
  shopee: {
    auth: "account-login",
    needEmail: false,
    needStorePick: false,
    needSlot: false,
    captcha: true,
    needShipping: true,
    shippingOptions: [
      { id: "fast", label: "Nhanh", fee: 16500, eta: "2–4 ngày" },
      { id: "express", label: "Hoả tốc", fee: 40000, eta: "Trong ngày" },
      { id: "saving", label: "Tiết kiệm", fee: 0, eta: "3–5 ngày" },
    ],
    payments: ["COD", "ShopeePay", "Thẻ Visa/Master/JCB", "Chuyển khoản"],
    note: "Affree đặt hộ bằng tài khoản Affree trên Shopee — bạn không cần đăng nhập.",
    requirements: ["SĐT nhận hàng", "Địa chỉ giao", "Đơn vị vận chuyển"],
  },
};

// spe là alias của shopee trong SOURCE_META → dùng chung config.
CONFIG.spe = CONFIG.shopee;
// Beauty Republic (mã nguồn "br") bán trên Shopee → cùng luồng checkout Shopee (có Vận chuyển).
CONFIG.br = {
  ...CONFIG.shopee,
  note: "Beauty Republic bán trên Shopee — Affree đặt hộ bằng tài khoản Affree, bạn không cần đăng nhập.",
};

export function getOrderConfig(chain: string): OrderSourceConfig {
  // Tra theo key thường hoá — chain trong dữ liệu có thể là "BR"/"br", "THXL"…; các key CONFIG đều thường.
  return CONFIG[(chain || "").toLowerCase()] ?? DEFAULT_ONLINE;
}
