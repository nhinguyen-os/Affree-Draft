// Kiểm tra số điện thoại theo quốc gia của cửa hàng (suy ra từ tiền tệ).
// Mỗi nước có định dạng riêng → validate + placeholder + thông báo lỗi phù hợp.
// Trả về chuỗi VN gốc cho placeholder/error để chỗ render bọc t() (i18n).

export type PhoneCountry = "VN" | "US" | "INTL";

/** Suy quốc gia từ tiền tệ cửa hàng: VND→VN, USD→US, còn lại→quốc tế. */
export function phoneCountryForCurrency(currency?: string): PhoneCountry {
  const c = (currency || "").toUpperCase();
  if (c === "VND") return "VN";
  if (c === "USD") return "US";
  return "INTL";
}

export type PhoneRule = {
  country: PhoneCountry;
  /** true nếu số hợp lệ theo định dạng quốc gia. */
  test: (raw: string) => boolean;
  /** placeholder (khoá VN, bọc t() khi render). */
  placeholderVi: string;
  /** thông báo lỗi (khoá VN, bọc t() khi render). */
  errorVi: string;
};

const strip = (raw: string) => raw.replace(/[\s.\-()]/g, "");

/** Lấy quy tắc SĐT theo tiền tệ của cửa hàng. */
export function phoneRule(currency?: string): PhoneRule {
  const country = phoneCountryForCurrency(currency);

  if (country === "US") {
    // Mỹ/Canada (NANP): 10 số, bỏ tiền tố +1; số đầu mã vùng/đầu số 2–9.
    return {
      country,
      test: (raw) => /^[2-9]\d{2}[2-9]\d{6}$/.test(strip(raw).replace(/^\+?1/, "")),
      placeholderVi: "VD: (408) 555-0123",
      errorVi: "Số điện thoại không hợp lệ — cần 10 số (Hoa Kỳ).",
    };
  }

  if (country === "INTL") {
    // Quốc tế (E.164): có thể có dấu +, 8–15 chữ số.
    return {
      country,
      test: (raw) => /^\+?\d{8,15}$/.test(strip(raw)),
      placeholderVi: "VD: +1 408 555 0123",
      errorVi: "Số điện thoại không hợp lệ — nhập theo định dạng quốc tế (vd +84…).",
    };
  }

  // Việt Nam: 10 số, đầu 0, số thứ 2 thuộc {3,5,7,8,9}; chấp nhận +84/84.
  return {
    country,
    test: (raw) => /^0[35789]\d{8}$/.test(strip(raw).replace(/^(\+?84)/, "0")),
    placeholderVi: "VD: 0901234567",
    errorVi: "Số điện thoại không hợp lệ — cần 10 số, bắt đầu bằng 03/05/07/08/09.",
  };
}
