// Client helper cho bộ đếm THẬT của trang (gọi /api/metrics → Apps Script).
// - bumpMetric("visit"): mỗi PHIÊN trình duyệt chỉ đếm 1 lần (sessionStorage guard),
//   tránh F5 nhiều lần thổi phồng số.
// - bumpMetric("order" | "cart"): đếm theo sự kiện thật.
// - getMetrics(): đọc tổng để hiển thị.

export type SiteTotals = { visits: number; orders: number; carts: number };

export async function getMetrics(): Promise<SiteTotals | null> {
  try {
    const res = await fetch("/api/metrics", { cache: "no-store" });
    if (!res.ok) return null;
    const j = (await res.json()) as { totals?: SiteTotals };
    return j.totals ?? null;
  } catch {
    return null;
  }
}

export function bumpMetric(event: "visit" | "order" | "cart"): void {
  if (typeof window === "undefined") return;
  // "visit" chỉ đếm 1 lần/phiên.
  if (event === "visit") {
    try {
      if (sessionStorage.getItem("gqd_visit_counted") === "1") return;
      sessionStorage.setItem("gqd_visit_counted", "1");
    } catch {
      /* ignore */
    }
  }
  // fire-and-forget, không chặn UI.
  try {
    fetch("/api/metrics", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* ignore */
  }
}
