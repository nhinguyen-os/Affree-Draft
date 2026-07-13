import type { OrderSessionPrivateState, PublicOrderSessionState } from "./types";

export function toPublicOrderSessionState(session: OrderSessionPrivateState): PublicOrderSessionState {
  return {
    id: session.id,
    provider: session.provider,
    status: session.status,
    step: session.step,
    progress: session.progress,
    message: session.message,
    requiredInput: session.requiredInput,
    handoffUrl: session.handoffUrl,
    orderCode: session.orderCode,
    error: session.error,
    updatedAt: session.updatedAt,
    expiresAt: session.expiresAt,
    timeline: session.timeline,
    qrCodeAvailable: Boolean(session.private.qrImageBase64),
    popup: session.private.popupState,
    interactionFrameAvailable: Boolean(session.private.interactionFrameBase64 || session.private.popupFrameBase64),
    popupFrameAvailable: Boolean(session.private.interactionFrameBase64 || session.private.popupFrameBase64),
  };
}
