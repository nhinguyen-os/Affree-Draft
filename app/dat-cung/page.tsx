"use client";

import { useState } from "react";
import CobrowseSession, { type CobrowseStore } from "@/components/CobrowseSession";

/**
 * PREVIEW màn đặt đơn co-browse (CobrowseSession) với dữ liệu mẫu 3 cửa hàng.
 * Chỉ để xem/duyệt thiết kế; luồng thật mở từ nút "Giỏ hàng" và "Mua ngay" trong app.
 */

const BUYER = {
  name: "Châu Hoàng Tân",
  phone: "0933028077",
  address: "220/12 Nguyễn Trọng Tuyển, P. Phú Nhuận, TP.HCM",
};

const SLOT = "Trong hôm nay (2–4 giờ)";
const STORES: CobrowseStore[] = [
  {
    key: "coop1", name: "Co.op Online", branch: "Co.opmart Nguyễn Trọng Tuyển",
    color: "#1F4FA3", icon: "🛒", skin: "coop", domain: "cooponline.vn/checkout",
    products: [{ emoji: "🍺", name: "Bia Tiger Crystal lốc 6 lon ×330ml", qty: 3, unitPrice: 106300, lineTotal: 318900 }],
    ship: 12000, total: 330900,
    fields: [
      { label: "Tên người nhận", src: "name" },
      { label: "Số điện thoại", src: "phone", sensitive: true },
      { label: "Địa chỉ giao hàng", src: "address", sensitive: true },
      { label: "Khung giờ giao", fixed: SLOT },
    ],
  },
  {
    key: "bhx", name: "Bách Hóa Xanh", branch: "BHX 223 Nguyễn Trọng Tuyển",
    color: "#0B8F3A", icon: "🥬", skin: "bhx", domain: "bachhoaxanh.com/gio-hang",
    products: [{ emoji: "☕", name: "Cà phê đen đá NesCafé Việt 560g", qty: 2, unitPrice: 38000, lineTotal: 76000 }],
    ship: 0, total: 76000,
    fields: [
      { label: "Tên người nhận", src: "name" },
      { label: "Số điện thoại", src: "phone", sensitive: true },
      { label: "Cửa hàng nhận", fixed: "BHX 223 Nguyễn Trọng Tuyển" },
      { label: "Thời gian nhận", fixed: SLOT },
    ],
  },
  {
    key: "coop2", name: "Co.op Online", branch: "Co.opmart Đinh Tiên Hoàng",
    color: "#1F4FA3", icon: "🛒", skin: "coop", domain: "cooponline.vn/checkout",
    products: [{ emoji: "🧴", name: "Nước giặt Omo Matic cửa trước 2.8kg", qty: 1, unitPrice: 148900, lineTotal: 148900 }],
    ship: 12000, total: 160900,
    fields: [
      { label: "Tên người nhận", src: "name" },
      { label: "Số điện thoại", src: "phone", sensitive: true },
      { label: "Địa chỉ giao hàng", src: "address", sensitive: true },
      { label: "Khung giờ giao", fixed: SLOT },
    ],
  },
];

export default function DatCungPreview() {
  const [open, setOpen] = useState(true);
  return (
    <div style={{ padding: 24, fontFamily: "system-ui" }}>
      <button
        onClick={() => setOpen(true)}
        style={{ background: "#0E7C6B", color: "#fff", border: "none", borderRadius: 10, padding: "12px 18px", fontWeight: 700 }}
      >
        Mở màn đặt đơn (preview)
      </button>
      {open && (
        <CobrowseSession
          lang="vi"
          buyer={BUYER}
          stores={STORES}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}
