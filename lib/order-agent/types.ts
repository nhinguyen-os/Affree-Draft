export type OrderProviderKey = "tuoixanhnhanhngon";

export type OrderSessionStatus =
  | "created"
  | "running"
  | "waiting_for_otp"
  | "waiting_for_captcha"
  | "waiting_for_login"
  | "waiting_for_final_confirmation"
  | "waiting_for_qr_payment"
  | "verifying_payment"
  | "completed"
  | "failed"
  | "cancelled"
  | "expired";

export type OrderRequiredInput =
  | "otp"
  | "captcha"
  | "login"
  | "final_confirmation"
  | "qr_payment";

export type OrderSessionPopupView = "qr" | "confirm" | "full";

export type OrderSessionEvent =
  | { type: "otp_submitted"; otp: string }
  | { type: "login_completed" }
  | { type: "captcha_completed" }
  | { type: "confirm_final_action" }
  | { type: "payment_submitted" }
  | { type: "popup_click"; xRatio: number; yRatio: number }
  | { type: "popup_switch_view"; view: OrderSessionPopupView }
  | { type: "choose_handoff" }
  | { type: "cancel" };

export interface CreateOrderSessionRequest {
  provider: OrderProviderKey;
  offer: {
    productId?: string;
    productName: string;
    productUrl: string;
    storeId?: string;
    price?: number;
  };
  quantity: number;
  customer: {
    name: string;
    phone: string;
    address: string;
    note?: string;
  };
  delivery?: {
    slot?: string;
  };
  idempotencyKey: string;
}

export interface OrderSessionTimelineEntry {
  at: string;
  status: OrderSessionStatus;
  message: string;
}

export interface OrderSessionPopupBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface OrderSessionPopupState {
  open: boolean;
  mode: "popup-focus";
  kind: string;
  view?: OrderSessionPopupView;
  title?: string;
  text?: string;
  actions: string[];
  bounds: OrderSessionPopupBounds;
  qrBounds?: OrderSessionPopupBounds;
  confirmBounds?: OrderSessionPopupBounds;
  scrollHint?: "top" | "bottom";
  updatedAt: string;
}

export interface PublicOrderSessionState {
  id: string;
  provider: OrderProviderKey;
  status: OrderSessionStatus;
  step: string;
  progress: number;
  message: string;
  requiredInput?: OrderRequiredInput;
  handoffUrl?: string;
  orderCode?: string;
  error?: string;
  updatedAt: string;
  expiresAt: string;
  timeline: OrderSessionTimelineEntry[];
  qrCodeAvailable: boolean;
  popup?: OrderSessionPopupState;
  popupFrameAvailable: boolean;
}

export interface OrderSessionPrivateState {
  id: string;
  provider: OrderProviderKey;
  status: OrderSessionStatus;
  step: string;
  progress: number;
  message: string;
  requiredInput?: OrderRequiredInput;
  handoffUrl?: string;
  orderCode?: string;
  error?: string;
  customer: CreateOrderSessionRequest["customer"];
  offer: CreateOrderSessionRequest["offer"];
  quantity: number;
  delivery?: CreateOrderSessionRequest["delivery"];
  idempotencyKey: string;
  events: OrderSessionEvent[];
  timeline: OrderSessionTimelineEntry[];
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  private: {
    qrImageBase64?: string;
    qrContentType?: string;
    popupState?: OrderSessionPopupState;
    popupFrameBase64?: string;
    popupFrameContentType?: string;
    lastOtp?: string;
  };
}

export interface OrderSessionUpdate {
  status?: OrderSessionStatus;
  step?: string;
  progress?: number;
  message?: string;
  requiredInput?: OrderRequiredInput | undefined;
  handoffUrl?: string | undefined;
  orderCode?: string | undefined;
  error?: string | undefined;
}
