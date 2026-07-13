import type { CartItem } from "@/lib/types";

/** Một nhóm checkout độc lập. `key` không nhất thiết là store_id: Co.op dùng terminal_code. */
export type StoreOrderGroup = {
  key: string;
  chain: string;
  storeId: string;
  terminalCode?: string;
  items: CartItem[];
};

export type StoreOrderContext = {
  name: string;
  phone: string;
  address: string;
  email?: string;
  addressLine?: string;
  provinceId?: string;
  provinceName?: string;
  districtId?: string;
  districtName?: string;
  wardId?: string;
  wardName?: string;
  payMethod: "qr" | "card" | "cod" | null;
  slot?: string;
  accountSlot?: number;
};

export type StoreOrderProgress = {
  groupKey: string;
  phase: "queued" | "creating_cart" | "preparing" | "ready_to_confirm" | "placing_order" | "fetching_payment_qr" | "awaiting_payment" | "completed" | "failed";
  checkoutFlowId?: string;
  paymentMethodCode?: string;
  paymentMethodName?: string;
  orderCode?: string;
  paymentUrl?: string;
  qrImage?: string;
  error?: string;
};

export interface StoreOrderExecutor {
  supports(group: StoreOrderGroup): boolean;
  execute(group: StoreOrderGroup, context: StoreOrderContext, onProgress: (progress: StoreOrderProgress) => void): Promise<StoreOrderProgress>;
  confirm?(group: StoreOrderGroup, prepared: StoreOrderProgress, context: StoreOrderContext, onProgress: (progress: StoreOrderProgress) => void): Promise<StoreOrderProgress>;
}
