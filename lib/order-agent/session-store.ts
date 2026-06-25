import type { OrderSessionEvent, OrderSessionPrivateState, OrderSessionUpdate } from "./types";

const DEFAULT_TTL_MS = 30 * 60_000;

export interface InMemoryOrderSessionStore {
  create(session: OrderSessionPrivateState): OrderSessionPrivateState;
  get(id: string): OrderSessionPrivateState | null;
  findByIdempotencyKey(idempotencyKey: string): OrderSessionPrivateState | null;
  update(id: string, patch: OrderSessionUpdate): OrderSessionPrivateState | null;
  appendEvent(id: string, event: OrderSessionEvent): OrderSessionPrivateState | null;
  saveQrCode(id: string, qrImageBase64: string, qrContentType?: string): OrderSessionPrivateState | null;
  expire(id: string): OrderSessionPrivateState | null;
}

export function createInMemoryOrderSessionStore(ttlMs = DEFAULT_TTL_MS): InMemoryOrderSessionStore {
  const sessions = new Map<string, OrderSessionPrivateState>();
  const idempotency = new Map<string, string>();

  function purgeExpired(id: string): OrderSessionPrivateState | null {
    const session = sessions.get(id) ?? null;
    if (!session) return null;
    if (Date.now() <= new Date(session.expiresAt).getTime()) return session;

    const expired: OrderSessionPrivateState = {
      ...session,
      status: "expired",
      step: "expired",
      progress: session.progress,
      message: "Phiên đã hết hạn",
      updatedAt: new Date().toISOString(),
      timeline: session.timeline.concat({
        at: new Date().toISOString(),
        status: "expired",
        message: "Phiên đã hết hạn",
      }),
    };
    sessions.set(id, expired);
    return expired;
  }

  function get(id: string): OrderSessionPrivateState | null {
    return purgeExpired(id);
  }

  return {
    create(session) {
      const expiresAt = new Date(Date.now() + ttlMs).toISOString();
      const created: OrderSessionPrivateState = { ...session, expiresAt };
      sessions.set(created.id, created);
      idempotency.set(created.idempotencyKey, created.id);
      return created;
    },
    get,
    findByIdempotencyKey(idempotencyKey) {
      const id = idempotency.get(idempotencyKey);
      return id ? get(id) : null;
    },
    update(id, patch) {
      const current = get(id);
      if (!current) return null;
      const now = new Date().toISOString();
      const next: OrderSessionPrivateState = {
        ...current,
        ...patch,
        updatedAt: now,
        timeline: patch.message
          ? current.timeline.concat({ at: now, status: patch.status ?? current.status, message: patch.message })
          : current.timeline,
      };
      sessions.set(id, next);
      return next;
    },
    appendEvent(id, event) {
      const current = get(id);
      if (!current) return null;
      const next: OrderSessionPrivateState = {
        ...current,
        events: current.events.concat(event),
        updatedAt: new Date().toISOString(),
      };
      sessions.set(id, next);
      return next;
    },
    saveQrCode(id, qrImageBase64, qrContentType = "image/png") {
      const current = get(id);
      if (!current) return null;
      const next: OrderSessionPrivateState = {
        ...current,
        updatedAt: new Date().toISOString(),
        private: {
          ...current.private,
          qrImageBase64,
          qrContentType,
        },
      };
      sessions.set(id, next);
      return next;
    },
    expire(id) {
      const current = sessions.get(id);
      if (!current) return null;
      const next: OrderSessionPrivateState = {
        ...current,
        status: "expired",
        step: "expired",
        message: "Phiên đã hết hạn",
        updatedAt: new Date().toISOString(),
        timeline: current.timeline.concat({
          at: new Date().toISOString(),
          status: "expired",
          message: "Phiên đã hết hạn",
        }),
      };
      sessions.set(id, next);
      return next;
    },
  };
}

const globalStore = globalThis as typeof globalThis & {
  __oneAffreeOrderSessionStore?: InMemoryOrderSessionStore;
};

export function getOrderSessionStore(): InMemoryOrderSessionStore {
  if (!globalStore.__oneAffreeOrderSessionStore) {
    globalStore.__oneAffreeOrderSessionStore = createInMemoryOrderSessionStore();
  }
  return globalStore.__oneAffreeOrderSessionStore;
}
