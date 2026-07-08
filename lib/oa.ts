"use client";

/**
 * Zalo OA — phía client (Phương án 🅰️ prototype, KHÔNG xác thực thật).
 *
 * "Quan tâm OA" chỉ đánh dấu bằng localStorage: bấm Quan tâm → mở link OA + lưu cờ.
 * Lần sau số liên hệ tự mở sẵn. KHÔNG kiểm chứng user có bấm Quan tâm thật hay không
 * (muốn xác thực thật cần Zalo Login + OA API — xem lib/oa-config.ts / lộ trình 🅱️).
 *
 * Cấu hình OA (tên, link, text popup…) đọc từ tab sheet qua /api/oa-config; nếu sheet
 * trống/lỗi thì dùng OA_DEFAULTS bên dưới.
 */

import { useEffect, useState } from "react";
import { getProfile } from "@/lib/profile";

export type OaConfig = {
  oa_name: string;
  oa_zalo_url: string;
  oa_id: string;
  oa_logo: string;
  popup_title: string;
  popup_desc: string;
  require_follow: boolean;
};

export const OA_DEFAULTS: OaConfig = {
  oa_name: "Affree — One Solution",
  oa_zalo_url: "https://zalo.me/740569612756449830",
  oa_id: "740569612756449830",
  oa_logo: "",
  popup_title: "Quan tâm Zalo OA để xem liên hệ",
  popup_desc:
    "Theo dõi OA của Affree để mở khoá số liên hệ cửa hàng. Đã quan tâm rồi thì số sẽ hiện sẵn ở những lần sau.",
  require_follow: true,
};

const FOLLOW_KEY = "affree_oa_followed";
const FOLLOW_EVENT = "affree-oa-followed";

export function isOaFollowed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(FOLLOW_KEY) === "1";
  } catch {
    return false;
  }
}

export function markOaFollowed(): void {
  try {
    localStorage.setItem(FOLLOW_KEY, "1");
  } catch {
    // ignore
  }
  if (typeof window !== "undefined") window.dispatchEvent(new Event(FOLLOW_EVENT));
}

// ── Giả lập "quan tâm OA → lưu danh sách zalo_id" ────────────────────────────
// KHÔNG có Zalo Login thật → zalo_id là MÔ PHỎNG: ưu tiên SĐT đã lưu (profile),
// nếu chưa có thì sinh id ẩn danh ổn định trong máy. Lên 🅱️ chỉ việc thay nguồn id.
const SIM_ID_KEY = "affree_zalo_sim_id";
const FOLLOWERS_KEY = "affree_oa_followers";
const ZALO_ACCOUNT_KEY = "affree_zalo_account";

/** Tài khoản Zalo MÔ PHỎNG (từ màn "Đăng nhập Zalo" giả). zalo_id dạng số giống thật. */
export type ZaloAccount = { zalo_id: string; name: string };

export function getZaloAccount(): ZaloAccount | null {
  if (typeof window === "undefined") return null;
  try {
    const r = localStorage.getItem(ZALO_ACCOUNT_KEY);
    return r ? (JSON.parse(r) as ZaloAccount) : null;
  } catch {
    return null;
  }
}

/** id 18 chữ số, không bắt đầu bằng 0 — trông giống user id Zalo thật. */
function genZaloId(): string {
  let s = String(1 + Math.floor(Math.random() * 9));
  for (let i = 0; i < 17; i++) s += Math.floor(Math.random() * 10);
  return s;
}

/** "Đăng nhập Zalo" mô phỏng: tạo tài khoản nếu chưa có, lưu lại, trả về. */
export function loginZaloSim(): ZaloAccount {
  const existing = getZaloAccount();
  if (existing?.zalo_id) return existing;
  const prof = getProfile();
  const acc: ZaloAccount = { zalo_id: genZaloId(), name: prof.name || "Người dùng Zalo" };
  try {
    localStorage.setItem(ZALO_ACCOUNT_KEY, JSON.stringify(acc));
  } catch {
    // ignore
  }
  return acc;
}

export type OaFollower = {
  zalo_id: string;
  name: string;
  phone: string;
  source: string;
  ts: string;
};

/** id mô phỏng: "phone:<sđt>" nếu đã có SĐT, else "zsim_xxxx" ẩn danh (ổn định/máy). */
export function getSimZaloId(): string {
  if (typeof window === "undefined") return "zsim_ssr";
  const acc = getZaloAccount();
  if (acc?.zalo_id) return acc.zalo_id; // đã "đăng nhập Zalo" → dùng id đó
  const phone = (getProfile().phone || "").replace(/\D/g, "");
  if (phone) return "phone:" + phone;
  try {
    let id = localStorage.getItem(SIM_ID_KEY);
    if (!id) {
      id = "zsim_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
      localStorage.setItem(SIM_ID_KEY, id);
    }
    return id;
  } catch {
    return "zsim_anon";
  }
}

export function getOaFollowers(): OaFollower[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(FOLLOWERS_KEY) || "[]") as OaFollower[];
  } catch {
    return [];
  }
}

/**
 * Luồng "bấm Quan tâm OA": suy ra zalo_id (mô phỏng) → thêm vào danh sách (dedupe)
 * → set cờ đã follow → POST /api/oa-followers (ghi sheet nếu có webhook, không thì
 * client-only). Danh sách vẫn giữ ở localStorage để chạy được ngay cả khi offline.
 */
export async function followOa(source = "contact"): Promise<OaFollower> {
  const prof = getProfile();
  const acc = getZaloAccount();
  const rec: OaFollower = {
    zalo_id: getSimZaloId(),
    name: acc?.name || prof.name || "",
    phone: (prof.phone || "").replace(/\s+/g, ""),
    source,
    ts: new Date().toISOString(),
  };
  try {
    const list = getOaFollowers();
    if (!list.some((f) => f.zalo_id === rec.zalo_id)) {
      list.push(rec);
      localStorage.setItem(FOLLOWERS_KEY, JSON.stringify(list));
    }
  } catch {
    // ignore
  }
  markOaFollowed();
  try {
    await fetch("/api/oa-followers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(rec),
      keepalive: true,
    });
  } catch {
    // offline / chưa cấu hình → đã có localStorage
  }
  return rec;
}

/** Hook trạng thái follow — đồng bộ giữa các component (cùng tab + tab khác). */
export function useOaFollowed(): boolean {
  const [followed, setFollowed] = useState(false);
  useEffect(() => {
    setFollowed(isOaFollowed());
    const onChange = () => setFollowed(isOaFollowed());
    window.addEventListener(FOLLOW_EVENT, onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener(FOLLOW_EVENT, onChange);
      window.removeEventListener("storage", onChange);
    };
  }, []);
  return followed;
}

/** Fetch cấu hình OA 1 lần, cache ở module. Trả OA_DEFAULTS trong lúc chờ / khi lỗi. */
let cachePromise: Promise<OaConfig> | null = null;
export function useOaConfig(): OaConfig {
  const [cfg, setCfg] = useState<OaConfig>(OA_DEFAULTS);
  useEffect(() => {
    if (!cachePromise) {
      cachePromise = fetch("/api/oa-config")
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => ({ ...OA_DEFAULTS, ...((j && j.oa) || {}) }) as OaConfig)
        .catch(() => OA_DEFAULTS);
    }
    let alive = true;
    cachePromise.then((c) => {
      if (alive) setCfg(c);
    });
    return () => {
      alive = false;
    };
  }, []);
  return cfg;
}
