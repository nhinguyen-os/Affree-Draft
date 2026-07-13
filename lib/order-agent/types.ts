export type OrderProviderKey = "tuoixanhnhanhngon" | "premiumoutlets";

export type OrderSessionStatus =
  | "created"
  | "running"
  | "waiting_for_otp"
  | "waiting_for_captcha"
  | "waiting_for_login"
  | "waiting_for_payment_selection"
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
  | "payment_selection"
  | "final_confirmation"
  | "qr_payment";

export type OrderSessionPopupView = "qr" | "confirm" | "full";

export type OrderSessionInteractionMode = "popup-focus" | "full-viewport";

export type OrderSessionEvent =
  | { type: "otp_submitted"; otp: string }
  | { type: "login_completed" }
  | { type: "captcha_completed" }
  | { type: "confirm_final_action" }
  | { type: "payment_submitted" }
  | { type: "popup_click"; xRatio: number; yRatio: number }
  | { type: "popup_hold"; xRatio: number; yRatio: number; durationMs?: number }
  | { type: "frame_click"; xRatio: number; yRatio: number }
  | { type: "frame_mousedown"; xRatio: number; yRatio: number }
  | { type: "frame_mouseup"; xRatio: number; yRatio: number }
  | { type: "frame_mousemove"; xRatio: number; yRatio: number }
  | { type: "frame_wheel"; xRatio: number; yRatio: number; deltaX?: number; deltaY?: number }
  | { type: "frame_keypress"; key: string }
  | { type: "popup_switch_view"; view: OrderSessionPopupView }
  | { type: "choose_handoff" }
  | { type: "cancel" };

export interface OrderSessionPaymentCard {
  number: string;
  expMonth: string;
  expYear: string;
  cvv: string;
  name?: string;
}

export interface OrderSessionPaymentPayload {
  method: "card";
  card: OrderSessionPaymentCard;
}

export interface OrderSessionUsAddress {
  street: string;
  city: string;
  state: string;
  zipCode: string;
}

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
    email?: string;
    phone: string;
    address: string;
    usAddress?: OrderSessionUsAddress;
    note?: string;
  };
  delivery?: {
    slot?: string;
  };
  payment?: OrderSessionPaymentPayload;
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
  mode: OrderSessionInteractionMode;
  kind: string;
  view?: OrderSessionPopupView;
  verifyState?: "idle" | "holding" | "passed" | "checking" | "failed";
  verifyHint?: string;
  interaction?: "click" | "hold";
  holdDurationMs?: number;
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
  interactionFrameAvailable: boolean;
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
  payment?: CreateOrderSessionRequest["payment"];
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
    interactionFrameBase64?: string;
    interactionFrameContentType?: string;
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
